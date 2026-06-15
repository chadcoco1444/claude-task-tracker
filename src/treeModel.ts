import { Feature, State, TodoStatus, TreeNode, ViewOptions } from './types';
import { buildGroups, FeatureView } from './viewModel';

const FEATURE_COLOR: Record<Feature['status'], string> = {
  done: 'charts.green',
  active: 'charts.blue',
  idle: 'disabledForeground',
};

function featureIcon(status: Feature['status']): { icon: string; iconColor: string } {
  return { icon: 'rocket', iconColor: FEATURE_COLOR[status] };
}

function todoVisual(status: TodoStatus): { icon: string; iconColor: string } {
  if (status === 'completed') {
    return { icon: 'check', iconColor: 'charts.green' };
  }
  if (status === 'in_progress') {
    return { icon: 'sync~spin', iconColor: 'charts.yellow' };
  }
  return { icon: 'circle-outline', iconColor: 'disabledForeground' };
}

export function progressBar(done: number, total: number): string {
  const slots = 4;
  const filled = total > 0 ? Math.min(slots, Math.round((done / total) * slots)) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(slots - filled);
}

function taskNodes(f: Feature): TreeNode[] {
  if (f.liveTodos.length > 0) {
    return f.liveTodos.map((td): TreeNode => {
      const v = todoVisual(td.status);
      return { kind: 'task', label: td.text, icon: v.icon, iconColor: v.iconColor };
    });
  }
  return f.skeleton.map((sk): TreeNode => ({
    kind: 'task', label: sk.text, description: 'planned', icon: 'circle-outline', iconColor: 'disabledForeground',
  }));
}

function subagentNodes(f: Feature): TreeNode[] {
  return f.subagents.map((s): TreeNode => ({
    kind: 'subagent',
    label: s.kind,
    description: s.desc,
    icon: 'robot',
    iconColor: s.status === 'converged' ? 'charts.green' : 'charts.blue',
  }));
}

function featureNode(fv: FeatureView): TreeNode {
  const v = featureIcon(fv.status);
  return {
    kind: 'feature',
    session: fv.session,
    label: fv.label,
    description: `${progressBar(fv.done, fv.total)} ${fv.done}/${fv.total}`,
    icon: v.icon,
    iconColor: v.iconColor,
    resourcePath: fv.feature.planPath ?? undefined,
    children: [...taskNodes(fv.feature), ...subagentNodes(fv.feature)],
  };
}

export function buildTree(state: State, options: ViewOptions): TreeNode[] {
  return buildGroups(state, options).map((rg): TreeNode => ({
    kind: 'group',
    label: rg.isCurrentWindow ? `${rg.label} (this window)` : rg.label,
    icon: 'folder',
    children: [
      ...rg.features.map(featureNode),
      ...rg.worktrees.map((wt): TreeNode => ({
        kind: 'group',
        label: wt.name,
        icon: 'git-branch',
        children: wt.features.map(featureNode),
      })),
    ],
  }));
}
