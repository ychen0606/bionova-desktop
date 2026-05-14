import { useState } from "react";
import { Card } from "./Card";
import { NotebookJson } from "../lib/ipc";
import { StepState } from "./Step";

interface Props {
  notebook: NotebookJson;
  cellStates: Record<string, StepState>;
  onAddCard: () => void;
  onRenameCard: (card_id: string, title: string) => void;
  onDeleteCard: (card_id: string) => void;
  onReorderCard: (card_id: string, new_order: number) => void;
  onAddCell: (card_id: string) => void;
  onCellSourceChange: (cell_id: string, src: string) => void;
  onCellRun: (cell_id: string) => void;
  onCellClear: (cell_id: string) => void;
  onCellDelete: (cell_id: string) => void;
  onReorderCell: (cell_id: string, new_position: number) => void;
}

export function PipelineCanvas(p: Props) {
  const cards = [...(p.notebook.metadata.bionova?.cards ?? [])].sort(
    (a, b) => a.order - b.order
  );
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);

  return (
    <div className="p-4 max-w-4xl mx-auto" data-testid="pipeline-canvas">
      {cards.map((card, idx) => {
        const cells = p.notebook.cells.filter(
          (c) => c.metadata.bionova?.card_id === card.id
        );
        const isDragOver = dragOverCardId === card.id && dragCardId !== card.id;
        return (
          <div
            key={card.id}
            onDragOver={(e) => {
              if (dragCardId) {
                e.preventDefault();
                setDragOverCardId(card.id);
              }
            }}
            onDragLeave={() => {
              if (dragOverCardId === card.id) setDragOverCardId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragCardId && dragCardId !== card.id) {
                p.onReorderCard(dragCardId, idx);
              }
              setDragCardId(null);
              setDragOverCardId(null);
            }}
            className={isDragOver ? "ring-2 ring-blue-400 rounded" : ""}
            data-testid={`card-slot-${card.id}`}
          >
            <Card
              card={card}
              cells={cells}
              cellStates={p.cellStates}
              isDragging={dragCardId === card.id}
              onDragStart={() => setDragCardId(card.id)}
              onDragEnd={() => {
                setDragCardId(null);
                setDragOverCardId(null);
              }}
              onRenameCard={(t) => p.onRenameCard(card.id, t)}
              onDeleteCard={() => p.onDeleteCard(card.id)}
              onAddCell={() => p.onAddCell(card.id)}
              onCellSourceChange={p.onCellSourceChange}
              onCellRun={p.onCellRun}
              onCellClear={p.onCellClear}
              onCellDelete={p.onCellDelete}
              onReorderCell={p.onReorderCell}
              notebookCells={p.notebook.cells}
            />
          </div>
        );
      })}
      <button
        onClick={p.onAddCard}
        className="mt-4 px-3 py-1 bg-blue-600 text-white rounded"
        data-testid="add-card"
      >
        + Add card
      </button>
    </div>
  );
}
