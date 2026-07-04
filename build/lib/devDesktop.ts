import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

import { createServer, type ViteDevServer } from 'vite';

import { resolveElectronBinary } from './electron.ts';
import { watchElectronBuild } from './electronBuild.ts';
import { resolveProjectPath, run } from './util.ts';

const rendererHost = '127.0.0.1';
const rendererPort = 1420;
const restartDebounceMs = 150;
const mainScriptPath = resolveProjectPath('dist-electron', 'code', 'electron-main', 'main.js');
const electronArgs = process.argv.slice(2);

let electronProcess: ChildProcess | undefined;
let restartingElectron = false;
let restartTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;
let viteServer: ViteDevServer | undefined;
let electronBuildContext: { dispose: () => Promise<void> } | undefined;

function clearRestartTimer() {
  if (!restartTimer) {
    return;
  }

  clearTimeout(restartTimer);
  restartTimer = undefined;
}

function stopElectron(signal: NodeJS.Signals = 'SIGTERM') {
  if (!electronProcess || electronProcess.exitCode !== null || electronProcess.signalCode !== null) {
    return;
  }

  electronProcess.kill(signal);
}

function spawnElectron() {
  if (shuttingDown) {
    return;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_ENABLE_STACK_DUMPING: '1',
    ELECTRON_RENDERER_URL: `http://${rendererHost}:${rendererPort}/`,
  };

  delete env.ELECTRON_RUN_AS_NODE;

  electronProcess = spawn(resolveElectronBinary(), [mainScriptPath, ...electronArgs], {
    cwd: resolveProjectPath(),
    stdio: 'inherit',
    windowsHide: false,
    env,
  });

  electronProcess.once('close', (code, signal) => {
    electronProcess = undefined;

    if (shuttingDown) {
      return;
    }

    if (restartingElectron) {
      restartingElectron = false;
      spawnElectron();
      return;
    }

    if (code === null) {
      console.error(`Electron exited with signal ${signal}`);
      process.exit(1);
    }

    process.exit(code);
  });
}

function scheduleElectronRestart() {
  if (shuttingDown || restartingElectron) {
    return;
  }

  clearRestartTimer();
  restartTimer = setTimeout(() => {
    restartTimer = undefined;

    if (shuttingDown || restartingElectron) {
      return;
    }

    restartingElectron = true;
    if (!electronProcess) {
      restartingElectron = false;
      spawnElectron();
      return;
    }

    stopElectron();
  }, restartDebounceMs);
}

async function startViteServer() {
  const server = await createServer({ mode: 'desktop' });
  await server.listen();
  server.printUrls();
  return server;
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearRestartTimer();
  stopElectron(signal);

  await electronBuildContext?.dispose();
  await viteServer?.close();
}

async function main() {
  await run('node', ['./scripts/kill-dev-ports.mjs']);

  viteServer = await startViteServer();
  electronBuildContext = await watchElectronBuild(scheduleElectronRestart);

  if (shuttingDown) {
    return;
  }

  spawnElectron();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[]) {
  process.once(signal, () => {
    void shutdown(signal).then(() => {
      process.exit(0);
    });
  });
}

main().catch(error => {
  console.error('[dev:desktop] failed to start:', error);
  process.exit(1);
});
