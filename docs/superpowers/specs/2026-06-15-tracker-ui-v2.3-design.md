# Tracker UI v2.3 — Nest worktrees under their repo

- **Date:** 2026-06-15
- **Status:** Approved, ready for plan
- **Builds on:** `2026-06-15-tracker-ui-v2.2-design.md`

## Problem

A git worktree lives at `<repo>/.worktrees/<name>`, so its `cwd` basename is the worktree name. `groupOf` keys groups by basename, so every worktree becomes its own **top-level** group (`sc-declutter`, `sc-relayout`) detached from the parent repo (`TradeMatrix`). The tree should instead nest worktrees under their repo: `TradeMatrix ▸ sc-declutter ▸ feature`.

## Design

### 1. `locate(cwd, workspaceFolders)` (replaces `groupOf`)

```ts
export interface Location {
  repoKey: string;        // bucket key for the top-level repo group (lowercased)
  repoLabel: string;      // display name, original case (e.g. "TradeMatrix")
  worktree: string | null;// worktree name, original case, or null for the main repo
  isCurrentWindow: boolean;
}
```

- No cwd → `{ repoKey:'', repoLabel:'Unknown (no cwd)', worktree:null, isCurrentWindow:false }`.
- `isCurrentWindow` = cwd equals or is inside any open `workspaceFolders` (normalized, case-insensitive) — same test as before.
- If the (slash-normalized, original-case) cwd matches `^(.*)/\.worktrees/([^/]+)(?:/.*)?$` (case-insensitive on `.worktrees`): `repoKey = lower(group1)`, `repoLabel = basename(group1)`, `worktree = group2`.
- Otherwise: `repoKey = lower(cwd)`, `repoLabel = basename(cwd)`, `worktree = null`.

`basename` operates on the original-case path so labels keep their case. `groupOf` and the `Group` interface are removed (only `locate` remains).

### 2. Nested model in `buildGroups`

```ts
export interface WorktreeView { name: string; features: FeatureView[]; }
export interface RepoGroup {
  key: string;
  label: string;
  isCurrentWindow: boolean;
  features: FeatureView[];     // direct (main-repo) features
  worktrees: WorktreeView[];
}
export function buildGroups(state, o): RepoGroup[]
```

- Visible features (per `isVisible`, unchanged — active always shown) are bucketed by `locate().repoKey`.
- `worktree === null` → `RepoGroup.features`; else → the matching `WorktreeView` under that repo.
- A repo group is `isCurrentWindow` if any of its features is.
- Only repos/worktrees that receive a visible feature are created → no empty groups.
- **Sorting:** repo groups: current-window first, `Unknown` (`key===''`) last, else by most-recent activity across all their features. Within a repo: direct `features` first, then `worktrees` (by most-recent activity). Each feature list sorted by `lastTs` desc.
- **Disambiguation:** `disambiguate` runs per feature list (direct list, and each worktree list) — same shortId-on-collision rule.

### 3. Tree (`treeModel.buildTree`)

Each `RepoGroup` → a `group` node (`icon: 'folder'`, `(this window)` suffix when current). Its children are the direct feature nodes followed by one `group` node per worktree (`icon: 'git-branch'` to distinguish, `label: worktree.name`) whose children are that worktree's feature nodes. `featureNode` is unchanged. `treeProvider` needs no change (it already renders any node with children as an expandable group).

```
▾ TradeMatrix
   🚀 Strategy Center …       ▰▰▱▱ 2/4
   ▾ sc-declutter            (git-branch icon)
      🚀 Topbar 跑馬燈 …       ▰▰▰▱ 3/4
```

### 4. Dashboard (`renderDashboardHtml`)

Mirror the nesting: repo `<h3>` (with `(this window)`), then direct feature cards, then per worktree an indented `<h4>` sub-header + its cards. New `h4` style. `card`, `esc`, colors unchanged.

### 5. Status bar (`statusBarText.summarize`)

Replace `groupOf(f.cwd, …).isCurrentWindow` with `locate(f.cwd, …).isCurrentWindow`. Behavior unchanged (a worktree opened as the window's folder still counts as current-window).

## Affected files

- `src/viewModel.ts` — add `locate`/`Location`; rewrite `buildGroups` to `RepoGroup[]` (+ `WorktreeView`/`RepoGroup`); remove `groupOf`/`Group`.
- `src/treeModel.ts` — `buildTree` emits repo→worktree→feature nesting.
- `src/dashboard.ts` — `renderDashboardHtml` mirrors the nesting (h3/h4).
- `src/statusBarText.ts` — use `locate` instead of `groupOf`.
- Tests for all four.
- **Unchanged:** `treeProvider.ts`, `extension.ts`, `package.json`, `types.ts`.

## Testing

- `locate`: worktree path → repo/worktree split + original-case label; normal repo → worktree null; no cwd → Unknown; isCurrentWindow for cwd inside an open folder (incl. a worktree folder).
- `buildGroups`: features split into direct vs worktree subgroups under one repo; sorting (current-window first, Unknown last; direct before worktrees); disambiguation within each list; active-but-dismissed still present.
- `buildTree`: repo group → direct feature + worktree subgroup (git-branch icon) → feature; non-worktree repos still render flat; `feature.session` still present.
- `renderDashboardHtml`: worktree produces an `<h4>` sub-header and its card; non-worktree unchanged; labels escaped.
- `summarize`: unchanged behavior via `locate`.

## Non-goals

- Only `.worktrees/<name>` nesting (no monorepo/sub-package detection).
- No change to dismiss, auto-hide, status-bar format, or the event schema.
