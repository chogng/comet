export type RuntimeMode = 'web' | 'desktop';
export type RuntimePlatform = 'web' | 'windows' | 'macos' | 'linux';

export enum OperatingSystem {
  Windows = 1,
  Macintosh = 2,
  Linux = 3,
}

function getNavigatorPlatform() {
  if (typeof navigator === 'undefined') {
    return '';
  }

  return String(navigator.platform ?? '').toLowerCase();
}

export function hasDesktopRuntime() {
  return (
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.invoke === 'function'
  );
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
  return hasDesktopRuntime() ? 'desktop' : 'web';
}

export function getRuntimePlatform(): RuntimePlatform {
  if (!hasDesktopRuntime()) {
    return 'web';
  }

  const normalizedPlatform = getNavigatorPlatform();
  if (
    normalizedPlatform === 'darwin' ||
    normalizedPlatform.includes('mac') ||
    normalizedPlatform.includes('iphone') ||
    normalizedPlatform.includes('ipad') ||
    normalizedPlatform.includes('ipod')
  ) {
    return 'macos';
  }

  if (normalizedPlatform === 'win32' || normalizedPlatform.includes('win')) {
    return 'windows';
  }

  if (
    normalizedPlatform === 'linux' ||
    normalizedPlatform.includes('linux') ||
    normalizedPlatform.includes('x11')
  ) {
    return 'linux';
  }

  return 'web';
}

export function getOperatingSystem(): OperatingSystem {
  const runtimePlatform = getRuntimePlatform();
  if (runtimePlatform === 'macos') {
    return OperatingSystem.Macintosh;
  }

  if (runtimePlatform === 'linux') {
    return OperatingSystem.Linux;
  }

  return OperatingSystem.Windows;
}

export const OS = getOperatingSystem();
