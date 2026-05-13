import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectShell } from "./ProjectShell";

vi.mock("../lib/ipc", () => ({
  ipcProject: {
    list: vi.fn(async () => [
      {
        slug: "demo",
        display_name: "Demo",
        last_opened_at: "2026-05-14T00:00:00Z",
        created_at: "2026-05-14T00:00:00Z",
      },
    ]),
    create: vi.fn(async (name: string) => ({
      slug: name.toLowerCase(),
      display_name: name,
      last_opened_at: "",
      created_at: "",
    })),
    delete: vi.fn(async () => {}),
  },
}));

describe("ProjectShell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists existing projects", async () => {
    render(<ProjectShell onOpenSettings={() => {}} onOpenProject={() => {}} />);
    await waitFor(() => expect(screen.getByText("Demo")).toBeInTheDocument());
  });

  it("settings button works", async () => {
    const cb = vi.fn();
    render(<ProjectShell onOpenSettings={cb} onOpenProject={() => {}} />);
    fireEvent.click(screen.getByTestId("open-settings"));
    expect(cb).toHaveBeenCalled();
  });

  it("create project opens dialog", async () => {
    render(<ProjectShell onOpenSettings={() => {}} onOpenProject={() => {}} />);
    fireEvent.click(screen.getByTestId("open-new"));
    expect(screen.getByTestId("new-project-dialog")).toBeInTheDocument();
  });
});
