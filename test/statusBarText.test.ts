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
