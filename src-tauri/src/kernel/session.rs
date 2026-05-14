//! Project-level persistent ipykernel sessions.
//!
//! One [`LocalKernel`] per project slug. The first `cell_execute` for a slug
//! spawns it; subsequent calls reuse it, so variables defined in earlier cells
//! survive into later cells. `kernel_restart` / `kernel_shutdown` drop the old
//! one and (optionally) spawn a fresh one.

use super::local::LocalKernel;
use super::ExecutionResult;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

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
            let k = LocalKernel::spawn(python_path)?;
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
        let k = LocalKernel::spawn(python_path)?;
        self.inner.lock().unwrap().insert(slug.to_string(), k);
        Ok(())
    }
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
