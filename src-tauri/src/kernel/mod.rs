use serde::{Deserialize, Serialize};

pub mod local;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "msg_type", content = "content")]
pub enum KernelEvent {
    /// Execution started; counter increments per execute_request.
    ExecuteStart { execution_count: i64 },
    /// stdout / stderr lines.
    Stream { name: String, text: String },
    /// Rich display data (image/png base64, text/html, text/plain).
    DisplayData { mime: String, data: String },
    /// Final return value of cell, if any.
    ExecuteResult { execution_count: i64, repr: String },
    /// Cell raised an exception.
    ExecuteError { ename: String, evalue: String, traceback: Vec<String> },
    /// Cell finished cleanly.
    ExecuteDone { execution_count: i64, status: String },
}
