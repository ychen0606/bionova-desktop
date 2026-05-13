use anyhow::{Context, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PythonCandidate {
    pub python_path: String,
    pub source: String,
    pub version: Option<String>,
    pub has_scanpy: bool,
    pub scanpy_version: Option<String>,
}

/// Returns ordered list of candidate Python interpreters, best-first.
/// Windows-specific paths; on other OSes only a PATH-based fallback fires.
pub fn probe_windows() -> Result<Vec<PythonCandidate>> {
    let mut out = Vec::new();
    let home = dirs::home_dir().context("home_dir")?;
    let local_app_data = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData/Local"));

    // %USERPROFILE%\Anaconda3 / Miniconda3
    add_if_exists(&mut out, home.join("Anaconda3").join("python.exe"), "anaconda3");
    add_if_exists(&mut out, home.join("miniconda3").join("python.exe"), "miniconda3");
    add_if_exists(&mut out, home.join("Miniconda3").join("python.exe"), "miniconda3");

    // C:\ProgramData\Anaconda3 / Miniconda3
    add_if_exists(&mut out, PathBuf::from(r"C:\ProgramData\Anaconda3\python.exe"), "anaconda3");
    add_if_exists(&mut out, PathBuf::from(r"C:\ProgramData\Miniconda3\python.exe"), "miniconda3");

    // Microsoft Store Python (best-effort glob)
    let store_root = local_app_data.join("Microsoft").join("WindowsApps");
    if store_root.exists() {
        for entry in std::fs::read_dir(&store_root).into_iter().flatten().flatten() {
            let p = entry.path();
            if p.file_name()
                .and_then(|f| f.to_str())
                .is_some_and(|n| n.starts_with("python") && n.ends_with(".exe"))
            {
                add_if_exists(&mut out, p, "store");
            }
        }
    }

    // System python on PATH
    if let Ok(out_path) = which_python() {
        if !out.iter().any(|c| c.python_path == out_path) {
            add_if_exists(&mut out, PathBuf::from(out_path), "system");
        }
    }

    // Probe each: version + scanpy
    for c in out.iter_mut() {
        c.version = python_version(&c.python_path).ok();
        if let Ok((has, ver)) = check_scanpy(&c.python_path) {
            c.has_scanpy = has;
            c.scanpy_version = ver;
        }
    }

    Ok(out)
}

fn add_if_exists(list: &mut Vec<PythonCandidate>, p: PathBuf, source: &str) {
    if p.exists() {
        list.push(PythonCandidate {
            python_path: p.to_string_lossy().into_owned(),
            source: source.into(),
            version: None,
            has_scanpy: false,
            scanpy_version: None,
        });
    }
}

#[cfg(target_os = "windows")]
fn which_python() -> Result<String> {
    let out = Command::new("where").arg("python").output().context("spawn where")?;
    if !out.status.success() {
        anyhow::bail!("where python failed");
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let first = s.lines().next().ok_or_else(|| anyhow::anyhow!("no python on PATH"))?;
    Ok(first.trim().to_string())
}

#[cfg(not(target_os = "windows"))]
fn which_python() -> Result<String> {
    let out = Command::new("which").arg("python3").output().context("spawn which")?;
    if !out.status.success() {
        anyhow::bail!("which python3 failed");
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn python_version(path: &str) -> Result<String> {
    let out = Command::new(path)
        .args(["-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"])
        .output()?;
    if !out.status.success() {
        anyhow::bail!("python version probe failed");
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn check_scanpy(path: &str) -> Result<(bool, Option<String>)> {
    let out = Command::new(path)
        .args(["-c", "import scanpy; print(scanpy.__version__)"])
        .output()?;
    if out.status.success() {
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok((true, Some(v)))
    } else {
        Ok((false, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_if_exists_skips_missing() {
        let mut v = Vec::new();
        add_if_exists(&mut v, PathBuf::from("C:/definitely/does/not/exist/python.exe"), "test");
        assert!(v.is_empty());
    }

    #[test]
    fn add_if_exists_adds_existing_self() {
        let me = std::env::current_exe().unwrap();
        let mut v = Vec::new();
        add_if_exists(&mut v, me.clone(), "test");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].source, "test");
    }

    // probe_windows() is an integration-ish probe — touches real FS + PATH.
    // Exercised manually via Tauri command during dev.
}
