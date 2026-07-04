import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workbenchRendererPathname = '/src/cs/code/electron-sandbox/workbench/workbench.html';
const windowModuleFilePath = fileURLToPath(import.meta.url);
const distElectronMarker = `${path.sep}dist-electron${path.sep}`;
const distElectronMarkerIndex = windowModuleFilePath.lastIndexOf(distElectronMarker);

function resolveProjectRootDir() {
  return distElectronMarkerIndex >= 0
    ? windowModuleFilePath.slice(0, distElectronMarkerIndex)
    : process.cwd();
}

function resolveDistElectronDir() {
  return path.join(resolveProjectRootDir(), 'dist-electron');
}

function resolveDistRendererWorkbenchDir() {
  return path.join(
    resolveProjectRootDir(),
    'dist',
    'src',
    'cs',
    'code',
    'electron-sandbox',
    'workbench',
  );
}

function resolvePreloadBrowserDir() {
  return path.join(
    resolveDistElectronDir(),
    'base',
    'parts',
    'sandbox',
    'electron-browser',
  );
}

export function resolveWorkbenchRendererUrl(
  devServerUrl: string,
  query: Record<string, string | undefined> = {},
) {
  const url = new URL(devServerUrl);
  url.pathname = workbenchRendererPathname;
  url.search = '';

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export function resolveWorkbenchRendererFilePath() {
  return path.join(resolveDistRendererWorkbenchDir(), 'workbench.html');
}

export function resolvePreloadScriptPath() {
  return path.join(resolvePreloadBrowserDir(), 'preload.js');
}
