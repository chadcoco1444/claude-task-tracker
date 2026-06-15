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
});
