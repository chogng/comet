import { pathExists, resolveProjectPath, run } from './build-utics.ts';

const cargoManifestPath = resolveProjectPath('Cargo.toml');

if (!pathExists(cargoManifestPath)) {
  console.log('[build:rust] no Cargo.toml found; skipping Rust backend build');
} else {
  await run('cargo', ['build', '--release']);
}

