"""Inspect a data file and emit a JSON metadata report.

Used by the BioNova Rust backend via subprocess. Single-line JSON to stdout.
Robust: any exception is caught and emitted as kind='error'.
"""
import sys
import os
import json


def inspect(path: str) -> dict:
    ext = os.path.splitext(path)[1].lower()
    size = os.path.getsize(path)

    if ext == ".h5ad":
        return inspect_h5ad(path, size)
    if ext == ".h5":
        return inspect_10x_h5(path, size)
    if ext == ".mtx":
        return inspect_mtx(path, size)
    if ext == ".gz" and path.lower().endswith(".mtx.gz"):
        return inspect_mtx(path, size, gz=True)
    if ext in (".csv", ".tsv", ".txt"):
        return inspect_table(path, size, ext)
    return {"kind": "unknown", "size_bytes": size}


def inspect_h5ad(path: str, size: int) -> dict:
    import anndata
    a = anndata.read_h5ad(path, backed="r")
    out = {
        "kind": "h5ad",
        "size_bytes": size,
        "n_cells": int(a.n_obs),
        "n_genes": int(a.n_vars),
        "obs_columns": list(map(str, a.obs.columns))[:60],
        "var_columns": list(map(str, a.var.columns))[:60],
        "layers": list(a.layers.keys()),
        "obsm_keys": list(a.obsm.keys()),
        "uns_keys": list(a.uns.keys())[:30],
    }
    try:
        a.file.close()
    except Exception:
        pass
    return out


def inspect_10x_h5(path: str, size: int) -> dict:
    import h5py
    with h5py.File(path, "r") as f:
        keys = list(f.keys())
        if "matrix" in keys:
            m = f["matrix"]
            shape = m["shape"][:].tolist() if "shape" in m else None
            features = list(m["features"].keys()) if "features" in m else []
            return {
                "kind": "10x_h5",
                "size_bytes": size,
                "matrix_shape": shape,
                "feature_groups": features,
            }
        return {
            "kind": "h5_generic",
            "size_bytes": size,
            "top_keys": keys[:20],
        }


def inspect_mtx(path: str, size: int, gz: bool = False) -> dict:
    opener = (lambda p: __import__("gzip").open(p, "rt")) if gz else (lambda p: open(p))
    with opener(path) as f:
        header = f.readline().strip()
        dims = None
        for line in f:
            if line.startswith("%"):
                continue
            parts = line.strip().split()
            if len(parts) >= 2:
                dims = [int(parts[0]), int(parts[1])]
            break
    return {
        "kind": "mtx",
        "size_bytes": size,
        "shape": dims,
        "header": header[:120],
    }


def inspect_table(path: str, size: int, ext: str) -> dict:
    sep = "," if ext == ".csv" else "\t"
    cols = []
    n_rows = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        header = f.readline().strip()
        cols = header.split(sep)[:30]
        for _ in f:
            n_rows += 1
            if n_rows > 500_000:
                break
    return {
        "kind": "csv" if ext == ".csv" else "tsv" if ext == ".tsv" else "txt",
        "size_bytes": size,
        "n_rows_first_500k": n_rows,
        "columns": cols,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"kind": "error", "error": "usage: inspect_data.py <file>"}))
        return 1
    path = sys.argv[1]
    if not os.path.exists(path):
        print(json.dumps({"kind": "error", "error": "file_not_found"}))
        return 1
    try:
        report = inspect(path)
    except ImportError as e:
        report = {"kind": "needs_dep", "error": str(e),
                  "hint": "pip install anndata h5py"}
    except Exception as e:
        report = {"kind": "error", "error": str(e), "type": type(e).__name__}
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
