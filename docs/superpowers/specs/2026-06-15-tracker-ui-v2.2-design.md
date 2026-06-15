# Tracker UI v2.2 — Persistent & per-item dismiss

- **Date:** 2026-06-15
- **Status:** Approved, ready for plan
- **Builds on:** `2026-06-15-tracker-ui-v2.1-design.md`

## Problem

Dismissing (hiding) features today has two gaps:

1. **Not persistent.** `dismissed` is an in-memory `Set` rebuilt on every `activate()`, so `Tracker: Clear inactive` only hides until the window reloads — then everything reappears (events are still on disk).
2. **No per-item control.** The only way to hide one specific feature is the bulk `Clear inactive`, or hand-editing `~/.claude/tracker/events.jsonl`.

## Design

### 1. Persist `dismissed` to globalState

The event log is global (shared by all windows), so dismissals are global too. Store them in `context.globalState`:

- Load on activate: `dismissed = new Set(context.globalState.get<string[]>(DISMISSED_KEY, []))`.
- A `persistDismissed()` helper writes `context.globalState.update(DISMISSED_KEY, [...dismissed])`.
- Call it after every mutation (`dismiss`, `clearInactive`, `resetDismissed`, auto-cleanup).
- Key: `'claudeTaskTracker.dismissed'`.

### 2. Per-feature dismiss command + menu

- New command `claudeTaskTracker.dismiss`, title **"Tracker: Dismiss"**, icon `$(close)`.
- Handler receives the tree element (a `TreeNode`); if it is a feature with a `session`, add it to `dismissed`, persist, refresh.
- `TreeNode` gains an optional `session?: string`, set on feature nodes by `buildTree`.
- `treeProvider` sets `item.contextValue = node.kind` so menus can target features.
- Menus (`contributes.menus.view/item/context`), both `when: "view == claudeTaskTracker.view && viewItem == feature"`:
  - one entry `group: "inline"` → hover ✕ button on the row;
  - one entry (default/context group) → right-click "Dismiss".

### 3. Escape hatch: reset

Because dismissal is now permanent, add command `claudeTaskTracker.resetDismissed`, title **"Tracker: Reset dismissed"** (Command Palette only): clears the set, persists, refreshes — everything reappears (subject to auto-hide/scope).

### 4. Auto-cleanup of stale ids

On each store change, drop any dismissed id whose session is no longer present in `state.features` (i.e. its events were pruned from the log). This keeps the set bounded and means manually pruning the log also un-dismisses. If anything was removed, persist.

## Affected files

- `src/types.ts` — `TreeNode` gains `session?: string`.
- `src/treeModel.ts` — feature node carries `session: fv.session`.
- `src/treeProvider.ts` — `item.contextValue = node.kind`.
- `package.json` — `dismiss` + `resetDismissed` commands; `view/item/context` menus (inline + context).
- `src/extension.ts` — load/persist dismissed via globalState; register `dismiss` & `resetDismissed`; persist in `clearInactive`; prune stale ids on store change.

## Testing

- Pure: `buildTree` feature nodes expose `session` (vitest).
- The dismiss/persist/menu wiring is VSCode glue (imports `vscode`): verified by `tsc --noEmit` + `npm run build` + manual:
  - right-click / hover-✕ a feature → it disappears and stays gone after reload;
  - `Tracker: Reset dismissed` → dismissed features reappear;
  - pruning a session from `events.jsonl` → its id is auto-dropped from dismissed.
- Existing tests updated only if the `TreeNode` shape assertion needs `session`.

## Non-goals

- No group-level dismiss (feature-level only this round).
- No per-window dismissal (globalState is intentionally cross-window).
- No change to auto-hide, grouping, status bar, or dashboard.
