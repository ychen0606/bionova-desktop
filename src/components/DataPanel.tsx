import { useEffect, useState } from "react";
import { ipcData, DataFile, InspectionReport } from "../lib/ipc";

interface Props {
  slug: string;
}

export function DataPanel({ slug }: Props) {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, InspectionReport>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const list = await ipcData.list(slug);
      setFiles(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [slug]);

  async function inspect(name: string) {
    setInspecting(name);
    setErrors((e) => ({ ...e, [name]: "" }));
    try {
      const r = await ipcData.inspect(slug, name);
      setReports((m) => ({ ...m, [name]: r }));
    } catch (e: any) {
      setErrors((m) => ({ ...m, [name]: String(e) }));
    } finally {
      setInspecting(null);
    }
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  return (
    <div className="border rounded m-4 bg-white" data-testid="data-panel">
      <div className="flex items-center gap-2 p-3 border-b bg-slate-50">
        <h3 className="font-semibold text-sm">📁 Data ({files.length} files)</h3>
        <button
          onClick={refresh}
          className="ml-auto text-xs px-2 py-0.5 bg-slate-200 rounded"
          disabled={loading}
          data-testid="data-refresh"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <div className="p-3 text-xs text-slate-500 border-b">
        Drop data files into <code className="font-mono">~/BioNova/projects/{slug}/data/</code> from Windows Explorer or any tool. Click <strong>Refresh</strong> to scan.
      </div>

      {files.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No data files yet. Supported: <code>.h5ad</code>, <code>.h5</code>{" "}
          (10x), <code>.mtx</code>, <code>.csv</code>, <code>.tsv</code>.
        </div>
      ) : (
        <ul className="divide-y" data-testid="data-list">
          {files.map((f) => {
            const r = reports[f.name];
            const err = errors[f.name];
            return (
              <li key={f.name} className="p-3" data-testid={`data-row-${f.name}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{f.name}</span>
                  <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded font-mono">
                    {f.kind_hint}
                  </span>
                  <span className="text-xs text-slate-500">{fmtSize(f.size_bytes)}</span>
                  <button
                    onClick={() => inspect(f.name)}
                    disabled={inspecting === f.name}
                    className="ml-auto text-xs px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-50"
                    data-testid={`data-inspect-${f.name}`}
                  >
                    {inspecting === f.name ? "Inspecting..." : r ? "Re-inspect" : "Inspect"}
                  </button>
                </div>
                {err && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded">
                    {err}
                  </div>
                )}
                {r && <ReportView report={r.report} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReportView({ report }: { report: any }) {
  if (!report) return null;
  const kind = report.kind;
  if (kind === "h5ad") {
    return (
      <div className="mt-2 text-xs text-slate-700 space-y-0.5">
        <div>shape: <span className="font-mono">{report.n_cells.toLocaleString()} cells × {report.n_genes.toLocaleString()} genes</span></div>
        {report.obs_columns?.length > 0 && (
          <div>obs cols ({report.obs_columns.length}): <span className="font-mono">{report.obs_columns.slice(0, 10).join(", ")}{report.obs_columns.length > 10 ? " ..." : ""}</span></div>
        )}
        {report.var_columns?.length > 0 && (
          <div>var cols ({report.var_columns.length}): <span className="font-mono">{report.var_columns.slice(0, 6).join(", ")}{report.var_columns.length > 6 ? " ..." : ""}</span></div>
        )}
        {report.layers?.length > 0 && (
          <div>layers: <span className="font-mono">{report.layers.join(", ")}</span></div>
        )}
        {report.obsm_keys?.length > 0 && (
          <div>obsm: <span className="font-mono">{report.obsm_keys.join(", ")}</span></div>
        )}
      </div>
    );
  }
  if (kind === "10x_h5") {
    return (
      <div className="mt-2 text-xs text-slate-700">
        10x Genomics matrix shape: <span className="font-mono">{report.matrix_shape?.join(" × ")}</span>
        {report.feature_groups?.length > 0 && <> · features: <span className="font-mono">{report.feature_groups.join(", ")}</span></>}
      </div>
    );
  }
  if (kind === "mtx") {
    return (
      <div className="mt-2 text-xs text-slate-700">
        MatrixMarket: <span className="font-mono">{report.shape?.join(" × ")}</span>
      </div>
    );
  }
  if (kind === "csv" || kind === "tsv" || kind === "txt") {
    return (
      <div className="mt-2 text-xs text-slate-700 space-y-0.5">
        <div>rows: <span className="font-mono">{report.n_rows_first_500k}{report.n_rows_first_500k >= 500000 ? "+" : ""}</span> | columns: <span className="font-mono">{report.columns?.length}</span></div>
        {report.columns?.length > 0 && (
          <div>cols: <span className="font-mono">{report.columns.slice(0, 8).join(", ")}{report.columns.length > 8 ? " ..." : ""}</span></div>
        )}
      </div>
    );
  }
  if (kind === "needs_dep") {
    return (
      <div className="mt-2 text-xs text-amber-700 bg-amber-50 p-2 rounded">
        ⚠️ Missing Python dependency: <span className="font-mono">{report.error}</span>
        <div className="mt-1">{report.hint}</div>
      </div>
    );
  }
  if (kind === "error") {
    return (
      <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded">
        ✗ {report.type ?? "Error"}: <span className="font-mono">{report.error}</span>
      </div>
    );
  }
  return (
    <div className="mt-2 text-xs text-slate-500">
      Unknown file type ({kind}).
    </div>
  );
}
