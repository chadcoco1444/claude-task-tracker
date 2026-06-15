import { describe, it, expect } from 'vitest';
import { relativeTime, groupOf } from '../src/viewModel';

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
