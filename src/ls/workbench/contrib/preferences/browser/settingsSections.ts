import type { Locale } from 'language/i18n';
import { DEFAULT_EDITOR_DRAFT_BODY_COLOR } from 'ls/base/common/editorDraftStyle';
import { createDateInput } from 'ls/base/browser/ui/dateInput/dateInput';
import {
  createSettingsSection,
  createSettingsRow,
} from 'ls/workbench/contrib/preferences/browser/section';
import {
  buildSettingsButton as buildButton,
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  buildSettingsSwitch as buildSwitch,
  createSettingsElement as el,
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

function createStartupLayoutOptions(props: SettingsPartProps): readonly SelectOption[] {
  return [
    { value: 'agent', label: props.labels.settingsStartupLayoutAgent },
    { value: 'flow', label: props.labels.settingsStartupLayoutFlow },
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
  const field = el('div', 'settings-batch-settings');
  const batchOptions = createSettingsSection({
    sectionClassName: 'settings-batch-options-section',
    panelClassName: 'settings-batch-options-panel',
    listClassName: 'settings-batch-options-list',
  });
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

  const dateOptions = createSettingsSection({
    sectionClassName: 'settings-batch-date-section',
    panelClassName: 'settings-batch-date-panel',
    listClassName: 'settings-batch-date-list',
  });
  const startDateInput = createDateInput({
    value: props.fetchStartDate,
    labels: {
      calendar: props.labels.startDate,
      clear: props.labels.clearDate,
      today: props.labels.today,
    },
    className: 'settings-date-input',
    inputClassName: 'settings-inputbox settings-input-control settings-date-input-field',
    focusKey: 'settings.batch.startDate',
    onInput: props.onFetchStartDateChange,
  }).getElement();
  const endDateInput = createDateInput({
    value: props.fetchEndDate,
    labels: {
      calendar: props.labels.endDate,
      clear: props.labels.clearDate,
      today: props.labels.today,
    },
    className: 'settings-date-input',
    inputClassName: 'settings-inputbox settings-input-control settings-date-input-field',
    focusKey: 'settings.batch.endDate',
    onInput: props.onFetchEndDateChange,
  }).getElement();
  batchOptions.list.append(
    createSettingsRow({
      title: props.labels.settingsBatchOptions,
      description: props.labels.settingsBatchHint,
      control: wrap,
      itemClassName: 'settings-batch-options-item',
      controlClassName: 'settings-batch-options-control',
    }),
  );
  dateOptions.list.append(
    createSettingsRow({
      title: props.labels.startDate,
      control: startDateInput,
      itemClassName: 'settings-batch-date-item',
      controlClassName: 'settings-batch-date-control',
    }),
    createSettingsRow({
      title: props.labels.endDate,
      control: endDateInput,
      itemClassName: 'settings-batch-date-item',
      controlClassName: 'settings-batch-date-control',
    }),
  );
  field.append(batchOptions.element, dateOptions.element);
  return field;
}

function getJournalOverrideTitle(props: SettingsPartProps, url: string) {
  const override = props.journalSourceOverrides.find((item) => item.url === url);
  return override?.journalTitle ?? null;
}

export function renderSupportedSourcesSection(props: SettingsPartProps) {
  const supportedSources = createSettingsSection({
    title: props.labels.settingsSupportedSources,
    description: props.labels.settingsSupportedSourcesHint,
    sectionClassName: 'settings-supported-sources-section',
    panelClassName: 'settings-supported-sources-panel',
    listClassName: 'settings-supported-sources-list',
  });

  const table = el('div', 'settings-supported-sources-table');
  table.hidden = !props.showSupportedSources;
  for (const [index, source] of props.supportedSources.entries()) {
    const row = el('div', 'settings-supported-source-row');
    const url = el('div', 'settings-supported-source-url');
    url.textContent = source.url;
    url.title = `${props.labels.settingsSupportedSourceUrl}: ${source.url}`;

    const journalCell = el('div', 'settings-supported-source-journal-cell');
    const effectiveJournalTitle = getJournalOverrideTitle(props, source.url) ?? source.journalTitle;
    const journalLabel = el('div', 'settings-supported-source-journal');
    journalLabel.textContent = effectiveJournalTitle || '-';
    journalLabel.title = props.labels.settingsSupportedSourceJournalTitle;
    const journalInput = buildInput({
      value: effectiveJournalTitle,
      className: 'settings-supported-source-journal-input',
      focusKey: `settings.supportedSources.${index}.journalTitle`,
      disabled: props.isSettingsSaving,
      onInput: (value) => props.onJournalSourceTitleChange(source.url, value),
    });
    journalInput.inputElement.ariaLabel = props.labels.settingsSupportedSourceJournalTitle;
    journalCell.append(journalLabel, journalInput.element);

    row.append(url, journalCell);
    table.append(row);
  }

  supportedSources.list.append(
    createSettingsRow({
      title: props.labels.settingsSupportedSources,
      description: props.labels.settingsSupportedSourcesHint,
      control: buildButton({
        label: props.showSupportedSources
          ? props.labels.settingsSupportedSourcesHide
          : props.labels.settingsSupportedSourcesShow,
        focusKey: 'settings.supportedSources.toggle',
        title: props.showSupportedSources
          ? props.labels.settingsSupportedSourcesHide
          : props.labels.settingsSupportedSourcesShow,
        disabled: props.isSettingsSaving,
        onClick: props.onToggleSupportedSources,
      }),
      itemClassName: 'settings-supported-sources-actions-item',
      controlClassName: 'settings-supported-sources-actions',
    }),
  );
  supportedSources.panel.append(table);
  return supportedSources.element;
}

export function renderLayoutSection(props: SettingsPartProps) {
  const layout = createSettingsSection({
    title: props.labels.settingsLayoutTitle,
    sectionClassName: 'settings-layout-section',
    panelClassName: 'settings-layout-panel',
    listClassName: 'settings-layout-list',
  });
  const startupLayoutSelect = buildSelect(
    createStartupLayoutOptions(props),
    props.startupLayout,
    'settings.general.layout.startupLayout',
    (value) => {
      props.onStartupLayoutChange(value === 'agent' ? 'agent' : 'flow');
    },
    'settings-layout-startup-layout-select',
  );
  setSelectHostDisabled(startupLayoutSelect, props.isSettingsSaving);
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
      title: props.labels.settingsStartupLayout,
      description: props.labels.settingsStartupLayoutHint,
      control: startupLayoutSelect,
    }),
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
  const field = el('div', 'settings-appearance-settings');
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
  field.append(appearanceTheme.element, appearanceToggles.element);
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
  const field = el('div', 'settings-download-settings');
  const effectiveDownloadDir = props.pdfDownloadDir.trim() || props.labels.systemDownloads;
  const downloadDirectory = createSettingsSection({
    sectionClassName: 'settings-download-directory-section',
    panelClassName: 'settings-download-directory-panel',
    listClassName: 'settings-download-directory-list',
  });
  downloadDirectory.list.append(
    createSettingsRow({
      title: props.labels.defaultPdfDir,
      description: effectiveDownloadDir,
      control: buildButton({
        label: props.labels.change,
        focusKey: 'settings.download.open',
        title: props.labels.chooseDirectory,
        disabled: !props.desktopRuntime || props.isSettingsSaving,
        onClick: props.onChoosePdfDownloadDir,
      }),
      itemClassName: 'settings-download-directory-item',
      controlClassName: 'settings-download-directory-control',
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
  field.append(downloadDirectory.element, downloadOptions.element);
  return field;
}

export function renderConfigPathSection(props: SettingsPartProps) {
  const configPath = createSettingsSection({
    sectionClassName: 'settings-config-path-section',
    panelClassName: 'settings-config-path-panel',
    listClassName: 'settings-config-path-list',
  });
  configPath.list.append(
    createSettingsRow({
      title: props.labels.settingsConfigPath,
      description: props.configPath.trim() || '-',
      control: buildButton({
        label: props.labels.change,
        focusKey: 'settings.config.open',
        title: props.labels.changeConfigLocation,
        disabled: !props.desktopRuntime || props.isSettingsSaving || !props.configPath.trim(),
        onClick: props.onChooseConfigPath,
      }),
      itemClassName: 'settings-config-path-item',
      controlClassName: 'settings-config-path-control',
    }),
  );
  return configPath.element;
}

export function renderTextEditorSection(props: SettingsPartProps) {
  const defaultBodyStyle = props.editorDraftStyle.value.defaultBodyStyle;
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
  );

  return textEditorPanel.element;
}
