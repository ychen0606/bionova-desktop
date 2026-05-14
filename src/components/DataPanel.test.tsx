import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataPanel } from "./DataPanel";

const reportByName: Record<string, any> = {
  "pbmc3k.h5ad": {
    kind: "h5ad",
    n_cells: 2700,
    n_genes: 32738,
    obs_columns: ["cell_type", "n_genes_by_counts"],
    var_columns: ["gene_ids", "feature_types"],
    layers: ["counts"],
    obsm_keys: ["X_pca", "X_umap"],
    obs_head: [{ cell_type: "T", n_genes_by_counts: 1200 }],
  },
  "metadata.csv": {
    kind: "csv",
    n_rows_first_500k: 99,
    columns: ["sample_id", "treatment", "donor"],
    preview_rows: [["S1", "ctrl", "d1"], ["S2", "drug", "d1"]],
  },
};

vi.mock("../lib/ipc", () => ({
  ipcData: {
    list: vi.fn(async () => [
      {
        name: "pbmc3k.h5ad",
        size_bytes: 32 * 1024 * 1024,
        modified_unix_secs: 1747000000,
        kind_hint: "h5ad",
      },
      {
        name: "metadata.csv",
        size_bytes: 1024,
        modified_unix_secs: 1747000000,
        kind_hint: "csv",
      },
    ]),
    inspect: vi.fn(async (_slug: string, name: string) => ({
      report: reportByName[name],
    })),
  },
}));

describe("DataPanel", () => {
  it("lists files from data folder grouped by kind", async () => {
    render(<DataPanel slug="demo" />);
    await waitFor(() =>
      expect(screen.getByText(/pbmc3k\.h5ad/)).toBeInTheDocument()
    );
    expect(screen.getByTestId("data-group-h5ad")).toBeInTheDocument();
    expect(screen.getByTestId("data-group-csv")).toBeInTheDocument();
  });

  it("inspects file on click and shows shape", async () => {
    render(<DataPanel slug="demo" />);
    await waitFor(() => screen.getByText(/pbmc3k\.h5ad/));
    fireEvent.click(screen.getByTestId("data-inspect-pbmc3k.h5ad"));
    await waitFor(() =>
      expect(screen.getByText(/2,700 cells × 32,738 genes/)).toBeInTheDocument()
    );
  });

  it("Inspect-all batches every file", async () => {
    render(<DataPanel slug="demo" />);
    await waitFor(() => screen.getByText(/pbmc3k\.h5ad/));
    fireEvent.click(screen.getByTestId("data-inspect-all"));
    await waitFor(() =>
      expect(screen.getByText(/2,700 cells × 32,738 genes/)).toBeInTheDocument()
    );
    // CSV report rendered too
    await waitFor(() => expect(screen.getByTestId("preview-table")).toBeInTheDocument());
  });

  it("CSV report shows preview table rows", async () => {
    render(<DataPanel slug="demo" />);
    await waitFor(() => screen.getByText(/metadata\.csv/));
    fireEvent.click(screen.getByTestId("data-inspect-metadata.csv"));
    await waitFor(() => expect(screen.getByTestId("preview-table")).toBeInTheDocument());
    expect(screen.getByText("ctrl")).toBeInTheDocument();
    expect(screen.getByText("drug")).toBeInTheDocument();
  });
});
