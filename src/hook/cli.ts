import * as fs from 'fs';
import * as path from 'path';
import { appendEvent } from '../eventLog';
import { eventLogPath } from '../paths';
import { buildEvents, HookPayload, PlanInfo, planParse } from './core';

function findNewestPlan(cwd: string): PlanInfo | null {
  const dir = path.join(cwd, 'docs', 'superpowers', 'plans');
  if (!fs.existsSync(dir)) {
    return null;
  }
  const mds = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  let newest: { file: string; mtime: number } | null = null;
  for (const f of mds) {
    const full = path.join(dir, f);
    const mtime = fs.statSync(full).mtimeMs;
    if (!newest || mtime > newest.mtime) {
      newest = { file: full, mtime };
    }
  }
  if (!newest) {
    return null;
  }
  const parsed = planParse(fs.readFileSync(newest.file, 'utf8'));
  return { plan: newest.file, title: parsed.title, tasks: parsed.tasks };
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(): void {
  const raw = readStdin();
  let payload: HookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  const events = buildEvents(payload, Date.now(), findNewestPlan);
  const logPath = eventLogPath();
  for (const e of events) {
    appendEvent(logPath, e);
  }
}

main();
