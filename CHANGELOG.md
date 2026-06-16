# Changelog

## 0.3.0

- **First public release** — install the `.vsix` from GitHub Releases (*Extensions: Install from VSIX…*).
- **Works out of the box:** the extension now installs/repairs the Claude Code
  hooks in `~/.claude/settings.json` on activation (asks for consent the first
  time; toggle with `claudeTaskTracker.autoInstallHooks`). Commands
  `Tracker: Install Claude Code hooks` / `Tracker: Remove Claude Code hooks`
  give manual control. The hook path self-heals across extension updates.
- Added extension icon, license, and marketplace metadata.

## 0.2.1

- **Hide "ghost" sessions:** an ended session that only opened a plan — no
  `todo_update`, no subagents — no longer lingers as an empty `0/N` duplicate
  of whichever session actually ran the plan. Sessions that did real work (live
  todos or subagents) are still shown through the normal retention window.

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
