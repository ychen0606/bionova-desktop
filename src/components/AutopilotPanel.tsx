import { useState } from "react";
import { CardSpec, ipcAI } from "../lib/ipc";
import { PlanReview } from "./PlanReview";

interface Props {
  /// Called after the user accepts a plan; receives the list of cards plus
  /// the metadata we already fetched (so ProjectEditor can build the data
  /// loading Step and pass the real adata state to each generateCode call).
  onPlanAccepted: (cards: CardSpec[], metadata: Record<string, string>) => Promise<void>;
  /// Provides Autopilot the AnnData metadata to feed `ai_plan`. Returned
  /// from the caller because it inspects the first data file in the
  /// project's data folder via existing ipcData.list/inspect.
  fetchAnnDataVars: () => Promise<Record<string, string>>;
}

export function AutopilotPanel({ onPlanAccepted, fetchAnnDataVars }: Props) {
  const [stage, setStage] = useState<"idle" | "planning" | "review" | "applying" | "error">(
    "idle"
  );
  const [plan, setPlan] = useState<CardSpec[]>([]);
  const [planMeta, setPlanMeta] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function start() {
    setStage("planning");
    setError("");
    try {
      const vars = await fetchAnnDataVars();
      const cards = await ipcAI.plan(vars, 2048);
      setPlan(cards);
      setPlanMeta(vars);
      setStage("review");
    } catch (e: any) {
      setError(String(e));
      setStage("error");
    }
  }

  if (stage === "idle" || stage === "error") {
    return (
      <div
        className="border-2 border-dashed border-blue-300 rounded m-4 p-4 bg-blue-50/40"
        data-testid="autopilot-panel"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🪄</span>
          <div className="flex-1">
            <div className="font-semibold text-sm">Autopilot</div>
            <div className="text-xs text-slate-600">
              让 AI 看一眼 <code className="font-mono">data/</code> 里的文件，自动设计一套分析方案。
            </div>
          </div>
          <button
            onClick={start}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
            data-testid="autopilot-start"
          >
            Start
          </button>
        </div>
        {error && (
          <div className="mt-2 text-xs text-red-700 bg-red-50 rounded p-2">{error}</div>
        )}
      </div>
    );
  }

  if (stage === "planning") {
    return (
      <div className="border rounded m-4 p-4 bg-slate-50 text-sm" data-testid="autopilot-planning">
        🤔 AI 正在分析 metadata 并设计方案…
      </div>
    );
  }

  if (stage === "review") {
    return (
      <PlanReview
        cards={plan}
        onAccept={async (accepted) => {
          setStage("applying");
          try {
            await onPlanAccepted(accepted, planMeta);
            setStage("idle");
          } catch (e: any) {
            setError(String(e));
            setStage("error");
          }
        }}
        onCancel={() => setStage("idle")}
      />
    );
  }

  if (stage === "applying") {
    return (
      <div className="border rounded m-4 p-4 bg-slate-50 text-sm" data-testid="autopilot-applying">
        ⏳ 正在插入 cards 并生成代码…
      </div>
    );
  }
  return null;
}
