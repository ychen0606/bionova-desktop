import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  ai_provider: AIProviderConfig | null;
  python_env: PythonEnvConfig | null;
  hpcs: HpcConfig[];
}

export interface AIProviderConfig {
  kind: "anthropic" | "openai-compat";
  base_url: string;
  default_model: string;
}

export interface PythonEnvConfig {
  python_path: string;
  conda_env_name: string | null;
}

export interface HpcConfig {
  name: string;
  host: string;
  user: string;
  auth: { Password: null } | { SshKey: { path: string } };
  sbatch_template: string;
  default_partition: string;
  default_time: string;
  default_mem: string;
  default_cpus: number;
  conda_init_path: string;
  conda_env_name: string;
}

export interface PythonCandidate {
  python_path: string;
  source: string;
  version: string | null;
  has_scanpy: boolean;
  scanpy_version: string | null;
}

export interface PingResult {
  ok: boolean;
  model_reported: string | null;
  latency_ms: number;
}

export type ProviderArgs =
  | { kind: "anthropic"; base_url: string; model: string }
  | { kind: "openai-compat"; base_url: string; model: string };

// --- Plan 2 additions ---

export interface ProjectSummary {
  slug: string;
  display_name: string;
  last_opened_at: string | null;
  created_at: string;
}

export interface OpenedProject {
  slug: string;
  notebook: NotebookJson;
  op_log_head: number;
}

export interface CardMeta {
  id: string;
  title: string;
  order: number;
  collapsed: boolean;
  ai_generated: boolean;
}

export interface BionovaMeta {
  schema_version: number;
  project: { display_name: string; created_at: string; default_kernel: string };
  cards: CardMeta[];
}

export interface CellJson {
  cell_type: "code" | "markdown";
  source: string | string[];
  outputs: any[];
  execution_count: number | null;
  metadata: {
    bionova?: { card_id: string; target_kernel?: string; ai_generated?: boolean };
    bionova_cell_id?: string;
    [k: string]: any;
  };
}

export interface NotebookJson {
  metadata: { bionova: BionovaMeta; [k: string]: any };
  cells: CellJson[];
  nbformat: number;
  nbformat_minor: number;
}

export type OpEntry = {
  op: string;
  fwd: any;
  rev: any;
  seq?: number;
  ts?: string;
};

export const ipc = {
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (cfg: AppConfig) => invoke<void>("set_config", { cfg }),
  keychainSet: (key: string, value: string) =>
    invoke<void>("keychain_set", { key, value }),
  keychainGet: (key: string) => invoke<string | null>("keychain_get", { key }),
  keychainDelete: (key: string) => invoke<void>("keychain_delete", { key }),
  providerPing: (args: ProviderArgs, apiKey: string) =>
    invoke<PingResult>("provider_ping", { args, apiKey }),
  pythonProbe: () => invoke<PythonCandidate[]>("python_probe_windows"),
  runSmokeCell: (pythonPath: string, code: string) =>
    invoke<string>("run_smoke_cell", { pythonPath, code }),
};

export interface DisplayItem {
  mime: string;
  data: string;
}

export interface ExecutionError {
  ename: string;
  evalue: string;
  traceback: string[];
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  display_data: DisplayItem[];
  execute_result: string | null;
  execution_count: number;
  error: ExecutionError | null;
}

export interface KernelStatus {
  running: boolean;
}

export interface VarInfo {
  name: string;
  type_name: string;
  shape: number[] | null;
  dtype: string | null;
  repr_short: string;
}

export const ipcKernel = {
  execute: (slug: string, pythonPath: string, code: string, timeoutSecs?: number) =>
    invoke<ExecutionResult>("cell_execute", {
      slug,
      pythonPath,
      code,
      timeoutSecs: timeoutSecs ?? null,
    }),
  restart: (slug: string, pythonPath: string) =>
    invoke<void>("kernel_restart", { slug, pythonPath }),
  shutdown: (slug: string) => invoke<void>("kernel_shutdown", { slug }),
  status: (slug: string) => invoke<KernelStatus>("kernel_status", { slug }),
  inspectVars: (slug: string) => invoke<VarInfo[]>("kernel_inspect_vars", { slug }),
};

export interface DataFile {
  name: string;
  size_bytes: number;
  modified_unix_secs: number;
  kind_hint: string;
}

export interface InspectionReport {
  report: any; // free-form JSON from inspect_data.py
}

export const ipcData = {
  list: (slug: string) => invoke<DataFile[]>("data_list", { slug }),
  inspect: (slug: string, filename: string) =>
    invoke<InspectionReport>("data_inspect", { slug, filename }),
};

// --- Plan 3 AI engine ---

export interface CardSpec {
  id: string;
  title: string;
  rationale: string;
}

export interface AIUsageStats {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface AiResponse {
  text: string;
  usage: AIUsageStats;
  error: string | null;
}

export type ChatChunk =
  | { kind: "text"; text: string }
  | { kind: "usage"; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

import { listen, UnlistenFn } from "@tauri-apps/api/event";

export const ipcAI = {
  plan: (vars: Record<string, string>, maxTokens?: number) =>
    invoke<CardSpec[]>("ai_plan", { vars, maxTokens: maxTokens ?? null }),
  generateCode: (vars: Record<string, string>, maxTokens?: number) =>
    invoke<AiResponse>("ai_generate_code", { vars, maxTokens: maxTokens ?? null }),
  fixError: (vars: Record<string, string>, maxTokens?: number) =>
    invoke<AiResponse>("ai_fix_error", { vars, maxTokens: maxTokens ?? null }),
  interpret: (vars: Record<string, string>, maxTokens?: number) =>
    invoke<AiResponse>("ai_interpret", { vars, maxTokens: maxTokens ?? null }),
  /// Start a streaming chat. Returns an unlisten function — caller MUST
  /// invoke it after the stream ends (after Done) to avoid leaking listeners.
  chatStream: async (
    slug: string,
    vars: Record<string, string>,
    onChunk: (c: ChatChunk) => void,
    maxTokens?: number
  ): Promise<UnlistenFn> => {
    const unlisten = await listen<ChatChunk>(`ai-chat-chunk-${slug}`, (e) => onChunk(e.payload));
    invoke<void>("ai_chat_stream", { slug, vars, maxTokens: maxTokens ?? null }).catch((err) => {
      onChunk({ kind: "error", message: String(err) });
      onChunk({ kind: "done" });
    });
    return unlisten;
  },
};

export const ipcProject = {
  list: () => invoke<ProjectSummary[]>("project_list"),
  create: (display_name: string) =>
    invoke<ProjectSummary>("project_create", { displayName: display_name }),
  open: (slug: string) => invoke<OpenedProject>("project_open", { slug }),
  delete: (slug: string) => invoke<void>("project_delete", { slug }),
  save: (slug: string, notebook_json: NotebookJson) =>
    invoke<void>("notebook_save", { slug, notebookJson: notebook_json }),
  opAppend: (slug: string, entry: OpEntry) =>
    invoke<number>("op_log_append", { slug, entry }),
  opSetHead: (slug: string, head: number) =>
    invoke<void>("op_log_set_head", { slug, head }),
  opRead: (slug: string) => invoke<OpEntry[]>("op_log_read", { slug }),
};
