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
import { getMainWindow } from 'cs/platform/windows/electron-main/windows';
import { setMenuBarIconEnabled } from 'cs/platform/window/electron-main/trayIcon';
import { ThemeMainService } from 'cs/platform/theme/electron-main/themeMainServiceImpl';
import { createNativeHostMainService } from 'cs/platform/native/electron-main/nativeHostMainService';
import { registerWindowOpenPolicy } from 'cs/platform/window/electron-main/windowOpenPolicy';
import { WindowsMainService } from 'cs/platform/windows/electron-main/windowsMainService';

const environmentMainPaths = resolveEnvironmentMainPaths();
configureDevelopmentEnvironmentMain();
configureEnvironmentMainPaths(environmentMainPaths);
registerWindowOpenPolicy(app);

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
  const windowsMainService = new WindowsMainService(storage, themeMainService);
  const nativeHostMainService = createNativeHostMainService(themeMainService);
  app.once('before-quit', () => {
    themeMainService.dispose();
  });
  registerAppLifecycleHandlers({
    createMainWindow: () => {
      void windowsMainService.openMainWindow();
    },
  });
  if (isDevelopmentEnvironmentMain()) {
    registerDevShortcuts({ getMainWindow });
  }
  registerAppIpc(storage, nativeHostMainService, themeMainService);
  await windowsMainService.openMainWindow(settings);
  setMenuBarIconEnabled(settings.menuBarIconEnabled);
});
