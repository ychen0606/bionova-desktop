use anyhow::{Context, Result};
use std::io::Write;
use std::path::PathBuf;

fn project_dir(slug: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir")?;
    let p = home.join("BioNova").join("projects").join(slug);
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn append(slug: &str, entry: &serde_json::Value) -> Result<u64> {
    let dir = project_dir(slug)?;
    let head_path = dir.join("history.head");
    let current_head = read_head(&head_path)?;

    // Truncate forward redo entries (anything past current head is stale)
    truncate_after(slug, current_head)?;

    let log = dir.join("history.jsonl");
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)?;
    let mut entry = entry.clone();
    let new_seq = current_head + 1;
    entry["seq"] = serde_json::json!(new_seq);
    writeln!(f, "{}", serde_json::to_string(&entry)?)?;
    write_head(&head_path, new_seq)?;
    Ok(new_seq)
}

pub fn truncate_after(slug: &str, head: u64) -> Result<()> {
    let dir = project_dir(slug)?;
    let log = dir.join("history.jsonl");
    if !log.exists() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(&log)?;
    let mut kept: Vec<String> = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(line)?;
        let seq = v["seq"].as_u64().unwrap_or(0);
        if seq <= head {
            kept.push(line.to_string());
        }
    }
    let new = kept.join("\n");
    std::fs::write(
        &log,
        if new.is_empty() {
            String::new()
        } else {
            format!("{new}\n")
        },
    )?;
    write_head(&dir.join("history.head"), head)?;
    Ok(())
}

pub fn read_log(slug: &str) -> Result<Vec<serde_json::Value>> {
    let dir = project_dir(slug)?;
    let log = dir.join("history.jsonl");
    if !log.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&log)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        out.push(serde_json::from_str(line)?);
    }
    Ok(out)
}

pub fn read_head(path: &std::path::Path) -> Result<u64> {
    if !path.exists() {
        return Ok(0);
    }
    let s = std::fs::read_to_string(path)?;
    Ok(s.trim().parse().unwrap_or(0))
}

pub fn write_head(path: &std::path::Path, v: u64) -> Result<()> {
    std::fs::write(path, v.to_string())?;
    Ok(())
}

pub fn set_head(slug: &str, head: u64) -> Result<()> {
    let dir = project_dir(slug)?;
    write_head(&dir.join("history.head"), head)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
    fn append_increments_head() {
        with_temp_home(|| {
            let s1 = append("p", &json!({"op":"a","fwd":{},"rev":{}})).unwrap();
            assert_eq!(s1, 1);
            let s2 = append("p", &json!({"op":"b","fwd":{},"rev":{}})).unwrap();
            assert_eq!(s2, 2);
            let log = read_log("p").unwrap();
            assert_eq!(log.len(), 2);
            assert_eq!(log[0]["seq"], 1);
            assert_eq!(log[1]["seq"], 2);
        });
    }

    #[test]
    fn truncate_after_drops_later_entries() {
        with_temp_home(|| {
            append("p", &json!({"op":"a","fwd":{},"rev":{}})).unwrap();
            append("p", &json!({"op":"b","fwd":{},"rev":{}})).unwrap();
            append("p", &json!({"op":"c","fwd":{},"rev":{}})).unwrap();
            set_head("p", 1).unwrap();
            let s = append("p", &json!({"op":"d","fwd":{},"rev":{}})).unwrap();
            assert_eq!(s, 2);
            let log = read_log("p").unwrap();
            assert_eq!(log.len(), 2);
            assert_eq!(log[1]["op"], "d");
        });
    }
}
