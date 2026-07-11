import type { SettingsSectionId } from 'cs/workbench/contrib/preferences/common/settings';
import type { SettingsPartProps } from 'cs/workbench/contrib/preferences/browser/settingsTypes';

export function shouldUpdateSettingsSection(
  sectionId: SettingsSectionId,
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  switch (sectionId) {
    case 'locale':
      return shouldUpdateLocaleSection(previousProps, currentProps);
    case 'layout':
      return shouldUpdateLayoutSection(previousProps, currentProps);
    case 'browser':
      return shouldUpdateBrowserSection(previousProps, currentProps);
    case 'notifications':
      return shouldUpdateNotificationsSection(previousProps, currentProps);
    case 'appearance':
      return shouldUpdateAppearanceSection(previousProps, currentProps);
    case 'configPath':
      return shouldUpdateConfigPathSection(previousProps, currentProps);
    case 'textEditor':
      return shouldUpdateTextEditorSection(previousProps, currentProps);
    case 'llmModel':
      return shouldUpdateLlmModelSection(previousProps, currentProps);
    case 'llmApiKey':
      return shouldUpdateLlmApiKeySection(previousProps, currentProps);
    case 'translation':
      return shouldUpdateTranslationSection(previousProps, currentProps);
    case 'supportedSources':
      return shouldUpdateSupportedSourcesSection(previousProps, currentProps);
    case 'knowledgeBaseLibrary':
      return shouldUpdateKnowledgeBaseLibrarySection(previousProps, currentProps);
    case 'knowledgeBaseRag':
      return shouldUpdateKnowledgeBaseRagSection(previousProps, currentProps);
    case 'downloadDirectory':
      return shouldUpdateDownloadDirectorySection(previousProps, currentProps);
  }
}

function shouldUpdateLocaleSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.locale !== currentProps.locale ||
    previousProps.labels.settingsLanguage !== currentProps.labels.settingsLanguage ||
    previousProps.labels.languageChinese !== currentProps.labels.languageChinese ||
    previousProps.labels.languageEnglish !== currentProps.labels.languageEnglish ||
    previousProps.labels.settingsLanguageHint !== currentProps.labels.settingsLanguageHint
  );
}

function shouldUpdateSupportedSourcesSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.supportedSources !== currentProps.supportedSources ||
    previousProps.showSupportedSources !== currentProps.showSupportedSources ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsSupportedSources !== currentProps.labels.settingsSupportedSources ||
    previousProps.labels.settingsSupportedSourcesHint !== currentProps.labels.settingsSupportedSourcesHint ||
    previousProps.labels.settingsSupportedSourceUrl !== currentProps.labels.settingsSupportedSourceUrl ||
    previousProps.labels.settingsSupportedSourceJournalTitle !== currentProps.labels.settingsSupportedSourceJournalTitle ||
    previousProps.labels.settingsSupportedSourcesShow !== currentProps.labels.settingsSupportedSourcesShow ||
    previousProps.labels.settingsSupportedSourcesHide !== currentProps.labels.settingsSupportedSourcesHide
  );
}

function shouldUpdateLayoutSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.statusbarVisible !== currentProps.statusbarVisible ||
    previousProps.browserTabKeepAliveLimit !== currentProps.browserTabKeepAliveLimit ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsLayoutTitle !== currentProps.labels.settingsLayoutTitle ||
    previousProps.labels.settingsStatusbar !== currentProps.labels.settingsStatusbar ||
    previousProps.labels.settingsStatusbarHint !== currentProps.labels.settingsStatusbarHint ||
    previousProps.labels.settingsBrowserTabKeepAliveLimit !==
      currentProps.labels.settingsBrowserTabKeepAliveLimit ||
    previousProps.labels.settingsBrowserTabKeepAliveLimitHint !==
      currentProps.labels.settingsBrowserTabKeepAliveLimitHint
  );
}

function shouldUpdateBrowserSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.browserMaxHistoryEntries !== currentProps.browserMaxHistoryEntries ||
    previousProps.browserPageZoom !== currentProps.browserPageZoom ||
    previousProps.browserSearchEngine !== currentProps.browserSearchEngine ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsBrowserTitle !== currentProps.labels.settingsBrowserTitle ||
    previousProps.labels.settingsBrowserMaxHistoryEntries !== currentProps.labels.settingsBrowserMaxHistoryEntries ||
    previousProps.labels.settingsBrowserMaxHistoryEntriesHint !== currentProps.labels.settingsBrowserMaxHistoryEntriesHint ||
    previousProps.labels.settingsBrowserPageZoom !== currentProps.labels.settingsBrowserPageZoom ||
    previousProps.labels.settingsBrowserPageZoomHint !== currentProps.labels.settingsBrowserPageZoomHint ||
    previousProps.labels.settingsBrowserPageZoomMatchWindow !== currentProps.labels.settingsBrowserPageZoomMatchWindow ||
    previousProps.labels.settingsBrowserSearchEngine !== currentProps.labels.settingsBrowserSearchEngine ||
    previousProps.labels.settingsBrowserSearchEngineHint !== currentProps.labels.settingsBrowserSearchEngineHint ||
    previousProps.labels.settingsBrowserSearchEngineNone !== currentProps.labels.settingsBrowserSearchEngineNone ||
    previousProps.labels.settingsBrowserSearchEngineBing !== currentProps.labels.settingsBrowserSearchEngineBing ||
    previousProps.labels.settingsBrowserSearchEngineGoogle !== currentProps.labels.settingsBrowserSearchEngineGoogle ||
    previousProps.labels.settingsBrowserSearchEngineYahoo !== currentProps.labels.settingsBrowserSearchEngineYahoo ||
    previousProps.labels.settingsBrowserSearchEngineDuckDuckGo !== currentProps.labels.settingsBrowserSearchEngineDuckDuckGo
  );
}

function shouldUpdateNotificationsSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.systemNotificationsEnabled !== currentProps.systemNotificationsEnabled ||
    previousProps.warningNotificationsEnabled !== currentProps.warningNotificationsEnabled ||
    previousProps.menuBarIconEnabled !== currentProps.menuBarIconEnabled ||
    previousProps.completionNotificationsEnabled !== currentProps.completionNotificationsEnabled ||
    previousProps.desktopRuntime !== currentProps.desktopRuntime ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsNotificationsTitle !== currentProps.labels.settingsNotificationsTitle ||
    previousProps.labels.settingsNotificationsHint !== currentProps.labels.settingsNotificationsHint ||
    previousProps.labels.settingsSystemNotifications !== currentProps.labels.settingsSystemNotifications ||
    previousProps.labels.settingsSystemNotificationsHint !== currentProps.labels.settingsSystemNotificationsHint ||
    previousProps.labels.settingsWarningNotifications !== currentProps.labels.settingsWarningNotifications ||
    previousProps.labels.settingsWarningNotificationsHint !== currentProps.labels.settingsWarningNotificationsHint ||
    previousProps.labels.settingsMenuBarIcon !== currentProps.labels.settingsMenuBarIcon ||
    previousProps.labels.settingsMenuBarIconHint !== currentProps.labels.settingsMenuBarIconHint ||
    previousProps.labels.settingsCompletionNotifications !== currentProps.labels.settingsCompletionNotifications ||
    previousProps.labels.settingsCompletionNotificationsHint !== currentProps.labels.settingsCompletionNotificationsHint
  );
}

function shouldUpdateAppearanceSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.theme !== currentProps.theme ||
    previousProps.useMica !== currentProps.useMica ||
    previousProps.desktopRuntime !== currentProps.desktopRuntime ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsAppearanceTitle !== currentProps.labels.settingsAppearanceTitle ||
    previousProps.labels.settingsTheme !== currentProps.labels.settingsTheme ||
    previousProps.labels.settingsThemeHint !== currentProps.labels.settingsThemeHint ||
    previousProps.labels.settingsThemeLight !== currentProps.labels.settingsThemeLight ||
    previousProps.labels.settingsThemeDark !== currentProps.labels.settingsThemeDark ||
    previousProps.labels.settingsThemeSystem !== currentProps.labels.settingsThemeSystem ||
    previousProps.labels.settingsUseMica !== currentProps.labels.settingsUseMica ||
    previousProps.labels.settingsUseMicaHint !== currentProps.labels.settingsUseMicaHint
  );
}

function shouldUpdateTextEditorSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  if (!previousProps) {
    return true;
  }

  const previousDefaultBodyStyle = previousProps.editorDraftStyle.value.defaultBodyStyle;
  const currentDefaultBodyStyle = currentProps.editorDraftStyle.value.defaultBodyStyle;

  return (
    previousDefaultBodyStyle.fontFamilyValue !== currentDefaultBodyStyle.fontFamilyValue ||
    previousDefaultBodyStyle.fontSizeValue !== currentDefaultBodyStyle.fontSizeValue ||
    previousDefaultBodyStyle.lineHeight !== currentDefaultBodyStyle.lineHeight ||
    previousDefaultBodyStyle.paragraphSpacingBeforePt !== currentDefaultBodyStyle.paragraphSpacingBeforePt ||
    previousDefaultBodyStyle.paragraphSpacingAfterPt !== currentDefaultBodyStyle.paragraphSpacingAfterPt ||
    previousDefaultBodyStyle.color !== currentDefaultBodyStyle.color ||
    previousProps.editorDraftStyle.userValue !== currentProps.editorDraftStyle.userValue ||
    previousProps.editorDraftFontFamilyOptions !== currentProps.editorDraftFontFamilyOptions ||
    previousProps.editorDraftFontSizeOptions !== currentProps.editorDraftFontSizeOptions ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsTextEditorTitle !== currentProps.labels.settingsTextEditorTitle ||
    previousProps.labels.settingsTextEditorHint !== currentProps.labels.settingsTextEditorHint ||
    previousProps.labels.settingsTextEditorDefaultBodyStyle !== currentProps.labels.settingsTextEditorDefaultBodyStyle ||
    previousProps.labels.settingsTextEditorFontFamily !== currentProps.labels.settingsTextEditorFontFamily ||
    previousProps.labels.settingsTextEditorFontSize !== currentProps.labels.settingsTextEditorFontSize ||
    previousProps.labels.settingsTextEditorLineHeight !== currentProps.labels.settingsTextEditorLineHeight ||
    previousProps.labels.settingsTextEditorParagraphSpacingBefore !== currentProps.labels.settingsTextEditorParagraphSpacingBefore ||
    previousProps.labels.settingsTextEditorParagraphSpacingAfter !== currentProps.labels.settingsTextEditorParagraphSpacingAfter ||
    previousProps.labels.settingsTextEditorColor !== currentProps.labels.settingsTextEditorColor ||
    previousProps.labels.resetDefault !== currentProps.labels.resetDefault
  );
}

function shouldUpdateKnowledgeBaseLibrarySection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.knowledgeBaseEnabled !== currentProps.knowledgeBaseEnabled ||
    previousProps.autoIndexDownloadedPdf !== currentProps.autoIndexDownloadedPdf ||
    previousProps.knowledgeBasePdfDownloadDir !== currentProps.knowledgeBasePdfDownloadDir ||
    previousProps.libraryStorageMode !== currentProps.libraryStorageMode ||
    previousProps.libraryDirectory !== currentProps.libraryDirectory ||
    previousProps.defaultManagedDirectory !== currentProps.defaultManagedDirectory ||
    previousProps.maxConcurrentIndexJobs !== currentProps.maxConcurrentIndexJobs ||
    previousProps.desktopRuntime !== currentProps.desktopRuntime ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.isLibraryLoading !== currentProps.isLibraryLoading ||
    previousProps.libraryDocumentCount !== currentProps.libraryDocumentCount ||
    previousProps.libraryFileCount !== currentProps.libraryFileCount ||
    previousProps.libraryQueuedJobCount !== currentProps.libraryQueuedJobCount ||
    previousProps.libraryDocuments !== currentProps.libraryDocuments ||
    previousProps.libraryDbFile !== currentProps.libraryDbFile ||
    previousProps.ragCacheDir !== currentProps.ragCacheDir ||
    previousProps.labels !== currentProps.labels
  );
}

function shouldUpdateKnowledgeBaseRagSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.activeRagProvider !== currentProps.activeRagProvider ||
    previousProps.ragProviders !== currentProps.ragProviders ||
    previousProps.retrievalCandidateCount !== currentProps.retrievalCandidateCount ||
    previousProps.retrievalTopK !== currentProps.retrievalTopK ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.isTestingRagConnection !== currentProps.isTestingRagConnection ||
    previousProps.labels !== currentProps.labels
  );
}

function shouldUpdateDownloadDirectorySection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.pdfDownloadDir !== currentProps.pdfDownloadDir ||
    previousProps.pdfFileNameUseSelectionOrder !== currentProps.pdfFileNameUseSelectionOrder ||
    previousProps.desktopRuntime !== currentProps.desktopRuntime ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.defaultPdfDir !== currentProps.labels.defaultPdfDir ||
    previousProps.labels.change !== currentProps.labels.change ||
    previousProps.labels.open !== currentProps.labels.open ||
    previousProps.labels.downloadDirPlaceholder !== currentProps.labels.downloadDirPlaceholder ||
    previousProps.labels.chooseDirectory !== currentProps.labels.chooseDirectory ||
    previousProps.labels.pdfFileNameUseSelectionOrder !== currentProps.labels.pdfFileNameUseSelectionOrder ||
    previousProps.labels.pdfFileNameUseSelectionOrderHint !== currentProps.labels.pdfFileNameUseSelectionOrderHint
  );
}

function shouldUpdateLlmModelSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.activeLlmProvider !== currentProps.activeLlmProvider ||
    previousProps.llmProviders !== currentProps.llmProviders ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels !== currentProps.labels
  );
}

function shouldUpdateLlmApiKeySection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.activeLlmProvider !== currentProps.activeLlmProvider ||
    previousProps.llmProviders !== currentProps.llmProviders ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.isTestingLlmConnection !== currentProps.isTestingLlmConnection ||
    previousProps.labels !== currentProps.labels
  );
}

function shouldUpdateTranslationSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.activeTranslationProvider !== currentProps.activeTranslationProvider ||
    previousProps.translationProviders !== currentProps.translationProviders ||
    previousProps.llmProviders !== currentProps.llmProviders ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.isTestingTranslationConnection !== currentProps.isTestingTranslationConnection ||
    previousProps.isLoadingTranslationModels !== currentProps.isLoadingTranslationModels ||
    previousProps.labels !== currentProps.labels
  );
}

function shouldUpdateConfigPathSection(
  previousProps: SettingsPartProps | undefined,
  currentProps: SettingsPartProps,
) {
  return (
    !previousProps ||
    previousProps.configPath !== currentProps.configPath ||
    previousProps.defaultConfigPath !== currentProps.defaultConfigPath ||
    previousProps.desktopRuntime !== currentProps.desktopRuntime ||
    previousProps.isSettingsSaving !== currentProps.isSettingsSaving ||
    previousProps.labels.settingsConfigPath !== currentProps.labels.settingsConfigPath ||
    previousProps.labels.change !== currentProps.labels.change ||
    previousProps.labels.resetDefault !== currentProps.labels.resetDefault ||
    previousProps.labels.changeConfigLocation !== currentProps.labels.changeConfigLocation
  );
}
