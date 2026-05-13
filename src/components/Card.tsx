import { useState } from "react";
import { CardMeta, CellJson } from "../lib/ipc";
import { Step, StepState } from "./Step";
import { getCellId } from "../lib/opLog";

interface Props {
  card: CardMeta;
  cells: CellJson[];
  cellStates: Record<string, StepState>;
  onRenameCard: (newTitle: string) => void;
  onDeleteCard: () => void;
  onAddCell: () => void;
  onCellSourceChange: (cellId: string, src: string) => void;
  onCellRun: (cellId: string) => void;
  onCellClear: (cellId: string) => void;
  onCellDelete: (cellId: string) => void;
}

export function Card(p: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.card.title);
  const [collapsed, setCollapsed] = useState(p.card.collapsed);

  const cardState: StepState = p.cells.some((c) =>
    ["running", "queued"].includes(p.cellStates[getCellId(c)] ?? "idle")
  )
    ? "running"
    : p.cells.some((c) => p.cellStates[getCellId(c)] === "error")
      ? "error"
      : p.cells.length > 0 && p.cells.every((c) => p.cellStates[getCellId(c)] === "done")
        ? "done"
        : "idle";

  const stateBadge: Record<StepState, string> = {
    idle: "—",
    queued: "queued",
    running: "⏳",
    done: "✓",
    error: "✗",
  };
  const stateColor: Record<StepState, string> = {
    idle: "text-slate-400",
    queued: "text-amber-600",
    running: "text-amber-600",
    done: "text-emerald-600",
    error: "text-red-600",
  };

  return (
    <div
      className="border rounded my-3 bg-white"
      data-testid={`card-${p.card.id}`}
    >
      <div className="flex items-center gap-2 p-2 border-b bg-slate-50">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-xs w-5"
          data-testid="card-toggle"
        >
          {collapsed ? "▶" : "▼"}
        </button>
        {editing ? (
          <input
            className="flex-1 px-2 py-0.5 border rounded text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (title !== p.card.title) p.onRenameCard(title);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            autoFocus
            data-testid="card-title-edit"
          />
        ) : (
          <h3
            className="flex-1 font-semibold text-sm cursor-pointer"
            onClick={() => setEditing(true)}
            data-testid="card-title"
          >
            {p.card.title}
          </h3>
        )}
        <span
          className={`text-xs font-mono ${stateColor[cardState]}`}
          data-testid="card-state"
        >
          {stateBadge[cardState]}
        </span>
        <button
          onClick={p.onDeleteCard}
          className="px-2 py-0.5 bg-slate-100 rounded text-xs text-red-700"
          data-testid="card-delete"
        >
          Delete
        </button>
      </div>
      {!collapsed && (
        <div className="p-3">
          {p.cells.map((cell, idx) => {
            const id = getCellId(cell);
            return (
              <Step
                key={id}
                cell={cell}
                index={idx + 1}
                state={p.cellStates[id] ?? "idle"}
                onSourceChange={(s) => p.onCellSourceChange(id, s)}
                onRun={() => p.onCellRun(id)}
                onClear={() => p.onCellClear(id)}
                onDelete={() => p.onCellDelete(id)}
              />
            );
          })}
          <button
            onClick={p.onAddCell}
            className="text-xs px-2 py-1 bg-slate-100 rounded mt-2"
            data-testid="card-add-cell"
          >
            + Add step
          </button>
        </div>
      )}
    </div>
  );
}
