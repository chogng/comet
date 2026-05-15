import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type {
  AppTheme,
  BatchSource,
  JournalSourceOverride,
  LibraryDocumentSummary,
  LibraryStorageMode,
  LlmProviderId,
  LlmProviderSettings,
  RagProviderId,
  RagProviderSettings,
  TranslationProviderId,
  TranslationProviderSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { EditorDraftStyleSettings } from 'ls/base/common/editorDraftStyle';
import type { SettingValue } from 'ls/workbench/services/settings/settingValue';

export type SettingsDropdownOption = {
  value: string;
  label: string;
  title?: string;
  isDisabled?: boolean;
};

// Keep preferences types separate from the editor implementation so field views
// can depend on stable contracts without importing the editor host module.
export type SettingsPartLabels = {
  settingsTitle: string; settingsLoading: string; settingsLanguage: string; languageChinese: string; languageEnglish: string; settingsLanguageHint: string;
  settingsNavigationBack: string; settingsNavigationGeneral: string; settingsNavigationAppearance: string; settingsNavigationTextEditor: string; settingsNavigationKnowledgeBase: string; settingsNavigationLiterature: string; settingsTextEditorTitle: string; settingsTextEditorHint: string;
  settingsTextEditorDefaultBodyStyle: string; settingsTextEditorFontFamily: string; settingsTextEditorFontSize: string; settingsTextEditorLineHeight: string; settingsTextEditorParagraphSpacingBefore: string; settingsTextEditorParagraphSpacingAfter: string; settingsTextEditorColor: string;
  settingsBatchOptions: string; batchCount: string; startDate: string; endDate: string; clearDate: string; today: string;
  settingsSupportedSources: string; settingsSupportedSourcesHint: string; settingsSupportedSourceUrl: string; settingsSupportedSourceJournalTitle: string; settingsSupportedSourcesShow: string; settingsSupportedSourcesHide: string;
  settingsAppearanceTitle: string; settingsTheme: string; settingsThemeHint: string; settingsThemeLight: string; settingsThemeDark: string; settingsThemeSystem: string; settingsUseMica: string; settingsUseMicaHint: string; settingsLibraryTitle: string; settingsKnowledgeBaseMode: string;
  settingsKnowledgeBaseTitle: string; settingsKnowledgeBaseHint: string; settingsKnowledgeBaseModeHint: string; settingsKnowledgeBaseModeDisabledHint: string; settingsKnowledgeBaseAutoIndex: string; settingsKnowledgeBaseAutoIndexHint: string;
  settingsKnowledgeBasePdfDownloadDir: string; settingsKnowledgeBasePdfDownloadDirPlaceholder: string; settingsKnowledgeBasePdfDownloadDirHint: string;
  settingsLibraryStorageMode: string; settingsLibraryStorageModeLinkedOriginal: string; settingsLibraryStorageModeManagedCopy: string; settingsLibraryDirectory: string;
  settingsLibraryDirectoryPlaceholder: string; settingsLibraryDirectoryHint: string; settingsLibraryDirectoryInactiveHint: string; settingsLibraryDbFile: string; settingsLibraryFilesDir: string; settingsLibraryCacheDir: string;
  settingsLibraryStatusDocuments: string; settingsLibraryStatusFiles: string; settingsLibraryStatusQueuedJobs: string; settingsLibraryStatusEmpty: string; settingsLibraryRecentDocuments: string;
  settingsLibraryDocumentRegistered: string; settingsLibraryDocumentQueued: string; settingsLibraryDocumentRunning: string; settingsLibraryDocumentFailed: string;
  settingsLibraryMaxConcurrentJobs: string; settingsLibraryMaxConcurrentJobsHint: string; settingsRagTitle: string; settingsRagProvider: string; settingsRagProviderHint: string;
  settingsRagProviderMoark: string; settingsRagApiKey: string; settingsRagApiKeyPlaceholder: string; settingsRagBaseUrl: string; settingsRagEmbeddingModel: string;
  settingsRagRerankerModel: string; settingsRagEmbeddingPath: string; settingsRagRerankPath: string; settingsRagCandidateCount: string; settingsRagTopK: string;
  settingsRagTestConnection: string; settingsRagShowApiKey: string; settingsRagHideApiKey: string; settingsRagHint: string; settingsBatchHint: string; defaultPdfDir: string;
  settingsLayoutTitle: string; settingsStatusbar: string; settingsStatusbarHint: string; settingsBrowserTabKeepAliveLimit: string; settingsBrowserTabKeepAliveLimitHint: string; settingsNotificationsTitle: string; settingsNotificationsHint: string; settingsSystemNotifications: string; settingsSystemNotificationsHint: string; settingsWarningNotifications: string; settingsWarningNotificationsHint: string; settingsMenuBarIcon: string; settingsMenuBarIconHint: string; settingsCompletionNotifications: string; settingsCompletionNotificationsHint: string;
  pdfFileNameUseSelectionOrder: string; pdfFileNameUseSelectionOrderHint: string; downloadDirPlaceholder: string; change: string; open: string; chooseDirectory: string; changeConfigLocation: string;
  resetDefault: string; settingsHintPath: string; settingsConfigPath: string; currentDir: string; systemDownloads: string; settingsLlmTitle: string; settingsLlmProvider: string;
  settingsLlmProviderHint: string; settingsLlmProviderGlm: string; settingsLlmProviderKimi: string; settingsLlmProviderDeepSeek: string; settingsLlmProviderGemini: string; settingsLlmApiKey: string;
  settingsLlmApiKeyPlaceholder: string; settingsLlmModel: string; settingsLlmSearchPlaceholder: string; settingsLlmNoResults: string; settingsLlmMaxContext: string; settingsLlmMaxContextHint: string; settingsLlmTestConnection: string; settingsLlmShowApiKey: string; settingsLlmHideApiKey: string;
  settingsTranslationTitle: string; settingsTranslationProvider: string; settingsTranslationProviderHint: string; settingsTranslationProviderDeepL: string; settingsTranslationProviderGlm: string; settingsTranslationProviderOpenAICompatible: string; settingsTranslationProviderOpenAICompatibleHint: string; settingsTranslationBaseUrl: string;
  settingsTranslationApiKey: string; settingsTranslationApiKeyPlaceholder: string; settingsTranslationTestConnection: string; settingsTranslationShowApiKey: string;
  settingsTranslationHideApiKey: string;
};

export type SettingsPartProps = {
  labels: SettingsPartLabels; isSettingsLoading: boolean; locale: Locale;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  editorDraftFontFamilyOptions: readonly SettingsDropdownOption[];
  editorDraftFontSizeOptions: readonly SettingsDropdownOption[];
  onNavigateBack: () => void;
  batchLimit: number; onBatchLimitChange: (value: string) => void;
  supportedSources: BatchSource[]; journalSourceOverrides: JournalSourceOverride[]; showSupportedSources: boolean; onToggleSupportedSources: () => void; onJournalSourceTitleChange: (url: string, journalTitle: string) => void;
  fetchStartDate: string; onFetchStartDateChange: (value: string) => void; fetchEndDate: string; onFetchEndDateChange: (value: string) => void; systemNotificationsEnabled: boolean; onSystemNotificationsEnabledChange: (checked: boolean) => void; warningNotificationsEnabled: boolean; onWarningNotificationsEnabledChange: (checked: boolean) => void; menuBarIconEnabled: boolean; onMenuBarIconEnabledChange: (checked: boolean) => void; completionNotificationsEnabled: boolean; onCompletionNotificationsEnabledChange: (checked: boolean) => void; useMica: boolean; onUseMicaChange: (checked: boolean) => void; statusbarVisible: boolean; onStatusbarVisibleChange: (checked: boolean) => void; browserTabKeepAliveLimit: number; onBrowserTabKeepAliveLimitChange: (value: string) => void; theme: AppTheme; onThemeChange: (value: AppTheme) => void; knowledgeBaseEnabled: boolean;
  onKnowledgeBaseEnabledChange: (checked: boolean) => void; autoIndexDownloadedPdf: boolean; onAutoIndexDownloadedPdfChange: (checked: boolean) => void; knowledgeBasePdfDownloadDir: string; onKnowledgeBasePdfDownloadDirChange: (value: string) => void; onChooseKnowledgeBasePdfDownloadDir: () => void; libraryStorageMode: LibraryStorageMode;
  onLibraryStorageModeChange: (value: LibraryStorageMode) => void; libraryDirectory: string; onLibraryDirectoryChange: (value: string) => void; onChooseLibraryDirectory: () => void;
  maxConcurrentIndexJobs: number; onMaxConcurrentIndexJobsChange: (value: string) => void; activeRagProvider: RagProviderId; ragProviders: Record<RagProviderId, RagProviderSettings>;
  onRagProviderApiKeyChange: (provider: RagProviderId, apiKey: string) => void; onRagProviderBaseUrlChange: (provider: RagProviderId, baseUrl: string) => void;
  onRagProviderEmbeddingModelChange: (provider: RagProviderId, model: string) => void; onRagProviderRerankerModelChange: (provider: RagProviderId, model: string) => void;
  onRagProviderEmbeddingPathChange: (provider: RagProviderId, path: string) => void; onRagProviderRerankPathChange: (provider: RagProviderId, path: string) => void;
  retrievalCandidateCount: number; onRetrievalCandidateCountChange: (value: string) => void; retrievalTopK: number; onRetrievalTopKChange: (value: string) => void;
  onTestRagConnection: () => void; isLibraryLoading: boolean; libraryDocumentCount: number; libraryFileCount: number; libraryQueuedJobCount: number; libraryDocuments: LibraryDocumentSummary[];
  libraryDbFile: string; defaultManagedDirectory: string; ragCacheDir: string; pdfDownloadDir: string; pdfFileNameUseSelectionOrder: boolean; onPdfDownloadDirChange: (value: string) => void;
  onPdfFileNameUseSelectionOrderChange: (checked: boolean) => void; onChoosePdfDownloadDir: () => void; activeLlmProvider: LlmProviderId; onActiveLlmProviderChange: (provider: LlmProviderId) => void;
  llmProviders: Record<LlmProviderId, LlmProviderSettings>; onLlmProviderApiKeyChange: (provider: LlmProviderId, apiKey: string) => void; onLlmProviderModelChange: (provider: LlmProviderId, model: string) => void; onLlmProviderSelectedModelOption: (provider: LlmProviderId, optionValue: string) => void; onLlmProviderReasoningEffortChange: (provider: LlmProviderId, reasoningEffort: import('ls/workbench/services/llm/types').LlmReasoningEffort | undefined) => void; onLlmProviderModelEnabledChange: (provider: LlmProviderId, optionValue: string, enabled: boolean) => void; onLlmProviderUseMaxContextWindowChange: (provider: LlmProviderId, useMaxContextWindow: boolean) => void;
  activeTranslationProvider: TranslationProviderId; onActiveTranslationProviderChange: (provider: TranslationProviderId) => void; translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  onTranslationProviderApiKeyChange: (provider: TranslationProviderId, apiKey: string) => void; onTranslationProviderBaseUrlChange: (provider: TranslationProviderId, baseUrl: string) => void; onTranslationProviderModelChange: (provider: TranslationProviderId, model: string) => void; onTestLlmConnection: () => void; onTestTranslationConnection: () => void;
  onEditorDraftFontFamilyChange: (value: string) => void; onEditorDraftFontSizeChange: (value: string) => void; onEditorDraftLineHeightChange: (value: string) => void; onEditorDraftParagraphSpacingBeforeChange: (value: string) => void; onEditorDraftParagraphSpacingAfterChange: (value: string) => void; onEditorDraftColorChange: (value: string) => void; onResetEditorDraftStyle: () => void;
  onChooseConfigPath: () => void; onResetConfigPath: () => void; onResetKnowledgeBaseSettings: () => void; desktopRuntime: boolean; configPath: string; defaultConfigPath: string; isSettingsSaving: boolean; isTestingRagConnection: boolean; isTestingLlmConnection: boolean;
  isTestingTranslationConnection: boolean; onResetDownloadDir: () => void;
};

export type SettingsPartState = {
  ui: LocaleMessages; isSettingsLoading: boolean; locale: Locale; batchLimit: number; fetchStartDate: string; fetchEndDate: string; systemNotificationsEnabled: boolean; warningNotificationsEnabled: boolean; menuBarIconEnabled: boolean; completionNotificationsEnabled: boolean; useMica: boolean; statusbarVisible: boolean; browserTabKeepAliveLimit: number; theme: AppTheme;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  editorDraftFontFamilyOptions: readonly SettingsDropdownOption[];
  editorDraftFontSizeOptions: readonly SettingsDropdownOption[];
  knowledgeBaseEnabled: boolean; autoIndexDownloadedPdf: boolean; knowledgeBasePdfDownloadDir: string; libraryStorageMode: LibraryStorageMode; libraryDirectory: string; maxConcurrentIndexJobs: number; activeRagProvider: RagProviderId;
  ragProviders: Record<RagProviderId, RagProviderSettings>; retrievalCandidateCount: number; retrievalTopK: number; pdfDownloadDir: string; pdfFileNameUseSelectionOrder: boolean;
  activeLlmProvider: LlmProviderId; llmProviders: Record<LlmProviderId, LlmProviderSettings>; activeTranslationProvider: TranslationProviderId; translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  supportedSources: BatchSource[]; journalSourceOverrides: JournalSourceOverride[]; desktopRuntime: boolean; configPath: string; defaultConfigPath: string; isLibraryLoading: boolean; libraryDocumentCount: number; libraryFileCount: number; libraryQueuedJobCount: number; libraryDocuments: LibraryDocumentSummary[];
  libraryDbFile: string; defaultManagedDirectory: string; ragCacheDir: string; isSettingsSaving: boolean; isTestingRagConnection: boolean; isTestingLlmConnection: boolean; isTestingTranslationConnection: boolean;
};

export type SettingsPartActions = {
  onNavigateBack: () => void;
  onBatchLimitChange: (value: string) => void;
  onJournalSourceTitleChange: (url: string, journalTitle: string) => void;
  onFetchStartDateChange: (value: string) => void; onFetchEndDateChange: (value: string) => void; onSystemNotificationsEnabledChange: (checked: boolean) => void; onWarningNotificationsEnabledChange: (checked: boolean) => void; onMenuBarIconEnabledChange: (checked: boolean) => void; onCompletionNotificationsEnabledChange: (checked: boolean) => void; onUseMicaChange: (checked: boolean) => void; onStatusbarVisibleChange: (checked: boolean) => void; onBrowserTabKeepAliveLimitChange: (value: string) => void; onThemeChange: (value: AppTheme) => void; onKnowledgeBaseEnabledChange: (checked: boolean) => void; onAutoIndexDownloadedPdfChange: (checked: boolean) => void; onKnowledgeBasePdfDownloadDirChange: (value: string) => void; onChooseKnowledgeBasePdfDownloadDir: () => void;
  onLibraryStorageModeChange: (value: LibraryStorageMode) => void; onLibraryDirectoryChange: (value: string) => void; onChooseLibraryDirectory: () => void; onMaxConcurrentIndexJobsChange: (value: string) => void;
  onRagProviderApiKeyChange: (provider: RagProviderId, apiKey: string) => void; onRagProviderBaseUrlChange: (provider: RagProviderId, baseUrl: string) => void; onRagProviderEmbeddingModelChange: (provider: RagProviderId, model: string) => void;
  onRagProviderRerankerModelChange: (provider: RagProviderId, model: string) => void; onRagProviderEmbeddingPathChange: (provider: RagProviderId, path: string) => void; onRagProviderRerankPathChange: (provider: RagProviderId, path: string) => void;
  onRetrievalCandidateCountChange: (value: string) => void; onRetrievalTopKChange: (value: string) => void; onPdfDownloadDirChange: (value: string) => void; onPdfFileNameUseSelectionOrderChange: (checked: boolean) => void;
  onChoosePdfDownloadDir: () => void; onActiveLlmProviderChange: (provider: LlmProviderId) => void; onLlmProviderApiKeyChange: (provider: LlmProviderId, apiKey: string) => void; onLlmProviderModelChange: (provider: LlmProviderId, model: string) => void; onLlmProviderSelectedModelOption: (provider: LlmProviderId, optionValue: string) => void; onLlmProviderReasoningEffortChange: (provider: LlmProviderId, reasoningEffort: import('ls/workbench/services/llm/types').LlmReasoningEffort | undefined) => void; onLlmProviderModelEnabledChange: (provider: LlmProviderId, optionValue: string, enabled: boolean) => void; onLlmProviderUseMaxContextWindowChange: (provider: LlmProviderId, useMaxContextWindow: boolean) => void;
  onActiveTranslationProviderChange: (provider: TranslationProviderId) => void; onTranslationProviderApiKeyChange: (provider: TranslationProviderId, apiKey: string) => void; onTranslationProviderBaseUrlChange: (provider: TranslationProviderId, baseUrl: string) => void; onTranslationProviderModelChange: (provider: TranslationProviderId, model: string) => void; onTestRagConnection: () => void;
  onEditorDraftFontFamilyChange: (value: string) => void; onEditorDraftFontSizeChange: (value: string) => void; onEditorDraftLineHeightChange: (value: string) => void; onEditorDraftParagraphSpacingBeforeChange: (value: string) => void; onEditorDraftParagraphSpacingAfterChange: (value: string) => void; onEditorDraftColorChange: (value: string) => void; onResetEditorDraftStyle: () => void;
  onTestLlmConnection: () => void; onTestTranslationConnection: () => void; onChooseConfigPath: () => void; onResetConfigPath: () => void; onResetKnowledgeBaseSettings: () => void; onResetDownloadDir: () => void;
};
