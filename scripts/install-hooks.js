const fs = require('fs');
const os = require('os');
const path = require('path');

const distHook = path.resolve(__dirname, '..', 'dist', 'hook.js');
if (!fs.existsSync(distHook)) {
  console.error('dist/hook.js not found. Run "npm run build" first.');
  process.exit(1);
}
const command = `node "${distHook}"`;

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error('Could not parse', settingsPath, '- aborting to avoid clobbering it.');
    process.exit(1);
  }
}
settings.hooks = settings.hooks || {};

// Recognise a hook entry installed by THIS tool by its `dist/hook.js` command,
// regardless of which directory it lived in. This lets a re-install clean up a
// stale path left behind after the repo is renamed/moved (the bug that silently
// killed event capture) instead of skipping or duplicating it.
function isOurEntry(entry) {
  return (
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some(
      (h) => typeof h.command === 'string' && /dist[\\/]+hook\.js/.test(h.command)
    )
  );
}

function ensure(eventName, matcher) {
  // Drop any previous tracker entry (current or stale path), then add a fresh
  // one pointing at this checkout — making the installer idempotent and able to
  // self-heal after a move.
  const arr = (settings.hooks[eventName] || []).filter((e) => !isOurEntry(e));
  const entry = { hooks: [{ type: 'command', command }] };
  if (matcher) {
    entry.matcher = matcher;
  }
  arr.push(entry);
  settings.hooks[eventName] = arr;
}

ensure('SessionStart');
ensure('PostToolUse', 'TodoWrite|Write|Edit|MultiEdit');
ensure('PreToolUse', 'Task');
ensure('SubagentStop');
ensure('Stop');
ensure('SessionEnd');

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Installed Claude Task Tracker hooks into', settingsPath);
