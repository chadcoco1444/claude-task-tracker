# Tracker UI v2.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a true `ended` status (SessionEnd hook), live mid-session plan detection (plan-file writes), and stop empty sessions from showing `done`.

**Architecture:** New `session_end` event + `Feature.ended` + `ended` status (highest precedence in `deriveStatus`, which also drops `nothingPlanned`). `buildEvents` re-emits `plan_detected` on plan-file writes; `install-hooks` registers `SessionEnd` and broadens the PostToolUse matcher. View layer (`isVisible`, tree/dashboard/status bar) handles `ended`.

**Tech Stack:** TypeScript, vitest, esbuild, VSCode API.

**Spec:** `docs/superpowers/specs/2026-06-15-tracker-ui-v2.4-design.md`

---

## Task 1: `ended` status + empty-session fix (types + reducer)

**Files:** Modify `src/types.ts`, `src/reducer.ts`; Modify `test/reducer.test.ts`.

GATE NOTE: Adding `'ended'` to `FeatureStatus` makes `treeModel.ts`'s `FEATURE_COLOR: Record<Feature['status'],string>` non-exhaustive → `npx tsc --noEmit` WILL error in `src/treeModel.ts` until Task 5. Expected. Gate here = `npx vitest run reducer` passes.

- [ ] **Step 1: Write failing tests.** In `test/reducer.test.ts`:

(a) Replace the existing test `'a stopped session with no plan and no todos is still done'` (it asserts `'done'`) with:
```ts
  it('a stopped session with no plan and no todos is idle, not done', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/a/repo' },
      { t: 'session_stop', ts: 2, session: 's1' },
    ];
    expect(reduce(events).features[0].status).toBe('idle');
  });
```

(b) Append two new tests inside `describe('reduce', ...)`:
```ts
  it('marks a feature ended when SessionEnd fires (precedence over everything)', () => {
    const f = reduce([
      { t: 'todo_update', ts: 1, session: 's1', todos: [{ text: 'x', status: 'in_progress' }] },
      { t: 'session_end', ts: 2, session: 's1' },
    ] as TrackerEvent[]).features[0];
    expect(f.ended).toBe(true);
    expect(f.status).toBe('ended');   // even though a todo is in_progress
  });

  it('still derives done when stopped with all todos completed', () => {
    const f = reduce([
      { t: 'todo_update', ts: 1, session: 's1', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_stop', ts: 2, session: 's1' },
    ] as TrackerEvent[]).features[0];
    expect(f.status).toBe('done');
  });
```

- [ ] **Step 2: Run** `npx vitest run reducer` — expect FAIL (`session_end` not handled / `ended` undefined / empty session still `done`).

- [ ] **Step 3: Update `src/types.ts`:**

(a) Change `export type FeatureStatus = 'active' | 'idle' | 'done';` to:
```ts
export type FeatureStatus = 'active' | 'idle' | 'done' | 'ended';
```

(b) Add `ended: boolean;` to the `Feature` interface (after `stopped: boolean;`):
```ts
  stopped: boolean;
  ended: boolean;
```

(c) Add the event interface (after `SessionStopEvent`):
```ts
export interface SessionEndEvent { t: 'session_end'; ts: number; session: string; cwd?: string; }
```

(d) Add it to the union:
```ts
export type TrackerEvent =
  | SessionStartEvent
  | PlanDetectedEvent
  | TodoUpdateEvent
  | SubagentStartEvent
  | SubagentStopEvent
  | SessionStopEvent
  | SessionEndEvent;
```

- [ ] **Step 4: Update `src/reducer.ts`:**

(a) In `newFeature`, add `ended: false,` right after `stopped: false,`.

(b) Replace `deriveStatus` with:
```ts
function deriveStatus(f: Feature): Feature['status'] {
  if (f.ended) {
    return 'ended';
  }
  const running = f.subagents.some((s) => s.status === 'running');
  const inProgress = f.liveTodos.some((t) => t.status === 'in_progress');
  const allDone = f.liveTodos.length > 0 && f.liveTodos.every((t) => t.status === 'completed');
  if (f.stopped && !running && allDone) {
    return 'done';
  }
  if (running || inProgress) {
    return 'active';
  }
  return 'idle';
}
```

(c) In the reduce loop's `switch`, add a case after `case 'session_stop':`:
```ts
      case 'session_end':
        f.ended = true;
        break;
```

- [ ] **Step 5: Run** `npx vitest run reducer` — expect PASS. (`npx tsc --noEmit` will now error ONLY in `src/treeModel.ts` re: `FEATURE_COLOR` missing `'ended'` — expected, fixed in Task 5. Confirm no other file errors.)

- [ ] **Step 6: Commit:**
```bash
git add src/types.ts src/reducer.ts test/reducer.test.ts
git commit -m "feat: add ended status (SessionEnd) and stop empty sessions from showing done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Hook events — SessionEnd + live plan detection

**Files:** Modify `src/hook/core.ts`; Modify `test/hookCore.test.ts`.

- [ ] **Step 1: Write failing tests.** Append inside `describe('buildEvents', ...)` in `test/hookCore.test.ts`:
```ts
  it('SessionEnd maps to session_end', () => {
    expect(buildEvents({ hook_event_name: 'SessionEnd', session_id: 's1' }, 7, noPlan))
      .toEqual([{ t: 'session_end', ts: 7, session: 's1' }]);
  });

  it('a Write to a plan file re-emits plan_detected', () => {
    const plan: PlanInfo = { plan: '/r/p.md', title: 'P', tasks: [{ id: 'T1', text: 'a' }] };
    const payload: HookPayload = {
      hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/r', tool_name: 'Write',
      tool_input: { file_path: '/r/docs/superpowers/plans/2026-06-15-x.md' },
    };
    const events = buildEvents(payload, 9, () => plan);
    expect(events).toEqual([{ t: 'plan_detected', ts: 9, session: 's1', plan: '/r/p.md', title: 'P', tasks: [{ id: 'T1', text: 'a' }] }]);
  });

  it('a Write to a non-plan file emits nothing', () => {
    const payload: HookPayload = {
      hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/r', tool_name: 'Write',
      tool_input: { file_path: '/r/src/index.ts' },
    };
    expect(buildEvents(payload, 9, () => ({ plan: '/r/p.md', tasks: [] }))).toEqual([]);
  });
```

- [ ] **Step 2: Run** `npx vitest run hookCore` — expect FAIL.

- [ ] **Step 3: Update `src/hook/core.ts`** `buildEvents`:

(a) Add a helper above the `switch` (after the `withCwd` definition):
```ts
  const isPlanFile = (p: unknown): boolean =>
    typeof p === 'string' && /[\\/]docs[\\/]+superpowers[\\/]+plans[\\/].+\.md$/i.test(p);
```

(b) Replace the entire `case 'PostToolUse':` block with:
```ts
    case 'PostToolUse':
      if (payload.tool_name === 'TodoWrite' && Array.isArray(payload.tool_input?.todos)) {
        const todos = payload.tool_input.todos.map((td: any) => ({
          text: String(td.content ?? td.text ?? ''),
          status: (td.status ?? 'pending') as TodoStatus,
        }));
        return [withCwd({ t: 'todo_update', ts: now, session, todos })];
      }
      if (
        (payload.tool_name === 'Write' || payload.tool_name === 'Edit' || payload.tool_name === 'MultiEdit') &&
        isPlanFile(payload.tool_input?.file_path)
      ) {
        const plan = cwd ? planLookup(cwd) : null;
        if (plan) {
          return [{ t: 'plan_detected', ts: now, session, plan: plan.plan, title: plan.title, tasks: plan.tasks }];
        }
      }
      return [];
```

(c) Add a `case 'SessionEnd':` before `default:`:
```ts
    case 'SessionEnd':
      return [withCwd({ t: 'session_end', ts: now, session })];
```

- [ ] **Step 4: Run** `npx vitest run hookCore` — expect PASS. Then `npx vitest run` (full) — green except the known treeModel tsc gap doesn't affect vitest. `npx tsc --noEmit` — errors still ONLY in `src/treeModel.ts` (confirm).

- [ ] **Step 5: Commit:**
```bash
git add src/hook/core.ts test/hookCore.test.ts
git commit -m "feat: hook emits session_end and re-detects plan on plan-file writes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: install-hooks — register SessionEnd + broaden PostToolUse matcher

**Files:** Modify `scripts/install-hooks.js`.

- [ ] **Step 1: Update `scripts/install-hooks.js`.** Replace the block of `ensure(...)` calls:
```js
ensure('SessionStart');
ensure('PostToolUse', 'TodoWrite');
ensure('PreToolUse', 'Task');
ensure('SubagentStop');
ensure('Stop');
```
with:
```js
ensure('SessionStart');
ensure('PostToolUse', 'TodoWrite|Write|Edit|MultiEdit');
ensure('PreToolUse', 'Task');
ensure('SubagentStop');
ensure('Stop');
ensure('SessionEnd');
```

- [ ] **Step 2: Verify the script is valid and produces the expected entries** (does NOT write to the real settings.json — dry check by requiring nothing; just lint the file by parsing):

Run: `node -e "require('child_process'); new Function(require('fs').readFileSync('scripts/install-hooks.js','utf8')); console.log('parses ok')"`
Expected: `parses ok` (syntactic check only — do not execute it against settings.json here).

- [ ] **Step 3: Run** `npx vitest run` — still green (no test depends on install-hooks). `npx tsc --noEmit` — errors still only in treeModel.ts.

- [ ] **Step 4: Commit:**
```bash
git add scripts/install-hooks.js
git commit -m "feat: install SessionEnd hook and capture plan-file writes in PostToolUse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `isVisible` — hide ended past retention

**Files:** Modify `src/viewModel.ts`; Modify `test/viewModel.test.ts`.

- [ ] **Step 1: Write failing tests.** In `test/viewModel.test.ts`, inside `describe('isVisible', ...)`, append:
```ts
  it('hides an ended feature past the retention window, shows it within', () => {
    const ended = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_end', ts: 0, session: 's' },
    ] as TrackerEvent[]).features[0];
    expect(ended.status).toBe('ended');
    expect(isVisible(ended, opts({ now: 20 * 60_000 }))).toBe(true);   // within 30m
    expect(isVisible(ended, opts({ now: 40 * 60_000 }))).toBe(false);  // past 30m
  });
```

- [ ] **Step 2: Run** `npx vitest run viewModel` — expect FAIL (ended not covered by retention hide).

- [ ] **Step 3: Update `isVisible` in `src/viewModel.ts`** — change the done-retention check to cover `ended` too:
```ts
export function isVisible(f: Feature, o: ViewOptions): boolean {
  if (f.status === 'active') {
    return true;
  }
  if (o.dismissed.has(f.session)) {
    return false;
  }
  if ((f.status === 'done' || f.status === 'ended') && o.hideDoneAfterMinutes > 0) {
    if (o.now - f.lastTs > o.hideDoneAfterMinutes * 60_000) {
      return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Run** `npx vitest run viewModel` — expect PASS. Full `npx vitest run` — green. `npx tsc --noEmit` — errors still only in treeModel.ts.

- [ ] **Step 5: Commit:**
```bash
git add src/viewModel.ts test/viewModel.test.ts
git commit -m "feat: auto-hide ended features after the retention window

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `ended` visuals (tree + dashboard) + status-bar de-prioritize

**Files:** Modify `src/treeModel.ts`, `src/dashboard.ts`, `src/statusBarText.ts`; Modify `test/treeModel.test.ts`, `test/dashboard.test.ts`, `test/statusBarText.test.ts`.

- [ ] **Step 1: Write failing tests.**

In `test/treeModel.test.ts`, append inside `describe('buildTree', ...)`:
```ts
  it('renders an ended feature with a dim circle-slash icon', () => {
    const state = reduce([
      { t: 'todo_update', ts: 1, session: 's1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'session_end', ts: 2, session: 's1' },
    ] as TrackerEvent[]);
    const feature = find(buildTree(state, opts({ workspaceFolders: ['c:/ws/auth'] })), 'feature')!;
    expect(feature.icon).toBe('circle-slash');
    expect(feature.iconColor).toBe('disabledForeground');
  });
```

In `test/dashboard.test.ts`, append inside `describe('renderDashboardHtml', ...)`:
```ts
  it('shows an ended pill for an ended feature', () => {
    const state = reduce([
      { t: 'todo_update', ts: 1, session: 's1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'session_end', ts: 2, session: 's1' },
    ] as TrackerEvent[]);
    const html = renderDashboardHtml(state, { now: 1000, workspaceFolders: ['c:/ws/auth'], hideDoneAfterMinutes: 0, dismissed: new Set() });
    expect(html).toContain('ended');
  });
```

In `test/statusBarText.test.ts`, append inside `describe('summarize', ...)`:
```ts
  it('prefers a non-ended feature over an ended one', () => {
    const text = summarize(reduce([
      { t: 'todo_update', ts: 1, session: 'e1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'session_end', ts: 2, session: 'e1' },
      { t: 'session_start', ts: 3, session: 'i1', cwd: 'c:/ws/auth' },
      { t: 'plan_detected', ts: 3, session: 'i1', plan: 'c:/ws/auth/p.md', title: 'Idle One', tasks: [{ id: 'T1', text: 'x' }] },
    ] as TrackerEvent[]), { now: 4, workspaceFolders: ['c:/ws/auth'] });
    expect(text).toContain('Idle One');   // the idle feature wins over the ended one
  });
```

- [ ] **Step 2: Run** `npx vitest run treeModel dashboard statusBarText` — expect FAIL.

- [ ] **Step 3: Update `src/treeModel.ts`:**

(a) Add `'ended'` to the color map:
```ts
const FEATURE_COLOR: Record<Feature['status'], string> = {
  done: 'charts.green',
  active: 'charts.blue',
  idle: 'disabledForeground',
  ended: 'disabledForeground',
};
```

(b) Replace `featureIcon` so ended uses a different icon:
```ts
function featureIcon(status: Feature['status']): { icon: string; iconColor: string } {
  const icon = status === 'ended' ? 'circle-slash' : 'rocket';
  return { icon, iconColor: FEATURE_COLOR[status] };
}
```

- [ ] **Step 4: Update `src/dashboard.ts`** — add `ended` to both maps:
```ts
const PILL: Record<string, string> = { done: 'done', active: 'running', idle: 'idle', ended: 'ended' };
const COLOR: Record<string, string> = {
  done: 'var(--vscode-charts-green)',
  active: 'var(--vscode-charts-blue)',
  idle: 'var(--vscode-disabledForeground)',
  ended: 'var(--vscode-disabledForeground)',
};
```

- [ ] **Step 5: Update `src/statusBarText.ts`** — de-prioritize ended. Replace the pool selection so ended only headlines when nothing else is current-window:
```ts
export function summarize(state: State, options: StatusOptions): string {
  const inWin = state.features.filter(
    (f) => locate(f.cwd, options.workspaceFolders).isCurrentWindow,
  );
  if (inWin.length === 0) {
    return '';
  }
  const active = inWin.filter((f) => f.status === 'active');
  const live = inWin.filter((f) => f.status !== 'ended');
  const pool = active.length > 0 ? active : (live.length > 0 ? live : inWin);
  pool.sort((a, b) => b.lastTs - a.lastTs);
  const f = pool[0];
  const { done, total } = featureCounts(f);
  if (f.status === 'active') {
    const running = f.subagents.filter((s) => s.status === 'running').length;
    const more = active.length > 1 ? ` +${active.length - 1}` : '';
    return `$(rocket) ${f.label} ${done}/${total} · $(sync~spin)${running}${more}`;
  }
  return `$(rocket) ${f.label} ${done}/${total} · ${f.status} · ${relativeTime(options.now, f.lastTs)}`;
}
```

- [ ] **Step 6: Run** `npx vitest run` (full) — ALL green. `npx tsc --noEmit` — ZERO errors (treeModel's `FEATURE_COLOR` now exhaustive). `npm run build` — dist written.

- [ ] **Step 7: Commit:**
```bash
git add src/treeModel.ts src/dashboard.ts src/statusBarText.ts test/treeModel.test.ts test/dashboard.test.ts test/statusBarText.test.ts
git commit -m "feat: ended visuals (circle-slash/dim, dashboard pill) and status-bar de-prioritization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Build & package

- [ ] `npx tsc --noEmit` (zero), `npx vitest run` (report count), `npm run build`, `npx --yes @vscode/vsce package`.
- [ ] **Manual (human):** re-run `npm run install-hooks` (registers the SessionEnd hook + broadened PostToolUse matcher), then install vsix + reload. Verify: closing a session shows it dimmed as `ended` then auto-hides after 30m; writing a plan mid-session shows the skeleton immediately; a session that did nothing shows idle (not done).

---

## Self-Review

- **Spec coverage:** A — ended status (Task 1 reducer/types, Task 5 visuals, Task 4 retention) + SessionEnd hook (Task 2 core, Task 3 install). B — live plan detection (Task 2 core, Task 3 matcher). C/E — empty session idle (Task 1 deriveStatus). Status-bar de-prioritize (Task 5). Build/install (Task 6).
- **Type consistency:** `FeatureStatus` adds `'ended'` (Task 1) → consumed by `FEATURE_COLOR`/`featureIcon` (Task 5), `PILL`/`COLOR` (Task 5), `isVisible` (Task 4); `SessionEndEvent{t:'session_end'}` (Task 1) emitted by `buildEvents` (Task 2) and handled by reducer (Task 1); `Feature.ended` set in `newFeature` + `session_end` case. `isPlanFile`/`planLookup` consistent in Task 2.
- **Interim tsc:** Task 1 intentionally leaves a tsc error in `treeModel.ts` (non-exhaustive `FEATURE_COLOR`) until Task 5 — called out in Tasks 1/2/4 gate notes; per-task gate is vitest. Fully green at Task 5/6.
- **No placeholders:** every code step shows full code.
