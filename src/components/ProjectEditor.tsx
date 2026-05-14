import { useEffect, useState, useCallback, useRef } from "react";
import { v4 as uuid } from "uuid";
import {
  ipc,
  ipcAI,
  ipcData,
  ipcKernel,
  ipcProject,
  CardSpec,
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
import { AIChat } from "./AIChat";
import { AutopilotPanel } from "./AutopilotPanel";
import { StepState } from "./Step";

function buildAdataStateString(meta: Record<string, string>): string {
  const parts: string[] = [];
  if (meta.n_obs && meta.n_vars) parts.push(`shape: ${meta.n_obs} cells × ${meta.n_vars} genes`);
  if (meta.obs_columns) parts.push(`obs cols: [${meta.obs_columns}]`);
  if (meta.var_columns) parts.push(`var cols: [${meta.var_columns}]`);
  if (meta.layers) parts.push(`layers: [${meta.layers}]`);
  if (meta.obsm_keys) parts.push(`obsm: [${meta.obsm_keys}]`);
  if (parts.length === 0) parts.push("(empty AnnData state; first card should sc.read_h5ad)");
  return parts.join("; ");
}

function makeLoadCellCode(slug: string, fileName: string): string {
  // POSIX-style joined path; works on Win too because Python normalizes.
  const escaped = fileName.replace(/"/g, '\\"');
  const slugEsc = slug.replace(/"/g, '\\"');
  return `import os, scanpy as sc

DATA_DIR = os.path.expanduser("~/BioNova/projects/${slugEsc}/data")
adata = sc.read_h5ad(os.path.join(DATA_DIR, "${escaped}"))
print(adata)
print("obs cols:", list(adata.obs.columns))
print("var cols:", list(adata.var.columns))`;
}

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
    const cardId = nb.cells[idx].metadata.bionova?.card_id ?? "";
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

      // Autopilot Fix Loop: if this cell belongs to an AI-generated card and
      // the run errored, ask AI for a corrected version up to 5 rounds.
      if (out.error) {
        const card = nb.metadata.bionova.cards.find((c) => c.id === cardId);
        if (card?.ai_generated) {
          await tryAutoFix(cell_id, src, out.error, cfg.python_env.python_path, cardId);
        }
      }
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

  // Up to 5 attempts: ask AI for a fix, replace cell source, re-run.
  const tryAutoFix = async (
    cell_id: string,
    originalSrc: string,
    initialError: { ename: string; evalue: string; traceback: string[] },
    pythonPath: string,
    card_id: string
  ) => {
    const priorAttempts: Array<{ code: string; error: string }> = [];
    let lastCode = originalSrc;
    let lastErr = `${initialError.ename}: ${initialError.evalue}`;
    for (let round = 1; round <= 5; round++) {
      setCellStates((s) => ({ ...s, [cell_id]: "running" }));
      const aiResp = await ipcAI.fixError({
        card_id,
        original_code: lastCode,
        error_message: lastErr,
        var_snapshot: "(see kernel)",
        prior_attempts: priorAttempts
          .map((a, i) => `attempt ${i + 1}: ${a.error}`)
          .join("\n") || "(none)",
      });
      const fixedCode = aiResp.text.trim();
      if (!fixedCode || fixedCode === lastCode) break;
      // Commit cell_content_set so undo can revert.
      const idxNow = nb.cells.findIndex((c) => getCellId(c) === cell_id);
      if (idxNow < 0) break;
      const oldSrc = Array.isArray(nb.cells[idxNow].source)
        ? (nb.cells[idxNow].source as string[]).join("")
        : (nb.cells[idxNow].source as string);
      await commitOp({
        op: "cell_content_set",
        fwd: { cell_id, new_source: fixedCode },
        rev: { cell_id, old_source: oldSrc },
      });
      const out = await ipcKernel.execute(slug, pythonPath, fixedCode);
      const next: NotebookJson = JSON.parse(JSON.stringify(nb));
      const idx2 = next.cells.findIndex((c) => getCellId(c) === cell_id);
      if (idx2 >= 0) {
        next.cells[idx2].outputs = executionResultToOutputs(out);
        next.cells[idx2].execution_count = out.execution_count;
        next.cells[idx2].source = fixedCode;
      }
      setNb(next);
      debounceSave(next);
      setVarsRefreshKey((k) => k + 1);
      if (!out.error) {
        setCellStates((s) => ({ ...s, [cell_id]: "done" }));
        setLastOp(`autofix succeeded on round ${round}`);
        return;
      }
      priorAttempts.push({ code: fixedCode, error: `${out.error.ename}: ${out.error.evalue}` });
      lastCode = fixedCode;
      lastErr = `${out.error.ename}: ${out.error.evalue}`;
    }
    setCellStates((s) => ({ ...s, [cell_id]: "error" }));
    setLastOp("autofix exhausted (5 rounds)");
  };

  const applyAutopilotPlan = async (
    cards: CardSpec[],
    metadata: Record<string, string>
  ) => {
    // Step A: insert a system "Load data" card with concrete code that loads
    //   the chosen file into `adata`. This lets every AI card after it
    //   assume `adata` exists. (Without this the AI has no idea what file
    //   to read, so the very first generated cell tends to fail.)
    // Step B: for each AI-proposed card, insert it and call generateCode
    //   passing the REAL adata shape/obs/var/layers as `adata_state`.
    let cardCursor = nb.metadata.bionova.cards.length;
    let cellCursor = nb.cells.length;
    const prevSummaries: string[] = [];

    const dataFileName = metadata.data_file_name;
    const adataStateString = buildAdataStateString(metadata);

    if (dataFileName) {
      const loadCard: CardMeta = {
        id: uuid(),
        title: "📥 加载数据",
        order: cardCursor++,
        collapsed: false,
        ai_generated: false,
      };
      await commitOp({
        op: "card_insert",
        fwd: { card: loadCard },
        rev: { card_id: loadCard.id },
      });
      const loadCode = makeLoadCellCode(slug, dataFileName);
      const cell = newCell(loadCard.id, loadCode);
      const cellId = getCellId(cell);
      await commitOp({
        op: "cell_insert",
        fwd: {
          cell_id: cellId,
          position: cellCursor++,
          card_id: loadCard.id,
          source: loadCode,
        },
        rev: { cell_id: cellId },
      });
      prevSummaries.push(`load_data: 把 ${dataFileName} 读入 adata`);
    }

    for (const spec of cards) {
      const cardMeta: CardMeta = {
        id: uuid(),
        title: spec.title,
        order: cardCursor++,
        collapsed: false,
        ai_generated: true,
      };
      await commitOp({
        op: "card_insert",
        fwd: { card: cardMeta },
        rev: { card_id: cardMeta.id },
      });
      const codeResp = await ipcAI.generateCode(
        {
          card_id: spec.id,
          card_title: spec.title,
          prev_summaries: prevSummaries.join("; ") || "(none)",
          adata_state: adataStateString,
          scanpy_version: "1.x",
        },
        4096
      );
      const chunks = codeResp.text.split(/^# *---NEW CELL---\s*$/m);
      for (const code of chunks) {
        const trimmed = code.trim();
        if (!trimmed) continue;
        const cell = newCell(cardMeta.id, trimmed);
        const cellId = getCellId(cell);
        await commitOp({
          op: "cell_insert",
          fwd: {
            cell_id: cellId,
            position: cellCursor++,
            card_id: cardMeta.id,
            source: trimmed,
          },
          rev: { cell_id: cellId },
        });
      }
      prevSummaries.push(`${spec.id}: ${spec.title}`);
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
      {nb.cells.length === 0 && (
        <AutopilotPanel
          fetchAnnDataVars={async () => {
            const files = await ipcData.list(slug);
            const h5ad = files.find((f) => f.kind_hint === "h5ad");
            if (h5ad) {
              const r = await ipcData.inspect(slug, h5ad.name);
              const rep: any = r.report;
              return {
                n_obs: String(rep.n_cells ?? "?"),
                n_vars: String(rep.n_genes ?? "?"),
                obs_columns: (rep.obs_columns ?? []).join(", "),
                var_columns: (rep.var_columns ?? []).join(", "),
                layers: (rep.layers ?? []).join(", "),
                obsm_keys: (rep.obsm_keys ?? []).join(", "),
                source_hint: `h5ad: ${h5ad.name}`,
                user_intent: "",
                // applyAutopilotPlan uses these; plan.md ignores unknown keys.
                data_file_name: h5ad.name,
              };
            }
            // No h5ad — describe what is there.
            return {
              n_obs: "?",
              n_vars: "?",
              obs_columns: "",
              var_columns: "",
              layers: "",
              obsm_keys: "",
              source_hint: files.map((f) => `${f.kind_hint}:${f.name}`).join(", ") || "(empty)",
              user_intent: "",
              data_file_name: "",
            };
          }}
          onPlanAccepted={async (cards, metadata) => {
            await applyAutopilotPlan(cards, metadata);
          }}
        />
      )}
      <VariablePanel slug={slug} refreshKey={varsRefreshKey} />
      <AIChat
        slug={slug}
        projectName={projectName}
        notebook={nb}
        focusedCellId={null}
        varsRefreshKey={varsRefreshKey}
        fetchVarSnapshot={async () => {
          const vars = await ipcKernel.inspectVars(slug);
          if (vars.length === 0) return "(empty)";
          return vars
            .slice(0, 8)
            .map((v) => `${v.name}:${v.type_name}${v.shape ? `[${v.shape.join("×")}]` : ""}`)
            .join(", ");
        }}
        onApplyPatch={(cell_id, new_source) => setCellSrc(cell_id, new_source)}
      />
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
