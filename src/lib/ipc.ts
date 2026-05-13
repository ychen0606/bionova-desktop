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

export const ipc = {
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (cfg: AppConfig) => invoke<void>("set_config", { cfg }),
  keychainSet: (key: string, value: string) =>
    invoke<void>("keychain_set", { key, value }),
  keychainGet: (key: string) =>
    invoke<string | null>("keychain_get", { key }),
  keychainDelete: (key: string) =>
    invoke<void>("keychain_delete", { key }),
  providerPing: (args: ProviderArgs, apiKey: string) =>
    invoke<PingResult>("provider_ping", { args, apiKey }),
  pythonProbe: () => invoke<PythonCandidate[]>("python_probe_windows"),
  runSmokeCell: (pythonPath: string, code: string) =>
    invoke<string>("run_smoke_cell", { pythonPath, code }),
};
