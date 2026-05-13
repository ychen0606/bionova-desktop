import { useState } from "react";
import { ipc } from "../lib/ipc";

interface Props {
  onBack: () => void;
}

export function CellExecSmoke({ onBack }: Props) {
  const [code, setCode] = useState("print('hello from BioNova')");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    setOutput("");
    try {
      const cfg = await ipc.getConfig();
      if (!cfg.python_env) throw new Error("python env not configured");
      const out = await ipc.runSmokeCell(cfg.python_env.python_path, code);
      setOutput(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl" data-testid="smoke">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Smoke Test</h2>
        <button
          className="px-3 py-1 bg-slate-200 rounded"
          onClick={onBack}
        >
          Back
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-3">
        Validates that BioNova can spawn a Python kernel and execute a cell
        end-to-end.
      </p>
      <textarea
        className="w-full border rounded p-2 font-mono text-sm mb-2"
        rows={4}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        data-testid="smoke-code"
      />
      <button
        className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
        onClick={run}
        disabled={running}
        data-testid="smoke-run"
      >
        {running ? "running..." : "Run"}
      </button>
      <pre
        className="mt-4 bg-slate-100 p-3 rounded text-sm whitespace-pre-wrap"
        data-testid="smoke-output"
      >
        {output}
      </pre>
      {error && (
        <div className="mt-2 text-red-600 text-sm" data-testid="smoke-error">
          {error}
        </div>
      )}
    </div>
  );
}
