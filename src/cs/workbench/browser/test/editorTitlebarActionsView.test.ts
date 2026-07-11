/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import en from 'language/locales/en.json';

const domEnvironment = installDomTestEnvironment();
let dropdownServices: Awaited<ReturnType<typeof createDropdownTestServices>>;

const labels = {
	headerAddAction: 'Add editor',
	createDraft: 'Create draft',
	createBrowser: 'Create browser',
	createFile: 'Create file',
	expandEditor: 'Expand editor',
	collapseEditor: 'Collapse editor',
};

beforeEach(async () => {
	document.body.replaceChildren();
	dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
	dropdownServices.dispose();
});

after(() => {
  domEnvironment.cleanup();
});

test('editor titlebar actions open editors and toggle the editor layout', async () => {
	const { createEditorTitlebarActionsView } = await import(
		'cs/workbench/browser/parts/editor/editorTitlebarActionsView'
	);
	const openRequests: object[] = [];
	let toggleCount = 0;
	const view = createEditorTitlebarActionsView({
    ...dropdownServices,
		isEditorCollapsed: true,
		labels,
		onOpenEditor: request => {
			openRequests.push(request);
		},
		onToggleEditorCollapse: () => {
			toggleCount += 1;
		},
	});
	document.body.append(view.getElement());

	try {
		const toggleButton = document.body.querySelector('[aria-label="Expand editor"]');
		assert(toggleButton instanceof HTMLButtonElement);
		toggleButton.click();
		assert.equal(toggleCount, 1);

		const addButton = document.body.querySelector('[aria-label="Add editor"]');
		assert(addButton instanceof HTMLButtonElement);
		addButton.click();
		await new Promise(resolve => setTimeout(resolve, 0));

		const draftItem = Array.from(
			document.body.querySelectorAll('.comet-dropdown-menu-item'),
		).find(element => element.textContent?.trim() === labels.createDraft);
		assert(draftItem instanceof HTMLElement);
		draftItem.click();
		assert.deepEqual(openRequests, [
			{
				kind: 'draft',
				disposition: 'reveal-or-open',
			},
		]);
	} finally {
		view.dispose();
	}
});

test('editor titlebar add action closes and clears its active state outside the workbench', async () => {
	const { createEditorTitlebarActionsView } = await import(
		'cs/workbench/browser/parts/editor/editorTitlebarActionsView'
	);
	const view = createEditorTitlebarActionsView({
    ...dropdownServices,
		isEditorCollapsed: false,
		labels,
		onOpenEditor: () => {},
		onToggleEditorCollapse: () => {},
	});
	document.body.append(view.getElement());
	const outside = document.body.appendChild(document.createElement('div'));

	try {
		const addButton = document.body.querySelector('[aria-label="Add editor"]');
		assert(addButton instanceof HTMLButtonElement);
		const actionItem = addButton.closest('.comet-actionbar-item');
		assert(actionItem instanceof HTMLElement);

		addButton.click();
		assert.equal(addButton.getAttribute('aria-expanded'), 'true');
		assert.equal(actionItem.classList.contains('comet-is-active'), true);

		window.dispatchEvent(new Event('blur'));
		assert.equal(addButton.getAttribute('aria-expanded'), 'true');
		assert.equal(actionItem.classList.contains('comet-is-active'), true);

		outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		assert.equal(addButton.getAttribute('aria-expanded'), 'false');
		assert.equal(actionItem.classList.contains('comet-is-active'), false);
	} finally {
		view.dispose();
	}
});

test('session workbench keeps titlebar actions through editor collapse cycles', async () => {
	const [
		{ InstantiationService },
		{ ServiceCollection },
		{ BrowserDialogService },
		{ nativeHostService },
		{ createEditorPartProps },
		{ createSessionChatViewProps },
		{ SessionWorkbenchContentPartViews },
		{
			createSessionWorkbenchLayoutView,
			getWorkbenchLayoutStateSnapshot,
			setAgentSidebarVisible,
			setEditorCollapsed,
			setPrimarySidebarVisible,
			setWorkbenchSidebarSizes,
		},
		{ createEditorTitlebarActionsView },
		{ IChatService },
		{ IFetchService },
	] = await Promise.all([
		import('cs/platform/instantiation/common/instantiationService'),
		import('cs/platform/instantiation/common/serviceCollection'),
		import('cs/workbench/services/dialogs/browser/dialogService'),
		import('cs/workbench/services/host/electron-browser/nativeHostService'),
		import('cs/workbench/browser/parts/editor/editorPart'),
		import('cs/sessions/browser/parts/sessions/chatView'),
		import('cs/sessions/browser/workbenchContentPartViews'),
		import('cs/workbench/browser/layout'),
		import('cs/workbench/browser/parts/editor/editorTitlebarActionsView'),
		import('cs/workbench/contrib/chat/common/chatService/chatService'),
		import('cs/workbench/services/fetch/common/fetch'),
	]);
	const chatService = {
		_serviceBrand: undefined,
		subscribe: () => ({ dispose() {} }),
		getSnapshot: () => ({
			conversations: [],
			activeConversationId: '',
			checkedArticleIds: [],
			activeConversation: null,
			question: '',
			messages: [],
			result: null,
			isAsking: false,
			errorMessage: null,
		}),
		setContext() {},
		setQuestion() {},
		createConversation: () => '',
		activateConversation() {},
		closeConversation() {},
		insertContextMessage() {},
		insertArticleList() {},
		insertArticleFetchEmptyResult() {},
		applyPatch() {},
		ask: async () => {},
		isArticleChecked: () => false,
		setArticleChecked() {},
	};
	const fetchService = {
		_serviceBrand: undefined,
		onDidChangeCatalog: () => ({ dispose() {} }),
		onDidChangeSource: () => ({ dispose() {} }),
		onDidChangeArticle: () => ({ dispose() {} }),
		getJournals: () => [],
		getJournal: () => undefined,
		getArticleListCatalog: () => undefined,
		getArticlePage: () => undefined,
		getArticlePages: () => [],
		getArticleListItem: () => undefined,
		getArticle: () => undefined,
		getArticleDetail: () => undefined,
		getCatalogLoadState: () => ({ status: 'idle' as const }),
		getSourceLoadState: () => ({ status: 'idle' as const }),
		getArticleLoadState: () => ({ status: 'idle' as const }),
		discoverArticleListSources: async () => {},
		fetchArticleListSource: async () => {},
		fetchNextPage: async () => {},
		fetchArticle: async () => {
			throw new Error('No article is available in this test.');
		},
		refreshJournal: async () => {},
		refreshArticleListSource: async () => {},
	};
	const instantiationService = new InstantiationService(new ServiceCollection(
		[IChatService, chatService],
		[IFetchService, fetchService],
	));
	const dialogService = new BrowserDialogService();
	const initialLayoutState = getWorkbenchLayoutStateSnapshot();
	let setEditorVisible = (_isEditorVisible: boolean) => {};
	const collapsedActionsView = createEditorTitlebarActionsView({
    ...dropdownServices,
		isEditorCollapsed: true,
		labels,
		onOpenEditor: () => {},
		onToggleEditorCollapse: () => setEditorVisible(true),
	});
	const collapsedActionsElement = collapsedActionsView.getElement();
	const editorPartProps = {
		...dropdownServices,
		...createEditorPartProps({
			state: {
				ui: en,
				viewPartProps: {
					browserUrl: '',
					electronRuntime: false,
					webContentRuntime: false,
					labels: {
						emptyState: 'Empty',
						contentUnavailable: 'Unavailable',
						overlayPauseHeading: 'Paused',
						overlayPauseDetail: 'Dismiss',
					},
				},
				nativeHost: nativeHostService,
				dialogService,
				instantiationService,
				groupId: 'editor-group-default',
				tabs: [],
				dirtyDraftTabIds: [],
				activeTabId: null,
				activeTab: null,
				viewStateEntries: [],
			},
			actions: {
				onActivateTab: () => {},
				onReorderTab: () => {},
				onCloseTab: async () => true,
				onCloseOtherTabs: async () => true,
				onCloseAllTabs: async () => true,
				onRenameTab: () => {},
				onOpenEditor: () => {},
				onDraftDocumentChange: () => {},
				onSetEditorViewState: () => {},
				onDeleteEditorViewState: () => {},
			},
		}),
		onOpenAddressBarSourceMenu: () => {},
		onToolbarNavigateBack: () => {},
		onToolbarNavigateForward: () => {},
		onToolbarNavigateRefresh: () => {},
		onToolbarArchiveCurrentPage: () => {},
		onToolbarHardReload: () => {},
		onToolbarCopyCurrentUrl: () => {},
		onToolbarClearBrowsingHistory: () => {},
		onToolbarClearCookies: () => {},
		onToolbarClearCache: () => {},
		onToolbarAddressChange: () => {},
		onToolbarAddressSubmit: () => {},
		onToolbarNavigateToUrl: () => {},
		onToggleEditorCollapse: () => setEditorVisible(false),
	};
	const sessionChatProps = createSessionChatViewProps({
		state: {
			isKnowledgeBaseModeEnabled: false,
			question: '',
			messages: [],
			isAsking: false,
			errorMessage: null,
			llmModelOptions: [],
			activeLlmModelOptionValue: '',
			activeLlmModelLabel: 'Auto',
			isMaxContextWindowEnabled: false,
			activeLlmModelSupportsMaxContextWindow: false,
		},
		actions: {
			onQuestionChange: () => {},
			onAsk: () => {},
			onApplyPatch: () => {},
			onToggleAutoModelRouting: () => {},
			onSelectLlmModel: () => {},
			onToggleMaxContextWindow: () => {},
			onOpenModelSettings: () => {},
		},
	});
	const sidebarFooterActionsElement = document.createElement('div');
	const createContentPartProps = (isEditorVisible: boolean) => ({
		isPrimarySidebarVisible: true,
		isEditorVisible,
		sidebarProps: {
			labels: {
				homeTitle: 'Home',
				codeTitle: 'Code',
				homeNavNewChat: 'New chat',
				homeNavProjects: 'Projects',
				homeNavArtifacts: 'Artifacts',
				homeNavCustomize: 'Customize',
				recentsTitle: 'Recents',
			},
			activeEntry: 'home' as const,
			onActivateEntry: () => {},
		},
		sessionChatProps,
		editorPartProps,
		sidebarFooterActionsElement,
		collapsedEditorTitlebarActionsElement: collapsedActionsElement,
	});
	const partViews = instantiationService.createInstance(
		SessionWorkbenchContentPartViews,
		createContentPartProps(false),
	);
	const createLayoutProps = (isEditorVisible: boolean) => ({
		isPrimarySidebarVisible: true,
		isLayoutEdgeSnappingEnabled: true,
		primarySidebarSize: 248,
		isEditorCollapsed: !isEditorVisible,
		expandedEditorSize: 420,
		partViews,
	});
	const layoutView = createSessionWorkbenchLayoutView(createLayoutProps(false));
	setEditorVisible = isEditorVisible => {
		partViews.setProps(createContentPartProps(isEditorVisible));
		layoutView.setProps(createLayoutProps(isEditorVisible));
		layoutView.layout();
	};

	try {
		document.body.append(layoutView.getElement());
		layoutView.layout();
		assert.equal(partViews.getEditorElement(), null);
		assert.equal(collapsedActionsElement.isConnected, true);
		assert.equal(document.querySelectorAll('.comet-editor-titlebar-actionbar').length, 1);

		const expandButton = collapsedActionsElement.querySelector('[aria-label="Expand editor"]');
		assert(expandButton instanceof HTMLButtonElement);
		expandButton.click();

		const expandedActionsElement = document.querySelector(
			'.comet-editor-titlebar .comet-editor-titlebar-actionbar',
		);
		assert(expandedActionsElement instanceof HTMLElement);
		assert.notEqual(expandedActionsElement, collapsedActionsElement);
		assert.equal(collapsedActionsElement.isConnected, false);
		assert.equal(partViews.getEditorElement()?.isConnected, true);
		assert.equal(document.querySelectorAll('.comet-editor-titlebar-actionbar').length, 1);

		const collapseButton = expandedActionsElement.querySelector(
			'[aria-label="Collapse editor"]',
		);
		assert(collapseButton instanceof HTMLButtonElement);
		collapseButton.click();

		assert.equal(partViews.getEditorElement(), null);
		assert.equal(expandedActionsElement.isConnected, false);
		assert.equal(collapsedActionsElement.isConnected, true);
		assert.equal(document.querySelectorAll('.comet-editor-titlebar-actionbar').length, 1);
		assert(collapsedActionsElement.querySelector('[aria-label="Expand editor"]'));
	} finally {
		layoutView.dispose();
		partViews.dispose();
		collapsedActionsView.dispose();
		dialogService.dispose();
		instantiationService.dispose();
		setPrimarySidebarVisible(initialLayoutState.isPrimarySidebarVisible);
		setAgentSidebarVisible(initialLayoutState.isAgentSidebarVisible);
		setWorkbenchSidebarSizes({
			primarySidebarSize: initialLayoutState.primarySidebarSize,
			agentSidebarSize: initialLayoutState.agentSidebarSize,
		});
		setEditorCollapsed(
			initialLayoutState.isEditorCollapsed,
			initialLayoutState.expandedEditorSize,
		);
	}
});
