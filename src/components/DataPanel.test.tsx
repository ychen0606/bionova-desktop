import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataPanel } from "./DataPanel";

vi.mock("../lib/ipc", () => ({
  ipcData: {
    list: vi.fn(async () => [
      {
        name: "pbmc3k.h5ad",
        size_bytes: 32 * 1024 * 1024,
        modified_unix_secs: 1747000000,
        kind_hint: "h5ad",
      },
    ]),
    inspect: vi.fn(async () => ({
      report: {
        kind: "h5ad",
        n_cells: 2700,
        n_genes: 32738,
        obs_columns: ["cell_type", "n_genes_by_counts"],
        var_columns: ["gene_ids", "feature_types"],
        layers: ["counts"],
        obsm_keys: ["X_pca", "X_umap"],
      },
    })),
  },
}));

describe("DataPanel", () => {
  it("lists files from data folder", async () => {
    render(<DataPanel slug="demo" />);
    await waitFor(() =>
      expect(screen.getByText(/pbmc3k\.h5ad/)).toBeInTheDocument()
    );
  });

  it("inspects file on click and shows shape", async () => {
    render(<DataPanel slug="demo" />);
    await waitFor(() => screen.getByText(/pbmc3k\.h5ad/));
    fireEvent.click(screen.getByTestId("data-inspect-pbmc3k.h5ad"));
    await waitFor(() =>
      expect(screen.getByText(/2,700 cells × 32,738 genes/)).toBeInTheDocument()
    );
  });
});
