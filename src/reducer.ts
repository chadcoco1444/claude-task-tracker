import { Feature, State, TrackerEvent } from './types';

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function newFeature(session: string): Feature {
  return {
    session,
    label: session,
    planPath: null,
    skeleton: [],
    liveTodos: [],
    subagents: [],
    stopped: false,
    lastTs: 0,
    status: 'idle',
  };
}

function deriveStatus(f: Feature): Feature['status'] {
  const running = f.subagents.some((s) => s.status === 'running');
  const inProgress = f.liveTodos.some((t) => t.status === 'in_progress');
  const allDone = f.liveTodos.length > 0 && f.liveTodos.every((t) => t.status === 'completed');
  if (f.stopped && !running && (allDone || f.liveTodos.length === 0)) {
    return 'done';
  }
  if (running || inProgress) {
    return 'active';
  }
  return 'idle';
}

export function reduce(events: TrackerEvent[]): State {
  const map = new Map<string, Feature>();
  const ensure = (session: string): Feature => {
    let f = map.get(session);
    if (!f) {
      f = newFeature(session);
      map.set(session, f);
    }
    return f;
  };

  for (const e of events) {
    const f = ensure(e.session);
    f.lastTs = Math.max(f.lastTs, e.ts);
    switch (e.t) {
      case 'session_start':
        if (e.label) {
          f.label = e.label;
        } else if (e.cwd) {
          f.label = basename(e.cwd);
        }
        break;
      case 'plan_detected':
        f.planPath = e.plan;
        f.skeleton = e.tasks;
        if (e.title) {
          f.label = e.title;
        }
        break;
      case 'todo_update':
        f.liveTodos = e.todos;
        break;
      case 'subagent_start':
        f.subagents.push({ id: e.agent, kind: e.kind, desc: e.desc, status: 'running' });
        break;
      case 'subagent_stop': {
        let target = e.agent
          ? f.subagents.find((s) => s.id === e.agent && s.status === 'running')
          : undefined;
        if (!target) {
          target = f.subagents.find((s) => s.status === 'running');
        }
        if (target) {
          target.status = 'converged';
        }
        break;
      }
      case 'session_stop':
        f.stopped = true;
        break;
    }
    f.status = deriveStatus(f);
  }

  return { features: [...map.values()] };
}
