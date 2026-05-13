import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CellExecSmoke } from "./CellExecSmoke";

vi.mock("../lib/ipc", () => ({
  ipc: {
    getConfig: vi.fn(async () => ({
      ai_provider: null,
      python_env: { python_path: "C:/python.exe", conda_env_name: null },
      hpcs: [],
    })),
    runSmokeCell: vi.fn(async () => "hello from BioNova\n"),
  },
}));

describe("CellExecSmoke", () => {
  it("renders and runs", async () => {
    render(<CellExecSmoke onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("smoke-run"));
    await waitFor(() =>
      expect(screen.getByTestId("smoke-output")).toHaveTextContent(
        "hello from BioNova"
      )
    );
  });
});
