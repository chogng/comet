import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { Event } from 'cs/base/common/event';
import type { AppSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  AppColorScheme,
  PartsSplash,
} from 'cs/platform/theme/common/theme';

export const IThemeMainService =
  createDecorator<IThemeMainService>('themeMainService');

export interface IThemeMainService {
  readonly _serviceBrand: undefined;
  readonly onDidChangeColorScheme: Event<AppColorScheme>;
  getBackgroundColor(): string;
  getColorScheme(): AppColorScheme;
  getWindowSplash(): PartsSplash | undefined;
  saveWindowSplash(windowId: number | undefined, splash: PartsSplash): void;
  updateSettings(settings: AppSettings): void;
}
