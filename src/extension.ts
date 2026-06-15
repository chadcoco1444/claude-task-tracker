import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { TrackerTreeProvider } from './treeProvider';
import { createStatusBar } from './statusBar';
import { eventLogPath } from './paths';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TrackerStore(eventLogPath());
  const tree = new TrackerTreeProvider(store);

  const view = vscode.window.createTreeView('claudeTaskTracker.view', {
    treeDataProvider: tree,
  });
  const statusBar = createStatusBar(store);

  context.subscriptions.push(
    view,
    statusBar,
    vscode.commands.registerCommand('claudeTaskTracker.focus', () => {
      vscode.commands.executeCommand('claudeTaskTracker.view.focus');
    }),
    vscode.commands.registerCommand('claudeTaskTracker.refresh', () => store.recompute()),
    { dispose: () => store.dispose() },
  );

  store.start();
}

export function deactivate(): void {}
