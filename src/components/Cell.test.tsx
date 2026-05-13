import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Cell } from "./Cell";

vi.mock("./MonacoCellEditor", () => ({
  MonacoCellEditor: ({ value }: any) => (
    <pre data-testid="mock-editor">{value}</pre>
  ),
}));

const mkCell = (src = "print(1)") => ({
  cell_type: "code" as const,
  source: src,
  outputs: [],
  execution_count: null,
  metadata: { bionova: { card_id: "c1" }, bionova_cell_id: "u1" } as any,
});

describe("Cell", () => {
  it("renders source", () => {
    render(
      <Cell
        cell={mkCell("x=1")}
        state="idle"
        onSourceChange={() => {}}
        onRun={() => {}}
        onClear={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByTestId("mock-editor")).toHaveTextContent("x=1");
  });

  it("Run button triggers callback", () => {
    const onRun = vi.fn();
    render(
      <Cell
        cell={mkCell()}
        state="idle"
        onSourceChange={() => {}}
        onRun={onRun}
        onClear={() => {}}
        onDelete={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("cell-run"));
    expect(onRun).toHaveBeenCalled();
  });

  it("disables Run while running", () => {
    render(
      <Cell
        cell={mkCell()}
        state="running"
        onSourceChange={() => {}}
        onRun={() => {}}
        onClear={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByTestId("cell-run")).toBeDisabled();
  });
});
