import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsPane } from "./SettingsPane";

vi.mock("../lib/ipc", () => ({
  ipc: {
    getConfig: vi.fn(async () => ({
      ai_provider: {
        kind: "anthropic",
        base_url: "https://api.anthropic.com",
        default_model: "claude-sonnet-4-6",
      },
      python_env: { python_path: "C:/python.exe", conda_env_name: null },
      hpcs: [],
    })),
  },
}));

describe("SettingsPane", () => {
  it("displays loaded config", async () => {
    render(<SettingsPane onRerunWizard={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("settings")).toBeInTheDocument()
    );
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("C:/python.exe")).toBeInTheDocument();
  });

  it("triggers rerun wizard callback", async () => {
    const cb = vi.fn();
    render(<SettingsPane onRerunWizard={cb} />);
    await waitFor(() => screen.getByTestId("rerun-wizard"));
    fireEvent.click(screen.getByTestId("rerun-wizard"));
    expect(cb).toHaveBeenCalled();
  });
});
