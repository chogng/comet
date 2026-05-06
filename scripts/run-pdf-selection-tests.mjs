import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptFilePath = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(scriptFilePath));
const outputDir = path.join(rootDir, '.tmp', 'pdf-selection-tests');
const entryPoint = path.join(
  rootDir,
  'src',
  'ls',
  'editor',
  'browser',
  'pdf',
  'tests',
  'pdfSelection.index.test.ts',
);
const outputFile = path.join(outputDir, 'index.test.mjs');

const fixtureResult = spawnSync(
  process.execPath,
  [path.join(rootDir, 'scripts', 'create-pdf-fixtures.mjs')],
  { stdio: 'inherit' },
);
if (fixtureResult.status !== 0) {
  process.exit(fixtureResult.status ?? 1);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
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

const result = spawnSync(process.execPath, ['--test', outputFile], {
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
