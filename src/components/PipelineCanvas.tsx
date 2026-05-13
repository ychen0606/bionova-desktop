import { Card } from "./Card";
import { NotebookJson } from "../lib/ipc";
import { CellState } from "./Cell";

interface Props {
  notebook: NotebookJson;
  cellStates: Record<string, CellState>;
  onAddCard: () => void;
  onRenameCard: (card_id: string, title: string) => void;
  onDeleteCard: (card_id: string) => void;
  onAddCell: (card_id: string) => void;
  onCellSourceChange: (cell_id: string, src: string) => void;
  onCellRun: (cell_id: string) => void;
  onCellClear: (cell_id: string) => void;
  onCellDelete: (cell_id: string) => void;
}

export function PipelineCanvas(p: Props) {
  const cards = [...(p.notebook.metadata.bionova?.cards ?? [])].sort(
    (a, b) => a.order - b.order
  );
  return (
    <div className="p-4 max-w-4xl mx-auto" data-testid="pipeline-canvas">
      {cards.map((card) => {
        const cells = p.notebook.cells.filter(
          (c) => c.metadata.bionova?.card_id === card.id
        );
        return (
          <Card
            key={card.id}
            card={card}
            cells={cells}
            cellStates={p.cellStates}
            onRenameCard={(t) => p.onRenameCard(card.id, t)}
            onDeleteCard={() => p.onDeleteCard(card.id)}
            onAddCell={() => p.onAddCell(card.id)}
            onCellSourceChange={p.onCellSourceChange}
            onCellRun={p.onCellRun}
            onCellClear={p.onCellClear}
            onCellDelete={p.onCellDelete}
          />
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
