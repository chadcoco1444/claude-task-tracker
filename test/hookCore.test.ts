import { describe, it, expect } from 'vitest';
import { buildEvents, planParse, HookPayload, PlanInfo } from '../src/hook/core';

const noPlan = () => null;

describe('buildEvents', () => {
  it('SessionStart emits session_start, plus plan_detected when a plan is found', () => {
    const plan: PlanInfo = { plan: '/r/p.md', title: 'T', tasks: [{ id: 'T1', text: 'a' }] };
    const payload: HookPayload = { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/r' };
    const events = buildEvents(payload, 10, () => plan);
    expect(events.map((e) => e.t)).toEqual(['session_start', 'plan_detected']);
  });

  it('TodoWrite PostToolUse maps content -> text', () => {
    const payload: HookPayload = {
      hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'TodoWrite',
      tool_input: { todos: [{ content: 'Do X', status: 'in_progress', activeForm: 'Doing X' }] },
    };
    expect(buildEvents(payload, 10, noPlan)).toEqual([
      { t: 'todo_update', ts: 10, session: 's1', todos: [{ text: 'Do X', status: 'in_progress' }] },
    ]);
  });

  it('Task PreToolUse emits subagent_start using tool_use_id', () => {
    const payload: HookPayload = {
      hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Task', tool_use_id: 'tu1',
      tool_input: { subagent_type: 'code-reviewer', description: 'review diff' },
    };
    expect(buildEvents(payload, 10, noPlan)).toEqual([
      { t: 'subagent_start', ts: 10, session: 's1', agent: 'tu1', kind: 'code-reviewer', desc: 'review diff' },
    ]);
  });

  it('SubagentStop and Stop map to convergence / session end', () => {
    expect(buildEvents({ hook_event_name: 'SubagentStop', session_id: 's1' }, 5, noPlan))
      .toEqual([{ t: 'subagent_stop', ts: 5, session: 's1' }]);
    expect(buildEvents({ hook_event_name: 'Stop', session_id: 's1' }, 6, noPlan))
      .toEqual([{ t: 'session_stop', ts: 6, session: 's1' }]);
  });

  it('ignores unrelated tools and payloads without a session', () => {
    expect(buildEvents({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read' }, 1, noPlan)).toEqual([]);
    expect(buildEvents({ hook_event_name: 'Stop' }, 1, noPlan)).toEqual([]);
  });

  it('propagates cwd onto todo, subagent, and stop events so a missed SessionStart still labels', () => {
    const cwd = '/home/u/proj';
    const todo = buildEvents({ hook_event_name: 'PostToolUse', session_id: 's1', cwd, tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'a', status: 'pending' }] } }, 1, noPlan);
    expect((todo[0] as { cwd?: string }).cwd).toBe(cwd);

    const task = buildEvents({ hook_event_name: 'PreToolUse', session_id: 's1', cwd, tool_name: 'Task', tool_use_id: 'tu', tool_input: { subagent_type: 'k', description: 'd' } }, 1, noPlan);
    expect((task[0] as { cwd?: string }).cwd).toBe(cwd);

    const subStop = buildEvents({ hook_event_name: 'SubagentStop', session_id: 's1', cwd }, 1, noPlan);
    expect((subStop[0] as { cwd?: string }).cwd).toBe(cwd);

    const sessStop = buildEvents({ hook_event_name: 'Stop', session_id: 's1', cwd }, 1, noPlan);
    expect((sessStop[0] as { cwd?: string }).cwd).toBe(cwd);
  });

  it('omits cwd when the payload has none (keeps events minimal)', () => {
    const subStop = buildEvents({ hook_event_name: 'SubagentStop', session_id: 's1' }, 1, noPlan);
    expect('cwd' in subStop[0]).toBe(false);
  });

  it('SessionEnd maps to session_end', () => {
    expect(buildEvents({ hook_event_name: 'SessionEnd', session_id: 's1' }, 7, noPlan))
      .toEqual([{ t: 'session_end', ts: 7, session: 's1' }]);
  });

  it('a Write to a plan file re-emits plan_detected', () => {
    const plan: PlanInfo = { plan: '/r/p.md', title: 'P', tasks: [{ id: 'T1', text: 'a' }] };
    const payload: HookPayload = {
      hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/r', tool_name: 'Write',
      tool_input: { file_path: '/r/docs/superpowers/plans/2026-06-15-x.md' },
    };
    const events = buildEvents(payload, 9, () => plan);
    expect(events).toEqual([{ t: 'plan_detected', ts: 9, session: 's1', plan: '/r/p.md', title: 'P', tasks: [{ id: 'T1', text: 'a' }] }]);
  });

  it('a Write to a non-plan file emits nothing', () => {
    const payload: HookPayload = {
      hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/r', tool_name: 'Write',
      tool_input: { file_path: '/r/src/index.ts' },
    };
    expect(buildEvents(payload, 9, () => ({ plan: '/r/p.md', tasks: [] }))).toEqual([]);
  });
});

describe('planParse', () => {
  it('extracts the H1 title and "### Task N:" headings', () => {
    const md = [
      '# Auth Implementation Plan',
      'intro paragraph',
      '### Task 1: DB schema',
      'details',
      '### Task 2: API routes',
    ].join('\n');
    expect(planParse(md)).toEqual({
      title: 'Auth Implementation Plan',
      tasks: [{ id: 'T1', text: 'DB schema' }, { id: 'T2', text: 'API routes' }],
    });
  });

  it('also matches "## Task N:" (h2) headings used by real plans', () => {
    const md = [
      '# My Plan',
      '## Task 1: Alpha',
      'body',
      '## Task 2: Beta',
    ].join('\n');
    expect(planParse(md)).toEqual({
      title: 'My Plan',
      tasks: [{ id: 'T1', text: 'Alpha' }, { id: 'T2', text: 'Beta' }],
    });
  });
});
