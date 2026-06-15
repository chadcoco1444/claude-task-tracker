# Changelog

## 0.2.0

- **v2.5 — cleanup & hardening:** bounded event-log growth (`logRetentionDays`,
  default 14d, compacted on startup); de-duplicated helpers into `util`; typed
  hook payloads; refreshed docs; documented the FIFO-convergence and
  newest-plan heuristics.
- **v2.4:** true `ended` status via the `SessionEnd` hook (distinct from per-turn
  `done`); live plan detection on plan-file writes; empty sessions show `idle`,
  not `done`; status bar de-prioritizes ended.
- **v2.3:** nest git worktrees under their repo (`repo ▸ worktree ▸ feature`).
- **v2.2:** persistent + per-item dismiss (globalState), `Reset dismissed`, and
  never-hide-an-active-feature.
- **v2.1:** stable shortId disambiguation, persistent status bar, `Clear inactive`.
- **v2.0:** colored status lights + per-kind icons, Dashboard webview, workspace
  grouping, workspace-scoped status bar, auto-hide of completed features.

## 0.0.1

- Initial MVP: hook-driven event log, tree of feature → task → subagent,
  status-bar summary.
