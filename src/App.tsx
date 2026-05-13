import { useEffect, useState } from "react";
import { ipc } from "./lib/ipc";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { SettingsPane } from "./components/SettingsPane";
import { ProjectShell } from "./components/ProjectShell";
import { ProjectEditor } from "./components/ProjectEditor";

type View =
  | { kind: "loading" }
  | { kind: "wizard" }
  | { kind: "shell" }
  | { kind: "settings" }
  | { kind: "project"; slug: string; name: string };

function App() {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    ipc
      .getConfig()
      .then((cfg) => {
        if (!cfg.ai_provider || !cfg.python_env) setView({ kind: "wizard" });
        else setView({ kind: "shell" });
      })
      .catch((e) => {
        console.error("getConfig failed", e);
        setView({ kind: "wizard" });
      });
  }, []);

  switch (view.kind) {
    case "loading":
      return <div className="p-6">loading...</div>;
    case "wizard":
      return (
        <OnboardingWizard onComplete={() => setView({ kind: "shell" })} />
      );
    case "settings":
      return <SettingsPane onRerunWizard={() => setView({ kind: "wizard" })} />;
    case "project":
      return (
        <ProjectEditor
          slug={view.slug}
          projectName={view.name}
          onBack={() => setView({ kind: "shell" })}
        />
      );
    case "shell":
    default:
      return (
        <ProjectShell
          onOpenSettings={() => setView({ kind: "settings" })}
          onOpenProject={(slug, name) =>
            setView({ kind: "project", slug, name })
          }
        />
      );
  }
}

export default App;
