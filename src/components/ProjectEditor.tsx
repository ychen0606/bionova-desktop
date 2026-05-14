import { useEffect, useState, useCallback, useRef } from "react";
import { v4 as uuid } from "uuid";
import {
  ipc,
  ipcKernel,
  ipcProject,
  ExecutionResult,
  NotebookJson,
  OpEntry,
  CardMeta,
} from "../lib/ipc";
import {
  Op,
  applyForward,
  applyReverse,
  getCellId,
  newCell,
} from "../lib/opLog";
import { PipelineCanvas } from "./PipelineCanvas";
import { UndoRedoBar } from "./UndoRedoBar";
import { DataPanel } from "./DataPanel";
import { VariablePanel } from "./VariablePanel";
import { StepState } from "./Step";

/// Translate a kernel ExecutionResult into the array of nbformat output dicts
/// stored on a notebook cell.
function executionResultToOutputs(out: ExecutionResult): any[] {
  const items: any[] = [];
  if (out.stdout) {
    items.push({ output_type: "stream", name: "stdout", text: out.stdout });
  }
  if (out.stderr) {
    items.push({ output_type: "stream", name: "stderr", text: out.stderr });
  }
  for (const d of out.display_data) {
    items.push({ output_type: "display_data", data: { [d.mime]: d.data }, metadata: {} });
  }
  if (out.execute_result != null) {
    items.push({
      output_type: "execute_result",
      execution_count: out.execution_count,
      data: { "text/plain": out.execute_result },
      metadata: {},
    });
  }
  if (out.error) {
    items.push({
      output_type: "error",
      ename: out.error.ename,
      evalue: out.error.evalue,
      traceback: out.error.traceback,
    });
  }
  return items;
}

interface Props {
  slug: string;
  projectName: string;
  onBack: () => void;
}

export function ProjectEditor({ slug, projectName, onBack }: Props) {
  const [nb, setNb] = useState<NotebookJson | null>(null);
  const [log, setLog] = useState<OpEntry[]>([]);
  const [head, setHead] = useState<number>(0);
  const [cellStates, setCellStates] = useState<Record<string, StepState>>({});
  const [lastOp, setLastOp] = useState<string>("");
  const [varsRefreshKey, setVarsRefreshKey] = useState(0);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const opened = await ipcProject.open(slug);
      setNb(opened.notebook);
      const all = await ipcProject.opRead(slug);
      setLog(all);
      setHead(opened.op_log_head);
    })();
  }, [slug]);

  const debounceSave = useCallback(
    (newNb: NotebookJson) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        ipcProject.save(slug, newNb).catch(console.error);
      }, 500) as unknown as number;
    },
    [slug]
  );

  const commitOp = useCallback(
    async (op: Op) => {
      if (!nb) return;
      const next = applyForward(nb, op);
      setNb(next);
      const entry: OpEntry = { ...op, ts: new Date().toISOString() };
      const seq = await ipcProject.opAppend(slug, entry);
      entry.seq = seq;
      setLog((prev) => {
        const truncated = prev.filter((e) => (e.seq ?? 0) <= head);
        return [...truncated, entry];
      });
      setHead(seq);
      setLastOp(op.op);
      debounceSave(next);
    },
    [nb, slug, head, debounceSave]
  );

  const undo = useCallback(async () => {
    if (head === 0 || !nb) return;
    const entry = log.find((e) => e.seq === head);
    if (!entry) return;
    const next = applyReverse(nb, entry as unknown as Op);
    setNb(next);
    setHead(head - 1);
    setLastOp(`undo: ${entry.op}`);
    await ipcProject.opSetHead(slug, head - 1);
    debounceSave(next);
  }, [head, log, nb, slug, debounceSave]);

  const redo = useCallback(async () => {
    if (!nb) return;
    const entry = log.find((e) => e.seq === head + 1);
    if (!entry) return;
    const next = applyForward(nb, entry as unknown as Op);
    setNb(next);
    setHead(head + 1);
    setLastOp(`redo: ${entry.op}`);
    await ipcProject.opSetHead(slug, head + 1);
    debounceSave(next);
  }, [head, log, nb, slug, debounceSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Kernel teardown on unmount — declared before any conditional return so
  // hook ordering stays stable across renders.
  useEffect(() => {
    return () => {
      ipcKernel.shutdown(slug).catch(() => {});
    };
  }, [slug]);

  if (!nb) return <div className="p-6">loading project...</div>;

  const addCard = () => {
    const card: CardMeta = {
      id: uuid(),
      title: "Untitled card",
      order: nb.metadata.bionova.cards.length,
      collapsed: false,
      ai_generated: false,
    };
    commitOp({ op: "card_insert", fwd: { card }, rev: { card_id: card.id } });
  };

  const renameCard = (card_id: string, new_title: string) => {
    const card = nb.metadata.bionova.cards.find((c) => c.id === card_id);
    if (!card) return;
    commitOp({
      op: "card_rename",
      fwd: { card_id, old_title: card.title, new_title },
      rev: { card_id, old_title: card.title, new_title },
    });
  };

  const deleteCard = (card_id: string) => {
    const card = nb.metadata.bionova.cards.find((c) => c.id === card_id);
    if (!card) return;
    const cells = nb.cells.filter((c) => c.metadata.bionova?.card_id === card_id);
    commitOp({
      op: "card_delete",
      fwd: { card, cells },
      rev: { card, cells },
    });
  };

  const addCell = (card_id: string) => {
    const cell = newCell(card_id, "");
    const cell_id = getCellId(cell);
    const position = nb.cells.length;
    commitOp({
      op: "cell_insert",
      fwd: { cell_id, position, card_id, source: "" },
      rev: { cell_id },
    });
  };

  const setCellSrc = (cell_id: string, new_source: string) => {
    const idx = nb.cells.findIndex((c) => getCellId(c) === cell_id);
    if (idx < 0) return;
    const old_src = Array.isArray(nb.cells[idx].source)
      ? (nb.cells[idx].source as string[]).join("")
      : (nb.cells[idx].source as string);
    if (old_src === new_source) return;
    commitOp({
      op: "cell_content_set",
      fwd: { cell_id, new_source },
      rev: { cell_id, old_source: old_src },
    });
  };

  const deleteCell = (cell_id: string) => {
    const idx = nb.cells.findIndex((c) => getCellId(c) === cell_id);
    if (idx < 0) return;
    const cell = nb.cells[idx];
    commitOp({
      op: "cell_delete",
      fwd: { cell_id, cell, position: idx },
      rev: { cell, position: idx },
    });
  };

  const reorderCardOp = (card_id: string, new_order: number) => {
    const card = nb.metadata.bionova.cards.find((c) => c.id === card_id);
    if (!card) return;
    const old_order = card.order;
    if (old_order === new_order) return;
    commitOp({
      op: "card_reorder",
      fwd: { card_id, old_order, new_order },
      rev: { card_id, old_order: new_order, new_order: old_order },
    });
  };

  const reorderCellOp = (cell_id: string, new_position: number) => {
    const old_position = nb.cells.findIndex((c) => getCellId(c) === cell_id);
    if (old_position < 0 || old_position === new_position) return;
    commitOp({
      op: "cell_reorder",
      fwd: { cell_id, old_position, new_position },
      rev: { cell_id, old_position: new_position, new_position: old_position },
    });
  };

  const clearCell = (cell_id: string) => {
    const idx = nb.cells.findIndex((c) => getCellId(c) === cell_id);
    if (idx < 0) return;
    const old_outputs = nb.cells[idx].outputs;
    commitOp({
      op: "clear_cell_outputs",
      fwd: { cell_id, old_outputs },
      rev: { cell_id, old_outputs },
    });
  };

  const runCell = async (cell_id: string) => {
    const idx = nb.cells.findIndex((c) => getCellId(c) === cell_id);
    if (idx < 0) return;
    const src = Array.isArray(nb.cells[idx].source)
      ? (nb.cells[idx].source as string[]).join("")
      : (nb.cells[idx].source as string);
    setCellStates((s) => ({ ...s, [cell_id]: "running" }));
    try {
      const cfg = await ipc.getConfig();
      if (!cfg.python_env) throw new Error("Python env not configured");
      const out = await ipcKernel.execute(slug, cfg.python_env.python_path, src);
      const next: NotebookJson = JSON.parse(JSON.stringify(nb));
      next.cells[idx].outputs = executionResultToOutputs(out);
      next.cells[idx].execution_count = out.execution_count;
      setNb(next);
      debounceSave(next);
      setCellStates((s) => ({
        ...s,
        [cell_id]: out.error ? "error" : "done",
      }));
      setVarsRefreshKey((k) => k + 1);
    } catch (e: any) {
      const next: NotebookJson = JSON.parse(JSON.stringify(nb));
      next.cells[idx].outputs = [
        {
          output_type: "error",
          ename: "Error",
          evalue: String(e),
          traceback: [String(e)],
        },
      ];
      setNb(next);
      debounceSave(next);
      setCellStates((s) => ({ ...s, [cell_id]: "error" }));
    }
  };

  const restartKernel = async () => {
    const cfg = await ipc.getConfig();
    if (!cfg.python_env) return;
    await ipcKernel.restart(slug, cfg.python_env.python_path);
    setLastOp("kernel restart");
    setVarsRefreshKey((k) => k + 1);
  };

  const canUndo = head > 0;
  const canRedo = log.some((e) => (e.seq ?? 0) > head);

  return (
    <div data-testid="project-editor">
      <UndoRedoBar
        canUndo={canUndo}
        canRedo={canRedo}
        lastOpDescription={lastOp}
        onUndo={undo}
        onRedo={redo}
        onBack={onBack}
        projectName={projectName}
        onRestartKernel={restartKernel}
      />
      <DataPanel slug={slug} />
      <VariablePanel slug={slug} refreshKey={varsRefreshKey} />
      <PipelineCanvas
        notebook={nb}
        cellStates={cellStates}
        onAddCard={addCard}
        onRenameCard={renameCard}
        onDeleteCard={deleteCard}
        onReorderCard={reorderCardOp}
        onAddCell={addCell}
        onCellSourceChange={setCellSrc}
        onCellRun={runCell}
        onCellClear={clearCell}
        onCellDelete={deleteCell}
        onReorderCell={reorderCellOp}
      />
    </div>
  );
}
