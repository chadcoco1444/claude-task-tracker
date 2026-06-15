const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

async function run() {
  const ext = await esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    format: 'cjs',
    external: ['vscode'],
  });
  const hook = await esbuild.context({
    ...common,
    entryPoints: ['src/hook/cli.ts'],
    outfile: 'dist/hook.js',
    format: 'cjs',
  });
  if (watch) {
    await ext.watch();
    await hook.watch();
  } else {
    await ext.rebuild();
    await hook.rebuild();
    await ext.dispose();
    await hook.dispose();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
