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
