import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { DashboardProvider } from './dashboard';
import { eventLogPath } from './paths';
import { ViewOptions } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TrackerStore(eventLogPath());
  const dismissed = new Set<string>();

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
      refreshAll();
    }),
    { dispose: () => { clearInterval(timer); store.dispose(); } },
  );

  store.onChange(refreshAll);
  store.start();
}

export function deactivate(): void {}
