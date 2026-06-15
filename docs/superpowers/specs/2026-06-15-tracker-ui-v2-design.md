# Claude Task Tracker — UI v2 Design

- **Date:** 2026-06-15
- **Status:** Approved (brainstorm), ready for implementation plan
- **Supersedes parts of:** `2026-06-15-claude-task-tracker-design.md` (rendering & status-bar sections)

## Problem

The current sidebar is monochrome text: every node uses an uncolored codicon
(`pass-filled` / `sync~spin` / `circle-outline`) created via
`new vscode.ThemeIcon(node.icon)` with no `ThemeColor`. There is no progress
visualization beyond a `done/total` string, and three concerns surfaced while
dogfooding:

1. **No "lights" or iconography** — hard to scan state at a glance.
2. **Status bar shows the wrong project** — `events.jsonl` is global (shared by
   every VSCode window), and `summarize()` picks the most-recently-active
   feature across *all* sessions. A different workspace's session (TradeMatrix)
   wins in an unrelated window.
3. **Flat, ambiguous list** — multiple sessions on the same repo render as
   identically-labelled rows ("Claude Task Tracker Implementation Plan" ×3) and
   completed work lingers forever.

## Goals

- Add colored status "lights" and per-node-kind icons (native TreeView).
- Add a richer **Dashboard** webview with real progress bars and status badges,
  stacked under the tree in the same activity-bar container.
- Group the tree by workspace/project; pin the current window's folder(s) to top.
- Scope the **status bar to the current window**; keep tree/dashboard global.
- Disambiguate same-named features only when they collide.
- Auto-hide completed features after a retention window.

## Non-goals

- No change to the on-disk event format (`events.jsonl`).
- No cross-machine sync; no deletion of event-log contents.
- No replacement of the TreeView (we *add* a webview alongside it, not instead).

## Design

### A. Sidebar structure & naming

The `claudeTaskTracker` activity-bar container (title `Tracker`, icon
`$(checklist)`) hosts **two stacked views**:

| View id | name | type |
|---|---|---|
| `claudeTaskTracker.view` | `Tasks & Subagents` | tree (existing) |
| `claudeTaskTracker.dashboard` | `Dashboard` | webview (new) |

Declared in `package.json` `contributes.views.claudeTaskTracker` as an array of
two entries; the second adds `"type": "webview"`.

### B. Enhanced tree

Four levels: **workspace group → feature → task / subagent**.

```
▾ claude-task-tracker  (this window)
   🚀 …Implementation Plan · 5m ago   ▰▰▰▰ 5/5
   🚀 …Implementation Plan · now      ▱▱▱▱ 0/10
▾ TradeMatrix
   🚀 TradeMatrix                     ▰▰▱▱ 2/4
▾ Unknown (no cwd)
   ✓ 5bc8b036                         ▰▰▰▰ 12/12
      ✓ Types + reducer
      ◑ Hook core
      ○ Tree model      planned
      🤖 code-reviewer   running
```

- **Lights (color):** `vscode.ThemeColor` so it tracks the active theme.
  - done / completed → `charts.green`
  - active / running → `charts.blue`
  - in_progress (task) → `charts.yellow`
  - idle / pending / planned → `disabledForeground`
- **Icons (per node kind):** feature → `rocket`; subagent → `robot` (codicons);
  task keeps state icons (`check` / `sync~spin` / `circle-outline`).
- **Progress:** a text bar in the description column, e.g. `▰▰▱▱ 2/4`
  (TreeView descriptions are text-only).
- **Grouping:** each feature maps to a group via its `cwd`:
  1. `cwd` under an open `workspaceFolders` entry → that folder's name; this
     group is pinned to the top and suffixed `(this window)`.
  2. otherwise → `basename(cwd)` as its own group.
  3. no `cwd` → `Unknown (no cwd)` group (last).
- **Disambiguation:** only when ≥2 features in the *same group* share a label,
  append ` · <relative-time>` (and `· <shortId>` if times also collide).

### C. Dashboard webview

A read-only overview rendered as HTML, grouped by project like the tree. Each
feature is a card: light dot, name, `running|done|idle` pill, a real CSS
progress bar, and `done/total`. Clicking a card reveals its tasks/subagents
inline. Shows the global set (same data as the tree). The webview receives state
via `postMessage` on every store change; no polling.

### D. Scope rules

- **Tree & Dashboard:** global, organized by group (Section B).
- **Status bar:** current window only. `summarize()` takes `workspaceFolders`
  and considers only features whose `cwd` is inside one of them, then picks the
  most-recently-active. If none match, the item hides.

### E. Auto-hide (retention)

- A feature with status `done` is shown for `hideDoneAfterMinutes` after its
  `lastTs`, then filtered out of tree and dashboard (events are **not** deleted).
- Setting `claudeTaskTracker.hideDoneAfterMinutes` (default `30`; `0` = never).
- Command `Tracker: Clear completed` (`claudeTaskTracker.clearCompleted`)
  immediately hides all currently-done features for the session.

### F. Settings (package.json `contributes.configuration`)

| key | type | default | meaning |
|---|---|---|---|
| `claudeTaskTracker.hideDoneAfterMinutes` | number | `30` | auto-hide window for done features (`0` = never) |

### G. Architecture

- **`reduce()` stays pure** — no clock, no VSCode APIs. It already carries
  `cwd` (per the label fix) and `lastTs` per feature.
- All view-time concerns move to the **view layer**, with `now` and
  `workspaceFolders` injected for testability:
  - `buildTree(state, { now, workspaceFolders, hideDoneAfterMinutes })`
    → returns group nodes. New `TreeNode.kind: 'group'`; `iconColor?: string`
    (ThemeColor id) added to `TreeNode`.
  - `summarize(state, { now, workspaceFolders })` for the status bar filter.
  - small helpers: `relativeTime(now, ts)`, `groupOf(cwd, workspaceFolders)`.
- `treeProvider.getTreeItem` applies color via
  `new vscode.ThemeIcon(node.icon, node.iconColor ? new vscode.ThemeColor(node.iconColor) : undefined)`.
- New `src/dashboard.ts` implements `WebviewViewProvider`; registered in
  `extension.ts` alongside the tree; both subscribe to `store.onChange`.
- A periodic refresh (e.g. a 60s timer firing `store` re-render) is needed so
  relative times and auto-hide advance even without new events.

## Affected files

- `package.json` — second view (webview), configuration, `clearCompleted` command.
- `src/types.ts` — `TreeNode` gains `kind:'group'` + `iconColor?`; view-option types.
- `src/treeModel.ts` — grouping, colors, icons, progress bar, disambiguation, auto-hide.
- `src/treeProvider.ts` — colored `ThemeIcon`; render group nodes.
- `src/statusBarText.ts` / `src/statusBar.ts` — workspace filtering; inject folders.
- `src/dashboard.ts` (new) — webview provider + HTML.
- `src/extension.ts` — register webview, inject `now`/`workspaceFolders`, refresh timer.

## Testing

Pure, table-driven unit tests (vitest), `now`/`workspaceFolders` injected:

- grouping: cwd→group mapping, current-window pinned first, `Unknown` bucket.
- disambiguation: suffix appears only on same-group label collision.
- auto-hide: done feature visible before window, hidden after; `0` = never; active never hidden.
- status bar: only current-window features considered; hides when none match.
- existing reducer/hook tests unchanged.

## Resolved decisions

- Fidelity: **B + C** (native enhanced tree **and** webview dashboard).
- Layout: **stacked** (two views in one container).
- Scope: **global tree/dashboard, workspace-only status bar**.
- Disambiguation: **on-collision only**.
- Retention default: **30 minutes**.
- View names: **`Tasks & Subagents`** / **`Dashboard`** (unchanged).
