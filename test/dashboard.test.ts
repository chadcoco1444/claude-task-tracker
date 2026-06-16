import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from '../src/dashboard';
import { reduce } from '../src/reducer';
import { TrackerEvent, ViewOptions } from '../src/types';

const opts: ViewOptions = {
  now: 1000, workspaceFolders: ['c:/ws/auth'], hideDoneAfterMinutes: 0, dismissed: new Set(),
};

describe('renderDashboardHtml', () => {
  it('renders a group header, the feature label, a percentage, and a status pill', () => {
    const state = reduce([
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'in_progress' },
      ] },
    ] as TrackerEvent[]);

    const html = renderDashboardHtml(state, opts);
    expect(html).toContain('auth (this window)');
    expect(html).toContain('auth');        // feature label (cwd basename)
    expect(html).toContain('50%');         // 1/2
    expect(html).toContain('running');     // status pill (active)
  });

  it('escapes HTML in labels', () => {
    const state = reduce([
      { t: 'plan_detected', ts: 1, session: 's1', plan: '/p.md', title: '<script>x</script>', tasks: [] },
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [] },
    ] as TrackerEvent[]);
    expect(renderDashboardHtml(state, opts)).not.toContain('<script>x</script>');
  });

  it('renders a worktree as an h4 sub-header under the repo h3', () => {
    const state = reduce([
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/proj/.worktrees/feat', todos: [
        { text: 'a', status: 'in_progress' },
      ] },
    ] as TrackerEvent[]);
    const html = renderDashboardHtml(state, { now: 1000, workspaceFolders: ['c:/ws/proj'], hideDoneAfterMinutes: 0, dismissed: new Set() });
    expect(html).toContain('<h3>proj (this window)</h3>');
    expect(html).toContain('<h4>feat</h4>');
  });

  it('tags each card with its session and wires a right-click dismiss handler', () => {
    const state = reduce([
      { t: 'todo_update', ts: 2, session: 's1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'in_progress' }] },
    ] as TrackerEvent[]);
    const html = renderDashboardHtml(state, opts);
    expect(html).toContain('data-session="s1"');
    expect(html).toContain('contextmenu');
    expect(html).toContain("type: 'dismiss'");
  });

  it('shows an ended pill for an ended feature', () => {
    const state = reduce([
      { t: 'todo_update', ts: 1, session: 's1', cwd: 'c:/ws/auth', todos: [{ text: 'a', status: 'completed' }] },
      { t: 'session_end', ts: 2, session: 's1' },
    ] as TrackerEvent[]);
    const html = renderDashboardHtml(state, { now: 1000, workspaceFolders: ['c:/ws/auth'], hideDoneAfterMinutes: 0, dismissed: new Set() });
    expect(html).toContain('ended');
  });
});
