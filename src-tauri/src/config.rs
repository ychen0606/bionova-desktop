use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    #[serde(default)]
    pub ai_provider: Option<AIProviderConfig>,
    #[serde(default)]
    pub python_env: Option<PythonEnvConfig>,
    #[serde(default)]
    pub hpcs: Vec<HpcConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AIProviderConfig {
    pub kind: String,
    pub base_url: String,
    pub default_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PythonEnvConfig {
    pub python_path: String,
    pub conda_env_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HpcConfig {
    pub name: String,
    pub host: String,
    pub user: String,
    pub auth: HpcAuthKind,
    pub sbatch_template: String,
    pub default_partition: String,
    pub default_time: String,
    pub default_mem: String,
    pub default_cpus: u32,
    pub conda_init_path: String,
    pub conda_env_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HpcAuthKind {
    Password,
    SshKey { path: String },
}

pub fn default_config_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("cannot resolve home directory")?;
    Ok(home.join("BioNova").join("config.json"))
}

pub fn read(path: &PathBuf) -> Result<AppConfig> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path).with_context(|| format!("read {:?}", path))?;
    let cfg = serde_json::from_str(&raw).with_context(|| format!("parse {:?}", path))?;
    Ok(cfg)
}

pub fn write(path: &PathBuf, cfg: &AppConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {:?}", parent))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(cfg)?;
    fs::write(&tmp, json).with_context(|| format!("write {:?}", tmp))?;
    fs::rename(&tmp, path).with_context(|| format!("rename {:?} -> {:?}", tmp, path))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn reads_missing_file_as_default() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("config.json");
        let cfg = read(&p).unwrap();
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn writes_and_reads_back() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("config.json");
        let cfg = AppConfig {
            ai_provider: Some(AIProviderConfig {
                kind: "anthropic".into(),
                base_url: "https://api.anthropic.com".into(),
                default_model: "claude-sonnet-4-6".into(),
            }),
            python_env: None,
            hpcs: vec![],
        };
        write(&p, &cfg).unwrap();
        let back = read(&p).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn write_is_atomic_no_tmp_leftover() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("config.json");
        write(&p, &AppConfig::default()).unwrap();
        let tmp = p.with_extension("json.tmp");
        assert!(!tmp.exists(), "tmp file should be renamed away");
        assert!(p.exists());
    }
}
