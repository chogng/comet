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
import { browserAutomationWindowCloseLifecycle, registerAppIpc, shutdownBrowserAutomation } from 'cs/code/electron-main/ipc';
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

  const settings = await storage.loadSettings();
  const themeMainService = new ThemeMainService(storage, settings);
  const windowsMainService = new WindowsMainService(storage, themeMainService, browserAutomationWindowCloseLifecycle);
  const nativeHostMainService = createNativeHostMainService(themeMainService);
  registerAppLifecycleHandlers({
    createMainWindow: () => {
      void windowsMainService.openMainWindow();
    },
	prepareApplicationQuit: async () => {
		const errors: unknown[] = [];
		try {
			await shutdownBrowserAutomation();
		} catch (error) {
			errors.push(error);
		}
		try {
			await storage.close();
		} catch (error) {
			errors.push(error);
		}
		try {
			themeMainService.dispose();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Failed to finalize application services.');
		}
	},
  });
  if (isDevelopmentEnvironmentMain()) {
    registerDevShortcuts({ getMainWindow });
  }
  registerAppIpc(storage, nativeHostMainService, themeMainService);
  await windowsMainService.openMainWindow(settings);
  setMenuBarIconEnabled(settings.menuBarIconEnabled);
});
