import { runBin, runNpmScript } from './build-utics.ts';

await runNpmScript('build:desktop');
await runBin('electron-builder', ['--win', 'nsis', 'portable', '--x64', '--publish', 'never']);
