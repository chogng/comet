import type { Locale } from 'language/i18n';
import { DEFAULT_EDITOR_DRAFT_BODY_COLOR } from 'cs/base/common/editorDraftStyle';
import {
  BrowserSearchEngineId,
  BROWSER_SEARCH_ENGINES,
  BROWSER_SEARCH_NONE,
} from 'cs/workbench/contrib/browserView/common/browserSearch';
import {
  browserZoomFactors,
  browserZoomLabel,
} from 'cs/platform/browserView/common/browserView';
import { MATCH_WINDOW_ZOOM_LABEL } from 'cs/workbench/contrib/browserView/common/browserZoomService';
import {
  maxBrowserMaxHistoryEntries,
  minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { createDateInput } from 'cs/base/browser/ui/dateInput/dateInput';
import type { ContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import {
  NumberStepper,
  numberStepperDecrementAriaLabel,
  numberStepperIncrementAriaLabel,
} from 'cs/base/browser/ui/numberStepper/numberStepper';
import {
  createSettingsSection,
  createSettingsRow,
} from 'cs/workbench/contrib/preferences/browser/section';
import {
  buildSettingsButton as buildButton,
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  buildSettingsSwitch as buildSwitch,
  createSettingsElement as el,
  settingsPopupContextViewLayer,
  setSettingsFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import type {
  SettingsDropdownOption,
  SettingsPartProps,
} from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import {
  createDisplayLanguageOptions,
  requestSetDisplayLanguage,
} from 'cs/workbench/contrib/localization/browser/localizationsActions';
import { batchLimitMax, batchLimitMin } from 'cs/workbench/services/config/configSchema';
import {
  maxBrowserTabKeepAliveLimit,
  minBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';

type SelectOption = SettingsDropdownOption;

function setSelectHostDisabled(host: HTMLElement, disabled: boolean) {
  const selectElement = host.querySelector<HTMLSelectElement>('.comet-select-box');
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

function createBrowserPageZoomOptions(props: SettingsPartProps): readonly SelectOption[] {
  return [
    {
      value: MATCH_WINDOW_ZOOM_LABEL,
      label: props.labels.settingsBrowserPageZoomMatchWindow,
    },
    ...browserZoomFactors.map(factor => ({
      value: browserZoomLabel(factor),
      label: browserZoomLabel(factor),
    })),
  ];
}

function createBrowserSearchEngineOptions(props: SettingsPartProps): readonly SelectOption[] {
  const labels: Record<BrowserSearchEngineId, string> = {
    [BrowserSearchEngineId.Bing]: props.labels.settingsBrowserSearchEngineBing,
    [BrowserSearchEngineId.Google]: props.labels.settingsBrowserSearchEngineGoogle,
    [BrowserSearchEngineId.Yahoo]: props.labels.settingsBrowserSearchEngineYahoo,
    [BrowserSearchEngineId.DuckDuckGo]: props.labels.settingsBrowserSearchEngineDuckDuckGo,
  };

  return [
    { value: BROWSER_SEARCH_NONE, label: props.labels.settingsBrowserSearchEngineNone },
    ...BROWSER_SEARCH_ENGINES.map(engine => ({
      value: engine.id,
      label: labels[engine.id],
    })),
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

export function renderLocaleSection(props: SettingsPartProps, contextViewProvider: ContextViewProvider) {
  const language = createSettingsSection({
    sectionClassName: 'comet-settings-language-section',
    panelClassName: 'comet-settings-language-panel',
    listClassName: 'comet-settings-language-list',
  });
  const select = buildSelect(
    createDisplayLanguageOptions(props.labels),
    props.locale,
    'settings.locale',
    (value) => requestSetDisplayLanguage(value as Locale),
    contextViewProvider,
    'comet-settings-language-toggle',
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
  const field = el('div', 'comet-settings-batch-settings');
  const batchOptions = createSettingsSection({
    sectionClassName: 'comet-settings-batch-options-section',
    panelClassName: 'comet-settings-batch-options-panel',
    listClassName: 'comet-settings-batch-options-list',
  });
  const wrap = el('div', 'comet-settings-limit-input-wrap');
  const batchLimitInput = new NumberStepper({
    value: props.batchLimit,
    className: 'comet-settings-number-stepper comet-settings-limit-input',
    min: String(batchLimitMin),
    max: String(batchLimitMax),
    inputMode: 'numeric',
    step: '1',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onBatchLimitChange,
    disabled: props.isSettingsSaving,
  });
  setSettingsFocusKey(batchLimitInput.inputElement, 'settings.batch.limit');
  wrap.append(batchLimitInput.element);

  const dateOptions = createSettingsSection({
    sectionClassName: 'comet-settings-batch-date-section',
    panelClassName: 'comet-settings-batch-date-panel',
    listClassName: 'comet-settings-batch-date-list',
  });
  const startDateInput = createDateInput({
    value: props.fetchStartDate,
    labels: {
      calendar: props.labels.startDate,
      clear: props.labels.clearDate,
      today: props.labels.today,
    },
    className: 'comet-settings-date-input',
    inputClassName: 'comet-settings-inputbox comet-settings-input-control comet-settings-date-input-field',
    focusKey: 'settings.batch.startDate',
    contextViewLayer: settingsPopupContextViewLayer,
    onInput: props.onFetchStartDateChange,
  }).getElement();
  const endDateInput = createDateInput({
    value: props.fetchEndDate,
    labels: {
      calendar: props.labels.endDate,
      clear: props.labels.clearDate,
      today: props.labels.today,
    },
    className: 'comet-settings-date-input',
    inputClassName: 'comet-settings-inputbox comet-settings-input-control comet-settings-date-input-field',
    focusKey: 'settings.batch.endDate',
    contextViewLayer: settingsPopupContextViewLayer,
    onInput: props.onFetchEndDateChange,
  }).getElement();
  batchOptions.list.append(
    createSettingsRow({
      title: props.labels.settingsBatchOptions,
      description: props.labels.settingsBatchHint,
      control: wrap,
      itemClassName: 'comet-settings-batch-options-item',
      controlClassName: 'comet-settings-batch-options-control',
    }),
  );
  dateOptions.list.append(
    createSettingsRow({
      title: props.labels.startDate,
      control: startDateInput,
      itemClassName: 'comet-settings-batch-date-item',
      controlClassName: 'comet-settings-batch-date-control',
    }),
    createSettingsRow({
      title: props.labels.endDate,
      control: endDateInput,
      itemClassName: 'comet-settings-batch-date-item',
      controlClassName: 'comet-settings-batch-date-control',
    }),
  );
  field.append(batchOptions.element, dateOptions.element);
  return field;
}

function getJournalOverrideTitle(props: SettingsPartProps, url: string) {
  const override = props.journalSourceOverrides.find((item) => item.url === url);
  return override?.journalTitle ?? null;
}

export function renderSupportedSourcesSection(
	props: SettingsPartProps,
) {
  const supportedSources = createSettingsSection({
    title: props.labels.settingsSupportedSources,
    description: props.labels.settingsSupportedSourcesHint,
    sectionClassName: 'comet-settings-supported-sources-section',
    panelClassName: 'comet-settings-supported-sources-panel',
    listClassName: 'comet-settings-supported-sources-list',
  });

  const table = el('div', 'comet-settings-supported-sources-table');
  table.hidden = !props.showSupportedSources;
  for (const [index, source] of props.supportedSources.entries()) {
    const row = el('div', 'comet-settings-supported-source-row');
    const url = el('div', 'comet-settings-supported-source-url');
    url.textContent = source.url;
    url.title = `${props.labels.settingsSupportedSourceUrl}: ${source.url}`;

    const journalCell = el('div', 'comet-settings-supported-source-journal-cell');
    const effectiveJournalTitle = getJournalOverrideTitle(props, source.url) ?? source.journalTitle;
    const journalLabel = el('div', 'comet-settings-supported-source-journal');
    journalLabel.textContent = effectiveJournalTitle || '-';
    journalLabel.title = props.labels.settingsSupportedSourceJournalTitle;
    const journalInput = buildInput({
      value: effectiveJournalTitle,
      className: 'comet-settings-supported-source-journal-input',
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
      itemClassName: 'comet-settings-supported-sources-actions-item',
      controlClassName: 'comet-settings-supported-sources-actions',
    }),
  );
  supportedSources.panel.append(table);
  return supportedSources.element;
}

export function renderLayoutSection(props: SettingsPartProps, contextViewProvider: ContextViewProvider) {
  const layout = createSettingsSection({
    title: props.labels.settingsLayoutTitle,
    sectionClassName: 'comet-settings-layout-section',
    panelClassName: 'comet-settings-layout-panel',
    listClassName: 'comet-settings-layout-list',
  });
  const startupLayoutSelect = buildSelect(
    createStartupLayoutOptions(props),
    props.startupLayout,
    'settings.general.layout.startupLayout',
    (value) => {
      props.onStartupLayoutChange(value === 'agent' ? 'agent' : 'flow');
    },
    contextViewProvider,
    'comet-settings-layout-startup-layout-select',
  );
  setSelectHostDisabled(startupLayoutSelect, props.isSettingsSaving);
  const browserTabKeepAliveLimitInput = new NumberStepper({
    value: props.browserTabKeepAliveLimit,
    className: 'comet-settings-number-stepper comet-settings-limit-input',
    min: String(minBrowserTabKeepAliveLimit),
    max: String(maxBrowserTabKeepAliveLimit),
    inputMode: 'numeric',
    step: '1',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onBrowserTabKeepAliveLimitChange,
    disabled: props.isSettingsSaving,
  });
  setSettingsFocusKey(browserTabKeepAliveLimitInput.inputElement, 'settings.general.layout.browserTabKeepAliveLimit');
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

export function renderBrowserSection(props: SettingsPartProps, contextViewProvider: ContextViewProvider) {
  const browser = createSettingsSection({
    title: props.labels.settingsBrowserTitle,
    sectionClassName: 'comet-settings-browser-section',
    panelClassName: 'comet-settings-browser-panel',
    listClassName: 'comet-settings-browser-list',
  });
  const maxHistoryEntriesInput = new NumberStepper({
    value: props.browserMaxHistoryEntries,
    className: 'comet-settings-number-stepper comet-settings-limit-input',
    min: String(minBrowserMaxHistoryEntries),
    max: String(maxBrowserMaxHistoryEntries),
    inputMode: 'numeric',
    step: '1',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onBrowserMaxHistoryEntriesChange,
    disabled: props.isSettingsSaving,
  });
  setSettingsFocusKey(maxHistoryEntriesInput.inputElement, 'settings.browser.maxHistoryEntries');
  const pageZoomSelect = buildSelect(
    ensureCurrentSelectOption(
      createBrowserPageZoomOptions(props),
      props.browserPageZoom,
    ),
    props.browserPageZoom,
    'settings.browser.pageZoom',
    props.onBrowserPageZoomChange,
    contextViewProvider,
    'comet-settings-browser-select',
  );
  setSelectHostDisabled(pageZoomSelect, props.isSettingsSaving);
  const searchEngineSelect = buildSelect(
    ensureCurrentSelectOption(
      createBrowserSearchEngineOptions(props),
      props.browserSearchEngine,
    ),
    props.browserSearchEngine,
    'settings.browser.searchEngine',
    props.onBrowserSearchEngineChange,
    contextViewProvider,
    'comet-settings-browser-select',
  );
  setSelectHostDisabled(searchEngineSelect, props.isSettingsSaving);
  browser.list.append(
    createSettingsRow({
      title: props.labels.settingsBrowserMaxHistoryEntries,
      description: props.labels.settingsBrowserMaxHistoryEntriesHint,
      control: maxHistoryEntriesInput.element,
    }),
    createSettingsRow({
      title: props.labels.settingsBrowserPageZoom,
      description: props.labels.settingsBrowserPageZoomHint,
      control: pageZoomSelect,
    }),
    createSettingsRow({
      title: props.labels.settingsBrowserSearchEngine,
      description: props.labels.settingsBrowserSearchEngineHint,
      control: searchEngineSelect,
    }),
  );
  return browser.element;
}

export function renderAppearanceSection(props: SettingsPartProps, contextViewProvider: ContextViewProvider) {
  const field = el('div', 'comet-settings-appearance-settings');
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
    contextViewProvider,
    'comet-settings-appearance-theme-select',
  );
  setSelectHostDisabled(themeSelect, props.isSettingsSaving);
  const appearanceTheme = createSettingsSection({
    sectionClassName: 'comet-settings-appearance-theme-section',
    panelClassName: 'comet-settings-appearance-theme-panel',
    listClassName: 'comet-settings-appearance-theme-list',
  });
  appearanceTheme.list.append(
    createSettingsRow({
      title: props.labels.settingsTheme,
      description: props.labels.settingsThemeHint,
      control: themeSelect,
    }),
  );
  const appearanceToggles = createSettingsSection({
    sectionClassName: 'comet-settings-appearance-toggles-section',
    panelClassName: 'comet-settings-appearance-toggles-panel',
    listClassName: 'comet-settings-appearance-toggles-list',
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
    sectionClassName: 'comet-settings-notifications-section',
    panelClassName: 'comet-settings-notifications-panel',
    listClassName: 'comet-settings-notifications-list',
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
  const field = el('div', 'comet-settings-download-settings');
  const effectiveDownloadDir = props.pdfDownloadDir.trim() || props.labels.systemDownloads;
  const downloadDirectory = createSettingsSection({
    sectionClassName: 'comet-settings-download-directory-section',
    panelClassName: 'comet-settings-download-directory-panel',
    listClassName: 'comet-settings-download-directory-list',
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
      itemClassName: 'comet-settings-download-directory-item',
      controlClassName: 'comet-settings-download-directory-control',
    }),
  );
  const downloadOptions = createSettingsSection({
    sectionClassName: 'comet-settings-download-options-section',
    panelClassName: 'comet-settings-download-options-panel',
    listClassName: 'comet-settings-download-options-list',
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
    sectionClassName: 'comet-settings-config-path-section',
    panelClassName: 'comet-settings-config-path-panel',
    listClassName: 'comet-settings-config-path-list',
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
      itemClassName: 'comet-settings-config-path-item',
      controlClassName: 'comet-settings-config-path-control',
    }),
  );
  return configPath.element;
}

export function renderTextEditorSection(props: SettingsPartProps, contextViewProvider: ContextViewProvider) {
  const defaultBodyStyle = props.editorDraftStyle.value.defaultBodyStyle;
  const isDisabled = props.isSettingsSaving;
  const textEditorPanel = createSettingsSection({
    title: props.labels.settingsTextEditorDefaultBodyStyle,
    description: props.labels.settingsTextEditorHint,
    sectionClassName: 'comet-settings-text-editor-section',
    panelClassName: 'comet-settings-text-editor-panel',
    listClassName: 'comet-settings-text-editor-list',
  });

  const fontFamilySelect = buildSelect(
    ensureCurrentSelectOption(
      props.editorDraftFontFamilyOptions,
      defaultBodyStyle.fontFamilyValue,
    ),
    defaultBodyStyle.fontFamilyValue,
    'settings.textEditor.fontFamily',
    props.onEditorDraftFontFamilyChange,
    contextViewProvider,
    'comet-settings-text-editor-select',
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
    contextViewProvider,
    'comet-settings-text-editor-select',
  );
  setSelectHostDisabled(fontSizeSelect, isDisabled);
  const lineHeightInput = new NumberStepper({
    value: defaultBodyStyle.lineHeight,
    className: 'comet-settings-number-stepper comet-settings-text-editor-line-height-input',
    min: '0.5',
    max: '4',
    inputMode: 'decimal',
    step: '0.1',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onEditorDraftLineHeightChange,
    disabled: isDisabled,
  });
  setSettingsFocusKey(lineHeightInput.inputElement, 'settings.textEditor.lineHeight');
  const paragraphSpacingBeforeInput = new NumberStepper({
    value: defaultBodyStyle.paragraphSpacingBeforePt,
    className: 'comet-settings-number-stepper comet-settings-text-editor-spacing-input',
    min: '0',
    max: '200',
    inputMode: 'decimal',
    step: '0.5',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onEditorDraftParagraphSpacingBeforeChange,
    disabled: isDisabled,
  });
  setSettingsFocusKey(paragraphSpacingBeforeInput.inputElement, 'settings.textEditor.paragraphSpacingBefore');
  const paragraphSpacingAfterInput = new NumberStepper({
    value: defaultBodyStyle.paragraphSpacingAfterPt,
    className: 'comet-settings-number-stepper comet-settings-text-editor-spacing-input',
    min: '0',
    max: '200',
    inputMode: 'decimal',
    step: '0.5',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: props.onEditorDraftParagraphSpacingAfterChange,
    disabled: isDisabled,
  });
  setSettingsFocusKey(paragraphSpacingAfterInput.inputElement, 'settings.textEditor.paragraphSpacingAfter');
  const colorRow = el('div', 'comet-settings-text-editor-color-row');
  const colorPickerInput = buildInput({
    type: 'color',
    value: toColorPickerValue(defaultBodyStyle.color),
    className: 'comet-settings-text-editor-color-picker',
    focusKey: 'settings.textEditor.colorPicker',
    onInput: props.onEditorDraftColorChange,
  });
  colorPickerInput.inputElement.disabled = isDisabled;
  const colorValueInput = buildInput({
    value: defaultBodyStyle.color,
    className: 'comet-settings-input-control comet-settings-text-editor-color-value',
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
