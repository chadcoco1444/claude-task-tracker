# Tracker UI v2.4 — True session-end, live plan detection, empty-session fix

- **Date:** 2026-06-15
- **Status:** Approved, ready for plan
- **Builds on:** `2026-06-15-tracker-ui-v2.3-design.md`

## Problem

Three gaps in how the tracker judges state:

1. **No true "ended" signal.** `done` is derived from the `Stop` hook, which fires at the *end of every turn*, not when the session/window closes. So "done" is a per-turn approximation, not "this session is over."
2. **Plan detected only at SessionStart.** `findNewestPlan` runs once when the session starts. A plan written *during* the session (the normal brainstorm → spec → **plan** flow) is never picked up by the running session, so it shows no skeleton.
3. **Empty session shows done.** `deriveStatus`'s `nothingPlanned` branch makes a session with no todos *and* no plan flip to `done` at the end of a turn — "finished" without ever doing anything trackable.

## Design

### A. True session-end (`SessionEnd` hook → `ended` status)

- New `SessionEnd` hook emits a new event `session_end` (distinct from per-turn `session_stop`).
- `types.ts`: `FeatureStatus` gains `'ended'`; new `SessionEndEvent { t:'session_end'; ts; session; cwd? }` in the union; `Feature` gains `ended: boolean`.
- `reducer`: `newFeature` sets `ended:false`; `session_end` sets `f.ended = true`; `deriveStatus` checks **`if (f.ended) return 'ended'` first** (highest precedence — a closed session can't be active/done/idle).
- Visual: `ended` → icon `circle-slash`, color `disabledForeground` (dimmed); the `done/total` count still shows completion.
- Caveat: a hard window-kill may not fire `SessionEnd`. So the per-turn `done` auto-hide is kept as a fallback (see below); `ended` is the precise signal when available.

### B. Live plan detection (mid-session plan writes)

- `buildEvents` PostToolUse: in addition to `TodoWrite`, when `tool_name` is `Write`/`Edit`/`MultiEdit` **and** `tool_input.file_path` matches `…/docs/superpowers/plans/*.md`, re-run `planLookup(cwd)` and emit `plan_detected` (same shape as SessionStart).
- `install-hooks.js`: register a `SessionEnd` hook, and broaden the `PostToolUse` matcher from `TodoWrite` to `TodoWrite|Write|Edit|MultiEdit`.
- Effect: the moment a plan file is written, the running session shows its skeleton — no restart needed.

### C. Empty session → idle, not done (the `nothingPlanned` fix)

- `deriveStatus` done condition drops `nothingPlanned`: **`done = f.stopped && !running && allDone`** (there were live todos and all are completed).
- A session with no todos and no skeleton → `idle` between turns; if it truly closes → `ended` (via A). No more "done without doing anything."

### Status model (after v2.4)

| status | condition (in `deriveStatus` order) | visual |
|---|---|---|
| `ended` | `f.ended` (SessionEnd fired) | dim `circle-slash` |
| `active` | running subagent OR in_progress todo | blue `rocket` (spin) |
| `done` | `stopped && !running && allDone` | green `rocket` ✓ |
| `idle` | otherwise | grey `rocket` |

### Visibility & status bar

- `isVisible`: keep `active → always visible`; `dismissed → hidden`; extend the retention hide to **`(done || ended)` older than `hideDoneAfterMinutes` → hidden**.
- `summarize` (status bar): prefer `active`; else the most-recent **non-`ended`** current-window feature; else (only ended left) the most-recent ended one. So an ended session never headlines the status bar unless it's all that's left.

## Affected files

- `src/types.ts` — `FeatureStatus` + `'ended'`; `SessionEndEvent` + union; `Feature.ended`.
- `src/hook/core.ts` — `SessionEnd`→`session_end`; PostToolUse plan-file write → `plan_detected`.
- `scripts/install-hooks.js` — register `SessionEnd`; PostToolUse matcher `TodoWrite|Write|Edit|MultiEdit`.
- `src/reducer.ts` — `ended` field; `session_end` case; `deriveStatus` (ended precedence + drop `nothingPlanned`).
- `src/viewModel.ts` — `isVisible` hides `done`+`ended` past retention.
- `src/treeModel.ts` — `FEATURE_COLOR['ended']`; `featureIcon` returns `circle-slash` for ended.
- `src/dashboard.ts` — `PILL`/`COLOR` gain `ended`.
- `src/statusBarText.ts` — de-prioritize `ended`.
- Tests for each. **Unchanged:** `treeProvider.ts`, `extension.ts`, `package.json`.

## Testing

- reducer: `session_end` → status `ended` (precedence over active/done); empty session (no plan, no todos) stopped → `idle` (was `done` — update that test); allDone + stopped → `done` (unchanged).
- hookCore: `SessionEnd` payload → `session_end` event; PostToolUse `Write` to `docs/superpowers/plans/x.md` (with a planLookup returning a plan) → `plan_detected`; a `Write` to a non-plan path → no event; `TodoWrite` still → `todo_update`.
- viewModel: `ended` feature past retention → hidden; within retention → shown; active never hidden.
- treeModel/dashboard: `ended` feature → `circle-slash`/dim icon, dashboard pill `ended`.
- statusBarText: active preferred; ended de-prioritized below other current-window features.
- install-hooks: verified by `node` (SessionEnd registered; PostToolUse matcher broadened) — no unit test (glue), matches existing pattern.

## Non-goals

- General activity capture (Edit/Bash "working" pulse) and phase badges (brainstorm/spec/plan/execute) — deferred (candidates C/D).
- No change to grouping, disambiguation, dismiss, or the worktree nesting.
