import { useEffect, useState } from "react";
import { ipc, AppConfig } from "../lib/ipc";

interface Props {
  onRerunWizard: () => void;
}

export function SettingsPane({ onRerunWizard }: Props) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);

  useEffect(() => {
    ipc.getConfig().then(setCfg);
  }, []);

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
