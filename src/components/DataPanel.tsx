import { useEffect, useState } from "react";
import { ipcData, DataFile, InspectionReport } from "../lib/ipc";

interface Props {
  slug: string;
}

const KIND_LABEL: Record<string, string> = {
  h5ad: "AnnData (.h5ad)",
  h5: "10x HDF5 (.h5)",
  mtx: "MatrixMarket (.mtx)",
  csv: "CSV",
  tsv: "TSV",
  loom: "Loom",
  rds: "R/RDS",
  unknown: "Other",
};

const KIND_ORDER = ["h5ad", "h5", "mtx", "loom", "csv", "tsv", "rds", "unknown"];

export function DataPanel({ slug }: Props) {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [inspecting, setInspecting] = useState<Record<string, boolean>>({});
  const [reports, setReports] = useState<Record<string, InspectionReport>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [batching, setBatching] = useState(false);

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
    setInspecting((m) => ({ ...m, [name]: true }));
    setErrors((e) => ({ ...e, [name]: "" }));
    try {
      const r = await ipcData.inspect(slug, name);
      setReports((m) => ({ ...m, [name]: r }));
    } catch (e: any) {
      setErrors((m) => ({ ...m, [name]: String(e) }));
    } finally {
      setInspecting((m) => ({ ...m, [name]: false }));
    }
  }

  async function inspectAll() {
    setBatching(true);
    try {
      // Serial — one ipykernel subprocess per file is heavy enough that
      // parallelism can OOM small machines. Sequential keeps it predictable.
      for (const f of files) {
        if (reports[f.name]) continue;
        await inspect(f.name);
      }
    } finally {
      setBatching(false);
    }
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  const grouped = groupByKind(files);
  const total = files.length;
  const pendingCount = files.filter((f) => !reports[f.name]).length;

  return (
    <div className="border rounded m-4 bg-white" data-testid="data-panel">
      <div className="flex items-center gap-2 p-3 border-b bg-slate-50">
        <h3 className="font-semibold text-sm">📁 Data ({total} files)</h3>
        <button
          onClick={inspectAll}
          disabled={batching || total === 0 || pendingCount === 0}
          className="ml-auto text-xs px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-40"
          data-testid="data-inspect-all"
          title="Inspect every file that doesn't yet have a report"
        >
          {batching ? `Inspecting…` : `Inspect all (${pendingCount})`}
        </button>
        <button
          onClick={refresh}
          className="text-xs px-2 py-0.5 bg-slate-200 rounded"
          disabled={loading}
          data-testid="data-refresh"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <div className="p-3 text-xs text-slate-500 border-b">
        Drop data files into <code className="font-mono">~/BioNova/projects/{slug}/data/</code>.
        Click <strong>Inspect</strong> for one file, or <strong>Inspect all</strong> to batch.
      </div>

      {total === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No data files yet. Supported: <code>.h5ad</code>, <code>.h5</code>{" "}
          (10x), <code>.mtx</code>, <code>.csv</code>, <code>.tsv</code>.
        </div>
      ) : (
        <div data-testid="data-groups">
          {KIND_ORDER.filter((k) => (grouped[k] ?? []).length > 0).map((kind) => (
            <KindSection
              key={kind}
              kind={kind}
              files={grouped[kind]}
              reports={reports}
              errors={errors}
              inspecting={inspecting}
              onInspect={inspect}
              fmtSize={fmtSize}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function groupByKind(files: DataFile[]): Record<string, DataFile[]> {
  const map: Record<string, DataFile[]> = {};
  for (const f of files) {
    const k = f.kind_hint || "unknown";
    (map[k] ||= []).push(f);
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

function KindSection({
  kind,
  files,
  reports,
  errors,
  inspecting,
  onInspect,
  fmtSize,
}: {
  kind: string;
  files: DataFile[];
  reports: Record<string, InspectionReport>;
  errors: Record<string, string>;
  inspecting: Record<string, boolean>;
  onInspect: (name: string) => void;
  fmtSize: (n: number) => string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b last:border-b-0" data-testid={`data-group-${kind}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-left"
      >
        <span className="text-xs w-4">{open ? "▼" : "▶"}</span>
        <span className="font-mono text-xs">{KIND_LABEL[kind] ?? kind}</span>
        <span className="text-xs text-slate-500">({files.length})</span>
      </button>
      {open && (
        <ul className="divide-y">
          {files.map((f) => {
            const r = reports[f.name];
            const err = errors[f.name];
            return (
              <li key={f.name} className="p-3" data-testid={`data-row-${f.name}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{f.name}</span>
                  <span className="text-xs text-slate-500">{fmtSize(f.size_bytes)}</span>
                  <button
                    onClick={() => onInspect(f.name)}
                    disabled={!!inspecting[f.name]}
                    className="ml-auto text-xs px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-50"
                    data-testid={`data-inspect-${f.name}`}
                  >
                    {inspecting[f.name] ? "Inspecting..." : r ? "Re-inspect" : "Inspect"}
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
        {report.obs_head?.length > 0 && (
          <ObsHeadTable rows={report.obs_head} />
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
        {report.preview_rows?.length > 0 && (
          <PreviewTable columns={report.columns ?? []} rows={report.preview_rows} />
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

function PreviewTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const shown = columns.slice(0, 8);
  return (
    <div className="mt-2 overflow-x-auto" data-testid="preview-table">
      <table className="text-xs border-collapse">
        <thead className="bg-slate-50">
          <tr>
            {shown.map((c, i) => (
              <th key={i} className="border px-2 py-0.5 font-mono text-left">{c}</th>
            ))}
            {columns.length > shown.length && (
              <th className="border px-2 py-0.5 text-slate-400">…</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {shown.map((_, ci) => (
                <td key={ci} className="border px-2 py-0.5 font-mono max-w-xs truncate">{r[ci] ?? ""}</td>
              ))}
              {columns.length > shown.length && <td className="border px-2 py-0.5 text-slate-400">…</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ObsHeadTable({ rows }: { rows: Array<Record<string, any>> }) {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0]).slice(0, 8);
  return (
    <div className="mt-2 overflow-x-auto" data-testid="obs-head-table">
      <div className="text-slate-400 mb-0.5">obs head (first {rows.length})</div>
      <table className="text-xs border-collapse">
        <thead className="bg-slate-50">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border px-2 py-0.5 font-mono text-left">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {cols.map((c) => (
                <td key={c} className="border px-2 py-0.5 font-mono max-w-xs truncate">
                  {row[c] == null ? "—" : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
