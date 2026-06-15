import * as os from 'os';
import * as path from 'path';

export function trackerDir(): string {
  return path.join(os.homedir(), '.claude', 'tracker');
}

export function eventLogPath(): string {
  return path.join(trackerDir(), 'events.jsonl');
}
