# Claude Task Tracker

A VSCode extension that visualizes Claude Code task progress and subagent
convergence across the superpowers brainstorm → spec → plan → execute flow.

## How it works

Claude Code hooks append JSON events to `~/.claude/tracker/events.jsonl`.
The extension watches that file, reduces the events into state, and shows:

- a sidebar TreeView: **Feature → Task → Subagent**, with live status icons;
- a bottom status-bar summary of the most recently active feature.

## Install & run (development)

```bash
npm install
npm run build
npm run install-hooks   # adds hook entries to ~/.claude/settings.json
```

Then press `F5` in VSCode to launch the Extension Development Host.

Hooks captured: `SessionStart`, `PostToolUse`(TodoWrite), `PreToolUse`(Task),
`SubagentStop`, `Stop`.

## Status semantics

- **Task** progress comes from Claude Code's live TodoWrite list; before any
  todos exist, the plan's `### Task N:` headings are shown as "planned".
- A **subagent** is `running` until a `SubagentStop` event converges it.
  Convergence is attributed FIFO within a session (the MVP approximation; see
  the design doc).
