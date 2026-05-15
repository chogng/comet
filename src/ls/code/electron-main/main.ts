import { app } from 'electron';

import {
  configureDevelopmentEnvironmentMain,
  configureEnvironmentMainPaths,
  isDevelopmentEnvironmentMain,
  prepareEnvironmentMain,
  resolveEnvironmentMainLocale,
  resolveEnvironmentMainPaths,
} from 'ls/platform/environment/electron-main/environmentMainService';
import { registerDevShortcuts } from 'ls/platform/window/electron-main/devShortcuts';
import { registerAppLifecycleHandlers } from 'ls/platform/lifecycle/electron-main/lifecycleMain';
import { registerAppIpc } from 'ls/code/electron-main/ipc';
import { createStorageService } from 'ls/platform/storage/electron-main/storageService';
import { createMainWindow, getMainWindow } from 'ls/platform/window/electron-main/window';
import { setMenuBarIconEnabled } from 'ls/platform/window/electron-main/trayIcon';

const environmentMainPaths = resolveEnvironmentMainPaths();
configureDevelopmentEnvironmentMain();
configureEnvironmentMainPaths(environmentMainPaths);
registerAppLifecycleHandlers({ createMainWindow });

app.whenReady().then(async () => {
  await prepareEnvironmentMain(environmentMainPaths);

  const storage = createStorageService(
    {
      historyFile: environmentMainPaths.historyFile,
      configFile: environmentMainPaths.configFile,
      userSettingsFile: environmentMainPaths.userSettingsFile,
      translationCacheFile: environmentMainPaths.translationCacheFile,
      libraryDbFile: environmentMainPaths.libraryDbFile,
      libraryFilesDir: environmentMainPaths.libraryFilesDir,
      ragCacheDir: environmentMainPaths.ragCacheDir,
    },
    {
      defaultLocale: resolveEnvironmentMainLocale(),
    },
  );

  if (isDevelopmentEnvironmentMain()) {
    registerDevShortcuts({ getMainWindow });
  }
  registerAppIpc(storage);
  const settings = await storage.loadSettings();
  createMainWindow({ useMica: settings.useMica });
  setMenuBarIconEnabled(settings.menuBarIconEnabled);
});
