//! Bridge to a child `python -m ipykernel` process via ZeroMQ.
//!
//! Writes a Jupyter connection file with chosen ports, launches ipykernel
//! pointed at the file, connects ZMQ sockets to the same ports, sends
//! execute_request on the shell socket, fans out events from iopub.

use super::{DisplayItem, ExecutionError, ExecutionResult, KernelEvent};
use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use rand::Rng;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::Sha256;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::Duration;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize)]
struct ConnectionFile {
    transport: String,
    ip: String,
    shell_port: u16,
    iopub_port: u16,
    stdin_port: u16,
    control_port: u16,
    hb_port: u16,
    signature_scheme: String,
    key: String,
    kernel_name: String,
}

pub struct LocalKernel {
    child: Option<Child>,
    _ctx: zmq::Context,
    shell: zmq::Socket,
    _iopub: zmq::Socket,
    session_id: String,
    hmac_key: Vec<u8>,
    exec_count: i64,
    connection_file: std::path::PathBuf,
    /// Live channel of iopub events; collected by `execute_and_collect`.
    pub rx: Receiver<KernelEvent>,
}

impl LocalKernel {
    /// Spawn a fresh ipykernel using the given python interpreter.
    pub fn spawn(python_path: &str) -> Result<Self> {
        let key: String = (0..32)
            .map(|_| rand::thread_rng().gen_range(b'a'..=b'z') as char)
            .collect();
        let session_id = Uuid::new_v4().to_string();

        let shell_port = free_port()?;
        let iopub_port = free_port()?;
        let stdin_port = free_port()?;
        let control_port = free_port()?;
        let hb_port = free_port()?;

        let cf = ConnectionFile {
            transport: "tcp".into(),
            ip: "127.0.0.1".into(),
            shell_port,
            iopub_port,
            stdin_port,
            control_port,
            hb_port,
            signature_scheme: "hmac-sha256".into(),
            key: key.clone(),
            kernel_name: "python3".into(),
        };

        let tmp = std::env::temp_dir().join(format!("bionova-kernel-{}.json", session_id));
        std::fs::write(&tmp, serde_json::to_string_pretty(&cf)?)?;

        let mut cmd = Command::new(python_path);
        cmd.args(["-m", "ipykernel_launcher", "-f", tmp.to_str().unwrap()])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let child = cmd.spawn().context("spawn ipykernel")?;

        let ctx = zmq::Context::new();

        let shell = ctx.socket(zmq::DEALER)?;
        shell.set_identity(format!("bionova-{}", session_id).as_bytes())?;
        shell.connect(&format!("tcp://127.0.0.1:{shell_port}"))?;

        let iopub = ctx.socket(zmq::SUB)?;
        iopub.set_subscribe(b"")?;
        iopub.connect(&format!("tcp://127.0.0.1:{iopub_port}"))?;

        // Settle for kernel readiness + ZMQ SUB slow-joiner propagation.
        // 2s is required on cold CI Windows runners; 300ms can miss first iopub
        // messages on a freshly-bound PUB socket due to the well-known PUB/SUB
        // slow-joiner pattern.
        thread::sleep(Duration::from_secs(2));

        let (tx, rx) = channel::<KernelEvent>();

        // Spawn a second SUB socket for the listener thread (avoid sharing).
        let iopub_listener = ctx.socket(zmq::SUB)?;
        iopub_listener.set_subscribe(b"")?;
        iopub_listener.connect(&format!("tcp://127.0.0.1:{iopub_port}"))?;

        let key_clone = key.as_bytes().to_vec();
        thread::spawn(move || iopub_loop(iopub_listener, key_clone, tx));

        Ok(Self {
            child: Some(child),
            _ctx: ctx,
            shell,
            _iopub: iopub,
            session_id,
            hmac_key: key.into_bytes(),
            exec_count: 0,
            connection_file: tmp,
            rx,
        })
    }

    /// Run user code in this (persistent) kernel and synchronously collect
    /// outputs until the kernel returns to idle, or `timeout` elapses.
    pub fn execute_and_collect(&mut self, code: &str, timeout: Duration) -> Result<ExecutionResult> {
        self.execute(code)?;
        let deadline = std::time::Instant::now() + timeout;
        let mut out = ExecutionResult::default();
        out.execution_count = self.exec_count;
        let mut saw_busy = false;
        let mut saw_idle_after_busy = false;
        while std::time::Instant::now() < deadline && !saw_idle_after_busy {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let poll = std::cmp::min(remaining, Duration::from_millis(200));
            let Ok(ev) = self.rx.recv_timeout(poll) else { continue };
            match ev {
                KernelEvent::Stream { name, text } => {
                    if name == "stderr" {
                        out.stderr.push_str(&text);
                    } else {
                        out.stdout.push_str(&text);
                    }
                }
                KernelEvent::DisplayData { mime, data } => {
                    out.display_data.push(DisplayItem { mime, data });
                }
                KernelEvent::ExecuteResult { execution_count, repr } => {
                    out.execute_result = Some(repr);
                    out.execution_count = execution_count;
                }
                KernelEvent::ExecuteError { ename, evalue, traceback } => {
                    out.error = Some(ExecutionError { ename, evalue, traceback });
                }
                KernelEvent::Status { state } => {
                    if state == "busy" {
                        saw_busy = true;
                    } else if state == "idle" && saw_busy {
                        saw_idle_after_busy = true;
                    }
                }
                _ => {}
            }
        }
        Ok(out)
    }

    /// Send an `execute_request` for the given Python source.
    pub fn execute(&mut self, code: &str) -> Result<()> {
        self.exec_count += 1;
        let msg_id = Uuid::new_v4().to_string();
        let header = json!({
            "msg_id": msg_id,
            "msg_type": "execute_request",
            "username": "bionova",
            "session": self.session_id,
            "date": chrono::Utc::now().to_rfc3339(),
            "version": "5.3",
        });
        let content = json!({
            "code": code,
            "silent": false,
            "store_history": true,
            "user_expressions": {},
            "allow_stdin": false,
            "stop_on_error": true,
        });
        let parent = json!({});
        let metadata = json!({});
        send_signed(&self.shell, &self.hmac_key, &header, &parent, &metadata, &content)?;
        Ok(())
    }

    pub fn shutdown(&mut self) -> Result<()> {
        if let Some(mut ch) = self.child.take() {
            let _ = ch.kill();
            let _ = ch.wait();
        }
        let _ = std::fs::remove_file(&self.connection_file);
        Ok(())
    }
}

impl Drop for LocalKernel {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

/// Suppress the console window that Windows would otherwise pop up for a
/// subprocess whose executable links the console subsystem (python.exe).
/// No-op on Linux/macOS.
#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

fn free_port() -> Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let p = listener.local_addr()?.port();
    drop(listener);
    Ok(p)
}

fn sign(key: &[u8], parts: &[&[u8]]) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac key");
    for p in parts {
        mac.update(p);
    }
    hex::encode(mac.finalize().into_bytes())
}

fn send_signed(
    sock: &zmq::Socket,
    key: &[u8],
    header: &Value,
    parent: &Value,
    metadata: &Value,
    content: &Value,
) -> Result<()> {
    let h = serde_json::to_vec(header)?;
    let p = serde_json::to_vec(parent)?;
    let m = serde_json::to_vec(metadata)?;
    let c = serde_json::to_vec(content)?;
    let sig = sign(key, &[&h, &p, &m, &c]);

    sock.send(&b""[..], zmq::SNDMORE)?;
    sock.send("<IDS|MSG>".as_bytes(), zmq::SNDMORE)?;
    sock.send(sig.as_bytes(), zmq::SNDMORE)?;
    sock.send(&h, zmq::SNDMORE)?;
    sock.send(&p, zmq::SNDMORE)?;
    sock.send(&m, zmq::SNDMORE)?;
    sock.send(&c, 0)?;
    Ok(())
}

fn iopub_loop(sock: zmq::Socket, _key: Vec<u8>, tx: Sender<KernelEvent>) {
    loop {
        let parts: Vec<Vec<u8>> = match sock.recv_multipart(0) {
            Ok(p) => p,
            Err(_) => break,
        };
        let delim = parts.iter().position(|p| p == b"<IDS|MSG>");
        let Some(idx) = delim else { continue };
        if parts.len() < idx + 5 {
            continue;
        }
        let header: Value = match serde_json::from_slice(&parts[idx + 2]) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let content: Value = match serde_json::from_slice(&parts[idx + 5]) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let msg_type = header.get("msg_type").and_then(|s| s.as_str()).unwrap_or("");

        let ev = match msg_type {
            "stream" => Some(KernelEvent::Stream {
                name: content.get("name").and_then(|s| s.as_str()).unwrap_or("").into(),
                text: content.get("text").and_then(|s| s.as_str()).unwrap_or("").into(),
            }),
            "display_data" | "execute_result" => {
                let data = content.get("data").cloned().unwrap_or_default();
                let (mime, payload) = pick_mime(&data);
                if msg_type == "execute_result" {
                    Some(KernelEvent::ExecuteResult {
                        execution_count: content.get("execution_count").and_then(|v| v.as_i64()).unwrap_or(0),
                        repr: payload,
                    })
                } else {
                    Some(KernelEvent::DisplayData { mime, data: payload })
                }
            }
            "status" => content
                .get("execution_state")
                .and_then(|s| s.as_str())
                .map(|s| KernelEvent::Status { state: s.into() }),
            "error" => Some(KernelEvent::ExecuteError {
                ename: content.get("ename").and_then(|s| s.as_str()).unwrap_or("Error").into(),
                evalue: content.get("evalue").and_then(|s| s.as_str()).unwrap_or("").into(),
                traceback: content
                    .get("traceback")
                    .and_then(|t| t.as_array())
                    .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
            }),
            _ => None,
        };

        if let Some(e) = ev {
            if tx.send(e).is_err() {
                break;
            }
        }
    }
}

fn pick_mime(data: &Value) -> (String, String) {
    for k in ["image/png", "text/html", "text/plain"] {
        if let Some(v) = data.get(k) {
            return (k.into(), v.as_str().unwrap_or("").to_string());
        }
    }
    ("text/plain".into(), String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_produces_hex() {
        let s = sign(b"abc", &[b"a", b"b"]);
        assert_eq!(s.len(), 64);
    }

    #[test]
    fn pick_mime_prefers_png() {
        let data = serde_json::json!({"text/plain":"x","image/png":"YWJj"});
        let (m, p) = pick_mime(&data);
        assert_eq!(m, "image/png");
        assert_eq!(p, "YWJj");
    }

    #[test]
    fn free_port_returns_valid_port() {
        let p = free_port().unwrap();
        assert!(p > 1024);
    }

    /// End-to-end ipykernel test — runs only when BIONOVA_E2E_PYTHON is set
    /// to the path of a python with `ipykernel` installed. CI configures this.
    #[test]
    fn execute_hello_world_e2e() {
        let Some(py) = std::env::var("BIONOVA_E2E_PYTHON").ok() else {
            eprintln!("skip: set BIONOVA_E2E_PYTHON to a python with ipykernel installed");
            return;
        };
        let mut k = LocalKernel::spawn(&py).unwrap();
        let out = k.execute_and_collect("print('hello from bionova')", Duration::from_secs(30)).unwrap();
        assert!(out.stdout.contains("hello from bionova"), "stdout was: {:?}", out.stdout);
        assert!(out.error.is_none());
    }

    /// Persistent state across two `execute_and_collect` calls in the same kernel.
    /// Required for B-0 — Plan 2.5.1 project-level kernel.
    #[test]
    fn persistent_state_across_executions_e2e() {
        let Some(py) = std::env::var("BIONOVA_E2E_PYTHON").ok() else {
            eprintln!("skip: set BIONOVA_E2E_PYTHON");
            return;
        };
        let mut k = LocalKernel::spawn(&py).unwrap();
        let _ = k.execute_and_collect("x = 42", Duration::from_secs(30)).unwrap();
        let out2 = k.execute_and_collect("print(x * 2)", Duration::from_secs(30)).unwrap();
        assert!(out2.stdout.contains("84"), "second exec lost state; stdout: {:?}", out2.stdout);
        assert!(out2.error.is_none());
    }
}
