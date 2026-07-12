import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type {
	AppStartupLayout,
	AppTheme,
  LibraryDocumentSummary,
  LibraryStorageMode,
  LlmProviderId,
  LlmProviderSettings,
  RagProviderId,
  RagProviderSettings,
  TranslationProviderId,
  TranslationProviderSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { EditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { SettingValue } from 'cs/workbench/services/settings/settingValue';

export type SettingsDropdownOption = {
  value: string;
  label: string;
  title?: string;
  isDisabled?: boolean;
};

export type SettingsPartProps = {
  labels: LocaleMessages; isSettingsLoading: boolean; locale: Locale; onLocaleChange: (value: string) => void;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  editorDraftFontFamilyOptions: readonly SettingsDropdownOption[];
  editorDraftFontSizeOptions: readonly SettingsDropdownOption[];
  supportedSources: readonly JournalDescriptor[]; showSupportedSources: boolean; onToggleSupportedSources: () => void;
  systemNotificationsEnabled: boolean; onSystemNotificationsEnabledChange: (checked: boolean) => void; warningNotificationsEnabled: boolean; onWarningNotificationsEnabledChange: (checked: boolean) => void; menuBarIconEnabled: boolean; onMenuBarIconEnabledChange: (checked: boolean) => void; completionNotificationsEnabled: boolean; onCompletionNotificationsEnabledChange: (checked: boolean) => void; useMica: boolean; onUseMicaChange: (checked: boolean) => void; statusbarVisible: boolean; onStatusbarVisibleChange: (checked: boolean) => void; startupLayout: AppStartupLayout; onStartupLayoutChange: (value: AppStartupLayout) => void; browserTabKeepAliveLimit: number; onBrowserTabKeepAliveLimitChange: (value: string) => void; browserMaxHistoryEntries: number; onBrowserMaxHistoryEntriesChange: (value: string) => void; browserPageZoom: string; onBrowserPageZoomChange: (value: string) => void; browserSearchEngine: string; onBrowserSearchEngineChange: (value: string) => void; theme: AppTheme; onThemeChange: (value: AppTheme) => void; knowledgeBaseEnabled: boolean;
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
  llmProviders: Record<LlmProviderId, LlmProviderSettings>; onLlmProviderApiKeyChange: (provider: LlmProviderId, apiKey: string) => void; onLlmProviderModelChange: (provider: LlmProviderId, model: string) => void; onLlmProviderSelectedModelOption: (provider: LlmProviderId, optionValue: string) => void; onLlmProviderReasoningEffortChange: (provider: LlmProviderId, reasoningEffort: import('cs/workbench/services/llm/types').LlmReasoningEffort | undefined) => void; onLlmProviderModelEnabledChange: (provider: LlmProviderId, optionValue: string, enabled: boolean) => void; onLlmProviderUseMaxContextWindowChange: (provider: LlmProviderId, useMaxContextWindow: boolean) => void;
  activeTranslationProvider: TranslationProviderId; onActiveTranslationProviderChange: (provider: TranslationProviderId) => void; translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  onTranslationProviderApiKeyChange: (provider: TranslationProviderId, apiKey: string) => void; onTranslationProviderBaseUrlChange: (provider: TranslationProviderId, baseUrl: string) => void; onTranslationProviderModelChange: (provider: TranslationProviderId, model: string) => void; onTestLlmConnection: () => void; onFetchTranslationModels: () => void; onTestTranslationConnection: () => void;
  onEditorDraftFontFamilyChange: (value: string) => void; onEditorDraftFontSizeChange: (value: string) => void; onEditorDraftLineHeightChange: (value: string) => void; onEditorDraftParagraphSpacingBeforeChange: (value: string) => void; onEditorDraftParagraphSpacingAfterChange: (value: string) => void; onEditorDraftColorChange: (value: string) => void; onResetEditorDraftStyle: () => void;
  onChooseConfigPath: () => void; onResetConfigPath: () => void; onResetKnowledgeBaseSettings: () => void; desktopRuntime: boolean; configPath: string; defaultConfigPath: string; isSettingsSaving: boolean; isTestingRagConnection: boolean; isTestingLlmConnection: boolean;
  isTestingTranslationConnection: boolean; isLoadingTranslationModels: boolean; onResetDownloadDir: () => void;
};

export type SettingsPartState = {
  ui: LocaleMessages; isSettingsLoading: boolean; locale: Locale; systemNotificationsEnabled: boolean; warningNotificationsEnabled: boolean; menuBarIconEnabled: boolean; completionNotificationsEnabled: boolean; useMica: boolean; statusbarVisible: boolean; startupLayout: AppStartupLayout; browserTabKeepAliveLimit: number; browserMaxHistoryEntries: number; browserPageZoom: string; browserSearchEngine: string; theme: AppTheme;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  editorDraftFontFamilyOptions: readonly SettingsDropdownOption[];
  editorDraftFontSizeOptions: readonly SettingsDropdownOption[];
  knowledgeBaseEnabled: boolean; autoIndexDownloadedPdf: boolean; knowledgeBasePdfDownloadDir: string; libraryStorageMode: LibraryStorageMode; libraryDirectory: string; maxConcurrentIndexJobs: number; activeRagProvider: RagProviderId;
  ragProviders: Record<RagProviderId, RagProviderSettings>; retrievalCandidateCount: number; retrievalTopK: number; pdfDownloadDir: string; pdfFileNameUseSelectionOrder: boolean;
  activeLlmProvider: LlmProviderId; llmProviders: Record<LlmProviderId, LlmProviderSettings>; activeTranslationProvider: TranslationProviderId; translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  supportedSources: readonly JournalDescriptor[]; desktopRuntime: boolean; configPath: string; defaultConfigPath: string; isLibraryLoading: boolean; libraryDocumentCount: number; libraryFileCount: number; libraryQueuedJobCount: number; libraryDocuments: LibraryDocumentSummary[];
  libraryDbFile: string; defaultManagedDirectory: string; ragCacheDir: string; isSettingsSaving: boolean; isTestingRagConnection: boolean; isTestingLlmConnection: boolean; isTestingTranslationConnection: boolean; isLoadingTranslationModels: boolean;
};

export type SettingsPartActions = {
  onLocaleChange: (value: string) => void; onSystemNotificationsEnabledChange: (checked: boolean) => void; onWarningNotificationsEnabledChange: (checked: boolean) => void; onMenuBarIconEnabledChange: (checked: boolean) => void; onCompletionNotificationsEnabledChange: (checked: boolean) => void; onUseMicaChange: (checked: boolean) => void; onStatusbarVisibleChange: (checked: boolean) => void; onStartupLayoutChange: (value: AppStartupLayout) => void; onBrowserTabKeepAliveLimitChange: (value: string) => void; onBrowserMaxHistoryEntriesChange: (value: string) => void; onBrowserPageZoomChange: (value: string) => void; onBrowserSearchEngineChange: (value: string) => void; onThemeChange: (value: AppTheme) => void; onKnowledgeBaseEnabledChange: (checked: boolean) => void; onAutoIndexDownloadedPdfChange: (checked: boolean) => void; onKnowledgeBasePdfDownloadDirChange: (value: string) => void; onChooseKnowledgeBasePdfDownloadDir: () => void;
  onLibraryStorageModeChange: (value: LibraryStorageMode) => void; onLibraryDirectoryChange: (value: string) => void; onChooseLibraryDirectory: () => void; onMaxConcurrentIndexJobsChange: (value: string) => void;
  onRagProviderApiKeyChange: (provider: RagProviderId, apiKey: string) => void; onRagProviderBaseUrlChange: (provider: RagProviderId, baseUrl: string) => void; onRagProviderEmbeddingModelChange: (provider: RagProviderId, model: string) => void;
  onRagProviderRerankerModelChange: (provider: RagProviderId, model: string) => void; onRagProviderEmbeddingPathChange: (provider: RagProviderId, path: string) => void; onRagProviderRerankPathChange: (provider: RagProviderId, path: string) => void;
  onRetrievalCandidateCountChange: (value: string) => void; onRetrievalTopKChange: (value: string) => void; onPdfDownloadDirChange: (value: string) => void; onPdfFileNameUseSelectionOrderChange: (checked: boolean) => void;
  onChoosePdfDownloadDir: () => void; onActiveLlmProviderChange: (provider: LlmProviderId) => void; onLlmProviderApiKeyChange: (provider: LlmProviderId, apiKey: string) => void; onLlmProviderModelChange: (provider: LlmProviderId, model: string) => void; onLlmProviderSelectedModelOption: (provider: LlmProviderId, optionValue: string) => void; onLlmProviderReasoningEffortChange: (provider: LlmProviderId, reasoningEffort: import('cs/workbench/services/llm/types').LlmReasoningEffort | undefined) => void; onLlmProviderModelEnabledChange: (provider: LlmProviderId, optionValue: string, enabled: boolean) => void; onLlmProviderUseMaxContextWindowChange: (provider: LlmProviderId, useMaxContextWindow: boolean) => void;
  onActiveTranslationProviderChange: (provider: TranslationProviderId) => void; onTranslationProviderApiKeyChange: (provider: TranslationProviderId, apiKey: string) => void; onTranslationProviderBaseUrlChange: (provider: TranslationProviderId, baseUrl: string) => void; onTranslationProviderModelChange: (provider: TranslationProviderId, model: string) => void; onTestRagConnection: () => void;
  onEditorDraftFontFamilyChange: (value: string) => void; onEditorDraftFontSizeChange: (value: string) => void; onEditorDraftLineHeightChange: (value: string) => void; onEditorDraftParagraphSpacingBeforeChange: (value: string) => void; onEditorDraftParagraphSpacingAfterChange: (value: string) => void; onEditorDraftColorChange: (value: string) => void; onResetEditorDraftStyle: () => void;
  onTestLlmConnection: () => void; onFetchTranslationModels: () => void; onTestTranslationConnection: () => void; onChooseConfigPath: () => void; onResetConfigPath: () => void; onResetKnowledgeBaseSettings: () => void; onResetDownloadDir: () => void;
};
