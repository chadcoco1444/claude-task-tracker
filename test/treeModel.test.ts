import { describe, it, expect } from 'vitest';
import { buildTree, progressBar } from '../src/treeModel';
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
    expect(feature.session).toBe('s1');
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

  it('renders an ended feature with a dim circle-slash icon', () => {
    const state = reduce([
      { t: 'todo_update', ts: 1, session: 's1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'session_end', ts: 2, session: 's1' },
    ] as TrackerEvent[]);
    const feature = find(buildTree(state, opts({ workspaceFolders: ['c:/ws/auth'] })), 'feature')!;
    expect(feature.icon).toBe('circle-slash');
    expect(feature.iconColor).toBe('disabledForeground');
  });
});

describe('progressBar', () => {
  it('fills proportionally, empty when total is 0, and clamps when done exceeds total', () => {
    expect(progressBar(0, 0)).toBe('▱▱▱▱');
    expect(progressBar(1, 2)).toBe('▰▰▱▱');
    expect(progressBar(2, 2)).toBe('▰▰▰▰');
    expect(progressBar(3, 2)).toBe('▰▰▰▰'); // clamped, must not throw
  });
});
