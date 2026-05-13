interface Props {
  onOpenSettings: () => void;
  onOpenSmokeTest: () => void;
}

export function ProjectShell({ onOpenSettings, onOpenSmokeTest }: Props) {
  return (
    <div className="p-6" data-testid="project-shell">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">BioNova Desktop</h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 bg-slate-200 rounded"
            onClick={onOpenSmokeTest}
            data-testid="open-smoke"
          >
            Smoke test
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
      <p className="text-slate-600">
        No projects yet. (Project creation is in Plan 2.)
      </p>
    </div>
  );
}
