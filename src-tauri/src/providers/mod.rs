use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;

pub mod anthropic;

#[async_trait]
pub trait LLMProvider: Send + Sync {
    /// Validate credentials and reachability with a minimal call.
    /// Returns the model name reported by the server when known.
    async fn ping(&self, api_key: &str) -> Result<PingResult>;
    fn name(&self) -> &'static str;
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PingResult {
    pub ok: bool,
    pub model_reported: Option<String>,
    pub latency_ms: u128,
}
