import { useEffect, useState } from "react";
import { ipcProject, ProjectSummary } from "../lib/ipc";
import { NewProjectDialog } from "./NewProjectDialog";

interface Props {
  onOpenSettings: () => void;
  onOpenProject: (slug: string, displayName: string) => void;
}

export function ProjectShell({ onOpenSettings, onOpenProject }: Props) {
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    const l = await ipcProject.list();
    setList(l);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(name: string) {
    setDialogOpen(false);
    const summ = await ipcProject.create(name);
    await refresh();
    onOpenProject(summ.slug, summ.display_name);
  }

  async function handleDelete(slug: string, name: string) {
    if (!confirm(`Move "${name}" to trash?`)) return;
    await ipcProject.delete(slug);
    await refresh();
  }

  return (
    <div className="p-6" data-testid="project-shell">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">BioNova Desktop</h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded"
            onClick={() => setDialogOpen(true)}
            data-testid="open-new"
          >
            + New project
          </button>
          <button
            className="px-3 py-1 bg-slate-200 rounded"
            onClick={onOpenSettings}
            data-testid="open-settings"
          >
            Settings
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="text-slate-600">
          No projects yet. Click "+ New project" to start.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li
              key={p.slug}
              className="border rounded p-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
              onClick={() => onOpenProject(p.slug, p.display_name)}
              data-testid={`project-row-${p.slug}`}
            >
              <div>
                <div className="font-medium">{p.display_name}</div>
                <div className="text-xs text-slate-500 font-mono">{p.slug}</div>
              </div>
              <button
                className="px-2 py-1 bg-slate-100 rounded text-xs text-red-700"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(p.slug, p.display_name);
                }}
                data-testid={`delete-${p.slug}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <NewProjectDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
