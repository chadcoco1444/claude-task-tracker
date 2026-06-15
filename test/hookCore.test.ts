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
});
