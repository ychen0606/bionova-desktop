import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonacoCellEditor } from "./MonacoCellEditor";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="monaco-mock"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

describe("MonacoCellEditor", () => {
  it("renders with mocked Monaco", () => {
    render(
      <MonacoCellEditor
        value="print(1)"
        onChange={() => {}}
        onRun={() => {}}
      />
    );
    expect(screen.getByTestId("monaco-host")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-mock")).toHaveValue("print(1)");
  });
});
