import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(scriptDir, '..', '..');
export const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

function resolveNodeBin(binName: string) {
  const binPaths: Record<string, string> = {
    concurrently: resolveProjectPath('node_modules', 'concurrently', 'dist', 'bin', 'concurrently.js'),
    'electron-builder': resolveProjectPath('node_modules', 'electron-builder', 'cli.js'),
    tsc: resolveProjectPath('node_modules', 'typescript', 'bin', 'tsc'),
    vite: resolveProjectPath('node_modules', 'vite', 'bin', 'vite.js'),
  };

  return binPaths[binName];
}

export async function run(command: string, args: string[] = []) {
  console.log(`[build] ${[command, ...args].join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
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
  const npmArgs = ['run', scriptName];
  if (args.length > 0) {
    npmArgs.push('--', ...args);
  }

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && pathExists(npmExecPath)) {
    await run(process.execPath, [npmExecPath, ...npmArgs]);
    return;
  }

  await run(npmCommand, npmArgs);
}
