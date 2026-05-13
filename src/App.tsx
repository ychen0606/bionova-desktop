import { useEffect, useState } from "react";
import { ipc } from "./lib/ipc";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { SettingsPane } from "./components/SettingsPane";
import { ProjectShell } from "./components/ProjectShell";
import { CellExecSmoke } from "./components/CellExecSmoke";

type View = "loading" | "wizard" | "shell" | "settings" | "smoke";

function App() {
  const [view, setView] = useState<View>("loading");

  useEffect(() => {
    ipc.getConfig().then((cfg) => {
      if (!cfg.ai_provider || !cfg.python_env) setView("wizard");
      else setView("shell");
    });
  }, []);

  if (view === "loading") return <div className="p-6">loading...</div>;
  if (view === "wizard")
    return <OnboardingWizard onComplete={() => setView("shell")} />;
  if (view === "settings")
    return <SettingsPane onRerunWizard={() => setView("wizard")} />;
  if (view === "smoke")
    return <CellExecSmoke onBack={() => setView("shell")} />;
  return (
    <ProjectShell
      onOpenSettings={() => setView("settings")}
      onOpenSmokeTest={() => setView("smoke")}
    />
  );
}

export default App;
