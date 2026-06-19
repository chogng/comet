import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptsMarker = `${path.sep}scripts${path.sep}`;
const scriptsMarkerIndex = scriptFilePath.lastIndexOf(scriptsMarker);
const rootDir =
  scriptsMarkerIndex >= 0
    ? scriptFilePath.slice(0, scriptsMarkerIndex)
    : path.dirname(scriptFilePath);
const outputDir = path.join(rootDir, '.tmp', 'workbench-browser-tests');
const entryPoints = [
  path.join(rootDir, 'src', 'ls', 'workbench', 'browser', 'tests', 'splitview.test.ts'),
  path.join(rootDir, 'src', 'ls', 'workbench', 'browser', 'tests', 'gridview.test.ts'),
  path.join(rootDir, 'src', 'ls', 'workbench', 'browser', 'tests', 'articleFetch.test.ts'),
  path.join(
    rootDir,
    'src',
    'ls',
    'workbench',
    'browser',
    'tests',
    'notificationsStatus.test.ts',
  ),
  path.join(
    rootDir,
    'src',
    'ls',
    'workbench',
    'browser',
    'tests',
    'contextkeys.test.ts',
  ),
  path.join(
    rootDir,
    'src',
    'ls',
    'workbench',
    'browser',
    'tests',
    'layoutModel.test.ts',
  ),
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({
  entryPoints,
  outdir: outputDir,
  outbase: path.join(rootDir, 'src'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  external: ['node:assert/strict', 'node:test', 'jsdom'],
  loader: {
    '.css': 'empty',
    '.svg': 'text',
  },
});

const outputFiles = entryPoints.map((entryPoint) =>
  path.join(
    outputDir,
    path.relative(path.join(rootDir, 'src'), entryPoint).replace(/\.ts$/, '.js'),
  ),
);

const result = spawnSync(process.execPath, ['--test', ...outputFiles], {
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
