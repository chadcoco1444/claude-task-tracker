import { describe, it, expect } from 'vitest';
import { applyHooks, removeHooks, isOurEntry, HOOK_EVENTS, ClaudeSettings } from '../src/hookInstaller';

const CMD = 'node "/ext/0.3.0/dist/hook.js"';

describe('applyHooks', () => {
  it('installs all six hook events with correct matchers on empty settings', () => {
    const out = applyHooks({}, CMD);
    expect(Object.keys(out.hooks!)).toEqual(HOOK_EVENTS.map((h) => h.event));
    expect(out.hooks!['PostToolUse'][0]).toEqual({
      matcher: 'TodoWrite|Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: CMD }],
    });
    expect(out.hooks!['SessionStart'][0]).toEqual({ hooks: [{ type: 'command', command: CMD }] });
  });

  it('is idempotent (applying twice equals applying once)', () => {
    const once = applyHooks({}, CMD);
    expect(applyHooks(once, CMD)).toEqual(once);
  });

  it('replaces a stale entry pointing at an old dist/hook.js path (self-heal)', () => {
    const stale: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "/ext/0.1.0/dist/hook.js"' }] }] },
    };
    expect(applyHooks(stale, CMD).hooks!['Stop']).toEqual([{ hooks: [{ type: 'command', command: CMD }] }]);
  });

  it('preserves a foreign hook entry on the same event', () => {
    const foreign: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    };
    const out = applyHooks(foreign, CMD);
    expect(out.hooks!['Stop']).toHaveLength(2);
    expect(out.hooks!['Stop'][0]).toEqual({ hooks: [{ type: 'command', command: 'echo hi' }] });
  });

  it('preserves unrelated top-level settings keys', () => {
    expect(applyHooks({ model: 'opus' } as ClaudeSettings, CMD).model).toBe('opus');
  });
});

describe('isOurEntry', () => {
  it('matches both / and \\ path separators, rejects others', () => {
    expect(isOurEntry({ hooks: [{ type: 'command', command: 'node "/a/dist/hook.js"' }] })).toBe(true);
    expect(isOurEntry({ hooks: [{ type: 'command', command: 'node "C:\\a\\dist\\hook.js"' }] })).toBe(true);
    expect(isOurEntry({ hooks: [{ type: 'command', command: 'node other.js' }] })).toBe(false);
  });
});

describe('removeHooks', () => {
  it('removes only our entries, drops emptied events, keeps foreign', () => {
    const settings = applyHooks(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
      CMD,
    );
    const out = removeHooks(settings);
    expect(out.hooks!['Stop']).toEqual([{ hooks: [{ type: 'command', command: 'echo hi' }] }]);
    expect(out.hooks!['SessionStart']).toBeUndefined();
  });
});
