import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewProjectDialog } from "./NewProjectDialog";

describe("NewProjectDialog", () => {
  it("renders when open", () => {
    render(
      <NewProjectDialog open={true} onCancel={() => {}} onCreate={() => {}} />
    );
    expect(screen.getByTestId("new-project-dialog")).toBeInTheDocument();
  });

  it("create button disabled when name empty", () => {
    render(
      <NewProjectDialog open={true} onCancel={() => {}} onCreate={() => {}} />
    );
    expect(screen.getByTestId("np-create")).toBeDisabled();
  });

  it("triggers onCreate with name", () => {
    const cb = vi.fn();
    render(
      <NewProjectDialog open={true} onCancel={() => {}} onCreate={cb} />
    );
    fireEvent.change(screen.getByTestId("np-name"), {
      target: { value: "MyProj" },
    });
    fireEvent.click(screen.getByTestId("np-create"));
    expect(cb).toHaveBeenCalledWith("MyProj");
  });
});
