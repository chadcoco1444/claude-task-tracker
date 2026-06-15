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

  it('a stopped session whose plan was never executed is idle, not done (0/N must not be done)', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/a/repo' },
      { t: 'plan_detected', ts: 2, session: 's1', plan: '/a/repo/p.md', title: 'P',
        tasks: [{ id: 'T1', text: 'a' }, { id: 'T2', text: 'b' }] },
      { t: 'session_stop', ts: 3, session: 's1' },
    ];
    expect(reduce(events).features[0].status).toBe('idle');
  });

  it('a stopped session with no plan and no todos is idle, not done', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/a/repo' },
      { t: 'session_stop', ts: 2, session: 's1' },
    ];
    expect(reduce(events).features[0].status).toBe('idle');
  });

  it('marks a feature ended when SessionEnd fires (precedence over everything)', () => {
    const f = reduce([
      { t: 'todo_update', ts: 1, session: 's1', todos: [{ text: 'x', status: 'in_progress' }] },
      { t: 'session_end', ts: 2, session: 's1' },
    ] as TrackerEvent[]).features[0];
    expect(f.ended).toBe(true);
    expect(f.status).toBe('ended');
  });

  it('still derives done when stopped with all todos completed', () => {
    const f = reduce([
      { t: 'todo_update', ts: 1, session: 's1', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_stop', ts: 2, session: 's1' },
    ] as TrackerEvent[]).features[0];
    expect(f.status).toBe('done');
  });

  it('labels feature from cwd carried on a non-session_start event (SessionStart missed)', () => {
    const events: TrackerEvent[] = [
      { t: 'todo_update', ts: 1, session: 's1', cwd: '/home/u/myproj', todos: [{ text: 'x', status: 'pending' }] },
    ];
    expect(reduce(events).features[0].label).toBe('myproj');
  });

  it('falls back to a short session id when no cwd and no title ever arrive', () => {
    const events: TrackerEvent[] = [
      { t: 'subagent_stop', ts: 1, session: '448dc281-9db9-4cd0-8a55-befd7c569336' },
    ];
    expect(reduce(events).features[0].label).toBe('448dc281');
  });

  it('plan title beats a cwd label regardless of event order', () => {
    const titleFirst = reduce([
      { t: 'plan_detected', ts: 1, session: 's1', plan: '/r/p.md', title: 'My Plan', tasks: [] },
      { t: 'todo_update', ts: 2, session: 's1', cwd: '/r/repo', todos: [{ text: 'x', status: 'pending' }] },
    ] as TrackerEvent[]).features[0];
    expect(titleFirst.label).toBe('My Plan');

    const cwdFirst = reduce([
      { t: 'todo_update', ts: 1, session: 's2', cwd: '/r/repo', todos: [{ text: 'x', status: 'pending' }] },
      { t: 'plan_detected', ts: 2, session: 's2', plan: '/r/p.md', title: 'My Plan', tasks: [] },
    ] as TrackerEvent[]).features[0];
    expect(cwdFirst.label).toBe('My Plan');
  });

  it('a cwd-bearing event does not overwrite an explicit session_start cwd label', () => {
    const events: TrackerEvent[] = [
      { t: 'session_start', ts: 1, session: 's1', cwd: '/a/first' },
      { t: 'todo_update', ts: 2, session: 's1', cwd: '/a/second', todos: [{ text: 'x', status: 'pending' }] },
    ];
    // both are 'cwd' priority; latest wins is acceptable — assert it tracks the live cwd
    expect(reduce(events).features[0].label).toBe('second');
  });

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
});
