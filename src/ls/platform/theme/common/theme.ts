import type { ColorIdentifier } from 'ls/platform/theme/common/colorRegistry';

export type ThemeKind = 'light' | 'dark';
export type AppColorScheme = {
  dark: boolean;
  highContrast: boolean;
};

export type PartsSplash = {
  baseTheme: ThemeKind;
  colorInfo: {
    foreground: string | null;
    background: string;
    titleBarBackground: string | null;
    titleBarBorder: string | null;
    sideBarBackground: string | null;
    sideBarBorder: string | null;
    agentBarBackground: string | null;
    statusBarBackground: string | null;
    statusBarBorder: string | null;
    windowBorder: string | null;
  };
  layoutInfo?: {
    titleBarHeight: number;
    sideBarWidth: number;
    agentBarWidth: number;
    statusBarHeight: number;
  };
};

export type ThemeColorDefaults = {
  dark: string;
  light: string;
};

export type ColorThemeData = {
  kind: ThemeKind;
  colors?: Partial<Record<ColorIdentifier, string>>;
  variables?: Record<string, string>;
};

export function resolveThemeDefaultColor(
  defaults: ThemeColorDefaults,
  kind: ThemeKind,
) {
  return kind === 'dark' ? defaults.dark : defaults.light;
}

export function createColorThemeData(theme: ColorThemeData): ColorThemeData {
  return {
    kind: theme.kind,
    colors: { ...theme.colors },
    variables: { ...theme.variables },
  };
}
