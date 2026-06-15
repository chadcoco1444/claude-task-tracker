import { describe, it, expect } from 'vitest';
import { compactEvents } from '../src/logRetention';
import { TrackerEvent } from '../src/types';

const DAY = 86_400_000;
const ev = (ts: number, session = 's'): TrackerEvent => ({ t: 'session_stop', ts, session });

describe('compactEvents', () => {
  it('returns events unchanged when retentionDays <= 0', () => {
    const events = [ev(0), ev(1)];
    expect(compactEvents(events, 1_000_000, 0)).toBe(events);
  });

  it('drops events older than the cutoff, keeps recent (boundary kept)', () => {
    const now = 100 * DAY;
    const events = [ev(now - 20 * DAY), ev(now - 14 * DAY), ev(now - 1 * DAY)];
    const kept = compactEvents(events, now, 14);
    expect(kept.map((e) => e.ts)).toEqual([now - 14 * DAY, now - 1 * DAY]);
  });
});
