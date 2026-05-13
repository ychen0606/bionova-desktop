# BioNova Desktop

AI-driven scRNA-seq IDE for Windows. **Plan 2.5 of 5 — Data Folder + Inspector + UI Rename.**

> Terminology note: BioNova "Step" = one Jupyter-style code block. The biological
> cells in scRNA-seq live inside the `adata` AnnData object loaded by your steps,
> NOT in the UI's "Step" entities.

This release lays the foundation: onboarding wizard, configuration persistence,
typed Tauri ↔ React IPC, and a smoke test that proves the app can spawn a Python
kernel and execute one cell. Pipeline cards, AI engine, and HPC support arrive
in subsequent plans.

## Prerequisites

- Windows 10/11 (production target). Linux / macOS work for code development
  and unit tests but cannot produce the MSI bundle.
- Python 3.10+ with `ipykernel` installed (`pip install ipykernel`).
  For actual scRNA work later: `pip install scanpy anndata scrublet harmonypy leidenalg`.
- An AI API key (Anthropic or OpenAI-compatible).
- For development from source: Node 20+, pnpm 11+, Rust 1.75+, and the
  `x86_64-pc-windows-msvc` target (`rustup target add x86_64-pc-windows-msvc`).

## Run from source

```bash
pnpm install
pnpm approve-builds --all          # one-time, allows esbuild postinstall
pnpm tauri dev
```

On Linux without a display (e.g. headless SSH session), use `pnpm build`
plus `cd src-tauri && cargo check` to verify compilation; the GUI run
requires Windows.

## Build the Windows MSI

On a Windows machine:

```powershell
pnpm install
pnpm tauri build --target x86_64-pc-windows-msvc
```

The installer lands at
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/BioNova_0.1.0_x64_en-US.msi`.
Double-click to install. The app appears in the Start menu as "BioNova".

## What works in this build (v0.2.0-plan2)

**New in Plan 2:**
- Real project CRUD with on-disk `~/BioNova/projects/<slug>/` layout
  (notebook.ipynb + config.json + history.jsonl + artifacts/)
- Multi-cell projects organized as **cards** (collapsible groups of cells)
- Monaco editor with Python syntax highlighting + `Ctrl+Enter` to run
- Cell output rendering: stdout, stderr, image/png, error tracebacks
- Project-level undo/redo (`Ctrl+Alt+Z` / `Ctrl+Alt+Y`) — persistent across sessions
- Atomic notebook writes with `.bak` recovery
- Moved deleted projects to `~/BioNova/.trash/` (30-day grace)

**Carried over from Plan 1:**
- First-launch onboarding wizard (AI provider → Python env → optional HPC)
- Settings pane with re-run wizard
- Two AI provider adapters (Anthropic + OpenAI-compatible, ping/validate)
- Windows Credential Manager via `keyring` crate
- Windows Python detection (Anaconda/Miniconda/Store/PATH)
- ipykernel ZMQ bridge for local execution
- `.github/workflows/ci.yml` cargo test + vitest + MSI build on `windows-2022`

## What is **not** yet implemented

- AI engine integration (plan / generate / fix / interpret prompts) (Plan 3)
- HPC execution via SSH + Slurm (Plan 4)
- AI Output Regression Suite, signed MSI release (Plan 5)
- Variable inspector panel (Plan 5)
- Drag-to-reorder cards/cells (Plan 3)
- Op log compaction (Plan 5)

See `docs/superpowers/specs/2026-05-13-bionova-desktop-design.md` (in the
parent BioNova repo) for the full product spec and roadmap.

## Repository layout

```
bionova-desktop/
├── src/                         React + TypeScript frontend
│   ├── App.tsx                  Top-level router
│   ├── components/              OnboardingWizard, SettingsPane, ProjectShell, CellExecSmoke
│   ├── lib/ipc.ts               Typed wrappers over Tauri commands
│   └── test-setup.ts            jest-dom matchers for vitest
├── src-tauri/                   Rust backend + Tauri shell
│   ├── Cargo.toml
│   ├── tauri.conf.json          Locked to Windows MSI bundle
│   └── src/
│       ├── main.rs
│       ├── lib.rs               Module roots + invoke_handler
│       ├── config.rs            ~/BioNova/config.json reader/writer
│       ├── keychain.rs          OS keychain wrapper (keyring crate)
│       ├── providers/
│       │   ├── mod.rs           LLMProvider trait + PingResult
│       │   ├── anthropic.rs     Anthropic Messages API adapter
│       │   └── openai_compat.rs OpenAI Chat Completions adapter
│       ├── python_probe.rs      Windows Python detection
│       ├── kernel/
│       │   ├── mod.rs           KernelEvent enum
│       │   └── local.rs         ipykernel ZMQ bridge
│       └── commands.rs          8 #[tauri::command] IPC entries
├── .github/workflows/ci.yml     windows-2022 CI
├── vite.config.ts               Tauri-tuned Vite config
├── vitest.config.ts             Separate vitest config (jsdom + setup)
├── tailwind.config.js
└── package.json
```

## Configuration & data locations

- Configuration: `~/BioNova/config.json` (the program creates it on first run).
- Secrets (API keys, SSH credentials): Windows Credential Manager under
  service name `io.bionova.desktop`.
- Project state will live in `~/BioNova/projects/<name>/` starting in Plan 2.

## License

TBD. The intent is to ship as free, open-source software for academic use.
