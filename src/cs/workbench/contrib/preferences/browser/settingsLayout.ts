import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

export type SettingsSectionId =
  | 'locale'
  | 'layout'
  | 'notifications'
  | 'appearance'
  | 'configPath'
  | 'textEditor'
  | 'llm'
  | 'translation'
  | 'batchOptions'
  | 'supportedSources'
  | 'knowledgeBase'
  | 'downloadDirectory';

export type SettingsPageId =
  | 'general'
  | 'appearance'
  | 'textEditor'
  | 'model'
  | 'knowledgeBase'
  | 'literature';

type SettingsPageDefinition = {
  id: SettingsPageId;
  label: (labels: SettingsPartLabels) => string;
  icon?: LxIconName;
  sections: SettingsSectionId[];
};

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
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
    sections: ['llm'],
  },
  {
    id: 'knowledgeBase',
    label: (labels) => labels.settingsNavigationKnowledgeBase,
    icon: 'database-1',
    sections: ['knowledgeBase'],
  },
  {
    id: 'literature',
    label: (labels) => labels.settingsNavigationLiterature,
    icon: 'book',
    sections: ['batchOptions', 'supportedSources', 'downloadDirectory', 'translation'],
  },
] as const;

export const settingsSectionLayout: Readonly<Record<SettingsSectionId, SettingsSectionDefinition>> = {
  locale: {
    id: 'locale',
    searchLabels: labels => [
      labels.settingsLanguage,
      labels.settingsLanguageHint,
      labels.languageChinese,
      labels.languageEnglish,
    ],
  },
  layout: {
    id: 'layout',
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
  notifications: {
    id: 'notifications',
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
    searchLabels: labels => [
      labels.settingsConfigPath,
      labels.settingsHintPath,
      labels.changeConfigLocation,
    ],
  },
  textEditor: {
    id: 'textEditor',
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
  llm: {
    id: 'llm',
    searchLabels: labels => [
      labels.settingsLlmTitle,
      labels.settingsLlmProvider,
      labels.settingsLlmProviderHint,
      labels.settingsLlmProviderGlm,
      labels.settingsLlmProviderKimi,
      labels.settingsLlmProviderDeepSeek,
      labels.settingsLlmProviderGemini,
      labels.settingsLlmApiKey,
      labels.settingsLlmModel,
      labels.settingsLlmMaxContext,
      labels.settingsLlmMaxContextHint,
    ],
  },
  translation: {
    id: 'translation',
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
  batchOptions: {
    id: 'batchOptions',
    searchLabels: labels => [
      labels.settingsBatchOptions,
      labels.settingsBatchHint,
      labels.batchCount,
      labels.startDate,
      labels.endDate,
    ],
  },
  supportedSources: {
    id: 'supportedSources',
    searchLabels: labels => [
      labels.settingsSupportedSources,
      labels.settingsSupportedSourcesHint,
      labels.settingsSupportedSourceUrl,
      labels.settingsSupportedSourceJournalTitle,
    ],
  },
  knowledgeBase: {
    id: 'knowledgeBase',
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
