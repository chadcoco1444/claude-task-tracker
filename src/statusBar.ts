import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { summarize } from './statusBarText';
import { ViewOptions } from './types';

export interface StatusBar {
  item: vscode.StatusBarItem;
  refresh(): void;
}

export function createStatusBar(store: TrackerStore, getOptions: () => ViewOptions): StatusBar {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'claudeTaskTracker.focus';
  const refresh = () => {
    const o = getOptions();
    const text = summarize(store.state, { now: o.now, workspaceFolders: o.workspaceFolders });
    if (text) {
      item.text = text;
      item.tooltip = 'Claude Task Tracker — click to focus';
      item.show();
    } else {
      item.hide();
    }
  };
  refresh();
  return { item, refresh };
}
