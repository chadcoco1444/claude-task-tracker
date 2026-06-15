# Tracker UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add colored status lights, per-kind icons, text progress bars, workspace grouping, a Dashboard webview, a workspace-scoped status bar, on-collision label disambiguation, and auto-hide of completed features.

**Architecture:** Keep `reduce()` pure and add a `cwd` field to `Feature`. Put all view-time logic (grouping, relative time, visibility, disambiguation) in one new pure module `src/viewModel.ts`, shared by the tree, the dashboard, and the status bar. `vscode`-importing files (`treeProvider`, `statusBar`, `dashboard` provider, `extension`) stay thin glue, verified by build + manual run. `now`, `workspaceFolders`, settings, and a `dismissed` set are injected at render time via a `ViewOptions` object.

**Tech Stack:** TypeScript, VSCode extension API, esbuild, vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-tracker-ui-v2-design.md`

---

## File Structure

- `src/types.ts` — add `cwd` to `Feature`; add `ViewOptions`; extend `TreeNode` (`kind:'group'`, `iconColor?`).
- `src/reducer.ts` — persist `cwd` on the feature.
- `src/viewModel.ts` (NEW, pure) — `relativeTime`, `groupOf`, `featureCounts`, `isVisible`, `buildGroups`, `shortId`, `basename`, and `FeatureView`/`GroupView` types.
- `src/treeModel.ts` — rewrite `buildTree(state, opts)` to emit group→feature→task/subagent nodes with icons/colors/progress.
- `src/treeProvider.ts` — apply `ThemeColor`; expand groups; expose `refresh()`.
- `src/statusBarText.ts` — `summarize(state, opts)` filtered to the current window.
- `src/statusBar.ts` — expose `refresh()`, read injected options.
- `src/dashboard.ts` (NEW) — pure `renderDashboardHtml(state, opts)` + `DashboardProvider` webview glue.
- `src/extension.ts` — build `ViewOptions`, register webview, refresh timer, `clearCompleted` command, `dismissed` set.
- `package.json` — second (webview) view, `configuration`, `clearCompleted` command.

Shared names (keep identical across tasks):

```ts
interface ViewOptions {
  now: number;
  workspaceFolders: string[];
  hideDoneAfterMinutes: number;
  dismissed: ReadonlySet<string>;
}
```

---

## Task 1: Persist `cwd` on Feature

**Files:**
- Modify: `src/types.ts` (Feature interface)
- Modify: `src/reducer.ts` (`newFeature`, reduce loop)
- Test: `test/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('reduce', ...)` block in `test/reducer.test.ts`:

```ts
  it('stores the full cwd on the feature (latest event wins; null when never seen)', () => {
    const withCwd = reduce([
      { t: 'todo_update', ts: 1, session: 's1', cwd: '/a/one', todos: [{ text: 'x', status: 'pending' }] },
      { t: 'subagent_stop', ts: 2, session: 's1', cwd: '/a/two' },
    ] as TrackerEvent[]).features[0];
    expect(withCwd.cwd).toBe('/a/two');

    const noCwd = reduce([
      { t: 'subagent_stop', ts: 1, session: 's2' },
    ] as TrackerEvent[]).features[0];
    expect(noCwd.cwd).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run reducer`
Expected: FAIL — `withCwd.cwd` is `undefined` (property does not exist).

- [ ] **Step 3: Add the field to the type**

In `src/types.ts`, add `cwd` to the `Feature` interface (after `label`/`labelSource`):

```ts
export interface Feature {
  session: string;
  label: string;
  labelSource: LabelSource;
  cwd: string | null;
  planPath: string | null;
  skeleton: SkeletonTask[];
  liveTodos: Todo[];
  subagents: Subagent[];
  stopped: boolean;
  lastTs: number;
  status: FeatureStatus;
}
```

- [ ] **Step 4: Initialise and populate it in the reducer**

In `src/reducer.ts`, add `cwd: null,` to the `newFeature` return object (after `labelSource: 'default',`):

```ts
    labelSource: 'default',
    cwd: null,
```

Then in the reduce loop, store the full cwd alongside the label derivation:

```ts
    if ('cwd' in e && e.cwd) {
      f.cwd = e.cwd;
      setLabel(f, basename(e.cwd), 'cwd');
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run reducer`
Expected: PASS (all reducer tests green).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/reducer.ts test/reducer.test.ts
git commit -m "feat: persist cwd on feature for grouping and scope"
```

---

## Task 2: `relativeTime` helper

**Files:**
- Create: `src/viewModel.ts`
- Test: `test/viewModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/viewModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { relativeTime } from '../src/viewModel';

const MIN = 60_000;

describe('relativeTime', () => {
  it('formats recent, minutes, hours, and days', () => {
    expect(relativeTime(1_000_000, 1_000_000)).toBe('now');
    expect(relativeTime(1_000_000, 1_000_000 - 30_000)).toBe('now');   // < 45s
    expect(relativeTime(1_000_000, 1_000_000 - 5 * MIN)).toBe('5m ago');
    expect(relativeTime(1_000_000, 1_000_000 - 3 * 60 * MIN)).toBe('3h ago');
    expect(relativeTime(1_000_000, 1_000_000 - 2 * 24 * 60 * MIN)).toBe('2d ago');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run viewModel`
Expected: FAIL — cannot find module `../src/viewModel`.

- [ ] **Step 3: Create the module with the helper**

Create `src/viewModel.ts`:

```ts
import { Feature, State, ViewOptions } from './types';

export function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function shortId(session: string): string {
  return session.split('-')[0] || session;
}

export function relativeTime(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) {
    return 'now';
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.floor(h / 24)}d ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run viewModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/viewModel.ts test/viewModel.test.ts
git commit -m "feat: add relativeTime view helper"
```

---

## Task 3: `groupOf` workspace matching

**Files:**
- Modify: `src/viewModel.ts`
- Test: `test/viewModel.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/viewModel.test.ts`:

```ts
import { groupOf } from '../src/viewModel';

describe('groupOf', () => {
  const folders = ['c:\\ws\\claude-task-tracker'];

  it('maps a cwd inside an open folder to the current window', () => {
    const g = groupOf('c:\\ws\\claude-task-tracker\\src', folders);
    expect(g).toEqual({ key: 'c:\\ws\\claude-task-tracker', label: 'claude-task-tracker', isCurrentWindow: true });
  });

  it('maps an outside cwd to its own group', () => {
    const g = groupOf('c:\\ws\\TradeMatrix', folders);
    expect(g.isCurrentWindow).toBe(false);
    expect(g.label).toBe('TradeMatrix');
  });

  it('maps a missing cwd to the Unknown group', () => {
    expect(groupOf(null, folders)).toEqual({ key: '', label: 'Unknown (no cwd)', isCurrentWindow: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run viewModel`
Expected: FAIL — `groupOf` is not exported.

- [ ] **Step 3: Implement `groupOf`**

Add to `src/viewModel.ts`:

```ts
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export interface Group {
  key: string;
  label: string;
  isCurrentWindow: boolean;
}

export function groupOf(cwd: string | null, workspaceFolders: string[]): Group {
  if (!cwd) {
    return { key: '', label: 'Unknown (no cwd)', isCurrentWindow: false };
  }
  const c = norm(cwd);
  for (const folder of workspaceFolders) {
    const f = norm(folder);
    if (c === f || c.startsWith(f + '/')) {
      return { key: folder, label: basename(folder), isCurrentWindow: true };
    }
  }
  return { key: cwd, label: basename(cwd), isCurrentWindow: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run viewModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/viewModel.ts test/viewModel.test.ts
git commit -m "feat: add groupOf workspace matching"
```

---

## Task 4: `featureCounts`, `isVisible`, and `buildGroups`

**Files:**
- Modify: `src/viewModel.ts`
- Modify: `src/types.ts` (add `ViewOptions`)
- Test: `test/viewModel.test.ts`

- [ ] **Step 1: Add the `ViewOptions` type**

In `src/types.ts`, append:

```ts
export interface ViewOptions {
  now: number;
  workspaceFolders: string[];
  hideDoneAfterMinutes: number;
  dismissed: ReadonlySet<string>;
}
```

- [ ] **Step 2: Write the failing test**

Append to `test/viewModel.test.ts`:

```ts
import { buildGroups, featureCounts, isVisible } from '../src/viewModel';
import { reduce } from '../src/reducer';
import { TrackerEvent, ViewOptions } from '../src/types';

const MINUTE = 60_000;
const opts = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  now: 10 * 60 * MINUTE,
  workspaceFolders: [],
  hideDoneAfterMinutes: 30,
  dismissed: new Set(),
  ...over,
});

describe('featureCounts', () => {
  it('counts live todos, falling back to skeleton size', () => {
    const f = reduce([
      { t: 'plan_detected', ts: 1, session: 's', plan: '/p.md', title: 'P',
        tasks: [{ id: 'T1', text: 'a' }, { id: 'T2', text: 'b' }] },
    ] as TrackerEvent[]).features[0];
    expect(featureCounts(f)).toEqual({ done: 0, total: 2 });
  });
});

describe('isVisible', () => {
  const doneFeature = (lastTs: number) => reduce([
    { t: 'todo_update', ts: lastTs, session: 's', todos: [{ text: 'x', status: 'completed' }] },
    { t: 'session_stop', ts: lastTs, session: 's' },
  ] as TrackerEvent[]).features[0];

  it('hides a done feature past the retention window', () => {
    const f = doneFeature(0);
    expect(isVisible(f, opts({ now: 20 * MINUTE }))).toBe(true);   // within 30m
    expect(isVisible(f, opts({ now: 40 * MINUTE }))).toBe(false);  // past 30m
  });

  it('never hides when retention is 0', () => {
    expect(isVisible(doneFeature(0), opts({ now: 999 * MINUTE, hideDoneAfterMinutes: 0 }))).toBe(true);
  });

  it('hides dismissed sessions regardless of status', () => {
    const f = doneFeature(0);
    expect(isVisible(f, opts({ now: 0, dismissed: new Set(['s']) }))).toBe(false);
  });
});

describe('buildGroups', () => {
  it('groups by workspace, pins the current window first, and disambiguates collisions', () => {
    const state = reduce([
      // current-window: two sessions, same plan title -> collision
      { t: 'todo_update', ts: 1 * MINUTE, session: 'aaa11111-x', cwd: 'c:/ws/proj',
        todos: [{ text: 'a', status: 'completed' }] },
      { t: 'plan_detected', ts: 1 * MINUTE, session: 'aaa11111-x', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [] },
      { t: 'plan_detected', ts: 5 * MINUTE, session: 'bbb22222-y', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [{ id: 'T1', text: 'a' }] },
      { t: 'todo_update', ts: 5 * MINUTE, session: 'bbb22222-y', cwd: 'c:/ws/proj', todos: [] },
      // other window
      { t: 'todo_update', ts: 2 * MINUTE, session: 'ccc33333-z', cwd: 'c:/ws/Other',
        todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]);

    const groups = buildGroups(state, opts({ now: 6 * MINUTE, workspaceFolders: ['c:/ws/proj'] }));

    expect(groups[0].label).toBe('proj');
    expect(groups[0].isCurrentWindow).toBe(true);
    // both 'Plan' rows get a disambiguating suffix
    expect(groups[0].features.every((fv) => fv.label.startsWith('Plan · '))).toBe(true);
    // 'Other' group present and not current window
    expect(groups.some((g) => g.label === 'Other' && !g.isCurrentWindow)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run viewModel`
Expected: FAIL — `buildGroups`/`featureCounts`/`isVisible` not exported.

- [ ] **Step 4: Implement the three functions**

Add to `src/viewModel.ts`:

```ts
export function featureCounts(f: Feature): { done: number; total: number } {
  const useTodos = f.liveTodos.length > 0;
  const total = useTodos ? f.liveTodos.length : f.skeleton.length;
  const done = f.liveTodos.filter((t) => t.status === 'completed').length;
  return { done, total };
}

export function isVisible(f: Feature, o: ViewOptions): boolean {
  if (o.dismissed.has(f.session)) {
    return false;
  }
  if (f.status === 'done' && o.hideDoneAfterMinutes > 0) {
    if (o.now - f.lastTs > o.hideDoneAfterMinutes * 60_000) {
      return false;
    }
  }
  return true;
}

export interface FeatureView {
  session: string;
  label: string;
  status: Feature['status'];
  done: number;
  total: number;
  feature: Feature;
}

export interface GroupView {
  key: string;
  label: string;
  isCurrentWindow: boolean;
  features: FeatureView[];
}

export function buildGroups(state: State, o: ViewOptions): GroupView[] {
  const groups = new Map<string, GroupView>();

  for (const f of state.features) {
    if (!isVisible(f, o)) {
      continue;
    }
    const g = groupOf(f.cwd, o.workspaceFolders);
    let gv = groups.get(g.key);
    if (!gv) {
      gv = { key: g.key, label: g.label, isCurrentWindow: g.isCurrentWindow, features: [] };
      groups.set(g.key, gv);
    }
    const { done, total } = featureCounts(f);
    gv.features.push({ session: f.session, label: f.label, status: f.status, done, total, feature: f });
  }

  for (const gv of groups.values()) {
    gv.features.sort((a, b) => b.feature.lastTs - a.feature.lastTs);
    disambiguate(gv.features, o.now);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.isCurrentWindow !== b.isCurrentWindow) {
      return a.isCurrentWindow ? -1 : 1;
    }
    if (a.key === '' !== (b.key === '')) {
      return a.key === '' ? 1 : -1; // Unknown last
    }
    return maxTs(b) - maxTs(a);
  });
}

function maxTs(g: GroupView): number {
  return g.features.reduce((m, fv) => Math.max(m, fv.feature.lastTs), 0);
}

function disambiguate(features: FeatureView[], now: number): void {
  const counts = new Map<string, number>();
  for (const fv of features) {
    counts.set(fv.label, (counts.get(fv.label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const fv of features) {
    if ((counts.get(fv.label) ?? 0) < 2) {
      continue;
    }
    let suffix = relativeTime(now, fv.feature.lastTs);
    const withTime = `${fv.label} · ${suffix}`;
    const n = (seen.get(withTime) ?? 0) + 1;
    seen.set(withTime, n);
    suffix = n > 1 ? `${suffix} · ${shortId(fv.session)}` : suffix;
    fv.label = `${fv.label} · ${suffix}`;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run viewModel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/viewModel.ts src/types.ts test/viewModel.test.ts
git commit -m "feat: add featureCounts, isVisible, and buildGroups"
```

---

## Task 5: Rewrite `buildTree` (groups, icons, colors, progress)

**Files:**
- Modify: `src/types.ts` (`TreeNode`)
- Modify: `src/treeModel.ts`
- Test: `test/treeModel.test.ts` (rewrite)

- [ ] **Step 1: Extend `TreeNode`**

In `src/types.ts`, append:

```ts
export interface TreeNode {
  kind: 'group' | 'feature' | 'task' | 'subagent';
  label: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  children?: TreeNode[];
  resourcePath?: string;
}
```

(If a `TreeNode` interface already lives in `treeModel.ts`, delete it there and import from `types.ts` instead.)

- [ ] **Step 2: Write the failing test (rewrite the file)**

Replace the contents of `test/treeModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/treeModel';
import { reduce } from '../src/reducer';
import { TrackerEvent, TreeNode, ViewOptions } from '../src/types';

const opts = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  now: 1000, workspaceFolders: [], hideDoneAfterMinutes: 0, dismissed: new Set(), ...over,
});

const find = (nodes: TreeNode[], kind: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.kind === kind) return n;
    const hit = n.children && find(n.children, kind);
    if (hit) return hit;
  }
  return undefined;
};

describe('buildTree', () => {
  it('nests group -> feature -> task/subagent with colored icons and a progress bar', () => {
    const state = reduce([
      { t: 'session_start', ts: 1, session: 's1', cwd: 'c:/ws/auth' },
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [
        { text: 'DB', status: 'completed' },
        { text: 'UI', status: 'in_progress' },
      ] },
      { t: 'subagent_start', ts: 3, session: 's1', cwd: 'c:/ws/auth', agent: 'a1', kind: 'frontend-developer', desc: 'UI' },
    ] as TrackerEvent[]);

    const tree = buildTree(state, opts({ workspaceFolders: ['c:/ws/auth'] }));

    const group = tree[0];
    expect(group.kind).toBe('group');
    expect(group.label).toBe('auth (this window)');

    const feature = group.children![0];
    expect(feature.kind).toBe('feature');
    expect(feature.icon).toBe('rocket');
    expect(feature.iconColor).toBe('charts.blue');           // active
    expect(feature.description).toBe('▰▰▱▱ 1/2');

    const subagent = find([feature], 'subagent')!;
    expect(subagent.icon).toBe('robot');
  });

  it('shows skeleton tasks as planned when there are no todos', () => {
    const state = reduce([
      { t: 'session_start', ts: 1, session: 's1', cwd: 'c:/ws/auth' },
      { t: 'plan_detected', ts: 2, session: 's1', plan: 'c:/ws/auth/p.md', title: 'Auth',
        tasks: [{ id: 'T1', text: 'DB' }] },
    ] as TrackerEvent[]);

    const feature = find(buildTree(state, opts()), 'feature')!;
    expect(feature.description).toBe('▱▱▱▱ 0/1');
    expect(feature.resourcePath).toBe('c:/ws/auth/p.md');
    const task = feature.children![0];
    expect(task.description).toBe('planned');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run treeModel`
Expected: FAIL — `buildTree` takes one arg / returns feature nodes at top level.

- [ ] **Step 4: Rewrite `src/treeModel.ts`**

Replace the contents of `src/treeModel.ts`:

```ts
import { Feature, State, TodoStatus, TreeNode, ViewOptions } from './types';
import { buildGroups, FeatureView } from './viewModel';

const FEATURE_COLOR: Record<Feature['status'], string> = {
  done: 'charts.green',
  active: 'charts.blue',
  idle: 'disabledForeground',
};

function featureIcon(status: Feature['status']): { icon: string; iconColor: string } {
  return { icon: 'rocket', iconColor: FEATURE_COLOR[status] };
}

function todoVisual(status: TodoStatus): { icon: string; iconColor: string } {
  if (status === 'completed') {
    return { icon: 'check', iconColor: 'charts.green' };
  }
  if (status === 'in_progress') {
    return { icon: 'sync~spin', iconColor: 'charts.yellow' };
  }
  return { icon: 'circle-outline', iconColor: 'disabledForeground' };
}

function progressBar(done: number, total: number): string {
  const slots = 4;
  const filled = total > 0 ? Math.round((done / total) * slots) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(slots - filled);
}

function taskNodes(f: Feature): TreeNode[] {
  if (f.liveTodos.length > 0) {
    return f.liveTodos.map((td) => {
      const v = todoVisual(td.status);
      return { kind: 'task', label: td.text, icon: v.icon, iconColor: v.iconColor };
    });
  }
  return f.skeleton.map((sk) => ({
    kind: 'task', label: sk.text, description: 'planned', icon: 'circle-outline', iconColor: 'disabledForeground',
  }));
}

function subagentNodes(f: Feature): TreeNode[] {
  return f.subagents.map((s) => ({
    kind: 'subagent',
    label: s.kind,
    description: s.desc,
    icon: 'robot',
    iconColor: s.status === 'converged' ? 'charts.green' : 'charts.blue',
  }));
}

function featureNode(fv: FeatureView): TreeNode {
  const v = featureIcon(fv.status);
  return {
    kind: 'feature',
    label: fv.label,
    description: `${progressBar(fv.done, fv.total)} ${fv.done}/${fv.total}`,
    icon: v.icon,
    iconColor: v.iconColor,
    resourcePath: fv.feature.planPath ?? undefined,
    children: [...taskNodes(fv.feature), ...subagentNodes(fv.feature)],
  };
}

export function buildTree(state: State, options: ViewOptions): TreeNode[] {
  return buildGroups(state, options).map((g) => ({
    kind: 'group',
    label: g.isCurrentWindow ? `${g.label} (this window)` : g.label,
    icon: 'folder',
    children: g.features.map(featureNode),
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run treeModel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/treeModel.ts test/treeModel.test.ts
git commit -m "feat: group tree with colored icons and progress bars"
```

---

## Task 6: TreeProvider colors + group expansion (glue)

**Files:**
- Modify: `src/treeProvider.ts`

- [ ] **Step 1: Update `getTreeItem` to apply color and refresh API**

Replace the contents of `src/treeProvider.ts`:

```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { buildTree } from './treeModel';
import { TreeNode, ViewOptions } from './types';

export class TrackerTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private store: TrackerStore, private getOptions: () => ViewOptions) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsible = node.children && node.children.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.description;
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(
        node.icon,
        node.iconColor ? new vscode.ThemeColor(node.iconColor) : undefined,
      );
    }
    if (node.kind === 'feature' && node.resourcePath) {
      item.command = {
        command: 'vscode.open',
        title: 'Open plan',
        arguments: [vscode.Uri.file(node.resourcePath)],
      };
    }
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return buildTree(this.store.state, this.getOptions());
    }
    return node.children ?? [];
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only in `extension.ts` (constructor now needs `getOptions`) — that is fixed in Task 10. No errors in `treeProvider.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/treeProvider.ts
git commit -m "feat: colored tree icons and refresh() on provider"
```

---

## Task 7: Workspace-scoped status bar

**Files:**
- Modify: `src/statusBarText.ts`
- Modify: `src/statusBar.ts`
- Test: `test/statusBarText.test.ts` (rewrite)

- [ ] **Step 1: Write the failing test (rewrite the file)**

Replace the contents of `test/statusBarText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarize } from '../src/statusBarText';
import { reduce } from '../src/reducer';
import { TrackerEvent } from '../src/types';

const base = { now: 1000, workspaceFolders: ['c:/ws/auth'] };

describe('summarize', () => {
  it('is empty when there is no active feature in this window', () => {
    expect(summarize(reduce([]), base)).toBe('');
  });

  it('shows the current-window active feature with progress and running count', () => {
    const text = summarize(reduce([
      { t: 'session_start', ts: 1, session: 's1', cwd: 'c:/ws/auth' },
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'in_progress' },
      ] },
      { t: 'subagent_start', ts: 3, session: 's1', cwd: 'c:/ws/auth', agent: 'x', kind: 'k', desc: '' },
    ] as TrackerEvent[]), base);
    expect(text).toContain('auth 1/2');
    expect(text).toContain('1');
  });

  it('ignores active features from other workspaces', () => {
    const text = summarize(reduce([
      { t: 'todo_update', ts: 2, session: 's2', cwd: 'c:/ws/Other', todos: [
        { text: 'a', status: 'in_progress' },
      ] },
    ] as TrackerEvent[]), base);
    expect(text).toBe('');
  });
});
```

(Note: the feature label is `auth` because `cwd` basename, not a plan title, sets it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run statusBarText`
Expected: FAIL — `summarize` takes one arg / does not filter by workspace.

- [ ] **Step 3: Rewrite `src/statusBarText.ts`**

Replace the contents of `src/statusBarText.ts`:

```ts
import { State, ViewOptions } from './types';
import { featureCounts, groupOf } from './viewModel';

type StatusOptions = Pick<ViewOptions, 'now' | 'workspaceFolders'>;

export function summarize(state: State, options: StatusOptions): string {
  const active = state.features.filter(
    (f) => f.status === 'active' && groupOf(f.cwd, options.workspaceFolders).isCurrentWindow,
  );
  if (active.length === 0) {
    return '';
  }
  active.sort((a, b) => b.lastTs - a.lastTs);
  const f = active[0];
  const { done, total } = featureCounts(f);
  const running = f.subagents.filter((s) => s.status === 'running').length;
  const more = active.length > 1 ? ` +${active.length - 1}` : '';
  return `$(rocket) ${f.label} ${done}/${total} · $(sync~spin)${running}${more}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run statusBarText`
Expected: PASS.

- [ ] **Step 5: Update the status-bar glue**

Replace the contents of `src/statusBar.ts`:

```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { summarize } from './statusBarText';
import { ViewOptions } from './types';

export interface StatusBar {
  item: vscode.StatusBarItem;
  refresh(): void;
}

export function createStatusBar(store: TrackerStore, getOptions: () => ViewOptions): StatusBar {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'claudeTaskTracker.focus';
  const refresh = () => {
    const o = getOptions();
    const text = summarize(store.state, { now: o.now, workspaceFolders: o.workspaceFolders });
    if (text) {
      item.text = text;
      item.tooltip = 'Claude Task Tracker — click to focus';
      item.show();
    } else {
      item.hide();
    }
  };
  refresh();
  return { item, refresh };
}
```

- [ ] **Step 6: Verify it compiles (status-bar module only)**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `extension.ts` (fixed in Task 10).

- [ ] **Step 7: Commit**

```bash
git add src/statusBarText.ts src/statusBar.ts test/statusBarText.test.ts
git commit -m "feat: scope status bar to the current workspace"
```

---

## Task 8: Dashboard webview (pure HTML + provider glue)

**Files:**
- Create: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from '../src/dashboard';
import { reduce } from '../src/reducer';
import { TrackerEvent, ViewOptions } from '../src/types';

const opts: ViewOptions = {
  now: 1000, workspaceFolders: ['c:/ws/auth'], hideDoneAfterMinutes: 0, dismissed: new Set(),
};

describe('renderDashboardHtml', () => {
  it('renders a group header, the feature label, a percentage, and a status pill', () => {
    const state = reduce([
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'in_progress' },
      ] },
    ] as TrackerEvent[]);

    const html = renderDashboardHtml(state, opts);
    expect(html).toContain('auth (this window)');
    expect(html).toContain('auth');        // feature label (cwd basename)
    expect(html).toContain('50%');         // 1/2
    expect(html).toContain('running');     // status pill (active)
  });

  it('escapes HTML in labels', () => {
    const state = reduce([
      { t: 'plan_detected', ts: 1, session: 's1', plan: '/p.md', title: '<script>x</script>', tasks: [] },
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [] },
    ] as TrackerEvent[]);
    expect(renderDashboardHtml(state, opts)).not.toContain('<script>x</script>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard`
Expected: FAIL — cannot find module `../src/dashboard`.

- [ ] **Step 3: Implement `src/dashboard.ts`**

Create `src/dashboard.ts`:

```ts
import * as vscode from 'vscode';
import { State, ViewOptions } from './types';
import { buildGroups, FeatureView } from './viewModel';
import { TrackerStore } from './store';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const PILL: Record<string, string> = { done: 'done', active: 'running', idle: 'idle' };
const COLOR: Record<string, string> = {
  done: 'var(--vscode-charts-green)',
  active: 'var(--vscode-charts-blue)',
  idle: 'var(--vscode-disabledForeground)',
};

function card(fv: FeatureView): string {
  const pct = fv.total > 0 ? Math.round((fv.done / fv.total) * 100) : 0;
  const color = COLOR[fv.status];
  return `
    <div class="card">
      <span class="dot" style="background:${color}"></span>
      <span class="nm">${esc(fv.label)}</span>
      <span class="pill" style="color:${color}">${PILL[fv.status]}</span>
      <span class="bar"><i style="width:${pct}%;background:${color}"></i></span>
      <span class="cnt">${fv.done}/${fv.total} · ${pct}%</span>
    </div>`;
}

export function renderDashboardHtml(state: State, options: ViewOptions): string {
  const groups = buildGroups(state, options);
  const body = groups.length === 0
    ? '<p class="empty">No active sessions.</p>'
    : groups.map((g) => `
        <h3>${esc(g.isCurrentWindow ? `${g.label} (this window)` : g.label)}</h3>
        ${g.features.map(card).join('')}
      `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 6px 8px; font-size: 12px; }
    h3 { font-size: 11px; text-transform: uppercase; opacity: .7; margin: 12px 0 4px; }
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

export class DashboardProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private store: TrackerStore, private getOptions: () => ViewOptions) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };
    this.refresh();
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = renderDashboardHtml(this.store.state, this.getOptions());
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run dashboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat: dashboard webview renderer and provider"
```

---

## Task 9: package.json — webview view, settings, command

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the second view, configuration, and command**

In `package.json`, replace the `contributes.views` and `contributes.commands` blocks, and add a `configuration` block, so `contributes` reads:

```jsonc
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "claudeTaskTracker", "title": "Tracker", "icon": "$(checklist)" }
      ]
    },
    "views": {
      "claudeTaskTracker": [
        { "id": "claudeTaskTracker.view", "name": "Tasks & Subagents" },
        { "id": "claudeTaskTracker.dashboard", "name": "Dashboard", "type": "webview" }
      ]
    },
    "commands": [
      { "command": "claudeTaskTracker.refresh", "title": "Tracker: Refresh" },
      { "command": "claudeTaskTracker.focus", "title": "Tracker: Focus" },
      { "command": "claudeTaskTracker.clearCompleted", "title": "Tracker: Clear completed" }
    ],
    "configuration": {
      "title": "Claude Task Tracker",
      "properties": {
        "claudeTaskTracker.hideDoneAfterMinutes": {
          "type": "number",
          "default": 30,
          "minimum": 0,
          "description": "Hide a completed feature this many minutes after it finishes (0 = never hide)."
        }
      }
    }
  },
```

- [ ] **Step 2: Verify the manifest is valid JSON**

Run: `node -e "require('./package.json'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: contribute Dashboard view, retention setting, clear-completed command"
```

---

## Task 10: Wire it together in extension.ts (glue)

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Rewrite `src/extension.ts`**

Replace the contents of `src/extension.ts`:

```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { DashboardProvider } from './dashboard';
import { eventLogPath } from './paths';
import { ViewOptions } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TrackerStore(eventLogPath());
  const dismissed = new Set<string>();

  const getOptions = (): ViewOptions => ({
    now: Date.now(),
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    hideDoneAfterMinutes: vscode.workspace
      .getConfiguration('claudeTaskTracker')
      .get<number>('hideDoneAfterMinutes', 30),
    dismissed,
  });

  const tree = new TrackerTreeProvider(store, getOptions);
  const dashboard = new DashboardProvider(store, getOptions);
  const statusBar = createStatusBar(store, getOptions);

  const refreshAll = () => {
    tree.refresh();
    dashboard.refresh();
    statusBar.refresh();
  };

  const view = vscode.window.createTreeView('claudeTaskTracker.view', { treeDataProvider: tree });
  const timer = setInterval(refreshAll, 60_000); // advance relative times / auto-hide

  context.subscriptions.push(
    view,
    statusBar.item,
    vscode.window.registerWebviewViewProvider('claudeTaskTracker.dashboard', dashboard),
    vscode.commands.registerCommand('claudeTaskTracker.focus', () => {
      vscode.commands.executeCommand('claudeTaskTracker.view.focus');
    }),
    vscode.commands.registerCommand('claudeTaskTracker.refresh', refreshAll),
    vscode.commands.registerCommand('claudeTaskTracker.clearCompleted', () => {
      for (const f of store.state.features) {
        if (f.status === 'done') {
          dismissed.add(f.session);
        }
      }
      refreshAll();
    }),
    { dispose: () => { clearInterval(timer); store.dispose(); } },
  );

  store.onChange(refreshAll);
  store.start();
}

export function deactivate(): void {}
```

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all suites pass (reducer, viewModel, treeModel, statusBarText, dashboard, eventLog, store).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: esbuild writes `dist/extension.js` and `dist/hook.js` with no errors.

- [ ] **Step 5: Manual verification (F5)**

Press `F5` to launch the Extension Development Host. Confirm:
- The Tracker panel shows two stacked views: `Tasks & Subagents` (tree) and `Dashboard`.
- Tree rows are grouped by project; the current window's group is first and suffixed `(this window)`.
- Feature/task/subagent icons are colored (green/blue/yellow/grey).
- Feature descriptions show a `▰▰▱▱ n/m` bar.
- The status bar shows only a current-window active session (not another workspace's).
- Running `Tracker: Clear completed` hides done features; they also auto-hide after the configured minutes.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire dashboard, scoped status bar, refresh timer, clear-completed"
```

---

## Self-Review (completed)

- **Spec coverage:** A (Task 9 view + Task 10 register) · B grouping/lights/icons/progress (Tasks 4–6) · C dashboard (Task 8) · D scope (Tasks 6/7/10) · E auto-hide + clear (Tasks 4, 9, 10) · F settings (Task 9) · G pure reducer + injected `now`/folders + refresh timer (Tasks 1, 4, 10). All sections map to tasks.
- **Type consistency:** `ViewOptions{now, workspaceFolders, hideDoneAfterMinutes, dismissed}`, `buildGroups`, `buildTree(state, options)`, `summarize(state, options)`, `renderDashboardHtml(state, options)`, `FeatureView`, `GroupView`, `TreeNode{kind:'group'|...; icon?; iconColor?}` are used identically everywhere.
- **No placeholders:** every code step contains full code; every run step states expected output.
- **Glue caveat:** `treeProvider`, `statusBar`, `dashboard` provider, and `extension` import `vscode` and are verified by `tsc --noEmit` + `npm run build` + the F5 manual check, matching the project's existing untested-wrapper pattern.
```
