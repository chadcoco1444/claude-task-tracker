# Tracker UI v2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Disambiguate same-name features by stable shortId, let users clear inactive (done+idle) features, and keep the status bar visible when this window has any tracked session.

**Architecture:** Three small changes to existing modules — pure `viewModel.disambiguate`, pure `statusBarText.summarize`, and the `clearInactive` command (package.json + extension.ts). No new files.

**Tech Stack:** TypeScript, vitest, esbuild, VSCode API.

**Spec:** `docs/superpowers/specs/2026-06-15-tracker-ui-v2.1-design.md`

---

## Task 1: Disambiguate by stable shortId

**Files:** Modify `src/viewModel.ts` (`disambiguate`, and its call in `buildGroups`); Modify `test/viewModel.test.ts`.

- [ ] **Step 1: Update the failing test.** In `test/viewModel.test.ts`, replace the `buildGroups` collision assertion. Find the test `'groups by workspace, pins the current window first, and disambiguates collisions'` and replace its final assertions block:

Replace:
```ts
    expect(groups[0].features.every((fv) => fv.label.startsWith('Plan · '))).toBe(true);
    expect(groups.some((g) => g.label === 'Other' && !g.isCurrentWindow)).toBe(true);
```
with:
```ts
    const labels = groups[0].features.map((fv) => fv.label).sort();
    // both colliding features get a stable shortId suffix (symmetric), and they are distinct
    expect(labels).toEqual(['Plan · aaa11111', 'Plan · bbb22222']);
    expect(groups.some((g) => g.label === 'Other' && !g.isCurrentWindow)).toBe(true);
```

- [ ] **Step 2: Run** `npx vitest run viewModel` — expect FAIL (current output appends `· <relativeTime>` and only the 2nd gets the id).

- [ ] **Step 3: Simplify `disambiguate`** in `src/viewModel.ts`. Replace the entire `disambiguate` function with:

```ts
function disambiguate(features: FeatureView[]): void {
  const counts = new Map<string, number>();
  for (const fv of features) {
    counts.set(fv.label, (counts.get(fv.label) ?? 0) + 1);
  }
  for (const fv of features) {
    if ((counts.get(fv.label) ?? 0) >= 2) {
      fv.label = `${fv.label} · ${shortId(fv.session)}`;
    }
  }
}
```

- [ ] **Step 4: Update the call site** in `buildGroups` — change `disambiguate(gv.features, o.now);` to `disambiguate(gv.features);`.

- [ ] **Step 5: Run** `npx vitest run viewModel` — expect PASS. Then `npx vitest run` (full) — all green. Then `npx tsc --noEmit` — clean (note: `relativeTime` is still exported and used by statusBarText after Task 2; it remains defined here).

- [ ] **Step 6: Commit:**
```bash
git add src/viewModel.ts test/viewModel.test.ts
git commit -m "fix: disambiguate same-name features with stable shortId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Persistent status bar

**Files:** Modify `src/statusBarText.ts`; Modify `test/statusBarText.test.ts`.

- [ ] **Step 1: Add failing tests.** Append to `test/statusBarText.test.ts` (inside the existing `describe('summarize', ...)`):

```ts
  it('falls back to the most-recent current-window feature when none is active', () => {
    const text = summarize(reduce([
      { t: 'session_start', ts: 1, session: 's1', cwd: 'c:/ws/auth' },
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [
        { text: 'a', status: 'completed' },
      ] },
      { t: 'session_stop', ts: 3, session: 's1' },
    ] as TrackerEvent[]), { now: 3 + 60_000, workspaceFolders: ['c:/ws/auth'] });
    expect(text).toContain('auth 1/1');
    expect(text).toContain('done');     // status shown
    expect(text).not.toContain('$(sync~spin)'); // not the active format
  });

  it('is empty only when this window has no tracked feature at all', () => {
    const text = summarize(reduce([
      { t: 'todo_update', ts: 2, session: 's9', cwd: 'c:/ws/Other', todos: [
        { text: 'x', status: 'completed' },
      ] },
      { t: 'session_stop', ts: 3, session: 's9' },
    ] as TrackerEvent[]), { now: 1000, workspaceFolders: ['c:/ws/auth'] });
    expect(text).toBe('');
  });
```

- [ ] **Step 2: Run** `npx vitest run statusBarText` — expect FAIL (current `summarize` returns `''` when no active feature, even if an idle/done current-window feature exists).

- [ ] **Step 3: Rewrite** `src/statusBarText.ts` entirely:

```ts
import { State, ViewOptions } from './types';
import { featureCounts, groupOf, relativeTime } from './viewModel';

type StatusOptions = Pick<ViewOptions, 'now' | 'workspaceFolders'>;

export function summarize(state: State, options: StatusOptions): string {
  const inWin = state.features.filter(
    (f) => groupOf(f.cwd, options.workspaceFolders).isCurrentWindow,
  );
  if (inWin.length === 0) {
    return '';
  }
  const active = inWin.filter((f) => f.status === 'active');
  const pool = active.length > 0 ? active : inWin;
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

- [ ] **Step 4: Run** `npx vitest run statusBarText` — expect PASS. Then `npx vitest run` (full) — all green. `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit:**
```bash
git add src/statusBarText.ts test/statusBarText.test.ts
git commit -m "feat: keep the status bar visible with the most-recent current-window session

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `Clear inactive` command (done + idle)

**Files:** Modify `package.json` (command id/title); Modify `src/extension.ts` (register + predicate).

- [ ] **Step 1: Rename the command in `package.json`.** In `contributes.commands`, replace:
```json
      { "command": "claudeTaskTracker.clearCompleted", "title": "Tracker: Clear completed" }
```
with:
```json
      { "command": "claudeTaskTracker.clearInactive", "title": "Tracker: Clear inactive" }
```

- [ ] **Step 2: Update `src/extension.ts`.** Replace the existing command registration block:
```ts
    vscode.commands.registerCommand('claudeTaskTracker.clearCompleted', () => {
      for (const f of store.state.features) {
        if (f.status === 'done') {
          dismissed.add(f.session);
        }
      }
      refreshAll();
    }),
```
with:
```ts
    vscode.commands.registerCommand('claudeTaskTracker.clearInactive', () => {
      for (const f of store.state.features) {
        if (f.status !== 'active') {
          dismissed.add(f.session);
        }
      }
      refreshAll();
    }),
```

- [ ] **Step 3: Validate + verify.**
  - `node -e "const p=require('./package.json'); const c=p.contributes.commands.map(x=>x.command); if(!c.includes('claudeTaskTracker.clearInactive')||c.includes('claudeTaskTracker.clearCompleted')){throw new Error('command not renamed: '+c)} console.log('ok', c)"` → `ok [...]`
  - `npx tsc --noEmit` — clean (zero errors).
  - `npx vitest run` — all green.

- [ ] **Step 4: Commit:**
```bash
git add package.json src/extension.ts
git commit -m "feat: rename clear-completed to clear-inactive (dismiss done and idle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Build & package

**Files:** none (verification only).

- [ ] **Step 1:** `npx tsc --noEmit` — zero errors.
- [ ] **Step 2:** `npx vitest run` — all green (report count).
- [ ] **Step 3:** `npm run build` — esbuild writes `dist/extension.js` + `dist/hook.js`; confirm via `ls -la dist/`.
- [ ] **Step 4 (manual, for the human):** install the repackaged vsix + reload; confirm same-name rows show `· <shortId>` (symmetric), `Tracker: Clear inactive` removes done+idle rows, and the status bar shows the most-recent current-window session when nothing is active.

---

## Self-Review

- **Spec coverage:** #1 disambiguation (Task 1) · #2 clear inactive (Task 3) · #3 persistent status bar (Task 2). Build/package (Task 4).
- **Type consistency:** `disambiguate(features)` (no `now`), `buildGroups` call updated; `summarize(state, {now, workspaceFolders})` now uses `relativeTime` (resolves the prior unused-`now` nit); command id `claudeTaskTracker.clearInactive` matches in package.json + extension.ts.
- **No placeholders:** every code step shows full code.
