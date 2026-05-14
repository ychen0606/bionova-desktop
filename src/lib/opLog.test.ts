import { describe, it, expect } from "vitest";
import { applyForward, applyReverse, Op, newCell, setCellId, getCellId } from "./opLog";
import { NotebookJson, CardMeta } from "./ipc";

function makeNotebook(): NotebookJson {
  const cards: CardMeta[] = [
    { id: "A", title: "QC", order: 0, collapsed: false, ai_generated: false },
    { id: "B", title: "Norm", order: 1, collapsed: false, ai_generated: false },
    { id: "C", title: "Cluster", order: 2, collapsed: false, ai_generated: false },
  ];
  const cells = ["c1", "c2", "c3"].map((id, i) => {
    const cell = newCell("A", `print(${i})`);
    setCellId(cell, id);
    return cell;
  });
  return {
    metadata: {
      bionova: {
        schema_version: 1,
        project: { display_name: "p", created_at: "", default_kernel: "local" },
        cards,
      },
    },
    cells,
    nbformat: 4,
    nbformat_minor: 5,
  };
}

describe("opLog reorder", () => {
  it("card_reorder moves card and renumbers orders", () => {
    const nb = makeNotebook();
    const op: Op = {
      op: "card_reorder",
      fwd: { card_id: "C", old_order: 2, new_order: 0 },
      rev: { card_id: "C", old_order: 0, new_order: 2 },
    };
    const next = applyForward(nb, op);
    const ids = next.metadata.bionova.cards
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => c.id);
    expect(ids).toEqual(["C", "A", "B"]);
    expect(next.metadata.bionova.cards.find((c) => c.id === "C")!.order).toBe(0);
    expect(next.metadata.bionova.cards.find((c) => c.id === "A")!.order).toBe(1);
  });

  it("card_reorder reverse restores prior layout", () => {
    const nb = makeNotebook();
    const op: Op = {
      op: "card_reorder",
      fwd: { card_id: "C", old_order: 2, new_order: 0 },
      rev: { card_id: "C", old_order: 0, new_order: 2 },
    };
    const forward = applyForward(nb, op);
    const back = applyReverse(forward, op);
    expect(
      back.metadata.bionova.cards.sort((a, b) => a.order - b.order).map((c) => c.id)
    ).toEqual(["A", "B", "C"]);
  });

  it("cell_reorder moves cell index forward then reverses", () => {
    const nb = makeNotebook();
    const op: Op = {
      op: "cell_reorder",
      fwd: { cell_id: "c3", old_position: 2, new_position: 0 },
      rev: { cell_id: "c3", old_position: 0, new_position: 2 },
    };
    const next = applyForward(nb, op);
    expect(next.cells.map(getCellId)).toEqual(["c3", "c1", "c2"]);
    const back = applyReverse(next, op);
    expect(back.cells.map(getCellId)).toEqual(["c1", "c2", "c3"]);
  });
});
