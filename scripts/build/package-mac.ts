import { runBin, runNpmScript } from './build-utics.ts';

await runNpmScript('build:desktop');
await runBin('electron-builder', ['--mac', 'dmg', 'zip', '--x64', '--publish', 'never']);
