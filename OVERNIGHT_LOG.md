# Overnight Self-Drive Log

> Started: 2026-05-13 17:30 UTC (1:30 AM Beijing)
> Last updated: 2026-05-13 22:35 UTC (6:35 AM Beijing)

## ✅ Done (autonomous)

### Plan 2 — IDE Shell
- [x] **Brainstorm**: 5-decision self-Q&A folded into spec
- [x] **Spec doc**: `bionova/docs/superpowers/specs/2026-05-14-plan-2-ide-shell-design.md` (370 lines, 11 sections)
- [x] **Plan doc**: `bionova/docs/superpowers/plans/2026-05-14-plan-2-ide-shell.md` (14 tasks, TDD)
- [x] **Backend code** (commit `9fcc799`): notebook.rs + project.rs + op_log.rs + 8 IPC commands
- [x] **Frontend code** (commit `419243e`): MonacoCellEditor / Outputs / Cell / Card / PipelineCanvas / UndoRedoBar / ProjectEditor / NewProjectDialog + rewrote ProjectShell + App routing + version bump 0.2.0 + README
- [x] **Cargo.lock fix** (commit `2844600`): re-locked after version bump (first CI run failed on --locked check)
- [x] Tag `v0.2.0-plan2` pushed
- [⏳] **CI** run #25830056816: passed steps 1-9, currently on Rust unit tests step #10 (the big compile). ETA ~10 min.

**Tests passing locally (Linux)**:
- Rust: 23 (was 13 in Plan 1; new: 4 notebook + 4 project + 2 op_log)
- TypeScript: 25 (was 9; new: 1 sanity + 1 Monaco + 4 Outputs + 3 Cell + 4 Card + 1 ProjectEditor + 3 NewProjectDialog + 3 ProjectShell + already-existing 5)

### Plan 3 — AI Engine (spec + plan only, no code)
- [x] `bionova/docs/superpowers/specs/2026-05-14-plan-3-ai-engine-design.md` (10 sections, 5 prompt templates drafted in §2, 5 `<DECISION_NEEDED>` flagged)
- [x] `bionova/docs/superpowers/plans/2026-05-14-plan-3-ai-engine.md` (13 tasks)

### Plan 4 — HPC SlurmKernel (spec + plan only, no code)
- [x] `bionova/docs/superpowers/specs/2026-05-14-plan-4-hpc-slurm-design.md` (10 sections, 5 `<DECISION_NEEDED>` flagged)
- [x] `bionova/docs/superpowers/plans/2026-05-14-plan-4-hpc-slurm.md` (10 tasks)

### Plan 5 — Polish & Release (spec + plan only, no code)
- [x] `bionova/docs/superpowers/specs/2026-05-14-plan-5-polish-release-design.md` (10 sections, 5 `<DECISION_NEEDED>` flagged)
- [x] `bionova/docs/superpowers/plans/2026-05-14-plan-5-polish-release.md` (10 tasks)

## ⏳ Still in progress

- Plan 2 CI re-run (started 22:27 UTC, ETA 22:40 UTC on success)
- After CI green: download MSI artifact → SCP to 192.168.2.116:Desktop
- Memory + OVERNIGHT_LOG final update

## 🚨 `<DECISION_NEEDED>` — Morning Review Backlog

### Plan 3
1. Prompt language style (Chinese-default? all-English?)
2. Default model bindings (Sonnet 4.6 as house base?)
3. Pricing table: in-binary vs editable JSON?
4. `<bionova_patch>` chat syntax OK?
5. Cmd+K rewrite scope: selection-only vs allow new-cells?

### Plan 4
1. Auto-import `~/.ssh/config` `hpc` alias on first HPC tab open?
2. Host key strategy: TOFU + warn-on-change vs strict fingerprint?
3. sbatch template gallery (multi-preset) or one universal default?
4. CI runner for SlurmBridge tests: `windows-2022 + docker` or split to `ubuntu-latest`?
5. **Authorize real-HPC smoke test before Plan 4 sign-off?** (Single `echo` job, no data, no compute hours used.)

### Plan 5
1. AI eval provider: `anyrouter.top` or official Anthropic with CI budget?
2. Variable inspector data size: repr-only or also "View full" lazy load?
3. Code signing certificate: self-signed / OV (~$70/yr) / EV (~$300/yr)?
4. License: MIT / Apache-2.0 / AGPLv3 / BSL / academic-free?
5. Release cadence: per-plan tagging or batch milestones (v1.0 = all done)?

## 🚫 Blockers

(None currently. Plan 2 first CI run failed on Cargo.lock not matching version bump — fixed in commit `2844600`, re-run pending.)

## 📦 Commits Tonight

```
2844600 fix(cargo): refresh Cargo.lock after 0.1.0→0.2.0 version bump
419243e feat(ui): Plan 2 — IDE shell with cards, Monaco, undo/redo
9fcc799 feat(rust): Plan 2 backend — notebook/project/op_log modules + IPC
```

Plus 4 spec docs + 4 plan docs in `/home/chenyang/bionova/docs/superpowers/`.

## 🎯 First Thing to Do When You Wake Up

1. Open https://github.com/ychen0606/bionova-desktop/actions/runs/25830056816 — verify CI is green
2. Read this log (you're doing it)
3. Skim Plan 2 spec doc (§§1-11) to make sure the IDE design matches your taste
4. Install the new MSI from Desktop on 192.168.2.116:
   - Uninstall old BioNova first (Add/Remove Programs)
   - Double-click new MSI
   - Open BioNova, create a project, add a card, add a cell, write `print(1+1)`, Ctrl+Enter
   - Verify Ctrl+Alt+Z undoes, Ctrl+Alt+Y redoes
5. Answer the 15 `<DECISION_NEEDED>` items above (most are 1-3 word answers)
6. Tell me which Plan to start next

## 🔐 Security Reminder

The Anthropic PAT we used (`github_pat_11AJP…`) is still active.
**Suggested**: revoke after we're done with Plan 5 push cycles. Or rotate now if you prefer; just resign me a new one when continuing Plan 3 implementation.

---

End of overnight log. Sleep well — see you in the morning. 🌙→🌅
