import { run, runBin } from './build-utics.ts';

await run('node', ['./scripts/kill-dev-ports.mjs']);
await runBin('concurrently', [
  '-k',
  'vite --mode desktop',
  'node ./scripts/build-electron.mjs --watch',
  'node ./scripts/dev-electron-runner.mjs',
]);
