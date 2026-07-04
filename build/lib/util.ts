import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createNpmRunArgs, npmCommand, resolveNpmExecPath } from '../npm/install.ts';
import { resolveViteBinPath } from '../vite/paths.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(scriptDir, '..', '..');

export function resolveProjectPath(...segments: string[]) {
  return path.join(projectRoot, ...segments);
}

export function pathExists(filePath: string) {
  return fs.existsSync(filePath);
}

export async function removePath(filePath: string) {
  await fsPromises.rm(filePath, { force: true, recursive: true });
}

export async function copyDirectory(sourcePath: string, targetPath: string) {
  if (!pathExists(sourcePath)) {
    return false;
  }

  await fsPromises.rm(targetPath, { force: true, recursive: true });
  await fsPromises.cp(sourcePath, targetPath, { recursive: true });
  return true;
}

function createBuildEnv() {
  const localBinPath = resolveProjectPath('node_modules', '.bin');
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const pathValue = process.env[pathKey];

  return {
    ...process.env,
    [pathKey]: pathValue ? `${localBinPath}${path.delimiter}${pathValue}` : localBinPath,
  };
}

function resolveNodeBin(binName: string) {
  const binPaths: Record<string, string> = {
    'electron-builder': resolveProjectPath('node_modules', 'electron-builder', 'cli.js'),
    tsc: resolveProjectPath('node_modules', 'typescript', 'bin', 'tsc'),
    vite: resolveViteBinPath(projectRoot),
  };

  return binPaths[binName];
}

export async function run(command: string, args: string[] = []) {
  console.log(`[build] ${[command, ...args].join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: createBuildEnv(),
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}

export async function runBin(binName: string, args: string[] = []) {
  const binPath = resolveNodeBin(binName);
  if (!binPath || !pathExists(binPath)) {
    await run(binName, args);
    return;
  }

  await run(process.execPath, [binPath, ...args]);
}

export async function runNpmScript(scriptName: string, args: string[] = []) {
  const npmArgs = createNpmRunArgs(scriptName, args);

  const npmExecPath = resolveNpmExecPath(projectRoot);
  if (npmExecPath && pathExists(npmExecPath)) {
    await run(process.execPath, [npmExecPath, ...npmArgs]);
    return;
  }

  await run(npmCommand, npmArgs);
}
