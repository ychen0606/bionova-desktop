use crate::notebook::Notebook;
use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectSummary {
    pub slug: String,
    pub display_name: String,
    pub last_opened_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenedProject {
    pub slug: String,
    pub notebook: serde_json::Value,
    pub op_log_head: u64,
}

fn projects_root() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir")?;
    let root = home.join("BioNova").join("projects");
    std::fs::create_dir_all(&root)?;
    Ok(root)
}

fn slugify(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn unique_slug(root: &Path, base: &str) -> String {
    let slug = if base.is_empty() {
        "untitled".to_string()
    } else {
        base.to_string()
    };
    if !root.join(&slug).exists() {
        return slug;
    }
    let mut i = 2;
    loop {
        let candidate = format!("{slug}_{i}");
        if !root.join(&candidate).exists() {
            return candidate;
        }
        i += 1;
    }
}

pub fn list() -> Result<Vec<ProjectSummary>> {
    let root = projects_root()?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root).into_iter().flatten().flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let slug = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if slug.is_empty() || slug.starts_with('.') {
            continue;
        }
        let nb_path = p.join("notebook.ipynb");
        let cfg_path = p.join("config.json");
        let (display_name, created_at) = if let Ok(nb) = Notebook::read(&nb_path) {
            let dn = nb.metadata["bionova"]["project"]["display_name"]
                .as_str()
                .unwrap_or(&slug)
                .to_string();
            let ca = nb.metadata["bionova"]["project"]["created_at"]
                .as_str()
                .unwrap_or("")
                .to_string();
            (dn, ca)
        } else {
            (slug.clone(), String::new())
        };
        let last_opened_at = std::fs::read_to_string(&cfg_path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v["last_opened_at"].as_str().map(String::from));
        out.push(ProjectSummary {
            slug,
            display_name,
            last_opened_at,
            created_at,
        });
    }
    out.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    Ok(out)
}

pub fn create(display_name: &str) -> Result<ProjectSummary> {
    let root = projects_root()?;
    let base = slugify(display_name);
    let slug = unique_slug(&root, &base);
    let dir = root.join(&slug);
    std::fs::create_dir_all(&dir)?;
    std::fs::create_dir_all(dir.join("artifacts"))?;

    let now = Utc::now().to_rfc3339();
    let mut nb = Notebook::default();
    nb.metadata["bionova"]["project"] = json!({
        "display_name": display_name,
        "created_at": now,
        "default_kernel": "local",
    });
    let first_card_id = Uuid::new_v4().to_string();
    nb.metadata["bionova"]["cards"] = json!([{
        "id": first_card_id,
        "title": "Untitled card",
        "order": 0,
        "collapsed": false,
        "ai_generated": false
    }]);
    nb.write(&dir.join("notebook.ipynb"))?;

    let cfg = json!({
        "created_at": now,
        "last_opened_at": now,
        "default_kernel": "local"
    });
    std::fs::write(dir.join("config.json"), serde_json::to_string_pretty(&cfg)?)?;
    std::fs::write(dir.join("chat_history.jsonl"), "")?;
    std::fs::write(dir.join("history.jsonl"), "")?;
    std::fs::write(dir.join("history.head"), "0")?;

    Ok(ProjectSummary {
        slug,
        display_name: display_name.to_string(),
        last_opened_at: Some(now.clone()),
        created_at: now,
    })
}

pub fn open(slug: &str) -> Result<OpenedProject> {
    let root = projects_root()?;
    let dir = root.join(slug);
    let nb = Notebook::read_with_recovery(&dir.join("notebook.ipynb"))?;
    let head = std::fs::read_to_string(dir.join("history.head"))
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);

    let cfg_path = dir.join("config.json");
    if let Ok(raw) = std::fs::read_to_string(&cfg_path) {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
            v["last_opened_at"] = json!(Utc::now().to_rfc3339());
            let _ = std::fs::write(&cfg_path, serde_json::to_string_pretty(&v)?);
        }
    }

    Ok(OpenedProject {
        slug: slug.into(),
        notebook: nb.to_json(),
        op_log_head: head,
    })
}

pub fn save_notebook(slug: &str, notebook_json: serde_json::Value) -> Result<()> {
    let root = projects_root()?;
    let dir = root.join(slug);
    let nb = Notebook::from_json(notebook_json)?;
    nb.write(&dir.join("notebook.ipynb"))?;
    Ok(())
}

pub fn delete(slug: &str) -> Result<()> {
    let root = projects_root()?;
    let dir = root.join(slug);
    if !dir.exists() {
        return Ok(());
    }
    let trash = root.parent().unwrap().join(".trash");
    std::fs::create_dir_all(&trash)?;
    let ts = Utc::now().format("%Y%m%dT%H%M%S");
    std::fs::rename(&dir, trash.join(format!("{slug}_{ts}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_temp_home<F: FnOnce()>(f: F) {
        static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _lock = GUARD.lock().unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let prev = std::env::var_os("HOME");
        std::env::set_var("HOME", dir.path());
        f();
        match prev {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
    }

    #[test]
    fn slugify_strips_punctuation() {
        assert_eq!(slugify("Hello, World!"), "hello__world");
        assert_eq!(slugify("PBMC 3k v2"), "pbmc_3k_v2");
        assert_eq!(slugify(""), "");
    }

    #[test]
    fn unique_slug_appends_suffix() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("foo")).unwrap();
        assert_eq!(unique_slug(root, "foo"), "foo_2");
        std::fs::create_dir_all(root.join("foo_2")).unwrap();
        assert_eq!(unique_slug(root, "foo"), "foo_3");
        assert_eq!(unique_slug(root, "bar"), "bar");
    }

    #[test]
    fn create_then_open_roundtrip() {
        with_temp_home(|| {
            let summ = create("My Project").unwrap();
            assert_eq!(summ.display_name, "My Project");
            let opened = open(&summ.slug).unwrap();
            assert_eq!(opened.slug, summ.slug);
            assert_eq!(
                opened.notebook["metadata"]["bionova"]["project"]["display_name"],
                "My Project"
            );
            assert_eq!(
                opened.notebook["metadata"]["bionova"]["cards"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
        });
    }

    #[test]
    fn delete_moves_to_trash() {
        with_temp_home(|| {
            let summ = create("Doomed").unwrap();
            delete(&summ.slug).unwrap();
            assert!(list().unwrap().iter().find(|p| p.slug == summ.slug).is_none());
            let trash = projects_root()
                .unwrap()
                .parent()
                .unwrap()
                .join(".trash");
            assert!(trash.exists());
            let entries: Vec<_> = std::fs::read_dir(&trash).unwrap().collect();
            assert!(!entries.is_empty());
        });
    }
}
