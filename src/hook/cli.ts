import * as fs from 'fs';
import * as path from 'path';
import { appendEvent } from '../eventLog';
import { eventLogPath } from '../paths';
import { buildEvents, HookPayload, PlanInfo, planParse } from './core';

// Picks the most-recently-modified plan under docs/superpowers/plans. With v2.4
// live plan detection (a plan write re-emits plan_detected), the plan you just
// wrote is newest and wins — so newest-by-mtime is correct in practice
// (see v2.5 spec, Q2).
function findNewestPlan(cwd: string): PlanInfo | null {
  try {
    const dir = path.join(cwd, 'docs', 'superpowers', 'plans');
    if (!fs.existsSync(dir)) {
      return null;
    }
    const mds = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    let newest: { file: string; mtime: number } | null = null;
    for (const f of mds) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (!stat.isFile()) {
        continue;
      }
      if (!newest || stat.mtimeMs > newest.mtime) {
        newest = { file: full, mtime: stat.mtimeMs };
      }
    }
    if (!newest) {
      return null;
    }
    const parsed = planParse(fs.readFileSync(newest.file, 'utf8'));
    return { plan: newest.file, title: parsed.title, tasks: parsed.tasks };
  } catch {
    return null;
  }
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
  try {
    const events = buildEvents(payload, Date.now(), findNewestPlan);
    const logPath = eventLogPath();
    for (const e of events) {
      appendEvent(logPath, e);
    }
  } catch {
    // A hook must never crash the host Claude Code process: swallow IO errors.
  }
}

main();
