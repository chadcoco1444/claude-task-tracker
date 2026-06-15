import { describe, it, expect } from 'vitest';
import { relativeTime } from '../src/viewModel';

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
