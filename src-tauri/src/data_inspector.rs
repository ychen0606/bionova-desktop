use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataFile {
    pub name: String,
    pub size_bytes: u64,
    pub modified_unix_secs: u64,
    pub kind_hint: String, // by extension; before deep inspect
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InspectionReport {
    /// JSON object emitted by inspect_data.py (free-form, depends on file kind).
    pub report: serde_json::Value,
}

pub fn list_files(data_dir: &Path) -> Result<Vec<DataFile>> {
    if !data_dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(data_dir).context("read data dir")?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if name.starts_with('.') {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size_bytes = metadata.len();
        let modified_unix_secs = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let kind_hint = classify_by_extension(&name);
        out.push(DataFile {
            name,
            size_bytes,
            modified_unix_secs,
            kind_hint,
        });
    }
    out.sort_by(|a, b| b.modified_unix_secs.cmp(&a.modified_unix_secs));
    Ok(out)
}

fn classify_by_extension(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.ends_with(".h5ad") { return "h5ad".into(); }
    if lower.ends_with(".h5") || lower.ends_with(".hdf5") { return "h5".into(); }
    if lower.ends_with(".mtx") || lower.ends_with(".mtx.gz") { return "mtx".into(); }
    if lower.ends_with(".csv") { return "csv".into(); }
    if lower.ends_with(".tsv") { return "tsv".into(); }
    if lower.ends_with(".loom") { return "loom".into(); }
    if lower.ends_with(".rds") { return "rds".into(); }
    "unknown".into()
}

pub fn inspect_one(
    python_path: &str,
    script_path: &Path,
    file_path: &Path,
) -> Result<InspectionReport> {
    let output = Command::new(python_path)
        .arg(script_path)
        .arg(file_path)
        .output()
        .context("spawn python inspector")?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .context("inspector did not return JSON")?;
    Ok(InspectionReport { report: parsed })
}

pub fn project_data_dir(slug: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir")?;
    let p = home.join("BioNova").join("projects").join(slug).join("data");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn classify_by_extension_recognizes_common_types() {
        assert_eq!(classify_by_extension("pbmc3k.h5ad"), "h5ad");
        assert_eq!(classify_by_extension("CR_OUT.h5"), "h5");
        assert_eq!(classify_by_extension("matrix.mtx"), "mtx");
        assert_eq!(classify_by_extension("matrix.mtx.gz"), "mtx");
        assert_eq!(classify_by_extension("expr.csv"), "csv");
        assert_eq!(classify_by_extension("expr.tsv"), "tsv");
        assert_eq!(classify_by_extension("data.loom"), "loom");
        assert_eq!(classify_by_extension("README.md"), "unknown");
    }

    #[test]
    fn list_files_empty_dir() {
        let dir = TempDir::new().unwrap();
        let files = list_files(dir.path()).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn list_files_skips_dotfiles_and_dirs() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("real.h5ad"), b"x").unwrap();
        std::fs::write(dir.path().join(".hidden"), b"x").unwrap();
        std::fs::create_dir_all(dir.path().join("subdir")).unwrap();
        let files = list_files(dir.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "real.h5ad");
        assert_eq!(files[0].kind_hint, "h5ad");
    }
}
