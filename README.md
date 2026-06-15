# Claude Task Tracker

A VSCode extension that visualizes Claude Code task progress, subagent
convergence, and session lifecycle — across one or many windows, grouped by
repo and git worktree.

## Install

Install **Claude Task Tracker** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chadcoco1444.claude-task-tracker)
or from [Open VSX](https://open-vsx.org/extension/chadcoco1444/claude-task-tracker)
(Cursor / Windsurf / VSCodium).

**Requirements:** [Claude Code](https://www.anthropic.com/claude-code) and Node.js
on your `PATH`.

The first time it activates, the extension asks to add hooks to
`~/.claude/settings.json` so it can see your Claude Code sessions. Choose
**Install** to enable tracking. You can change this anytime with the
`claudeTaskTracker.autoInstallHooks` setting or the
**Tracker: Install / Remove Claude Code hooks** commands.

## Screenshots

<!-- TODO(maintainer): replace with a real capture of the Tracker panel + Dashboard.
     Save it to media/screenshot.png and reference it here:
     ![Claude Task Tracker](media/screenshot.png) -->
_Screenshot coming soon._

## Views

In the **Tracker** activity-bar panel:

- **Tasks & Subagents** (tree): `repo ▸ worktree ▸ feature ▸ task / subagent`.
  Repos group by the session's `cwd`; git worktrees (`<repo>/.worktrees/<name>`)
  nest under their repo. The current window's repo is pinned first and marked
  `(this window)`. Feature rows show a colored icon, a `▰▰▱▱ done/total` bar, and
  a disambiguating `· <id>` suffix when two same-named features collide.
- **Dashboard** (webview): the same data as progress bars + status pills.

A **status-bar** item summarizes the current window's most relevant session
(prefers an active one; never headlines another workspace).

## Status

| status | meaning | icon |
|--------|---------|------|
| `active` | a subagent is running or a todo is in progress | blue rocket |
| `done` | a turn ended with all todos complete | green rocket |
| `idle` | detected but not currently working (e.g. plan detected, not yet executed) | grey rocket |
| `ended` | the session/window truly closed (`SessionEnd`) | dim circle-slash |

`done` and `ended` features auto-hide after `claudeTaskTracker.hideDoneAfterMinutes`
(default 30). An `active` feature is never hidden.

## How it works

Claude Code hooks append JSON events to `~/.claude/tracker/events.jsonl`. The
extension watches that file, reduces the events into state, and renders. Hooks
captured: `SessionStart`, `PostToolUse`(TodoWrite | Write | Edit | MultiEdit),
`PreToolUse`(Task), `SubagentStop`, `Stop`, `SessionEnd`.

- **Tasks** come from Claude Code's live TodoWrite list; before any todos exist,
  the newest plan under `docs/superpowers/plans/*.md` is shown as `planned`
  (`## Task N:` / `### Task N:` headings). Writing a plan mid-session updates the
  skeleton immediately.
- A **subagent** is `running` until a `SubagentStop` converges it (attributed
  FIFO within a session — the hook payload carries no subagent id).

## Managing the tree

- **Dismiss** a feature: hover ✕ or right-click → *Tracker: Dismiss* (persisted).
- **Tracker: Clear inactive** — dismiss every non-active feature (hides only; does not delete the log).
- **Tracker: Reset dismissed** — bring them all back.
- **Tracker: Refresh** — recompute now.

## Settings

| setting | default | meaning |
|---------|---------|---------|
| `claudeTaskTracker.hideDoneAfterMinutes` | 30 | auto-hide done/ended features after N minutes (0 = never) |
| `claudeTaskTracker.logRetentionDays` | 14 | compact the event log on startup, dropping events older than N days (0 = keep all) |

## Development

```bash
npm install
npm run build
npm run install-hooks   # adds hook entries to ~/.claude/settings.json
```

Then press `F5` in VSCode to launch the Extension Development Host. Re-run
`npm run install-hooks` after pulling changes that add or change hooks.
