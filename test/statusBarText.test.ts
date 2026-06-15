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

  it('prefers a non-ended feature over an ended one', () => {
    const text = summarize(reduce([
      { t: 'todo_update', ts: 1, session: 'e1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'session_end', ts: 2, session: 'e1' },
      { t: 'session_start', ts: 3, session: 'i1', cwd: 'c:/ws/auth' },
      { t: 'plan_detected', ts: 3, session: 'i1', plan: 'c:/ws/auth/p.md', title: 'Idle One', tasks: [{ id: 'T1', text: 'x' }] },
    ] as TrackerEvent[]), { now: 4, workspaceFolders: ['c:/ws/auth'] });
    expect(text).toContain('Idle One');
  });
});
