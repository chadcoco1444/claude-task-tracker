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
