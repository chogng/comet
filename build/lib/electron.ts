import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function resolveElectronBinary(): string {
  const electronModule = require('electron') as string | { default?: string };
  const electronBinary =
    typeof electronModule === 'string' ? electronModule : electronModule.default;

  if (!electronBinary) {
    throw new Error('Unable to resolve the Electron binary from the electron package.');
  }

  return electronBinary;
}
