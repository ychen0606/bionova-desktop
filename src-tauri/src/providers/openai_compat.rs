use super::{ChatChunk, ChatMessage, ChatOpts, LLMProvider, PingResult, UsageStats};
use anyhow::{Context, Result};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Instant;
use tokio::sync::mpsc::UnboundedSender;

/// Build a request URL by joining base_url + endpoint, tolerating both
/// `https://api.example.com` and `https://api.example.com/v1` from the user
/// (OpenAI docs show the latter). Without this, we'd POST to
/// `https://.../v1/v1/chat/completions` and the server 404s.
fn join_url(base: &str, endpoint_after_v1: &str) -> String {
    let mut t = base.trim_end_matches('/');
    if t.ends_with("/v1") {
        t = &t[..t.len() - 3];
    }
    format!("{}/v1{}", t.trim_end_matches('/'), endpoint_after_v1)
}

pub struct OpenAICompatProvider {
    pub base_url: String,
    pub model: String,
    client: reqwest::Client,
}

impl OpenAICompatProvider {
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
impl LLMProvider for OpenAICompatProvider {
    async fn ping(&self, api_key: &str) -> Result<PingResult> {
        let start = Instant::now();
        let body = PingBody {
            model: &self.model,
            max_tokens: 1,
            messages: vec![PingMsg { role: "user", content: "ping" }],
        };
        let resp = self
            .client
            .post(join_url(&self.base_url, "/chat/completions"))
            .bearer_auth(api_key)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .context("openai-compat request send")?;

        let status = resp.status();
        let elapsed = start.elapsed().as_millis();

        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("openai-compat ping failed: HTTP {} — {}", status, text);
        }

        let v: serde_json::Value = resp.json().await.context("openai-compat response json")?;
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
        // OpenAI accepts a "system" role inline. If caller passed
        // opts.system separately, prepend it as a system message.
        let mut oai_messages: Vec<Value> = Vec::new();
        if let Some(sys) = &opts.system {
            oai_messages.push(json!({ "role": "system", "content": sys }));
        }
        for m in &messages {
            oai_messages.push(json!({ "role": m.role, "content": m.content }));
        }
        let body = json!({
            "model": opts.model,
            "max_tokens": opts.max_tokens,
            "temperature": opts.temperature,
            "messages": oai_messages,
            "stream": true,
            "stream_options": {"include_usage": true},
        });

        let resp = self
            .client
            .post(join_url(&self.base_url, "/chat/completions"))
            .bearer_auth(api_key)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .json(&body)
            .send()
            .await
            .context("openai-compat stream request")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let _ = tx.send(ChatChunk::Error {
                message: format!("openai-compat chat failed HTTP {}: {}", status, text),
            });
            let _ = tx.send(ChatChunk::Done);
            anyhow::bail!("openai-compat chat HTTP {}", status);
        }

        let mut stream = resp.bytes_stream();
        let mut sse_buf = String::new();
        let mut usage = UsageStats::default();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.context("openai stream chunk")?;
            sse_buf.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(idx) = sse_buf.find("\n\n") {
                let event = sse_buf[..idx].to_string();
                sse_buf.drain(..idx + 2);
                handle_openai_event(&event, &tx, &mut usage);
            }
        }
        let _ = tx.send(ChatChunk::Usage(usage));
        let _ = tx.send(ChatChunk::Done);
        Ok(())
    }

    fn name(&self) -> &'static str { "openai-compat" }
}

fn handle_openai_event(event: &str, tx: &UnboundedSender<ChatChunk>, usage: &mut UsageStats) {
    // OpenAI puts JSON on the `data:` line, with [DONE] as terminal.
    for line in event.lines() {
        let payload = line
            .strip_prefix("data: ")
            .or_else(|| line.strip_prefix("data:").map(|s| s.trim_start()));
        let Some(payload) = payload else { continue };
        if payload == "[DONE]" {
            continue; // we send our own Done at end of stream
        }
        let Ok(v): Result<Value, _> = serde_json::from_str(payload) else { continue };
        if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
            for ch in choices {
                if let Some(text) = ch
                    .get("delta")
                    .and_then(|d| d.get("content"))
                    .and_then(|t| t.as_str())
                {
                    if !text.is_empty() {
                        let _ = tx.send(ChatChunk::Text { text: text.into() });
                    }
                }
            }
        }
        if let Some(u) = v.get("usage") {
            if let Some(n) = u.get("prompt_tokens").and_then(|x| x.as_u64()) {
                usage.input_tokens = n as u32;
            }
            if let Some(n) = u.get("completion_tokens").and_then(|x| x.as_u64()) {
                usage.output_tokens = n as u32;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[test]
    fn join_url_handles_both_forms() {
        assert_eq!(
            join_url("https://api.openai.com", "/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            join_url("https://api.openai.com/v1", "/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            join_url("https://api.longxiadev.store/v1/", "/chat/completions"),
            "https://api.longxiadev.store/v1/chat/completions"
        );
    }

    #[tokio::test]
    async fn ping_success() {
        let server = MockServer::start_async().await;
        let mock = server
            .mock_async(|when, then| {
                when.method(POST)
                    .path("/v1/chat/completions")
                    .header("authorization", "Bearer sk-test");
                then.status(200)
                    .header("content-type", "application/json")
                    .body(r#"{"id":"chatcmpl-1","object":"chat.completion","model":"gpt-5","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}"#);
            })
            .await;

        let p = OpenAICompatProvider::new(server.base_url(), "gpt-5");
        let res = p.ping("sk-test").await.unwrap();
        assert!(res.ok);
        assert_eq!(res.model_reported.as_deref(), Some("gpt-5"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn chat_stream_collects_deltas() {
        let server = MockServer::start_async().await;
        let body_sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"there\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":2}}\n\n",
            "data: [DONE]\n\n",
        );
        let _m = server
            .mock_async(|when, then| {
                when.method(POST).path("/v1/chat/completions");
                then.status(200)
                    .header("content-type", "text/event-stream")
                    .body(body_sse);
            })
            .await;

        let p = OpenAICompatProvider::new(server.base_url(), "gpt-5");
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        p.chat_stream(
            "sk-test",
            vec![ChatMessage { role: "user".into(), content: "hi".into(), cache: false }],
            ChatOpts {
                model: "gpt-5".into(),
                max_tokens: 16,
                temperature: 0.2,
                system: Some("be terse".into()),
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
                    assert_eq!(u.input_tokens, 7);
                    assert_eq!(u.output_tokens, 2);
                }
                ChatChunk::Done => {
                    done_seen = true;
                    break;
                }
                ChatChunk::Error { message } => panic!("error: {message}"),
            }
        }
        assert_eq!(text, "Hi there");
        assert!(usage_seen);
        assert!(done_seen);
    }

    #[tokio::test]
    async fn ping_404_unknown_model() {
        let server = MockServer::start_async().await;
        let _m = server
            .mock_async(|when, then| {
                when.method(POST).path("/v1/chat/completions");
                then.status(404).body(r#"{"error":{"message":"model not found"}}"#);
            })
            .await;

        let p = OpenAICompatProvider::new(server.base_url(), "ghost-model");
        let err = p.ping("sk-test").await.unwrap_err();
        assert!(err.to_string().contains("404"));
    }
}
