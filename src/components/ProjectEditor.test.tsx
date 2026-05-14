import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProjectEditor } from "./ProjectEditor";

vi.mock("../lib/ipc", () => ({
  ipc: { getConfig: vi.fn(async () => ({ python_env: { python_path: "x" } })) },
  ipcKernel: {
    execute: vi.fn(async () => ({
      stdout: "",
      stderr: "",
      display_data: [],
      execute_result: null,
      execution_count: 1,
      error: null,
    })),
    restart: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    status: vi.fn(async () => ({ running: false })),
  },
  ipcData: {
    list: vi.fn(async () => []),
    inspect: vi.fn(async () => ({ report: {} })),
  },
  ipcProject: {
    open: vi.fn(async () => ({
      slug: "p",
      op_log_head: 0,
      notebook: {
        metadata: {
          bionova: {
            schema_version: 1,
            project: {
              display_name: "P",
              created_at: "",
              default_kernel: "local",
            },
            cards: [
              {
                id: "c1",
                title: "Card1",
                order: 0,
                collapsed: false,
                ai_generated: false,
              },
            ],
          },
        },
        cells: [],
        nbformat: 4,
        nbformat_minor: 5,
      },
    })),
    opRead: vi.fn(async () => []),
    opAppend: vi.fn(async () => 1),
    opSetHead: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  },
}));

vi.mock("./PipelineCanvas", () => ({
  PipelineCanvas: () => <div data-testid="canvas">canvas</div>,
}));

vi.mock("./DataPanel", () => ({
  DataPanel: () => <div data-testid="data-panel-mock">data-panel</div>,
}));

describe("ProjectEditor", () => {
  it("loads and shows canvas", async () => {
    render(<ProjectEditor slug="p" projectName="P" onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("project-editor")).toBeInTheDocument()
    );
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });
});
