import { Feature, State, ViewOptions } from './types';

export function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function shortId(session: string): string {
  return session.split('-')[0] || session;
}

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

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export interface Group {
  key: string;
  label: string;
  isCurrentWindow: boolean;
}

export function groupOf(cwd: string | null, workspaceFolders: string[]): Group {
  if (!cwd) {
    return { key: '', label: 'Unknown (no cwd)', isCurrentWindow: false };
  }
  const c = norm(cwd);
  for (const folder of workspaceFolders) {
    const f = norm(folder);
    if (c === f || c.startsWith(f + '/')) {
      return { key: folder, label: basename(folder), isCurrentWindow: true };
    }
  }
  return { key: cwd, label: basename(cwd), isCurrentWindow: false };
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

export function isVisible(f: Feature, o: ViewOptions): boolean {
  if (f.status === 'active') {
    return true;
  }
  if (o.dismissed.has(f.session)) {
    return false;
  }
  if (f.status === 'done' && o.hideDoneAfterMinutes > 0) {
    if (o.now - f.lastTs > o.hideDoneAfterMinutes * 60_000) {
      return false;
    }
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

export interface GroupView {
  key: string;
  label: string;
  isCurrentWindow: boolean;
  features: FeatureView[];
}

export function buildGroups(state: State, o: ViewOptions): GroupView[] {
  const groups = new Map<string, GroupView>();

  for (const f of state.features) {
    if (!isVisible(f, o)) {
      continue;
    }
    const g = groupOf(f.cwd, o.workspaceFolders);
    let gv = groups.get(g.key);
    if (!gv) {
      gv = { key: g.key, label: g.label, isCurrentWindow: g.isCurrentWindow, features: [] };
      groups.set(g.key, gv);
    }
    const { done, total } = featureCounts(f);
    gv.features.push({ session: f.session, label: f.label, status: f.status, done, total, feature: f });
  }

  for (const gv of groups.values()) {
    gv.features.sort((a, b) => b.feature.lastTs - a.feature.lastTs);
    disambiguate(gv.features);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.isCurrentWindow !== b.isCurrentWindow) {
      return a.isCurrentWindow ? -1 : 1;
    }
    if (a.key === '' !== (b.key === '')) {
      return a.key === '' ? 1 : -1; // Unknown last
    }
    return maxTs(b) - maxTs(a);
  });
}

function maxTs(g: GroupView): number {
  return g.features.reduce((m, fv) => Math.max(m, fv.feature.lastTs), 0);
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
