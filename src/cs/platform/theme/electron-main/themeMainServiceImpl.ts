import { nativeTheme } from 'electron';

import type { AppSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { EventEmitter } from 'cs/base/common/event';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import type { StorageService } from 'cs/platform/storage/common/storage';
import {
  StorageScope,
  StorageTarget,
} from 'cs/platform/storage/common/storage';
import type {
  AppColorScheme,
  PartsSplash,
  ThemeKind,
} from 'cs/platform/theme/common/theme';
import type { IThemeMainService } from 'cs/platform/theme/electron-main/themeMainService';
import { getWindowById } from 'cs/platform/windows/electron-main/windows';

const DEFAULT_LIGHT_BACKGROUND = '#ffffff';
const DEFAULT_DARK_BACKGROUND = '#18222c';
const THEME_WINDOW_SPLASH_KEY = 'theme.windowSplash';

function resolveThemeKind(settings: AppSettings): ThemeKind {
  if (settings.theme === 'light' || settings.theme === 'dark') {
    return settings.theme;
  }

  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function resolveBackgroundColor(settings: AppSettings) {
  return resolveThemeKind(settings) === 'dark'
    ? DEFAULT_DARK_BACKGROUND
    : DEFAULT_LIGHT_BACKGROUND;
}

export class ThemeMainService implements IThemeMainService {
  declare readonly _serviceBrand: undefined;

  private readonly disposables = new DisposableStore();
  private readonly didChangeColorSchemeEmitter =
    this.disposables.add(new EventEmitter<AppColorScheme>());
  readonly onDidChangeColorScheme = this.didChangeColorSchemeEmitter.event;

  constructor(
    private readonly storageService: StorageService,
    private settings: AppSettings,
  ) {
    this.updateNativeThemeSource();

    const handleNativeThemeUpdated = () => {
      this.didChangeColorSchemeEmitter.fire(this.getColorScheme());
    };
    nativeTheme.on('updated', handleNativeThemeUpdated);
    this.disposables.add(toDisposable(() => {
      nativeTheme.off('updated', handleNativeThemeUpdated);
    }));
  }

  getBackgroundColor(): string {
    const splash = this.getWindowSplash();
    if (splash?.baseTheme === resolveThemeKind(this.settings)) {
      return splash.colorInfo.background;
    }

    return resolveBackgroundColor(this.settings);
  }

  getColorScheme(): AppColorScheme {
    return {
      dark: resolveThemeKind(this.settings) === 'dark',
      highContrast: nativeTheme.shouldUseHighContrastColors,
    };
  }

  getWindowSplash(): PartsSplash | undefined {
    return this.storageService.getObject<PartsSplash>(
      THEME_WINDOW_SPLASH_KEY,
      StorageScope.APPLICATION,
    );
  }

  saveWindowSplash(windowId: number | undefined, splash: PartsSplash): void {
    this.storageService.store(
      THEME_WINDOW_SPLASH_KEY,
      splash,
      StorageScope.APPLICATION,
      StorageTarget.MACHINE,
    );

    if (typeof windowId === 'number') {
      getWindowById(windowId)?.setBackgroundColor(splash.colorInfo.background);
    }
  }

  updateSettings(settings: AppSettings): void {
    const previousColorScheme = this.getColorScheme();
    this.settings = settings;
    this.updateNativeThemeSource();
    const nextColorScheme = this.getColorScheme();

    if (
      previousColorScheme.dark !== nextColorScheme.dark ||
      previousColorScheme.highContrast !== nextColorScheme.highContrast
    ) {
      this.didChangeColorSchemeEmitter.fire(nextColorScheme);
    }
  }

  dispose(): void {
    this.disposables.dispose();
  }

  private updateNativeThemeSource(): void {
    switch (this.settings.theme) {
      case 'light':
        nativeTheme.themeSource = 'light';
        break;
      case 'dark':
        nativeTheme.themeSource = 'dark';
        break;
      case 'system':
        nativeTheme.themeSource = 'system';
        break;
    }
  }
}
