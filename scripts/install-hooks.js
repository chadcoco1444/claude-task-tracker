const fs = require('fs');
const path = require('path');

const distHook = path.resolve(__dirname, '..', 'dist', 'hook.js');
const distInstaller = path.resolve(__dirname, '..', 'dist', 'hookInstaller.js');

for (const f of [distHook, distInstaller]) {
  if (!fs.existsSync(f)) {
    console.error(`${path.relative(process.cwd(), f)} not found. Run "npm run build" first.`);
    process.exit(1);
  }
}

const { installHooks } = require(distInstaller);

try {
  const { changed } = installHooks(`node "${distHook}"`);
  console.log(changed ? 'Installed Claude Task Tracker hooks.' : 'Hooks already up to date.');
} catch (e) {
  console.error('Could not update ~/.claude/settings.json:', e.message);
  process.exit(1);
}
