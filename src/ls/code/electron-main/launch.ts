import { spawn } from 'node:child_process';
import { resolveElectronBinary } from 'language/electron';

const electronBinary = resolveElectronBinary();
const args = process.argv.slice(2);
const env = { ...process.env };

// Some shells export ELECTRON_RUN_AS_NODE globally; Electron must not inherit it.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, args, {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

let shuttingDown = false;

function terminateChild(signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    child.kill();
  }
}

function requestShutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const childSignal = signal === 'SIGBREAK' ? 'SIGTERM' : signal;
  terminateChild(childSignal);

  const forceExitTimer = setTimeout(() => {
    process.exit(0);
  }, 5000);
  forceExitTimer.unref();

  child.once('close', () => {
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
}

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
for (const signal of shutdownSignals) {
  process.once(signal, () => requestShutdown(signal));
}

child.on('close', (code, signal) => {
  if (shuttingDown) {
    return;
  }
  if (code === null) {
    console.error(`Electron exited with signal ${signal}`);
    process.exit(1);
    return;
  }
  process.exit(code);
});
