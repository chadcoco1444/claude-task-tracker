# Marketplace Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Claude Task Tracker to the VS Code Marketplace and Open VSX as a working-out-of-the-box `0.3.0`, with auto-installed Claude Code hooks, marketplace assets, and a GitHub Actions release pipeline.

**Architecture:** Extract the existing hook-install logic into a pure, testable `src/hookInstaller.ts` shared by the extension and the dev npm script. On activation the extension asks for consent once, then installs hooks pointing at its own bundled `dist/hook.js` (self-healing across version updates). Add the icon/LICENSE/manifest fields vsce requires, a polished README + publishing runbook, and two CI workflows (PR check + tag-triggered dual-marketplace publish).

**Tech Stack:** TypeScript, esbuild (bundler), vitest (tests), `@vscode/vsce` (VS Code Marketplace), `ovsx` (Open VSX), GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-06-15-publish-to-marketplace-design.md](../specs/2026-06-15-publish-to-marketplace-design.md)

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/paths.ts` | Resolve `~/.claude` paths | Modify — add `claudeDir()`, `claudeSettingsPath()` |
| `src/hookInstaller.ts` | Pure hook (un)install logic + FS wrapper | Create |
| `test/hookInstaller.test.ts` | Unit tests for the installer | Create |
| `esbuild.js` | Build config | Modify — emit `dist/hookInstaller.js` |
| `scripts/install-hooks.js` | Dev script | Modify — thin wrapper over the shared module |
| `src/extension.ts` | Activation, consent prompt, commands | Modify |
| `package.json` | Manifest: marketplace metadata, config, commands, scripts, devDeps, version | Modify |
| `CHANGELOG.md` | Release notes | Modify — add `0.3.0` |
| `LICENSE` | MIT license text | Create |
| `media/icon.svg`, `media/icon.png` | Marketplace icon (source + 128×128 raster) | Create |
| `.vscodeignore` | Package contents filter | Modify |
| `README.md` | End-user Install + Development + Screenshots | Modify |
| `docs/PUBLISHING.md` | One-time account-setup + release runbook | Create |
| `.github/workflows/ci.yml` | PR/push build+test+package check | Create |
| `.github/workflows/release.yml` | Tag-triggered dual publish | Create |

**Branch:** all work happens on `feat/marketplace-publish` (already checked out; the spec is committed there).

---

## Task 1: Add `~/.claude` path helpers

**Files:**
- Modify: `src/paths.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
import * as os from 'os';
import * as path from 'path';

export function claudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function claudeSettingsPath(): string {
  return path.join(claudeDir(), 'settings.json');
}

export function trackerDir(): string {
  return path.join(claudeDir(), 'tracker');
}

export function eventLogPath(): string {
  return path.join(trackerDir(), 'events.jsonl');
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/paths.ts
git commit -m "refactor: add claudeDir/claudeSettingsPath path helpers"
```

---

## Task 2: Hook installer — pure core (TDD)

The pure functions transform a settings object; no filesystem. This mirrors the codebase's pure-function test style (`buildEvents`, `compactEvents`).

**Files:**
- Create: `src/hookInstaller.ts`
- Test: `test/hookInstaller.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/hookInstaller.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hookInstaller.test.ts`
Expected: FAIL — `Failed to resolve import "../src/hookInstaller"`.

- [ ] **Step 3: Write the pure core**

Create `src/hookInstaller.ts`:

```typescript
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
  if (!settings.hooks) return settings;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, arr] of Object.entries(settings.hooks)) {
    const kept = arr.filter((e) => !isOurEntry(e));
    if (kept.length > 0) hooks[event] = kept;
  }
  return { ...settings, hooks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hookInstaller.test.ts`
Expected: PASS — all `applyHooks`/`isOurEntry`/`removeHooks` tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/hookInstaller.ts test/hookInstaller.test.ts
git commit -m "feat: pure hook-installer core (apply/remove/isOurEntry)"
```

---

## Task 3: Hook installer — filesystem wrapper (TDD)

Add `installHooks`/`uninstallHooks` that read/write `settings.json`, using the pure core. They must NOT clobber an unparseable file, and must report `changed:false` on a no-op.

**Files:**
- Modify: `src/hookInstaller.ts`
- Modify: `test/hookInstaller.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/hookInstaller.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installHooks, uninstallHooks } from '../src/hookInstaller';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hookInstaller.test.ts`
Expected: FAIL — `installHooks`/`uninstallHooks` are not exported.

- [ ] **Step 3: Add the FS wrapper**

Append to `src/hookInstaller.ts` (and add the two imports at the top of the file):

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { claudeSettingsPath } from './paths';
```

```typescript
function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) return {};
  // Throws on malformed JSON — callers must NOT clobber an unparseable file.
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
}

function writeIfChanged(
  settingsPath: string,
  before: ClaudeSettings,
  after: ClaudeSettings,
): { changed: boolean } {
  const next = JSON.stringify(after, null, 2);
  // Compare with the same formatting we write, so a true no-op is detected
  // (a compact stringify would never equal the pretty-printed `next`).
  if (JSON.stringify(before, null, 2) === next) return { changed: false };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, next);
  return { changed: true };
}

export function installHooks(
  command: string,
  settingsPath: string = claudeSettingsPath(),
): { changed: boolean } {
  const before = readSettings(settingsPath);
  return writeIfChanged(settingsPath, before, applyHooks(before, command));
}

export function uninstallHooks(settingsPath: string = claudeSettingsPath()): { changed: boolean } {
  const before = readSettings(settingsPath);
  return writeIfChanged(settingsPath, before, removeHooks(before));
}
```

> Note: the `import` lines go at the TOP of the file (above the interfaces from Task 2); the functions go at the bottom.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hookInstaller.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; entire suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/hookInstaller.ts test/hookInstaller.test.ts
git commit -m "feat: filesystem install/uninstall hooks with no-clobber + change detection"
```

---

## Task 4: Emit `dist/hookInstaller.js` and rewrite the dev script

The extension bundles `hookInstaller` into `dist/extension.js` automatically. The standalone npm script needs its own CJS build to `require`.

**Files:**
- Modify: `esbuild.js`
- Modify: `scripts/install-hooks.js`

- [ ] **Step 1: Add a build target in `esbuild.js`**

In the `run()` function, after the `hook` context block (the one that outputs `dist/hook.js`), add:

```javascript
  const installer = await esbuild.context({
    ...common,
    entryPoints: ['src/hookInstaller.ts'],
    outfile: 'dist/hookInstaller.js',
    format: 'cjs',
  });
```

Then update the watch/rebuild/dispose blocks to include it:

```javascript
  if (watch) {
    await ext.watch();
    await hook.watch();
    await installer.watch();
  } else {
    await ext.rebuild();
    await hook.rebuild();
    await installer.rebuild();
    await ext.dispose();
    await hook.dispose();
    await installer.dispose();
  }
```

- [ ] **Step 2: Replace `scripts/install-hooks.js`**

```javascript
const fs = require('fs');
const path = require('path');

const distHook = path.resolve(__dirname, '..', 'dist', 'hook.js');
const distInstaller = path.resolve(__dirname, '..', 'dist', 'hookInstaller.js');

for (const f of [distHook, distInstaller]) {
  if (!fs.existsSync(f)) {
    console.error(`${path.relative(process.cwd(), f)} not found. Run "npm run build" first.`);
    process.exit(1);
  }
}

const { installHooks } = require(distInstaller);

try {
  const { changed } = installHooks(`node "${distHook}"`);
  console.log(changed ? 'Installed Claude Task Tracker hooks.' : 'Hooks already up to date.');
} catch (e) {
  console.error('Could not update ~/.claude/settings.json:', e.message);
  process.exit(1);
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: esbuild prints output for `dist/extension.js`, `dist/hook.js`, and `dist/hookInstaller.js`; exit 0.

- [ ] **Step 4: Run the dev script**

Run: `npm run install-hooks`
Expected: prints `Installed Claude Task Tracker hooks.` or `Hooks already up to date.` (it re-points your `~/.claude/settings.json` entries at this checkout — idempotent and safe to re-run).

- [ ] **Step 5: Commit**

```bash
git add esbuild.js scripts/install-hooks.js
git commit -m "build: emit dist/hookInstaller.js; make install-hooks script a thin wrapper"
```

---

## Task 5: Extension activation — consent prompt, auto-install, commands

`activate()` runs the installer (pointing at the bundled `dist/hook.js`) gated by a consent prompt and the `autoInstallHooks` setting, and registers manual install/remove commands. This module imports `vscode` (unavailable in vitest), so it is verified by typecheck/build, not unit tests — consistent with the rest of the extension. The manual smoke test is in Task 12.

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Add imports**

At the top of `src/extension.ts`, add below the existing imports:

```typescript
import * as path from 'path';
import { installHooks, uninstallHooks } from './hookInstaller';
```

- [ ] **Step 2: Add the consent key constant**

Below the existing `const DISMISSED_KEY = ...` line, add:

```typescript
const CONSENT_KEY = 'claudeTaskTracker.hooksConsent'; // 'granted' | 'declined' | undefined
```

- [ ] **Step 3: Add the helper functions**

Add these module-level functions (e.g. between `DISMISSED_KEY`/`CONSENT_KEY` and `export function activate`):

```typescript
function hookCommand(context: vscode.ExtensionContext): string {
  return `node "${path.join(context.extensionPath, 'dist', 'hook.js')}"`;
}

function runInstall(context: vscode.ExtensionContext): void {
  try {
    const { changed } = installHooks(hookCommand(context));
    if (changed) {
      vscode.window.showInformationMessage('Claude Task Tracker: Claude Code hooks installed.');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showWarningMessage(`Claude Task Tracker: could not update ~/.claude/settings.json (${msg}).`);
  }
}

async function maybeAutoInstallHooks(context: vscode.ExtensionContext): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration('claudeTaskTracker')
    .get<boolean>('autoInstallHooks', true);
  if (!enabled) return;

  const consent = context.globalState.get<string>(CONSENT_KEY);
  if (consent === 'declined') return;
  if (consent === 'granted') {
    runInstall(context);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    'Claude Task Tracker needs to add hooks to ~/.claude/settings.json so it can see your Claude Code sessions. Install them now?',
    'Install',
    'Not now',
    "Don't ask again",
  );
  if (choice === 'Install') {
    await context.globalState.update(CONSENT_KEY, 'granted');
    runInstall(context);
  } else if (choice === "Don't ask again") {
    await context.globalState.update(CONSENT_KEY, 'declined');
  }
  // 'Not now' or dismissed: leave consent undefined so we ask again next session.
}
```

- [ ] **Step 4: Register the commands and kick off auto-install**

Inside `activate()`, add these two command registrations to the existing `context.subscriptions.push(...)` call (alongside the other `registerCommand` lines):

```typescript
    vscode.commands.registerCommand('claudeTaskTracker.installHooks', async () => {
      await context.globalState.update(CONSENT_KEY, 'granted');
      runInstall(context);
    }),
    vscode.commands.registerCommand('claudeTaskTracker.uninstallHooks', () => {
      try {
        uninstallHooks();
        context.globalState.update(CONSENT_KEY, 'declined');
        vscode.window.showInformationMessage('Claude Task Tracker: Claude Code hooks removed.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showWarningMessage(`Claude Task Tracker: could not update ~/.claude/settings.json (${msg}).`);
      }
    }),
```

Then, immediately before the final `store.start();` line at the end of `activate()`, add:

```typescript
  void maybeAutoInstallHooks(context);
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat: auto-install Claude Code hooks on activation with consent + manual commands"
```

---

## Task 6: Manifest — marketplace metadata, settings, commands, scripts, deps, version

Single source of truth for the manifest. This declares the `autoInstallHooks` setting and the two commands registered in Task 5.

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Replace `package.json` with the updated manifest**

```json
{
  "name": "claude-task-tracker",
  "displayName": "Claude Task Tracker",
  "description": "Visualize Claude Code task progress and subagent convergence.",
  "version": "0.3.0",
  "publisher": "chadcoco1444",
  "icon": "media/icon.png",
  "galleryBanner": { "color": "#C25A39", "theme": "dark" },
  "engines": { "vscode": "^1.85.0" },
  "categories": ["AI", "Visualization", "Other"],
  "keywords": ["claude", "claude code", "anthropic", "ai", "agent", "subagent", "task", "todo", "tracker", "progress"],
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/chadcoco1444/claude-task-tracker.git" },
  "bugs": { "url": "https://github.com/chadcoco1444/claude-task-tracker/issues" },
  "homepage": "https://github.com/chadcoco1444/claude-task-tracker#readme",
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "claudeTaskTracker", "title": "Tracker", "icon": "$(checklist)" }
      ]
    },
    "views": {
      "claudeTaskTracker": [
        { "id": "claudeTaskTracker.view", "name": "Tasks & Subagents" },
        { "id": "claudeTaskTracker.dashboard", "name": "Dashboard", "type": "webview" }
      ]
    },
    "commands": [
      { "command": "claudeTaskTracker.refresh", "title": "Tracker: Refresh" },
      { "command": "claudeTaskTracker.focus", "title": "Tracker: Focus" },
      { "command": "claudeTaskTracker.clearInactive", "title": "Tracker: Clear inactive" },
      { "command": "claudeTaskTracker.dismiss", "title": "Tracker: Dismiss", "icon": "$(close)" },
      { "command": "claudeTaskTracker.resetDismissed", "title": "Tracker: Reset dismissed" },
      { "command": "claudeTaskTracker.installHooks", "title": "Tracker: Install Claude Code hooks" },
      { "command": "claudeTaskTracker.uninstallHooks", "title": "Tracker: Remove Claude Code hooks" }
    ],
    "menus": {
      "view/item/context": [
        { "command": "claudeTaskTracker.dismiss", "when": "view == claudeTaskTracker.view && viewItem == feature", "group": "inline" },
        { "command": "claudeTaskTracker.dismiss", "when": "view == claudeTaskTracker.view && viewItem == feature", "group": "9_dismiss" }
      ]
    },
    "configuration": {
      "title": "Claude Task Tracker",
      "properties": {
        "claudeTaskTracker.hideDoneAfterMinutes": {
          "type": "number",
          "default": 30,
          "minimum": 0,
          "description": "Hide a completed feature this many minutes after it finishes (0 = never hide)."
        },
        "claudeTaskTracker.logRetentionDays": {
          "type": "number",
          "default": 14,
          "minimum": 0,
          "description": "Compact the tracker event log on startup, dropping events older than this many days (0 = keep everything)."
        },
        "claudeTaskTracker.autoInstallHooks": {
          "type": "boolean",
          "default": true,
          "description": "On startup, install/repair the Claude Code hooks in ~/.claude/settings.json that feed this extension (asks for consent the first time)."
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "test": "vitest run",
    "install-hooks": "node scripts/install-hooks.js",
    "package": "vsce package --no-dependencies",
    "publish:vsce": "vsce publish --no-dependencies",
    "publish:ovsx": "ovsx publish"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.2.0",
    "esbuild": "^0.20.0",
    "ovsx": "^0.10.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Install the new dev dependencies**

Run: `npm install`
Expected: `@vscode/vsce` and `ovsx` are added under `node_modules`; `package-lock.json` updates; exit 0.

- [ ] **Step 3: Add the `0.3.0` entry to `CHANGELOG.md`**

Insert directly below the `# Changelog` heading (above `## 0.2.1`):

```markdown
## 0.3.0

- **First marketplace release** (VS Code Marketplace + Open VSX).
- **Works out of the box:** the extension now installs/repairs the Claude Code
  hooks in `~/.claude/settings.json` on activation (asks for consent the first
  time; toggle with `claudeTaskTracker.autoInstallHooks`). Commands
  `Tracker: Install Claude Code hooks` / `Tracker: Remove Claude Code hooks`
  give manual control. The hook path self-heals across extension updates.
- Added extension icon, license, and marketplace metadata.
```

- [ ] **Step 4: Verify the manifest is valid JSON and tests still pass**

Run: `node -e "require('./package.json')" && npm test`
Expected: no JSON error; full suite passes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: marketplace manifest metadata, autoInstallHooks setting, vsce/ovsx deps, v0.3.0"
```

---

## Task 7: LICENSE file

vsce warns (and Open VSX expects) a license. `package.json` already declares `"license": "MIT"`.

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 chadcoco1444

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> If you prefer your legal name over the `chadcoco1444` handle, change the copyright line.

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT LICENSE"
```

---

## Task 8: Icon assets (svg source + 128×128 png)

The marketplace `icon` field requires a non-SVG raster (PNG). We keep the SVG source and render a 128×128 PNG from it.

**Files:**
- Create: `media/icon.svg`
- Create: `media/icon.png`

- [ ] **Step 1: Create `media/icon.svg`** (the approved V1 rocket — white rocket on a coral gradient)

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E59072"/>
      <stop offset="1" stop-color="#C25A39"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="28" fill="url(#bg)"/>
  <path d="M64 26 C74 38 78 54 78 70 L78 74 L50 74 L50 70 C50 54 54 38 64 26 Z" fill="#fff"/>
  <circle cx="64" cy="52" r="8" fill="#C25A39"/>
  <path d="M50 66 L39 84 L50 78 Z" fill="#7A2E16"/>
  <path d="M78 66 L89 84 L78 78 Z" fill="#7A2E16"/>
  <path d="M56 74 L64 98 L72 74 Z" fill="#FFD36B"/>
  <circle cx="64" cy="107" r="3" fill="#fff" opacity="0.85"/>
  <circle cx="64" cy="116" r="2" fill="#fff" opacity="0.5"/>
</svg>
```

- [ ] **Step 2: Render `media/icon.png` at exactly 128×128**

Primary method (Playwright is available in this environment): open `media/icon.svg` in a headless browser sized to a 128×128 viewport and screenshot it to `media/icon.png` (the SVG already declares 128×128, so no scaling math is needed).

Fallback if no headless browser is available: `npx --yes svgexport media/icon.svg media/icon.png 128:128`.

- [ ] **Step 3: Verify the PNG dimensions**

Run: `node -e "const b=require('fs').readFileSync('media/icon.png'); console.log(b.readUInt32BE(16), b.readUInt32BE(20))"`
Expected: `128 128`

- [ ] **Step 4: Commit**

```bash
git add media/icon.svg media/icon.png
git commit -m "feat: add marketplace icon (coral rocket, 128x128)"
```

---

## Task 9: `.vscodeignore` — keep the package clean

**Files:**
- Modify: `.vscodeignore`

- [ ] **Step 1: Replace the file contents**

```
.superpowers/
docs/
src/
test/
scripts/
.github/
node_modules/
esbuild.js
tsconfig.json
vitest.config.ts
package-lock.json
*.vsix
.vscode-test/
**/*.map
media/icon.svg
```

> `media/icon.png` is intentionally NOT ignored — it ships. `media/icon.svg` is ignored (source only).

- [ ] **Step 2: Commit**

```bash
git add .vscodeignore
git commit -m "chore: exclude dev-only files from the published package"
```

---

## Task 10: README + publishing runbook

**Files:**
- Modify: `README.md`
- Create: `docs/PUBLISHING.md`

- [ ] **Step 1: Add an Install section to `README.md`**

Insert immediately after the opening paragraph (after the line ending "...grouped by repo and git worktree.") and before `## Views`:

```markdown

## Install

Install **Claude Task Tracker** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chadcoco1444.claude-task-tracker)
or from [Open VSX](https://open-vsx.org/extension/chadcoco1444/claude-task-tracker)
(Cursor / Windsurf / VSCodium).

**Requirements:** [Claude Code](https://www.anthropic.com/claude-code) and Node.js
on your `PATH`.

The first time it activates, the extension asks to add hooks to
`~/.claude/settings.json` so it can see your Claude Code sessions. Choose
**Install** to enable tracking. You can change this anytime with the
`claudeTaskTracker.autoInstallHooks` setting or the
**Tracker: Install / Remove Claude Code hooks** commands.

## Screenshots

<!-- TODO(maintainer): replace with a real capture of the Tracker panel + Dashboard.
     Save it to media/screenshot.png and reference it here:
     ![Claude Task Tracker](media/screenshot.png) -->
_Screenshot coming soon._
```

> The Screenshots block is a clearly-marked maintainer placeholder, not a fake UI image. Replace it with a real capture before (or shortly after) first publish.

- [ ] **Step 2: Convert the dev section to a Development heading**

In `README.md`, change the heading `## Install & run (development)` to:

```markdown
## Development
```

Leave the build/`F5` instructions under it unchanged.

- [ ] **Step 3: Create `docs/PUBLISHING.md`**

```markdown
# Publishing

Releases go out via GitHub Actions on a version tag. This is the one-time
account setup and the per-release flow.

## One-time setup

### VS Code Marketplace
1. Create an Azure DevOps organization at <https://dev.azure.com> (if you don't have one).
2. Create the publisher `chadcoco1444` at
   <https://marketplace.visualstudio.com/manage/createpublisher>. The Publisher ID
   MUST equal the `publisher` field in `package.json`.
3. In Azure DevOps → User settings → Personal Access Tokens, create a PAT with
   scope **Marketplace → Manage** and organization **All accessible organizations**.
4. Add it as a GitHub repo secret named `VSCE_PAT`
   (Settings → Secrets and variables → Actions).

### Open VSX
1. Sign in at <https://open-vsx.org> with GitHub.
2. Sign the Eclipse Foundation Publisher Agreement (Profile → "Publisher Agreement").
3. Create the namespace: `npx ovsx create-namespace chadcoco1444 -p <your-token>`.
4. Generate an access token (open-vsx.org → Settings → Access Tokens) and add it
   as a GitHub repo secret named `OVSX_TOKEN`.

## Cutting a release
1. Bump `version` in `package.json` and add a matching `CHANGELOG.md` entry.
2. Commit, then tag and push:
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```
3. The **Release** workflow builds, tests, packages, publishes to both
   marketplaces, and attaches the `.vsix` to the GitHub Release.

## First-release validation (optional)
Before relying on CI, publish once locally to confirm your tokens work:
```bash
npm run build
npx vsce package --no-dependencies
npx vsce publish --no-dependencies -p <VSCE_PAT>
npx ovsx publish *.vsix -p <OVSX_TOKEN>
```
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/PUBLISHING.md
git commit -m "docs: add end-user Install section and publishing runbook"
```

---

## Task 11: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npx vsce package --no-dependencies
```

- [ ] **Step 2: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npx vsce package --no-dependencies -o claude-task-tracker.vsix
      - name: Publish to VS Code Marketplace
        run: npx vsce publish --no-dependencies --packagePath claude-task-tracker.vsix -p ${{ secrets.VSCE_PAT }}
      - name: Publish to Open VSX
        run: npx ovsx publish claude-task-tracker.vsix -p ${{ secrets.OVSX_TOKEN }}
      - name: Attach VSIX to the GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: claude-task-tracker.vsix
```

- [ ] **Step 3: Lint the YAML locally (optional sanity check)**

Run: `node -e "const fs=require('fs');for(const f of ['.github/workflows/ci.yml','.github/workflows/release.yml']){fs.accessSync(f);}console.log('ok')"`
Expected: `ok` (confirms both files exist; GitHub validates the YAML on push).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: add PR build check and tag-triggered dual-marketplace release"
```

---

## Task 12: Package and verify the VSIX (no publishing)

Produce the `.vsix` and confirm its contents are clean and the extension works end-to-end. **No `publish` runs here** — that happens via CI on a tag, or manually by the maintainer.

**Files:** none (verification only).

- [ ] **Step 1: Build and package**

Run: `npm run build && npx vsce package --no-dependencies`
Expected: produces `claude-task-tracker-0.3.0.vsix`; no error about missing `publisher`, `icon`, `repository`, or `LICENSE`.

- [ ] **Step 2: Inspect package contents**

Run: `npx vsce ls`
Expected: lists `dist/extension.js`, `dist/hook.js`, `dist/hookInstaller.js`, `media/icon.png`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`.
Expected NOT present: anything under `src/`, `test/`, `docs/`, `node_modules/`, `.github/`, `.superpowers/`, and no `media/icon.svg` or `*.map`.

- [ ] **Step 3: Smoke-test the install (recommended)**

Run: `code --install-extension claude-task-tracker-0.3.0.vsix`
Then reload VS Code and verify:
- A consent prompt appears: "Claude Task Tracker needs to add hooks…".
- Choosing **Install** adds six tracker entries to `~/.claude/settings.json`, each pointing at the installed extension's `dist/hook.js`.
- Running a Claude Code session makes the **Tracker** panel and Dashboard populate.
- Running **Tracker: Remove Claude Code hooks** removes those six entries and leaves any other hooks intact.

- [ ] **Step 4: Final verification of the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: (No commit needed unless Step 3 surfaced fixes.)**

The `.vsix` is git-ignored (`*.vsix`). If verification surfaced changes, commit them with a descriptive message.

---

## Done criteria

- `npm test` and `npx tsc --noEmit` are green.
- `npx vsce package` produces a clean `claude-task-tracker-0.3.0.vsix` (verified via `vsce ls`).
- Installing the `.vsix` prompts for consent and, on accept, wires up hooks so the tracker populates from a live Claude Code session.
- Branch `feat/marketplace-publish` holds all commits, ready for a PR to `master`.
- After merge + one-time account setup (per `docs/PUBLISHING.md`), pushing tag `v0.3.0` publishes to both marketplaces.
