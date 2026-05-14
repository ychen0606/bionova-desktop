import { useEffect, useRef, useState } from "react";
import {
  ChatHistoryEntry,
  NotebookJson,
  ipcAI,
  ipcChat,
} from "../lib/ipc";
import { getCellId } from "../lib/opLog";

interface Props {
  slug: string;
  projectName: string;
  notebook: NotebookJson;
  focusedCellId: string | null;
  /// Called when the user clicks Apply on a <bionova_patch>; ProjectEditor
  /// turns this into a cell_content_set op.
  onApplyPatch: (cellId: string, newSource: string) => void;
  /// Bumps when AnnData state likely changed (after a cell run) so the
  /// chat panel can re-pull a fresh variable snapshot when it sends.
  varsRefreshKey: number;
  /// Function the panel calls to fetch a fresh variable snapshot.
  fetchVarSnapshot: () => Promise<string>;
}

export function AIChat({
  slug,
  projectName,
  notebook,
  focusedCellId,
  onApplyPatch,
  varsRefreshKey,
  fetchVarSnapshot,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [pending, setPending] = useState<string>(""); // streaming text in flight
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ipcChat.read(slug).then(setHistory).catch((e) => setError(String(e)));
  }, [slug]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, pending]);

  async function send() {
    if (!input.trim() || streaming) return;
    const msg = input;
    setInput("");
    setError("");
    const userEntry: ChatHistoryEntry = {
      role: "user",
      content: msg,
      ts: new Date().toISOString(),
    };
    setHistory((h) => [...h, userEntry]);
    await ipcChat.append(slug, userEntry).catch(() => {});

    setStreaming(true);
    setPending("");
    let acc = "";
    let usageSeen: any = undefined;
    const cardsBrief = notebook.metadata.bionova.cards
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => `${c.id}:${c.title}`)
      .join(", ");
    const focusedCard =
      (focusedCellId &&
        notebook.cells.find((c) => getCellId(c) === focusedCellId)?.metadata.bionova
          ?.card_id) ||
      "(none)";
    const varSnapshot = await fetchVarSnapshot().catch(() => "(unavailable)");

    const vars: Record<string, string> = {
      project_display_name: projectName,
      cards_brief: cardsBrief,
      focused_cell_id: focusedCellId ?? "(none)",
      focused_card: focusedCard,
      var_snapshot: varSnapshot,
      user_message: msg,
    };

    const unlisten = await ipcAI.chatStream(slug, vars, (chunk) => {
      if (chunk.kind === "text") {
        acc += chunk.text;
        setPending(acc);
      } else if (chunk.kind === "usage") {
        usageSeen = chunk;
      } else if (chunk.kind === "error") {
        setError(chunk.message);
      } else if (chunk.kind === "done") {
        const ts = new Date().toISOString();
        const final: ChatHistoryEntry = {
          role: "assistant",
          content: acc,
          ts,
          usage: usageSeen
            ? {
                input_tokens: usageSeen.input_tokens,
                output_tokens: usageSeen.output_tokens,
                cache_read_input_tokens: usageSeen.cache_read_input_tokens ?? 0,
                cache_creation_input_tokens: usageSeen.cache_creation_input_tokens ?? 0,
              }
            : undefined,
        };
        ipcChat.append(slug, final).catch(() => {});
        setHistory((h) => [...h, final]);
        setPending("");
        setStreaming(false);
        unlisten();
      }
    });
  }
  void varsRefreshKey; // satisfy linter; we read snapshot at send time

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed right-0 top-1/3 bg-blue-600 text-white text-xs px-2 py-3 rounded-l shadow"
        data-testid="ai-chat-open"
      >
        🤖<br/>Chat
      </button>
    );
  }

  return (
    <aside
      className="fixed right-0 top-12 bottom-0 w-[360px] bg-white border-l flex flex-col shadow-xl"
      data-testid="ai-chat"
    >
      <div className="flex items-center gap-2 p-2 border-b bg-slate-50">
        <h3 className="text-sm font-semibold">🤖 AI Chat</h3>
        <button
          onClick={() => setCollapsed(true)}
          className="ml-auto text-xs px-2 py-0.5 bg-slate-200 rounded"
          data-testid="ai-chat-collapse"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-sm" data-testid="ai-chat-history">
        {history.length === 0 && !pending && (
          <div className="text-xs text-slate-500">
            提问、改代码、找原因都可以。AI 看得到当前 cards 和最近变量快照。
          </div>
        )}
        {history.map((e, i) => (
          <ChatBubble key={i} entry={e} onApplyPatch={onApplyPatch} />
        ))}
        {pending && (
          <ChatBubble
            entry={{ role: "assistant", content: pending, ts: "" }}
            onApplyPatch={onApplyPatch}
            isStreaming
          />
        )}
        {error && (
          <div className="text-xs text-red-700 bg-red-50 rounded p-2">{error}</div>
        )}
      </div>

      <div className="p-2 border-t bg-slate-50">
        <textarea
          className="w-full text-sm border rounded p-2 resize-none"
          rows={3}
          placeholder="问问 AI…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          data-testid="ai-chat-input"
        />
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-slate-500">⌘/Ctrl+Enter</span>
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="ml-auto px-3 py-1 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
            data-testid="ai-chat-send"
          >
            {streaming ? "..." : "Send"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function ChatBubble({
  entry,
  onApplyPatch,
  isStreaming,
}: {
  entry: ChatHistoryEntry;
  onApplyPatch: (cellId: string, newSource: string) => void;
  isStreaming?: boolean;
}) {
  const isUser = entry.role === "user";
  const patches = isUser ? [] : extractPatches(entry.content);
  const rendered = isUser ? entry.content : stripPatches(entry.content);

  return (
    <div className={isUser ? "text-right" : ""} data-testid={`chat-bubble-${entry.role}`}>
      <div
        className={`inline-block max-w-full text-left whitespace-pre-wrap rounded px-2 py-1 ${
          isUser ? "bg-blue-100" : "bg-slate-100"
        }`}
      >
        {rendered}
        {isStreaming && <span className="animate-pulse">▌</span>}
      </div>
      {patches.map((p, i) => (
        <div key={i} className="mt-1 border rounded bg-amber-50 p-2 text-xs">
          <div className="text-amber-800 mb-1">
            建议修改 cell <code className="font-mono">{p.cellId.slice(0, 8)}</code>
          </div>
          <pre className="font-mono text-xs whitespace-pre-wrap bg-white p-2 border rounded max-h-48 overflow-auto">
            {p.code}
          </pre>
          <button
            onClick={() => onApplyPatch(p.cellId, p.code)}
            className="mt-1 px-2 py-0.5 bg-amber-600 text-white rounded"
            data-testid="ai-chat-apply-patch"
          >
            Apply patch
          </button>
        </div>
      ))}
      {entry.usage && (
        <div className="text-[10px] text-slate-400 mt-0.5">
          {entry.usage.input_tokens} in / {entry.usage.output_tokens} out tok
        </div>
      )}
    </div>
  );
}

export function extractPatches(text: string): Array<{ cellId: string; code: string }> {
  const out: Array<{ cellId: string; code: string }> = [];
  // <bionova_patch cell_id="..."> ```python ... ``` </bionova_patch>
  const re = /<bionova_patch\s+cell_id="([^"]+)"\s*>\s*```(?:python|py)?\n([\s\S]*?)```\s*<\/bionova_patch>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ cellId: m[1], code: m[2] });
  }
  return out;
}

function stripPatches(text: string): string {
  return text.replace(
    /<bionova_patch\s+cell_id="[^"]+"\s*>[\s\S]*?<\/bionova_patch>/g,
    ""
  );
}
