import type {
  AppTheme,
  ThemeColorCustomizations,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import {
  themeService,
} from 'ls/platform/theme/browser/themeService';
import type {
  AppColorScheme,
  ThemeKind,
} from 'ls/platform/theme/common/theme';
import { loadWorkbenchThemeWithCustomizations } from 'ls/workbench/services/themes/common/themeLoader';

let hostColorScheme: AppColorScheme | null = null;
let appliedTheme: AppTheme = 'light';
let appliedColorCustomizations: ThemeColorCustomizations = {};

function resolveThemeKind(theme: AppTheme): ThemeKind {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }

  if (hostColorScheme) {
    return hostColorScheme.dark ? 'dark' : 'light';
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

export function applyWorkbenchTheme(
  theme: AppTheme = 'light',
  colorCustomizations: ThemeColorCustomizations = {},
  target: CSSStyleDeclaration = document.documentElement.style,
) {
  appliedTheme = theme;
  appliedColorCustomizations = { ...colorCustomizations };
  const themeKind = resolveThemeKind(theme);
  themeService.applyTheme(
    loadWorkbenchThemeWithCustomizations(themeKind, colorCustomizations),
    target,
  );
}

export function setWorkbenchHostColorScheme(colorScheme: AppColorScheme) {
  hostColorScheme = colorScheme;
  applyWorkbenchTheme(appliedTheme, appliedColorCustomizations);
}
