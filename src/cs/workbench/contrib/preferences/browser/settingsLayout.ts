import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import {
	SettingsId,
	type SettingsPageId,
	type SettingsSearchId,
	type SettingsSectionId,
} from 'cs/workbench/contrib/preferences/common/settings';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

type SettingsPageDefinition = {
  id: SettingsPageId;
  label: (labels: SettingsPartLabels) => string;
  icon?: LxIconName;
  sections: SettingsSectionId[];
};

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  settingIds: readonly SettingsSearchId[];
  searchLabels: (labels: SettingsPartLabels) => readonly string[];
};

export const settingsPageLayout: readonly SettingsPageDefinition[] = [
  {
		id: 'general',
    label: (labels) => labels.settingsNavigationGeneral,
    icon: 'gear',
		sections: ['locale', 'layout', 'notifications', 'configPath'],
	},
	{
		id: 'browser',
		label: labels => labels.settingsNavigationBrowser,
		icon: 'browser',
		sections: ['browser'],
	},
  {
    id: 'appearance',
    label: (labels) => labels.settingsNavigationAppearance,
    icon: 'appearance',
    sections: ['appearance'],
  },
  {
    id: 'textEditor',
    label: (labels) => labels.settingsNavigationTextEditor,
    icon: 'write',
    sections: ['textEditor'],
  },
  {
    id: 'model',
    label: (labels) => labels.settingsLlmTitle,
    icon: 'model',
    sections: ['llmModel', 'llmApiKey'],
  },
  {
    id: 'knowledgeBase',
    label: (labels) => labels.settingsNavigationKnowledgeBase,
    icon: 'database-1',
    sections: ['knowledgeBaseLibrary', 'knowledgeBaseRag'],
  },
  {
    id: 'literature',
    label: (labels) => labels.settingsNavigationLiterature,
    icon: 'book',
    sections: ['supportedSources', 'downloadDirectory', 'translation'],
  },
] as const;

export const settingsSectionLayout: Readonly<Record<SettingsSectionId, SettingsSectionDefinition>> = {
  locale: {
    id: 'locale',
    settingIds: [SettingsId.Locale],
    searchLabels: labels => [
      labels.settingsLanguage,
      labels.settingsLanguageHint,
      labels.languageChinese,
      labels.languageEnglish,
    ],
  },
	layout: {
    id: 'layout',
    settingIds: [
      SettingsId.StartupLayout,
      SettingsId.StatusbarVisible,
      SettingsId.BrowserTabKeepAliveLimit,
    ],
    searchLabels: labels => [
      labels.settingsLayoutTitle,
      labels.settingsStartupLayout,
      labels.settingsStartupLayoutHint,
      labels.settingsStartupLayoutAgent,
      labels.settingsStartupLayoutFlow,
      labels.settingsStatusbar,
      labels.settingsStatusbarHint,
      labels.settingsBrowserTabKeepAliveLimit,
      labels.settingsBrowserTabKeepAliveLimitHint,
    ],
	},
	browser: {
		id: 'browser',
		settingIds: [
			SettingsId.BrowserMaxHistoryEntries,
			SettingsId.BrowserPageZoom,
			SettingsId.BrowserSearchEngine,
		],
		searchLabels: labels => [
			labels.settingsBrowserTitle,
			labels.settingsBrowserMaxHistoryEntries,
			labels.settingsBrowserMaxHistoryEntriesHint,
			labels.settingsBrowserPageZoom,
			labels.settingsBrowserPageZoomHint,
			labels.settingsBrowserPageZoomMatchWindow,
			labels.settingsBrowserSearchEngine,
			labels.settingsBrowserSearchEngineHint,
			labels.settingsBrowserSearchEngineNone,
			labels.settingsBrowserSearchEngineBing,
			labels.settingsBrowserSearchEngineGoogle,
			labels.settingsBrowserSearchEngineYahoo,
			labels.settingsBrowserSearchEngineDuckDuckGo,
		],
	},
  notifications: {
    id: 'notifications',
    settingIds: [
      SettingsId.SystemNotificationsEnabled,
      SettingsId.WarningNotificationsEnabled,
      SettingsId.MenuBarIconEnabled,
      SettingsId.CompletionNotificationsEnabled,
    ],
    searchLabels: labels => [
      labels.settingsNotificationsTitle,
      labels.settingsNotificationsHint,
      labels.settingsSystemNotifications,
      labels.settingsSystemNotificationsHint,
      labels.settingsWarningNotifications,
      labels.settingsWarningNotificationsHint,
      labels.settingsMenuBarIcon,
      labels.settingsMenuBarIconHint,
      labels.settingsCompletionNotifications,
      labels.settingsCompletionNotificationsHint,
    ],
  },
  appearance: {
    id: 'appearance',
    settingIds: [
      SettingsId.Theme,
      SettingsId.UseMica,
    ],
    searchLabels: labels => [
      labels.settingsAppearanceTitle,
      labels.settingsTheme,
      labels.settingsThemeHint,
      labels.settingsThemeLight,
      labels.settingsThemeDark,
      labels.settingsThemeSystem,
      labels.settingsUseMica,
      labels.settingsUseMicaHint,
    ],
  },
  configPath: {
    id: 'configPath',
    settingIds: [SettingsId.UserSettingsPathOverride],
    searchLabels: labels => [
      labels.settingsConfigPath,
      labels.settingsHintPath,
      labels.changeConfigLocation,
    ],
  },
  textEditor: {
    id: 'textEditor',
    settingIds: [
      SettingsId.EditorDraftFontFamily,
      SettingsId.EditorDraftFontSize,
      SettingsId.EditorDraftLineHeight,
      SettingsId.EditorDraftParagraphSpacingBefore,
      SettingsId.EditorDraftParagraphSpacingAfter,
      SettingsId.EditorDraftColor,
    ],
    searchLabels: labels => [
      labels.settingsTextEditorTitle,
      labels.settingsTextEditorHint,
      labels.settingsTextEditorDefaultBodyStyle,
      labels.settingsTextEditorFontFamily,
      labels.settingsTextEditorFontSize,
      labels.settingsTextEditorLineHeight,
      labels.settingsTextEditorParagraphSpacingBefore,
      labels.settingsTextEditorParagraphSpacingAfter,
      labels.settingsTextEditorColor,
    ],
  },
  llmModel: {
    id: 'llmModel',
    settingIds: [
      SettingsId.LlmActiveProvider,
      SettingsId.LlmProviderModel,
      SettingsId.LlmProviderEnabledModels,
      SettingsId.LlmProviderUseMaxContextWindow,
    ],
    searchLabels: labels => [
      labels.settingsLlmTitle,
      labels.settingsLlmProvider,
      labels.settingsLlmProviderHint,
      labels.settingsLlmProviderGlm,
      labels.settingsLlmProviderKimi,
      labels.settingsLlmProviderDeepSeek,
      labels.settingsLlmProviderGemini,
      labels.settingsLlmModel,
      labels.settingsLlmMaxContext,
      labels.settingsLlmMaxContextHint,
    ],
  },
  llmApiKey: {
    id: 'llmApiKey',
    settingIds: [SettingsId.LlmProviderApiKey],
    searchLabels: labels => [
      labels.settingsLlmTitle,
      labels.settingsLlmApiKey,
      labels.settingsLlmApiKeyPlaceholder,
      labels.settingsApiKeySet,
      labels.settingsApiKeyUpdate,
      labels.settingsApiKeyClear,
    ],
  },
  translation: {
    id: 'translation',
    settingIds: [
      SettingsId.TranslationActiveProvider,
      SettingsId.TranslationProviderBaseUrl,
      SettingsId.TranslationProviderApiKey,
      SettingsId.TranslationProviderModel,
    ],
    searchLabels: labels => [
      labels.settingsTranslationTitle,
      labels.settingsTranslationProvider,
      labels.settingsTranslationProviderHint,
      labels.settingsTranslationProviderDeepL,
      labels.settingsTranslationProviderGlm,
      labels.settingsTranslationProviderOpenAICompatible,
      labels.settingsTranslationProviderCustom,
      labels.settingsTranslationProviderOpenAICompatibleHint,
      labels.settingsTranslationBaseUrl,
      labels.settingsTranslationApiKey,
    ],
  },
  supportedSources: {
    id: 'supportedSources',
    settingIds: [],
    searchLabels: labels => [
      labels.settingsSupportedSources,
      labels.settingsSupportedSourcesHint,
      labels.settingsSupportedSourceUrl,
      labels.settingsSupportedSourceJournalTitle,
    ],
  },
  knowledgeBaseLibrary: {
    id: 'knowledgeBaseLibrary',
    settingIds: [
      SettingsId.KnowledgeBaseEnabled,
      SettingsId.KnowledgeBaseAutoIndexDownloadedPdf,
      SettingsId.KnowledgeBaseDownloadDirectory,
      SettingsId.KnowledgeBaseLibraryStorageMode,
      SettingsId.KnowledgeBaseLibraryDirectory,
      SettingsId.KnowledgeBaseMaxConcurrentIndexJobs,
    ],
    searchLabels: labels => [
      labels.settingsKnowledgeBaseTitle,
      labels.settingsKnowledgeBaseHint,
      labels.settingsKnowledgeBaseMode,
      labels.settingsKnowledgeBaseModeHint,
      labels.settingsKnowledgeBaseModeDisabledHint,
      labels.settingsKnowledgeBaseAutoIndex,
      labels.settingsKnowledgeBaseAutoIndexHint,
      labels.settingsKnowledgeBasePdfDownloadDir,
      labels.settingsKnowledgeBasePdfDownloadDirHint,
      labels.settingsLibraryTitle,
      labels.settingsLibraryStorageMode,
      labels.settingsLibraryStorageModeLinkedOriginal,
      labels.settingsLibraryStorageModeManagedCopy,
      labels.settingsLibraryDirectory,
      labels.settingsLibraryDirectoryHint,
      labels.settingsLibraryDbFile,
      labels.settingsLibraryFilesDir,
      labels.settingsLibraryCacheDir,
      labels.settingsLibraryMaxConcurrentJobs,
      labels.settingsLibraryMaxConcurrentJobsHint,
    ],
  },
  knowledgeBaseRag: {
    id: 'knowledgeBaseRag',
    settingIds: [
      SettingsId.RagActiveProvider,
      SettingsId.RagProviderApiKey,
      SettingsId.RagProviderBaseUrl,
      SettingsId.RagProviderEmbeddingModel,
      SettingsId.RagProviderRerankerModel,
      SettingsId.RagProviderEmbeddingPath,
      SettingsId.RagProviderRerankPath,
      SettingsId.RagRetrievalCandidateCount,
      SettingsId.RagRetrievalTopK,
    ],
    searchLabels: labels => [
      labels.settingsRagTitle,
      labels.settingsRagHint,
      labels.settingsRagProvider,
      labels.settingsRagProviderHint,
      labels.settingsRagApiKey,
      labels.settingsRagBaseUrl,
      labels.settingsRagEmbeddingModel,
      labels.settingsRagRerankerModel,
      labels.settingsRagEmbeddingPath,
      labels.settingsRagRerankPath,
      labels.settingsRagCandidateCount,
      labels.settingsRagTopK,
    ],
  },
  downloadDirectory: {
    id: 'downloadDirectory',
    settingIds: [
      SettingsId.DefaultDownloadDir,
      SettingsId.PdfFileNameUseSelectionOrder,
    ],
    searchLabels: labels => [
      labels.defaultPdfDir,
      labels.downloadDirPlaceholder,
      labels.pdfFileNameUseSelectionOrder,
      labels.pdfFileNameUseSelectionOrderHint,
    ],
  },
};

export type SettingsSectionMap = Record<SettingsSectionId, HTMLElement>;
export type SettingsNavigationItem = {
  id: SettingsPageId;
  label: string;
  icon?: LxIconName;
};

export function createSettingsSectionMap(factory: () => HTMLElement): SettingsSectionMap {
  const sectionIds = new Set<SettingsSectionId>();
  for (const page of settingsPageLayout) {
    for (const sectionId of page.sections) {
      sectionIds.add(sectionId);
    }
  }
  const entries = Array.from(sectionIds).map((id) => [id, factory()] as const);
  return Object.fromEntries(entries) as SettingsSectionMap;
}

export function getSettingsPageNavigationItems(
  labels: SettingsPartLabels,
): SettingsNavigationItem[] {
  return settingsPageLayout.map((page) => ({
    id: page.id,
    label: page.label(labels).trim(),
    icon: page.icon,
  }));
}
