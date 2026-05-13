import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Step } from "./Step";

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

describe("Step", () => {
  it("renders source and step label", () => {
    render(
      <Step
        cell={mkCell("x=1")}
        state="idle"
        index={3}
        onSourceChange={() => {}}
        onRun={() => {}}
        onClear={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByTestId("mock-editor")).toHaveTextContent("x=1");
    expect(screen.getByText(/Step 3/)).toBeInTheDocument();
  });

  it("Run button triggers callback", () => {
    const onRun = vi.fn();
    render(
      <Step
        cell={mkCell()}
        state="idle"
        index={1}
        onSourceChange={() => {}}
        onRun={onRun}
        onClear={() => {}}
        onDelete={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("step-run"));
    expect(onRun).toHaveBeenCalled();
  });

  it("disables Run while running", () => {
    render(
      <Step
        cell={mkCell()}
        state="running"
        index={1}
        onSourceChange={() => {}}
        onRun={() => {}}
        onClear={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByTestId("step-run")).toBeDisabled();
  });
});
