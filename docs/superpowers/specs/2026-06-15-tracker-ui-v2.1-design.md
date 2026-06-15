# Tracker UI v2.1 — Polish Design

- **Date:** 2026-06-15
- **Status:** Approved, ready for plan
- **Builds on:** `2026-06-15-tracker-ui-v2-design.md`

Three small fixes surfaced while dogfooding the merged UI v2.

## Problem

1. **Disambiguation is noisy & asymmetric.** `disambiguate()` appends `· <relativeTime>` first and only adds `· <shortId>` on the *second* collision within the same time bucket. Two same-named features that started in the same minute render as `…Plan · 3m ago` and `…Plan · 3m ago · f42dbaea` — the `· 3m ago` is identical on both (distinguishes nothing) and the id appears on only one. The relativeTime suffix is also unstable (rewrites every 60s via the refresh timer).
2. **Idle sessions can't be cleared.** Auto-hide and `Tracker: Clear completed` only target `done`. An `idle` feature (plan detected, never executed) lingers forever and must be pruned from the event log by hand.
3. **Status bar vanishes when nothing is active.** `summarize()` shows only current-window `active` features. When this window's sessions are all done/idle (common), the status bar disappears entirely.

## Design

### 1. Disambiguate by stable shortId

In `viewModel.ts` `disambiguate()`: for every feature whose label collides (count ≥ 2 within its group), append `· ${shortId(session)}` — applied to **all** colliding features (symmetric). Drop `relativeTime` as the disambiguation key (`now` param removed from `disambiguate`; `buildGroups` stops passing it). `shortId` (first UUID segment, 8 hex) is unique-enough and stable across refreshes.

Result: `…Plan · aaa3af7c` / `…Plan · f42dbaea`.

`relativeTime` stays an exported helper (now consumed by the status bar, below).

### 2. `Clear inactive` command (done + idle)

Rename the command `claudeTaskTracker.clearCompleted` → `claudeTaskTracker.clearInactive`, title **"Tracker: Clear inactive"**. Its handler dismisses every feature whose `status !== 'active'` (i.e. `done` **and** `idle`) by adding their sessions to the `dismissed` set, then refreshes. Active (running) features are never dismissed. Auto-hide behavior is unchanged (still `done`-only, time-based). Dismissal lasts until the window reloads (same as today).

### 3. Persistent status bar

In `statusBarText.ts` `summarize(state, { now, workspaceFolders })`:
- Let `inWin` = current-window features (`groupOf(...).isCurrentWindow`).
- If `inWin` is empty → `''` (hide).
- Prefer `active` ones; `pool = active.length ? active : inWin`. Sort by `lastTs` desc, take the first `f`.
- If `f.status === 'active'`: unchanged format `` `$(rocket) ${label} ${done}/${total} · $(sync~spin)${running}${more}` `` (`more` = ` +N` for other active).
- Else (fallback, done/idle): `` `$(rocket) ${label} ${done}/${total} · ${f.status} · ${relativeTime(now, f.lastTs)}` ``.

So the status bar is visible whenever this window has any tracked session; it only hides when there are none. Other-workspace sessions still never appear (scope unchanged).

## Affected files

- `src/viewModel.ts` — simplify `disambiguate` (shortId, symmetric); drop `now` arg; update `buildGroups` call.
- `src/statusBarText.ts` — active-preferred fallback to most-recent current-window feature; uses `relativeTime`.
- `package.json` — rename command id/title to `clearInactive` / "Tracker: Clear inactive".
- `src/extension.ts` — register `claudeTaskTracker.clearInactive`; dismiss `status !== 'active'`.

## Testing

- `disambiguate`/`buildGroups`: two same-name same-bucket features → both get `· <shortId>`, symmetric; non-colliding labels untouched.
- `summarize`: (a) active current-window feature → existing format; (b) no active but an idle/done current-window feature → fallback string with status + relative time; (c) no current-window features → `''`; (d) other-workspace active → still `''`.
- Existing tests updated for the new disambiguation output and summarize signature behavior.

## Non-goals

- No change to the event format, auto-hide timing, grouping, or the dashboard renderer (the dashboard already shows all statuses).
- No un-dismiss-on-resume logic (dismissed stays hidden until reload).
