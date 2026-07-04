import { runBin, runNpmScript } from './util.ts';

const target = process.argv[2];
const targetArgs: Record<string, string[]> = {
  '--mac': ['--mac', 'dmg', 'zip', '--x64', '--publish', 'never'],
  '--win': ['--win', 'nsis', 'portable', '--x64', '--publish', 'never'],
};

const electronBuilderArgs = targetArgs[target];
if (!electronBuilderArgs) {
  throw new Error('Expected package target: --mac or --win');
}

await runNpmScript('build:desktop');
await runBin('electron-builder', electronBuilderArgs);
