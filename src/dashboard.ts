import * as vscode from 'vscode';
import { State, ViewOptions } from './types';
import { buildGroups, FeatureView } from './viewModel';
import { TrackerStore } from './store';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

const PILL: Record<string, string> = { done: 'done', active: 'running', idle: 'idle', ended: 'ended' };
const COLOR: Record<string, string> = {
  done: 'var(--vscode-charts-green)',
  active: 'var(--vscode-charts-blue)',
  idle: 'var(--vscode-disabledForeground)',
  ended: 'var(--vscode-disabledForeground)',
};

function card(fv: FeatureView): string {
  const pct = fv.total > 0 ? Math.round((fv.done / fv.total) * 100) : 0;
  const color = COLOR[fv.status];
  return `
    <div class="card" data-session="${esc(fv.session)}" title="Right-click to dismiss">
      <span class="dot" style="background:${color}"></span>
      <span class="nm">${esc(fv.label)}</span>
      <span class="pill" style="color:${color}">${PILL[fv.status]}</span>
      <span class="bar"><i style="width:${pct}%;background:${color}"></i></span>
      <span class="cnt">${fv.done}/${fv.total} · ${pct}%</span>
    </div>`;
}

export function renderDashboardHtml(state: State, options: ViewOptions, nonce = 'static-nonce'): string {
  const groups = buildGroups(state, options);
  const body = groups.length === 0
    ? '<p class="empty">No active sessions.</p>'
    : groups.map((rg) => `
        <h3>${esc(rg.isCurrentWindow ? `${rg.label} (this window)` : rg.label)}</h3>
        ${rg.features.map(card).join('')}
        ${rg.worktrees.map((wt) => `
          <h4>${esc(wt.name)}</h4>
          ${wt.features.map(card).join('')}
        `).join('')}
      `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 6px 8px; font-size: 12px; }
    h3 { font-size: 11px; text-transform: uppercase; opacity: .7; margin: 12px 0 4px; }
    h4 { font-size: 10px; text-transform: uppercase; opacity: .55; margin: 6px 0 2px 12px; }
    .card { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: default; }
    .card.dismissing { opacity: .35; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill { font-size: 10px; }
    .bar { flex: 1; max-width: 120px; height: 6px; border-radius: 3px; background: var(--vscode-editorWidget-background); overflow: hidden; }
    .bar > i { display: block; height: 100%; }
    .cnt { opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .empty { opacity: .6; }
  </style></head><body>${body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.card');
      if (!card) { return; }
      e.preventDefault();
      const session = card.getAttribute('data-session');
      if (session) {
        card.classList.add('dismissing');
        vscode.postMessage({ type: 'dismiss', session });
      }
    });
  </script>
  </body></html>`;
}

export class DashboardProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private store: TrackerStore,
    private getOptions: () => ViewOptions,
    private onDismiss: (session: string) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'dismiss' && typeof msg.session === 'string') {
        this.onDismiss(msg.session);
      }
    });
    this.refresh();
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = renderDashboardHtml(this.store.state, this.getOptions(), makeNonce());
    }
  }
}
