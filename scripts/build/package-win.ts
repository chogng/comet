import { runBin, runNpmScript } from './build-utils.ts';

await runNpmScript('build:desktop');
await runBin('electron-builder', ['--win', 'nsis', 'portable', '--x64', '--publish', 'never']);
