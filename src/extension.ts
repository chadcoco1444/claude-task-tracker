import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { DashboardProvider } from './dashboard';
import { eventLogPath } from './paths';
import { TreeNode, ViewOptions } from './types';

const DISMISSED_KEY = 'claudeTaskTracker.dismissed';

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
    { dispose: () => { clearInterval(timer); store.dispose(); } },
  );

  store.onChange(() => {
    pruneDismissed();
    refreshAll();
  });
  store.start();
}

export function deactivate(): void {}
