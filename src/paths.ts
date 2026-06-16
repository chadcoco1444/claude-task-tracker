import * as os from 'os';
import * as path from 'path';

export function claudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function claudeSettingsPath(): string {
  return path.join(claudeDir(), 'settings.json');
}

export function trackerDir(): string {
  return path.join(claudeDir(), 'tracker');
}

export function eventLogPath(): string {
  return path.join(trackerDir(), 'events.jsonl');
}
