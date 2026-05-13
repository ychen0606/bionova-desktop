import { useState } from "react";

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreate: (display_name: string) => void;
}

export function NewProjectDialog({ open, onCancel, onCreate }: Props) {
  const [name, setName] = useState("");
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center"
      data-testid="new-project-dialog"
    >
      <div className="bg-white rounded-lg p-6 w-[420px]">
        <h2 className="text-lg font-semibold mb-3">New project</h2>
        <input
          type="text"
          className="w-full border rounded px-2 py-1 mb-3"
          placeholder="Project name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onCreate(name.trim());
          }}
          data-testid="np-name"
        />
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1 bg-slate-200 rounded"
            onClick={onCancel}
            data-testid="np-cancel"
          >
            Cancel
          </button>
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim())}
            data-testid="np-create"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
