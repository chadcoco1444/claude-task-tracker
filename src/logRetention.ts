import { TrackerEvent } from './types';

export function compactEvents(events: TrackerEvent[], now: number, retentionDays: number): TrackerEvent[] {
  if (retentionDays <= 0) {
    return events;
  }
  const cutoff = now - retentionDays * 86_400_000;
  return events.filter((e) => e.ts >= cutoff);
}
