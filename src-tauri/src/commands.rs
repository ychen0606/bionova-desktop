use crate::ai_engine::{self, CardSpec, Task};
use crate::chat;
use crate::config::{self, AppConfig};
use crate::kernel::{session::SessionManager, ExecutionResult, VarInfo};
use crate::providers::ChatChunk;
use crate::keychain;
use crate::op_log;
use crate::project::{self, OpenedProject, ProjectSummary};
use crate::providers::{
    anthropic::AnthropicProvider, openai_compat::OpenAICompatProvider, LLMProvider, PingResult,
};
use crate::python_probe::{self, PythonCandidate};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProviderArgs {
    Anthropic { base_url: String, model: String },
    OpenaiCompat { base_url: String, model: String },
}

#[tauri::command]
pub async fn get_config() -> Result<AppConfig, String> {
    let path = config::default_config_path().map_err(|e| e.to_string())?;
    config::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_config(cfg: AppConfig) -> Result<(), String> {
    let path = config::default_config_path().map_err(|e| e.to_string())?;
    config::write(&path, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> Result<(), String> {
    keychain::set_secret(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn keychain_get(key: String) -> Result<Option<String>, String> {
    keychain::get_secret(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> Result<(), String> {
    keychain::delete_secret(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn provider_ping(args: ProviderArgs, api_key: String) -> Result<PingResult, String> {
    let res = match args {
        ProviderArgs::Anthropic { base_url, model } => {
            AnthropicProvider::new(base_url, model).ping(&api_key).await
        }
        ProviderArgs::OpenaiCompat { base_url, model } => {
            OpenAICompatProvider::new(base_url, model).ping(&api_key).await
        }
    };
    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn python_probe_windows() -> Result<Vec<PythonCandidate>, String> {
    python_probe::probe_windows().map_err(|e| e.to_string())
}

/// Legacy one-shot smoke cell: spawns a fresh kernel just for this call.
/// Kept so the Plan 1 smoke screen (`CellExecSmoke`) keeps working without
/// going through project state. Project code paths use `cell_execute` instead.
#[tauri::command]
pub async fn run_smoke_cell(python_path: String, code: String) -> Result<String, String> {
    use crate::kernel::local::LocalKernel;
    use std::time::Duration;

    let mut k = LocalKernel::spawn(&python_path).map_err(|e| e.to_string())?;
    let out = k
        .execute_and_collect(&code, Duration::from_secs(15))
        .map_err(|e| e.to_string())?;
    if let Some(err) = out.error {
        return Err(format!("{}: {}", err.ename, err.evalue));
    }
    Ok(out.stdout)
}

/// Persistent project kernel — execute one cell, reusing the kernel for `slug`.
#[tauri::command]
pub async fn cell_execute(
    mgr: tauri::State<'_, SessionManager>,
    slug: String,
    python_path: String,
    code: String,
    timeout_secs: Option<u64>,
) -> Result<ExecutionResult, String> {
    use std::time::Duration;
    let secs = timeout_secs.unwrap_or(120);
    mgr.execute(&slug, &python_path, &code, Duration::from_secs(secs))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kernel_restart(
    mgr: tauri::State<'_, SessionManager>,
    slug: String,
    python_path: String,
) -> Result<(), String> {
    mgr.restart(&slug, &python_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kernel_shutdown(
    mgr: tauri::State<'_, SessionManager>,
    slug: String,
) -> Result<(), String> {
    mgr.shutdown(&slug);
    Ok(())
}

#[tauri::command]
pub async fn kernel_status(
    mgr: tauri::State<'_, SessionManager>,
    slug: String,
) -> Result<KernelStatus, String> {
    Ok(KernelStatus {
        running: mgr.is_running(&slug),
    })
}

#[tauri::command]
pub async fn kernel_inspect_vars(
    mgr: tauri::State<'_, SessionManager>,
    slug: String,
) -> Result<Vec<VarInfo>, String> {
    mgr.inspect_vars(&slug).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KernelStatus {
    pub running: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiResponse {
    pub text: String,
    pub usage: crate::providers::UsageStats,
    pub error: Option<String>,
}

fn resolve_prompts_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve("resources/prompts", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_plan(
    app: tauri::AppHandle,
    vars: std::collections::HashMap<String, String>,
    max_tokens: Option<u32>,
) -> Result<Vec<CardSpec>, String> {
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let prompts_dir = resolve_prompts_dir(&app)?;
    let resp = ai_engine::run_task(&cfg, &prompts_dir, Task::Plan, vars, max_tokens.unwrap_or(2048))
        .await
        .map_err(|e| e.to_string())?;
    if let Some(err) = resp.error {
        return Err(err);
    }
    ai_engine::parse_plan_response(&resp.text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_generate_code(
    app: tauri::AppHandle,
    vars: std::collections::HashMap<String, String>,
    max_tokens: Option<u32>,
) -> Result<AiResponse, String> {
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let prompts_dir = resolve_prompts_dir(&app)?;
    let resp = ai_engine::run_task(
        &cfg,
        &prompts_dir,
        Task::GenerateCode,
        vars,
        max_tokens.unwrap_or(4096),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(AiResponse {
        text: ai_engine::strip_code_fences(&resp.text),
        usage: resp.usage,
        error: resp.error,
    })
}

#[tauri::command]
pub async fn ai_fix_error(
    app: tauri::AppHandle,
    vars: std::collections::HashMap<String, String>,
    max_tokens: Option<u32>,
) -> Result<AiResponse, String> {
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let prompts_dir = resolve_prompts_dir(&app)?;
    let resp = ai_engine::run_task(
        &cfg,
        &prompts_dir,
        Task::FixError,
        vars,
        max_tokens.unwrap_or(4096),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(AiResponse {
        text: ai_engine::strip_code_fences(&resp.text),
        usage: resp.usage,
        error: resp.error,
    })
}

#[tauri::command]
pub async fn ai_interpret(
    app: tauri::AppHandle,
    vars: std::collections::HashMap<String, String>,
    max_tokens: Option<u32>,
) -> Result<AiResponse, String> {
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let prompts_dir = resolve_prompts_dir(&app)?;
    let resp = ai_engine::run_task(
        &cfg,
        &prompts_dir,
        Task::Interpret,
        vars,
        max_tokens.unwrap_or(512),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(AiResponse { text: resp.text, usage: resp.usage, error: resp.error })
}

#[tauri::command]
pub async fn provider_probe(
    app: tauri::AppHandle,
) -> Result<crate::probe::ProbeReport, String> {
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let prompts_dir = resolve_prompts_dir(&app)?;
    crate::probe::run(&cfg, &prompts_dir).await.map_err(|e| e.to_string())
}

/// Inline rewrite (Cmd+K). Returns the rewritten snippet, fences stripped.
#[tauri::command]
pub async fn ai_rewrite(
    selection: String,
    surrounding: String,
    instruction: String,
    max_tokens: Option<u32>,
) -> Result<AiResponse, String> {
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let resp = ai_engine::run_inline_rewrite(
        &cfg,
        &selection,
        &surrounding,
        &instruction,
        max_tokens.unwrap_or(2048),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(AiResponse {
        text: ai_engine::strip_code_fences(&resp.text),
        usage: resp.usage,
        error: resp.error,
    })
}

#[tauri::command]
pub async fn chat_append(slug: String, entry: serde_json::Value) -> Result<(), String> {
    chat::append(&slug, &entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_read(slug: String) -> Result<Vec<serde_json::Value>, String> {
    chat::read_all(&slug).map_err(|e| e.to_string())
}

/// Streaming chat. Emits one event per chunk on the `ai-chat-chunk-<slug>`
/// channel; UI listens via `listen()`. Returns when stream done.
#[tauri::command]
pub async fn ai_chat_stream(
    app: tauri::AppHandle,
    slug: String,
    vars: std::collections::HashMap<String, String>,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    use tauri::Emitter;
    let cfg = config::read(&config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let prompts_dir = resolve_prompts_dir(&app)?;
    let event_name = format!("ai-chat-chunk-{}", slug);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ChatChunk>();
    let drive = tokio::spawn(async move {
        ai_engine::run_chat_stream(&cfg, &prompts_dir, vars, max_tokens.unwrap_or(2048), tx).await
    });

    while let Some(chunk) = rx.recv().await {
        let _ = app.emit(&event_name, &chunk);
        if matches!(chunk, ChatChunk::Done) {
            break;
        }
    }
    drive.await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_list() -> Result<Vec<ProjectSummary>, String> {
    project::list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_create(display_name: String) -> Result<ProjectSummary, String> {
    project::create(&display_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_open(slug: String) -> Result<OpenedProject, String> {
    project::open(&slug).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_delete(slug: String) -> Result<(), String> {
    project::delete(&slug).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notebook_save(slug: String, notebook_json: serde_json::Value) -> Result<(), String> {
    project::save_notebook(&slug, notebook_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn op_log_append(slug: String, entry: serde_json::Value) -> Result<u64, String> {
    op_log::append(&slug, &entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn op_log_set_head(slug: String, head: u64) -> Result<(), String> {
    op_log::set_head(&slug, head).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn op_log_read(slug: String) -> Result<Vec<serde_json::Value>, String> {
    op_log::read_log(&slug).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn data_list(slug: String) -> Result<Vec<crate::data_inspector::DataFile>, String> {
    let dir = crate::data_inspector::project_data_dir(&slug).map_err(|e| e.to_string())?;
    crate::data_inspector::list_files(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn data_inspect(
    app: tauri::AppHandle,
    slug: String,
    filename: String,
) -> Result<crate::data_inspector::InspectionReport, String> {
    let cfg = crate::config::read(&crate::config::default_config_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let python_path = cfg
        .python_env
        .ok_or("python_env not configured")?
        .python_path;
    let data_dir = crate::data_inspector::project_data_dir(&slug).map_err(|e| e.to_string())?;
    let file_path = data_dir.join(&filename);
    let script_path = app
        .path()
        .resolve("resources/scripts/inspect_data.py", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    crate::data_inspector::inspect_one(&python_path, &script_path, &file_path)
        .map_err(|e| e.to_string())
}
