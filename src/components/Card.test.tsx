import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card } from "./Card";

vi.mock("./Step", () => ({
  Step: ({ cell }: any) => <div data-testid="mock-step">{cell.source}</div>,
}));

const mkCard = () => ({
  id: "c1",
  title: "QC",
  order: 0,
  collapsed: false,
  ai_generated: false,
});

const baseHandlers = {
  onRenameCard: vi.fn(),
  onDeleteCard: vi.fn(),
  onAddCell: vi.fn(),
  onCellSourceChange: vi.fn(),
  onCellRun: vi.fn(),
  onCellClear: vi.fn(),
  onCellDelete: vi.fn(),
};

describe("Card", () => {
  it("renders title", () => {
    render(<Card card={mkCard()} cells={[]} cellStates={{}} {...baseHandlers} />);
    expect(screen.getByTestId("card-title")).toHaveTextContent("QC");
  });

  it("click title enters edit mode", () => {
    render(<Card card={mkCard()} cells={[]} cellStates={{}} {...baseHandlers} />);
    fireEvent.click(screen.getByTestId("card-title"));
    expect(screen.getByTestId("card-title-edit")).toBeInTheDocument();
  });

  it("toggle collapses steps", () => {
    render(<Card card={mkCard()} cells={[]} cellStates={{}} {...baseHandlers} />);
    fireEvent.click(screen.getByTestId("card-toggle"));
    expect(screen.queryByTestId("card-add-cell")).not.toBeInTheDocument();
  });

  it("Add step triggers callback", () => {
    const onAddCell = vi.fn();
    render(
      <Card
        card={mkCard()}
        cells={[]}
        cellStates={{}}
        {...baseHandlers}
        onAddCell={onAddCell}
      />
    );
    fireEvent.click(screen.getByTestId("card-add-cell"));
    expect(onAddCell).toHaveBeenCalled();
  });
});
