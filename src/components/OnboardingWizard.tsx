import { useState } from "react";
import { ipc, AIProviderConfig, PythonCandidate } from "../lib/ipc";

type Step = "provider" | "python" | "hpc" | "done";

interface Props {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("provider");
  const [provider, setProvider] = useState<AIProviderConfig>({
    kind: "anthropic",
    base_url: "https://api.anthropic.com",
    default_model: "claude-sonnet-4-6",
  });
  const [apiKey, setApiKey] = useState("");
  const [providerStatus, setProviderStatus] = useState<string>("");
  const [candidates, setCandidates] = useState<PythonCandidate[]>([]);
  const [selectedPython, setSelectedPython] = useState<string>("");
  const [probeStatus, setProbeStatus] = useState<string>("");

  async function testProvider() {
    setProviderStatus("testing...");
    try {
      const res = await ipc.providerPing(
        provider.kind === "anthropic"
          ? {
              kind: "anthropic",
              base_url: provider.base_url,
              model: provider.default_model,
            }
          : {
              kind: "openai-compat",
              base_url: provider.base_url,
              model: provider.default_model,
            },
        apiKey
      );
      setProviderStatus(
        `ok (${res.latency_ms}ms, model: ${res.model_reported ?? "?"})`
      );
    } catch (e) {
      setProviderStatus(`error: ${e}`);
    }
  }

  async function saveProviderAndAdvance() {
    if (!apiKey) {
      setProviderStatus("error: API key required");
      return;
    }
    await ipc.keychainSet(`provider:${provider.kind}:apikey`, apiKey);
    const cfg = await ipc.getConfig();
    cfg.ai_provider = provider;
    await ipc.setConfig(cfg);
    setStep("python");
    setProbeStatus("probing...");
    try {
      const list = await ipc.pythonProbe();
      setCandidates(list);
      const withScanpy = list.find((c) => c.has_scanpy);
      if (withScanpy) setSelectedPython(withScanpy.python_path);
      else if (list.length > 0) setSelectedPython(list[0].python_path);
      setProbeStatus(
        list.length === 0 ? "no python found" : `${list.length} candidate(s)`
      );
    } catch (e) {
      setProbeStatus(`error: ${e}`);
    }
  }

  async function savePythonAndAdvance() {
    if (!selectedPython) {
      setProbeStatus("error: select a python");
      return;
    }
    const cfg = await ipc.getConfig();
    cfg.python_env = { python_path: selectedPython, conda_env_name: null };
    await ipc.setConfig(cfg);
    setStep("hpc");
  }

  async function finish() {
    setStep("done");
    onComplete();
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center"
      data-testid="onboarding"
    >
      <div className="bg-white rounded-lg p-6 w-[640px] max-w-full">
        <div className="text-sm text-slate-500 mb-2">
          Step {["provider", "python", "hpc"].indexOf(step) + 1} of 3
        </div>

        {step === "provider" && (
          <div>
            <h2 className="text-xl font-semibold mb-4">AI Provider</h2>
            <label className="block text-sm mb-1">Kind</label>
            <select
              className="border rounded px-2 py-1 mb-3"
              value={provider.kind}
              onChange={(e) =>
                setProvider({
                  ...provider,
                  kind: e.target.value as AIProviderConfig["kind"],
                })
              }
              data-testid="provider-kind"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai-compat">OpenAI-compatible</option>
            </select>
            <label className="block text-sm mb-1">Base URL</label>
            <input
              className="w-full border rounded px-2 py-1 mb-3"
              value={provider.base_url}
              onChange={(e) =>
                setProvider({ ...provider, base_url: e.target.value })
              }
              data-testid="provider-baseurl"
            />
            <label className="block text-sm mb-1">Default model</label>
            <input
              className="w-full border rounded px-2 py-1 mb-3"
              value={provider.default_model}
              onChange={(e) =>
                setProvider({ ...provider, default_model: e.target.value })
              }
              data-testid="provider-model"
            />
            <label className="block text-sm mb-1">API key</label>
            <input
              type="password"
              className="w-full border rounded px-2 py-1 mb-3"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="provider-apikey"
            />
            <div className="flex gap-2 items-center">
              <button
                className="px-3 py-1 bg-slate-200 rounded"
                onClick={testProvider}
              >
                Test
              </button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded"
                onClick={saveProviderAndAdvance}
                data-testid="provider-next"
              >
                Next
              </button>
              <span
                className="text-sm text-slate-600"
                data-testid="provider-status"
              >
                {providerStatus}
              </span>
            </div>
          </div>
        )}

        {step === "python" && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Python Environment</h2>
            <div className="text-sm mb-2">{probeStatus}</div>
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {candidates.map((c) => (
                <label
                  key={c.python_path}
                  className="block border rounded p-2 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="python"
                    checked={selectedPython === c.python_path}
                    onChange={() => setSelectedPython(c.python_path)}
                    className="mr-2"
                  />
                  <span className="font-mono text-sm">{c.python_path}</span>
                  <div className="text-xs text-slate-500">
                    {c.source} | python {c.version ?? "?"} | scanpy{" "}
                    {c.has_scanpy ? c.scanpy_version : "missing"}
                  </div>
                </label>
              ))}
            </div>
            <button
              className="px-3 py-1 bg-blue-600 text-white rounded"
              onClick={savePythonAndAdvance}
              data-testid="python-next"
            >
              Next
            </button>
          </div>
        )}

        {step === "hpc" && (
          <div>
            <h2 className="text-xl font-semibold mb-4">HPC (optional)</h2>
            <p className="text-sm text-slate-600 mb-4">
              You can add HPC connections later in Settings. Skip for now.
            </p>
            <button
              className="px-3 py-1 bg-blue-600 text-white rounded"
              onClick={finish}
              data-testid="hpc-skip"
            >
              Skip and finish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
