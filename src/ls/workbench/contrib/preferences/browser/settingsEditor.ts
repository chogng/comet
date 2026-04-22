import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';

import { DEFAULT_EDITOR_DRAFT_BODY_COLOR } from 'ls/base/common/editorDraftStyle';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicon/lxiconSemantic';
import { BatchSourcesWidget } from 'ls/workbench/contrib/preferences/browser/batchSourcesWidget';
import { KnowledgeBaseWidget } from 'ls/workbench/contrib/preferences/browser/knowledgeBaseWidget';
import type { KnowledgeBaseWidgetProps } from 'ls/workbench/contrib/preferences/browser/knowledgeBaseWidget';

import { LlmWidget } from 'ls/workbench/contrib/preferences/browser/llmWidget';
import {
  createSettingsSectionMap,
  getSettingsPageTitle,
  getSettingsPageSectionIds,
} from 'ls/workbench/contrib/preferences/browser/settingsLayout';
import type { SettingsPageId, SettingsSectionId } from 'ls/workbench/contrib/preferences/browser/settingsLayout';
import { createSettingsNavigationView } from 'ls/workbench/contrib/preferences/browser/settingsNavigationView';
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
  SettingsPartActions,
  SettingsDropdownOption,
  SettingsPartLabels,
  SettingsPartProps,
  SettingsPartState,
} from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import { TranslationWidget } from 'ls/workbench/contrib/preferences/browser/translationWidget';
import {
  createDisplayLanguageOptions,
  requestSetDisplayLanguage,
} from 'ls/workbench/contrib/localization/browser/localizationsActions';
import { batchLimitMax, batchLimitMin } from 'ls/workbench/services/config/configSchema';
import {
  maxBrowserTabKeepAliveLimit,
  minBrowserTabKeepAliveLimit,
} from 'ls/workbench/services/webContent/webContentRetentionConfig';
import { registerWorkbenchPartDomNode, WORKBENCH_PART_IDS } from 'ls/workbench/browser/layout';
import 'ls/workbench/contrib/preferences/browser/media/settingsEditor.css';
import 'ls/workbench/contrib/preferences/browser/media/settingsWidgets.css';

type SelectOption = SettingsDropdownOption;

type CreateSettingsPartLabelsParams = { ui: LocaleMessages };
type CreateSettingsPartPropsParams = { state: SettingsPartState; actions: SettingsPartActions };

export function createSettingsPartLabels({ ui }: CreateSettingsPartLabelsParams): SettingsPartLabels {
  return {
    settingsTitle: ui.settingsTitle, settingsLoading: ui.settingsLoading, settingsLanguage: ui.settingsLanguage, languageChinese: ui.languageChinese, languageEnglish: ui.languageEnglish, settingsLanguageHint: ui.settingsLanguageHint,
    settingsNavigationBack: ui.settingsNavigationBack, settingsNavigationGeneral: ui.settingsNavigationGeneral, settingsNavigationAppearance: ui.settingsNavigationAppearance, settingsNavigationTextEditor: ui.settingsNavigationTextEditor, settingsNavigationChat: ui.settingsNavigationChat, settingsNavigationKnowledgeBase: ui.settingsNavigationKnowledgeBase, settingsNavigationLiterature: ui.settingsNavigationLiterature, settingsTextEditorTitle: ui.settingsTextEditorTitle, settingsTextEditorHint: ui.settingsTextEditorHint,
    settingsTextEditorDefaultBodyStyle: ui.settingsTextEditorDefaultBodyStyle, settingsTextEditorFontFamily: ui.settingsTextEditorFontFamily, settingsTextEditorFontSize: ui.settingsTextEditorFontSize, settingsTextEditorLineHeight: ui.settingsTextEditorLineHeight, settingsTextEditorParagraphSpacingBefore: ui.settingsTextEditorParagraphSpacingBefore, settingsTextEditorParagraphSpacingAfter: ui.settingsTextEditorParagraphSpacingAfter, settingsTextEditorColor: ui.settingsTextEditorColor, settingsTextEditorResetDefaultBodyStyle: ui.settingsTextEditorResetDefaultBodyStyle,
    settingsPageUrl: ui.settingsPageUrl, settingsPageUrlHint: ui.settingsPageUrlHint, pageUrlPlaceholder: ui.pageUrlPlaceholder, settingsBatchJournalTitle: ui.settingsBatchJournalTitle, batchJournalTitlePlaceholder: ui.batchJournalTitlePlaceholder,
    addBatchUrl: ui.addBatchUrl, removeBatchUrl: ui.removeBatchUrl, moveBatchUrlUp: ui.moveBatchUrlUp, moveBatchUrlDown: ui.moveBatchUrlDown, settingsBatchOptions: ui.settingsBatchOptions, batchCount: ui.batchCount, sameDomainOnly: ui.sameDomainOnly, startDate: ui.startDate, endDate: ui.endDate,
    settingsAppearanceTitle: ui.settingsAppearanceTitle, settingsTheme: ui.settingsTheme, settingsThemeHint: ui.settingsThemeHint, settingsThemeLight: ui.settingsThemeLight, settingsThemeDark: ui.settingsThemeDark, settingsThemeSystem: ui.settingsThemeSystem, settingsUseMica: ui.settingsUseMica, settingsUseMicaHint: ui.settingsUseMicaHint, settingsLibraryTitle: ui.settingsLibraryTitle, settingsKnowledgeBaseTitle: ui.settingsKnowledgeBaseTitle, settingsKnowledgeBaseHint: ui.settingsKnowledgeBaseHint, settingsKnowledgeBaseMode: ui.settingsKnowledgeBaseMode,
    settingsKnowledgeBaseModeHint: ui.settingsKnowledgeBaseModeHint, settingsKnowledgeBaseModeDisabledHint: ui.settingsKnowledgeBaseModeDisabledHint, settingsKnowledgeBaseAutoIndex: ui.settingsKnowledgeBaseAutoIndex, settingsKnowledgeBaseAutoIndexHint: ui.settingsKnowledgeBaseAutoIndexHint,
    settingsKnowledgeBasePdfDownloadDir: ui.settingsKnowledgeBasePdfDownloadDir, settingsKnowledgeBasePdfDownloadDirPlaceholder: ui.settingsKnowledgeBasePdfDownloadDirPlaceholder, settingsKnowledgeBasePdfDownloadDirHint: ui.settingsKnowledgeBasePdfDownloadDirHint,
    settingsLibraryStorageMode: ui.settingsLibraryStorageMode, settingsLibraryStorageModeLinkedOriginal: ui.settingsLibraryStorageModeLinkedOriginal, settingsLibraryStorageModeManagedCopy: ui.settingsLibraryStorageModeManagedCopy, settingsLibraryDirectory: ui.settingsLibraryDirectory,
    settingsLibraryDirectoryPlaceholder: ui.settingsLibraryDirectoryPlaceholder, settingsLibraryDirectoryHint: ui.settingsLibraryDirectoryHint, settingsLibraryDbFile: ui.settingsLibraryDbFile, settingsLibraryFilesDir: ui.settingsLibraryFilesDir, settingsLibraryCacheDir: ui.settingsLibraryCacheDir,
    settingsLibraryStatusDocuments: ui.settingsLibraryStatusDocuments, settingsLibraryStatusFiles: ui.settingsLibraryStatusFiles, settingsLibraryStatusQueuedJobs: ui.settingsLibraryStatusQueuedJobs, settingsLibraryStatusEmpty: ui.settingsLibraryStatusEmpty, settingsLibraryRecentDocuments: ui.settingsLibraryRecentDocuments,
    settingsLibraryDocumentRegistered: ui.settingsLibraryDocumentRegistered, settingsLibraryDocumentQueued: ui.settingsLibraryDocumentQueued, settingsLibraryDocumentRunning: ui.settingsLibraryDocumentRunning, settingsLibraryDocumentFailed: ui.settingsLibraryDocumentFailed,
    settingsLibraryMaxConcurrentJobs: ui.settingsLibraryMaxConcurrentJobs, settingsLibraryMaxConcurrentJobsHint: ui.settingsLibraryMaxConcurrentJobsHint, settingsRagTitle: ui.settingsRagTitle, settingsRagProvider: ui.settingsRagProvider, settingsRagProviderHint: ui.settingsRagProviderHint,
    settingsRagProviderMoark: ui.settingsRagProviderMoark, settingsRagApiKey: ui.settingsRagApiKey, settingsRagApiKeyPlaceholder: ui.settingsRagApiKeyPlaceholder, settingsRagBaseUrl: ui.settingsRagBaseUrl, settingsRagEmbeddingModel: ui.settingsRagEmbeddingModel,
    settingsRagRerankerModel: ui.settingsRagRerankerModel, settingsRagEmbeddingPath: ui.settingsRagEmbeddingPath, settingsRagRerankPath: ui.settingsRagRerankPath, settingsRagCandidateCount: ui.settingsRagCandidateCount, settingsRagTopK: ui.settingsRagTopK,
    settingsRagTestConnection: ui.settingsRagTestConnection, settingsRagShowApiKey: ui.settingsRagShowApiKey, settingsRagHideApiKey: ui.settingsRagHideApiKey, settingsRagHint: ui.settingsRagHint, settingsBatchHint: ui.settingsBatchHint, defaultPdfDir: ui.defaultPdfDir, settingsLayoutTitle: ui.settingsLayoutTitle, settingsStatusbar: ui.settingsStatusbar, settingsStatusbarHint: ui.settingsStatusbarHint, settingsBrowserTabKeepAliveLimit: ui.settingsBrowserTabKeepAliveLimit, settingsBrowserTabKeepAliveLimitHint: ui.settingsBrowserTabKeepAliveLimitHint, settingsNotificationsTitle: ui.settingsNotificationsTitle, settingsNotificationsHint: ui.settingsNotificationsHint, settingsSystemNotifications: ui.settingsSystemNotifications, settingsSystemNotificationsHint: ui.settingsSystemNotificationsHint, settingsWarningNotifications: ui.settingsWarningNotifications, settingsWarningNotificationsHint: ui.settingsWarningNotificationsHint, settingsMenuBarIcon: ui.settingsMenuBarIcon, settingsMenuBarIconHint: ui.settingsMenuBarIconHint, settingsCompletionNotifications: ui.settingsCompletionNotifications, settingsCompletionNotificationsHint: ui.settingsCompletionNotificationsHint,
    pdfFileNameUseSelectionOrder: ui.pdfFileNameUseSelectionOrder, pdfFileNameUseSelectionOrderHint: ui.pdfFileNameUseSelectionOrderHint, downloadDirPlaceholder: ui.downloadDirPlaceholder, chooseDirectory: ui.chooseDirectory, openConfigLocation: ui.openConfigLocation,
    resetDefault: ui.resetDefault, settingsHintPath: ui.settingsHintPath, settingsConfigPath: ui.settingsConfigPath, currentDir: ui.currentDir, systemDownloads: ui.systemDownloads, settingsLlmTitle: ui.settingsLlmTitle, settingsLlmProvider: ui.settingsLlmProvider,
    settingsLlmProviderHint: ui.settingsLlmProviderHint, settingsLlmProviderGlm: ui.settingsLlmProviderGlm, settingsLlmProviderKimi: ui.settingsLlmProviderKimi, settingsLlmProviderDeepSeek: ui.settingsLlmProviderDeepSeek, settingsLlmProviderGemini: ui.settingsLlmProviderGemini, settingsLlmApiKey: ui.settingsLlmApiKey,
    settingsLlmApiKeyPlaceholder: ui.settingsLlmApiKeyPlaceholder, settingsLlmModel: ui.settingsLlmModel, settingsLlmSearchPlaceholder: ui.settingsLlmSearchPlaceholder, settingsLlmNoResults: ui.settingsLlmNoResults, settingsLlmMaxContext: ui.settingsLlmMaxContext, settingsLlmMaxContextHint: ui.settingsLlmMaxContextHint, settingsLlmTestConnection: ui.settingsLlmTestConnection, settingsLlmShowApiKey: ui.settingsLlmShowApiKey, settingsLlmHideApiKey: ui.settingsLlmHideApiKey,
    settingsTranslationTitle: ui.settingsTranslationTitle, settingsTranslationProvider: ui.settingsTranslationProvider, settingsTranslationProviderHint: ui.settingsTranslationProviderHint, settingsTranslationProviderDeepL: ui.settingsTranslationProviderDeepL,
    settingsTranslationApiKey: ui.settingsTranslationApiKey, settingsTranslationApiKeyPlaceholder: ui.settingsTranslationApiKeyPlaceholder, settingsTranslationTestConnection: ui.settingsTranslationTestConnection, settingsTranslationShowApiKey: ui.settingsTranslationShowApiKey,
    settingsTranslationHideApiKey: ui.settingsTranslationHideApiKey, settingsTranslationHint: ui.settingsTranslationHint,
  };
}

export function createSettingsPartProps({ state, actions }: CreateSettingsPartPropsParams): SettingsPartProps {
  return { labels: createSettingsPartLabels({ ui: state.ui }), ...state, ...actions };
}

type FocusSnapshot = {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
} | null;

function setSelectHostDisabled(host: HTMLElement, disabled: boolean) {
  const selectElement = host.querySelector<HTMLSelectElement>('.ls-select-box');
  if (selectElement) {
    selectElement.disabled = disabled;
  }
}

function createThemeOptions(labels: SettingsPartLabels): readonly SelectOption[] {
  return [
    { value: 'light', label: labels.settingsThemeLight },
    { value: 'dark', label: labels.settingsThemeDark },
    { value: 'system', label: labels.settingsThemeSystem },
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

export class SettingsPartView {
  private props: SettingsPartProps;
  private readonly navigationView: ReturnType<typeof createSettingsNavigationView>;
  private readonly container = el('div', 'settings-page');
  private readonly content = el('div', 'settings-content');
  private readonly topbar = el('div', 'settings-page-topbar');
  private readonly pageTitle = el('h2', 'settings-page-title');
  private readonly loadingHint = buildHint('');
  // Keep section containers stable so updates can replace only local content
  // without recreating the whole settings page.
  private readonly sections = createSettingsSectionMap(() => el('section', 'settings-section'));
  private readonly batchSourcesWidget: BatchSourcesWidget;
  private readonly knowledgeBaseWidget: KnowledgeBaseWidget;
  private readonly llmWidget: LlmWidget;
  private readonly translationWidget: TranslationWidget;
  private showRagApiKey = false;
  private showLlmApiKey = false;
  private showTranslationApiKey = false;
  private activePageId: SettingsPageId = 'general';

  constructor(props: SettingsPartProps) {
    this.props = props;
    this.navigationView = createSettingsNavigationView({
      labels: this.props.labels,
      title: this.props.labels.settingsTitle,
      activePageId: this.activePageId,
      onDidSelectPage: this.handleDidSelectPage,
      onDidNavigateBack: this.props.onNavigateBack,
    });
    this.batchSourcesWidget = new BatchSourcesWidget({
      labels: this.props.labels,
      batchSources: this.props.batchSources,
      isSettingsSaving: this.props.isSettingsSaving,
      onBatchSourceUrlChange: (index, url) => this.props.onBatchSourceUrlChange(index, url),
      onBatchSourceJournalTitleChange: (index, journalTitle) => this.props.onBatchSourceJournalTitleChange(index, journalTitle),
      onAddBatchSource: () => this.props.onAddBatchSource(),
      onRemoveBatchSource: (index) => this.props.onRemoveBatchSource(index),
      onMoveBatchSource: (index, direction) => this.props.onMoveBatchSource(index, direction),
    });
    this.knowledgeBaseWidget = new KnowledgeBaseWidget(this.getKnowledgeBaseWidgetProps());
    this.llmWidget = new LlmWidget({
      labels: this.props.labels,
      activeLlmProvider: this.props.activeLlmProvider,
      llmProviders: this.props.llmProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingLlmConnection: this.props.isTestingLlmConnection,
      showApiKey: this.showLlmApiKey,
      onToggleShowApiKey: () => { this.showLlmApiKey = !this.showLlmApiKey; this.updateLlmWidget(); },
      onActiveLlmProviderChange: (provider) => this.props.onActiveLlmProviderChange(provider),
      onLlmProviderApiKeyChange: (provider, apiKey) => this.props.onLlmProviderApiKeyChange(provider, apiKey),
      onLlmProviderModelChange: (provider, model) => this.props.onLlmProviderModelChange(provider, model),
      onLlmProviderSelectedModelOption: (provider, optionValue) => this.props.onLlmProviderSelectedModelOption(provider, optionValue),
      onLlmProviderReasoningEffortChange: (provider, reasoningEffort) => this.props.onLlmProviderReasoningEffortChange(provider, reasoningEffort),
      onLlmProviderModelEnabledChange: (provider, model, enabled) => this.props.onLlmProviderModelEnabledChange(provider, model, enabled),
      onLlmProviderUseMaxContextWindowChange: (provider, useMaxContextWindow) => this.props.onLlmProviderUseMaxContextWindowChange(provider, useMaxContextWindow),
      onTestLlmConnection: () => this.props.onTestLlmConnection(),
    });
    this.translationWidget = new TranslationWidget({
      labels: this.props.labels,
      activeTranslationProvider: this.props.activeTranslationProvider,
      translationProviders: this.props.translationProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingTranslationConnection: this.props.isTestingTranslationConnection,
      showApiKey: this.showTranslationApiKey,
      onToggleShowApiKey: () => { this.showTranslationApiKey = !this.showTranslationApiKey; this.updateTranslationWidget(); },
      onActiveTranslationProviderChange: (provider) => this.props.onActiveTranslationProviderChange(provider),
      onTranslationProviderApiKeyChange: (provider, apiKey) => this.props.onTranslationProviderApiKeyChange(provider, apiKey),
      onTestTranslationConnection: () => this.props.onTestTranslationConnection(),
    });
    this.container.append(this.topbar, this.content);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, this.container);
    this.initializeSectionContainers();
    this.updateView(undefined, true);
  }

  getElement() {
    return this.container;
  }

  getNavigationElement() {
    return this.navigationView.getElement();
  }

  getContentElement() {
    return this.container;
  }

  setProps(props: SettingsPartProps) {
    const previousProps = this.props;
    this.props = props;
    this.updateView(previousProps);
  }

  dispose() {
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, null);
    this.navigationView.dispose();
    this.container.replaceChildren();
  }

  private containsManagedElement(node: Node) {
    const navigationElement = this.navigationView.getElement();
    return (
      navigationElement.contains(node) ||
      this.container.contains(node)
    );
  }

  private queryManagedFocusTarget(key: string) {
    const selector = `[data-focus-key="${key}"]`;
    const navigationElement = this.navigationView.getElement();
    return (
      this.content.querySelector<HTMLElement>(selector) ??
      navigationElement.querySelector<HTMLElement>(selector)
    );
  }

  private captureFocus(): FocusSnapshot {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.containsManagedElement(active)) {
      return null;
    }
    const focusNode = active.closest<HTMLElement>('[data-focus-key]');
    const key = focusNode?.dataset.focusKey;
    if (!key) {
      return null;
    }
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return { key, selectionStart: active.selectionStart, selectionEnd: active.selectionEnd };
    }
    return { key, selectionStart: null, selectionEnd: null };
  }

  private restoreFocus(snapshot: FocusSnapshot) {
    if (!snapshot) {
      return;
    }
    const target = this.queryManagedFocusTarget(snapshot.key);
    if (!target) {
      return;
    }
    target.focus({ preventScroll: true });
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && snapshot.selectionStart !== null) {
      target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
    }
  }

  private updateSection(container: HTMLElement, content: Node) {
    container.replaceChildren(content);
  }

  private updateBatchSourcesWidget() {
    this.batchSourcesWidget.setProps({
      labels: this.props.labels,
      batchSources: this.props.batchSources,
      isSettingsSaving: this.props.isSettingsSaving,
      onBatchSourceUrlChange: (index, url) => this.props.onBatchSourceUrlChange(index, url),
      onBatchSourceJournalTitleChange: (index, journalTitle) => this.props.onBatchSourceJournalTitleChange(index, journalTitle),
      onAddBatchSource: () => this.props.onAddBatchSource(),
      onRemoveBatchSource: (index) => this.props.onRemoveBatchSource(index),
      onMoveBatchSource: (index, direction) => this.props.onMoveBatchSource(index, direction),
    });
  }

  private getKnowledgeBaseWidgetProps(): KnowledgeBaseWidgetProps {
    return {
      title: this.props.labels.settingsKnowledgeBaseTitle,
      hint: this.props.labels.settingsKnowledgeBaseHint,
      library: {
        labels: this.props.labels,
        knowledgeBaseEnabled: this.props.knowledgeBaseEnabled,
        autoIndexDownloadedPdf: this.props.autoIndexDownloadedPdf,
        knowledgeBasePdfDownloadDir: this.props.knowledgeBasePdfDownloadDir,
        libraryStorageMode: this.props.libraryStorageMode,
        libraryDirectory: this.props.libraryDirectory,
        defaultManagedDirectory: this.props.defaultManagedDirectory,
        maxConcurrentIndexJobs: this.props.maxConcurrentIndexJobs,
        desktopRuntime: this.props.desktopRuntime,
        isSettingsSaving: this.props.isSettingsSaving,
        isLibraryLoading: this.props.isLibraryLoading,
        libraryDocumentCount: this.props.libraryDocumentCount,
        libraryFileCount: this.props.libraryFileCount,
        libraryQueuedJobCount: this.props.libraryQueuedJobCount,
        libraryDocuments: this.props.libraryDocuments,
        libraryDbFile: this.props.libraryDbFile,
        ragCacheDir: this.props.ragCacheDir,
        onKnowledgeBaseEnabledChange: (checked) => this.props.onKnowledgeBaseEnabledChange(checked),
        onAutoIndexDownloadedPdfChange: (checked) => this.props.onAutoIndexDownloadedPdfChange(checked),
        onKnowledgeBasePdfDownloadDirChange: (value) => this.props.onKnowledgeBasePdfDownloadDirChange(value),
        onChooseKnowledgeBasePdfDownloadDir: () => this.props.onChooseKnowledgeBasePdfDownloadDir(),
        onLibraryStorageModeChange: (value) => this.props.onLibraryStorageModeChange(value),
        onLibraryDirectoryChange: (value) => this.props.onLibraryDirectoryChange(value),
        onChooseLibraryDirectory: () => this.props.onChooseLibraryDirectory(),
        onMaxConcurrentIndexJobsChange: (value) => this.props.onMaxConcurrentIndexJobsChange(value),
      },
      rag: {
        labels: this.props.labels,
        activeRagProvider: this.props.activeRagProvider,
        ragProviders: this.props.ragProviders,
        retrievalCandidateCount: this.props.retrievalCandidateCount,
        retrievalTopK: this.props.retrievalTopK,
        isSettingsSaving: this.props.isSettingsSaving,
        isTestingRagConnection: this.props.isTestingRagConnection,
        showApiKey: this.showRagApiKey,
        onToggleShowApiKey: () => { this.showRagApiKey = !this.showRagApiKey; this.updateKnowledgeBaseWidget(); },
        onRagProviderApiKeyChange: (provider, apiKey) => this.props.onRagProviderApiKeyChange(provider, apiKey),
        onRagProviderBaseUrlChange: (provider, baseUrl) => this.props.onRagProviderBaseUrlChange(provider, baseUrl),
        onRagProviderEmbeddingModelChange: (provider, model) => this.props.onRagProviderEmbeddingModelChange(provider, model),
        onRagProviderRerankerModelChange: (provider, model) => this.props.onRagProviderRerankerModelChange(provider, model),
        onRagProviderEmbeddingPathChange: (provider, path) => this.props.onRagProviderEmbeddingPathChange(provider, path),
        onRagProviderRerankPathChange: (provider, path) => this.props.onRagProviderRerankPathChange(provider, path),
        onRetrievalCandidateCountChange: (value) => this.props.onRetrievalCandidateCountChange(value),
        onRetrievalTopKChange: (value) => this.props.onRetrievalTopKChange(value),
        onTestRagConnection: () => this.props.onTestRagConnection(),
      },
    };
  }

  private updateKnowledgeBaseWidget() {
    this.knowledgeBaseWidget.setProps(this.getKnowledgeBaseWidgetProps());
  }

  private updateLlmWidget() {
    this.llmWidget.setProps({
      labels: this.props.labels,
      activeLlmProvider: this.props.activeLlmProvider,
      llmProviders: this.props.llmProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingLlmConnection: this.props.isTestingLlmConnection,
      showApiKey: this.showLlmApiKey,
      onToggleShowApiKey: () => { this.showLlmApiKey = !this.showLlmApiKey; this.updateLlmWidget(); },
      onActiveLlmProviderChange: (provider) => this.props.onActiveLlmProviderChange(provider),
      onLlmProviderApiKeyChange: (provider, apiKey) => this.props.onLlmProviderApiKeyChange(provider, apiKey),
      onLlmProviderModelChange: (provider, model) => this.props.onLlmProviderModelChange(provider, model),
      onLlmProviderSelectedModelOption: (provider, optionValue) => this.props.onLlmProviderSelectedModelOption(provider, optionValue),
      onLlmProviderReasoningEffortChange: (provider, reasoningEffort) => this.props.onLlmProviderReasoningEffortChange(provider, reasoningEffort),
      onLlmProviderModelEnabledChange: (provider, model, enabled) => this.props.onLlmProviderModelEnabledChange(provider, model, enabled),
      onLlmProviderUseMaxContextWindowChange: (provider, useMaxContextWindow) => this.props.onLlmProviderUseMaxContextWindowChange(provider, useMaxContextWindow),
      onTestLlmConnection: () => this.props.onTestLlmConnection(),
    });
  }

  private updateTranslationWidget() {
    this.translationWidget.setProps({
      labels: this.props.labels,
      activeTranslationProvider: this.props.activeTranslationProvider,
      translationProviders: this.props.translationProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingTranslationConnection: this.props.isTestingTranslationConnection,
      showApiKey: this.showTranslationApiKey,
      onToggleShowApiKey: () => { this.showTranslationApiKey = !this.showTranslationApiKey; this.updateTranslationWidget(); },
      onActiveTranslationProviderChange: (provider) => this.props.onActiveTranslationProviderChange(provider),
      onTranslationProviderApiKeyChange: (provider, apiKey) => this.props.onTranslationProviderApiKeyChange(provider, apiKey),
      onTestTranslationConnection: () => this.props.onTestTranslationConnection(),
    });
  }

  private initializeSectionContainers() {
    for (const [id, section] of Object.entries(this.sections) as Array<[SettingsSectionId, HTMLElement]>) {
      section.dataset.sectionId = id;
      section.id = `settings-section-${id}`;
    }
  }

  private syncNavigationView() {
    this.navigationView.setProps({
      labels: this.props.labels,
      title: this.props.labels.settingsTitle,
      activePageId: this.activePageId,
      onDidSelectPage: this.handleDidSelectPage,
      onDidNavigateBack: this.props.onNavigateBack,
    });
  }

  private readonly handleDidSelectPage = (pageId: SettingsPageId) => {
    this.focusPage(pageId);
  };

  private focusPage(pageId: SettingsPageId) {
    if (this.activePageId === pageId) {
      return;
    }
    this.activePageId = pageId;
    if (pageId === 'model') {
      this.llmWidget.enterModelPage();
    }
    this.renderActivePage();
    this.syncNavigationView();
  }

  private renderActivePage() {
    const pageSectionIds = getSettingsPageSectionIds(this.activePageId);
    this.pageTitle.textContent = getSettingsPageTitle(this.activePageId, this.props.labels);
    const contentChildren: Node[] = [
      this.pageTitle,
      ...pageSectionIds.map((sectionId) => this.sections[sectionId]),
    ];
    if (this.props.isSettingsLoading) {
      contentChildren.splice(1, 0, this.loadingHint);
    }
    this.content.replaceChildren(...contentChildren);
    for (const [sectionId, section] of Object.entries(this.sections) as Array<[SettingsSectionId, HTMLElement]>) {
      section.classList.toggle('active', pageSectionIds.includes(sectionId));
    }
  }

  private shouldUpdateLocaleSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.locale !== this.props.locale ||
      previousProps.labels.settingsLanguage !== this.props.labels.settingsLanguage ||
      previousProps.labels.languageChinese !== this.props.labels.languageChinese ||
      previousProps.labels.languageEnglish !== this.props.labels.languageEnglish ||
      previousProps.labels.settingsLanguageHint !== this.props.labels.settingsLanguageHint
    );
  }

  private shouldUpdateBatchSourcesSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.batchSources !== this.props.batchSources ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.settingsPageUrl !== this.props.labels.settingsPageUrl ||
      previousProps.labels.pageUrlPlaceholder !== this.props.labels.pageUrlPlaceholder ||
      previousProps.labels.batchJournalTitlePlaceholder !== this.props.labels.batchJournalTitlePlaceholder ||
      previousProps.labels.addBatchUrl !== this.props.labels.addBatchUrl ||
      previousProps.labels.removeBatchUrl !== this.props.labels.removeBatchUrl ||
      previousProps.labels.moveBatchUrlUp !== this.props.labels.moveBatchUrlUp ||
      previousProps.labels.moveBatchUrlDown !== this.props.labels.moveBatchUrlDown ||
      previousProps.labels.settingsPageUrlHint !== this.props.labels.settingsPageUrlHint
    );
  }

  private shouldUpdateBatchOptionsSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.batchLimit !== this.props.batchLimit ||
      previousProps.sameDomainOnly !== this.props.sameDomainOnly ||
      previousProps.fetchStartDate !== this.props.fetchStartDate ||
      previousProps.fetchEndDate !== this.props.fetchEndDate ||
      previousProps.labels.settingsBatchOptions !== this.props.labels.settingsBatchOptions ||
      previousProps.labels.batchCount !== this.props.labels.batchCount ||
      previousProps.labels.sameDomainOnly !== this.props.labels.sameDomainOnly ||
      previousProps.labels.startDate !== this.props.labels.startDate ||
      previousProps.labels.endDate !== this.props.labels.endDate ||
      previousProps.labels.settingsBatchHint !== this.props.labels.settingsBatchHint
    );
  }

  private shouldUpdateLayoutSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.statusbarVisible !== this.props.statusbarVisible ||
      previousProps.browserTabKeepAliveLimit !== this.props.browserTabKeepAliveLimit ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.settingsLayoutTitle !== this.props.labels.settingsLayoutTitle ||
      previousProps.labels.settingsStatusbar !== this.props.labels.settingsStatusbar ||
      previousProps.labels.settingsStatusbarHint !== this.props.labels.settingsStatusbarHint ||
      previousProps.labels.settingsBrowserTabKeepAliveLimit !==
        this.props.labels.settingsBrowserTabKeepAliveLimit ||
      previousProps.labels.settingsBrowserTabKeepAliveLimitHint !==
        this.props.labels.settingsBrowserTabKeepAliveLimitHint
    );
  }

  private shouldUpdateNotificationsSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.systemNotificationsEnabled !== this.props.systemNotificationsEnabled ||
      previousProps.warningNotificationsEnabled !== this.props.warningNotificationsEnabled ||
      previousProps.menuBarIconEnabled !== this.props.menuBarIconEnabled ||
      previousProps.completionNotificationsEnabled !== this.props.completionNotificationsEnabled ||
      previousProps.desktopRuntime !== this.props.desktopRuntime ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.settingsNotificationsTitle !== this.props.labels.settingsNotificationsTitle ||
      previousProps.labels.settingsNotificationsHint !== this.props.labels.settingsNotificationsHint ||
      previousProps.labels.settingsSystemNotifications !== this.props.labels.settingsSystemNotifications ||
      previousProps.labels.settingsSystemNotificationsHint !== this.props.labels.settingsSystemNotificationsHint ||
      previousProps.labels.settingsWarningNotifications !== this.props.labels.settingsWarningNotifications ||
      previousProps.labels.settingsWarningNotificationsHint !== this.props.labels.settingsWarningNotificationsHint ||
      previousProps.labels.settingsMenuBarIcon !== this.props.labels.settingsMenuBarIcon ||
      previousProps.labels.settingsMenuBarIconHint !== this.props.labels.settingsMenuBarIconHint ||
      previousProps.labels.settingsCompletionNotifications !== this.props.labels.settingsCompletionNotifications ||
      previousProps.labels.settingsCompletionNotificationsHint !== this.props.labels.settingsCompletionNotificationsHint
    );
  }

  private shouldUpdateAppearanceSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.theme !== this.props.theme ||
      previousProps.useMica !== this.props.useMica ||
      previousProps.desktopRuntime !== this.props.desktopRuntime ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.settingsAppearanceTitle !== this.props.labels.settingsAppearanceTitle ||
      previousProps.labels.settingsTheme !== this.props.labels.settingsTheme ||
      previousProps.labels.settingsThemeHint !== this.props.labels.settingsThemeHint ||
      previousProps.labels.settingsThemeLight !== this.props.labels.settingsThemeLight ||
      previousProps.labels.settingsThemeDark !== this.props.labels.settingsThemeDark ||
      previousProps.labels.settingsThemeSystem !== this.props.labels.settingsThemeSystem ||
      previousProps.labels.settingsUseMica !== this.props.labels.settingsUseMica ||
      previousProps.labels.settingsUseMicaHint !== this.props.labels.settingsUseMicaHint
    );
  }

  private shouldUpdateTextEditorSection(previousProps?: SettingsPartProps) {
    if (!previousProps) {
      return true;
    }

    const previousDefaultBodyStyle = previousProps.editorDraftStyle.defaultBodyStyle;
    const currentDefaultBodyStyle = this.props.editorDraftStyle.defaultBodyStyle;

    return (
      previousDefaultBodyStyle.fontFamilyValue !== currentDefaultBodyStyle.fontFamilyValue ||
      previousDefaultBodyStyle.fontSizeValue !== currentDefaultBodyStyle.fontSizeValue ||
      previousDefaultBodyStyle.lineHeight !== currentDefaultBodyStyle.lineHeight ||
      previousDefaultBodyStyle.paragraphSpacingBeforePt !== currentDefaultBodyStyle.paragraphSpacingBeforePt ||
      previousDefaultBodyStyle.paragraphSpacingAfterPt !== currentDefaultBodyStyle.paragraphSpacingAfterPt ||
      previousDefaultBodyStyle.color !== currentDefaultBodyStyle.color ||
      previousProps.editorDraftFontFamilyOptions !== this.props.editorDraftFontFamilyOptions ||
      previousProps.editorDraftFontSizeOptions !== this.props.editorDraftFontSizeOptions ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.settingsTextEditorTitle !== this.props.labels.settingsTextEditorTitle ||
      previousProps.labels.settingsTextEditorHint !== this.props.labels.settingsTextEditorHint ||
      previousProps.labels.settingsTextEditorDefaultBodyStyle !== this.props.labels.settingsTextEditorDefaultBodyStyle ||
      previousProps.labels.settingsTextEditorFontFamily !== this.props.labels.settingsTextEditorFontFamily ||
      previousProps.labels.settingsTextEditorFontSize !== this.props.labels.settingsTextEditorFontSize ||
      previousProps.labels.settingsTextEditorLineHeight !== this.props.labels.settingsTextEditorLineHeight ||
      previousProps.labels.settingsTextEditorParagraphSpacingBefore !== this.props.labels.settingsTextEditorParagraphSpacingBefore ||
      previousProps.labels.settingsTextEditorParagraphSpacingAfter !== this.props.labels.settingsTextEditorParagraphSpacingAfter ||
      previousProps.labels.settingsTextEditorColor !== this.props.labels.settingsTextEditorColor ||
      previousProps.labels.settingsTextEditorResetDefaultBodyStyle !== this.props.labels.settingsTextEditorResetDefaultBodyStyle
    );
  }

  private shouldUpdateKnowledgeBaseSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.knowledgeBaseEnabled !== this.props.knowledgeBaseEnabled ||
      previousProps.autoIndexDownloadedPdf !== this.props.autoIndexDownloadedPdf ||
      previousProps.knowledgeBasePdfDownloadDir !== this.props.knowledgeBasePdfDownloadDir ||
      previousProps.libraryStorageMode !== this.props.libraryStorageMode ||
      previousProps.libraryDirectory !== this.props.libraryDirectory ||
      previousProps.defaultManagedDirectory !== this.props.defaultManagedDirectory ||
      previousProps.maxConcurrentIndexJobs !== this.props.maxConcurrentIndexJobs ||
      previousProps.desktopRuntime !== this.props.desktopRuntime ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.isLibraryLoading !== this.props.isLibraryLoading ||
      previousProps.libraryDocumentCount !== this.props.libraryDocumentCount ||
      previousProps.libraryFileCount !== this.props.libraryFileCount ||
      previousProps.libraryQueuedJobCount !== this.props.libraryQueuedJobCount ||
      previousProps.libraryDocuments !== this.props.libraryDocuments ||
      previousProps.libraryDbFile !== this.props.libraryDbFile ||
      previousProps.activeRagProvider !== this.props.activeRagProvider ||
      previousProps.ragProviders !== this.props.ragProviders ||
      previousProps.retrievalCandidateCount !== this.props.retrievalCandidateCount ||
      previousProps.retrievalTopK !== this.props.retrievalTopK ||
      previousProps.ragCacheDir !== this.props.ragCacheDir ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.isTestingRagConnection !== this.props.isTestingRagConnection ||
      previousProps.labels !== this.props.labels
    );
  }

  private shouldUpdateDownloadDirectorySection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.pdfDownloadDir !== this.props.pdfDownloadDir ||
      previousProps.pdfFileNameUseSelectionOrder !== this.props.pdfFileNameUseSelectionOrder ||
      previousProps.desktopRuntime !== this.props.desktopRuntime ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.defaultPdfDir !== this.props.labels.defaultPdfDir ||
      previousProps.labels.downloadDirPlaceholder !== this.props.labels.downloadDirPlaceholder ||
      previousProps.labels.chooseDirectory !== this.props.labels.chooseDirectory ||
      previousProps.labels.pdfFileNameUseSelectionOrder !== this.props.labels.pdfFileNameUseSelectionOrder ||
      previousProps.labels.pdfFileNameUseSelectionOrderHint !== this.props.labels.pdfFileNameUseSelectionOrderHint
    );
  }

  private shouldUpdateLlmSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.activeLlmProvider !== this.props.activeLlmProvider ||
      previousProps.llmProviders !== this.props.llmProviders ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.isTestingLlmConnection !== this.props.isTestingLlmConnection ||
      previousProps.labels !== this.props.labels
    );
  }

  private shouldUpdateTranslationSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.activeTranslationProvider !== this.props.activeTranslationProvider ||
      previousProps.translationProviders !== this.props.translationProviders ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.isTestingTranslationConnection !== this.props.isTestingTranslationConnection ||
      previousProps.labels !== this.props.labels
    );
  }

  private shouldUpdateConfigPathSection(previousProps?: SettingsPartProps) {
    return (
      !previousProps ||
      previousProps.configPath !== this.props.configPath ||
      previousProps.desktopRuntime !== this.props.desktopRuntime ||
      previousProps.isSettingsSaving !== this.props.isSettingsSaving ||
      previousProps.labels.settingsConfigPath !== this.props.labels.settingsConfigPath ||
      previousProps.labels.openConfigLocation !== this.props.labels.openConfigLocation
    );
  }

  private updateView(previousProps?: SettingsPartProps, forceAll = false) {
    const focusSnapshot = this.captureFocus();
    this.loadingHint.textContent = this.props.labels.settingsLoading;
    this.syncNavigationView();

    if (forceAll || this.shouldUpdateLocaleSection(previousProps)) {
      this.updateSection(this.sections.locale, this.renderLocaleField());
    }
    if (forceAll || this.shouldUpdateLayoutSection(previousProps)) {
      this.updateSection(this.sections.layout, this.renderLayoutField());
    }
    if (forceAll || this.shouldUpdateNotificationsSection(previousProps)) {
      this.updateSection(this.sections.notifications, this.renderNotificationsField());
    }
    if (forceAll || this.shouldUpdateBatchSourcesSection(previousProps)) {
      this.updateBatchSourcesWidget();
      this.updateSection(this.sections.batchSources, this.batchSourcesWidget.getElement());
    }
    if (forceAll || this.shouldUpdateBatchOptionsSection(previousProps)) {
      this.updateSection(this.sections.batchOptions, this.renderBatchOptionsField());
    }
    if (forceAll || this.shouldUpdateAppearanceSection(previousProps)) {
      this.updateSection(this.sections.appearance, this.renderAppearanceField());
    }
    if (forceAll || this.shouldUpdateTextEditorSection(previousProps)) {
      this.updateSection(this.sections.textEditor, this.renderTextEditorField());
    }
    if (forceAll || this.shouldUpdateKnowledgeBaseSection(previousProps)) {
      this.updateKnowledgeBaseWidget();
      this.updateSection(this.sections.knowledgeBase, this.knowledgeBaseWidget.getElement());
    }
    if (forceAll || this.shouldUpdateDownloadDirectorySection(previousProps)) {
      this.updateSection(this.sections.downloadDirectory, this.renderDownloadDirectoryField());
    }
    if (forceAll || this.shouldUpdateLlmSection(previousProps)) {
      this.updateLlmWidget();
      this.updateSection(this.sections.llm, this.llmWidget.getElement());
    }
    if (forceAll || this.shouldUpdateTranslationSection(previousProps)) {
      this.updateTranslationWidget();
      this.updateSection(this.sections.translation, this.translationWidget.getElement());
    }
    if (forceAll || this.shouldUpdateConfigPathSection(previousProps)) {
      this.updateSection(this.sections.configPath, this.renderConfigPathField());
    }

    this.renderActivePage();
    this.restoreFocus(focusSnapshot);
  }

  private renderLocaleField() {
    const language = createSettingsSection({
      sectionClassName: 'settings-language-section',
      panelClassName: 'settings-language-panel',
      listClassName: 'settings-language-list',
    });
    const select = buildSelect(
      createDisplayLanguageOptions(this.props.labels),
      this.props.locale,
      'settings.locale',
      (value) => requestSetDisplayLanguage(value as Locale),
      'settings-language-toggle',
    );
    language.list.append(
      createSettingsRow({
        title: this.props.labels.settingsLanguage,
        description: this.props.labels.settingsLanguageHint,
        control: select,
      }),
    );
    return language.element;
  }

  private renderBatchOptionsField() {
    const field = el('div', 'settings-field');
    const title = el('span'); title.textContent = this.props.labels.settingsBatchOptions;
    const row = el('div', 'settings-batch-options');
    const limitLabel = el('div', 'inline-field');
    const wrap = el('div', 'settings-limit-input-wrap');
    wrap.append(buildNumberStepperInput({
      value: this.props.batchLimit,
      className: 'settings-limit-input',
      focusKey: 'settings.batch.limit',
      min: String(batchLimitMin),
      max: String(batchLimitMax),
      inputMode: 'numeric',
      step: '1',
      onInput: this.props.onBatchLimitChange,
      disabled: this.props.isSettingsSaving,
    }).element);
    limitLabel.append(text(this.props.labels.batchCount), wrap);
    const checkboxLabel = el('label', 'inline-field checkbox-field');
    checkboxLabel.append(
      buildCheckbox({ checked: this.props.sameDomainOnly, className: 'radix-checkbox', focusKey: 'settings.batch.sameDomain', onChange: this.props.onSameDomainOnlyChange }),
      text(this.props.labels.sameDomainOnly),
    );
    const dateRow = el('div', 'settings-batch-date-row');
    const startDateField = el('div', 'settings-field settings-batch-date-field');
    startDateField.append(
      text(this.props.labels.startDate),
      buildInput({
        type: 'date',
        value: this.props.fetchStartDate,
        className: 'settings-input-control',
        focusKey: 'settings.batch.startDate',
        onInput: this.props.onFetchStartDateChange,
      }).element,
    );
    const endDateField = el('div', 'settings-field settings-batch-date-field');
    endDateField.append(
      text(this.props.labels.endDate),
      buildInput({
        type: 'date',
        value: this.props.fetchEndDate,
        className: 'settings-input-control',
        focusKey: 'settings.batch.endDate',
        onInput: this.props.onFetchEndDateChange,
      }).element,
    );
    dateRow.append(startDateField, endDateField);
    row.append(limitLabel, checkboxLabel);
    field.append(title, row, dateRow, buildHint(this.props.labels.settingsBatchHint));
    return field;
  }

  private renderLayoutField() {
    const layout = createSettingsSection({
      title: this.props.labels.settingsLayoutTitle,
      sectionClassName: 'settings-layout-section',
      panelClassName: 'settings-layout-panel',
      listClassName: 'settings-layout-list',
    });
    const browserTabKeepAliveLimitInput = buildNumberStepperInput({
      value: this.props.browserTabKeepAliveLimit,
      className: 'settings-limit-input',
      focusKey: 'settings.general.layout.browserTabKeepAliveLimit',
      min: String(minBrowserTabKeepAliveLimit),
      max: String(maxBrowserTabKeepAliveLimit),
      inputMode: 'numeric',
      step: '1',
      onInput: this.props.onBrowserTabKeepAliveLimitChange,
      disabled: this.props.isSettingsSaving,
    });
    layout.list.append(
      createSettingsRow({
        title: this.props.labels.settingsStatusbar,
        description: this.props.labels.settingsStatusbarHint,
        control: buildSwitch({
          checked: this.props.statusbarVisible,
          focusKey: 'settings.general.layout.statusbarVisible',
          disabled: this.props.isSettingsSaving,
          title: this.props.labels.settingsStatusbar,
          onChange: this.props.onStatusbarVisibleChange,
        }),
      }),
      createSettingsRow({
        title: this.props.labels.settingsBrowserTabKeepAliveLimit,
        description: this.props.labels.settingsBrowserTabKeepAliveLimitHint,
        control: browserTabKeepAliveLimitInput.element,
      }),
    );
    return layout.element;
  }

  private renderAppearanceField() {
    const field = el('div', 'settings-field');
    const title = el('span'); title.textContent = this.props.labels.settingsAppearanceTitle;
    const themeSelect = buildSelect(
      createThemeOptions(this.props.labels),
      this.props.theme,
      'settings.appearance.theme',
      (value) => {
        const nextTheme =
          value === 'dark' || value === 'light' || value === 'system'
            ? value
            : 'light';
        this.props.onThemeChange(nextTheme);
      },
      'settings-appearance-theme-select',
    );
    setSelectHostDisabled(themeSelect, this.props.isSettingsSaving);
    const appearanceTheme = createSettingsSection({
      sectionClassName: 'settings-appearance-theme-section',
      panelClassName: 'settings-appearance-theme-panel',
      listClassName: 'settings-appearance-theme-list',
    });
    appearanceTheme.list.append(
      createSettingsRow({
        title: this.props.labels.settingsTheme,
        description: this.props.labels.settingsThemeHint,
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
        title: this.props.labels.settingsUseMica,
        description: this.props.labels.settingsUseMicaHint,
        control: buildSwitch({
          checked: this.props.useMica,
          focusKey: 'settings.appearance.useMica',
          disabled: this.props.isSettingsSaving || !this.props.desktopRuntime,
          title: this.props.labels.settingsUseMica,
          onChange: this.props.onUseMicaChange,
        }),
      }),
    );
    field.append(
      title,
      appearanceTheme.element,
      appearanceToggles.element,
    );
    return field;
  }

  private renderNotificationsField() {
    const notifications = createSettingsSection({
      title: this.props.labels.settingsNotificationsTitle,
      sectionClassName: 'settings-notifications-section',
      panelClassName: 'settings-notifications-panel',
      listClassName: 'settings-notifications-list',
    });
    const notificationsDisabled = this.props.isSettingsSaving || !this.props.desktopRuntime;
    notifications.list.append(
      createSettingsRow({
        title: this.props.labels.settingsSystemNotifications,
        description: this.props.labels.settingsSystemNotificationsHint,
        control: buildSwitch({
          checked: this.props.systemNotificationsEnabled,
          focusKey: 'settings.general.notifications.system',
          disabled: notificationsDisabled,
          title: this.props.labels.settingsSystemNotifications,
          onChange: this.props.onSystemNotificationsEnabledChange,
        }),
      }),
      createSettingsRow({
        title: this.props.labels.settingsWarningNotifications,
        description: this.props.labels.settingsWarningNotificationsHint,
        control: buildSwitch({
          checked: this.props.warningNotificationsEnabled,
          focusKey: 'settings.general.notifications.warning',
          disabled: notificationsDisabled,
          title: this.props.labels.settingsWarningNotifications,
          onChange: this.props.onWarningNotificationsEnabledChange,
        }),
      }),
      createSettingsRow({
        title: this.props.labels.settingsMenuBarIcon,
        description: this.props.labels.settingsMenuBarIconHint,
        control: buildSwitch({
          checked: this.props.menuBarIconEnabled,
          focusKey: 'settings.general.notifications.menuBarIcon',
          disabled: notificationsDisabled,
          title: this.props.labels.settingsMenuBarIcon,
          onChange: this.props.onMenuBarIconEnabledChange,
        }),
      }),
      createSettingsRow({
        title: this.props.labels.settingsCompletionNotifications,
        description: this.props.labels.settingsCompletionNotificationsHint,
        control: buildSwitch({
          checked: this.props.completionNotificationsEnabled,
          focusKey: 'settings.general.notifications.completion',
          disabled: notificationsDisabled,
          title: this.props.labels.settingsCompletionNotifications,
          onChange: this.props.onCompletionNotificationsEnabledChange,
        }),
      }),
    );
    return notifications.element;
  }

  private renderDownloadDirectoryField() {
    const field = el('div', 'settings-field');
    const title = el('span');
    title.textContent = this.props.labels.defaultPdfDir;
    const row = el('div', 'settings-input-row');
    row.append(
      buildInput({
        value: this.props.pdfDownloadDir,
        className: 'settings-input-control',
        focusKey: 'settings.download.dir',
        placeholder: this.props.labels.downloadDirPlaceholder,
        onInput: this.props.onPdfDownloadDirChange,
      }).element,
      buildButton({ label: '...', icon: lxIconSemanticMap.settings.chooseDirectory, className: 'settings-native-icon-button', focusKey: 'settings.download.choose', title: this.props.labels.chooseDirectory, disabled: !this.props.desktopRuntime || this.props.isSettingsSaving, onClick: this.props.onChoosePdfDownloadDir }),
    );
    const downloadOptions = createSettingsSection({
      sectionClassName: 'settings-download-options-section',
      panelClassName: 'settings-download-options-panel',
      listClassName: 'settings-download-options-list',
    });
    downloadOptions.list.append(
      createSettingsRow({
        title: this.props.labels.pdfFileNameUseSelectionOrder,
        description: this.props.labels.pdfFileNameUseSelectionOrderHint,
        control: buildSwitch({
          checked: this.props.pdfFileNameUseSelectionOrder,
          focusKey: 'settings.download.selectionOrder',
          disabled: this.props.isSettingsSaving,
          title: this.props.labels.pdfFileNameUseSelectionOrder,
          onChange: this.props.onPdfFileNameUseSelectionOrderChange,
        }),
      }),
    );
    field.append(title, row, downloadOptions.element);
    return field;
  }

  private renderConfigPathField() {
    const field = el('div', 'settings-field');
    const row = el('div', 'settings-input-row');
    row.append(
      buildInput({
        value: this.props.configPath,
        className: 'settings-input-control',
        focusKey: 'settings.config.path',
        readOnly: true,
      }).element,
      buildButton({ label: '...', icon: lxIconSemanticMap.settings.openConfigLocation, className: 'settings-native-icon-button', focusKey: 'settings.config.open', title: this.props.labels.openConfigLocation, disabled: !this.props.desktopRuntime || this.props.isSettingsSaving || !this.props.configPath.trim(), onClick: this.props.onOpenConfigLocation }),
    );
    field.append(text(this.props.labels.settingsConfigPath), row);
    return field;
  }

  private renderTextEditorField() {
    const field = el('div', 'settings-field settings-text-editor-field');
    const defaultBodyStyle = this.props.editorDraftStyle.defaultBodyStyle;
    const isDisabled = this.props.isSettingsSaving;
    const textEditorPanel = createSettingsSection({
      title: this.props.labels.settingsTextEditorDefaultBodyStyle,
      description: this.props.labels.settingsTextEditorHint,
      sectionClassName: 'settings-text-editor-section',
      panelClassName: 'settings-text-editor-panel',
      listClassName: 'settings-text-editor-list',
    });

    const fontFamilySelect = buildSelect(
      ensureCurrentSelectOption(
        this.props.editorDraftFontFamilyOptions,
        defaultBodyStyle.fontFamilyValue,
      ),
      defaultBodyStyle.fontFamilyValue,
      'settings.textEditor.fontFamily',
      this.props.onEditorDraftFontFamilyChange,
      'settings-text-editor-select',
    );
    setSelectHostDisabled(fontFamilySelect, isDisabled);
    const fontSizeSelect = buildSelect(
      ensureCurrentSelectOption(
        this.props.editorDraftFontSizeOptions,
        defaultBodyStyle.fontSizeValue,
      ),
      defaultBodyStyle.fontSizeValue,
      'settings.textEditor.fontSize',
      this.props.onEditorDraftFontSizeChange,
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
      onInput: this.props.onEditorDraftLineHeightChange,
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
      onInput: this.props.onEditorDraftParagraphSpacingBeforeChange,
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
      onInput: this.props.onEditorDraftParagraphSpacingAfterChange,
      disabled: isDisabled,
    });
    const colorRow = el('div', 'settings-text-editor-color-row');
    const colorPickerInput = buildInput({
      type: 'color',
      value: toColorPickerValue(defaultBodyStyle.color),
      className: 'settings-text-editor-color-picker',
      focusKey: 'settings.textEditor.colorPicker',
      onInput: this.props.onEditorDraftColorChange,
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
      label: this.props.labels.settingsTextEditorResetDefaultBodyStyle,
      className: 'settings-text-editor-reset-button',
      focusKey: 'settings.textEditor.resetDefaultBodyStyle',
      disabled: isDisabled,
      onClick: this.props.onResetEditorDraftStyle,
    });

    textEditorPanel.list.append(
      createSettingsRow({
        title: this.props.labels.settingsTextEditorFontFamily,
        control: fontFamilySelect,
      }),
      createSettingsRow({
        title: this.props.labels.settingsTextEditorFontSize,
        control: fontSizeSelect,
      }),
      createSettingsRow({
        title: this.props.labels.settingsTextEditorLineHeight,
        control: lineHeightInput.element,
      }),
      createSettingsRow({
        title: this.props.labels.settingsTextEditorParagraphSpacingBefore,
        control: paragraphSpacingBeforeInput.element,
      }),
      createSettingsRow({
        title: this.props.labels.settingsTextEditorParagraphSpacingAfter,
        control: paragraphSpacingAfterInput.element,
      }),
      createSettingsRow({
        title: this.props.labels.settingsTextEditorColor,
        control: colorRow,
      }),
      createSettingsRow({
        title: this.props.labels.settingsTextEditorResetDefaultBodyStyle,
        control: resetButton,
      }),
    );

    field.append(textEditorPanel.element);
    return field;
  }

}

export type SettingsTopbarActionsProps = {
  backLabel: string;
  onNavigateBack: () => void;
};

export class SettingsTopbarActionsView {
  private readonly actionBarView = createActionBarView({
    className: 'sidebar-topbar-actions',
    ariaRole: 'group',
  });
  private readonly hostElement = el('div', 'sidebar-topbar-actions-host');

  constructor(_props: SettingsTopbarActionsProps) {
    this.hostElement.append(this.actionBarView.getElement());
    this.render();
  }

  getElement() {
    return this.hostElement;
  }

  setProps(_props: SettingsTopbarActionsProps) {
    this.render();
  }

  dispose() {
    this.actionBarView.dispose();
    this.hostElement.replaceChildren();
  }

  private render() {
    this.actionBarView.setProps({
      className: 'sidebar-topbar-actions',
      ariaRole: 'group',
      items: [],
    });
  }
}

export function createSettingsPartView(props: SettingsPartProps) {
  return new SettingsPartView(props);
}

export function createSettingsTopbarActionsView(
  props: SettingsTopbarActionsProps,
) {
  return new SettingsTopbarActionsView(props);
}

export default SettingsPartView;
