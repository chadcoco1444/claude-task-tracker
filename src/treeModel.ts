import { Feature, State, TodoStatus } from './types';

export interface TreeNode {
  kind: 'feature' | 'task' | 'subagent';
  label: string;
  description?: string;
  icon: string;
  children?: TreeNode[];
  resourcePath?: string;
}

function featureIcon(f: Feature): string {
  if (f.status === 'done') {
    return 'pass-filled';
  }
  if (f.status === 'active') {
    return 'sync~spin';
  }
  return 'circle-outline';
}

function todoIcon(status: TodoStatus): string {
  if (status === 'completed') {
    return 'check';
  }
  if (status === 'in_progress') {
    return 'sync~spin';
  }
  return 'circle-outline';
}

export function buildTree(state: State): TreeNode[] {
  return state.features.map((f) => {
    const useTodos = f.liveTodos.length > 0;

    const taskNodes: TreeNode[] = useTodos
      ? f.liveTodos.map((td) => ({ kind: 'task' as const, label: td.text, icon: todoIcon(td.status) }))
      : f.skeleton.map((sk) => ({ kind: 'task' as const, label: sk.text, description: 'planned', icon: 'circle-outline' }));

    const subagentNodes: TreeNode[] = f.subagents.map((s) => ({
      kind: 'subagent' as const,
      label: s.kind,
      description: s.desc,
      icon: s.status === 'converged' ? 'check' : 'sync~spin',
    }));

    const total = useTodos ? f.liveTodos.length : f.skeleton.length;
    const done = f.liveTodos.filter((t) => t.status === 'completed').length;

    return {
      kind: 'feature' as const,
      label: f.label,
      description: `${done}/${total}`,
      icon: featureIcon(f),
      resourcePath: f.planPath ?? undefined,
      children: [...taskNodes, ...subagentNodes],
    };
  });
}
