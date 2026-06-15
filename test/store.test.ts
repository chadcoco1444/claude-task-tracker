import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { TrackerStore } from '../src/store';
import { appendEvent } from '../src/eventLog';
import { TrackerEvent } from '../src/types';

describe('TrackerStore.recompute', () => {
  it('reads the log file, reduces to state, and fires onChange', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
    const logPath = path.join(dir, 'events.jsonl');
    const ev: TrackerEvent = { t: 'session_start', ts: 1, session: 's1', cwd: '/r/demo' };
    appendEvent(logPath, ev);

    const store = new TrackerStore(logPath);
    let fired = false;
    store.onChange(() => { fired = true; });
    store.recompute();

    expect(store.state.features[0].label).toBe('demo');
    expect(fired).toBe(true);
    store.dispose();
  });

  it('starts empty when the log does not exist yet', () => {
    const logPath = path.join(os.tmpdir(), 'store-missing-' + process.pid, 'events.jsonl');
    const store = new TrackerStore(logPath);
    expect(store.state.features).toEqual([]);
    store.dispose();
  });
});
