# Tracker UI v2.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Nest git worktrees under their parent repo in the tree and dashboard (`TradeMatrix ▸ sc-declutter ▸ feature`).

**Architecture:** Replace `groupOf` with `locate` (detects `…/<repo>/.worktrees/<name>`). `buildGroups` returns a two-level `RepoGroup[]` (direct features + worktree subgroups). `treeModel` and `dashboard` render the nesting; `statusBarText` uses `locate` for the current-window test. Pure view layer; `treeProvider`/`extension`/`package.json` unchanged.

**Tech Stack:** TypeScript, vitest, esbuild, VSCode API.

**Spec:** `docs/superpowers/specs/2026-06-15-tracker-ui-v2.3-design.md`

---

## Task 1: `locate` helper + status bar switch

**Files:** Modify `src/viewModel.ts` (add `locate`/`Location`, keep `groupOf` for now); Modify `src/statusBarText.ts`; Modify `test/viewModel.test.ts`.

- [ ] **Step 1: Write failing tests.** Append to `test/viewModel.test.ts`:

```ts
import { locate } from '../src/viewModel';

describe('locate', () => {
  const folders = ['c:\\ws\\claude-task-tracker'];

  it('splits a worktree path into repo + worktree, keeping original case', () => {
    const l = locate('C:\\Users\\me\\TradeMatrix\\.worktrees\\sc-declutter', folders);
    expect(l.repoLabel).toBe('TradeMatrix');
    expect(l.worktree).toBe('sc-declutter');
    expect(l.isCurrentWindow).toBe(false);
  });

  it('treats a normal repo as worktree=null', () => {
    const l = locate('c:\\ws\\claude-task-tracker\\src', folders);
    expect(l.repoLabel).toBe('claude-task-tracker');
    expect(l.worktree).toBeNull();
    expect(l.isCurrentWindow).toBe(true);
  });

  it('flags a worktree opened as the window folder as current window', () => {
    const l = locate('c:\\r\\Proj\\.worktrees\\feat', ['c:\\r\\Proj\\.worktrees\\feat']);
    expect(l.worktree).toBe('feat');
    expect(l.repoLabel).toBe('Proj');
    expect(l.isCurrentWindow).toBe(true);
  });

  it('maps a missing cwd to Unknown', () => {
    expect(locate(null, folders)).toEqual({ repoKey: '', repoLabel: 'Unknown (no cwd)', worktree: null, isCurrentWindow: false });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run viewModel` — expect FAIL (`locate` not exported).

- [ ] **Step 3: Add `locate` to `src/viewModel.ts`** (place after the existing `groupOf` function; do NOT remove `groupOf` yet):

```ts
export interface Location {
  repoKey: string;
  repoLabel: string;
  worktree: string | null;
  isCurrentWindow: boolean;
}

export function locate(cwd: string | null, workspaceFolders: string[]): Location {
  if (!cwd) {
    return { repoKey: '', repoLabel: 'Unknown (no cwd)', worktree: null, isCurrentWindow: false };
  }
  const slash = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const lower = slash.toLowerCase();
  const isCurrentWindow = workspaceFolders.some((folder) => {
    const f = folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return lower === f || lower.startsWith(f + '/');
  });
  const m = slash.match(/^(.*)\/\.worktrees\/([^/]+)(?:\/.*)?$/i);
  if (m) {
    return { repoKey: m[1].toLowerCase(), repoLabel: basename(m[1]), worktree: m[2], isCurrentWindow };
  }
  return { repoKey: lower, repoLabel: basename(slash), worktree: null, isCurrentWindow };
}
```

- [ ] **Step 4: Switch the status bar to `locate`.** In `src/statusBarText.ts`, change the import line `import { featureCounts, groupOf, relativeTime } from './viewModel';` to `import { featureCounts, locate, relativeTime } from './viewModel';`, and change the filter `groupOf(f.cwd, options.workspaceFolders).isCurrentWindow` to `locate(f.cwd, options.workspaceFolders).isCurrentWindow`.

- [ ] **Step 5: Run** `npx vitest run` (full) — all green. `npx tsc --noEmit` — clean. (`groupOf` is still used by `buildGroups`; it is removed in Task 2.)

- [ ] **Step 6: Commit:**
```bash
git add src/viewModel.ts src/statusBarText.ts test/viewModel.test.ts
git commit -m "feat: add locate() worktree-aware grouping; status bar uses it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Nested `buildGroups` (RepoGroup model)

**Files:** Modify `src/viewModel.ts` (rewrite `buildGroups`, add types, remove `groupOf`/`Group`); Modify `test/viewModel.test.ts`.

GATE NOTE: This changes `buildGroups`'s return type, so `npx tsc --noEmit` will report errors in `src/treeModel.ts` and `src/dashboard.ts` (they still expect `GroupView[]`) — those are fixed in Task 3. Gate for this task = `npx vitest run viewModel` passes.

- [ ] **Step 1: Replace the `buildGroups` test.** In `test/viewModel.test.ts`, find the `describe('buildGroups', ...)` block and replace its single test body with:

```ts
describe('buildGroups', () => {
  it('nests worktrees under their repo, pins current window, disambiguates per list', () => {
    const MIN = 60_000;
    const state = reduce([
      // current window repo, two same-name direct features (collision)
      { t: 'plan_detected', ts: 1 * MIN, session: 'aaa11111-x', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [] },
      { t: 'todo_update', ts: 1 * MIN, session: 'aaa11111-x', cwd: 'c:/ws/proj', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'plan_detected', ts: 2 * MIN, session: 'bbb22222-y', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [{ id: 'T1', text: 'a' }] },
      { t: 'todo_update', ts: 2 * MIN, session: 'bbb22222-y', cwd: 'c:/ws/proj', todos: [] },
      // a worktree of the SAME repo
      { t: 'todo_update', ts: 3 * MIN, session: 'ccc33333-z', cwd: 'c:/ws/proj/.worktrees/feat',
        todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]);

    const groups = buildGroups(state, opts({ now: 4 * MIN, workspaceFolders: ['c:/ws/proj'] }));

    expect(groups).toHaveLength(1);
    const repo = groups[0];
    expect(repo.label).toBe('proj');
    expect(repo.isCurrentWindow).toBe(true);
    // two same-name direct features → both get shortId suffix
    expect(repo.features.map((f) => f.label).sort()).toEqual(['Plan · aaa11111', 'Plan · bbb22222']);
    // the worktree is a subgroup, not a direct feature
    expect(repo.worktrees).toHaveLength(1);
    expect(repo.worktrees[0].name).toBe('feat');
    expect(repo.worktrees[0].features[0].feature.session).toBe('ccc33333-z');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run viewModel` — expect FAIL (buildGroups returns flat `GroupView[]`).

- [ ] **Step 3: Rewrite `buildGroups` and remove `groupOf`.** In `src/viewModel.ts`:

(a) DELETE the `Group` interface and the `groupOf` function entirely.

(b) Replace the `GroupView` interface and the `buildGroups` + `maxTs` functions with:

```ts
export interface WorktreeView {
  name: string;
  features: FeatureView[];
}

export interface RepoGroup {
  key: string;
  label: string;
  isCurrentWindow: boolean;
  features: FeatureView[];
  worktrees: WorktreeView[];
}

function toFeatureView(f: Feature): FeatureView {
  const { done, total } = featureCounts(f);
  return { session: f.session, label: f.label, status: f.status, done, total, feature: f };
}

function maxTs(features: FeatureView[]): number {
  return features.reduce((m, fv) => Math.max(m, fv.feature.lastTs), 0);
}

export function buildGroups(state: State, o: ViewOptions): RepoGroup[] {
  const repos = new Map<string, RepoGroup>();

  for (const f of state.features) {
    if (!isVisible(f, o)) {
      continue;
    }
    const loc = locate(f.cwd, o.workspaceFolders);
    let rg = repos.get(loc.repoKey);
    if (!rg) {
      rg = { key: loc.repoKey, label: loc.repoLabel, isCurrentWindow: false, features: [], worktrees: [] };
      repos.set(loc.repoKey, rg);
    }
    rg.isCurrentWindow = rg.isCurrentWindow || loc.isCurrentWindow;
    if (loc.worktree === null) {
      rg.features.push(toFeatureView(f));
    } else {
      let wt = rg.worktrees.find((w) => w.name === loc.worktree);
      if (!wt) {
        wt = { name: loc.worktree, features: [] };
        rg.worktrees.push(wt);
      }
      wt.features.push(toFeatureView(f));
    }
  }

  const byRecent = (a: FeatureView, b: FeatureView) => b.feature.lastTs - a.feature.lastTs;
  for (const rg of repos.values()) {
    rg.features.sort(byRecent);
    disambiguate(rg.features);
    rg.worktrees.sort((a, b) => maxTs(b.features) - maxTs(a.features));
    for (const wt of rg.worktrees) {
      wt.features.sort(byRecent);
      disambiguate(wt.features);
    }
  }

  const repoMaxTs = (rg: RepoGroup) =>
    Math.max(maxTs(rg.features), ...rg.worktrees.map((w) => maxTs(w.features)), 0);

  return [...repos.values()].sort((a, b) => {
    if (a.isCurrentWindow !== b.isCurrentWindow) {
      return a.isCurrentWindow ? -1 : 1;
    }
    if ((a.key === '') !== (b.key === '')) {
      return a.key === '' ? 1 : -1; // Unknown last
    }
    return repoMaxTs(b) - repoMaxTs(a);
  });
}
```

(Keep `disambiguate`, `featureCounts`, `isVisible`, `FeatureView`, `locate`, `relativeTime`, `basename`, `shortId`, `norm` as-is.)

- [ ] **Step 4: Run** `npx vitest run viewModel` — expect PASS. (Full `npx vitest run` may show treeModel/dashboard failures only if those files fail to transpile — they should still run since esbuild strips types; `npx tsc --noEmit` WILL show errors in treeModel.ts + dashboard.ts — expected, fixed in Task 3. Confirm the only tsc errors are in those two files.)

- [ ] **Step 5: Commit:**
```bash
git add src/viewModel.ts test/viewModel.test.ts
git commit -m "feat: buildGroups returns nested RepoGroup[] (repo + worktree subgroups)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Render the nesting in tree + dashboard

**Files:** Modify `src/treeModel.ts`, `src/dashboard.ts`; Modify `test/treeModel.test.ts`, `test/dashboard.test.ts`.

- [ ] **Step 1: Add failing tests.**

In `test/treeModel.test.ts`, append inside `describe('buildTree', ...)`:

```ts
  it('renders a worktree as a git-branch subgroup under its repo', () => {
    const state = reduce([
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/proj/.worktrees/feat', todos: [
        { text: 'a', status: 'in_progress' },
      ] },
    ] as TrackerEvent[]);
    const tree = buildTree(state, opts({ workspaceFolders: ['c:/ws/proj'] }));
    const repo = tree[0];
    expect(repo.kind).toBe('group');
    expect(repo.label).toBe('proj (this window)');
    const wt = repo.children![0];
    expect(wt.kind).toBe('group');
    expect(wt.label).toBe('feat');
    expect(wt.icon).toBe('git-branch');
    expect(wt.children![0].kind).toBe('feature');
  });
```

In `test/dashboard.test.ts`, append inside `describe('renderDashboardHtml', ...)`:

```ts
  it('renders a worktree as an h4 sub-header under the repo h3', () => {
    const state = reduce([
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/proj/.worktrees/feat', todos: [
        { text: 'a', status: 'in_progress' },
      ] },
    ] as TrackerEvent[]);
    const html = renderDashboardHtml(state, { now: 1000, workspaceFolders: ['c:/ws/proj'], hideDoneAfterMinutes: 0, dismissed: new Set() });
    expect(html).toContain('<h3>proj (this window)</h3>');
    expect(html).toContain('<h4>feat</h4>');
  });
```

- [ ] **Step 2: Run** `npx vitest run treeModel dashboard` — expect FAIL.

- [ ] **Step 3: Rewrite `buildTree` in `src/treeModel.ts`.** Replace the `buildTree` function with:

```ts
export function buildTree(state: State, options: ViewOptions): TreeNode[] {
  return buildGroups(state, options).map((rg): TreeNode => ({
    kind: 'group',
    label: rg.isCurrentWindow ? `${rg.label} (this window)` : rg.label,
    icon: 'folder',
    children: [
      ...rg.features.map(featureNode),
      ...rg.worktrees.map((wt): TreeNode => ({
        kind: 'group',
        label: wt.name,
        icon: 'git-branch',
        children: wt.features.map(featureNode),
      })),
    ],
  }));
}
```

(`featureNode`, `taskNodes`, `subagentNodes`, `progressBar`, etc. are unchanged. The `import { buildGroups, FeatureView } from './viewModel';` line stays valid — `FeatureView` is still exported.)

- [ ] **Step 4: Rewrite `renderDashboardHtml` in `src/dashboard.ts`.** Replace the `renderDashboardHtml` function body's `body` computation and add the `h4` style. Replace the whole function with:

```ts
export function renderDashboardHtml(state: State, options: ViewOptions): string {
  const groups = buildGroups(state, options);
  const body = groups.length === 0
    ? '<p class="empty">No active sessions.</p>'
    : groups.map((rg) => `
        <h3>${esc(rg.isCurrentWindow ? `${rg.label} (this window)` : rg.label)}</h3>
        ${rg.features.map(card).join('')}
        ${rg.worktrees.map((wt) => `
          <h4>${esc(wt.name)}</h4>
          ${wt.features.map(card).join('')}
        `).join('')}
      `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 6px 8px; font-size: 12px; }
    h3 { font-size: 11px; text-transform: uppercase; opacity: .7; margin: 12px 0 4px; }
    h4 { font-size: 10px; text-transform: uppercase; opacity: .55; margin: 6px 0 2px 12px; }
    .card { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill { font-size: 10px; }
    .bar { flex: 1; max-width: 120px; height: 6px; border-radius: 3px; background: var(--vscode-editorWidget-background); overflow: hidden; }
    .bar > i { display: block; height: 100%; }
    .cnt { opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .empty { opacity: .6; }
  </style></head><body>${body}</body></html>`;
}
```

(`esc`, `PILL`, `COLOR`, `card`, and `DashboardProvider` are unchanged.)

- [ ] **Step 5: Run** `npx vitest run` (full) — ALL green. `npx tsc --noEmit` — ZERO errors (treeModel + dashboard now match the new `buildGroups`). `npm run build` — dist written.

- [ ] **Step 6: Commit:**
```bash
git add src/treeModel.ts src/dashboard.ts test/treeModel.test.ts test/dashboard.test.ts
git commit -m "feat: render worktree subgroups in tree (git-branch) and dashboard (h4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Build & package

- [ ] `npx tsc --noEmit` (zero), `npx vitest run` (report count), `npm run build`, `npx --yes @vscode/vsce package`.
- [ ] **Manual (human):** install vsix + reload. A TradeMatrix worktree session shows as `TradeMatrix ▸ sc-declutter ▸ feature` (worktree row has the git-branch icon); dashboard shows the repo h3 with an indented worktree h4; non-worktree repos still render flat; status bar unchanged.

---

## Self-Review

- **Spec coverage:** `locate` (Task 1) · nested `buildGroups`/RepoGroup, remove `groupOf` (Task 2) · tree nesting + dashboard nesting (Task 3) · status bar via `locate` (Task 1). Build/package (Task 4).
- **Type consistency:** `locate→Location{repoKey,repoLabel,worktree,isCurrentWindow}`; `buildGroups→RepoGroup{key,label,isCurrentWindow,features,worktrees:WorktreeView[]}`; `treeModel`/`dashboard` consume `rg.features` + `rg.worktrees[].features`; `FeatureView` unchanged; `statusBarText` imports `locate` (not `groupOf`).
- **No placeholders:** full code in every step. Interim tsc breakage (Task 2 → fixed Task 3) is called out explicitly.
