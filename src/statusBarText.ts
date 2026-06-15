import { State } from './types';

export function summarize(state: State): string {
  const active = state.features.filter((f) => f.status === 'active');
  if (active.length === 0) {
    return '';
  }
  active.sort((a, b) => b.lastTs - a.lastTs);
  const f = active[0];
  const total = f.liveTodos.length > 0 ? f.liveTodos.length : f.skeleton.length;
  const done = f.liveTodos.filter((t) => t.status === 'completed').length;
  const running = f.subagents.filter((s) => s.status === 'running').length;
  const more = active.length > 1 ? ` +${active.length - 1}` : '';
  return `$(rocket) ${f.label} ${done}/${total} · $(sync~spin)${running}${more}`;
}
