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

function ensure(eventName, matcher) {
  const arr = (settings.hooks[eventName] = settings.hooks[eventName] || []);
  const alreadyInstalled = JSON.stringify(arr).includes(distHook.replace(/\\/g, '\\\\'));
  if (alreadyInstalled) {
    return;
  }
  const entry = { hooks: [{ type: 'command', command }] };
  if (matcher) {
    entry.matcher = matcher;
  }
  arr.push(entry);
}

ensure('SessionStart');
ensure('PostToolUse', 'TodoWrite');
ensure('PreToolUse', 'Task');
ensure('SubagentStop');
ensure('Stop');

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Installed Claude Task Tracker hooks into', settingsPath);
