import { v4 as uuid } from "uuid";
import { CellJson, CardMeta, NotebookJson } from "./ipc";

export type Op =
  | {
      op: "cell_content_set";
      fwd: { cell_id: string; new_source: string };
      rev: { cell_id: string; old_source: string };
    }
  | {
      op: "cell_insert";
      fwd: { cell_id: string; position: number; card_id: string; source: string };
      rev: { cell_id: string };
    }
  | {
      op: "cell_delete";
      fwd: { cell_id: string; cell: CellJson; position: number };
      rev: { cell: CellJson; position: number };
    }
  | {
      op: "card_insert";
      fwd: { card: CardMeta };
      rev: { card_id: string };
    }
  | {
      op: "card_delete";
      fwd: { card: CardMeta; cells: CellJson[] };
      rev: { card: CardMeta; cells: CellJson[] };
    }
  | {
      op: "card_rename";
      fwd: { card_id: string; old_title: string; new_title: string };
      rev: { card_id: string; old_title: string; new_title: string };
    }
  | {
      op: "clear_cell_outputs";
      fwd: { cell_id: string; old_outputs: any[] };
      rev: { cell_id: string; old_outputs: any[] };
    };

export function getCellId(cell: CellJson): string {
  return cell.metadata.bionova_cell_id ?? "";
}

export function setCellId(cell: CellJson, id: string) {
  cell.metadata.bionova_cell_id = id;
}

export function newCell(card_id: string, source = ""): CellJson {
  const cell: CellJson = {
    cell_type: "code",
    source,
    outputs: [],
    execution_count: null,
    metadata: {
      bionova: { card_id, target_kernel: "local", ai_generated: false },
      bionova_cell_id: uuid(),
    },
  };
  return cell;
}

export function applyForward(nb: NotebookJson, op: Op): NotebookJson {
  const clone: NotebookJson = JSON.parse(JSON.stringify(nb));
  switch (op.op) {
    case "cell_content_set": {
      const idx = clone.cells.findIndex((c) => getCellId(c) === op.fwd.cell_id);
      if (idx >= 0) clone.cells[idx].source = op.fwd.new_source;
      break;
    }
    case "cell_insert": {
      const cell = newCell(op.fwd.card_id, op.fwd.source);
      setCellId(cell, op.fwd.cell_id);
      clone.cells.splice(op.fwd.position, 0, cell);
      break;
    }
    case "cell_delete": {
      clone.cells.splice(op.fwd.position, 1);
      break;
    }
    case "card_insert": {
      clone.metadata.bionova.cards.push(op.fwd.card);
      break;
    }
    case "card_delete": {
      clone.metadata.bionova.cards = clone.metadata.bionova.cards.filter(
        (c) => c.id !== op.fwd.card.id
      );
      clone.cells = clone.cells.filter(
        (c) => c.metadata.bionova?.card_id !== op.fwd.card.id
      );
      break;
    }
    case "card_rename": {
      const card = clone.metadata.bionova.cards.find(
        (c) => c.id === op.fwd.card_id
      );
      if (card) card.title = op.fwd.new_title;
      break;
    }
    case "clear_cell_outputs": {
      const idx = clone.cells.findIndex((c) => getCellId(c) === op.fwd.cell_id);
      if (idx >= 0) clone.cells[idx].outputs = [];
      break;
    }
  }
  return clone;
}

export function applyReverse(nb: NotebookJson, op: Op): NotebookJson {
  const clone: NotebookJson = JSON.parse(JSON.stringify(nb));
  switch (op.op) {
    case "cell_content_set": {
      const idx = clone.cells.findIndex((c) => getCellId(c) === op.rev.cell_id);
      if (idx >= 0) clone.cells[idx].source = op.rev.old_source;
      break;
    }
    case "cell_insert": {
      clone.cells = clone.cells.filter((c) => getCellId(c) !== op.rev.cell_id);
      break;
    }
    case "cell_delete": {
      clone.cells.splice(op.rev.position, 0, op.rev.cell);
      break;
    }
    case "card_insert": {
      clone.metadata.bionova.cards = clone.metadata.bionova.cards.filter(
        (c) => c.id !== op.rev.card_id
      );
      break;
    }
    case "card_delete": {
      clone.metadata.bionova.cards.push(op.rev.card);
      clone.cells.push(...op.rev.cells);
      break;
    }
    case "card_rename": {
      const card = clone.metadata.bionova.cards.find(
        (c) => c.id === op.rev.card_id
      );
      if (card) card.title = op.rev.old_title;
      break;
    }
    case "clear_cell_outputs": {
      const idx = clone.cells.findIndex((c) => getCellId(c) === op.rev.cell_id);
      if (idx >= 0) clone.cells[idx].outputs = op.rev.old_outputs;
      break;
    }
  }
  return clone;
}
