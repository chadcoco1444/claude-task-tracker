# Tracker UI v2.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make dismissal persistent (globalState) and add per-feature dismiss (right-click + hover ✕), plus a reset escape hatch and auto-cleanup of stale ids.

**Architecture:** One pure change (`TreeNode.session`), the rest is VSCode glue (package.json menus/commands, treeProvider contextValue, extension.ts globalState wiring).

**Spec:** `docs/superpowers/specs/2026-06-15-tracker-ui-v2.2-design.md`

---

## Task 1: Carry `session` on feature tree nodes

**Files:** Modify `src/types.ts`, `src/treeModel.ts`; Modify `test/treeModel.test.ts`.

- [ ] **Step 1 (test → red):** In `test/treeModel.test.ts`, in the first test (`'nests group -> feature -> task/subagent ...'`), after `expect(feature.kind).toBe('feature');` add:
```ts
    expect(feature.session).toBe('s1');
```

- [ ] **Step 2:** Run `npx vitest run treeModel` — expect FAIL (`feature.session` is undefined).

- [ ] **Step 3:** In `src/types.ts`, add `session?: string;` to the `TreeNode` interface (after `resourcePath?`):
```ts
export interface TreeNode {
  kind: 'group' | 'feature' | 'task' | 'subagent';
  label: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  children?: TreeNode[];
  resourcePath?: string;
  session?: string;
}
```

- [ ] **Step 4:** In `src/treeModel.ts`, in `featureNode`, add `session: fv.session,` to the returned object (e.g. right after `kind: 'feature',`):
```ts
function featureNode(fv: FeatureView): TreeNode {
  const v = featureIcon(fv.status);
  return {
    kind: 'feature',
    session: fv.session,
    label: fv.label,
    description: `${progressBar(fv.done, fv.total)} ${fv.done}/${fv.total}`,
    icon: v.icon,
    iconColor: v.iconColor,
    resourcePath: fv.feature.planPath ?? undefined,
    children: [...taskNodes(fv.feature), ...subagentNodes(fv.feature)],
  };
}
```

- [ ] **Step 5:** Run `npx vitest run treeModel` — PASS. Then `npx vitest run` (full) — all green. `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit:**
```bash
git add src/types.ts src/treeModel.ts test/treeModel.test.ts
git commit -m "feat: carry session id on feature tree nodes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Commands + menus + contextValue (glue)

**Files:** Modify `package.json`, `src/treeProvider.ts`.

- [ ] **Step 1:** In `package.json`, replace the `contributes.commands` array and add a `menus` block immediately after it (keep `configuration` after `menus`):
```json
    "commands": [
      { "command": "claudeTaskTracker.refresh", "title": "Tracker: Refresh" },
      { "command": "claudeTaskTracker.focus", "title": "Tracker: Focus" },
      { "command": "claudeTaskTracker.clearInactive", "title": "Tracker: Clear inactive" },
      { "command": "claudeTaskTracker.dismiss", "title": "Tracker: Dismiss", "icon": "$(close)" },
      { "command": "claudeTaskTracker.resetDismissed", "title": "Tracker: Reset dismissed" }
    ],
    "menus": {
      "view/item/context": [
        { "command": "claudeTaskTracker.dismiss", "when": "view == claudeTaskTracker.view && viewItem == feature", "group": "inline" },
        { "command": "claudeTaskTracker.dismiss", "when": "view == claudeTaskTracker.view && viewItem == feature", "group": "9_dismiss" }
      ]
    },
```

- [ ] **Step 2:** In `src/treeProvider.ts`, in `getTreeItem`, set the context value so menus can target feature rows. After `const item = new vscode.TreeItem(node.label, collapsible);` add:
```ts
    item.contextValue = node.kind;
```

- [ ] **Step 3: Verify.**
  - `node -e "const p=require('./package.json'); const c=p.contributes.commands.map(x=>x.command); const m=p.contributes.menus['view/item/context'].length; if(!c.includes('claudeTaskTracker.dismiss')||!c.includes('claudeTaskTracker.resetDismissed')) throw new Error('cmd missing'); console.log('cmds',c.length,'menu',m)"` → `cmds 5 menu 2`
  - `npx tsc --noEmit` — expect ONE error in `src/extension.ts` only? No: treeProvider change adds no error. Expect ZERO errors (extension.ts doesn't reference the new commands yet — they're only contributed in package.json, which tsc ignores). Confirm zero errors.
  - `npx vitest run` — all green.

- [ ] **Step 4: Commit:**
```bash
git add package.json src/treeProvider.ts
git commit -m "feat: contribute dismiss/reset commands, context+inline menus, node contextValue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Persist dismissed + wire dismiss/reset/prune (glue)

**Files:** Modify `src/extension.ts`.

- [ ] **Step 1:** Replace the ENTIRE contents of `src/extension.ts` with:
```ts
import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { DashboardProvider } from './dashboard';
import { eventLogPath } from './paths';
import { TreeNode, ViewOptions } from './types';

const DISMISSED_KEY = 'claudeTaskTracker.dismissed';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TrackerStore(eventLogPath());
  const dismissed = new Set<string>(context.globalState.get<string[]>(DISMISSED_KEY, []));
  const persistDismissed = () => context.globalState.update(DISMISSED_KEY, [...dismissed]);

  const getOptions = (): ViewOptions => ({
    now: Date.now(),
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    hideDoneAfterMinutes: vscode.workspace
      .getConfiguration('claudeTaskTracker')
      .get<number>('hideDoneAfterMinutes', 30),
    dismissed,
  });

  const tree = new TrackerTreeProvider(store, getOptions);
  const dashboard = new DashboardProvider(store, getOptions);
  const statusBar = createStatusBar(store, getOptions);

  const refreshAll = () => {
    tree.refresh();
    dashboard.refresh();
    statusBar.refresh();
  };

  // Drop dismissed ids whose session no longer exists in the log (e.g. log pruned),
  // keeping the set bounded and auto-un-dismissing removed sessions.
  const pruneDismissed = () => {
    const live = new Set(store.state.features.map((f) => f.session));
    let changed = false;
    for (const id of dismissed) {
      if (!live.has(id)) {
        dismissed.delete(id);
        changed = true;
      }
    }
    if (changed) {
      persistDismissed();
    }
  };

  const view = vscode.window.createTreeView('claudeTaskTracker.view', { treeDataProvider: tree });
  const timer = setInterval(refreshAll, 60_000); // advance relative times / auto-hide

  context.subscriptions.push(
    view,
    statusBar.item,
    vscode.window.registerWebviewViewProvider('claudeTaskTracker.dashboard', dashboard),
    vscode.commands.registerCommand('claudeTaskTracker.focus', () => {
      vscode.commands.executeCommand('claudeTaskTracker.view.focus');
    }),
    vscode.commands.registerCommand('claudeTaskTracker.refresh', refreshAll),
    vscode.commands.registerCommand('claudeTaskTracker.clearInactive', () => {
      for (const f of store.state.features) {
        if (f.status !== 'active') {
          dismissed.add(f.session);
        }
      }
      persistDismissed();
      refreshAll();
    }),
    vscode.commands.registerCommand('claudeTaskTracker.dismiss', (node?: TreeNode) => {
      if (node && node.kind === 'feature' && node.session) {
        dismissed.add(node.session);
        persistDismissed();
        refreshAll();
      }
    }),
    vscode.commands.registerCommand('claudeTaskTracker.resetDismissed', () => {
      dismissed.clear();
      persistDismissed();
      refreshAll();
    }),
    { dispose: () => { clearInterval(timer); store.dispose(); } },
  );

  store.onChange(() => {
    pruneDismissed();
    refreshAll();
  });
  store.start();
}

export function deactivate(): void {}
```

- [ ] **Step 2:** `npx tsc --noEmit` — ZERO errors.
- [ ] **Step 3:** `npx vitest run` — all green.
- [ ] **Step 4:** `npm run build` — dist/extension.js + dist/hook.js, no errors (`ls -la dist/`).
- [ ] **Step 5: Commit:**
```bash
git add src/extension.ts
git commit -m "feat: persist dismissed in globalState; add per-item dismiss, reset, and stale prune

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Build & package

- [ ] `npx tsc --noEmit` (zero), `npx vitest run` (report count), `npm run build`, then `npx --yes @vscode/vsce package`.
- [ ] **Manual (human):** install vsix + reload. Right-click / hover-✕ a feature → gone, stays gone after reload. `Tracker: Reset dismissed` → reappears. Prune a session from `events.jsonl` → its dismissed entry auto-clears.

---

## Self-Review

- **Spec coverage:** persist→globalState (Task 3) · per-item dismiss command+menus+session (Tasks 1,2,3) · reset (Tasks 2,3) · prune-stale (Task 3).
- **Type consistency:** `TreeNode.session?` defined (Task 1), set in treeModel (Task 1), read in extension `dismiss` handler (Task 3); command ids `dismiss`/`resetDismissed` match package.json (Task 2) ↔ extension.ts (Task 3); `contextValue = node.kind` ↔ `viewItem == feature`.
- **No placeholders:** full code in every step.
