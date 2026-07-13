import { Feature, State, ViewOptions } from './types';
import { basename, shortId } from './util';

export function relativeTime(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) {
    return 'now';
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.floor(h / 24)}d ago`;
}

export interface Location {
  repoKey: string;
  repoLabel: string;
  worktree: string | null;
  isCurrentWindow: boolean;
}

export function locate(cwd: string | null, workspaceFolders: string[]): Location {
  if (!cwd) {
    return { repoKey: '', repoLabel: 'Unknown (no cwd)', worktree: null, isCurrentWindow: false };
  }
  const slash = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const lower = slash.toLowerCase();
  let matchedFolder: string | undefined;
  const isCurrentWindow = workspaceFolders.some((folder) => {
    const f = folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (lower === f || lower.startsWith(f + '/')) {
      matchedFolder = folder.replace(/\\/g, '/').replace(/\/+$/, '');
      return true;
    }
    return false;
  });
  const m = slash.match(/^(.*)\/\.worktrees\/([^/]+)(?:\/.*)?$/i);
  if (m) {
    return { repoKey: m[1].toLowerCase(), repoLabel: basename(m[1]), worktree: m[2], isCurrentWindow };
  }
  if (isCurrentWindow && matchedFolder) {
    return { repoKey: matchedFolder.toLowerCase(), repoLabel: basename(matchedFolder), worktree: null, isCurrentWindow };
  }
  return { repoKey: lower, repoLabel: basename(slash), worktree: null, isCurrentWindow };
}

export function featureCounts(f: Feature): { done: number; total: number } {
  const useTodos = f.liveTodos.length > 0;
  const total = useTodos ? f.liveTodos.length : f.skeleton.length;
  const done = f.liveTodos.filter((t) => t.status === 'completed').length;
  return { done, total };
}

// An "active" feature (in-progress todo or running subagent) counts as *live*
// only while it keeps emitting events. A session that dies mid-task — leaving a
// stuck in_progress todo and never firing SessionEnd — otherwise derives as
// 'active' forever (see reducer.deriveStatus): pinned visible and immune to both
// Clear inactive and Dismiss. Past this silence window we treat such a feature as
// a dead session, not work in flight. A genuinely running session refreshes lastTs
// every turn (the Stop hook) and on every subagent dispatch; 60 minutes leaves
// ample headroom for one long-running subagent to finish before we call it dead.
export const ACTIVE_SILENCE_MS = 60 * 60_000;

export function isLiveActive(f: Feature, now: number): boolean {
  return f.status === 'active' && now - f.lastTs <= ACTIVE_SILENCE_MS;
}

// The sessions Clear inactive should dismiss: everything except genuinely live
// sessions — which includes stale 'active' zombies that never terminated cleanly.
export function sessionsToClear(features: Feature[], now: number): string[] {
  return features.filter((f) => !isLiveActive(f, now)).map((f) => f.session);
}

export function isVisible(f: Feature, o: ViewOptions): boolean {
  // A genuinely live session is always shown, even if dismissed — never hide work
  // in flight. A stale 'active' feature falls through to the rules below, so an
  // explicit dismissal can hide it and retention can eventually auto-hide it.
  if (isLiveActive(f, o.now)) {
    return true;
  }
  if (o.dismissed.has(f.session)) {
    return false;
  }
  // Drop "ghost" sessions: ones that only opened a plan, never recording a
  // single todo_update or subagent. They'd otherwise linger as empty 0/N
  // duplicates of whichever session actually ran the plan. An ended ghost is
  // hidden immediately; an idle one (never closed) is hidden once it goes
  // stale, so a freshly-detected plan still previews for the grace window.
  const noWork = f.liveTodos.length === 0 && f.subagents.length === 0;
  if (noWork && f.status === 'ended') {
    return false;
  }
  if (
    noWork &&
    f.status === 'idle' &&
    o.hideDoneAfterMinutes > 0 &&
    o.now - f.lastTs > o.hideDoneAfterMinutes * 60_000
  ) {
    return false;
  }
  // Auto-hide finished features past the retention window — and stale 'active'
  // ones too (dead sessions, no longer live per the check above), so a zombie
  // disappears on its own instead of pinning the panel forever.
  if (
    (f.status === 'done' || f.status === 'ended' || f.status === 'active') &&
    o.hideDoneAfterMinutes > 0 &&
    o.now - f.lastTs > o.hideDoneAfterMinutes * 60_000
  ) {
    return false;
  }
  return true;
}

export interface FeatureView {
  session: string;
  label: string;
  status: Feature['status'];
  done: number;
  total: number;
  feature: Feature;
}

export interface WorktreeView {
  name: string;
  features: FeatureView[];
}

export interface RepoGroup {
  key: string;
  label: string;
  isCurrentWindow: boolean;
  features: FeatureView[];
  worktrees: WorktreeView[];
}

function toFeatureView(f: Feature): FeatureView {
  const { done, total } = featureCounts(f);
  return { session: f.session, label: f.label, status: f.status, done, total, feature: f };
}

function maxTs(features: FeatureView[]): number {
  return features.reduce((m, fv) => Math.max(m, fv.feature.lastTs), 0);
}

export function buildGroups(state: State, o: ViewOptions): RepoGroup[] {
  const repos = new Map<string, RepoGroup>();

  for (const f of state.features) {
    if (!isVisible(f, o)) {
      continue;
    }
    const loc = locate(f.cwd, o.workspaceFolders);
    let rg = repos.get(loc.repoKey);
    if (!rg) {
      rg = { key: loc.repoKey, label: loc.repoLabel, isCurrentWindow: false, features: [], worktrees: [] };
      repos.set(loc.repoKey, rg);
    }
    rg.isCurrentWindow = rg.isCurrentWindow || loc.isCurrentWindow;
    if (loc.worktree === null) {
      rg.features.push(toFeatureView(f));
    } else {
      let wt = rg.worktrees.find((w) => w.name === loc.worktree);
      if (!wt) {
        wt = { name: loc.worktree, features: [] };
        rg.worktrees.push(wt);
      }
      wt.features.push(toFeatureView(f));
    }
  }

  const byRecent = (a: FeatureView, b: FeatureView) => b.feature.lastTs - a.feature.lastTs;
  for (const rg of repos.values()) {
    rg.features.sort(byRecent);
    disambiguate(rg.features);
    rg.worktrees.sort((a, b) => maxTs(b.features) - maxTs(a.features));
    for (const wt of rg.worktrees) {
      wt.features.sort(byRecent);
      disambiguate(wt.features);
    }
  }

  const repoMaxTs = (rg: RepoGroup) =>
    Math.max(maxTs(rg.features), ...rg.worktrees.map((w) => maxTs(w.features)), 0);

  return [...repos.values()].sort((a, b) => {
    if (a.isCurrentWindow !== b.isCurrentWindow) {
      return a.isCurrentWindow ? -1 : 1;
    }
    if ((a.key === '') !== (b.key === '')) {
      return a.key === '' ? 1 : -1; // Unknown last
    }
    return repoMaxTs(b) - repoMaxTs(a);
  });
}

function disambiguate(features: FeatureView[]): void {
  const counts = new Map<string, number>();
  for (const fv of features) {
    counts.set(fv.label, (counts.get(fv.label) ?? 0) + 1);
  }
  for (const fv of features) {
    if ((counts.get(fv.label) ?? 0) >= 2) {
      fv.label = `${fv.label} · ${shortId(fv.session)}`;
    }
  }
}
