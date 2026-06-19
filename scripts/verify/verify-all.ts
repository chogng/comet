import { runNpmScript } from '../build/build-utils.ts';

const verifyScripts = [
  'check:i18n',
  'typecheck:tests',
  'test:base-common',
  'test:workbench-browser',
  'test:editor',
  'test:pdf-selection',
  'test:library-store',
  'test:electron-main',
  'test:agent',
];

for (const scriptName of verifyScripts) {
  await runNpmScript(scriptName);
}

