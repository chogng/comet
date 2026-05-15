import type { LocaleMessages } from 'language/locales';
import { DomScrollableElement } from 'ls/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'ls/base/browser/ui/scrollbar/scrollableElementOptions';
import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';

import { KnowledgeBaseWidget } from 'ls/workbench/contrib/preferences/browser/knowledgeBaseWidget';
import type { KnowledgeBaseWidgetProps } from 'ls/workbench/contrib/preferences/browser/knowledgeBaseWidget';

import { LlmWidget } from 'ls/workbench/contrib/preferences/browser/llmWidget';
import {
  createSettingsSectionMap,
} from 'ls/workbench/contrib/preferences/browser/settingsLayout';
import type { SettingsPageId, SettingsSectionId } from 'ls/workbench/contrib/preferences/browser/settingsLayout';
import { createSettingsNavigationView } from 'ls/workbench/contrib/preferences/browser/settingsNavigationView';
import { renderSettingsPage } from 'ls/workbench/contrib/preferences/browser/settingsPages';
import {
  buildSettingsHint as buildHint,
  createSettingsElement as el,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  renderAppearanceSection,
  renderBatchOptionsSection,
  renderConfigPathSection,
  renderDownloadDirectorySection,
  renderLayoutSection,
  renderLocaleSection,
  renderNotificationsSection,
  renderSupportedSourcesSection,
  renderTextEditorSection,
} from 'ls/workbench/contrib/preferences/browser/settingsSections';
import { shouldUpdateSettingsSection } from 'ls/workbench/contrib/preferences/browser/settingsSectionUpdates';

import type {
  SettingsPartActions,
  SettingsPartLabels,
  SettingsPartProps,
  SettingsPartState,
} from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import { TranslationWidget } from 'ls/workbench/contrib/preferences/browser/translationWidget';
import { registerWorkbenchPartDomNode, WORKBENCH_PART_IDS } from 'ls/workbench/browser/layout';
import 'ls/workbench/contrib/preferences/browser/media/settingsEditor.css';
import 'ls/workbench/contrib/preferences/browser/media/settingsWidgets.css';

type CreateSettingsPartLabelsParams = { ui: LocaleMessages };
type CreateSettingsPartPropsParams = { state: SettingsPartState; actions: SettingsPartActions };

export function createSettingsPartLabels({ ui }: CreateSettingsPartLabelsParams): SettingsPartLabels {
  return {
    settingsTitle: ui.settingsTitle, settingsLoading: ui.settingsLoading, settingsLanguage: ui.settingsLanguage, languageChinese: ui.languageChinese, languageEnglish: ui.languageEnglish, settingsLanguageHint: ui.settingsLanguageHint,
    settingsNavigationBack: ui.settingsNavigationBack, settingsNavigationGeneral: ui.settingsNavigationGeneral, settingsNavigationAppearance: ui.settingsNavigationAppearance, settingsNavigationTextEditor: ui.settingsNavigationTextEditor, settingsNavigationKnowledgeBase: ui.settingsNavigationKnowledgeBase, settingsNavigationLiterature: ui.settingsNavigationLiterature, settingsTextEditorTitle: ui.settingsTextEditorTitle, settingsTextEditorHint: ui.settingsTextEditorHint,
    settingsTextEditorDefaultBodyStyle: ui.settingsTextEditorDefaultBodyStyle, settingsTextEditorFontFamily: ui.settingsTextEditorFontFamily, settingsTextEditorFontSize: ui.settingsTextEditorFontSize, settingsTextEditorLineHeight: ui.settingsTextEditorLineHeight, settingsTextEditorParagraphSpacingBefore: ui.settingsTextEditorParagraphSpacingBefore, settingsTextEditorParagraphSpacingAfter: ui.settingsTextEditorParagraphSpacingAfter, settingsTextEditorColor: ui.settingsTextEditorColor,
    settingsBatchOptions: ui.settingsBatchOptions, batchCount: ui.batchCount, startDate: ui.startDate, endDate: ui.endDate, clearDate: ui.clearDate, today: ui.today,
    settingsSupportedSources: ui.settingsSupportedSources, settingsSupportedSourcesHint: ui.settingsSupportedSourcesHint, settingsSupportedSourceUrl: ui.settingsSupportedSourceUrl, settingsSupportedSourceJournalTitle: ui.settingsSupportedSourceJournalTitle, settingsSupportedSourcesShow: ui.settingsSupportedSourcesShow, settingsSupportedSourcesHide: ui.settingsSupportedSourcesHide,
    settingsAppearanceTitle: ui.settingsAppearanceTitle, settingsTheme: ui.settingsTheme, settingsThemeHint: ui.settingsThemeHint, settingsThemeLight: ui.settingsThemeLight, settingsThemeDark: ui.settingsThemeDark, settingsThemeSystem: ui.settingsThemeSystem, settingsUseMica: ui.settingsUseMica, settingsUseMicaHint: ui.settingsUseMicaHint, settingsLibraryTitle: ui.settingsLibraryTitle, settingsKnowledgeBaseTitle: ui.settingsKnowledgeBaseTitle, settingsKnowledgeBaseHint: ui.settingsKnowledgeBaseHint, settingsKnowledgeBaseMode: ui.settingsKnowledgeBaseMode,
    settingsKnowledgeBaseModeHint: ui.settingsKnowledgeBaseModeHint, settingsKnowledgeBaseModeDisabledHint: ui.settingsKnowledgeBaseModeDisabledHint, settingsKnowledgeBaseAutoIndex: ui.settingsKnowledgeBaseAutoIndex, settingsKnowledgeBaseAutoIndexHint: ui.settingsKnowledgeBaseAutoIndexHint,
    settingsKnowledgeBasePdfDownloadDir: ui.settingsKnowledgeBasePdfDownloadDir, settingsKnowledgeBasePdfDownloadDirPlaceholder: ui.settingsKnowledgeBasePdfDownloadDirPlaceholder, settingsKnowledgeBasePdfDownloadDirHint: ui.settingsKnowledgeBasePdfDownloadDirHint,
    settingsLibraryStorageMode: ui.settingsLibraryStorageMode, settingsLibraryStorageModeLinkedOriginal: ui.settingsLibraryStorageModeLinkedOriginal, settingsLibraryStorageModeManagedCopy: ui.settingsLibraryStorageModeManagedCopy, settingsLibraryDirectory: ui.settingsLibraryDirectory,
    settingsLibraryDirectoryPlaceholder: ui.settingsLibraryDirectoryPlaceholder, settingsLibraryDirectoryHint: ui.settingsLibraryDirectoryHint, settingsLibraryDirectoryInactiveHint: ui.settingsLibraryDirectoryInactiveHint, settingsLibraryDbFile: ui.settingsLibraryDbFile, settingsLibraryFilesDir: ui.settingsLibraryFilesDir, settingsLibraryCacheDir: ui.settingsLibraryCacheDir,
    settingsLibraryStatusDocuments: ui.settingsLibraryStatusDocuments, settingsLibraryStatusFiles: ui.settingsLibraryStatusFiles, settingsLibraryStatusQueuedJobs: ui.settingsLibraryStatusQueuedJobs, settingsLibraryStatusEmpty: ui.settingsLibraryStatusEmpty, settingsLibraryRecentDocuments: ui.settingsLibraryRecentDocuments,
    settingsLibraryDocumentRegistered: ui.settingsLibraryDocumentRegistered, settingsLibraryDocumentQueued: ui.settingsLibraryDocumentQueued, settingsLibraryDocumentRunning: ui.settingsLibraryDocumentRunning, settingsLibraryDocumentFailed: ui.settingsLibraryDocumentFailed,
    settingsLibraryMaxConcurrentJobs: ui.settingsLibraryMaxConcurrentJobs, settingsLibraryMaxConcurrentJobsHint: ui.settingsLibraryMaxConcurrentJobsHint, settingsRagTitle: ui.settingsRagTitle, settingsRagProvider: ui.settingsRagProvider, settingsRagProviderHint: ui.settingsRagProviderHint,
    settingsRagProviderMoark: ui.settingsRagProviderMoark, settingsRagApiKey: ui.settingsRagApiKey, settingsRagApiKeyPlaceholder: ui.settingsRagApiKeyPlaceholder, settingsRagBaseUrl: ui.settingsRagBaseUrl, settingsRagEmbeddingModel: ui.settingsRagEmbeddingModel,
    settingsRagRerankerModel: ui.settingsRagRerankerModel, settingsRagEmbeddingPath: ui.settingsRagEmbeddingPath, settingsRagRerankPath: ui.settingsRagRerankPath, settingsRagCandidateCount: ui.settingsRagCandidateCount, settingsRagTopK: ui.settingsRagTopK,
    settingsRagTestConnection: ui.settingsRagTestConnection, settingsRagShowApiKey: ui.settingsRagShowApiKey, settingsRagHideApiKey: ui.settingsRagHideApiKey, settingsRagHint: ui.settingsRagHint, settingsBatchHint: ui.settingsBatchHint, defaultPdfDir: ui.defaultPdfDir, settingsLayoutTitle: ui.settingsLayoutTitle, settingsStatusbar: ui.settingsStatusbar, settingsStatusbarHint: ui.settingsStatusbarHint, settingsBrowserTabKeepAliveLimit: ui.settingsBrowserTabKeepAliveLimit, settingsBrowserTabKeepAliveLimitHint: ui.settingsBrowserTabKeepAliveLimitHint, settingsNotificationsTitle: ui.settingsNotificationsTitle, settingsNotificationsHint: ui.settingsNotificationsHint, settingsSystemNotifications: ui.settingsSystemNotifications, settingsSystemNotificationsHint: ui.settingsSystemNotificationsHint, settingsWarningNotifications: ui.settingsWarningNotifications, settingsWarningNotificationsHint: ui.settingsWarningNotificationsHint, settingsMenuBarIcon: ui.settingsMenuBarIcon, settingsMenuBarIconHint: ui.settingsMenuBarIconHint, settingsCompletionNotifications: ui.settingsCompletionNotifications, settingsCompletionNotificationsHint: ui.settingsCompletionNotificationsHint,
    pdfFileNameUseSelectionOrder: ui.pdfFileNameUseSelectionOrder, pdfFileNameUseSelectionOrderHint: ui.pdfFileNameUseSelectionOrderHint, downloadDirPlaceholder: ui.downloadDirPlaceholder, change: ui.change, open: ui.open, chooseDirectory: ui.chooseDirectory, changeConfigLocation: ui.changeConfigLocation,
    resetDefault: ui.resetDefault, settingsHintPath: ui.settingsHintPath, settingsConfigPath: ui.settingsConfigPath, currentDir: ui.currentDir, systemDownloads: ui.systemDownloads, settingsLlmTitle: ui.settingsLlmTitle, settingsLlmProvider: ui.settingsLlmProvider,
    settingsLlmProviderHint: ui.settingsLlmProviderHint, settingsLlmProviderGlm: ui.settingsLlmProviderGlm, settingsLlmProviderKimi: ui.settingsLlmProviderKimi, settingsLlmProviderDeepSeek: ui.settingsLlmProviderDeepSeek, settingsLlmProviderGemini: ui.settingsLlmProviderGemini, settingsLlmApiKey: ui.settingsLlmApiKey,
    settingsLlmApiKeyPlaceholder: ui.settingsLlmApiKeyPlaceholder, settingsLlmModel: ui.settingsLlmModel, settingsLlmSearchPlaceholder: ui.settingsLlmSearchPlaceholder, settingsLlmNoResults: ui.settingsLlmNoResults, settingsLlmMaxContext: ui.settingsLlmMaxContext, settingsLlmMaxContextHint: ui.settingsLlmMaxContextHint, settingsLlmTestConnection: ui.settingsLlmTestConnection, settingsLlmShowApiKey: ui.settingsLlmShowApiKey, settingsLlmHideApiKey: ui.settingsLlmHideApiKey,
    settingsTranslationTitle: ui.settingsTranslationTitle, settingsTranslationProvider: ui.settingsTranslationProvider, settingsTranslationProviderHint: ui.settingsTranslationProviderHint, settingsTranslationProviderDeepL: ui.settingsTranslationProviderDeepL, settingsTranslationProviderGlm: ui.settingsTranslationProviderGlm, settingsTranslationProviderOpenAICompatible: ui.settingsTranslationProviderOpenAICompatible, settingsTranslationProviderOpenAICompatibleHint: ui.settingsTranslationProviderOpenAICompatibleHint, settingsTranslationBaseUrl: ui.settingsTranslationBaseUrl,
    settingsTranslationApiKey: ui.settingsTranslationApiKey, settingsTranslationApiKeyPlaceholder: ui.settingsTranslationApiKeyPlaceholder, settingsTranslationTestConnection: ui.settingsTranslationTestConnection, settingsTranslationShowApiKey: ui.settingsTranslationShowApiKey,
    settingsTranslationHideApiKey: ui.settingsTranslationHideApiKey,
  };
}

export function createSettingsPartProps({ state, actions }: CreateSettingsPartPropsParams): SettingsPartProps {
  return {
    labels: createSettingsPartLabels({ ui: state.ui }),
    showSupportedSources: false,
    onToggleSupportedSources: () => {},
    ...state,
    ...actions,
  };
}

type FocusSnapshot = {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
} | null;

export class SettingsPartView {
  private props: SettingsPartProps;
  private readonly navigationView: ReturnType<typeof createSettingsNavigationView>;
  private readonly container = el('div', 'settings-page');
  private readonly content = el('div', 'settings-content-body');
  private readonly contentScrollable = new DomScrollableElement(this.content, {
    className: 'settings-content',
    vertical: ScrollbarVisibility.Auto,
    horizontal: ScrollbarVisibility.Hidden,
    useShadows: false,
  });
  private readonly topbar = el('div', 'settings-page-topbar');
  private readonly pageTitle = el('h2', 'settings-page-title');
  private readonly loadingHint = buildHint('');
  // Keep section containers stable so updates can replace only local content
  // without recreating the whole settings page.
  private readonly sections = createSettingsSectionMap(() => el('section', 'settings-section'));
  private readonly knowledgeBaseWidget: KnowledgeBaseWidget;
  private readonly llmWidget: LlmWidget;
  private readonly translationWidget: TranslationWidget;
  private showRagApiKey = false;
  private showLlmApiKey = false;
  private showTranslationApiKey = false;
  private showSupportedSources = false;
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
      llmProviders: this.props.llmProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingTranslationConnection: this.props.isTestingTranslationConnection,
      showApiKey: this.showTranslationApiKey,
      onToggleShowApiKey: () => { this.showTranslationApiKey = !this.showTranslationApiKey; this.updateTranslationWidget(); },
      onActiveTranslationProviderChange: (provider) => this.props.onActiveTranslationProviderChange(provider),
      onTranslationProviderApiKeyChange: (provider, apiKey) => this.props.onTranslationProviderApiKeyChange(provider, apiKey),
      onTranslationProviderBaseUrlChange: (provider, baseUrl) => this.props.onTranslationProviderBaseUrlChange(provider, baseUrl),
      onTranslationProviderModelChange: (provider, model) => this.props.onTranslationProviderModelChange(provider, model),
      onGlmModelChange: (optionValue) => this.props.onLlmProviderSelectedModelOption('glm', optionValue),
      onTestTranslationConnection: () => this.props.onTestTranslationConnection(),
    });
    this.container.append(this.topbar, this.contentScrollable.getDomNode());
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
    return this.contentScrollable.getDomNode();
  }

  setProps(props: SettingsPartProps) {
    const previousProps = this.props;
    this.props = props;
    this.updateView(previousProps);
  }

  dispose() {
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, null);
    this.navigationView.dispose();
    this.contentScrollable.dispose();
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
      this.contentScrollable.getDomNode().querySelector<HTMLElement>(selector) ??
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
      llmProviders: this.props.llmProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingTranslationConnection: this.props.isTestingTranslationConnection,
      showApiKey: this.showTranslationApiKey,
      onToggleShowApiKey: () => { this.showTranslationApiKey = !this.showTranslationApiKey; this.updateTranslationWidget(); },
      onActiveTranslationProviderChange: (provider) => this.props.onActiveTranslationProviderChange(provider),
      onTranslationProviderApiKeyChange: (provider, apiKey) => this.props.onTranslationProviderApiKeyChange(provider, apiKey),
      onTranslationProviderBaseUrlChange: (provider, baseUrl) => this.props.onTranslationProviderBaseUrlChange(provider, baseUrl),
      onTranslationProviderModelChange: (provider, model) => this.props.onTranslationProviderModelChange(provider, model),
      onGlmModelChange: (optionValue) => this.props.onLlmProviderSelectedModelOption('glm', optionValue),
      onTestTranslationConnection: () => this.props.onTestTranslationConnection(),
    });
  }

  private withRuntimeUiState(props: SettingsPartProps): SettingsPartProps {
    return {
      ...props,
      showSupportedSources: this.showSupportedSources,
      onToggleSupportedSources: this.handleToggleSupportedSources,
    };
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
    const { contentChildren, activeSectionIds } = renderSettingsPage({
      pageId: this.activePageId,
      props: this.props,
      pageTitleElement: this.pageTitle,
      loadingHintElement: this.loadingHint,
      sections: this.sections,
    });
    this.content.replaceChildren(...contentChildren);
    this.contentScrollable.scanDomNode();
    for (const [sectionId, section] of Object.entries(this.sections) as Array<[SettingsSectionId, HTMLElement]>) {
      section.classList.toggle('active', activeSectionIds.includes(sectionId));
    }
  }

  private updateView(previousProps?: SettingsPartProps, forceAll = false) {
    const focusSnapshot = this.captureFocus();
    this.props = this.withRuntimeUiState(this.props);
    this.loadingHint.textContent = this.props.labels.settingsLoading;
    this.syncNavigationView();

    if (forceAll || shouldUpdateSettingsSection('locale', previousProps, this.props)) {
      this.updateSection(this.sections.locale, renderLocaleSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('layout', previousProps, this.props)) {
      this.updateSection(this.sections.layout, renderLayoutSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('notifications', previousProps, this.props)) {
      this.updateSection(this.sections.notifications, renderNotificationsSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('batchOptions', previousProps, this.props)) {
      this.updateSection(this.sections.batchOptions, renderBatchOptionsSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('supportedSources', previousProps, this.props)) {
      this.updateSection(this.sections.supportedSources, renderSupportedSourcesSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('appearance', previousProps, this.props)) {
      this.updateSection(this.sections.appearance, renderAppearanceSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('textEditor', previousProps, this.props)) {
      this.updateSection(this.sections.textEditor, renderTextEditorSection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('knowledgeBase', previousProps, this.props)) {
      this.updateKnowledgeBaseWidget();
      this.updateSection(this.sections.knowledgeBase, this.knowledgeBaseWidget.getElement());
    }
    if (forceAll || shouldUpdateSettingsSection('downloadDirectory', previousProps, this.props)) {
      this.updateSection(this.sections.downloadDirectory, renderDownloadDirectorySection(this.props));
    }
    if (forceAll || shouldUpdateSettingsSection('llm', previousProps, this.props)) {
      this.updateLlmWidget();
      this.updateSection(this.sections.llm, this.llmWidget.getElement());
    }
    if (forceAll || shouldUpdateSettingsSection('translation', previousProps, this.props)) {
      this.updateTranslationWidget();
      this.updateSection(this.sections.translation, this.translationWidget.getElement());
    }
    if (forceAll || shouldUpdateSettingsSection('configPath', previousProps, this.props)) {
      this.updateSection(this.sections.configPath, renderConfigPathSection(this.props));
    }

    this.renderActivePage();
    this.restoreFocus(focusSnapshot);
  }

  private readonly handleToggleSupportedSources = () => {
    this.showSupportedSources = !this.showSupportedSources;
    this.props = this.withRuntimeUiState(this.props);
    this.updateSection(this.sections.supportedSources, renderSupportedSourcesSection(this.props));
    this.renderActivePage();
  };

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
