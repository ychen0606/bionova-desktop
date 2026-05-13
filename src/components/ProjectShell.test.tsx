import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectShell } from "./ProjectShell";

describe("ProjectShell", () => {
  it("renders shell", () => {
    render(
      <ProjectShell onOpenSettings={() => {}} onOpenSmokeTest={() => {}} />
    );
    expect(screen.getByTestId("project-shell")).toBeInTheDocument();
  });

  it("settings button calls callback", () => {
    const cb = vi.fn();
    render(<ProjectShell onOpenSettings={cb} onOpenSmokeTest={() => {}} />);
    fireEvent.click(screen.getByTestId("open-settings"));
    expect(cb).toHaveBeenCalled();
  });

  it("smoke button calls callback", () => {
    const cb = vi.fn();
    render(<ProjectShell onOpenSettings={() => {}} onOpenSmokeTest={cb} />);
    fireEvent.click(screen.getByTestId("open-smoke"));
    expect(cb).toHaveBeenCalled();
  });
});
