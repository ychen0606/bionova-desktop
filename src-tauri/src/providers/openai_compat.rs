use super::{LLMProvider, PingResult};
use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Serialize;
use std::time::Instant;

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
            .post(format!("{}/v1/chat/completions", self.base_url.trim_end_matches('/')))
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

    fn name(&self) -> &'static str { "openai-compat" }
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
