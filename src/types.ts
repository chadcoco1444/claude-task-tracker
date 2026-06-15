export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  text: string;
  status: TodoStatus;
}

export interface SkeletonTask {
  id: string;
  text: string;
}

export type SubagentStatus = 'running' | 'converged';

export interface Subagent {
  id: string;
  kind: string;
  desc: string;
  status: SubagentStatus;
}

export type FeatureStatus = 'active' | 'idle' | 'done';

export interface Feature {
  session: string;
  label: string;
  planPath: string | null;
  skeleton: SkeletonTask[];
  liveTodos: Todo[];
  subagents: Subagent[];
  stopped: boolean;
  lastTs: number;
  status: FeatureStatus;
}

export interface State {
  features: Feature[];
}

export interface SessionStartEvent { t: 'session_start'; ts: number; session: string; cwd?: string; label?: string; }
export interface PlanDetectedEvent { t: 'plan_detected'; ts: number; session: string; plan: string; title?: string; tasks: SkeletonTask[]; }
export interface TodoUpdateEvent { t: 'todo_update'; ts: number; session: string; todos: Todo[]; }
export interface SubagentStartEvent { t: 'subagent_start'; ts: number; session: string; agent: string; kind: string; desc: string; taskId?: string; }
export interface SubagentStopEvent { t: 'subagent_stop'; ts: number; session: string; agent?: string; }
export interface SessionStopEvent { t: 'session_stop'; ts: number; session: string; }

export type TrackerEvent =
  | SessionStartEvent
  | PlanDetectedEvent
  | TodoUpdateEvent
  | SubagentStartEvent
  | SubagentStopEvent
  | SessionStopEvent;
