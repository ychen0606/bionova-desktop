import { MonacoCellEditor } from "./MonacoCellEditor";
import { Outputs } from "./Outputs";
import { CellJson } from "../lib/ipc";
import { getCellId } from "../lib/opLog";

export type StepState = "idle" | "queued" | "running" | "done" | "error";

interface Props {
  cell: CellJson; // .ipynb-format code cell; UI label is "Step"
  state: StepState;
  index: number; // 1-based label within its card
  onSourceChange: (newSrc: string) => void;
  onRun: () => void;
  onClear: () => void;
  onDelete: () => void;
}

export function Step({
  cell,
  state,
  index,
  onSourceChange,
  onRun,
  onClear,
  onDelete,
}: Props) {
  const src = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
  const stateBadge: Record<StepState, string> = {
    idle: "—",
    queued: "queued",
    running: "running…",
    done: `done${cell.execution_count != null ? ` [${cell.execution_count}]` : ""}`,
    error: "error",
  };
  const stateColor: Record<StepState, string> = {
    idle: "text-slate-400",
    queued: "text-amber-600",
    running: "text-amber-600",
    done: "text-emerald-600",
    error: "text-red-600",
  };

  return (
    <div className="my-2" data-testid={`step-${getCellId(cell)}`}>
      <div className="flex items-center gap-2 mb-1 text-xs">
        <span className="font-mono text-slate-500 w-12">Step {index}</span>
        <button
          onClick={onRun}
          disabled={state === "running" || state === "queued"}
          className="px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-50"
          data-testid="step-run"
        >
          Run
        </button>
        <button onClick={onClear} className="px-2 py-0.5 bg-slate-100 rounded">
          Clear
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-0.5 bg-slate-100 rounded text-red-700"
        >
          Delete
        </button>
        <span className={`ml-auto ${stateColor[state]} font-mono`}>
          {stateBadge[state]}
        </span>
      </div>
      <MonacoCellEditor
        value={src as string}
        onChange={onSourceChange}
        onRun={onRun}
      />
      <Outputs outputs={cell.outputs} />
    </div>
  );
}
