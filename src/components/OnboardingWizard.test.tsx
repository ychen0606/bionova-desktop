import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OnboardingWizard } from "./OnboardingWizard";

vi.mock("../lib/ipc", () => ({
  ipc: {
    getConfig: vi.fn(async () => ({
      ai_provider: null,
      python_env: null,
      hpcs: [],
    })),
    setConfig: vi.fn(async () => {}),
    keychainSet: vi.fn(async () => {}),
    providerPing: vi.fn(async () => ({
      ok: true,
      model_reported: "claude-sonnet-4-6",
      latency_ms: 123,
    })),
    pythonProbe: vi.fn(async () => [
      {
        python_path: "C:/python.exe",
        source: "system",
        version: "3.11.7",
        has_scanpy: true,
        scanpy_version: "1.10.0",
      },
    ]),
  },
}));

describe("OnboardingWizard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders first step", () => {
    render(<OnboardingWizard onComplete={() => {}} />);
    expect(screen.getByTestId("onboarding")).toBeInTheDocument();
    expect(screen.getByText(/AI Provider/)).toBeInTheDocument();
  });

  it("walks all 3 steps and completes", async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} />);

    fireEvent.change(screen.getByTestId("provider-apikey"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByTestId("provider-next"));

    await waitFor(() =>
      expect(screen.getByText(/Python Environment/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("python-next"));

    await waitFor(() =>
      expect(screen.getByText(/HPC \(optional\)/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("hpc-skip"));

    expect(onComplete).toHaveBeenCalled();
  });
});
