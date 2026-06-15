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

export type FeatureStatus = 'active' | 'idle' | 'done' | 'ended';

// Where a feature's label came from, in ascending priority. A higher-priority
// source may overwrite a lower one, never the reverse — so a plan title always
// wins over a folder name, which always wins over the short-session-id fallback.
export type LabelSource = 'default' | 'cwd' | 'title';

export interface Feature {
  session: string;
  label: string;
  labelSource: LabelSource;
  cwd: string | null;
  planPath: string | null;
  skeleton: SkeletonTask[];
  liveTodos: Todo[];
  subagents: Subagent[];
  stopped: boolean;
  ended: boolean;
  lastTs: number;
  status: FeatureStatus;
}

export interface State {
  features: Feature[];
}

export interface SessionStartEvent { t: 'session_start'; ts: number; session: string; cwd?: string; label?: string; }
export interface PlanDetectedEvent { t: 'plan_detected'; ts: number; session: string; plan: string; title?: string; tasks: SkeletonTask[]; }
export interface TodoUpdateEvent { t: 'todo_update'; ts: number; session: string; cwd?: string; todos: Todo[]; }
export interface SubagentStartEvent { t: 'subagent_start'; ts: number; session: string; cwd?: string; agent: string; kind: string; desc: string; taskId?: string; }
export interface SubagentStopEvent { t: 'subagent_stop'; ts: number; session: string; cwd?: string; agent?: string; }
export interface SessionStopEvent { t: 'session_stop'; ts: number; session: string; cwd?: string; }
export interface SessionEndEvent { t: 'session_end'; ts: number; session: string; cwd?: string; }

export type TrackerEvent =
  | SessionStartEvent
  | PlanDetectedEvent
  | TodoUpdateEvent
  | SubagentStartEvent
  | SubagentStopEvent
  | SessionStopEvent
  | SessionEndEvent;

export interface ViewOptions {
  now: number;
  workspaceFolders: string[];
  hideDoneAfterMinutes: number;
  dismissed: ReadonlySet<string>;
}

export interface TreeNode {
  kind: 'group' | 'feature' | 'task' | 'subagent';
  label: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  children?: TreeNode[];
  resourcePath?: string;
  session?: string;
}
