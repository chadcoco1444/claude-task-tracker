import * as vscode from 'vscode';
import * as path from 'path';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { DashboardProvider } from './dashboard';
import { eventLogPath } from './paths';
import { TreeNode, ViewOptions } from './types';
import { installHooks, uninstallHooks } from './hookInstaller';

const DISMISSED_KEY = 'claudeTaskTracker.dismissed';
const CONSENT_KEY = 'claudeTaskTracker.hooksConsent'; // 'granted' | 'declined' | undefined

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

export function activate(context: vscode.ExtensionContext): void {
  const store = new TrackerStore(eventLogPath(), () =>
    vscode.workspace.getConfiguration('claudeTaskTracker').get<number>('logRetentionDays', 14),
  );
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
    { dispose: () => { clearInterval(timer); store.dispose(); } },
  );

  store.onChange(() => {
    pruneDismissed();
    refreshAll();
  });
  void maybeAutoInstallHooks(context);
  store.start();
}

export function deactivate(): void {}
