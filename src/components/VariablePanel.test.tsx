import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { VariablePanel } from "./VariablePanel";

const inspectMock = vi.fn();

vi.mock("../lib/ipc", () => ({
  ipcKernel: { inspectVars: (...a: any[]) => inspectMock(...a) },
}));

describe("VariablePanel", () => {
  it("shows empty state when kernel has no user vars", async () => {
    inspectMock.mockResolvedValueOnce([]);
    render(<VariablePanel slug="p" refreshKey={0} />);
    await waitFor(() => screen.getByText(/Kernel variables \(0\)/));
    expect(screen.getByText(/No user variables yet/i)).toBeInTheDocument();
  });

  it("renders a row per VarInfo", async () => {
    inspectMock.mockResolvedValueOnce([
      {
        name: "adata",
        type_name: "AnnData",
        shape: [500, 2000],
        dtype: null,
        repr_short: "AnnData object with n_obs × n_vars = 500 × 2000",
      },
      {
        name: "x",
        type_name: "int",
        shape: null,
        dtype: null,
        repr_short: "42",
      },
    ]);
    render(<VariablePanel slug="p" refreshKey={0} />);
    await waitFor(() => screen.getByTestId("var-row-adata"));
    expect(screen.getByTestId("var-row-adata")).toHaveTextContent("AnnData");
    expect(screen.getByTestId("var-row-adata")).toHaveTextContent("500 × 2000");
    expect(screen.getByTestId("var-row-x")).toHaveTextContent("42");
  });

  it("refreshes when the key changes", async () => {
    inspectMock.mockResolvedValue([]);
    const { rerender } = render(<VariablePanel slug="p" refreshKey={0} />);
    await waitFor(() => screen.getByText(/Kernel variables/));
    inspectMock.mockClear();
    rerender(<VariablePanel slug="p" refreshKey={1} />);
    await waitFor(() => expect(inspectMock).toHaveBeenCalledTimes(1));
  });

  it("manual refresh button triggers inspect", async () => {
    inspectMock.mockResolvedValue([]);
    render(<VariablePanel slug="p" refreshKey={0} />);
    await waitFor(() => screen.getByText(/Kernel variables/));
    inspectMock.mockClear();
    fireEvent.click(screen.getByTestId("vars-refresh"));
    await waitFor(() => expect(inspectMock).toHaveBeenCalledTimes(1));
  });
});
