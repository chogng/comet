import type {
  AppTheme,
  ThemeColorCustomizations,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import {
  themeService,
} from 'ls/platform/theme/browser/themeService';
import type { ThemeKind } from 'ls/platform/theme/common/theme';
import { loadWorkbenchThemeWithCustomizations } from 'ls/workbench/services/themes/common/themeLoader';

function resolveThemeKind(theme: AppTheme): ThemeKind {
  if (theme === 'light' || theme === 'dark') {
    return theme;
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
  const themeKind = resolveThemeKind(theme);
  themeService.applyTheme(
    loadWorkbenchThemeWithCustomizations(themeKind, colorCustomizations),
    target,
  );
}
