use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Notebook {
    pub metadata: Value,
    pub cells: Vec<Value>,
    pub nbformat: u32,
    pub nbformat_minor: u32,
}

impl Default for Notebook {
    fn default() -> Self {
        Self {
            metadata: json!({
                "kernelspec": { "name": "python3", "display_name": "Python 3" },
                "language_info": { "name": "python" },
                "bionova": {
                    "schema_version": 1,
                    "project": {},
                    "cards": []
                }
            }),
            cells: vec![],
            nbformat: 4,
            nbformat_minor: 5,
        }
    }
}

impl Notebook {
    pub fn from_json(v: Value) -> Result<Self> {
        let metadata = v.get("metadata").cloned().unwrap_or_else(|| json!({}));
        let cells = v
            .get("cells")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        let nbformat = v.get("nbformat").and_then(|n| n.as_u64()).unwrap_or(4) as u32;
        let nbformat_minor = v.get("nbformat_minor").and_then(|n| n.as_u64()).unwrap_or(5) as u32;
        Ok(Self {
            metadata,
            cells,
            nbformat,
            nbformat_minor,
        })
    }

    pub fn to_json(&self) -> Value {
        json!({
            "metadata": self.metadata,
            "cells": self.cells,
            "nbformat": self.nbformat,
            "nbformat_minor": self.nbformat_minor,
        })
    }

    pub fn read(path: &Path) -> Result<Self> {
        let raw =
            std::fs::read_to_string(path).with_context(|| format!("read {:?}", path))?;
        let v: Value = serde_json::from_str(&raw)
            .with_context(|| format!("parse {:?}", path))?;
        Self::from_json(v)
    }

    /// Atomic double-buffer write: tmp -> rename current to .bak -> rename tmp to current.
    pub fn write(&self, path: &Path) -> Result<()> {
        let json_str = serde_json::to_string_pretty(&self.to_json())?;
        let tmp = path.with_extension("ipynb.tmp");
        let bak = path.with_extension("ipynb.bak");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&tmp, json_str)?;
        if path.exists() {
            let _ = std::fs::rename(path, &bak);
        }
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Read with .bak fallback for crash recovery.
    pub fn read_with_recovery(path: &Path) -> Result<Self> {
        match Self::read(path) {
            Ok(nb) => Ok(nb),
            Err(_) => {
                let bak = path.with_extension("ipynb.bak");
                Self::read(&bak).context("primary ipynb corrupt and .bak also unusable")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_has_bionova_metadata() {
        let nb = Notebook::default();
        assert_eq!(nb.metadata["bionova"]["schema_version"], 1);
        assert!(nb.cells.is_empty());
        assert_eq!(nb.nbformat, 4);
    }

    #[test]
    fn roundtrip_preserves_unknown_metadata() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("test.ipynb");
        let mut nb = Notebook::default();
        nb.metadata["unknown_field"] = json!("preserve_me");
        nb.cells.push(json!({
            "cell_type": "code",
            "source": ["print(1+1)"],
            "metadata": { "bionova": { "card_id": "abc" } },
            "outputs": [],
            "execution_count": null
        }));
        nb.write(&p).unwrap();
        let back = Notebook::read(&p).unwrap();
        assert_eq!(back.metadata["unknown_field"], "preserve_me");
        assert_eq!(back.cells.len(), 1);
    }

    #[test]
    fn write_creates_bak_on_second_write() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("nb.ipynb");
        let mut nb = Notebook::default();
        nb.write(&p).unwrap();
        nb.cells.push(json!({
            "cell_type": "code",
            "source": [""],
            "metadata": {},
            "outputs": [],
            "execution_count": null
        }));
        nb.write(&p).unwrap();
        let bak = p.with_extension("ipynb.bak");
        assert!(bak.exists());
    }

    #[test]
    fn recovery_falls_back_to_bak() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("nb.ipynb");
        let nb = Notebook::default();
        nb.write(&p).unwrap();
        nb.write(&p).unwrap();
        std::fs::write(&p, "{not json").unwrap();
        let recovered = Notebook::read_with_recovery(&p).unwrap();
        assert_eq!(recovered.nbformat, 4);
    }
}
