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
