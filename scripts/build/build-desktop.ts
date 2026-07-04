import { copyDirectory, pathExists, removePath, resolveProjectPath, run, runBin, runNpmScript } from './build-utics.ts';

const shouldSkipRust = process.argv.includes('--skip-rust');
const shouldSkipPyWorker = process.argv.includes('--skip-py-worker');

async function copyDesktopAssets() {
  const assetCopies = [
    {
      source: resolveProjectPath('resources', 'desktop'),
      target: resolveProjectPath('dist-electron', 'resources'),
    },
    {
      source: resolveProjectPath('assets', 'desktop'),
      target: resolveProjectPath('dist-electron', 'assets'),
    },
  ];

  let copiedAnyAsset = false;
  for (const assetCopy of assetCopies) {
    copiedAnyAsset = (await copyDirectory(assetCopy.source, assetCopy.target)) || copiedAnyAsset;
  }

  if (!copiedAnyAsset) {
    console.log('[build:desktop] no desktop asset directories found; skipping asset copy');
  }
}

await removePath(resolveProjectPath('dist-electron'));
await runBin('tsc', ['-p', 'tsconfig.build.json', '--noEmit']);
await runBin('vite', ['build', '--mode', 'desktop']);
await runBin('tsc', ['-p', 'tsconfig.electron.json', '--noEmit']);
await run('node', [resolveProjectPath('scripts', 'build-electron.mjs')]);

if (!shouldSkipRust) {
  await runNpmScript('build:rust');
}

if (!shouldSkipPyWorker) {
  await runNpmScript('build:py-worker');
}

await copyDesktopAssets();

if (pathExists(resolveProjectPath('dist-electron', 'code', 'electron-main', 'main.js'))) {
  console.log('[build:desktop] desktop build complete');
} else {
  throw new Error('Desktop build did not produce dist-electron/code/electron-main/main.js');
}
