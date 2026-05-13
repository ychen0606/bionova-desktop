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
