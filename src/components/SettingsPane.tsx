import { useEffect, useState } from "react";
import { ipc, ipcAI, AppConfig, ProbeReport } from "../lib/ipc";

interface Props {
  onRerunWizard: () => void;
}

export function SettingsPane({ onRerunWizard }: Props) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeReport | null>(null);
  const [probeErr, setProbeErr] = useState("");

  useEffect(() => {
    ipc.getConfig().then(setCfg);
  }, []);

  async function runProbe() {
    setProbing(true);
    setProbeErr("");
    setProbe(null);
    try {
      const r = await ipcAI.probe();
      setProbe(r);
    } catch (e: any) {
      setProbeErr(String(e));
    } finally {
      setProbing(false);
    }
  }

  if (!cfg) return <div className="p-4">loading...</div>;

  return (
    <div className="p-6 max-w-3xl" data-testid="settings">
      <h2 className="text-2xl font-semibold mb-4">Settings</h2>

      <section className="mb-6">
        <h3 className="font-semibold mb-2">AI Provider</h3>
        {cfg.ai_provider ? (
          <div className="text-sm space-y-1">
            <div>
              Kind: <span className="font-mono">{cfg.ai_provider.kind}</span>
            </div>
            <div>
              Base URL:{" "}
              <span className="font-mono">{cfg.ai_provider.base_url}</span>
            </div>
            <div>
              Default model:{" "}
              <span className="font-mono">{cfg.ai_provider.default_model}</span>
            </div>
            <button
              onClick={runProbe}
              disabled={probing}
              className="mt-2 text-xs px-2 py-1 bg-slate-200 rounded disabled:opacity-50"
              data-testid="provider-probe"
            >
              {probing ? "Probing… (≈30 s)" : "Test model capability"}
            </button>
            {probeErr && (
              <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded">{probeErr}</div>
            )}
            {probe && (
              <table className="mt-2 text-xs border-collapse" data-testid="probe-results">
                <tbody>
                  <tr><td className="pr-3 font-mono">overall</td><td className="font-mono">{probe.overall_score.toFixed(1)}</td></tr>
                  <tr><td className="pr-3 font-mono">plan (JSON)</td><td className="font-mono">{probe.plan_score.toFixed(0)}</td></tr>
                  <tr><td className="pr-3 font-mono">code (scanpy)</td><td className="font-mono">{probe.code_score.toFixed(0)}</td></tr>
                  <tr><td className="pr-3 font-mono">fix (leiden)</td><td className="font-mono">{probe.fix_score.toFixed(0)}</td></tr>
                  <tr><td className="pr-3 font-mono">chinese</td><td className="font-mono">{probe.chinese_score.toFixed(0)}</td></tr>
                </tbody>
              </table>
            )}
            {probe && probe.notes.length > 0 && (
              <ul className="mt-1 text-[11px] text-slate-500 list-disc ml-4">
                {probe.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-500">not configured</div>
        )}
      </section>

      <section className="mb-6">
        <h3 className="font-semibold mb-2">Python Environment</h3>
        {cfg.python_env ? (
          <div className="text-sm space-y-1">
            <div>
              Path: <span className="font-mono">{cfg.python_env.python_path}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">not configured</div>
        )}
      </section>

      <section className="mb-6">
        <h3 className="font-semibold mb-2">HPC Connections</h3>
        {cfg.hpcs.length === 0 ? (
          <div className="text-sm text-slate-500">none configured</div>
        ) : (
          <ul className="text-sm list-disc ml-4">
            {cfg.hpcs.map((h) => (
              <li key={h.name}>
                {h.name} ({h.user}@{h.host})
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        className="px-3 py-1 bg-slate-200 rounded"
        onClick={onRerunWizard}
        data-testid="rerun-wizard"
      >
        Re-run onboarding wizard
      </button>
    </div>
  );
}
