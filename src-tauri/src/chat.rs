//! Per-project chat history (append-only JSONL).
//!
//! One file per project at `~/BioNova/projects/<slug>/chat_history.jsonl`.
//! Each line is a JSON object with `role`, `content`, `ts`, and arbitrary
//! caller-supplied metadata (e.g. token counts). Created empty by
//! `project::create`; we just append / read.

use anyhow::{Context, Result};
use std::io::Write;
use std::path::PathBuf;

pub fn chat_history_path(slug: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir")?;
    Ok(home
        .join("BioNova")
        .join("projects")
        .join(slug)
        .join("chat_history.jsonl"))
}

pub fn append(slug: &str, entry: &serde_json::Value) -> Result<()> {
    let path = chat_history_path(slug)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create parent {}", parent.display()))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("open {}", path.display()))?;
    let line = serde_json::to_string(entry)?;
    writeln!(f, "{}", line)?;
    Ok(())
}

pub fn read_all(slug: &str) -> Result<Vec<serde_json::Value>> {
    let path = chat_history_path(slug)?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Ok(vec![]),
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        let s = line.trim();
        if s.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
            out.push(v);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn with_temp_home<F: FnOnce()>(f: F) {
        // dirs::home_dir reads $HOME on Unix and %USERPROFILE% on Windows.
        // Set both so the test works on both platforms.
        let _g = crate::test_helpers::HOME_GUARD
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let tmp = TempDir::new().unwrap();
        let prev_home = std::env::var_os("HOME");
        let prev_profile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", tmp.path());
        std::env::set_var("USERPROFILE", tmp.path());
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        match prev_profile {
            Some(v) => std::env::set_var("USERPROFILE", v),
            None => std::env::remove_var("USERPROFILE"),
        }
        if let Err(e) = res {
            std::panic::resume_unwind(e);
        }
    }

    #[test]
    fn append_then_read_roundtrip() {
        with_temp_home(|| {
            append("p", &serde_json::json!({"role":"user","content":"hello","ts":"t1"})).unwrap();
            append("p", &serde_json::json!({"role":"assistant","content":"hi","ts":"t2"})).unwrap();
            let all = read_all("p").unwrap();
            assert_eq!(all.len(), 2);
            assert_eq!(all[0]["role"], "user");
            assert_eq!(all[1]["content"], "hi");
        });
    }

    #[test]
    fn read_missing_file_is_empty() {
        with_temp_home(|| {
            let v = read_all("nonexistent").unwrap();
            assert!(v.is_empty());
        });
    }
}
