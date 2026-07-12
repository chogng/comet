/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import {
	IEditorDraftStyleService,
	type IEditorDraftStyleService as EditorDraftStyleService,
} from 'cs/editor/browser/text/editorDraftStyleService';
import { IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { INativeHostService } from 'cs/platform/native/common/native';
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
import {
	ISettingsController,
	type SettingsController,
} from 'cs/workbench/contrib/preferences/browser/settingsController';
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
import { SettingsTree, type SettingsSectionRenderers } from 'cs/workbench/contrib/preferences/browser/settingsTree';
import { SettingsTreeModel } from 'cs/workbench/contrib/preferences/browser/settingsTreeModel';
import type { SettingsViewState } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import {
	buildSettingsHint as buildHint,
	createSettingsElement as el,
	setSettingsFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import { TOCTree, TOCTreeModel } from 'cs/workbench/contrib/preferences/browser/tocTree';
import {
	TranslationSettingsSection,
	type TranslationSettingsSectionProps,
} from 'cs/workbench/contrib/preferences/browser/translationWidget';
import type { SettingsPageId } from 'cs/workbench/contrib/preferences/common/settings';
import { IFetchService, type JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import { ILibraryModel, type LibraryModel } from 'cs/workbench/services/knowledgeBase/libraryModel';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISettingsModel, type SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import 'cs/workbench/contrib/preferences/browser/media/settingsEditor.css';
import 'cs/workbench/contrib/preferences/browser/media/settingsWidgets.css';

type FocusSnapshot = {
	key: string;
	selectionStart: number | null;
	selectionEnd: number | null;
} | null;

export class SettingsPartView {
	private readonly disposables = new DisposableStore();
	private readonly supportedSources: readonly JournalDescriptor[];
	private state: SettingsViewState;
	private readonly element = el('div', 'comet-settings-body');
	private readonly container = el('div', 'comet-settings-page');
	private readonly navigation = el('aside', 'comet-settings-navigation');
	private readonly search = el('div', 'comet-settings-navigation-search');
	private readonly searchInput = setSettingsFocusKey(
		el('input', 'comet-settings-navigation-search-input'),
		'settings.search',
	);
	private readonly content = el('div', 'comet-settings-content-body');
	private readonly contentScrollable = this.disposables.add(new DomScrollableElement(this.content, {
		className: 'comet-settings-content',
		vertical: ScrollbarVisibility.Auto,
		horizontal: ScrollbarVisibility.Hidden,
		useShadows: false,
	}));
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
		@ISettingsModel private readonly settingsModel: SettingsModel,
		@ISettingsController private readonly settingsController: SettingsController,
		@ILibraryModel private readonly libraryModel: LibraryModel,
		@IFetchService private readonly fetchService: IFetchService,
		@IEditorDraftStyleService private readonly editorDraftStyleService: EditorDraftStyleService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		this.supportedSources = this.fetchService.getJournals();
		this.state = this.createState();
		this.settingsTreeModel = new SettingsTreeModel(this.state.labels, this.searchQuery);
		this.tocTreeModel = new TOCTreeModel(this.state.labels, this.settingsTreeModel);
		this.settingsTree = new SettingsTree(this.settingsTreeModel, {
			contentElement: this.content,
			scrollableElement: this.contentScrollable,
			pageTitleElement: this.pageTitle,
			loadingHintElement: this.loadingHint,
			noResultsElement: this.noResultsHint,
			sectionRenderers: this.createSectionRenderers(),
			settingsController: this.settingsController,
		});
		this.tocTree = new TOCTree(this.tocTreeModel, {
			title: this.state.labels.settingsTitle,
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
		this.element.append(this.navigation, this.container);
		this.updateView(undefined, true);
		this.registerStateSubscriptions();
	}

	getElement() {
		return this.element;
	}

	dispose() {
		this.disposables.dispose();
		this.tocTree.dispose();
		this.settingsTree.dispose();
		this.element.replaceChildren();
		this.container.replaceChildren();
		this.navigation.replaceChildren();
	}

	private registerStateSubscriptions() {
		this.disposables.add(this.settingsModel.subscribe(this.handleStateChange));
		this.disposables.add(this.libraryModel.subscribe(this.handleStateChange));
		this.disposables.add(this.editorDraftStyleService.subscribe(this.handleStateChange));
		this.disposables.add(this.localeService.subscribe(this.handleStateChange));
	}

	private createState(): SettingsViewState {
		const settingsSnapshot = this.settingsModel.getSnapshot();
		const editorDraftStyleSnapshot = this.editorDraftStyleService.getSnapshot();
		const { librarySnapshot, isLibraryLoading } = this.libraryModel.getSnapshot();
		const locale = this.localeService.getLocale();
		return {
			...settingsSnapshot,
			labels: this.languageService.getLocaleMessages(locale),
			locale,
			supportedSources: this.supportedSources,
			showSupportedSources: this.showSupportedSources,
			editorDraftStyle: {
				defaultValue: settingsSnapshot.editorDraftStyle.defaultValue,
				userValue: settingsSnapshot.editorDraftStyle.userValue,
				value: editorDraftStyleSnapshot,
			},
			editorDraftFontFamilyOptions: editorDraftStyleSnapshot.fontFamilyPresets,
			editorDraftFontSizeOptions: editorDraftStyleSnapshot.fontSizePresets,
			desktopRuntime: this.nativeHostService.canInvoke(),
			isLibraryLoading,
			libraryDocumentCount: librarySnapshot.totalCount,
			libraryFileCount: librarySnapshot.fileCount,
			libraryQueuedJobCount: librarySnapshot.queuedJobCount,
			libraryDocuments: librarySnapshot.items,
			libraryDbFile: librarySnapshot.libraryDbFile,
			defaultManagedDirectory: librarySnapshot.defaultManagedDirectory,
			ragCacheDir: librarySnapshot.ragCacheDir,
		};
	}

	private readonly handleStateChange = () => {
		const previousState = this.state;
		this.state = this.createState();
		this.updateView(previousState);
	};

	private containsManagedElement(node: Node) {
		return this.element.contains(node);
	}

	private queryManagedFocusTarget(key: string) {
		return this.element.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
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
			labels: this.state.labels,
			contextViewProvider: this.contextViewService,
			knowledgeBaseEnabled: this.state.knowledgeBaseEnabled,
			autoIndexDownloadedPdf: this.state.autoIndexDownloadedPdf,
			knowledgeBasePdfDownloadDir: this.state.knowledgeBasePdfDownloadDir,
			libraryStorageMode: this.state.libraryStorageMode,
			libraryDirectory: this.state.libraryDirectory,
			defaultManagedDirectory: this.state.defaultManagedDirectory,
			maxConcurrentIndexJobs: this.state.maxConcurrentIndexJobs,
			desktopRuntime: this.state.desktopRuntime,
			isSettingsSaving: this.state.isSettingsSaving,
			isLibraryLoading: this.state.isLibraryLoading,
			libraryDocumentCount: this.state.libraryDocumentCount,
			libraryFileCount: this.state.libraryFileCount,
			libraryQueuedJobCount: this.state.libraryQueuedJobCount,
			libraryDocuments: this.state.libraryDocuments,
			libraryDbFile: this.state.libraryDbFile,
			ragCacheDir: this.state.ragCacheDir,
			onKnowledgeBaseEnabledChange: this.settingsController.setKnowledgeBaseEnabled,
			onAutoIndexDownloadedPdfChange: this.settingsController.setAutoIndexDownloadedPdf,
			onKnowledgeBasePdfDownloadDirChange: this.settingsController.setKnowledgeBasePdfDownloadDir,
			onChooseKnowledgeBasePdfDownloadDir: () => void this.settingsController.handleChooseKnowledgeBasePdfDownloadDir(),
			onLibraryStorageModeChange: this.settingsController.setLibraryStorageMode,
			onLibraryDirectoryChange: this.settingsController.setLibraryDirectory,
			onChooseLibraryDirectory: () => void this.settingsController.handleChooseLibraryDirectory(),
			onMaxConcurrentIndexJobsChange: this.settingsController.setMaxConcurrentIndexJobs,
		};
	}

	private getRagSectionProps(): RagSettingsSectionProps {
		return {
			labels: this.state.labels,
			activeRagProvider: this.state.activeRagProvider,
			ragProviders: this.state.ragProviders,
			retrievalCandidateCount: this.state.retrievalCandidateCount,
			retrievalTopK: this.state.retrievalTopK,
			isSettingsSaving: this.state.isSettingsSaving,
			isTestingRagConnection: this.state.isTestingRagConnection,
			onRagProviderApiKeyChange: this.settingsController.setRagProviderApiKey,
			onRagProviderBaseUrlChange: this.settingsController.setRagProviderBaseUrl,
			onRagProviderEmbeddingModelChange: this.settingsController.setRagProviderEmbeddingModel,
			onRagProviderRerankerModelChange: this.settingsController.setRagProviderRerankerModel,
			onRagProviderEmbeddingPathChange: this.settingsController.setRagProviderEmbeddingPath,
			onRagProviderRerankPathChange: this.settingsController.setRagProviderRerankPath,
			onRetrievalCandidateCountChange: this.settingsController.setRetrievalCandidateCount,
			onRetrievalTopKChange: this.settingsController.setRetrievalTopK,
			onTestRagConnection: () => void this.settingsController.handleTestRagConnection(),
		};
	}

	private getLlmSectionProps(): LlmSettingsSectionProps {
		return {
			labels: this.state.labels,
			activeLlmProvider: this.state.activeLlmProvider,
			llmProviders: this.state.llmProviders,
			isSettingsSaving: this.state.isSettingsSaving,
			isTestingLlmConnection: this.state.isTestingLlmConnection,
			onActiveLlmProviderChange: this.settingsController.setActiveLlmProvider,
			onLlmProviderApiKeyChange: this.settingsController.setLlmProviderApiKey,
			onLlmProviderModelChange: this.settingsController.setLlmProviderModel,
			onLlmProviderSelectedModelOption: this.settingsController.setLlmProviderSelectedModelOption,
			onLlmProviderReasoningEffortChange: this.settingsController.setLlmProviderReasoningEffort,
			onLlmProviderModelEnabledChange: this.settingsController.setLlmProviderModelEnabled,
			onLlmProviderUseMaxContextWindowChange: this.settingsController.setLlmProviderUseMaxContextWindow,
			onTestLlmConnection: () => void this.settingsController.handleTestLlmConnection(),
		};
	}

	private getTranslationSectionProps(): TranslationSettingsSectionProps {
		return {
			labels: this.state.labels,
			contextViewProvider: this.contextViewService,
			activeTranslationProvider: this.state.activeTranslationProvider,
			translationProviders: this.state.translationProviders,
			llmProviders: this.state.llmProviders,
			isSettingsSaving: this.state.isSettingsSaving,
			isTestingTranslationConnection: this.state.isTestingTranslationConnection,
			isLoadingTranslationModels: this.state.isLoadingTranslationModels,
			onActiveTranslationProviderChange: this.settingsController.setActiveTranslationProvider,
			onTranslationProviderApiKeyChange: this.settingsController.setTranslationProviderApiKey,
			onTranslationProviderBaseUrlChange: this.settingsController.setTranslationProviderBaseUrl,
			onTranslationProviderModelChange: this.settingsController.setTranslationProviderModel,
			onGlmModelChange: optionValue => this.settingsController.setLlmProviderSelectedModelOption('glm', optionValue),
			onFetchTranslationModels: () => void this.settingsController.handleFetchTranslationModels(),
			onTestTranslationConnection: () => void this.settingsController.handleTestTranslationConnection(),
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
			locale: state => renderLocaleSection(state, this.contextViewService, this.settingsController),
			layout: state => renderLayoutSection(state, this.contextViewService, this.settingsController),
			browser: state => renderBrowserSection(state, this.contextViewService, this.settingsController),
			notifications: state => renderNotificationsSection(state, this.settingsController),
			appearance: state => renderAppearanceSection(state, this.contextViewService, this.settingsController),
			configPath: state => renderConfigPathSection(state, this.settingsController),
			textEditor: state => renderTextEditorSection(state, this.contextViewService, this.settingsController),
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
			supportedSources: state => renderSupportedSourcesSection(state, this.handleToggleSupportedSources),
			knowledgeBaseLibrary: () => renderLibrarySettingsSection(this.getLibrarySectionProps()),
			knowledgeBaseRag: () => renderRagSettingsSection(this.getRagSectionProps()),
			downloadDirectory: state => renderDownloadDirectorySection(state, this.settingsController),
		};
	}

	private initializeSearch() {
		const searchIcon = createLxIcon('search', 'comet-settings-navigation-search-icon');
		const placeholder = this.state.labels.settingsSearchPlaceholder;
		this.searchInput.type = 'search';
		this.searchInput.value = this.searchQuery;
		this.searchInput.placeholder = placeholder;
		this.searchInput.setAttribute('aria-label', placeholder);
		this.searchInput.autocomplete = 'off';
		this.searchInput.spellcheck = false;
		const handleInput = () => this.handleDidChangeSearchQuery(this.searchInput.value);
		this.searchInput.addEventListener('input', handleInput);
		this.disposables.add(toDisposable(() => this.searchInput.removeEventListener('input', handleInput)));
		this.search.append(searchIcon, this.searchInput);
	}

	private syncSearch() {
		const placeholder = this.state.labels.settingsSearchPlaceholder;
		this.searchInput.placeholder = placeholder;
		this.searchInput.setAttribute('aria-label', placeholder);
		if (this.searchInput.value !== this.searchQuery) {
			this.searchInput.value = this.searchQuery;
		}
	}

	private syncTOCTree() {
		this.syncSearch();
		this.tocTreeModel.update(this.state.labels, this.settingsTreeModel);
		this.tocTree.update(this.tocTreeModel, {
			title: this.state.labels.settingsTitle,
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
		this.settingsTreeModel.update(this.state.labels, this.searchQuery);
		this.noResultsHint.textContent = this.state.labels.settingsSearchNoResults;
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
		this.settingsTree.renderPage(this.activePageId, this.state);
	}

	private updateView(previousState?: SettingsViewState, forceAll = false) {
		const focusSnapshot = this.captureFocus();
		this.refreshTreeModel();
		this.ensureActiveSearchPage();
		this.loadingHint.textContent = this.state.labels.settingsLoading;
		this.syncTOCTree();
		this.settingsTree.updateSections(this.state, previousState, forceAll);
		this.renderActivePage();
		this.restoreFocus(focusSnapshot);
	}

	private readonly handleToggleSupportedSources = () => {
		const focusSnapshot = this.captureFocus();
		this.showSupportedSources = !this.showSupportedSources;
		this.state = this.createState();
		this.settingsTree.updateSection('supportedSources', this.state);
		this.renderActivePage();
		this.restoreFocus(focusSnapshot);
	};
}
