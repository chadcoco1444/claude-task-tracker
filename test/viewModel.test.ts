import { describe, it, expect } from 'vitest';
import { relativeTime, buildGroups, featureCounts, isVisible, isLiveActive, sessionsToClear, locate } from '../src/viewModel';
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

  it('always shows a live active feature, even if dismissed', () => {
    const active = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]).features[0];
    expect(active.status).toBe('active');
    // Fresh (within the silence window): the pin protects a genuinely running session.
    expect(isVisible(active, opts({ now: 5 * MINUTE, dismissed: new Set(['s']) }))).toBe(true);
  });

  it('lets an explicit dismiss hide a stale "active" feature (dead session, stuck in_progress todo)', () => {
    // A session that died mid-task: last event long ago, one todo stuck in_progress,
    // no session_end. deriveStatus pins it 'active' forever — but it is not live.
    const zombie = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'in_progress' }] },
      { t: 'session_stop', ts: 0, session: 's' },
    ] as TrackerEvent[]).features[0];
    expect(zombie.status).toBe('active');
    // Fresh: still pinned regardless of dismissal.
    expect(isVisible(zombie, opts({ now: 5 * MINUTE, dismissed: new Set(['s']) }))).toBe(true);
    // Stale + dismissed (e.g. via Clear inactive): finally hideable.
    expect(isVisible(zombie, opts({ now: 999 * MINUTE, dismissed: new Set(['s']) }))).toBe(false);
  });

  it('auto-hides a stale "active" feature past the retention window, keeps it while fresh', () => {
    const zombie = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]).features[0];
    expect(zombie.status).toBe('active');
    expect(isVisible(zombie, opts({ now: 5 * MINUTE }))).toBe(true);    // live: shown
    expect(isVisible(zombie, opts({ now: 999 * MINUTE }))).toBe(false); // long dead: auto-hidden
  });

  it('never auto-hides a stale "active" feature when retention is 0', () => {
    const zombie = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]).features[0];
    expect(isVisible(zombie, opts({ now: 999 * MINUTE, hideDoneAfterMinutes: 0 }))).toBe(true);
  });

  it('hides an ended feature past the retention window, shows it within', () => {
    const ended = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_end', ts: 0, session: 's' },
    ] as TrackerEvent[]).features[0];
    expect(ended.status).toBe('ended');
    expect(isVisible(ended, opts({ now: 20 * 60_000 }))).toBe(true);   // within 30m
    expect(isVisible(ended, opts({ now: 40 * 60_000 }))).toBe(false);  // past 30m
  });

  it('hides a ghost session: ended having only opened a plan, no todos or subagents', () => {
    const ghost = reduce([
      { t: 'plan_detected', ts: 0, session: 's', plan: '/p.md', title: 'P',
        tasks: [{ id: 'T1', text: 'a' }] },
      { t: 'session_end', ts: 0, session: 's' },
    ] as TrackerEvent[]).features[0];
    expect(ghost.status).toBe('ended');
    // Hidden immediately, even within the retention window and with retention off.
    expect(isVisible(ghost, opts({ now: 0 }))).toBe(false);
    expect(isVisible(ghost, opts({ now: 0, hideDoneAfterMinutes: 0 }))).toBe(false);
  });

  it('shows a resumed session that has no todos yet (not an ended ghost)', () => {
    // Ended days ago, then resumed under the same id: it is alive again, so the
    // ghost rule must not hide it just because it has not written a todo yet.
    const resumed = reduce([
      { t: 'session_start', ts: 0, session: 's', cwd: '/a/repo' },
      { t: 'session_end', ts: 0, session: 's' },
      { t: 'session_start', ts: 0, session: 's', cwd: '/a/repo' },
    ] as TrackerEvent[]).features[0];
    expect(resumed.status).toBe('idle');
    expect(isVisible(resumed, opts({ now: 5 * MINUTE }))).toBe(true);
  });

  it('hides an idle plan-only session once it goes stale, but keeps a fresh one', () => {
    const idleGhost = reduce([
      { t: 'plan_detected', ts: 0, session: 's', plan: '/p.md', title: 'P', tasks: [{ id: 'T1', text: 'a' }] },
    ] as TrackerEvent[]).features[0];
    expect(idleGhost.status).toBe('idle');
    expect(isVisible(idleGhost, opts({ now: 20 * MINUTE }))).toBe(true);   // fresh: keep the plan preview
    expect(isVisible(idleGhost, opts({ now: 40 * MINUTE }))).toBe(false);  // stale: hide the phantom 0/N
  });

  it('never hides an idle plan-only session when retention is 0', () => {
    const idleGhost = reduce([
      { t: 'plan_detected', ts: 0, session: 's', plan: '/p.md', title: 'P', tasks: [{ id: 'T1', text: 'a' }] },
    ] as TrackerEvent[]).features[0];
    expect(isVisible(idleGhost, opts({ now: 999 * MINUTE, hideDoneAfterMinutes: 0 }))).toBe(true);
  });

  it('keeps a stale idle session that has live todos (not a ghost)', () => {
    const working = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'pending' }] },
    ] as TrackerEvent[]).features[0];
    expect(working.status).toBe('idle');
    expect(isVisible(working, opts({ now: 999 * MINUTE }))).toBe(true);
  });

  it('keeps an ended feature that ran subagents but recorded no live todos', () => {
    const worked = reduce([
      { t: 'subagent_start', ts: 0, session: 's', agent: 'a1', kind: 'reviewer', desc: 'review' },
      { t: 'session_end', ts: 0, session: 's' },
    ] as TrackerEvent[]).features[0];
    expect(worked.status).toBe('ended');
    expect(isVisible(worked, opts({ now: 0 }))).toBe(true);   // within retention, did work
  });
});

describe('isLiveActive', () => {
  const activeAt = (ts: number) => reduce([
    { t: 'todo_update', ts, session: 's', todos: [{ text: 'x', status: 'in_progress' }] },
  ] as TrackerEvent[]).features[0];

  it('is true for an active feature that emitted an event recently', () => {
    expect(isLiveActive(activeAt(0), 5 * MIN)).toBe(true);
  });

  it('is false once an active feature has gone silent past the window', () => {
    expect(isLiveActive(activeAt(0), 999 * MIN)).toBe(false);
  });

  it('is false for a non-active feature no matter how recent', () => {
    const done = reduce([
      { t: 'todo_update', ts: 0, session: 's', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_stop', ts: 0, session: 's' },
    ] as TrackerEvent[]).features[0];
    expect(done.status).toBe('done');
    expect(isLiveActive(done, 0)).toBe(false);
  });
});

describe('sessionsToClear', () => {
  it('returns every session except the ones that are live-active', () => {
    const state = reduce([
      // live active: fresh in_progress todo
      { t: 'todo_update', ts: 100 * MIN, session: 'live', todos: [{ text: 'x', status: 'in_progress' }] },
      // stale active: in_progress but long silent (dead /loop, never ended)
      { t: 'todo_update', ts: 0, session: 'zombie', todos: [{ text: 'x', status: 'in_progress' }] },
      // plain done
      { t: 'todo_update', ts: 0, session: 'done', todos: [{ text: 'x', status: 'completed' }] },
      { t: 'session_stop', ts: 0, session: 'done' },
    ] as TrackerEvent[]);
    const cleared = sessionsToClear(state.features, 105 * MIN).sort();
    expect(cleared).toEqual(['done', 'zombie']);
  });
});

describe('buildGroups', () => {
  it('nests worktrees under their repo, pins current window, disambiguates per list', () => {
    const MIN = 60_000;
    const state = reduce([
      { t: 'plan_detected', ts: 1 * MIN, session: 'aaa11111-x', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [] },
      { t: 'todo_update', ts: 1 * MIN, session: 'aaa11111-x', cwd: 'c:/ws/proj', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'plan_detected', ts: 2 * MIN, session: 'bbb22222-y', plan: 'c:/ws/proj/p.md', title: 'Plan', tasks: [{ id: 'T1', text: 'a' }] },
      { t: 'todo_update', ts: 2 * MIN, session: 'bbb22222-y', cwd: 'c:/ws/proj', todos: [] },
      { t: 'todo_update', ts: 3 * MIN, session: 'ccc33333-z', cwd: 'c:/ws/proj/.worktrees/feat',
        todos: [{ text: 'x', status: 'in_progress' }] },
    ] as TrackerEvent[]);

    const groups = buildGroups(state, opts({ now: 4 * MIN, workspaceFolders: ['c:/ws/proj'] }));

    expect(groups).toHaveLength(1);
    const repo = groups[0];
    expect(repo.label).toBe('proj');
    expect(repo.isCurrentWindow).toBe(true);
    expect(repo.features.map((f) => f.label).sort()).toEqual(['Plan · aaa11111', 'Plan · bbb22222']);
    expect(repo.worktrees).toHaveLength(1);
    expect(repo.worktrees[0].name).toBe('feat');
    expect(repo.worktrees[0].features[0].feature.session).toBe('ccc33333-z');
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
