import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TARGET_PORTS = [1420, 1421];

function parsePidsFromLines(lines) {
  const pidSet = new Set();

  for (const line of lines) {
    const pid = Number.parseInt(line.trim(), 10);

    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      continue;
    }

    pidSet.add(pid);
  }

  return [...pidSet];
}

async function getWindowsListeningPidsByPort(targetPorts) {
  const { stdout = '' } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  const pidSet = new Set();
  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.toUpperCase().startsWith('TCP')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }

    const localAddress = parts[1] ?? '';
    const pidText = parts.at(-1) ?? '';
    const pid = Number.parseInt(pidText, 10);

    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      continue;
    }

    for (const port of targetPorts) {
      if (localAddress.endsWith(`:${port}`)) {
        pidSet.add(pid);
        break;
      }
    }
  }

  return [...pidSet];
}

async function getPosixListeningPidsByPort(targetPorts) {
  const pidSet = new Set();

  for (const port of targetPorts) {
    try {
      const { stdout = '' } = await execFileAsync(
        'lsof',
        ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
        { maxBuffer: 1024 * 1024 }
      );

      for (const pid of parsePidsFromLines(stdout.split(/\r?\n/))) {
        pidSet.add(pid);
      }
    } catch (error) {
      if (error?.code === 1) {
        continue;
      }

      throw error;
    }
  }

  return [...pidSet];
}

async function killWindowsPid(pid) {
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    console.log(`[predev] killed pid ${pid}`);
  } catch (error) {
    const details =
      error?.stderr?.trim() || error?.stdout?.trim() || error?.message || 'unknown error';
    console.warn(`[predev] failed to kill pid ${pid}: ${details}`);
  }
}

function killPosixPid(pid) {
  try {
    process.kill(pid, 'SIGKILL');
    console.log(`[predev] killed pid ${pid}`);
  } catch (error) {
    const details = error?.message || 'unknown error';
    console.warn(`[predev] failed to kill pid ${pid}: ${details}`);
  }
}

async function main() {
  const targetText = TARGET_PORTS.join(', ');
  const pids =
    process.platform === 'win32'
      ? await getWindowsListeningPidsByPort(TARGET_PORTS)
      : await getPosixListeningPidsByPort(TARGET_PORTS);

  if (pids.length === 0) {
    return;
  }

  console.log(`[predev] cleaning stale listeners on ports ${targetText}`);

  for (const pid of pids) {
    if (process.platform === 'win32') {
      await killWindowsPid(pid);
    } else {
      killPosixPid(pid);
    }
  }
}

main().catch((error) => {
  const details = error?.message || String(error);
  console.error(`[predev] failed to clean ports: ${details}`);
  process.exitCode = 1;
});
