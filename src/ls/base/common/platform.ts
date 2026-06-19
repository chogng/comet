export type RuntimeMode = 'web' | 'desktop';
export type RuntimePlatform = 'web' | 'windows' | 'macos';

export const LANGUAGE_DEFAULT = 'en';

export enum OperatingSystem {
  Windows = 1,
  Macintosh = 2,
  Linux = 3,
}

export const enum Platform {
  Web,
  Mac,
  Windows,
}

export type PlatformName = 'Web' | 'Windows' | 'Mac';

export function PlatformToString(platform: Platform): PlatformName {
  switch (platform) {
    case Platform.Mac:
      return 'Mac';
    case Platform.Windows:
      return 'Windows';
    case Platform.Web:
      return 'Web';
  }
}

function readNavigatorPlatform() {
  if (typeof navigator === 'undefined') {
    return '';
  }

  return String(navigator.platform ?? '').toLowerCase();
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

const navigatorPlatform = readNavigatorPlatform();
const desktopRuntime =
  typeof window !== 'undefined' &&
  typeof window.electronAPI?.invoke === 'function';
const runtimeMode: RuntimeMode = desktopRuntime ? 'desktop' : 'web';
const runtimePlatform: RuntimePlatform = !desktopRuntime
  ? 'web'
  : isMacintoshPlatform(navigatorPlatform)
    ? 'macos'
    : 'windows';
const operatingSystem =
  runtimePlatform === 'macos'
    ? OperatingSystem.Macintosh
    : OperatingSystem.Windows;
const platformValue =
  runtimePlatform === 'macos'
    ? Platform.Mac
    : runtimePlatform === 'windows'
      ? Platform.Windows
      : Platform.Web;

export function hasDesktopRuntime() {
  return desktopRuntime;
}

export function hasWindowControlsRuntime() {
  return (
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.windowControls?.perform === 'function'
  );
}

export function hasWebContentRuntime() {
  return (
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.webContent?.navigate === 'function'
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
export const isNative = desktopRuntime;
export const isWeb = runtimeMode === 'web';
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
