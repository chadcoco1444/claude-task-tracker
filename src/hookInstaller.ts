export interface HookCommand {
  type: 'command';
  command: string;
}

export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

export interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

// The six hook events this extension installs, with their tool matchers.
export const HOOK_EVENTS: { event: string; matcher?: string }[] = [
  { event: 'SessionStart' },
  { event: 'PostToolUse', matcher: 'TodoWrite|Write|Edit|MultiEdit' },
  { event: 'PreToolUse', matcher: 'Task' },
  { event: 'SubagentStop' },
  { event: 'Stop' },
  { event: 'SessionEnd' },
];

// Recognise an entry installed by THIS tool by its `dist/hook.js` command,
// regardless of which directory it lived in — so a re-install replaces a stale
// path left behind after the extension updates to a new version directory.
const OUR_HOOK_RE = /dist[\\/]+hook\.js/;

export function isOurEntry(entry: HookEntry | undefined): boolean {
  return (
    !!entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => typeof h.command === 'string' && OUR_HOOK_RE.test(h.command))
  );
}

// Pure: return a new settings object with our hook entries (re)installed.
export function applyHooks(settings: ClaudeSettings, command: string): ClaudeSettings {
  const hooks: Record<string, HookEntry[]> = { ...(settings.hooks ?? {}) };
  for (const { event, matcher } of HOOK_EVENTS) {
    const kept = (hooks[event] ?? []).filter((e) => !isOurEntry(e));
    const entry: HookEntry = matcher
      ? { matcher, hooks: [{ type: 'command', command }] }
      : { hooks: [{ type: 'command', command }] };
    hooks[event] = [...kept, entry];
  }
  return { ...settings, hooks };
}

// Pure: return a new settings object with all of our entries removed and any
// event left empty dropped entirely.
export function removeHooks(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks || Object.keys(settings.hooks).length === 0) return settings;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, arr] of Object.entries(settings.hooks)) {
    const kept = arr.filter((e) => !isOurEntry(e));
    if (kept.length > 0) hooks[event] = kept;
  }
  return { ...settings, hooks };
}
