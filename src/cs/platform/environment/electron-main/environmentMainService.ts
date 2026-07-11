import path from 'node:path';
import { promises as fs } from 'node:fs';
import { app } from 'electron';

const LEGACY_APP_ROOT_DIR_NAME = '.reader';
const APP_ROOT_DIR_NAME = '.comet-studio';

export type AppEnvironmentPaths = {
  previousUserDataDir: string;
  legacyRootDir: string;
  rootDir: string;
  userSettingsDir: string;
  configDir: string;
  dataDir: string;
  cacheDir: string;
  sessionDir: string;
  tempDir: string;
  logsDir: string;
  userSettingsFile: string;
  configFile: string;
  stateDbFile: string;
  translationCacheFile: string;
  libraryDbFile: string;
  libraryFilesDir: string;
  ragCacheDir: string;
};

function resolvePortableExecutableDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portableDir) {
    return portableDir;
  }

  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE?.trim();
  if (portableFile) {
    return path.dirname(portableFile);
  }

  return null;
}

export function resolveEnvironmentMainPaths(): AppEnvironmentPaths {
  const previousUserDataDir = app.getPath('userData');
  const portableExecutableDir = resolvePortableExecutableDir();
  const rootBaseDir = portableExecutableDir ?? app.getPath('home');
  const legacyRootDir = path.join(rootBaseDir, LEGACY_APP_ROOT_DIR_NAME);
  const rootDir = path.join(rootBaseDir, APP_ROOT_DIR_NAME);
  const userSettingsDir = path.join(rootDir, 'User');
  const configDir = path.join(rootDir, 'config');
  const dataDir = path.join(rootDir, 'data');
  const cacheDir = path.join(rootDir, 'cache');
  const sessionDir = path.join(cacheDir, 'session');
  const tempDir = path.join(cacheDir, 'temp');
  const logsDir = path.join(rootDir, 'logs');

  return {
    previousUserDataDir,
    legacyRootDir,
    rootDir,
    userSettingsDir,
    configDir,
    dataDir,
    cacheDir,
    sessionDir,
    tempDir,
    logsDir,
    userSettingsFile: path.join(userSettingsDir, 'settings.json'),
    configFile: path.join(configDir, 'config.json'),
    stateDbFile: path.join(dataDir, 'state.vscdb'),
    translationCacheFile: path.join(dataDir, 'translation-cache.json'),
    libraryDbFile: path.join(dataDir, 'library.sqlite'),
    libraryFilesDir: path.join(dataDir, 'library-files'),
    ragCacheDir: path.join(cacheDir, 'rag'),
  };
}

export function resolveEnvironmentMainLocale(): 'zh' | 'en' {
  return 'en';
}

export function isDevelopmentEnvironmentMain() {
  return !app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL);
}

export function configureDevelopmentEnvironmentMain() {
  if (isDevelopmentEnvironmentMain()) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  }
}

export function configureEnvironmentMainPaths(paths: AppEnvironmentPaths) {
  app.setPath('userData', paths.rootDir);
  app.setPath('cache', paths.cacheDir);
  app.setPath('sessionData', paths.sessionDir);
  app.setPath('temp', paths.tempDir);
  app.setAppLogsPath(paths.logsDir);
}

async function removeFileIfExists(filePath: string) {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Ignore cleanup failures to avoid blocking startup.
  }
}

async function cleanupLegacyStorageFiles(paths: AppEnvironmentPaths) {
  const staleFiles = [
    path.join(paths.previousUserDataDir, 'settings.json'),
    path.join(paths.rootDir, 'settings.json'),
    path.join(paths.previousUserDataDir, 'history.json'),
    path.join(paths.rootDir, 'history.json'),
  ];

  await Promise.all(staleFiles.map((filePath) => removeFileIfExists(filePath)));
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryContents(sourceDir: string, targetDir: string) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(sourcePath);
      try {
        await fs.symlink(linkTarget, targetPath);
      } catch {
        // Ignore duplicate symlink failures during best-effort migration.
      }
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

async function migrateLegacyRootDir(paths: AppEnvironmentPaths) {
  if (paths.legacyRootDir === paths.rootDir) {
    return;
  }

  const [legacyExists, nextExists] = await Promise.all([
    pathExists(paths.legacyRootDir),
    pathExists(paths.rootDir),
  ]);
  if (!legacyExists || nextExists) {
    return;
  }

  try {
    await fs.rename(paths.legacyRootDir, paths.rootDir);
    return;
  } catch {
    // Fall back to copy/remove when rename is unavailable.
  }

  await copyDirectoryContents(paths.legacyRootDir, paths.rootDir);
  try {
    await fs.rm(paths.legacyRootDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures after a successful copy.
  }
}

export async function prepareEnvironmentMain(paths: AppEnvironmentPaths) {
  await migrateLegacyRootDir(paths);

  await Promise.all([
    fs.mkdir(paths.rootDir, { recursive: true }),
    fs.mkdir(paths.configDir, { recursive: true }),
    fs.mkdir(paths.dataDir, { recursive: true }),
    fs.mkdir(paths.cacheDir, { recursive: true }),
    fs.mkdir(paths.sessionDir, { recursive: true }),
    fs.mkdir(paths.tempDir, { recursive: true }),
    fs.mkdir(paths.logsDir, { recursive: true }),
    fs.mkdir(paths.libraryFilesDir, { recursive: true }),
    fs.mkdir(paths.ragCacheDir, { recursive: true }),
  ]);

  await cleanupLegacyStorageFiles(paths);
}
