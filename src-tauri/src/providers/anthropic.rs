use super::{LLMProvider, PingResult};
use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Serialize;
use std::time::Instant;

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
            .post(format!("{}/v1/messages", self.base_url.trim_end_matches('/')))
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

    fn name(&self) -> &'static str { "anthropic" }
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
