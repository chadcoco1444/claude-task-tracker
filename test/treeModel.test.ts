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
