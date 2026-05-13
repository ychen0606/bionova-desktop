import { useEffect, useState, useCallback, useRef } from "react";
import { v4 as uuid } from "uuid";
import {
  ipc,
  ipcProject,
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
import { CellState } from "./Cell";

interface Props {
  slug: string;
  projectName: string;
  onBack: () => void;
}

export function ProjectEditor({ slug, projectName, onBack }: Props) {
  const [nb, setNb] = useState<NotebookJson | null>(null);
  const [log, setLog] = useState<OpEntry[]>([]);
  const [head, setHead] = useState<number>(0);
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});
  const [lastOp, setLastOp] = useState<string>("");
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
      const out = await ipc.runSmokeCell(cfg.python_env.python_path, src);
      const next: NotebookJson = JSON.parse(JSON.stringify(nb));
      next.cells[idx].outputs = [
        { output_type: "stream", name: "stdout", text: out },
      ];
      next.cells[idx].execution_count =
        (next.cells[idx].execution_count ?? 0) + 1;
      setNb(next);
      debounceSave(next);
      setCellStates((s) => ({ ...s, [cell_id]: "done" }));
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
      />
      <PipelineCanvas
        notebook={nb}
        cellStates={cellStates}
        onAddCard={addCard}
        onRenameCard={renameCard}
        onDeleteCard={deleteCard}
        onAddCell={addCell}
        onCellSourceChange={setCellSrc}
        onCellRun={runCell}
        onCellClear={clearCell}
        onCellDelete={deleteCell}
      />
    </div>
  );
}
