import { useState } from "react";
import { CardSpec } from "../lib/ipc";

interface Props {
  cards: CardSpec[];
  onAccept: (accepted: CardSpec[]) => void;
  onCancel: () => void;
}

export function PlanReview({ cards, onAccept, onCancel }: Props) {
  const [items, setItems] = useState(
    cards.map((c) => ({ ...c, checked: true }))
  );

  const setTitle = (i: number, t: string) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, title: t } : it)));
  const toggle = (i: number) =>
    setItems((prev) =>
      prev.map((it, j) => (j === i ? { ...it, checked: !it.checked } : it))
    );

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      data-testid="plan-review-modal"
    >
      <div className="bg-white rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">AI 提议的分析方案</h2>
          <p className="text-xs text-slate-500 mt-1">
            勾选要采用的卡片，必要时编辑标题。Accept 后 BioNova 会逐张卡片生成代码并运行。
          </p>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y">
          {items.map((it, i) => (
            <li key={i} className="p-3" data-testid={`plan-card-${it.id}`}>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => toggle(i)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <input
                    className="w-full font-semibold text-sm border-b border-transparent focus:border-slate-400 outline-none"
                    value={it.title}
                    onChange={(e) => setTitle(i, e.target.value)}
                  />
                  <div className="text-xs text-slate-600 mt-1">{it.rationale}</div>
                  <code className="text-[10px] text-slate-400 font-mono">{it.id}</code>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="p-3 border-t flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1 text-sm bg-slate-200 rounded"
            data-testid="plan-review-cancel"
          >
            取消
          </button>
          <button
            onClick={() => onAccept(items.filter((it) => it.checked).map(({ checked, ...c }) => c))}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
            data-testid="plan-review-accept"
          >
            Accept ({items.filter((it) => it.checked).length})
          </button>
        </div>
      </div>
    </div>
  );
}
