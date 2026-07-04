export type RuntimeMode = 'web' | 'desktop';
export type RuntimePlatform = 'web' | 'windows' | 'macos' | 'linux';

export const LANGUAGE_DEFAULT = 'en';

export interface IProcessEnvironment {
	[key: string]: string | undefined;
}

export interface INodeProcess {
	platform: string;
	arch: string;
	env: IProcessEnvironment;
	versions?: {
		node?: string;
		electron?: string;
		chrome?: string;
	};
	type?: string;
	cwd: () => string;
}

export enum OperatingSystem {
  Windows = 1,
  Macintosh = 2,
  Linux = 3,
}

export const enum Platform {
  Web,
  Mac,
  Windows,
  Linux,
}

export type PlatformName = 'Web' | 'Windows' | 'Mac' | 'Linux';

type RuntimeGlobal = typeof globalThis & {
  navigator?: {
    platform?: unknown;
  };
  window?: {
    electronAPI?: {
      invoke?: unknown;
      windowControls?: {
        perform?: unknown;
      };
      webContent?: {
        navigate?: unknown;
      };
    };
  };
  importScripts?: unknown;
  origin?: unknown;
};

const runtimeGlobal = globalThis as RuntimeGlobal;

export function PlatformToString(platform: Platform): PlatformName {
  switch (platform) {
    case Platform.Mac:
      return 'Mac';
    case Platform.Windows:
      return 'Windows';
    case Platform.Linux:
      return 'Linux';
    case Platform.Web:
      return 'Web';
  }
}

function readNavigatorPlatform() {
  if (!runtimeGlobal.navigator) {
    return '';
  }

  return String(runtimeGlobal.navigator.platform ?? '').toLowerCase();
}

function isMacintoshPlatform(platform: string) {
  return (
    platform === 'darwin' ||
    platform.includes('mac') ||
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    platform.includes('ipod')
  );
}

function isLinuxPlatform(platform: string) {
  return platform === 'linux' || platform.includes('linux');
}

const navigatorPlatform = readNavigatorPlatform();
const desktopRuntime =
  typeof runtimeGlobal.window !== 'undefined' &&
  typeof runtimeGlobal.window.electronAPI?.invoke === 'function';
const webWorkerRuntime =
  typeof runtimeGlobal.window === 'undefined' &&
  typeof runtimeGlobal.importScripts === 'function';
const runtimeMode: RuntimeMode = desktopRuntime ? 'desktop' : 'web';
const runtimePlatform: RuntimePlatform = !desktopRuntime
  ? 'web'
  : isMacintoshPlatform(navigatorPlatform)
    ? 'macos'
    : isLinuxPlatform(navigatorPlatform)
      ? 'linux'
      : 'windows';
const operatingSystem =
  runtimePlatform === 'macos'
    ? OperatingSystem.Macintosh
    : runtimePlatform === 'linux'
      ? OperatingSystem.Linux
    : OperatingSystem.Windows;
const platformValue =
  runtimePlatform === 'macos'
    ? Platform.Mac
    : runtimePlatform === 'windows'
      ? Platform.Windows
      : runtimePlatform === 'linux'
        ? Platform.Linux
        : Platform.Web;

export function hasDesktopRuntime() {
  return desktopRuntime;
}

export function hasWindowControlsRuntime() {
  return (
    typeof runtimeGlobal.window !== 'undefined' &&
    typeof runtimeGlobal.window.electronAPI?.windowControls?.perform === 'function'
  );
}

export function hasWebContentRuntime() {
  return (
    typeof runtimeGlobal.window !== 'undefined' &&
    typeof runtimeGlobal.window.electronAPI?.webContent?.navigate === 'function'
  );
}

export function getRuntimeMode(): RuntimeMode {
  return runtimeMode;
}

export function getRuntimePlatform(): RuntimePlatform {
  return runtimePlatform;
}

export function getOperatingSystem(): OperatingSystem {
  return operatingSystem;
}

export const isWindows = runtimePlatform === 'windows';
export const isMacintosh = runtimePlatform === 'macos';
export const isLinux = runtimePlatform === 'linux';
export const isIOS = (
  typeof navigator !== 'undefined' &&
  (navigatorPlatform.includes('iphone') || navigatorPlatform.includes('ipad') || navigatorPlatform.includes('mac')) &&
  navigator.maxTouchPoints > 0
);
export const isNative = desktopRuntime;
export const isWeb = runtimeMode === 'web';
export const webWorkerOrigin = webWorkerRuntime && typeof runtimeGlobal.origin === 'string' ? runtimeGlobal.origin : undefined;
export const platform = platformValue;
export const language: string = LANGUAGE_DEFAULT;
export const locale: string = LANGUAGE_DEFAULT;
export const platformLocale: string = LANGUAGE_DEFAULT;
export const OS = operatingSystem;

export namespace Language {
  export function value(): string {
    return language;
  }

  export function isDefaultVariant(): boolean {
    return language === LANGUAGE_DEFAULT || language.startsWith(`${LANGUAGE_DEFAULT}-`);
  }

  export function isDefault(): boolean {
    return language === LANGUAGE_DEFAULT;
  }
}
