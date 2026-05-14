use serde::{Deserialize, Serialize};

pub mod local;
pub mod session;

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
    /// Kernel busy/idle transitions (iopub status messages).
    Status { state: String },
}

/// JSON-friendly summary returned by `cell_execute` after the kernel goes idle.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub display_data: Vec<DisplayItem>,
    pub execute_result: Option<String>,
    pub execution_count: i64,
    pub error: Option<ExecutionError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayItem {
    pub mime: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionError {
    pub ename: String,
    pub evalue: String,
    pub traceback: Vec<String>,
}

/// One row of the variable inspector: a user-defined name in the kernel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VarInfo {
    pub name: String,
    pub type_name: String,
    pub shape: Option<Vec<i64>>,
    pub dtype: Option<String>,
    pub repr_short: String,
}
