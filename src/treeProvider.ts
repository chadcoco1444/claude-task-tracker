import * as vscode from 'vscode';
import { TrackerStore } from './store';
import { buildTree, TreeNode } from './treeModel';

export class TrackerTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private store: TrackerStore) {
    store.onChange(() => this.changeEmitter.fire());
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsible = node.children && node.children.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.kind === 'feature' && node.resourcePath) {
      item.command = {
        command: 'vscode.open',
        title: 'Open plan',
        arguments: [vscode.Uri.file(node.resourcePath)],
      };
    }
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return buildTree(this.store.state);
    }
    return node.children ?? [];
  }
}
