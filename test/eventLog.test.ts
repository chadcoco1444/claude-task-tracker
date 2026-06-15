import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { parseLines, appendEvent, readEvents, writeEvents } from '../src/eventLog';
import { TrackerEvent } from '../src/types';

describe('parseLines', () => {
  it('skips malformed and non-event lines', () => {
    const text = [
      JSON.stringify({ t: 'session_start', ts: 1, session: 's1' }),
      'not json',
      JSON.stringify({ foo: 'bar' }),
      '',
      JSON.stringify({ t: 'session_stop', ts: 2, session: 's1' }),
    ].join('\n');
    const events = parseLines(text);
    expect(events.map((e) => e.t)).toEqual(['session_start', 'session_stop']);
  });
});

describe('appendEvent + readEvents', () => {
  it('round-trips events through a nested path, creating dirs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-'));
    const logPath = path.join(dir, 'nested', 'events.jsonl');
    const e1: TrackerEvent = { t: 'session_start', ts: 1, session: 's1' };
    const e2: TrackerEvent = { t: 'session_stop', ts: 2, session: 's1' };
    appendEvent(logPath, e1);
    appendEvent(logPath, e2);
    expect(readEvents(logPath)).toEqual([e1, e2]);
  });

  it('returns empty array when file missing', () => {
    const missing = path.join(os.tmpdir(), 'nope-' + process.pid, 'x.jsonl');
    expect(readEvents(missing)).toEqual([]);
  });
});

describe('writeEvents', () => {
  it('atomically replaces the log with the given events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-w-'));
    const logPath = path.join(dir, 'events.jsonl');
    fs.writeFileSync(logPath, 'OLD\nLINES\n');
    const e: TrackerEvent = { t: 'session_stop', ts: 5, session: 's1' };
    writeEvents(logPath, [e]);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('{"t":"session_stop","ts":5,"session":"s1"}\n');
  });
});
