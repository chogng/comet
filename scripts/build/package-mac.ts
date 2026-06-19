import { runBin, runNpmScript } from './build-utils.ts';

await runNpmScript('build:desktop');
await runBin('electron-builder', ['--mac', 'dmg', 'zip', '--x64', '--publish', 'never']);
