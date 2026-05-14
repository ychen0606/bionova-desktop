import { useCallback, useEffect, useState } from "react";
import { ipcKernel, VarInfo } from "../lib/ipc";

interface Props {
  slug: string;
  /// Bumps on every cell run so the panel refreshes automatically.
  refreshKey: number;
}

export function VariablePanel({ slug, refreshKey }: Props) {
  const [vars, setVars] = useState<VarInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const v = await ipcKernel.inspectVars(slug);
      setVars(v);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  return (
    <div className="border rounded m-4 bg-white" data-testid="variable-panel">
      <div className="flex items-center gap-2 p-3 border-b bg-slate-50">
        <h3 className="font-semibold text-sm">🔎 Kernel variables ({vars.length})</h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto text-xs px-2 py-0.5 bg-slate-200 rounded disabled:opacity-50"
          data-testid="vars-refresh"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      {error && (
        <div className="m-3 text-xs text-red-700 bg-red-50 p-2 rounded">{error}</div>
      )}
      {vars.length === 0 ? (
        <div className="p-4 text-center text-xs text-slate-500">
          No user variables yet. Run a step that defines names (e.g.{" "}
          <code>adata = sc.read(...)</code>) to populate.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-1 font-mono">name</th>
                <th className="px-3 py-1 font-mono">type</th>
                <th className="px-3 py-1 font-mono">shape</th>
                <th className="px-3 py-1 font-mono">dtype</th>
                <th className="px-3 py-1 font-mono">repr</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => (
                <tr
                  key={v.name}
                  className="border-t"
                  data-testid={`var-row-${v.name}`}
                >
                  <td className="px-3 py-1 font-mono">{v.name}</td>
                  <td className="px-3 py-1 font-mono text-slate-600">{v.type_name}</td>
                  <td className="px-3 py-1 font-mono text-slate-600">
                    {v.shape ? v.shape.join(" × ") : "—"}
                  </td>
                  <td className="px-3 py-1 font-mono text-slate-600">
                    {v.dtype ?? "—"}
                  </td>
                  <td className="px-3 py-1 font-mono text-slate-500 max-w-md truncate">
                    {v.repr_short}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
