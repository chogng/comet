import path from 'node:path';

import { resolveWindowsCommand } from '../win32/paths';

export const npmCommand = resolveWindowsCommand('npm');

export function resolveNpmExecPath(projectRoot: string): string | undefined {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return npmExecPath;
  }

  return path.join(projectRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

export function createNpmRunArgs(scriptName: string, args: string[] = []): string[] {
  const npmArgs = ['run', scriptName];
  if (args.length > 0) {
    npmArgs.push('--', ...args);
  }

  return npmArgs;
}
