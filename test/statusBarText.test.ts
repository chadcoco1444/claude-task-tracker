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
