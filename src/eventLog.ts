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

export function writeEvents(logPath: string, events: TrackerEvent[]): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join('\n');
  const tmp = `${logPath}.tmp`;
  fs.writeFileSync(tmp, events.length ? body + '\n' : '');
  fs.renameSync(tmp, logPath);
}
