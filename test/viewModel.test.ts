import { describe, it, expect } from 'vitest';
import { relativeTime, groupOf, buildGroups, featureCounts, isVisible, locate } from '../src/viewModel';
import { reduce } from '../src/reducer';
import { TrackerEvent, ViewOptions } from '../src/types';

const MINUTE = 60_000;
const opts = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  now: 10 * 60 * MINUTE,
  workspaceFolders: [],
  hideDoneAfterMinutes: 30,
  dismissed: new Set(),
  ...over,
});

const MIN = 60_000;

describe('relativeTime', () => {
  it('formats recent, minutes, hours, and days', () => {
    expect(relativeTime(1_000_000, 1_000_000)).toBe('now');
    expect(relativeTime(1_000_000, 1_000_000 - 30_000)).toBe('now');   // < 45s
    expect(relativeTime(1_000_000, 1_000_000 - 5 * MIN)).toBe('5m ago');
    expect(relativeTime(1_000_000, 1_000_000 - 3 * 60 * MIN)).toBe('3h ago');
    expect(relativeTime(1_000_000, 1_000_000 - 2 * 24 * 60 * MIN)).toBe('2d ago');
  });
});

describe('groupOf', () => {
  const folders = ['c:\\ws\\claude-task-tracker'];

  it('maps a cwd inside an open folder to the current window', () => {
    const g = groupOf('c:\\ws\\claude-task-tracker\\src', folders);
    expect(g).toEqual({ key: 'c:\\ws\\claude-task-tracker', label: 'claude-task-tracker', isCurrentWindow: true });
  });

  it('maps an outside cwd to its own group', () => {
    const g = groupOf('c:\\ws\\TradeMatrix', folders);
    expect(g.isCurrentWindow).toBe(false);
    expect(g.label).toBe('TradeMatrix');
  });

  it('maps a missing cwd to the Unknown group', () => {
    expect(groupOf(null, folders)).toEqual({ key: '', label: 'Unknown (no cwd)', isCurrentWindow: false });
  });
});

describe('featureCounts', () => {
  it('counts live todos, falling back to skeleton size', () => {
    const f = reduce([
      { t: 'plan_detected', ts: 1, session: 's', plan: '/p.md', title: 'P',
        tasks: [{ id: 'T1', text: 'a' }, { id: 'T2', text: 'b' }] },
    ] as TrackerEvent[]).features[0];
    expect(featureCounts(f)).toEqual({ done: 0, total: 2 });
  });
});

describe('isVisible', () => {
  const doneFeature = (lastTs: number) => reduce([
    { t: 'todo_update', ts: lastTs, session: 's', todos: [{ text: 'x', status: 'completed' }] },
    { t: 'session_stop', ts: lastTs, session: 's' },
  ] as TrackerEvent[]).features[0];

  it('hides a done feature past the retention window', () => {
    const f = doneFeature(0);
    expect(isVisible(f, opts({ now: 20 * MINUTE }))).toBe(true);   // within 30m
    expect(isVisible(f, opts({ now: 40 * MINUTE }))).toBe(false);  // past 30m
  });

  it('never hides when retention is 0', () => {
    expect(isVisible(doneFeature(0), opts({ now: 999 * MINUTE, hideDoneAfterMinutes: 0 }))).toBe(true);
  });

  it('hides dismissed sessions regardless of status', () => {
    const f = doneFeature(0);
    expect(isVisible(f, opts({ now: 0, dismissed: new Set(['s']) }))).toBe(false);
  });

  it('always shows an active feature, even if dismissed', () => {
    const active = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]).features[0];
    expect(active.status).toBe('active');
    expect(isVisible(active, opts({ dismissed: new Set(['s']) }))).toBe(true);
  });
});

describe('buildGroups', () => {
  it('groups by workspace, pins the current window first, and disambiguates collisions', () => {
    const state = reduce([
      { t: 'todo_update', ts: 1 * MINUTE, session: 'aaa11111-x', cwd: 'c:/ws/proj',
        todos: [{ text: 'a', status: 'completed' }] },
      { t: 'plan_detected', ts: 1 * MINUTE, session: 'aaa11111-x', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [] },
      { t: 'plan_detected', ts: 5 * MINUTE, session: 'bbb22222-y', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [{ id: 'T1', text: 'a' }] },
      { t: 'todo_update', ts: 5 * MINUTE, session: 'bbb22222-y', cwd: 'c:/ws/proj', todos: [] },
      { t: 'todo_update', ts: 2 * MINUTE, session: 'ccc33333-z', cwd: 'c:/ws/Other',
        todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]);

    const groups = buildGroups(state, opts({ now: 6 * MINUTE, workspaceFolders: ['c:/ws/proj'] }));

    expect(groups[0].label).toBe('proj');
    expect(groups[0].isCurrentWindow).toBe(true);
    const labels = groups[0].features.map((fv) => fv.label).sort();
    // both colliding features get a stable shortId suffix (symmetric), and they are distinct
    expect(labels).toEqual(['Plan · aaa11111', 'Plan · bbb22222']);
    expect(groups.some((g) => g.label === 'Other' && !g.isCurrentWindow)).toBe(true);
  });
});

describe('locate', () => {
  const folders = ['c:\\ws\\claude-task-tracker'];

  it('splits a worktree path into repo + worktree, keeping original case', () => {
    const l = locate('C:\\Users\\me\\TradeMatrix\\.worktrees\\sc-declutter', folders);
    expect(l.repoLabel).toBe('TradeMatrix');
    expect(l.worktree).toBe('sc-declutter');
    expect(l.isCurrentWindow).toBe(false);
  });

  it('treats a normal repo as worktree=null', () => {
    const l = locate('c:\\ws\\claude-task-tracker\\src', folders);
    expect(l.repoLabel).toBe('claude-task-tracker');
    expect(l.worktree).toBeNull();
    expect(l.isCurrentWindow).toBe(true);
  });

  it('flags a worktree opened as the window folder as current window', () => {
    const l = locate('c:\\r\\Proj\\.worktrees\\feat', ['c:\\r\\Proj\\.worktrees\\feat']);
    expect(l.worktree).toBe('feat');
    expect(l.repoLabel).toBe('Proj');
    expect(l.isCurrentWindow).toBe(true);
  });

  it('maps a missing cwd to Unknown', () => {
    expect(locate(null, folders)).toEqual({ repoKey: '', repoLabel: 'Unknown (no cwd)', worktree: null, isCurrentWindow: false });
  });
});
