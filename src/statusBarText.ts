import { State, ViewOptions } from './types';
import { featureCounts, groupOf } from './viewModel';

type StatusOptions = Pick<ViewOptions, 'now' | 'workspaceFolders'>;

export function summarize(state: State, options: StatusOptions): string {
  const active = state.features.filter(
    (f) => f.status === 'active' && groupOf(f.cwd, options.workspaceFolders).isCurrentWindow,
  );
  if (active.length === 0) {
    return '';
  }
  active.sort((a, b) => b.lastTs - a.lastTs);
  const f = active[0];
  const { done, total } = featureCounts(f);
  const running = f.subagents.filter((s) => s.status === 'running').length;
  const more = active.length > 1 ? ` +${active.length - 1}` : '';
  return `$(rocket) ${f.label} ${done}/${total} · $(sync~spin)${running}${more}`;
}
