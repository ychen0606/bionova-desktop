use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::UnboundedSender;

pub mod anthropic;
pub mod openai_compat;

#[async_trait]
pub trait LLMProvider: Send + Sync {
    /// Validate credentials and reachability with a minimal call.
    async fn ping(&self, api_key: &str) -> Result<PingResult>;

    /// Stream a chat completion. Sends each chunk on `tx`; returns when
    /// the upstream marks the stream complete or errors. The provider is
    /// responsible for sending a trailing `ChatChunk::Done`.
    async fn chat_stream(
        &self,
        api_key: &str,
        messages: Vec<ChatMessage>,
        opts: ChatOpts,
        tx: UnboundedSender<ChatChunk>,
    ) -> Result<()>;

    fn name(&self) -> &'static str;
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PingResult {
    pub ok: bool,
    pub model_reported: Option<String>,
    pub latency_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,    // "user" | "assistant" | "system"
    pub content: String,
    /// Hint Anthropic to mark this segment as a cache breakpoint. Ignored
    /// by OpenAI-compat (which has no explicit cache control header).
    #[serde(default)]
    pub cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatOpts {
    pub model: String,
    pub max_tokens: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    /// Optional system prompt extracted from the messages array.
    /// Anthropic expects this as a top-level field; OpenAI consumes it as a
    /// "system"-role message inside `messages`.
    #[serde(default)]
    pub system: Option<String>,
}

fn default_temperature() -> f32 {
    0.2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatChunk {
    /// Incremental text from the assistant.
    Text { text: String },
    /// Token usage; emitted once at end-of-stream.
    Usage(UsageStats),
    /// Stream complete.
    Done,
    /// Stream aborted by provider with a message.
    Error { message: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UsageStats {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(default)]
    pub cache_read_input_tokens: u32,
    #[serde(default)]
    pub cache_creation_input_tokens: u32,
}
