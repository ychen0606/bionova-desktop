//! Orchestrates the 5 AI tasks: plan / generate_code / fix_error / interpret / chat.
//!
//! Each method loads a prompt template, renders it with caller-provided vars,
//! invokes the configured provider's `chat_stream`, and collects either the
//! full text (plan/generate/fix/interpret are non-streaming-to-frontend) or
//! forwards chunks (chat).
//!
//! Provider selection comes from the AppConfig at call time so the same
//! orchestrator works for both Anthropic and OpenAI-compat.

use crate::config::AppConfig;
use crate::keychain;
use crate::prompts;
use crate::providers::{
    anthropic::AnthropicProvider, openai_compat::OpenAICompatProvider, ChatChunk, ChatMessage,
    ChatOpts, LLMProvider,
};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::mpsc::{self, UnboundedSender};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardSpec {
    pub id: String,
    pub title: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedResult {
    pub text: String,
    pub usage: crate::providers::UsageStats,
    pub error: Option<String>,
}

/// Which prompt template to use; influences model picking and JSON parsing.
#[derive(Debug, Clone, Copy)]
pub enum Task {
    Plan,
    GenerateCode,
    FixError,
    Interpret,
    Chat,
}

impl Task {
    fn template_name(&self) -> &'static str {
        match self {
            Task::Plan => "plan",
            Task::GenerateCode => "generate_code",
            Task::FixError => "fix_error",
            Task::Interpret => "interpret",
            Task::Chat => "chat",
        }
    }
}

/// Pick the default model for the given task on the given provider, honoring
/// the user-curated "sonnet + opus only" decision. Caller may override.
pub fn default_model_for(provider_kind: &str, task: Task, attempt: u32) -> String {
    if provider_kind == "anthropic" {
        match task {
            Task::FixError if attempt >= 4 => "claude-opus-4-7".into(),
            Task::Plan | Task::GenerateCode | Task::FixError | Task::Interpret | Task::Chat => {
                "claude-sonnet-4-6".into()
            }
        }
    } else {
        // OpenAI-compat: rely on the config's default_model unless caller
        // overrides. Returning "" signals the caller to use config default.
        String::new()
    }
}

/// Run a single non-streaming task and return the concatenated text.
pub async fn run_task(
    cfg: &AppConfig,
    bundled_prompts_dir: &PathBuf,
    task: Task,
    vars: HashMap<String, String>,
    max_tokens: u32,
) -> Result<AggregatedResult> {
    let template = prompts::load(task.template_name(), bundled_prompts_dir)?;
    let messages = template.render(&vars);
    let (provider, model_default) = build_provider(cfg, task, 0)?;
    let api_key = read_api_key(cfg)?;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let opts = ChatOpts {
        model: model_default,
        max_tokens,
        temperature: 0.2,
        system: extract_system(&messages),
    };
    let messages_no_system: Vec<ChatMessage> =
        messages.into_iter().filter(|m| m.role != "system").collect();

    provider
        .chat_stream(&api_key, messages_no_system, opts, tx)
        .await?;

    let mut text = String::new();
    let mut usage = crate::providers::UsageStats::default();
    let mut err: Option<String> = None;
    while let Some(c) = rx.recv().await {
        match c {
            ChatChunk::Text { text: t } => text.push_str(&t),
            ChatChunk::Usage(u) => usage = u,
            ChatChunk::Error { message } => err = Some(message),
            ChatChunk::Done => break,
        }
    }
    Ok(AggregatedResult { text, usage, error: err })
}

/// Streaming variant for chat — forwards `ChatChunk`s on the channel as they
/// arrive so the UI sees tokens in real time.
pub async fn run_chat_stream(
    cfg: &AppConfig,
    bundled_prompts_dir: &PathBuf,
    vars: HashMap<String, String>,
    max_tokens: u32,
    out_tx: UnboundedSender<ChatChunk>,
) -> Result<()> {
    let template = prompts::load("chat", bundled_prompts_dir)?;
    let messages = template.render(&vars);
    let (provider, model_default) = build_provider(cfg, Task::Chat, 0)?;
    let api_key = read_api_key(cfg)?;

    let opts = ChatOpts {
        model: model_default,
        max_tokens,
        temperature: 0.4,
        system: extract_system(&messages),
    };
    let messages_no_system: Vec<ChatMessage> =
        messages.into_iter().filter(|m| m.role != "system").collect();

    provider
        .chat_stream(&api_key, messages_no_system, opts, out_tx)
        .await
}

fn extract_system(messages: &[ChatMessage]) -> Option<String> {
    messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone())
}

fn build_provider(cfg: &AppConfig, task: Task, attempt: u32) -> Result<(Box<dyn LLMProvider>, String)> {
    let p = cfg
        .ai_provider
        .as_ref()
        .ok_or_else(|| anyhow!("AI provider not configured"))?;
    match p.kind.as_str() {
        "anthropic" => {
            let m = default_model_for("anthropic", task, attempt);
            let model = if m.is_empty() { p.default_model.clone() } else { m };
            let prov = AnthropicProvider::new(p.base_url.clone(), model.clone());
            Ok((Box::new(prov), model))
        }
        "openai-compat" => {
            let prov = OpenAICompatProvider::new(p.base_url.clone(), p.default_model.clone());
            Ok((Box::new(prov), p.default_model.clone()))
        }
        other => Err(anyhow!("unknown provider kind: {other}")),
    }
}

fn read_api_key(cfg: &AppConfig) -> Result<String> {
    // OnboardingWizard saves the key as `provider:<kind>:apikey`.
    let key = cfg
        .ai_provider
        .as_ref()
        .map(|p| format!("provider:{}:apikey", p.kind))
        .ok_or_else(|| anyhow!("no provider configured"))?;
    keychain::get_secret(&key)?
        .ok_or_else(|| anyhow!("API key for {key} not found in keychain"))
}

/// Parse the JSON array returned by `plan`. Strips accidental code fences
/// if the model added them despite instructions.
pub fn parse_plan_response(text: &str) -> Result<Vec<CardSpec>> {
    let trimmed = text.trim();
    let stripped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(|s| s.trim())
        .map(|s| s.trim_end_matches("```"))
        .unwrap_or(trimmed);
    serde_json::from_str::<Vec<CardSpec>>(stripped)
        .with_context(|| format!("plan response is not a JSON array of cards. Raw: {trimmed}"))
}

/// Strip accidental fences from a code response.
pub fn strip_code_fences(text: &str) -> String {
    let t = text.trim();
    let body = t
        .strip_prefix("```python")
        .or_else(|| t.strip_prefix("```py"))
        .or_else(|| t.strip_prefix("```"))
        .map(|s| s.trim_start_matches('\n'))
        .map(|s| s.trim_end_matches("```").trim_end())
        .unwrap_or(t);
    body.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_plan_response_accepts_clean_json() {
        let resp = r#"[{"id":"qc","title":"质控","rationale":"过滤低质量细胞"}]"#;
        let cards = parse_plan_response(resp).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].id, "qc");
    }

    #[test]
    fn parse_plan_response_strips_fences() {
        let resp = "```json\n[{\"id\":\"qc\",\"title\":\"质控\",\"rationale\":\"x\"}]\n```";
        let cards = parse_plan_response(resp).unwrap();
        assert_eq!(cards.len(), 1);
    }

    #[test]
    fn strip_code_fences_handles_python_block() {
        assert_eq!(strip_code_fences("```python\nimport scanpy as sc\n```"), "import scanpy as sc");
        assert_eq!(strip_code_fences("plain code\n"), "plain code");
    }

    #[test]
    fn default_model_for_anthropic_fix_escalates_at_round_4() {
        assert_eq!(default_model_for("anthropic", Task::FixError, 0), "claude-sonnet-4-6");
        assert_eq!(default_model_for("anthropic", Task::FixError, 3), "claude-sonnet-4-6");
        assert_eq!(default_model_for("anthropic", Task::FixError, 4), "claude-opus-4-7");
        assert_eq!(default_model_for("anthropic", Task::FixError, 5), "claude-opus-4-7");
    }
}

