import { State, ViewOptions } from './types';
import { featureCounts, isLiveActive, locate, relativeTime } from './viewModel';

type StatusOptions = Pick<ViewOptions, 'now' | 'workspaceFolders'>;

export function summarize(state: State, options: StatusOptions): string {
  const inWin = state.features.filter(
    (f) => locate(f.cwd, options.workspaceFolders).isCurrentWindow,
  );
  if (inWin.length === 0) {
    return '';
  }
  // Only a *live* active feature (recent events) headlines as running — a session
  // that died with a stuck in_progress todo derives as 'active' forever but is not.
  const active = inWin.filter((f) => isLiveActive(f, options.now));
  const live = inWin.filter((f) => f.status !== 'ended');
  const pool = active.length > 0 ? active : (live.length > 0 ? live : inWin);
  pool.sort((a, b) => b.lastTs - a.lastTs);
  const f = pool[0];
  const { done, total } = featureCounts(f);
  if (isLiveActive(f, options.now)) {
    const running = f.subagents.filter((s) => s.status === 'running').length;
    const more = active.length > 1 ? ` +${active.length - 1}` : '';
    return `$(rocket) ${f.label} ${done}/${total} · $(sync~spin)${running}${more}`;
  }
  return `$(rocket) ${f.label} ${done}/${total} · ${f.status} · ${relativeTime(options.now, f.lastTs)}`;
}
