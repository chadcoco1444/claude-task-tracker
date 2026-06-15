import { describe, it, expect } from 'vitest';
import { applyHooks, removeHooks, isOurEntry, HOOK_EVENTS, ClaudeSettings } from '../src/hookInstaller';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installHooks, uninstallHooks } from '../src/hookInstaller';

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

  it('returns false for undefined', () => {
    expect(isOurEntry(undefined)).toBe(false);
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

  it('returns the original settings object when there are no hooks', () => {
    const empty = {} as ClaudeSettings;
    expect(removeHooks(empty)).toBe(empty);
    const emptyHooks = { hooks: {} } as ClaudeSettings;
    expect(removeHooks(emptyHooks)).toBe(emptyHooks);
  });
});

function tmpSettings(initial?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-'));
  const p = path.join(dir, 'settings.json');
  if (initial !== undefined) fs.writeFileSync(p, initial);
  return p;
}

describe('installHooks (filesystem)', () => {
  it('creates the file (and parent dirs) with our hooks when missing', () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-')), 'nested', 'settings.json');
    expect(installHooks(CMD, p).changed).toBe(true);
    const written = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(Object.keys(written.hooks)).toContain('SessionStart');
  });

  it('reports changed:false on a no-op repeat', () => {
    const p = tmpSettings('{}');
    expect(installHooks(CMD, p).changed).toBe(true);
    expect(installHooks(CMD, p).changed).toBe(false);
  });

  it('throws and does not clobber an unparseable settings.json', () => {
    const p = tmpSettings('{ not json');
    expect(() => installHooks(CMD, p)).toThrow();
    expect(fs.readFileSync(p, 'utf8')).toBe('{ not json');
  });
});

describe('uninstallHooks (filesystem)', () => {
  it('removes our hooks again', () => {
    const p = tmpSettings('{}');
    installHooks(CMD, p);
    expect(uninstallHooks(p).changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(p, 'utf8')).hooks.SessionStart).toBeUndefined();
  });
});
