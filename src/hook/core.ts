import { SkeletonTask, TodoStatus, TrackerEvent } from '../types';

export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: any;
  source?: string;
}

export interface PlanInfo {
  plan: string;
  title?: string;
  tasks: SkeletonTask[];
}

export type PlanLookup = (cwd: string) => PlanInfo | null;

export function planParse(text: string): { title?: string; tasks: SkeletonTask[] } {
  let title: string | undefined;
  const tasks: SkeletonTask[] = [];
  for (const line of text.split('\n')) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1 && !title) {
      title = h1[1];
    }
    const task = line.match(/^###\s+Task\s+(\d+):\s*(.+?)\s*$/);
    if (task) {
      tasks.push({ id: `T${task[1]}`, text: task[2] });
    }
  }
  return { title, tasks };
}

export function buildEvents(payload: HookPayload, now: number, planLookup: PlanLookup): TrackerEvent[] {
  const session = payload.session_id;
  if (!session) {
    return [];
  }

  switch (payload.hook_event_name) {
    case 'SessionStart': {
      const events: TrackerEvent[] = [
        { t: 'session_start', ts: now, session, cwd: payload.cwd },
      ];
      const plan = payload.cwd ? planLookup(payload.cwd) : null;
      if (plan) {
        events.push({ t: 'plan_detected', ts: now, session, plan: plan.plan, title: plan.title, tasks: plan.tasks });
      }
      return events;
    }
    case 'PostToolUse':
      if (payload.tool_name === 'TodoWrite' && Array.isArray(payload.tool_input?.todos)) {
        const todos = payload.tool_input.todos.map((td: any) => ({
          text: String(td.content ?? td.text ?? ''),
          status: (td.status ?? 'pending') as TodoStatus,
        }));
        return [{ t: 'todo_update', ts: now, session, todos }];
      }
      return [];
    case 'PreToolUse':
      if (payload.tool_name === 'Task') {
        return [{
          t: 'subagent_start',
          ts: now,
          session,
          agent: payload.tool_use_id ?? `${session}-${now}`,
          kind: String(payload.tool_input?.subagent_type ?? 'subagent'),
          desc: String(payload.tool_input?.description ?? ''),
        }];
      }
      return [];
    case 'SubagentStop':
      return [{ t: 'subagent_stop', ts: now, session }];
    case 'Stop':
      return [{ t: 'session_stop', ts: now, session }];
    default:
      return [];
  }
}
