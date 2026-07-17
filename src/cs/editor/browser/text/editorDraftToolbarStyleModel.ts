import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import { resolvePrimaryFontFamily } from 'cs/base/common/editorFormat';
import type { EditorDraftStyleOption } from 'cs/editor/browser/services/editorDraftStyleCatalog';
import type { EditorDraftStyleServiceSnapshot } from 'cs/editor/browser/services/editorDraftStyleService';

export type EditorDraftToolbarFontModel = {
  currentValue: string;
  currentLabel: string;
  options: readonly DropdownOption[];
};

export type EditorDraftToolbarFontFamilyModel = EditorDraftToolbarFontModel & {
  defaultValue: string;
};

export type EditorDraftToolbarFontSizeModel = EditorDraftToolbarFontModel & {
  defaultValue: string;
};

export type EditorDraftToolbarStyleModel = {
  fontFamily: EditorDraftToolbarFontFamilyModel;
  fontSize: EditorDraftToolbarFontSizeModel;
};

type BuildEditorDraftToolbarStyleModelParams = {
  fontFamilyValue: string | null;
  fontSizeValue: string | null;
  defaultTextStyleLabel: string;
  snapshot: EditorDraftStyleServiceSnapshot;
};

const fontAvailabilityCache = new Map<string, boolean>();
let cachedFontSetReference: object | null = null;

function normalizeFontFamilyValue(value: string) {
  return value
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean)
    .join(',');
}

function isPrimaryFontAvailable(value: string) {
  const primaryFamily = resolvePrimaryFontFamily(value);
  if (!primaryFamily) {
    return true;
  }

  if (typeof document === 'undefined') {
    return true;
  }

  const fontSet = (document as Document & {
    fonts?: {
      check?: (font: string, text?: string) => boolean;
    };
  }).fonts;
  const fontSetReference = (fontSet ?? null) as object | null;

  if (cachedFontSetReference !== fontSetReference) {
    fontAvailabilityCache.clear();
    cachedFontSetReference = fontSetReference;
  }

  const cachedResult = fontAvailabilityCache.get(primaryFamily);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const isAvailable = typeof fontSet?.check === 'function'
    ? fontSet.check(`12px "${primaryFamily}"`, 'A中')
    : true;

  fontAvailabilityCache.set(primaryFamily, isAvailable);
  return isAvailable;
}

function withFontAvailability(option: DropdownOption) {
  if (!option.value) {
    return option;
  }

  if (isPrimaryFontAvailable(option.value)) {
    return option;
  }

  return {
    ...option,
    label: `${option.label} (未安装)`,
    title: `${option.title ?? option.label} · 当前系统未检测到该字体，实际显示会回退到后备字体`,
    disabled: true,
  } satisfies DropdownOption;
}

function toDropdownOption(option: EditorDraftStyleOption): DropdownOption {
  return {
    value: option.value,
    label: option.label,
    title: option.title,
  };
}

function findMatchingOption(
  value: string,
  options: readonly DropdownOption[],
  matchesPresetValue?: (candidateValue: string, optionValue: string) => boolean,
) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return options.find((option) => {
    const optionValue = option.value.trim();
    return optionValue === normalizedValue
      || (matchesPresetValue?.(normalizedValue, optionValue) ?? false);
  }) ?? null;
}

function createTextStyleOptions(
  currentValue: string | null,
  presetValues: readonly DropdownOption[],
  defaultLabel: string,
  config?: {
    matchesPresetValue?: (currentValue: string, presetValue: string) => boolean;
    includeDefaultOption?: boolean;
  },
) {
  const options: DropdownOption[] = [];
  if (config?.includeDefaultOption ?? true) {
    options.push({
      value: '',
      label: defaultLabel,
    });
  }

  const seenValues = new Set<string>();
  const appendOption = (option: DropdownOption) => {
    const normalized = option.value.trim();
    if (!normalized || seenValues.has(normalized)) {
      return;
    }
    seenValues.add(normalized);
    options.push({
      value: normalized,
      label: option.label,
      title: option.title ?? normalized,
      disabled: option.disabled,
    });
  };

  const appendAliasOption = (value: string, option: DropdownOption) => {
    const normalized = value.trim();
    if (!normalized || seenValues.has(normalized)) {
      return;
    }
    seenValues.add(normalized);
    options.push({
      value: normalized,
      label: option.label,
      title: option.title ?? normalized,
      disabled: option.disabled,
    });
  };

  const appendRawValue = (value: string) => {
    const normalized = value.trim();
    if (!normalized || seenValues.has(normalized)) {
      return;
    }
    seenValues.add(normalized);
    options.push({
      value: normalized,
      label: normalized,
      title: normalized,
    });
  };

  const matchedPreset = currentValue
    ? presetValues.find((option) => {
        if (option.value.trim() === currentValue.trim()) {
          return true;
        }

        return config?.matchesPresetValue?.(currentValue, option.value) ?? false;
      }) ?? null
    : null;

  // Keep the current selection visible even when the browser normalizes
  // the value format (for example, quoted/unquoted font-family lists).
  if (currentValue && matchedPreset) {
    appendAliasOption(currentValue, matchedPreset);
  } else if (currentValue) {
    appendRawValue(currentValue);
  }

  for (const presetValue of presetValues) {
    appendOption(presetValue);
  }

  return options;
}

export function createEditorDraftToolbarStyleModel(
  params: BuildEditorDraftToolbarStyleModelParams,
): EditorDraftToolbarStyleModel {
	const snapshot = params.snapshot;
  const defaultFontFamilyValue = snapshot.defaultBodyStyle.fontFamilyValue;
  const defaultFontSizeValue = snapshot.defaultBodyStyle.fontSizeValue;
  const fontFamilyMatch = (currentValue: string, presetValue: string) =>
    normalizeFontFamilyValue(currentValue) === normalizeFontFamilyValue(presetValue);
  const fontFamilyOptions = createTextStyleOptions(
    params.fontFamilyValue,
    snapshot.fontFamilyPresets.map(toDropdownOption).map(withFontAvailability),
    params.defaultTextStyleLabel,
    {
      includeDefaultOption: false,
      matchesPresetValue: fontFamilyMatch,
    },
  );

  const fontSizeOptions = createTextStyleOptions(
    params.fontSizeValue,
    snapshot.fontSizePresets.map(toDropdownOption),
    params.defaultTextStyleLabel,
    {
      includeDefaultOption: false,
    },
  );

  const fontFamilyCurrentValue = params.fontFamilyValue?.trim() ?? '';
  const defaultFontFamilyOption = findMatchingOption(
    defaultFontFamilyValue,
    fontFamilyOptions,
    fontFamilyMatch,
  );
  const fontFamilyCurrentOption = findMatchingOption(
    fontFamilyCurrentValue,
    fontFamilyOptions,
    fontFamilyMatch,
  ) ?? (!fontFamilyCurrentValue ? defaultFontFamilyOption : null);

  const defaultFontSizeOption = findMatchingOption(defaultFontSizeValue, fontSizeOptions);
  const fontSizeCurrentValue = params.fontSizeValue?.trim() ?? '';
  const fontSizeCurrentOption = findMatchingOption(fontSizeCurrentValue, fontSizeOptions)
    ?? (!fontSizeCurrentValue ? defaultFontSizeOption : null);

  return {
    fontFamily: {
      currentValue: fontFamilyCurrentValue,
      currentLabel:
        (fontFamilyCurrentOption?.label ?? fontFamilyCurrentValue)
        || defaultFontFamilyOption?.label
        || params.defaultTextStyleLabel,
      defaultValue: defaultFontFamilyOption?.value ?? defaultFontFamilyValue,
      options: fontFamilyOptions,
    },
    fontSize: {
      currentValue: fontSizeCurrentValue,
      currentLabel:
        (fontSizeCurrentOption?.label ?? fontSizeCurrentValue)
        || defaultFontSizeOption?.label
        || defaultFontSizeValue
        || params.defaultTextStyleLabel,
      defaultValue: defaultFontSizeOption?.value ?? defaultFontSizeValue,
      options: fontSizeOptions,
    },
  };
}
