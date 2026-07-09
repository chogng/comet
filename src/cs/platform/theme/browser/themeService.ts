import {
  asCssVariableName,
  getRegisteredColors,
  type ColorIdentifier,
} from 'cs/platform/theme/common/colorRegistry';
import { EventEmitter, type Event } from 'cs/base/common/event';
import {
  createColorThemeData,
  resolveThemeDefaultColor,
  type ColorThemeData,
  type ThemeKind,
} from 'cs/platform/theme/common/theme';
import type {
  IColorTheme,
  IThemeService as IPlatformThemeService,
} from 'cs/platform/theme/common/themeService';

export interface IThemeService {
  readonly onDidColorThemeChange: Event<ColorThemeData>;
  applyTheme(theme?: ColorThemeData, target?: CSSStyleDeclaration): void;
  setTheme(theme: ColorThemeData): void;
  getTheme(): ColorThemeData;
  getColor(colorId: ColorIdentifier): string | null;
}

const DEFAULT_THEME: ColorThemeData = createColorThemeData({
  kind: 'light',
});

export class ThemeService implements IThemeService, IPlatformThemeService {
  declare readonly _serviceBrand: undefined;

  private theme = DEFAULT_THEME;
  private readonly didColorThemeChangeEmitter = new EventEmitter<ColorThemeData>();
  readonly onDidColorThemeChange = this.didColorThemeChangeEmitter.event;

  applyTheme(
    theme: ColorThemeData = this.theme,
    target: CSSStyleDeclaration = document.documentElement.style,
  ) {
    const nextTheme = createColorThemeData(theme);
    this.theme = nextTheme;

    for (const color of getRegisteredColors()) {
      const value =
        nextTheme.colors?.[color.id] ??
        resolveThemeDefaultColor(color.defaults, nextTheme.kind);
      target.setProperty(asCssVariableName(color.id), value);
    }

    for (const [name, value] of Object.entries(nextTheme.variables ?? {})) {
      target.setProperty(name, value);
    }

    this.didColorThemeChangeEmitter.fire(this.getTheme());
  }

  setTheme(theme: ColorThemeData) {
    this.theme = createColorThemeData(theme);
  }

  getTheme() {
    return createColorThemeData(this.theme);
  }

  getColor(colorId: ColorIdentifier) {
    const registered = getRegisteredColors().find((color) => color.id === colorId);
    if (!registered) {
      return null;
    }

    return (
      this.theme.colors?.[colorId] ??
      resolveThemeDefaultColor(registered.defaults, this.theme.kind)
    );
  }

  getColorTheme(): IColorTheme {
    return {
      getColor: colorId => {
        const color = this.getColor(colorId as ColorIdentifier);
        return color === null ? undefined : { toString: () => color };
      },
    };
  }
}

export const themeService = new ThemeService();

export function createThemeData(
  kind: ThemeKind,
  colors?: Partial<Record<ColorIdentifier, string>>,
  variables?: Record<string, string>,
): ColorThemeData {
  return createColorThemeData({
    kind,
    colors,
    variables,
  });
}
