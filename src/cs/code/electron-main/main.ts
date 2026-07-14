import { app, safeStorage } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { electronMainChannelServer } from 'cs/base/parts/ipc/electron-main/ipcMain';
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
import { LocalAgentHostMain } from 'cs/code/electron-main/agentHost/localAgentHostMain';
import { LocalAgentRuntimeProcessFactory } from 'cs/code/electron-main/agentHost/localAgentRuntimeProcess';
import { LocalAgentRuntimeSandboxProcessPort } from 'cs/code/electron-main/agentHost/localAgentRuntimeSandboxProcess';
import {
  createLocalAgentPackageArtifactFile,
  createLocalAgentPackageContentDigest,
  LocalAgentPackageArtifactPort,
} from 'cs/code/electron-main/agentHost/localAgentPackageArtifactPort';
import {
  CLAUDE_AGENT_RUNTIME_ENTRY_POINT,
  claudeAgentSdkExecutableTarget,
  createClaudeAgentPackageProduct,
} from 'cs/code/common/agentHost/claudeAgentPackage';

const require = createRequire(import.meta.url);

function resolveClaudeAgentSdkExecutable(): string {
  const platformPackage = `${process.platform}-${process.arch}`;
  const packageName = (() => {
    switch (platformPackage) {
      case 'darwin-arm64': return '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
      case 'darwin-x64': return '@anthropic-ai/claude-agent-sdk-darwin-x64/claude';
      case 'linux-arm64': return '@anthropic-ai/claude-agent-sdk-linux-arm64/claude';
      case 'linux-x64': return '@anthropic-ai/claude-agent-sdk-linux-x64/claude';
      case 'win32-arm64': return '@anthropic-ai/claude-agent-sdk-win32-arm64/claude.exe';
      case 'win32-x64': return '@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe';
      default: throw new Error(`Claude Agent SDK does not support ${platformPackage}.`);
    }
  })();
  return require.resolve(packageName);
}

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
      safeStorage,
      platform: process.platform,
      defaultLocale: resolveEnvironmentMainLocale(),
    },
  );
  await storage.init();

  const settings = await storage.loadSettings();
  const target = Object.freeze({ operatingSystem: process.platform, architecture: process.arch });
  const claudeRuntimeArtifact = await createLocalAgentPackageArtifactFile(fileURLToPath(new URL(
    '../electron-utility/agentRuntime/claudeAgentRuntimeMain.js',
    import.meta.url,
  )));
  const claudeExecutableArtifact = await createLocalAgentPackageArtifactFile(resolveClaudeAgentSdkExecutable());
  const claudeExecutableTarget = claudeAgentSdkExecutableTarget(target);
  const claudeAgentPackageProduct = createClaudeAgentPackageProduct(target, Object.freeze({
    contentDigest: createLocalAgentPackageContentDigest(Object.freeze([
      Object.freeze({ target: CLAUDE_AGENT_RUNTIME_ENTRY_POINT, contentDigest: claudeRuntimeArtifact.contentDigest }),
      Object.freeze({ target: claudeExecutableTarget, contentDigest: claudeExecutableArtifact.contentDigest }),
    ])),
    runtime: claudeRuntimeArtifact,
    executable: claudeExecutableArtifact,
  }));
  const agentPackageProducts = Object.freeze([claudeAgentPackageProduct]);
  const packageArtifactPort = new LocalAgentPackageArtifactPort({
    storageRoot: environmentMainPaths.agentHostPackagesDir,
    packages: agentPackageProducts.map(product => product.verifiedPackage),
  });
  const agentRuntimeSandboxProcessPort = new LocalAgentRuntimeSandboxProcessPort({
    installedArtifacts: packageArtifactPort,
    stateRoot: environmentMainPaths.agentHostRuntimeStateDir,
    executableArtifactTargets: Object.freeze([claudeExecutableTarget]),
  });
  const agentHost = await LocalAgentHostMain.create({
    storage: storage.applicationStorage,
    providerApiKeySecretStorage: storage.providerApiKeySecretStorage,
    contentMaterializationRoot: environmentMainPaths.agentHostContentDir,
    bundledArtifactPath: fileURLToPath(import.meta.url),
    agentPackageProducts,
    packageArtifactPort,
    channelServer: electronMainChannelServer,
    fetch: (url, init) => fetch(url, init),
    now: Date.now,
    agentRuntimeConnectionFactory: new LocalAgentRuntimeProcessFactory(agentRuntimeSandboxProcessPort),
  });
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
			await agentHost.shutdown();
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
