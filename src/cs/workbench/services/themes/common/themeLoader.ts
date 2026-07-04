import type { ColorIdentifier } from 'cs/platform/theme/common/colorRegistry';
import type { ThemeColorCustomizations } from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  createColorThemeData,
  type ColorThemeData,
  type ThemeKind,
} from 'cs/platform/theme/common/theme';
import darkThemeDefinition from 'cs/workbench/services/themes/common/themes/dark.json';
import lightThemeDefinition from 'cs/workbench/services/themes/common/themes/light.json';

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
