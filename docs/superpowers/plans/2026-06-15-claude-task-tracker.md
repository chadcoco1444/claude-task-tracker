# Claude Task Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VSCode extension that visualizes Claude Code task progress and subagent convergence by reading an append-only event log written by Claude Code hooks.

**Architecture:** Claude Code hooks append JSON events to a global `~/.claude/tracker/events.jsonl`. The extension watches that file, folds events into state with a pure reducer, and renders a sidebar TreeView (Feature → Task → Subagent) plus a bottom status-bar summary. All non-UI logic (reducer, event log, hook payload mapping, tree/status-bar models) is pure and unit-tested; only thin wrappers import `vscode`.

**Tech Stack:** TypeScript, Node, VSCode Extension API, esbuild (bundling), Vitest (unit tests).

Spec: `docs/superpowers/specs/2026-06-15-claude-task-tracker-design.md`

---

## File Structure

```
package.json              # manifest, contributes (view + status bar), scripts, deps
tsconfig.json             # TS config
esbuild.js                # bundles src/extension.ts -> dist/extension.js and src/hook/cli.ts -> dist/hook.js
vitest.config.ts          # test config
.vscodeignore             # packaging ignore
src/
  types.ts                # Event union + State types (schema)         [pure]
  reducer.ts              # reduce(events[]) -> State                   [pure]
  eventLog.ts             # parseLines / readEvents / appendEvent       [node fs]
  paths.ts                # ~/.claude/tracker/events.jsonl resolution   [node]
  store.ts                # watch file -> reduce -> emit change         [node, no vscode]
  treeModel.ts            # buildTree(state) -> TreeNode[]              [pure]
  statusBarText.ts        # summarize(state) -> string                 [pure]
  treeProvider.ts         # vscode TreeDataProvider wrapper            [vscode]
  statusBar.ts            # vscode StatusBarItem wrapper               [vscode]
  extension.ts            # activate(): wire store + providers         [vscode]
  hook/
    core.ts               # buildEvents(payload) / planParse           [pure]
    cli.ts                # stdin -> buildEvents -> appendEvent        [node entry]
scripts/
  install-hooks.js        # merge hook config into ~/.claude/settings.json
test/
  reducer.test.ts
  eventLog.test.ts
  hookCore.test.ts
  treeModel.test.ts
  statusBarText.test.ts
  store.test.ts
```

**Pure / unit-tested:** `types`, `reducer`, `eventLog`, `paths`, `store`, `treeModel`, `statusBarText`, `hook/core`.
**vscode-coupled (manual smoke test only):** `treeProvider`, `statusBar`, `extension`.

---

## Task 0: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.js`
- Create: `vitest.config.ts`
- Create: `.vscodeignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-task-tracker",
  "displayName": "Claude Task Tracker",
  "description": "Visualize Claude Code task progress and subagent convergence.",
  "version": "0.0.1",
  "publisher": "local",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "claudeTaskTracker", "title": "Tracker", "icon": "$(checklist)" }
      ]
    },
    "views": {
      "claudeTaskTracker": [
        { "id": "claudeTaskTracker.view", "name": "Tasks & Subagents" }
      ]
    },
    "commands": [
      { "command": "claudeTaskTracker.refresh", "title": "Tracker: Refresh" },
      { "command": "claudeTaskTracker.focus", "title": "Tracker: Focus" }
    ]
  },
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2021"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `esbuild.js`**

```js
const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

async function run() {
  const ext = await esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    format: 'cjs',
    external: ['vscode'],
  });
  const hook = await esbuild.context({
    ...common,
    entryPoints: ['src/hook/cli.ts'],
    outfile: 'dist/hook.js',
    format: 'cjs',
  });
  if (watch) {
    await ext.watch();
    await hook.watch();
  } else {
    await ext.rebuild();
    await hook.rebuild();
    await ext.dispose();
    await hook.dispose();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create `.vscodeignore`**

```
.superpowers/
docs/
src/
test/
node_modules/
esbuild.js
tsconfig.json
vitest.config.ts
**/*.map
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes with no errors; `node_modules/` created.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json esbuild.js vitest.config.ts .vscodeignore package-lock.json
git commit -m "chore: scaffold VSCode extension project"
```

---

## Task 1: Types + reducer (pure core)

**Files:**
- Create: `src/types.ts`
- Create: `src/reducer.ts`
- Test: `test/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reduce } from '../src/reducer';
import { TrackerEvent } from '../src/types';

describe('reduce', () => {
  it('tracks live todos as the task list and labels feature from cwd', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/home/u/repo' },
      { t: 'todo_update', ts: 2, session: 's1', todos: [
        { text: 'DB schema', status: 'completed' },
        { text: 'Login UI', status: 'in_progress' },
      ] },
    ];
    const state = reduce(events);
    expect(state.features).toHaveLength(1);
    const f = state.features[0];
    expect(f.label).toBe('repo');
    expect(f.liveTodos.map((t) => t.status)).toEqual(['completed', 'in_progress']);
    expect(f.status).toBe('active');
  });

  it('marks oldest running subagent converged on stop (FIFO) when no id given', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1' },
      { t: 'subagent_start', ts: 2, session: 's1', agent: 'a1', kind: 'frontend-developer', desc: 'UI' },
      { t: 'subagent_start', ts: 3, session: 's1', agent: 'a2', kind: 'code-reviewer', desc: 'review' },
      { t: 'subagent_stop', ts: 4, session: 's1' },
    ];
    const f = reduce(events).features[0];
    expect(f.subagents.find((s) => s.id === 'a1')!.status).toBe('converged');
    expect(f.subagents.find((s) => s.id === 'a2')!.status).toBe('running');
  });

  it('prefers explicit agent id on stop when provided', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1' },
      { t: 'subagent_start', ts: 2, session: 's1', agent: 'a1', kind: 'k', desc: '' },
      { t: 'subagent_start', ts: 3, session: 's1', agent: 'a2', kind: 'k', desc: '' },
      { t: 'subagent_stop', ts: 4, session: 's1', agent: 'a2' },
    ];
    const f = reduce(events).features[0];
    expect(f.subagents.find((s) => s.id === 'a2')!.status).toBe('converged');
    expect(f.subagents.find((s) => s.id === 'a1')!.status).toBe('running');
  });

  it('keeps a separate feature per session in insertion order', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/a/one' },
      { t: 'session_start', ts: 2, session: 's2', cwd: '/a/two' },
      { t: 'todo_update', ts: 3, session: 's2', todos: [{ text: 'x', status: 'pending' }] },
    ];
    const state = reduce(events);
    expect(state.features.map((f) => f.label)).toEqual(['one', 'two']);
  });

  it('uses plan title + skeleton; skeleton present before any todos', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/a/repo' },
      { t: 'plan_detected', ts: 2, session: 's1', plan: '/a/repo/docs/superpowers/plans/p.md',
        title: 'Auth Implementation Plan',
        tasks: [{ id: 'T1', text: 'DB schema' }, { id: 'T2', text: 'API routes' }] },
    ];
    const f = reduce(events).features[0];
    expect(f.label).toBe('Auth Implementation Plan');
    expect(f.skeleton).toHaveLength(2);
    expect(f.liveTodos).toHaveLength(0);
  });

  it('derives done when stopped, all todos completed, none running', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1' },
      { t: 'todo_update', ts: 2, session: 's1', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_stop', ts: 3, session: 's1' },
    ];
    expect(reduce(events).features[0].status).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/reducer.test.ts`
Expected: FAIL — cannot find module `../src/reducer` / `../src/types`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  text: string;
  status: TodoStatus;
}

export interface SkeletonTask {
  id: string;
  text: string;
}

export type SubagentStatus = 'running' | 'converged';

export interface Subagent {
  id: string;
  kind: string;
  desc: string;
  status: SubagentStatus;
}

export type FeatureStatus = 'active' | 'idle' | 'done';

export interface Feature {
  session: string;
  label: string;
  planPath: string | null;
  skeleton: SkeletonTask[];
  liveTodos: Todo[];
  subagents: Subagent[];
  stopped: boolean;
  lastTs: number;
  status: FeatureStatus;
}

export interface State {
  features: Feature[];
}

export interface SessionStartEvent { t: 'session_start'; ts: number; session: string; cwd?: string; label?: string; }
export interface PlanDetectedEvent { t: 'plan_detected'; ts: number; session: string; plan: string; title?: string; tasks: SkeletonTask[]; }
export interface TodoUpdateEvent { t: 'todo_update'; ts: number; session: string; todos: Todo[]; }
export interface SubagentStartEvent { t: 'subagent_start'; ts: number; session: string; agent: string; kind: string; desc: string; taskId?: string; }
export interface SubagentStopEvent { t: 'subagent_stop'; ts: number; session: string; agent?: string; }
export interface SessionStopEvent { t: 'session_stop'; ts: number; session: string; }

export type TrackerEvent =
  | SessionStartEvent
  | PlanDetectedEvent
  | TodoUpdateEvent
  | SubagentStartEvent
  | SubagentStopEvent
  | SessionStopEvent;
```

- [ ] **Step 4: Write `src/reducer.ts`**

```ts
import { Feature, State, TrackerEvent } from './types';

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function newFeature(session: string): Feature {
  return {
    session,
    label: session,
    planPath: null,
    skeleton: [],
    liveTodos: [],
    subagents: [],
    stopped: false,
    lastTs: 0,
    status: 'idle',
  };
}

function deriveStatus(f: Feature): Feature['status'] {
  const running = f.subagents.some((s) => s.status === 'running');
  const inProgress = f.liveTodos.some((t) => t.status === 'in_progress');
  const allDone = f.liveTodos.length > 0 && f.liveTodos.every((t) => t.status === 'completed');
  if (f.stopped && !running && (allDone || f.liveTodos.length === 0)) {
    return 'done';
  }
  if (running || inProgress) {
    return 'active';
  }
  return 'idle';
}

export function reduce(events: TrackerEvent[]): State {
  const map = new Map<string, Feature>();
  const ensure = (session: string): Feature => {
    let f = map.get(session);
    if (!f) {
      f = newFeature(session);
      map.set(session, f);
    }
    return f;
  };

  for (const e of events) {
    const f = ensure(e.session);
    f.lastTs = Math.max(f.lastTs, e.ts);
    switch (e.t) {
      case 'session_start':
        if (e.label) {
          f.label = e.label;
        } else if (e.cwd) {
          f.label = basename(e.cwd);
        }
        break;
      case 'plan_detected':
        f.planPath = e.plan;
        f.skeleton = e.tasks;
        if (e.title) {
          f.label = e.title;
        }
        break;
      case 'todo_update':
        f.liveTodos = e.todos;
        break;
      case 'subagent_start':
        f.subagents.push({ id: e.agent, kind: e.kind, desc: e.desc, status: 'running' });
        break;
      case 'subagent_stop': {
        let target = e.agent
          ? f.subagents.find((s) => s.id === e.agent && s.status === 'running')
          : undefined;
        if (!target) {
          target = f.subagents.find((s) => s.status === 'running');
        }
        if (target) {
          target.status = 'converged';
        }
        break;
      }
      case 'session_stop':
        f.stopped = true;
        break;
    }
    f.status = deriveStatus(f);
  }

  return { features: [...map.values()] };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/reducer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/reducer.ts test/reducer.test.ts
git commit -m "feat: add event schema and pure state reducer"
```

---

## Task 2: Event log + paths

**Files:**
- Create: `src/eventLog.ts`
- Create: `src/paths.ts`
- Test: `test/eventLog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/eventLog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { parseLines, appendEvent, readEvents } from '../src/eventLog';
import { TrackerEvent } from '../src/types';

describe('parseLines', () => {
  it('skips malformed and non-event lines', () => {
    const text = [
      JSON.stringify({ t: 'session_start', ts: 1, session: 's1' }),
      'not json',
      JSON.stringify({ foo: 'bar' }),
      '',
      JSON.stringify({ t: 'session_stop', ts: 2, session: 's1' }),
    ].join('\n');
    const events = parseLines(text);
    expect(events.map((e) => e.t)).toEqual(['session_start', 'session_stop']);
  });
});

describe('appendEvent + readEvents', () => {
  it('round-trips events through a nested path, creating dirs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-'));
    const logPath = path.join(dir, 'nested', 'events.jsonl');
    const e1: TrackerEvent = { t: 'session_start', ts: 1, session: 's1' };
    const e2: TrackerEvent = { t: 'session_stop', ts: 2, session: 's1' };
    appendEvent(logPath, e1);
    appendEvent(logPath, e2);
    expect(readEvents(logPath)).toEqual([e1, e2]);
  });

  it('returns empty array when file missing', () => {
    const missing = path.join(os.tmpdir(), 'nope-' + process.pid, 'x.jsonl');
    expect(readEvents(missing)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/eventLog.test.ts`
Expected: FAIL — cannot find module `../src/eventLog`.

- [ ] **Step 3: Write `src/eventLog.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { TrackerEvent } from './types';

export function parseLines(text: string): TrackerEvent[] {
  const out: TrackerEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.t === 'string' && typeof obj.session === 'string') {
        out.push(obj as TrackerEvent);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export function readEvents(logPath: string): TrackerEvent[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return parseLines(fs.readFileSync(logPath, 'utf8'));
}

export function appendEvent(logPath: string, event: TrackerEvent): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
}
```

- [ ] **Step 4: Write `src/paths.ts`**

```ts
import * as os from 'os';
import * as path from 'path';

export function trackerDir(): string {
  return path.join(os.homedir(), '.claude', 'tracker');
}

export function eventLogPath(): string {
  return path.join(trackerDir(), 'events.jsonl');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/eventLog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/eventLog.ts src/paths.ts test/eventLog.test.ts
git commit -m "feat: add append-only event log read/write and path resolution"
```

---

## Task 3: Hook core (payload → events)

**Files:**
- Create: `src/hook/core.ts`
- Test: `test/hookCore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/hookCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEvents, planParse, HookPayload, PlanInfo } from '../src/hook/core';

const noPlan = () => null;

describe('buildEvents', () => {
  it('SessionStart emits session_start, plus plan_detected when a plan is found', () => {
    const plan: PlanInfo = { plan: '/r/p.md', title: 'T', tasks: [{ id: 'T1', text: 'a' }] };
    const payload: HookPayload = { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/r' };
    const events = buildEvents(payload, 10, () => plan);
    expect(events.map((e) => e.t)).toEqual(['session_start', 'plan_detected']);
  });

  it('TodoWrite PostToolUse maps content -> text', () => {
    const payload: HookPayload = {
      hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'TodoWrite',
      tool_input: { todos: [{ content: 'Do X', status: 'in_progress', activeForm: 'Doing X' }] },
    };
    expect(buildEvents(payload, 10, noPlan)).toEqual([
      { t: 'todo_update', ts: 10, session: 's1', todos: [{ text: 'Do X', status: 'in_progress' }] },
    ]);
  });

  it('Task PreToolUse emits subagent_start using tool_use_id', () => {
    const payload: HookPayload = {
      hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Task', tool_use_id: 'tu1',
      tool_input: { subagent_type: 'code-reviewer', description: 'review diff' },
    };
    expect(buildEvents(payload, 10, noPlan)).toEqual([
      { t: 'subagent_start', ts: 10, session: 's1', agent: 'tu1', kind: 'code-reviewer', desc: 'review diff' },
    ]);
  });

  it('SubagentStop and Stop map to convergence / session end', () => {
    expect(buildEvents({ hook_event_name: 'SubagentStop', session_id: 's1' }, 5, noPlan))
      .toEqual([{ t: 'subagent_stop', ts: 5, session: 's1' }]);
    expect(buildEvents({ hook_event_name: 'Stop', session_id: 's1' }, 6, noPlan))
      .toEqual([{ t: 'session_stop', ts: 6, session: 's1' }]);
  });

  it('ignores unrelated tools and payloads without a session', () => {
    expect(buildEvents({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read' }, 1, noPlan)).toEqual([]);
    expect(buildEvents({ hook_event_name: 'Stop' }, 1, noPlan)).toEqual([]);
  });
});

describe('planParse', () => {
  it('extracts the H1 title and "### Task N:" headings', () => {
    const md = [
      '# Auth Implementation Plan',
      'intro paragraph',
      '### Task 1: DB schema',
      'details',
      '### Task 2: API routes',
    ].join('\n');
    expect(planParse(md)).toEqual({
      title: 'Auth Implementation Plan',
      tasks: [{ id: 'T1', text: 'DB schema' }, { id: 'T2', text: 'API routes' }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hookCore.test.ts`
Expected: FAIL — cannot find module `../src/hook/core`.

- [ ] **Step 3: Write `src/hook/core.ts`**

```ts
import { SkeletonTask, TodoStatus, TrackerEvent } from '../types';

export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: any;
  source?: string;
}

export interface PlanInfo {
  plan: string;
  title?: string;
  tasks: SkeletonTask[];
}

export type PlanLookup = (cwd: string) => PlanInfo | null;

export function planParse(text: string): { title?: string; tasks: SkeletonTask[] } {
  let title: string | undefined;
  const tasks: SkeletonTask[] = [];
  for (const line of text.split('\n')) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1 && !title) {
      title = h1[1];
    }
    const task = line.match(/^###\s+Task\s+(\d+):\s*(.+?)\s*$/);
    if (task) {
      tasks.push({ id: `T${task[1]}`, text: task[2] });
    }
  }
  return { title, tasks };
}

export function buildEvents(payload: HookPayload, now: number, planLookup: PlanLookup): TrackerEvent[] {
  const session = payload.session_id;
  if (!session) {
    return [];
  }

  switch (payload.hook_event_name) {
    case 'SessionStart': {
      const events: TrackerEvent[] = [
        { t: 'session_start', ts: now, session, cwd: payload.cwd },
      ];
      const plan = payload.cwd ? planLookup(payload.cwd) : null;
      if (plan) {
        events.push({ t: 'plan_detected', ts: now, session, plan: plan.plan, title: plan.title, tasks: plan.tasks });
      }
      return events;
    }
    case 'PostToolUse':
      if (payload.tool_name === 'TodoWrite' && Array.isArray(payload.tool_input?.todos)) {
        const todos = payload.tool_input.todos.map((td: any) => ({
          text: String(td.content ?? td.text ?? ''),
          status: (td.status ?? 'pending') as TodoStatus,
        }));
        return [{ t: 'todo_update', ts: now, session, todos }];
      }
      return [];
    case 'PreToolUse':
      if (payload.tool_name === 'Task') {
        return [{
          t: 'subagent_start',
          ts: now,
          session,
          agent: payload.tool_use_id ?? `${session}-${now}`,
          kind: String(payload.tool_input?.subagent_type ?? 'subagent'),
          desc: String(payload.tool_input?.description ?? ''),
        }];
      }
      return [];
    case 'SubagentStop':
      return [{ t: 'subagent_stop', ts: now, session }];
    case 'Stop':
      return [{ t: 'session_stop', ts: now, session }];
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hookCore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hook/core.ts test/hookCore.test.ts
git commit -m "feat: map Claude Code hook payloads to tracker events"
```

---

## Task 4: Hook CLI entry

**Files:**
- Create: `src/hook/cli.ts`

This is the executable invoked by Claude Code hooks: read JSON from stdin, build events, append them. The pure logic was tested in Task 3; this file is the thin IO shell, verified by build (Task 8) and the smoke test (Task 9).

- [ ] **Step 1: Write `src/hook/cli.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { appendEvent } from '../eventLog';
import { eventLogPath } from '../paths';
import { buildEvents, HookPayload, PlanInfo, planParse } from './core';

function findNewestPlan(cwd: string): PlanInfo | null {
  const dir = path.join(cwd, 'docs', 'superpowers', 'plans');
  if (!fs.existsSync(dir)) {
    return null;
  }
  const mds = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  let newest: { file: string; mtime: number } | null = null;
  for (const f of mds) {
    const full = path.join(dir, f);
    const mtime = fs.statSync(full).mtimeMs;
    if (!newest || mtime > newest.mtime) {
      newest = { file: full, mtime };
    }
  }
  if (!newest) {
    return null;
  }
  const parsed = planParse(fs.readFileSync(newest.file, 'utf8'));
  return { plan: newest.file, title: parsed.title, tasks: parsed.tasks };
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(): void {
  const raw = readStdin();
  let payload: HookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  const events = buildEvents(payload, Date.now(), findNewestPlan);
  const logPath = eventLogPath();
  for (const e of events) {
    appendEvent(logPath, e);
  }
}

main();
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors across `src/` and `test/`.

- [ ] **Step 3: Commit**

```bash
git add src/hook/cli.ts
git commit -m "feat: add hook CLI entry that appends events from stdin"
```

---

## Task 5: Store (watch → reduce → emit)

**Files:**
- Create: `src/store.ts`
- Test: `test/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { TrackerStore } from '../src/store';
import { appendEvent } from '../src/eventLog';
import { TrackerEvent } from '../src/types';

describe('TrackerStore.recompute', () => {
  it('reads the log file, reduces to state, and fires onChange', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
    const logPath = path.join(dir, 'events.jsonl');
    const ev: TrackerEvent = { t: 'session_start', ts: 1, session: 's1', cwd: '/r/demo' };
    appendEvent(logPath, ev);

    const store = new TrackerStore(logPath);
    let fired = false;
    store.onChange(() => { fired = true; });
    store.recompute();

    expect(store.state.features[0].label).toBe('demo');
    expect(fired).toBe(true);
    store.dispose();
  });

  it('starts empty when the log does not exist yet', () => {
    const logPath = path.join(os.tmpdir(), 'store-missing-' + process.pid, 'events.jsonl');
    const store = new TrackerStore(logPath);
    expect(store.state.features).toEqual([]);
    store.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — cannot find module `../src/store`.

- [ ] **Step 3: Write `src/store.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { readEvents } from './eventLog';
import { reduce } from './reducer';
import { State } from './types';

export class TrackerStore {
  private emitter = new EventEmitter();
  private watcher: fs.FSWatcher | null = null;
  state: State = { features: [] };

  constructor(private logPath: string) {}

  recompute(): void {
    this.state = reduce(readEvents(this.logPath));
    this.emitter.emit('change', this.state);
  }

  start(): void {
    const dir = path.dirname(this.logPath);
    fs.mkdirSync(dir, { recursive: true });
    this.recompute();
    this.watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || filename === path.basename(this.logPath)) {
        this.recompute();
      }
    });
  }

  onChange(cb: (state: State) => void): void {
    this.emitter.on('change', cb);
  }

  dispose(): void {
    this.watcher?.close();
    this.emitter.removeAllListeners();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/store.test.ts
git commit -m "feat: add store that watches the log and reduces to state"
```

---

## Task 6: Tree model (pure)

**Files:**
- Create: `src/treeModel.ts`
- Test: `test/treeModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/treeModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/treeModel';
import { reduce } from '../src/reducer';
import { TrackerEvent } from '../src/types';

describe('buildTree', () => {
  it('builds feature -> live-task + subagent nodes with progress', () => {
    const state = reduce([
      { t: 'session_start', ts: 1, session: 's1', cwd: '/r/auth' },
      { t: 'todo_update', ts: 2, session: 's1', todos: [
        { text: 'DB', status: 'completed' },
        { text: 'UI', status: 'in_progress' },
      ] },
      { t: 'subagent_start', ts: 3, session: 's1', agent: 'a1', kind: 'frontend-developer', desc: 'UI' },
    ] as TrackerEvent[]);

    const tree = buildTree(state);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('feature');
    expect(tree[0].description).toBe('1/2');
    expect(tree[0].children!.map((c) => c.kind)).toEqual(['task', 'task', 'subagent']);
    expect(tree[0].children![2].icon).toBe('sync~spin');
  });

  it('falls back to skeleton (planned) when there are no todos yet', () => {
    const state = reduce([
      { t: 'session_start', ts: 1, session: 's1', cwd: '/r/auth' },
      { t: 'plan_detected', ts: 2, session: 's1', plan: '/r/auth/p.md', title: 'Auth',
        tasks: [{ id: 'T1', text: 'DB' }] },
    ] as TrackerEvent[]);

    const tree = buildTree(state);
    expect(tree[0].description).toBe('0/1');
    expect(tree[0].children![0].description).toBe('planned');
    expect(tree[0].resourcePath).toBe('/r/auth/p.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/treeModel.test.ts`
Expected: FAIL — cannot find module `../src/treeModel`.

- [ ] **Step 3: Write `src/treeModel.ts`**

```ts
import { Feature, State, TodoStatus } from './types';

export interface TreeNode {
  kind: 'feature' | 'task' | 'subagent';
  label: string;
  description?: string;
  icon: string;
  children?: TreeNode[];
  resourcePath?: string;
}

function featureIcon(f: Feature): string {
  if (f.status === 'done') {
    return 'pass-filled';
  }
  if (f.status === 'active') {
    return 'sync~spin';
  }
  return 'circle-outline';
}

function todoIcon(status: TodoStatus): string {
  if (status === 'completed') {
    return 'check';
  }
  if (status === 'in_progress') {
    return 'sync~spin';
  }
  return 'circle-outline';
}

export function buildTree(state: State): TreeNode[] {
  return state.features.map((f) => {
    const useTodos = f.liveTodos.length > 0;

    const taskNodes: TreeNode[] = useTodos
      ? f.liveTodos.map((td) => ({ kind: 'task', label: td.text, icon: todoIcon(td.status) }))
      : f.skeleton.map((sk) => ({ kind: 'task', label: sk.text, description: 'planned', icon: 'circle-outline' }));

    const subagentNodes: TreeNode[] = f.subagents.map((s) => ({
      kind: 'subagent',
      label: s.kind,
      description: s.desc,
      icon: s.status === 'converged' ? 'check' : 'sync~spin',
    }));

    const total = useTodos ? f.liveTodos.length : f.skeleton.length;
    const done = f.liveTodos.filter((t) => t.status === 'completed').length;

    return {
      kind: 'feature',
      label: f.label,
      description: `${done}/${total}`,
      icon: featureIcon(f),
      resourcePath: f.planPath ?? undefined,
      children: [...taskNodes, ...subagentNodes],
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/treeModel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/treeModel.ts test/treeModel.test.ts
git commit -m "feat: add pure tree model (feature/task/subagent nodes)"
```

---

## Task 7: Status bar text (pure)

**Files:**
- Create: `src/statusBarText.ts`
- Test: `test/statusBarText.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/statusBarText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarize } from '../src/statusBarText';
import { reduce } from '../src/reducer';
import { TrackerEvent } from '../src/types';

describe('summarize', () => {
  it('is empty when there is no active feature', () => {
    expect(summarize(reduce([]))).toBe('');
  });

  it('shows the most recently active feature with progress and running count', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/r/auth' },
      { t: 'todo_update', ts: 2, session: 's1', todos: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'in_progress' },
      ] },
      { t: 'subagent_start', ts: 3, session: 's1', agent: 'x', kind: 'k', desc: '' },
    ];
    const text = summarize(reduce(events));
    expect(text).toContain('auth 1/2');
    expect(text).toContain('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/statusBarText.test.ts`
Expected: FAIL — cannot find module `../src/statusBarText`.

- [ ] **Step 3: Write `src/statusBarText.ts`**

```ts
import { State } from './types';

export function summarize(state: State): string {
  const active = state.features.filter((f) => f.status === 'active');
  if (active.length === 0) {
    return '';
  }
  active.sort((a, b) => b.lastTs - a.lastTs);
  const f = active[0];
  const total = f.liveTodos.length > 0 ? f.liveTodos.length : f.skeleton.length;
  const done = f.liveTodos.filter((t) => t.status === 'completed').length;
  const running = f.subagents.filter((s) => s.status === 'running').length;
  const more = active.length > 1 ? ` +${active.length - 1}` : '';
  return `$(rocket) ${f.label} ${done}/${total} · $(sync~spin)${running}${more}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/statusBarText.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/statusBarText.ts test/statusBarText.test.ts
git commit -m "feat: add pure status-bar summary text"
```

---

## Task 8: VSCode wrappers + build

**Files:**
- Create: `src/treeProvider.ts`
- Create: `src/statusBar.ts`
- Create: `src/extension.ts`

These import `vscode` and are verified by a successful bundle + the smoke test in Task 9 (not unit-tested).

- [ ] **Step 1: Write `src/treeProvider.ts`**

```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { buildTree, TreeNode } from './treeModel';

export class TrackerTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private store: TrackerStore) {
    store.onChange(() => this.changeEmitter.fire());
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsible = node.children && node.children.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon(node.icon);
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
      return buildTree(this.store.state);
    }
    return node.children ?? [];
  }
}
```

- [ ] **Step 2: Write `src/statusBar.ts`**

```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { summarize } from './statusBarText';

export function createStatusBar(store: TrackerStore): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'claudeTaskTracker.focus';
  const render = () => {
    const text = summarize(store.state);
    if (text) {
      item.text = text;
      item.tooltip = 'Claude Task Tracker — click to focus';
      item.show();
    } else {
      item.hide();
    }
  };
  store.onChange(render);
  render();
  return item;
}
```

- [ ] **Step 3: Write `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { eventLogPath } from './paths';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TrackerStore(eventLogPath());
  const tree = new TrackerTreeProvider(store);

  const view = vscode.window.createTreeView('claudeTaskTracker.view', {
    treeDataProvider: tree,
  });
  const statusBar = createStatusBar(store);

  context.subscriptions.push(
    view,
    statusBar,
    vscode.commands.registerCommand('claudeTaskTracker.focus', () => {
      vscode.commands.executeCommand('claudeTaskTracker.view.focus');
    }),
    vscode.commands.registerCommand('claudeTaskTracker.refresh', () => store.recompute()),
    { dispose: () => store.dispose() },
  );

  store.start();
}

export function deactivate(): void {}
```

- [ ] **Step 4: Build both bundles**

Run: `npm run build`
Expected: PASS — creates `dist/extension.js` and `dist/hook.js` with no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (reducer, eventLog, hookCore, store, treeModel, statusBarText).

- [ ] **Step 6: Commit**

```bash
git add src/treeProvider.ts src/statusBar.ts src/extension.ts
git commit -m "feat: wire tree view, status bar, and extension activation"
```

---

## Task 9: Hook installer, docs, and smoke test

**Files:**
- Create: `scripts/install-hooks.js`
- Create: `README.md`

- [ ] **Step 1: Write `scripts/install-hooks.js`**

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

const distHook = path.resolve(__dirname, '..', 'dist', 'hook.js');
if (!fs.existsSync(distHook)) {
  console.error('dist/hook.js not found. Run "npm run build" first.');
  process.exit(1);
}
const command = `node "${distHook}"`;

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error('Could not parse', settingsPath, '- aborting to avoid clobbering it.');
    process.exit(1);
  }
}
settings.hooks = settings.hooks || {};

function ensure(eventName, matcher) {
  const arr = (settings.hooks[eventName] = settings.hooks[eventName] || []);
  const alreadyInstalled = JSON.stringify(arr).includes(distHook.replace(/\\/g, '\\\\'));
  if (alreadyInstalled) {
    return;
  }
  const entry = { hooks: [{ type: 'command', command }] };
  if (matcher) {
    entry.matcher = matcher;
  }
  arr.push(entry);
}

ensure('SessionStart');
ensure('PostToolUse', 'TodoWrite');
ensure('PreToolUse', 'Task');
ensure('SubagentStop');
ensure('Stop');

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Installed Claude Task Tracker hooks into', settingsPath);
```

- [ ] **Step 2: Add the installer script to `package.json`**

Modify `package.json` `scripts` block to add `install-hooks`:

```json
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "test": "vitest run",
    "install-hooks": "node scripts/install-hooks.js"
  },
```

- [ ] **Step 3: Write `README.md`**

````markdown
# Claude Task Tracker

A VSCode extension that visualizes Claude Code task progress and subagent
convergence across the superpowers brainstorm → spec → plan → execute flow.

## How it works

Claude Code hooks append JSON events to `~/.claude/tracker/events.jsonl`.
The extension watches that file, reduces the events into state, and shows:

- a sidebar TreeView: **Feature → Task → Subagent**, with live status icons;
- a bottom status-bar summary of the most recently active feature.

## Install & run (development)

```bash
npm install
npm run build
npm run install-hooks   # adds hook entries to ~/.claude/settings.json
```

Then press `F5` in VSCode to launch the Extension Development Host.

Hooks captured: `SessionStart`, `PostToolUse`(TodoWrite), `PreToolUse`(Task),
`SubagentStop`, `Stop`.

## Status semantics

- **Task** progress comes from Claude Code's live TodoWrite list; before any
  todos exist, the plan's `### Task N:` headings are shown as "planned".
- A **subagent** is `running` until a `SubagentStop` event converges it.
  Convergence is attributed FIFO within a session (the MVP approximation; see
  the design doc).
````

- [ ] **Step 4: Manual smoke test**

1. Run: `npm install && npm run build && npm run install-hooks`
2. Press `F5` in VSCode to open the Extension Development Host.
3. In a workspace with `docs/superpowers/plans/`, run a Claude Code session that uses TodoWrite and dispatches at least one subagent.
4. Verify in the dev-host window:
   - the **Tracker** activity-bar view lists the feature with `done/total` progress;
   - tasks show ✓ / spinner / ○ icons matching the TodoWrite statuses;
   - a subagent appears with a spinner, then a ✓ after it finishes;
   - the bottom status bar shows `🚀 <feature> n/m · ⟳k` while active.
5. Confirm `~/.claude/tracker/events.jsonl` is being appended to.

Expected: tree and status bar update live as the session progresses.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-hooks.js README.md package.json
git commit -m "feat: add hook installer, README, and smoke-test instructions"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3 architecture (global jsonl, one-way flow, append-only) → Tasks 2, 4, 5.
- §4 components (hooks, schema, reducer, watcher/store, tree, status bar) → Tasks 1–8.
- §5 data model (events + reduced state, FIFO convergence fallback per §7) → Tasks 1, 3.
- §6 UI (tree feature/task/subagent; live-todos-else-skeleton rule; status-bar summary; open plan) → Tasks 6, 7, 8.
- §7 error handling (skip malformed lines; mid-run rebuild; subagent-id fallback) → Tasks 2 (parseLines), 5 (recompute from scratch), 1/3 (FIFO).
- §9 MVP scope (5 hooks, global jsonl, reducer, tree, status bar, binary subagent, multi-feature) → all tasks. Deferred items (taskId mapping, multi-stage, batch convergence, history, rotation, webview) intentionally excluded.

**Placeholder scan:** none — every code/test step contains complete content; no "TBD"/"handle edge cases"/"similar to Task N".

**Type consistency:** `TrackerEvent`/`Feature`/`State` defined in Task 1 are imported unchanged by every later task; `buildEvents`, `reduce`, `buildTree`, `summarize`, `appendEvent`, `readEvents`, `eventLogPath`, `TrackerStore` names are used consistently across tasks and tests; codicon ids (`sync~spin`, `check`, `circle-outline`, `pass-filled`) match between `treeModel` and its test.
