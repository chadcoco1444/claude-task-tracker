import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { readEvents } from './eventLog';
import { reduce } from './reducer';
import { State } from './types';

export class TrackerStore {
  private emitter = new EventEmitter();
  private watcher: fs.FSWatcher | null = null;
  state: State = { features: [] };

  constructor(private logPath: string) {}

  recompute(): void {
    this.state = reduce(readEvents(this.logPath));
    this.emitter.emit('change', this.state);
  }

  start(): void {
    const dir = path.dirname(this.logPath);
    fs.mkdirSync(dir, { recursive: true });
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
