import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { summarize } from './statusBarText';

export function createStatusBar(store: TrackerStore): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'claudeTaskTracker.focus';
  const render = () => {
    const text = summarize(store.state);
    if (text) {
      item.text = text;
      item.tooltip = 'Claude Task Tracker — click to focus';
      item.show();
    } else {
      item.hide();
    }
  };
  store.onChange(render);
  render();
  return item;
}
