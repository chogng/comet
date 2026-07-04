import { app } from 'electron';

import {
  configureDevelopmentEnvironmentMain,
  configureEnvironmentMainPaths,
  isDevelopmentEnvironmentMain,
  prepareEnvironmentMain,
  resolveEnvironmentMainLocale,
  resolveEnvironmentMainPaths,
} from 'cs/platform/environment/electron-main/environmentMainService';
import { registerDevShortcuts } from 'cs/platform/window/electron-main/devShortcuts';
import { registerAppLifecycleHandlers } from 'cs/platform/lifecycle/electron-main/lifecycleMain';
import { registerAppIpc } from 'cs/code/electron-main/ipc';
import { createStorageService } from 'cs/code/electron-main/storageService';
import { createMainWindow, getMainWindow } from 'cs/platform/windows/electron-main/windows';
import { setMenuBarIconEnabled } from 'cs/platform/window/electron-main/trayIcon';
import { ThemeMainService } from 'cs/platform/theme/electron-main/themeMainServiceImpl';
import { createNativeHostMainService } from 'cs/platform/native/electron-main/nativeHostMainService';

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
