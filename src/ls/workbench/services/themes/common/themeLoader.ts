import type { ColorIdentifier } from 'ls/platform/theme/common/colorRegistry';
import type { ThemeColorCustomizations } from 'ls/base/parts/sandbox/common/sandboxTypes';
import {
  createColorThemeData,
  type ColorThemeData,
  type ThemeKind,
} from 'ls/platform/theme/common/theme';
import darkThemeDefinition from 'ls/workbench/services/themes/common/themes/dark.json';
import lightThemeDefinition from 'ls/workbench/services/themes/common/themes/light.json';

type ThemeJsonDefinition = {
  colors?: Partial<Record<ColorIdentifier, string>>;
  variables?: Record<string, string>;
};

const THEME_DEFINITIONS: Record<ThemeKind, ThemeJsonDefinition> = {
  light: lightThemeDefinition,
  dark: darkThemeDefinition,
};

export function loadWorkbenchTheme(kind: ThemeKind): ColorThemeData {
  return loadWorkbenchThemeWithCustomizations(kind);
}

export function loadWorkbenchThemeWithCustomizations(
  kind: ThemeKind,
  colorCustomizations: ThemeColorCustomizations = {},
): ColorThemeData {
  const definition = THEME_DEFINITIONS[kind];
  return createColorThemeData({
    kind,
    colors: {
      ...definition.colors,
      ...colorCustomizations as Partial<Record<ColorIdentifier, string>>,
    },
    variables: definition.variables,
  });
}
