import type { Locale } from 'language/i18n';
import { DEFAULT_EDITOR_DRAFT_BODY_COLOR } from 'ls/base/common/editorDraftStyle';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicon/lxiconSemantic';
import {
  createSettingsSection,
  createSettingsRow,
} from 'ls/workbench/contrib/preferences/browser/section';
import {
  buildSettingsButton as buildButton,
  buildSettingsCheckbox as buildCheckbox,
  buildSettingsHint as buildHint,
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  buildSettingsSwitch as buildSwitch,
  createSettingsElement as el,
  createSettingsText as text,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';
import { buildSettingsNumberStepperInput as buildNumberStepperInput } from 'ls/workbench/contrib/preferences/browser/settingsNumberStepperInput';
import type {
  SettingsDropdownOption,
  SettingsPartProps,
} from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import {
  createDisplayLanguageOptions,
  requestSetDisplayLanguage,
} from 'ls/workbench/contrib/localization/browser/localizationsActions';
import { batchLimitMax, batchLimitMin } from 'ls/workbench/services/config/configSchema';
import {
  maxBrowserTabKeepAliveLimit,
  minBrowserTabKeepAliveLimit,
} from 'ls/workbench/services/webContent/webContentRetentionConfig';

type SelectOption = SettingsDropdownOption;

function setSelectHostDisabled(host: HTMLElement, disabled: boolean) {
  const selectElement = host.querySelector<HTMLSelectElement>('.ls-select-box');
  if (selectElement) {
    selectElement.disabled = disabled;
  }
}

function createThemeOptions(props: SettingsPartProps): readonly SelectOption[] {
  return [
    { value: 'light', label: props.labels.settingsThemeLight },
    { value: 'dark', label: props.labels.settingsThemeDark },
    { value: 'system', label: props.labels.settingsThemeSystem },
  ];
}

function ensureCurrentSelectOption(
  options: readonly SelectOption[],
  currentValue: string,
): readonly SelectOption[] {
  const normalizedCurrentValue = currentValue.trim();
  if (!normalizedCurrentValue) {
    return options;
  }

  const hasCurrentValue = options.some(
    (option) => option.value.trim() === normalizedCurrentValue,
  );
  if (hasCurrentValue) {
    return options;
  }

  return [
    {
      value: normalizedCurrentValue,
      label: normalizedCurrentValue,
      title: normalizedCurrentValue,
    },
    ...options,
  ];
}

function toHexChannel(value: number) {
  const clamped = Math.min(255, Math.max(0, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

function parseRgbChannel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.endsWith('%')) {
    const numericPercent = Number.parseFloat(normalized.slice(0, -1));
    if (!Number.isFinite(numericPercent)) {
      return null;
    }
    return (numericPercent / 100) * 255;
  }

  const numericValue = Number.parseFloat(normalized);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue;
}

function rgbFunctionToHex(value: string) {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^rgba?\((.*)\)$/i);
  if (!match) {
    return null;
  }

  const content = match[1].trim();
  const slashIndex = content.indexOf('/');
  const channelsPart = slashIndex >= 0 ? content.slice(0, slashIndex) : content;
  const channelTokens = channelsPart.includes(',')
    ? channelsPart.split(',').map((token) => token.trim()).filter(Boolean)
    : channelsPart.split(/\s+/).filter(Boolean);
  if (channelTokens.length < 3) {
    return null;
  }

  const red = parseRgbChannel(channelTokens[0]);
  const green = parseRgbChannel(channelTokens[1]);
  const blue = parseRgbChannel(channelTokens[2]);
  if (red === null || green === null || blue === null) {
    return null;
  }

  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

function normalizeHexColor(value: string) {
  const normalizedValue = value.trim();
  if (/^#(?:[0-9a-fA-F]{6})$/.test(normalizedValue)) {
    return normalizedValue.toLowerCase();
  }

  const shortHexMatch = normalizedValue.match(/^#([0-9a-fA-F]{3})$/);
  if (!shortHexMatch) {
    return null;
  }

  const [, shortHex] = shortHexMatch;
  const expandedHex = shortHex
    .split('')
    .map((channel) => `${channel}${channel}`)
    .join('');
  return `#${expandedHex}`.toLowerCase();
}

function resolveColorToHex(colorValue: string) {
  const normalizedHexColor = normalizeHexColor(colorValue);
  if (normalizedHexColor) {
    return normalizedHexColor;
  }

  const normalizedRgbColor = rgbFunctionToHex(colorValue);
  if (normalizedRgbColor) {
    return normalizedRgbColor;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = colorValue.trim();
  if (!probe.style.color) {
    return null;
  }

  return normalizeHexColor(probe.style.color) ?? rgbFunctionToHex(probe.style.color);
}

function toColorPickerValue(colorValue: string) {
  return resolveColorToHex(colorValue)
    ?? resolveColorToHex(DEFAULT_EDITOR_DRAFT_BODY_COLOR)
    ?? '#000000';
}

export function renderLocaleSection(props: SettingsPartProps) {
  const language = createSettingsSection({
    sectionClassName: 'settings-language-section',
    panelClassName: 'settings-language-panel',
    listClassName: 'settings-language-list',
  });
  const select = buildSelect(
    createDisplayLanguageOptions(props.labels),
    props.locale,
    'settings.locale',
    (value) => requestSetDisplayLanguage(value as Locale),
    'settings-language-toggle',
  );
  language.list.append(
    createSettingsRow({
      title: props.labels.settingsLanguage,
      description: props.labels.settingsLanguageHint,
      control: select,
    }),
  );
  return language.element;
}

export function renderBatchOptionsSection(props: SettingsPartProps) {
  const field = el('div', 'settings-field');
  const title = el('span');
  title.textContent = props.labels.settingsBatchOptions;
  const row = el('div', 'settings-batch-options');
  const limitLabel = el('div', 'inline-field');
  const wrap = el('div', 'settings-limit-input-wrap');
  wrap.append(buildNumberStepperInput({
    value: props.batchLimit,
    className: 'settings-limit-input',
    focusKey: 'settings.batch.limit',
    min: String(batchLimitMin),
    max: String(batchLimitMax),
    inputMode: 'numeric',
    step: '1',
    onInput: props.onBatchLimitChange,
    disabled: props.isSettingsSaving,
  }).element);
  limitLabel.append(text(props.labels.batchCount), wrap);
  const checkboxLabel = el('label', 'inline-field checkbox-field');
  checkboxLabel.append(
    buildCheckbox({
      checked: props.sameDomainOnly,
      className: 'radix-checkbox',
      focusKey: 'settings.batch.sameDomain',
      onChange: props.onSameDomainOnlyChange,
    }),
    text(props.labels.sameDomainOnly),
  );
  const dateRow = el('div', 'settings-batch-date-row');
  const startDateField = el('div', 'settings-field settings-batch-date-field');
  startDateField.append(
    text(props.labels.startDate),
    buildInput({
      type: 'date',
      value: props.fetchStartDate,
      className: 'settings-input-control',
      focusKey: 'settings.batch.startDate',
      onInput: props.onFetchStartDateChange,
    }).element,
  );
  const endDateField = el('div', 'settings-field settings-batch-date-field');
  endDateField.append(
    text(props.labels.endDate),
    buildInput({
      type: 'date',
      value: props.fetchEndDate,
      className: 'settings-input-control',
      focusKey: 'settings.batch.endDate',
      onInput: props.onFetchEndDateChange,
    }).element,
  );
  dateRow.append(startDateField, endDateField);
  row.append(limitLabel, checkboxLabel);
  field.append(title, row, dateRow, buildHint(props.labels.settingsBatchHint));
  return field;
}

export function renderLayoutSection(props: SettingsPartProps) {
  const layout = createSettingsSection({
    title: props.labels.settingsLayoutTitle,
    sectionClassName: 'settings-layout-section',
    panelClassName: 'settings-layout-panel',
    listClassName: 'settings-layout-list',
  });
  const browserTabKeepAliveLimitInput = buildNumberStepperInput({
    value: props.browserTabKeepAliveLimit,
    className: 'settings-limit-input',
    focusKey: 'settings.general.layout.browserTabKeepAliveLimit',
    min: String(minBrowserTabKeepAliveLimit),
    max: String(maxBrowserTabKeepAliveLimit),
    inputMode: 'numeric',
    step: '1',
    onInput: props.onBrowserTabKeepAliveLimitChange,
    disabled: props.isSettingsSaving,
  });
  layout.list.append(
    createSettingsRow({
      title: props.labels.settingsStatusbar,
      description: props.labels.settingsStatusbarHint,
      control: buildSwitch({
        checked: props.statusbarVisible,
        focusKey: 'settings.general.layout.statusbarVisible',
        disabled: props.isSettingsSaving,
        title: props.labels.settingsStatusbar,
        onChange: props.onStatusbarVisibleChange,
      }),
    }),
    createSettingsRow({
      title: props.labels.settingsBrowserTabKeepAliveLimit,
      description: props.labels.settingsBrowserTabKeepAliveLimitHint,
      control: browserTabKeepAliveLimitInput.element,
    }),
  );
  return layout.element;
}

export function renderAppearanceSection(props: SettingsPartProps) {
  const field = el('div', 'settings-field');
  const title = el('span');
  title.textContent = props.labels.settingsAppearanceTitle;
  const themeSelect = buildSelect(
    createThemeOptions(props),
    props.theme,
    'settings.appearance.theme',
    (value) => {
      const nextTheme =
        value === 'dark' || value === 'light' || value === 'system'
          ? value
          : 'light';
      props.onThemeChange(nextTheme);
    },
    'settings-appearance-theme-select',
  );
  setSelectHostDisabled(themeSelect, props.isSettingsSaving);
  const appearanceTheme = createSettingsSection({
    sectionClassName: 'settings-appearance-theme-section',
    panelClassName: 'settings-appearance-theme-panel',
    listClassName: 'settings-appearance-theme-list',
  });
  appearanceTheme.list.append(
    createSettingsRow({
      title: props.labels.settingsTheme,
      description: props.labels.settingsThemeHint,
      control: themeSelect,
    }),
  );
  const appearanceToggles = createSettingsSection({
    sectionClassName: 'settings-appearance-toggles-section',
    panelClassName: 'settings-appearance-toggles-panel',
    listClassName: 'settings-appearance-toggles-list',
  });
  appearanceToggles.list.append(
    createSettingsRow({
      title: props.labels.settingsUseMica,
      description: props.labels.settingsUseMicaHint,
      control: buildSwitch({
        checked: props.useMica,
        focusKey: 'settings.appearance.useMica',
        disabled: props.isSettingsSaving || !props.desktopRuntime,
        title: props.labels.settingsUseMica,
        onChange: props.onUseMicaChange,
      }),
    }),
  );
  field.append(title, appearanceTheme.element, appearanceToggles.element);
  return field;
}

export function renderNotificationsSection(props: SettingsPartProps) {
  const notifications = createSettingsSection({
    title: props.labels.settingsNotificationsTitle,
    sectionClassName: 'settings-notifications-section',
    panelClassName: 'settings-notifications-panel',
    listClassName: 'settings-notifications-list',
  });
  const notificationsDisabled = props.isSettingsSaving || !props.desktopRuntime;
  notifications.list.append(
    createSettingsRow({
      title: props.labels.settingsSystemNotifications,
      description: props.labels.settingsSystemNotificationsHint,
      control: buildSwitch({
        checked: props.systemNotificationsEnabled,
        focusKey: 'settings.general.notifications.system',
        disabled: notificationsDisabled,
        title: props.labels.settingsSystemNotifications,
        onChange: props.onSystemNotificationsEnabledChange,
      }),
    }),
    createSettingsRow({
      title: props.labels.settingsWarningNotifications,
      description: props.labels.settingsWarningNotificationsHint,
      control: buildSwitch({
        checked: props.warningNotificationsEnabled,
        focusKey: 'settings.general.notifications.warning',
        disabled: notificationsDisabled,
        title: props.labels.settingsWarningNotifications,
        onChange: props.onWarningNotificationsEnabledChange,
      }),
    }),
    createSettingsRow({
      title: props.labels.settingsMenuBarIcon,
      description: props.labels.settingsMenuBarIconHint,
      control: buildSwitch({
        checked: props.menuBarIconEnabled,
        focusKey: 'settings.general.notifications.menuBarIcon',
        disabled: notificationsDisabled,
        title: props.labels.settingsMenuBarIcon,
        onChange: props.onMenuBarIconEnabledChange,
      }),
    }),
    createSettingsRow({
      title: props.labels.settingsCompletionNotifications,
      description: props.labels.settingsCompletionNotificationsHint,
      control: buildSwitch({
        checked: props.completionNotificationsEnabled,
        focusKey: 'settings.general.notifications.completion',
        disabled: notificationsDisabled,
        title: props.labels.settingsCompletionNotifications,
        onChange: props.onCompletionNotificationsEnabledChange,
      }),
    }),
  );
  return notifications.element;
}

export function renderDownloadDirectorySection(props: SettingsPartProps) {
  const field = el('div', 'settings-field');
  const title = el('span');
  title.textContent = props.labels.defaultPdfDir;
  const row = el('div', 'settings-input-row');
  row.append(
    buildInput({
      value: props.pdfDownloadDir,
      className: 'settings-input-control',
      focusKey: 'settings.download.dir',
      placeholder: props.labels.downloadDirPlaceholder,
      onInput: props.onPdfDownloadDirChange,
    }).element,
    buildButton({
      label: '...',
      icon: lxIconSemanticMap.settings.chooseDirectory,
      className: 'settings-btn-icon',
      focusKey: 'settings.download.choose',
      title: props.labels.chooseDirectory,
      disabled: !props.desktopRuntime || props.isSettingsSaving,
      onClick: props.onChoosePdfDownloadDir,
    }),
  );
  const downloadOptions = createSettingsSection({
    sectionClassName: 'settings-download-options-section',
    panelClassName: 'settings-download-options-panel',
    listClassName: 'settings-download-options-list',
  });
  downloadOptions.list.append(
    createSettingsRow({
      title: props.labels.pdfFileNameUseSelectionOrder,
      description: props.labels.pdfFileNameUseSelectionOrderHint,
      control: buildSwitch({
        checked: props.pdfFileNameUseSelectionOrder,
        focusKey: 'settings.download.selectionOrder',
        disabled: props.isSettingsSaving,
        title: props.labels.pdfFileNameUseSelectionOrder,
        onChange: props.onPdfFileNameUseSelectionOrderChange,
      }),
    }),
  );
  field.append(title, row, downloadOptions.element);
  return field;
}

export function renderConfigPathSection(props: SettingsPartProps) {
  const field = el('div', 'settings-field');
  const row = el('div', 'settings-input-row');
  row.append(
    buildInput({
      value: props.configPath,
      className: 'settings-input-control',
      focusKey: 'settings.config.path',
      readOnly: true,
    }).element,
    buildButton({
      label: '...',
      icon: lxIconSemanticMap.settings.openConfigLocation,
      className: 'settings-btn-icon',
      focusKey: 'settings.config.open',
      title: props.labels.openConfigLocation,
      disabled: !props.desktopRuntime || props.isSettingsSaving || !props.configPath.trim(),
      onClick: props.onOpenConfigLocation,
    }),
  );
  field.append(text(props.labels.settingsConfigPath), row);
  return field;
}

export function renderTextEditorSection(props: SettingsPartProps) {
  const field = el('div', 'settings-field settings-text-editor-field');
  const defaultBodyStyle = props.editorDraftStyle.defaultBodyStyle;
  const isDisabled = props.isSettingsSaving;
  const textEditorPanel = createSettingsSection({
    title: props.labels.settingsTextEditorDefaultBodyStyle,
    description: props.labels.settingsTextEditorHint,
    sectionClassName: 'settings-text-editor-section',
    panelClassName: 'settings-text-editor-panel',
    listClassName: 'settings-text-editor-list',
  });

  const fontFamilySelect = buildSelect(
    ensureCurrentSelectOption(
      props.editorDraftFontFamilyOptions,
      defaultBodyStyle.fontFamilyValue,
    ),
    defaultBodyStyle.fontFamilyValue,
    'settings.textEditor.fontFamily',
    props.onEditorDraftFontFamilyChange,
    'settings-text-editor-select',
  );
  setSelectHostDisabled(fontFamilySelect, isDisabled);
  const fontSizeSelect = buildSelect(
    ensureCurrentSelectOption(
      props.editorDraftFontSizeOptions,
      defaultBodyStyle.fontSizeValue,
    ),
    defaultBodyStyle.fontSizeValue,
    'settings.textEditor.fontSize',
    props.onEditorDraftFontSizeChange,
    'settings-text-editor-select',
  );
  setSelectHostDisabled(fontSizeSelect, isDisabled);
  const lineHeightInput = buildNumberStepperInput({
    value: defaultBodyStyle.lineHeight,
    className: 'settings-text-editor-line-height-input',
    focusKey: 'settings.textEditor.lineHeight',
    min: '0.5',
    max: '4',
    inputMode: 'decimal',
    step: '0.1',
    onInput: props.onEditorDraftLineHeightChange,
    disabled: isDisabled,
  });
  const paragraphSpacingBeforeInput = buildNumberStepperInput({
    value: defaultBodyStyle.paragraphSpacingBeforePt,
    className: 'settings-text-editor-spacing-input',
    focusKey: 'settings.textEditor.paragraphSpacingBefore',
    min: '0',
    max: '200',
    inputMode: 'decimal',
    step: '0.5',
    onInput: props.onEditorDraftParagraphSpacingBeforeChange,
    disabled: isDisabled,
  });
  const paragraphSpacingAfterInput = buildNumberStepperInput({
    value: defaultBodyStyle.paragraphSpacingAfterPt,
    className: 'settings-text-editor-spacing-input',
    focusKey: 'settings.textEditor.paragraphSpacingAfter',
    min: '0',
    max: '200',
    inputMode: 'decimal',
    step: '0.5',
    onInput: props.onEditorDraftParagraphSpacingAfterChange,
    disabled: isDisabled,
  });
  const colorRow = el('div', 'settings-text-editor-color-row');
  const colorPickerInput = buildInput({
    type: 'color',
    value: toColorPickerValue(defaultBodyStyle.color),
    className: 'settings-text-editor-color-picker',
    focusKey: 'settings.textEditor.colorPicker',
    onInput: props.onEditorDraftColorChange,
  });
  colorPickerInput.inputElement.disabled = isDisabled;
  const colorValueInput = buildInput({
    value: defaultBodyStyle.color,
    className: 'settings-input-control settings-text-editor-color-value',
    focusKey: 'settings.textEditor.colorValue',
    readOnly: true,
  });
  colorRow.append(colorPickerInput.element, colorValueInput.element);

  const resetButton = buildButton({
    label: props.labels.resetDefault,
    className: 'settings-text-editor-reset-button',
    focusKey: 'settings.textEditor.resetDefaultBodyStyle',
    disabled: isDisabled,
    onClick: props.onResetEditorDraftStyle,
  });

  textEditorPanel.list.append(
    createSettingsRow({
      title: props.labels.settingsTextEditorFontFamily,
      control: fontFamilySelect,
    }),
    createSettingsRow({
      title: props.labels.settingsTextEditorFontSize,
      control: fontSizeSelect,
    }),
    createSettingsRow({
      title: props.labels.settingsTextEditorLineHeight,
      control: lineHeightInput.element,
    }),
    createSettingsRow({
      title: props.labels.settingsTextEditorParagraphSpacingBefore,
      control: paragraphSpacingBeforeInput.element,
    }),
    createSettingsRow({
      title: props.labels.settingsTextEditorParagraphSpacingAfter,
      control: paragraphSpacingAfterInput.element,
    }),
    createSettingsRow({
      title: props.labels.settingsTextEditorColor,
      control: colorRow,
    }),
    createSettingsRow({
      title: props.labels.resetDefault,
      control: resetButton,
    }),
  );

  field.append(textEditorPanel.element);
  return field;
}
