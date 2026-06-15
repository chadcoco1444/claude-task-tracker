import * as fs from 'fs';
import * as path from 'path';
import { TrackerEvent } from './types';

export function parseLines(text: string): TrackerEvent[] {
  const out: TrackerEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.t === 'string' && typeof obj.session === 'string') {
        out.push(obj as TrackerEvent);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export function readEvents(logPath: string): TrackerEvent[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return parseLines(fs.readFileSync(logPath, 'utf8'));
}

export function appendEvent(logPath: string, event: TrackerEvent): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
}
