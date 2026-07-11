/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SettingsSectionId =
	| 'locale'
	| 'layout'
	| 'browser'
	| 'notifications'
	| 'appearance'
	| 'configPath'
	| 'textEditor'
	| 'llmModel'
	| 'llmApiKey'
	| 'translation'
	| 'supportedSources'
	| 'knowledgeBaseLibrary'
	| 'knowledgeBaseRag'
	| 'downloadDirectory';

export type SettingsPageId =
	| 'general'
	| 'browser'
	| 'appearance'
	| 'textEditor'
	| 'model'
	| 'knowledgeBase'
	| 'literature';

export const ID_SETTING_TAG = 'id:';

export const SettingsId = {
	Locale: 'locale',
	StartupLayout: 'startupLayout',
	StatusbarVisible: 'statusbarVisible',
	BrowserTabKeepAliveLimit: 'browserTabKeepAliveLimit',
	BrowserMaxHistoryEntries: 'browserMaxHistoryEntries',
	BrowserPageZoom: 'browserPageZoom',
	BrowserSearchEngine: 'browserSearchEngine',
	SystemNotificationsEnabled: 'systemNotificationsEnabled',
	WarningNotificationsEnabled: 'warningNotificationsEnabled',
	MenuBarIconEnabled: 'menuBarIconEnabled',
	CompletionNotificationsEnabled: 'completionNotificationsEnabled',
	Theme: 'theme',
	UseMica: 'useMica',
	UserSettingsPathOverride: 'userSettingsPathOverride',
	EditorDraftFontFamily: 'editorDraftStyle.defaultBodyStyle.fontFamily',
	EditorDraftFontSize: 'editorDraftStyle.defaultBodyStyle.fontSize',
	EditorDraftLineHeight: 'editorDraftStyle.defaultBodyStyle.lineHeight',
	EditorDraftParagraphSpacingBefore: 'editorDraftStyle.defaultBodyStyle.paragraphSpacingBefore',
	EditorDraftParagraphSpacingAfter: 'editorDraftStyle.defaultBodyStyle.paragraphSpacingAfter',
	EditorDraftColor: 'editorDraftStyle.defaultBodyStyle.color',
	LlmActiveProvider: 'llm.activeProvider',
	LlmProviderModel: 'llm.providers.model',
	LlmProviderEnabledModels: 'llm.providers.enabledModelOptions',
	LlmProviderUseMaxContextWindow: 'llm.providers.useMaxContextWindow',
	LlmProviderApiKey: 'llm.providers.apiKey',
	TranslationActiveProvider: 'translation.activeProvider',
	TranslationProviderBaseUrl: 'translation.providers.baseUrl',
	TranslationProviderApiKey: 'translation.providers.apiKey',
	TranslationProviderModel: 'translation.providers.model',
	FetchStartDate: 'fetch.startDate',
	FetchEndDate: 'fetch.endDate',
	DefaultDownloadDir: 'defaultDownloadDir',
	PdfFileNameUseSelectionOrder: 'pdfFileNameUseSelectionOrder',
	KnowledgeBaseEnabled: 'knowledgeBase.enabled',
	KnowledgeBaseAutoIndexDownloadedPdf: 'knowledgeBase.autoIndexDownloadedPdf',
	KnowledgeBaseDownloadDirectory: 'knowledgeBase.downloadDirectory',
	KnowledgeBaseLibraryStorageMode: 'knowledgeBase.libraryStorageMode',
	KnowledgeBaseLibraryDirectory: 'knowledgeBase.libraryDirectory',
	KnowledgeBaseMaxConcurrentIndexJobs: 'knowledgeBase.maxConcurrentIndexJobs',
	RagActiveProvider: 'rag.activeProvider',
	RagProviderApiKey: 'rag.providers.apiKey',
	RagProviderBaseUrl: 'rag.providers.baseUrl',
	RagProviderEmbeddingModel: 'rag.providers.embeddingModel',
	RagProviderRerankerModel: 'rag.providers.rerankerModel',
	RagProviderEmbeddingPath: 'rag.providers.embeddingPath',
	RagProviderRerankPath: 'rag.providers.rerankPath',
	RagRetrievalCandidateCount: 'rag.retrievalCandidateCount',
	RagRetrievalTopK: 'rag.retrievalTopK',
} as const;

export type SettingsId = typeof SettingsId[keyof typeof SettingsId];

export type SettingsSearchId =
	| SettingsPageId
	| SettingsSectionId
	| SettingsId;
