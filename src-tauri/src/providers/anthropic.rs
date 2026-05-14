use super::{ChatChunk, ChatMessage, ChatOpts, LLMProvider, PingResult, UsageStats};
use anyhow::{Context, Result};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Instant;
use tokio::sync::mpsc::UnboundedSender;

fn join_url(base: &str, endpoint_after_v1: &str) -> String {
    let mut t = base.trim_end_matches('/');
    if t.ends_with("/v1") {
        t = &t[..t.len() - 3];
    }
    format!("{}/v1{}", t.trim_end_matches('/'), endpoint_after_v1)
}

pub struct AnthropicProvider {
    pub base_url: String,
    pub model: String,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }
}

#[derive(Serialize)]
struct PingBody<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<PingMsg<'a>>,
}

#[derive(Serialize)]
struct PingMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[async_trait]
impl LLMProvider for AnthropicProvider {
    async fn ping(&self, api_key: &str) -> Result<PingResult> {
        let start = Instant::now();
        let body = PingBody {
            model: &self.model,
            max_tokens: 1,
            messages: vec![PingMsg { role: "user", content: "ping" }],
        };
        let resp = self
            .client
            .post(join_url(&self.base_url, "/messages"))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .context("anthropic request send")?;

        let status = resp.status();
        let elapsed = start.elapsed().as_millis();

        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("anthropic ping failed: HTTP {} — {}", status, text);
        }

        let v: serde_json::Value = resp.json().await.context("anthropic response json")?;
        let model_reported = v.get("model").and_then(|m| m.as_str()).map(String::from);

        Ok(PingResult { ok: true, model_reported, latency_ms: elapsed })
    }

    async fn chat_stream(
        &self,
        api_key: &str,
        messages: Vec<ChatMessage>,
        opts: ChatOpts,
        tx: UnboundedSender<ChatChunk>,
    ) -> Result<()> {
        // Build Anthropic messages array. Anthropic does NOT accept a
        // "system" role inside messages — it goes as a top-level field. We
        // also map `cache: true` to a cache_control: ephemeral block.
        let mut anth_messages: Vec<Value> = Vec::new();
        for m in &messages {
            if m.role == "system" {
                continue; // handled via top-level system field
            }
            let mut block = json!({ "type": "text", "text": m.content });
            if m.cache {
                block["cache_control"] = json!({ "type": "ephemeral" });
            }
            anth_messages.push(json!({
                "role": m.role,
                "content": [block],
            }));
        }
        let system_text = opts
            .system
            .clone()
            .or_else(|| messages.iter().find(|m| m.role == "system").map(|m| m.content.clone()));

        let mut body = json!({
            "model": opts.model,
            "max_tokens": opts.max_tokens,
            "temperature": opts.temperature,
            "messages": anth_messages,
            "stream": true,
        });
        if let Some(s) = system_text {
            body["system"] = json!(s);
        }

        let resp = self
            .client
            .post(join_url(&self.base_url, "/messages"))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .json(&body)
            .send()
            .await
            .context("anthropic stream request")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let _ = tx.send(ChatChunk::Error {
                message: format!("anthropic chat failed HTTP {}: {}", status, text),
            });
            let _ = tx.send(ChatChunk::Done);
            anyhow::bail!("anthropic chat HTTP {}", status);
        }

        let mut stream = resp.bytes_stream();
        let mut sse_buf = String::new();
        let mut usage = UsageStats::default();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.context("anthropic stream chunk")?;
            sse_buf.push_str(&String::from_utf8_lossy(&bytes));
            // Process complete events (separated by blank lines).
            while let Some(idx) = sse_buf.find("\n\n") {
                let event = sse_buf[..idx].to_string();
                sse_buf.drain(..idx + 2);
                handle_anthropic_event(&event, &tx, &mut usage);
            }
        }

        let _ = tx.send(ChatChunk::Usage(usage));
        let _ = tx.send(ChatChunk::Done);
        Ok(())
    }

    fn name(&self) -> &'static str { "anthropic" }
}

fn handle_anthropic_event(event: &str, tx: &UnboundedSender<ChatChunk>, usage: &mut UsageStats) {
    // Each SSE event is one or more "field: value" lines. We only care
    // about the `data:` line — Anthropic puts JSON there.
    let mut data_lines: Vec<&str> = Vec::new();
    for line in event.lines() {
        if let Some(rest) = line.strip_prefix("data: ") {
            data_lines.push(rest);
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start());
        }
    }
    if data_lines.is_empty() {
        return;
    }
    let payload = data_lines.join("");
    let Ok(v): Result<Value, _> = serde_json::from_str(&payload) else { return };

    let event_type = v.get("type").and_then(|s| s.as_str()).unwrap_or("");
    match event_type {
        "content_block_delta" => {
            if let Some(text) = v
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
            {
                let _ = tx.send(ChatChunk::Text { text: text.into() });
            }
        }
        "message_start" => {
            if let Some(u) = v.get("message").and_then(|m| m.get("usage")) {
                merge_anthropic_usage(usage, u);
            }
        }
        "message_delta" => {
            if let Some(u) = v.get("usage") {
                merge_anthropic_usage(usage, u);
            }
        }
        "error" => {
            let msg = v
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown anthropic error")
                .to_string();
            let _ = tx.send(ChatChunk::Error { message: msg });
        }
        _ => {}
    }
}

fn merge_anthropic_usage(into: &mut UsageStats, v: &Value) {
    if let Some(n) = v.get("input_tokens").and_then(|x| x.as_u64()) {
        into.input_tokens = into.input_tokens.max(n as u32);
    }
    if let Some(n) = v.get("output_tokens").and_then(|x| x.as_u64()) {
        into.output_tokens = into.output_tokens.max(n as u32);
    }
    if let Some(n) = v.get("cache_read_input_tokens").and_then(|x| x.as_u64()) {
        into.cache_read_input_tokens = into.cache_read_input_tokens.max(n as u32);
    }
    if let Some(n) = v.get("cache_creation_input_tokens").and_then(|x| x.as_u64()) {
        into.cache_creation_input_tokens = into.cache_creation_input_tokens.max(n as u32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[tokio::test]
    async fn ping_success() {
        let server = MockServer::start_async().await;
        let mock = server
            .mock_async(|when, then| {
                when.method(POST)
                    .path("/v1/messages")
                    .header("x-api-key", "sk-test")
                    .header("anthropic-version", "2023-06-01");
                then.status(200)
                    .header("content-type", "application/json")
                    .body(r#"{"id":"msg_1","type":"message","model":"claude-sonnet-4-6","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":1,"output_tokens":1}}"#);
            })
            .await;

        let p = AnthropicProvider::new(server.base_url(), "claude-sonnet-4-6");
        let res = p.ping("sk-test").await.unwrap();
        assert!(res.ok);
        assert_eq!(res.model_reported.as_deref(), Some("claude-sonnet-4-6"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn chat_stream_collects_text_and_usage() {
        let server = MockServer::start_async().await;
        let body_sse = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"x\",\"usage\":{\"input_tokens\":10,\"output_tokens\":0}}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello \"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"world\"}}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":3}}\n\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n\n",
        );
        let _m = server
            .mock_async(|when, then| {
                when.method(POST).path("/v1/messages");
                then.status(200)
                    .header("content-type", "text/event-stream")
                    .body(body_sse);
            })
            .await;

        let p = AnthropicProvider::new(server.base_url(), "claude-sonnet-4-6");
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        p.chat_stream(
            "sk-test",
            vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
                cache: false,
            }],
            ChatOpts {
                model: "claude-sonnet-4-6".into(),
                max_tokens: 16,
                temperature: 0.2,
                system: None,
            },
            tx,
        )
        .await
        .unwrap();
        let mut text = String::new();
        let mut usage_seen = false;
        let mut done_seen = false;
        while let Some(chunk) = rx.recv().await {
            match chunk {
                ChatChunk::Text { text: t } => text.push_str(&t),
                ChatChunk::Usage(u) => {
                    usage_seen = true;
                    assert_eq!(u.input_tokens, 10);
                    assert_eq!(u.output_tokens, 3);
                }
                ChatChunk::Done => {
                    done_seen = true;
                    break;
                }
                ChatChunk::Error { message } => panic!("unexpected error: {message}"),
            }
        }
        assert_eq!(text, "Hello world");
        assert!(usage_seen);
        assert!(done_seen);
    }

    #[tokio::test]
    async fn ping_unauthorized() {
        let server = MockServer::start_async().await;
        let _mock = server
            .mock_async(|when, then| {
                when.method(POST).path("/v1/messages");
                then.status(401)
                    .body(r#"{"error":{"type":"authentication_error","message":"invalid x-api-key"}}"#);
            })
            .await;

        let p = AnthropicProvider::new(server.base_url(), "claude-sonnet-4-6");
        let err = p.ping("wrong-key").await.unwrap_err();
        assert!(err.to_string().contains("401"), "got: {err}");
    }
}
