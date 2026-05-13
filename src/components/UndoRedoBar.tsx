interface Props {
  canUndo: boolean;
  canRedo: boolean;
  lastOpDescription: string;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
  projectName: string;
}

export function UndoRedoBar(p: Props) {
  return (
    <div
      className="border-b bg-slate-50 px-4 py-2 flex items-center gap-2 text-sm"
      data-testid="undo-bar"
    >
      <button
        onClick={p.onBack}
        className="px-2 py-1 bg-slate-200 rounded text-xs"
        data-testid="back-to-shell"
      >
        ← Projects
      </button>
      <span className="font-semibold">{p.projectName}</span>
      <span className="ml-auto" />
      <button
        onClick={p.onUndo}
        disabled={!p.canUndo}
        className="px-2 py-1 bg-slate-200 rounded text-xs disabled:opacity-30"
        data-testid="undo-btn"
      >
        Undo
      </button>
      <button
        onClick={p.onRedo}
        disabled={!p.canRedo}
        className="px-2 py-1 bg-slate-200 rounded text-xs disabled:opacity-30"
        data-testid="redo-btn"
      >
        Redo
      </button>
      <span className="text-xs text-slate-500">{p.lastOpDescription}</span>
    </div>
  );
}
