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
import { createStorageService } from 'ls/code/electron-main/storageService';
import { createMainWindow, getMainWindow } from 'ls/platform/windows/electron-main/windows';
import { setMenuBarIconEnabled } from 'ls/platform/window/electron-main/trayIcon';
import { ThemeMainService } from 'ls/platform/theme/electron-main/themeMainServiceImpl';
import { createNativeHostMainService } from 'ls/platform/native/electron-main/nativeHostMainService';

const environmentMainPaths = resolveEnvironmentMainPaths();
configureDevelopmentEnvironmentMain();
configureEnvironmentMainPaths(environmentMainPaths);
registerAppLifecycleHandlers({ createMainWindow });

app.whenReady().then(async () => {
  await prepareEnvironmentMain(environmentMainPaths);

  const storage = createStorageService(
    {
      historyFile: environmentMainPaths.historyFile,
      stateDbFile: environmentMainPaths.stateDbFile,
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
  await storage.init();
  app.once('before-quit', () => {
    void storage.close();
  });

  const settings = await storage.loadSettings();
  const themeMainService = new ThemeMainService(storage, settings);
  const nativeHostMainService = createNativeHostMainService(themeMainService);
  app.once('before-quit', () => {
    themeMainService.dispose();
  });
  if (isDevelopmentEnvironmentMain()) {
    registerDevShortcuts({ getMainWindow });
  }
  registerAppIpc(storage, nativeHostMainService, themeMainService);
  createMainWindow({
    useMica: settings.useMica,
    backgroundColor: themeMainService.getBackgroundColor(),
  });
  setMenuBarIconEnabled(settings.menuBarIconEnabled);
});
