import { Feature, LabelSource, State, TrackerEvent } from './types';

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

// Last-resort label when neither a cwd nor a plan title is ever seen for a
// session (e.g. it was already running when the hooks were installed, so its
// SessionStart never fired). The first UUID segment is short yet unique enough.
function shortId(session: string): string {
  return session.split('-')[0] || session;
}

const LABEL_PRIORITY: Record<LabelSource, number> = { default: 0, cwd: 1, title: 2 };

// Apply a label only if its source ranks at least as high as the current one,
// so a plan title is never clobbered by a later folder name, and a real label
// is never clobbered by the short-id fallback. Equal rank lets the latest win
// (e.g. cwd changing as the session moves).
function setLabel(f: Feature, value: string | undefined, source: LabelSource): void {
  if (!value) {
    return;
  }
  if (LABEL_PRIORITY[source] >= LABEL_PRIORITY[f.labelSource]) {
    f.label = value;
    f.labelSource = source;
  }
}

function newFeature(session: string): Feature {
  return {
    session,
    label: shortId(session),
    labelSource: 'default',
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
  // A detected-but-never-executed plan (skeleton present, zero live todos) must
  // NOT count as done — that produced the misleading "0/10 ✓" feature. Only a
  // session with genuinely nothing to track may be done on an empty todo list.
  const nothingPlanned = f.liveTodos.length === 0 && f.skeleton.length === 0;
  if (f.stopped && !running && (allDone || nothingPlanned)) {
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
    // Any event that carries a cwd can label the feature — not just SessionStart,
    // which is the event most likely to be missed for a pre-existing session.
    if ('cwd' in e && e.cwd) {
      setLabel(f, basename(e.cwd), 'cwd');
    }
    switch (e.t) {
      case 'session_start':
        if (e.label) {
          setLabel(f, e.label, 'title');
        }
        break;
      case 'plan_detected':
        f.planPath = e.plan;
        f.skeleton = e.tasks;
        setLabel(f, e.title, 'title');
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
