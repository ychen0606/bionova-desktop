import { useState } from "react";
import { ipcAI } from "../lib/ipc";

interface Props {
  selection: string;
  surrounding: string;
  onApply: (newSnippet: string) => void;
  onCancel: () => void;
}

export function InlineAIDialog({ selection, surrounding, onApply, onCancel }: Props) {
  const [instruction, setInstruction] = useState("");
  const [working, setWorking] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function go() {
    if (!instruction.trim() || working) return;
    setWorking(true);
    setError("");
    try {
      const r = await ipcAI.rewrite(selection, surrounding, instruction, 2048);
      if (r.error) setError(r.error);
      setProposal(r.text);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="border rounded bg-white shadow-lg p-2 my-2"
      data-testid="inline-ai-dialog"
    >
      <div className="text-xs font-semibold text-slate-600 mb-1">
        ✨ Rewrite selection with AI
      </div>
      <pre className="text-[11px] font-mono bg-slate-50 border rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">
        {selection || "(empty selection — will rewrite entire cell)"}
      </pre>
      <input
        autoFocus
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="改写指令，例如：换成 sc.tl.leiden / 加 batch_key='donor' / 改为 highly_variable_genes 3000"
        className="w-full px-2 py-1 border rounded text-sm mt-1"
        data-testid="inline-ai-input"
      />
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-slate-500">Enter 提交 · Esc 取消</span>
        <button
          onClick={onCancel}
          className="ml-auto text-xs px-2 py-0.5 bg-slate-200 rounded"
        >
          Cancel
        </button>
        <button
          onClick={go}
          disabled={working || !instruction.trim()}
          className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-50"
          data-testid="inline-ai-go"
        >
          {working ? "..." : "Generate"}
        </button>
      </div>
      {error && (
        <div className="mt-1 text-xs text-red-700 bg-red-50 p-2 rounded">{error}</div>
      )}
      {proposal != null && (
        <div className="mt-2">
          <div className="text-xs text-slate-500 mb-0.5">AI proposed:</div>
          <pre className="text-xs font-mono bg-amber-50 border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
            {proposal}
          </pre>
          <div className="flex gap-2 mt-1 justify-end">
            <button
              onClick={() => setProposal(null)}
              className="text-xs px-2 py-0.5 bg-slate-200 rounded"
            >
              Discard
            </button>
            <button
              onClick={() => onApply(proposal)}
              className="text-xs px-2 py-0.5 bg-amber-600 text-white rounded"
              data-testid="inline-ai-apply"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
