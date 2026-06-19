import { resolveProjectPath, pathExists, run } from './build-utils.ts';

const legacyBuildScript = resolveProjectPath('scripts', 'build-py-worker.mjs');
const workerManifestPaths = [
  resolveProjectPath('py-worker', 'pyproject.toml'),
  resolveProjectPath('python', 'worker', 'pyproject.toml'),
  resolveProjectPath('workers', 'python', 'pyproject.toml'),
  resolveProjectPath('py-worker', 'requirements.txt'),
  resolveProjectPath('python', 'worker', 'requirements.txt'),
  resolveProjectPath('workers', 'python', 'requirements.txt'),
];

if (pathExists(legacyBuildScript)) {
  await run('node', [legacyBuildScript]);
} else if (workerManifestPaths.some(pathExists)) {
  throw new Error('Python worker sources exist, but no scripts/build-py-worker.mjs build adapter is defined.');
} else {
  console.log('[build:py-worker] no Python worker manifest found; skipping Python worker build');
}

