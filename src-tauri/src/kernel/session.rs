//! Project-level persistent ipykernel sessions.
//!
//! One [`LocalKernel`] per project slug. The first `cell_execute` for a slug
//! spawns it; subsequent calls reuse it, so variables defined in earlier cells
//! survive into later cells. `kernel_restart` / `kernel_shutdown` drop the old
//! one and (optionally) spawn a fresh one.

use super::local::LocalKernel;
use super::{ExecutionResult, VarInfo};
use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

/// Per-slug working directory for the kernel. Created on first use so scanpy
/// plots (which save under `./figures/` by default) and any user `open(...)`
/// land inside the project rather than the read-only install dir.
fn project_cwd(slug: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir")?;
    let p = home.join("BioNova").join("projects").join(slug);
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

/// Python snippet that prints a single JSON line listing user-defined
/// globals (filtering imports, dunders, modules, our own helpers). Run via
/// `execute_and_collect`; we then parse the marker line out of stdout.
const INSPECT_VARS_SNIPPET: &str = r#"
def _bionova_inspect_vars():
    import json, types
    _skip_types = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type)
    out = []
    for _k, _v in list(globals().items()):
        if _k.startswith("_"): continue
        if _k in ("In", "Out", "exit", "quit", "get_ipython"): continue
        if isinstance(_v, _skip_types): continue
        info = {"name": _k, "type_name": type(_v).__name__}
        try:
            shp = getattr(_v, "shape", None)
            if shp is not None:
                info["shape"] = [int(s) for s in shp] if hasattr(shp, "__iter__") else [int(shp)]
        except Exception:
            pass
        try:
            dt = getattr(_v, "dtype", None)
            if dt is not None: info["dtype"] = str(dt)
        except Exception:
            pass
        try:
            r = repr(_v)
            info["repr_short"] = r if len(r) < 160 else r[:157] + "..."
        except Exception:
            info["repr_short"] = "<unrepr>"
        out.append(info)
    print("___BIONOVA_VARS___" + json.dumps(out) + "___END___")
_bionova_inspect_vars()
"#;

#[derive(Default)]
pub struct SessionManager {
    inner: Mutex<HashMap<String, LocalKernel>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Execute `code` in the persistent kernel for `slug`, spawning one if
    /// missing. The kernel keeps running after this returns.
    pub fn execute(
        &self,
        slug: &str,
        python_path: &str,
        code: &str,
        timeout: Duration,
    ) -> Result<ExecutionResult> {
        let mut map = self.inner.lock().unwrap();
        if !map.contains_key(slug) {
            let cwd = project_cwd(slug)?;
            let k = LocalKernel::spawn(python_path, Some(&cwd))?;
            map.insert(slug.to_string(), k);
        }
        let k = map.get_mut(slug).expect("inserted above");
        k.execute_and_collect(code, timeout)
    }

    /// True iff a kernel is currently running for this slug.
    pub fn is_running(&self, slug: &str) -> bool {
        self.inner.lock().unwrap().contains_key(slug)
    }

    /// Kill the kernel for `slug` (if any). Idempotent.
    pub fn shutdown(&self, slug: &str) {
        if let Some(mut k) = self.inner.lock().unwrap().remove(slug) {
            let _ = k.shutdown();
        }
    }

    /// Kill the old kernel for `slug` and spawn a fresh one.
    pub fn restart(&self, slug: &str, python_path: &str) -> Result<()> {
        self.shutdown(slug);
        let cwd = project_cwd(slug)?;
        let k = LocalKernel::spawn(python_path, Some(&cwd))?;
        self.inner.lock().unwrap().insert(slug.to_string(), k);
        Ok(())
    }

    /// List user-defined variables currently in the kernel. Returns empty list
    /// if the kernel isn't running yet (no cells executed).
    pub fn inspect_vars(&self, slug: &str) -> Result<Vec<VarInfo>> {
        let mut map = self.inner.lock().unwrap();
        let Some(k) = map.get_mut(slug) else { return Ok(vec![]) };
        let out = k.execute_and_collect(INSPECT_VARS_SNIPPET, Duration::from_secs(15))?;
        if let Some(err) = out.error {
            return Err(anyhow!("inspect failed: {}: {}", err.ename, err.evalue));
        }
        parse_vars_line(&out.stdout)
    }
}

fn parse_vars_line(stdout: &str) -> Result<Vec<VarInfo>> {
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("___BIONOVA_VARS___") {
            let json_part = rest.trim_end_matches("___END___");
            return Ok(serde_json::from_str(json_part).unwrap_or_default());
        }
    }
    Ok(vec![])
}

impl Drop for SessionManager {
    fn drop(&mut self) {
        // Best-effort cleanup so children don't outlive the Tauri app.
        if let Ok(mut map) = self.inner.lock() {
            for (_, mut k) in map.drain() {
                let _ = k.shutdown();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_unknown_slug_is_noop() {
        let mgr = SessionManager::new();
        mgr.shutdown("does-not-exist"); // must not panic
        assert!(!mgr.is_running("does-not-exist"));
    }

    #[test]
    fn is_running_false_initially() {
        let mgr = SessionManager::new();
        assert!(!mgr.is_running("p1"));
    }

    #[test]
    fn inspect_vars_empty_when_no_kernel() {
        let mgr = SessionManager::new();
        let v = mgr.inspect_vars("nope").unwrap();
        assert!(v.is_empty());
    }

    #[test]
    fn parse_vars_line_handles_marker_line() {
        let stdout = "noise\n___BIONOVA_VARS___[{\"name\":\"x\",\"type_name\":\"int\",\"repr_short\":\"42\"}]___END___\nmore noise\n";
        let v = parse_vars_line(stdout).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "x");
    }

    #[test]
    fn parse_vars_line_empty_when_no_marker() {
        let v = parse_vars_line("just regular output\n").unwrap();
        assert!(v.is_empty());
    }

    /// E2E: two execute() calls share state.
    #[test]
    fn persistent_session_e2e() {
        let Some(py) = std::env::var("BIONOVA_E2E_PYTHON").ok() else {
            eprintln!("skip: set BIONOVA_E2E_PYTHON");
            return;
        };
        let mgr = SessionManager::new();
        let _ = mgr.execute("p", &py, "y = 7", Duration::from_secs(30)).unwrap();
        let out = mgr
            .execute("p", &py, "print(y + 3)", Duration::from_secs(30))
            .unwrap();
        assert!(out.stdout.contains("10"), "stdout: {:?}", out.stdout);
        mgr.shutdown("p");
        assert!(!mgr.is_running("p"));
    }

    /// E2E: restart wipes prior state.
    #[test]
    fn restart_wipes_state_e2e() {
        let Some(py) = std::env::var("BIONOVA_E2E_PYTHON").ok() else {
            eprintln!("skip: set BIONOVA_E2E_PYTHON");
            return;
        };
        let mgr = SessionManager::new();
        let _ = mgr.execute("p", &py, "z = 100", Duration::from_secs(30)).unwrap();
        mgr.restart("p", &py).unwrap();
        let out = mgr.execute("p", &py, "print('z' in dir())", Duration::from_secs(30)).unwrap();
        assert!(
            out.stdout.contains("False"),
            "expected z gone after restart; stdout: {:?}",
            out.stdout
        );
    }
}
