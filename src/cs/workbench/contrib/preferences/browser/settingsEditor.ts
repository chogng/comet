import type { LocaleMessages } from 'language/locales';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';

import {
  renderLibrarySettingsSection,
  type LibrarySettingsSectionProps,
} from 'cs/workbench/contrib/preferences/browser/libraryWidget';
import {
  LlmApiKeySettingsSection,
  LlmModelSettingsSection,
  type LlmSettingsSectionProps,
} from 'cs/workbench/contrib/preferences/browser/llmWidget';
import {
  renderRagSettingsSection,
  type RagSettingsSectionProps,
} from 'cs/workbench/contrib/preferences/browser/ragWidget';
import type { SettingsPageId } from 'cs/workbench/contrib/preferences/common/settings';
import type { IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import { SettingsTree } from 'cs/workbench/contrib/preferences/browser/settingsTree';
import type { SettingsSectionRenderers } from 'cs/workbench/contrib/preferences/browser/settingsTree';
import { SettingsTreeModel } from 'cs/workbench/contrib/preferences/browser/settingsTreeModel';
import {
  buildSettingsHint as buildHint,
  createSettingsElement as el,
  setSettingsFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  renderAppearanceSection,
  renderBrowserSection,
  renderConfigPathSection,
  renderDownloadDirectorySection,
  renderLayoutSection,
  renderLocaleSection,
  renderNotificationsSection,
  renderSupportedSourcesSection,
  renderTextEditorSection,
} from 'cs/workbench/contrib/preferences/browser/settingsSections';

import type {
  SettingsPartActions,
  SettingsPartLabels,
  SettingsPartProps,
  SettingsPartState,
} from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import { TOCTree, TOCTreeModel } from 'cs/workbench/contrib/preferences/browser/tocTree';
import {
  TranslationSettingsSection,
  type TranslationSettingsSectionProps,
} from 'cs/workbench/contrib/preferences/browser/translationWidget';
import { registerWorkbenchPartDomNode, WORKBENCH_PART_IDS } from 'cs/workbench/browser/layout';
import 'cs/workbench/contrib/preferences/browser/media/settingsEditor.css';
import 'cs/workbench/contrib/preferences/browser/media/settingsWidgets.css';

type CreateSettingsPartLabelsParams = { ui: LocaleMessages };
type CreateSettingsPartPropsParams = { state: SettingsPartState; actions: SettingsPartActions };

export function createSettingsPartLabels({ ui }: CreateSettingsPartLabelsParams): SettingsPartLabels {
  return {
    settingsTitle: ui.settingsTitle, settingsLoading: ui.settingsLoading, settingsSearchPlaceholder: ui.settingsSearchPlaceholder, settingsSearchNoResults: ui.settingsSearchNoResults, settingsLanguage: ui.settingsLanguage, languageChinese: ui.languageChinese, languageEnglish: ui.languageEnglish, settingsLanguageHint: ui.settingsLanguageHint,
    settingsNavigationGeneral: ui.settingsNavigationGeneral, settingsNavigationAppearance: ui.settingsNavigationAppearance, settingsNavigationBrowser: ui.settingsNavigationBrowser, settingsNavigationTextEditor: ui.settingsNavigationTextEditor, settingsNavigationKnowledgeBase: ui.settingsNavigationKnowledgeBase, settingsNavigationLiterature: ui.settingsNavigationLiterature, settingsTextEditorTitle: ui.settingsTextEditorTitle, settingsTextEditorHint: ui.settingsTextEditorHint,
    settingsTextEditorDefaultBodyStyle: ui.settingsTextEditorDefaultBodyStyle, settingsTextEditorFontFamily: ui.settingsTextEditorFontFamily, settingsTextEditorFontSize: ui.settingsTextEditorFontSize, settingsTextEditorLineHeight: ui.settingsTextEditorLineHeight, settingsTextEditorParagraphSpacingBefore: ui.settingsTextEditorParagraphSpacingBefore, settingsTextEditorParagraphSpacingAfter: ui.settingsTextEditorParagraphSpacingAfter, settingsTextEditorColor: ui.settingsTextEditorColor,
    settingsBatchOptions: ui.settingsBatchOptions, batchCount: ui.batchCount, startDate: ui.startDate, endDate: ui.endDate, clearDate: ui.clearDate, today: ui.today,
    settingsSupportedSources: ui.settingsSupportedSources, settingsSupportedSourcesHint: ui.settingsSupportedSourcesHint, settingsSupportedSourceUrl: ui.settingsSupportedSourceUrl, settingsSupportedSourceJournalTitle: ui.settingsSupportedSourceJournalTitle, settingsSupportedSourceFetchTarget: ui.settingsSupportedSourceFetchTarget, settingsFetchTargetBackground: ui.settingsFetchTargetBackground, settingsFetchTargetWebContentsView: ui.settingsFetchTargetWebContentsView, settingsSupportedSourcesShow: ui.settingsSupportedSourcesShow, settingsSupportedSourcesHide: ui.settingsSupportedSourcesHide,
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
    settingsRagTestConnection: ui.settingsRagTestConnection, settingsRagHint: ui.settingsRagHint, settingsBatchHint: ui.settingsBatchHint, defaultPdfDir: ui.defaultPdfDir, settingsLayoutTitle: ui.settingsLayoutTitle, settingsStatusbar: ui.settingsStatusbar, settingsStatusbarHint: ui.settingsStatusbarHint, settingsStartupLayout: ui.settingsStartupLayout, settingsStartupLayoutHint: ui.settingsStartupLayoutHint, settingsStartupLayoutAgent: ui.settingsStartupLayoutAgent, settingsStartupLayoutFlow: ui.settingsStartupLayoutFlow, settingsBrowserTabKeepAliveLimit: ui.settingsBrowserTabKeepAliveLimit, settingsBrowserTabKeepAliveLimitHint: ui.settingsBrowserTabKeepAliveLimitHint, settingsBrowserTitle: ui.settingsBrowserTitle, settingsBrowserMaxHistoryEntries: ui.settingsBrowserMaxHistoryEntries, settingsBrowserMaxHistoryEntriesHint: ui.settingsBrowserMaxHistoryEntriesHint, settingsBrowserPageZoom: ui.settingsBrowserPageZoom, settingsBrowserPageZoomHint: ui.settingsBrowserPageZoomHint, settingsBrowserPageZoomMatchWindow: ui.settingsBrowserPageZoomMatchWindow, settingsBrowserSearchEngine: ui.settingsBrowserSearchEngine, settingsBrowserSearchEngineHint: ui.settingsBrowserSearchEngineHint, settingsBrowserSearchEngineNone: ui.settingsBrowserSearchEngineNone, settingsBrowserSearchEngineBing: ui.settingsBrowserSearchEngineBing, settingsBrowserSearchEngineGoogle: ui.settingsBrowserSearchEngineGoogle, settingsBrowserSearchEngineYahoo: ui.settingsBrowserSearchEngineYahoo, settingsBrowserSearchEngineDuckDuckGo: ui.settingsBrowserSearchEngineDuckDuckGo, settingsNotificationsTitle: ui.settingsNotificationsTitle, settingsNotificationsHint: ui.settingsNotificationsHint, settingsSystemNotifications: ui.settingsSystemNotifications, settingsSystemNotificationsHint: ui.settingsSystemNotificationsHint, settingsWarningNotifications: ui.settingsWarningNotifications, settingsWarningNotificationsHint: ui.settingsWarningNotificationsHint, settingsMenuBarIcon: ui.settingsMenuBarIcon, settingsMenuBarIconHint: ui.settingsMenuBarIconHint, settingsCompletionNotifications: ui.settingsCompletionNotifications, settingsCompletionNotificationsHint: ui.settingsCompletionNotificationsHint,
    pdfFileNameUseSelectionOrder: ui.pdfFileNameUseSelectionOrder, pdfFileNameUseSelectionOrderHint: ui.pdfFileNameUseSelectionOrderHint, downloadDirPlaceholder: ui.downloadDirPlaceholder, change: ui.change, open: ui.open, chooseDirectory: ui.chooseDirectory, changeConfigLocation: ui.changeConfigLocation,
    resetDefault: ui.resetDefault, settingsHintPath: ui.settingsHintPath, settingsConfigPath: ui.settingsConfigPath, currentDir: ui.currentDir, systemDownloads: ui.systemDownloads, settingsLlmTitle: ui.settingsLlmTitle, settingsLlmProvider: ui.settingsLlmProvider,
    settingsLlmProviderHint: ui.settingsLlmProviderHint, settingsLlmProviderGlm: ui.settingsLlmProviderGlm, settingsLlmProviderKimi: ui.settingsLlmProviderKimi, settingsLlmProviderDeepSeek: ui.settingsLlmProviderDeepSeek, settingsLlmProviderGemini: ui.settingsLlmProviderGemini, settingsLlmApiKey: ui.settingsLlmApiKey,
    settingsApiKeyConfigured: ui.settingsApiKeyConfigured, settingsApiKeyNotConfigured: ui.settingsApiKeyNotConfigured, settingsApiKeySet: ui.settingsApiKeySet, settingsApiKeyUpdate: ui.settingsApiKeyUpdate, settingsApiKeyClear: ui.settingsApiKeyClear,
    settingsLlmApiKeyPlaceholder: ui.settingsLlmApiKeyPlaceholder, settingsLlmModel: ui.settingsLlmModel, settingsLlmSearchPlaceholder: ui.settingsLlmSearchPlaceholder, settingsLlmNoResults: ui.settingsLlmNoResults, settingsLlmMaxContext: ui.settingsLlmMaxContext, settingsLlmMaxContextHint: ui.settingsLlmMaxContextHint, settingsLlmTestConnection: ui.settingsLlmTestConnection,
    settingsTranslationTitle: ui.settingsTranslationTitle, settingsTranslationProvider: ui.settingsTranslationProvider, settingsTranslationProviderHint: ui.settingsTranslationProviderHint, settingsTranslationProviderDeepL: ui.settingsTranslationProviderDeepL, settingsTranslationProviderGlm: ui.settingsTranslationProviderGlm, settingsTranslationProviderOpenAICompatible: ui.settingsTranslationProviderOpenAICompatible, settingsTranslationProviderCustom: ui.settingsTranslationProviderCustom, settingsTranslationProviderOpenAICompatibleHint: ui.settingsTranslationProviderOpenAICompatibleHint, settingsTranslationBaseUrl: ui.settingsTranslationBaseUrl,
    settingsTranslationApiKey: ui.settingsTranslationApiKey, settingsTranslationApiKeyPlaceholder: ui.settingsTranslationApiKeyPlaceholder, settingsTranslationFetchModels: ui.settingsTranslationFetchModels, settingsTranslationTestConnection: ui.settingsTranslationTestConnection,
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
  private readonly container = el('div', 'comet-settings-page');
  private readonly navigation = el('aside', 'comet-settings-navigation');
  private readonly search = el('div', 'comet-settings-navigation-search');
  private readonly searchInput = setSettingsFocusKey(
    el('input', 'comet-settings-navigation-search-input'),
    'settings.search',
  );
  private readonly content = el('div', 'comet-settings-content-body');
  private readonly contentScrollable = new DomScrollableElement(this.content, {
    className: 'comet-settings-content',
    vertical: ScrollbarVisibility.Auto,
    horizontal: ScrollbarVisibility.Hidden,
    useShadows: false,
  });
  private readonly topbar = el('div', 'comet-settings-page-topbar');
  private readonly pageTitle = el('h2', 'comet-settings-page-title');
  private readonly loadingHint = buildHint('');
  private readonly noResultsHint = buildHint('', 'comet-settings-hint comet-settings-no-results');
  private readonly llmModelSection: LlmModelSettingsSection;
  private readonly llmApiKeySection: LlmApiKeySettingsSection;
  private readonly translationSection: TranslationSettingsSection;
  private readonly settingsTree: SettingsTree;
  private readonly settingsTreeModel: SettingsTreeModel;
  private readonly tocTreeModel: TOCTreeModel;
  private readonly tocTree: TOCTree;
  private showSupportedSources = false;
  private activePageId: SettingsPageId = 'general';
  private searchQuery = '';

  constructor(
    props: SettingsPartProps,
    private readonly contextViewProvider: IContextViewProvider,
  ) {
    this.props = props;
    this.settingsTreeModel = new SettingsTreeModel(this.props.labels, this.searchQuery);
    this.tocTreeModel = new TOCTreeModel(this.props.labels, this.settingsTreeModel);
    this.settingsTree = new SettingsTree(this.settingsTreeModel, {
      contentElement: this.content,
      scrollableElement: this.contentScrollable,
      pageTitleElement: this.pageTitle,
      loadingHintElement: this.loadingHint,
      noResultsElement: this.noResultsHint,
      sectionRenderers: this.createSectionRenderers(),
    });
    this.tocTree = new TOCTree(this.tocTreeModel, {
      title: this.props.labels.settingsTitle,
      activePageId: this.activePageId,
      onDidSelectPage: this.handleDidSelectPage,
    });
    this.initializeSearch();
    const llmSectionProps = this.getLlmSectionProps();
    this.llmModelSection = new LlmModelSettingsSection(llmSectionProps);
    this.llmApiKeySection = new LlmApiKeySettingsSection(llmSectionProps);
    this.translationSection = new TranslationSettingsSection(this.getTranslationSectionProps());
    this.navigation.append(this.search, this.tocTree.getElement());
    this.container.append(this.topbar, this.contentScrollable.getDomNode());
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, this.container);
    this.updateView(undefined, true);
  }

  getElement() {
    return this.container;
  }

  getNavigationElement() {
    return this.navigation;
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
    this.tocTree.dispose();
    this.settingsTree.dispose();
    this.contentScrollable.dispose();
    this.container.replaceChildren();
    this.navigation.replaceChildren();
  }

  private containsManagedElement(node: Node) {
    return (
      this.navigation.contains(node) ||
      this.container.contains(node)
    );
  }

  private queryManagedFocusTarget(key: string) {
    const selector = `[data-focus-key="${key}"]`;
    return (
      this.contentScrollable.getDomNode().querySelector<HTMLElement>(selector) ??
      this.navigation.querySelector<HTMLElement>(selector)
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

  private getLibrarySectionProps(): LibrarySettingsSectionProps {
    return {
      labels: this.props.labels,
      contextViewProvider: this.contextViewProvider,
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
    };
  }

  private getRagSectionProps(): RagSettingsSectionProps {
    return {
      labels: this.props.labels,
      activeRagProvider: this.props.activeRagProvider,
      ragProviders: this.props.ragProviders,
      retrievalCandidateCount: this.props.retrievalCandidateCount,
      retrievalTopK: this.props.retrievalTopK,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingRagConnection: this.props.isTestingRagConnection,
      onRagProviderApiKeyChange: (provider, apiKey) => this.props.onRagProviderApiKeyChange(provider, apiKey),
      onRagProviderBaseUrlChange: (provider, baseUrl) => this.props.onRagProviderBaseUrlChange(provider, baseUrl),
      onRagProviderEmbeddingModelChange: (provider, model) => this.props.onRagProviderEmbeddingModelChange(provider, model),
      onRagProviderRerankerModelChange: (provider, model) => this.props.onRagProviderRerankerModelChange(provider, model),
      onRagProviderEmbeddingPathChange: (provider, path) => this.props.onRagProviderEmbeddingPathChange(provider, path),
      onRagProviderRerankPathChange: (provider, path) => this.props.onRagProviderRerankPathChange(provider, path),
      onRetrievalCandidateCountChange: (value) => this.props.onRetrievalCandidateCountChange(value),
      onRetrievalTopKChange: (value) => this.props.onRetrievalTopKChange(value),
      onTestRagConnection: () => this.props.onTestRagConnection(),
    };
  }

  private getLlmSectionProps(): LlmSettingsSectionProps {
    return {
      labels: this.props.labels,
      activeLlmProvider: this.props.activeLlmProvider,
      llmProviders: this.props.llmProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingLlmConnection: this.props.isTestingLlmConnection,
      onActiveLlmProviderChange: (provider) => this.props.onActiveLlmProviderChange(provider),
      onLlmProviderApiKeyChange: (provider, apiKey) => this.props.onLlmProviderApiKeyChange(provider, apiKey),
      onLlmProviderModelChange: (provider, model) => this.props.onLlmProviderModelChange(provider, model),
      onLlmProviderSelectedModelOption: (provider, optionValue) => this.props.onLlmProviderSelectedModelOption(provider, optionValue),
      onLlmProviderReasoningEffortChange: (provider, reasoningEffort) => this.props.onLlmProviderReasoningEffortChange(provider, reasoningEffort),
      onLlmProviderModelEnabledChange: (provider, model, enabled) => this.props.onLlmProviderModelEnabledChange(provider, model, enabled),
      onLlmProviderUseMaxContextWindowChange: (provider, useMaxContextWindow) => this.props.onLlmProviderUseMaxContextWindowChange(provider, useMaxContextWindow),
      onTestLlmConnection: () => this.props.onTestLlmConnection(),
    };
  }

  private getTranslationSectionProps(): TranslationSettingsSectionProps {
    return {
      labels: this.props.labels,
      contextViewProvider: this.contextViewProvider,
      activeTranslationProvider: this.props.activeTranslationProvider,
      translationProviders: this.props.translationProviders,
      llmProviders: this.props.llmProviders,
      isSettingsSaving: this.props.isSettingsSaving,
      isTestingTranslationConnection: this.props.isTestingTranslationConnection,
      isLoadingTranslationModels: this.props.isLoadingTranslationModels,
      onActiveTranslationProviderChange: (provider) => this.props.onActiveTranslationProviderChange(provider),
      onTranslationProviderApiKeyChange: (provider, apiKey) => this.props.onTranslationProviderApiKeyChange(provider, apiKey),
      onTranslationProviderBaseUrlChange: (provider, baseUrl) => this.props.onTranslationProviderBaseUrlChange(provider, baseUrl),
      onTranslationProviderModelChange: (provider, model) => this.props.onTranslationProviderModelChange(provider, model),
      onGlmModelChange: (optionValue) => this.props.onLlmProviderSelectedModelOption('glm', optionValue),
      onFetchTranslationModels: () => this.props.onFetchTranslationModels(),
      onTestTranslationConnection: () => this.props.onTestTranslationConnection(),
    };
  }

  private updateLlmModelSection() {
    this.llmModelSection.setProps(this.getLlmSectionProps());
  }

  private updateLlmApiKeySection() {
    this.llmApiKeySection.setProps(this.getLlmSectionProps());
  }

  private updateTranslationSection() {
    this.translationSection.setProps(this.getTranslationSectionProps());
  }

  private createSectionRenderers(): SettingsSectionRenderers {
    return {
      locale: (props) => renderLocaleSection(props, this.contextViewProvider),
      layout: (props) => renderLayoutSection(props, this.contextViewProvider),
      browser: (props) => renderBrowserSection(props, this.contextViewProvider),
      notifications: renderNotificationsSection,
      appearance: (props) => renderAppearanceSection(props, this.contextViewProvider),
      configPath: renderConfigPathSection,
      textEditor: (props) => renderTextEditorSection(props, this.contextViewProvider),
      llmModel: () => {
        this.updateLlmModelSection();
        return this.llmModelSection.getElement();
      },
      llmApiKey: () => {
        this.updateLlmApiKeySection();
        return this.llmApiKeySection.getElement();
      },
      translation: () => {
        this.updateTranslationSection();
        return this.translationSection.getElement();
      },
		supportedSources: props => renderSupportedSourcesSection(props),
      knowledgeBaseLibrary: () => renderLibrarySettingsSection(this.getLibrarySectionProps()),
      knowledgeBaseRag: () => renderRagSettingsSection(this.getRagSectionProps()),
      downloadDirectory: renderDownloadDirectorySection,
    };
  }

  private withRuntimeUiState(props: SettingsPartProps): SettingsPartProps {
    return {
      ...props,
      showSupportedSources: this.showSupportedSources,
      onToggleSupportedSources: this.handleToggleSupportedSources,
    };
  }

  private initializeSearch() {
    const searchIcon = createLxIcon('search', 'comet-settings-navigation-search-icon');
    const placeholder = this.props.labels.settingsSearchPlaceholder;
    this.searchInput.type = 'search';
    this.searchInput.value = this.searchQuery;
    this.searchInput.placeholder = placeholder;
    this.searchInput.setAttribute('aria-label', placeholder);
    this.searchInput.autocomplete = 'off';
    this.searchInput.spellcheck = false;
    this.searchInput.addEventListener('input', () => {
      this.handleDidChangeSearchQuery(this.searchInput.value);
    });
    this.search.append(searchIcon, this.searchInput);
  }

  private syncSearch() {
    const placeholder = this.props.labels.settingsSearchPlaceholder;
    this.searchInput.placeholder = placeholder;
    this.searchInput.setAttribute('aria-label', placeholder);
    if (this.searchInput.value !== this.searchQuery) {
      this.searchInput.value = this.searchQuery;
    }
  }

  private syncTOCTree() {
    this.syncSearch();
    this.tocTreeModel.update(this.props.labels, this.settingsTreeModel);
    this.tocTree.update(this.tocTreeModel, {
      title: this.props.labels.settingsTitle,
      activePageId: this.activePageId,
      onDidSelectPage: this.handleDidSelectPage,
    });
  }

  private readonly handleDidSelectPage = (pageId: SettingsPageId) => {
    this.focusPage(pageId);
  };

  private readonly handleDidChangeSearchQuery = (query: string) => {
    const focusSnapshot = this.captureFocus();
    this.searchQuery = query;
    this.refreshTreeModel();
    this.ensureActiveSearchPage();
    this.renderActivePage();
    this.syncTOCTree();
    this.restoreFocus(focusSnapshot);
  };

  private refreshTreeModel() {
    this.settingsTreeModel.update(this.props.labels, this.searchQuery);
    this.noResultsHint.textContent = this.props.labels.settingsSearchNoResults;
  }

  private setActivePage(pageId: SettingsPageId) {
    if (this.activePageId === pageId) {
      return false;
    }
    this.activePageId = pageId;
    if (pageId === 'model') {
      this.llmModelSection.enterModelPage();
    }
    return true;
  }

  private ensureActiveSearchPage() {
    if (this.settingsTreeModel.hasVisiblePage(this.activePageId)) {
      return;
    }
    const firstVisiblePageId = this.settingsTreeModel.getFirstVisiblePageId();
    if (firstVisiblePageId) {
      this.setActivePage(firstVisiblePageId);
    }
  }

  private focusPage(pageId: SettingsPageId) {
    if (this.setActivePage(pageId)) {
      this.renderActivePage();
      this.syncTOCTree();
    }
  }

  private renderActivePage() {
    this.settingsTree.renderPage(this.activePageId, this.props);
  }

  private updateView(previousProps?: SettingsPartProps, forceAll = false) {
    const focusSnapshot = this.captureFocus();
    this.props = this.withRuntimeUiState(this.props);
    this.refreshTreeModel();
    this.ensureActiveSearchPage();
    this.loadingHint.textContent = this.props.labels.settingsLoading;
    this.syncTOCTree();
    this.settingsTree.updateSections(this.props, previousProps, forceAll);

    this.renderActivePage();
    this.restoreFocus(focusSnapshot);
  }

  private readonly handleToggleSupportedSources = () => {
    this.showSupportedSources = !this.showSupportedSources;
    this.props = this.withRuntimeUiState(this.props);
    this.settingsTree.updateSection('supportedSources', this.props);
    this.renderActivePage();
  };

}

export function createSettingsPartView(
  props: SettingsPartProps,
  contextViewProvider: IContextViewProvider,
) {
  return new SettingsPartView(props, contextViewProvider);
}

export default SettingsPartView;
