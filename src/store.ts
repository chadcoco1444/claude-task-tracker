import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { readEvents, writeEvents } from './eventLog';
import { compactEvents } from './logRetention';
import { reduce } from './reducer';
import { State } from './types';

export class TrackerStore {
  private emitter = new EventEmitter();
  private watcher: fs.FSWatcher | null = null;
  state: State = { features: [] };

  constructor(private logPath: string, private retentionDays: () => number = () => 0) {}

  recompute(): void {
    this.state = reduce(readEvents(this.logPath));
    this.emitter.emit('change', this.state);
  }

  // Bound the shared, append-only log once at startup. Concurrency note: a hook
  // append from another window during the rename could be lost (rare; worst case
  // one dropped event). Acceptable for a local dev tool (see v2.5 spec, O2).
  private compact(): void {
    const days = this.retentionDays();
    if (days <= 0 || !fs.existsSync(this.logPath)) {
      return;
    }
    const events = readEvents(this.logPath);
    const kept = compactEvents(events, Date.now(), days);
    if (kept.length < events.length) {
      writeEvents(this.logPath, kept);
    }
  }

  start(): void {
    const dir = path.dirname(this.logPath);
    fs.mkdirSync(dir, { recursive: true });
    this.compact();
    this.recompute();
    this.watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || filename === path.basename(this.logPath)) {
        this.recompute();
      }
    });
  }

  onChange(cb: (state: State) => void): void {
    this.emitter.on('change', cb);
  }

  dispose(): void {
    this.watcher?.close();
    this.emitter.removeAllListeners();
  }
}
