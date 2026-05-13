use crate::config::{self, AppConfig};
use crate::keychain;
use crate::providers::{
    anthropic::AnthropicProvider, openai_compat::OpenAICompatProvider, LLMProvider, PingResult,
};
use crate::python_probe::{self, PythonCandidate};
use serde::{Deserialize, Serialize};

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

/// Single-cell smoke execution. Spawns a fresh ipykernel for this single cell,
/// returns concatenated stdout text after up to 10 s, or an error.
#[tauri::command]
pub async fn run_smoke_cell(python_path: String, code: String) -> Result<String, String> {
    use crate::kernel::{local::LocalKernel, KernelEvent};
    use std::time::Duration;

    let (mut k, rx) = LocalKernel::spawn(&python_path).map_err(|e| e.to_string())?;
    k.execute(&code).map_err(|e| e.to_string())?;
    let mut buf = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        if let Ok(ev) = rx.recv_timeout(Duration::from_millis(200)) {
            match ev {
                KernelEvent::Stream { text, .. } => buf.push_str(&text),
                KernelEvent::ExecuteError { ename, evalue, .. } => {
                    return Err(format!("{ename}: {evalue}"));
                }
                _ => {}
            }
        }
        if !buf.is_empty() && buf.ends_with('\n') {
            break;
        }
    }
    Ok(buf)
}
