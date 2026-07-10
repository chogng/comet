/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { VSBuffer } from 'cs/base/common/buffer';
import { Emitter, Event as BaseEvent } from 'cs/base/common/event';
import { toDisposable } from 'cs/base/common/lifecycle';
import { isIMenuItem, MenuId, MenuRegistry } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, BrowserViewStorageScope, browserZoomDefaultIndex, type IBrowserDeviceProfile, type IBrowserViewCertificateError, type IBrowserViewLoadError, type IBrowserViewPermissionRequestEvent } from 'cs/platform/browserView/common/browserView';
import { BrowserHistoryStore } from 'cs/platform/browserView/common/browserHistory';
import { BrowserPermissionStore, PermissionCategory, type IPermissionCategoryState } from 'cs/platform/browserView/common/browserPermissions';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { commandService, commandsRegistry, setCommandServiceInstantiationService } from 'cs/platform/commands/common/commands';
import { IConfigurationService } from 'cs/platform/configuration/common/configuration';
import { ConfigurationService } from 'cs/platform/configuration/common/configurationService';
import { configurationRegistry, ConfigurationScope } from 'cs/platform/configuration/common/configurationRegistry';
import { IContextViewService, type IContextViewService as IContextViewServiceType } from 'cs/platform/contextview/browser/contextView';
import type { IContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { contextKeyService, IContextKeyService as IContextKeyServiceDecorator } from 'cs/platform/contextkey/common/contextkey';
import type { HoverHandle, HoverInput } from 'cs/base/browser/ui/hover/hover';
import { IHoverService, type IHoverService as IHoverServiceType } from 'cs/platform/hover/browser/hover';
import type { ITunnelProxyInfo } from 'cs/platform/tunnel/common/tunnelProxy';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IKeybindingService, type IKeybindingService as IKeybindingServiceType } from 'cs/platform/keybinding/common/keybinding';
import { ILogService, type ILogService as ILogServiceType } from 'cs/platform/log/common/log';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { INotificationService, NoOpNotification, NoOpNotificationService, type INotificationService as INotificationServiceType } from 'cs/platform/notification/common/notification';
import { IQuickInputService, type IQuickInputService as IQuickInputServiceType } from 'cs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope, StorageTarget, type IStorageEntry, type IStorageService as IStorageServiceType } from 'cs/platform/storage/common/storage';
import { IThemeService, type IThemeService as IThemeServiceType } from 'cs/platform/theme/common/themeService';
import { ITelemetryService, TelemetryLevel, type ITelemetryService as ITelemetryServiceType } from 'cs/platform/telemetry/common/telemetry';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { EditorResolverService } from 'cs/workbench/services/editor/browser/editorResolverService';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import {
	BROWSER_SEARCH_ENGINES,
	BROWSER_SEARCH_NONE,
	BrowserSearchEngineId,
	BrowserSearchEngineSettingId,
} from 'cs/workbench/contrib/browserView/common/browserSearch';
import { IBrowserZoomService, MATCH_WINDOW_ZOOM_LABEL, type IBrowserZoomService as IBrowserZoomServiceType } from 'cs/workbench/contrib/browserView/common/browserZoomService';
import {
	BrowserViewSharingState,
	IBrowserViewWorkbenchService,
	type IBrowserEditorViewState,
	type IBrowserViewContextualFilter,
	type IBrowserViewFilterContext,
	type IBrowserViewModel,
	type IBrowserViewOpenHandler,
} from 'cs/workbench/contrib/browserView/common/browserView';
import type { BrowserEditor as BrowserEditorType } from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import type { PreferredGroup } from 'cs/workbench/services/editor/common/editorService';
import { IChatService, type ChatServiceContext, type ChatServiceSnapshot } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { setWorkbenchEditorCommandHandlers } from 'cs/workbench/browser/editorCommands';
import type { WorkbenchEditorCommandHandlers } from 'cs/workbench/browser/editorCommands';
import type { EditorOpenRequest } from 'cs/workbench/services/editor/common/editorOpenTypes';

const BrowserRemoteProxyEnabledSettingId = 'workbench.browser.enableRemoteProxy';
const BrowserPageZoomSettingId = 'workbench.browser.pageZoom';

let cleanupDomEnvironment: (() => void) | null = null;
let cleanupResizeObserver: (() => void) | null = null;
let BrowserEditorResolverContribution: typeof import('cs/workbench/contrib/browserView/electron-browser/browserView.contribution').BrowserEditorResolverContribution;
let BrowserEditor: typeof import('cs/workbench/contrib/browserView/electron-browser/browserEditor').BrowserEditor;
let BrowserEditorFindContribution: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorFindFeature').BrowserEditorFindContribution;
let BrowserFavoritesFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserFavoritesFeature').BrowserFavoritesFeature;
let BrowserHistoryFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature').BrowserHistoryFeature;
let BrowserPermissionsFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserPermissionsFeature').BrowserPermissionsFeature;
let BrowserEditorEmulationSupport: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorEmulationFeatures').BrowserEditorEmulationSupport;

function createTestThemeService(): IThemeServiceType {
	return {
		_serviceBrand: undefined,
		getColorTheme: () => ({
			getColor: () => undefined,
		}),
	};
}

function createTestTelemetryService(): ITelemetryServiceType {
	return {
		_serviceBrand: undefined,
		telemetryLevel: TelemetryLevel.NONE,
		sessionId: 'test-session',
		machineId: 'test-machine',
		sqmId: 'test-sqm',
		devDeviceId: 'test-device',
		firstSessionDate: '2026-07-09',
		sendErrorTelemetry: false,
		publicLog() {},
		publicLog2() {},
		publicLogError() {},
		publicLogError2() {},
		setExperimentProperty() {},
		setCommonProperty() {},
	};
}

function installResizeObserverStub(): () => void {
	const previousGlobal = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	const previousWindow = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');

	class TestResizeObserver implements ResizeObserver {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	}

	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: TestResizeObserver,
	});
	Object.defineProperty(window, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: TestResizeObserver,
	});

	return () => {
		if (previousGlobal) {
			Object.defineProperty(globalThis, 'ResizeObserver', previousGlobal);
		} else {
			Reflect.deleteProperty(globalThis, 'ResizeObserver');
		}
		if (previousWindow) {
			Object.defineProperty(window, 'ResizeObserver', previousWindow);
		} else {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
	};
}

function createTestLogService(): ILogServiceType {
	return {
		_serviceBrand: undefined,
		trace() {},
		debug() {},
		info() {},
		warn() {},
		error() {},
	};
}

function createTestNotificationService(): INotificationServiceType {
	return new NoOpNotificationService();
}

type NotificationPromptCall = {
	readonly severity: Parameters<INotificationServiceType['prompt']>[0];
	readonly message: Parameters<INotificationServiceType['prompt']>[1];
	readonly choices: Parameters<INotificationServiceType['prompt']>[2];
	readonly options: Parameters<INotificationServiceType['prompt']>[3];
};

class CapturingNotificationService extends NoOpNotificationService {
	readonly prompts: NotificationPromptCall[] = [];

	override prompt(...args: Parameters<INotificationServiceType['prompt']>): ReturnType<INotificationServiceType['prompt']> {
		this.prompts.push({
			severity: args[0],
			message: args[1],
			choices: args[2],
			options: args[3],
		});
		return new NoOpNotification();
	}
}

function createTestKeybindingService(): IKeybindingServiceType {
	return {
		_serviceBrand: undefined,
		inChordMode: false,
		onDidUpdateKeybindings: BaseEvent.None,
		resolveKeybinding: () => [],
		resolveKeyboardEvent: () => undefined,
		resolveUserBinding: () => [],
		dispatchEvent: () => false,
		softDispatch: () => undefined,
		enableKeybindingHoldMode: () => undefined,
		dispatchByUserSettingsLabel() {},
		lookupKeybindings: () => [],
		lookupKeybinding: () => undefined,
		getDefaultKeybindingsContent: () => '',
		getDefaultKeybindings: () => [],
		getKeybindings: () => [],
		customKeybindingsCount: () => 0,
		mightProducePrintableCharacter: () => false,
		registerSchemaContribution: () => toDisposable(() => {}),
		toggleLogging: () => false,
		appendKeybinding: () => '',
		_dumpDebugInfo: () => '',
		_dumpDebugInfoJSON: () => '',
	} as unknown as IKeybindingServiceType;
}

function createTestHoverHandle(): HoverHandle {
	return {
		dispose() {},
		show() {},
		hide() {},
		update(_input: HoverInput) {},
	};
}

function createTestHoverService(): IHoverServiceType {
	return {
		_serviceBrand: undefined,
		createHover: () => createTestHoverHandle(),
		showDelayedHover: () => createTestHoverHandle(),
		setupDelayedHover: () => toDisposable(() => {}),
		setupDelayedHoverAtMouse: () => toDisposable(() => {}),
		showInstantHover: () => createTestHoverHandle(),
		applyHover: () => createTestHoverHandle(),
		hideHover() {},
		showAndFocusLastHover() {},
	};
}

function createTestContextViewService(): IContextViewServiceType {
	return {
		_serviceBrand: undefined,
		showContextView: () => toDisposable(() => {}),
		hideContextView() {},
		getContextViewElement: () => document.body,
		layout() {},
		isVisible: () => false,
		dispose() {},
	};
}

function createTestQuickInputService(): IQuickInputServiceType {
	return {
		_serviceBrand: undefined,
		backButton: {},
		currentQuickInput: undefined,
		quickAccess: undefined,
		onShow: BaseEvent.None,
		onHide: BaseEvent.None,
		pick: async () => undefined,
		input: async () => undefined,
		createQuickPick: () => {
			throw new Error('Unexpected quick pick in browser contribution test');
		},
		createInputBox: () => {
			throw new Error('Unexpected input box in browser contribution test');
		},
		createQuickWidget: () => {
			throw new Error('Unexpected quick widget in browser contribution test');
		},
		createQuickTree: () => {
			throw new Error('Unexpected quick tree in browser contribution test');
		},
		focus() {},
		toggle() {},
		navigate() {},
		accept() {},
		back() {},
		cancel: async () => undefined,
		setAlignment() {},
		toggleHover() {},
	} as unknown as IQuickInputServiceType;
}

function createTestWorkbenchEditorCommandHandlers(
	openRequests: EditorOpenRequest[],
): WorkbenchEditorCommandHandlers {
	return {
		executeActiveDraftCommand: () => false,
		canExecuteActiveDraftCommand: () => false,
		getActiveDraftStableSelectionTarget: () => null,
		saveActiveDraft: () => false,
		canSaveActiveDraft: () => false,
		openEditor: request => {
			openRequests.push(request);
		},
		activateTab() {},
		closeTab: () => false,
		getTabs: () => [],
	};
}

type ChatContextInsert = {
	readonly title: string;
	readonly content: string;
};

function createTestChatService(inserts: ChatContextInsert[]): IChatService {
	const emptySnapshot: ChatServiceSnapshot = {
		conversations: [],
		activeConversationId: '',
		selectedArticleUrlsInOrder: [],
		activeConversation: null,
		question: '',
		messages: [],
		result: null,
		isAsking: false,
		errorMessage: null,
	};

	return {
		_serviceBrand: undefined,
		subscribe: () => toDisposable(() => {}),
		getSnapshot: () => emptySnapshot,
		setContext(_context: ChatServiceContext) {},
		setQuestion() {},
		createConversation: () => 'conversation-test',
		activateConversation() {},
		closeConversation() {},
		insertContextMessage: (title, content) => {
			inserts.push({ title, content });
		},
		insertArticles() {},
		insertArticleFetchEmptyResult() {},
		applyPatch() {},
		ask: async () => {},
		collectArticleBatch: articles => [...articles],
		collectSelectedArticleBatch: articles => [...articles],
		isArticleSelected: () => false,
		toggleArticleSelected() {},
	};
}

function createTestBrowserZoomService(): IBrowserZoomServiceType {
	return {
		_serviceBrand: undefined,
		onDidChangeZoom: BaseEvent.None,
		getEffectiveZoomIndex: () => browserZoomDefaultIndex,
		setHostZoomIndex() {},
		notifyWindowZoomChanged() {},
	};
}

function createTestStorageService(values = new Map<string, string>()): IStorageServiceType {
	const keyFor = (key: string, scope: StorageScope) => `${scope}:${key}`;
	return {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: ((scopeOrListener: StorageScope | ((event: unknown) => void), _key?: string) => {
			if (typeof scopeOrListener === 'function') {
				return toDisposable(() => {});
			}
			return (_listener: (event: unknown) => void) => toDisposable(() => {});
		}) as IStorageServiceType['onDidChangeValue'],
		onWillSaveState: BaseEvent.None,
		init: async () => {},
		close: async () => {},
		get: (key: string, scope: StorageScope, fallbackValue?: string) =>
			values.get(keyFor(key, scope)) ?? fallbackValue,
		getBoolean: (_key: string, _scope: StorageScope, fallbackValue?: boolean) => fallbackValue,
		getNumber: (_key: string, _scope: StorageScope, fallbackValue?: number) => fallbackValue,
		getObject: <T extends object>(_key: string, _scope: StorageScope, fallbackValue?: T) => fallbackValue,
		store: (key: string, value: string | number | boolean | object | undefined | null, scope: StorageScope, _target: StorageTarget) => {
			values.set(keyFor(key, scope), String(value));
		},
		storeAll(entries: Array<IStorageEntry>, _external: boolean) {
			for (const entry of entries) {
				values.set(keyFor(entry.key, entry.scope), String(entry.value));
			}
		},
		remove: (key: string, scope: StorageScope) => {
			values.delete(keyFor(key, scope));
		},
		keys: (scope: StorageScope, _target: StorageTarget) => [...values.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(`${scope}:`.length)),
		log() {},
		optimize: async () => {},
		flush: async () => {},
		saveFetchedArticles: async () => {},
		loadTranslationCache: async () => ({}),
		saveTranslationCache: async () => {},
		upsertLibraryDocumentMetadata: async () => {
			throw new Error('Unexpected library metadata write in browser contribution test');
		},
		deleteLibraryDocument: async () => false,
		registerLibraryDocument: async () => {
			throw new Error('Unexpected library registration in browser contribution test');
		},
		getLibraryDocumentStatus: async () => null,
		listLibraryDocuments: async () => ({ documents: [], total: 0 }),
		reindexLibraryDocument: async () => {
			throw new Error('Unexpected library reindex in browser contribution test');
		},
	} as unknown as IStorageServiceType;
}

function createTestBrowserViewModel(id: string, state: IBrowserEditorViewState): IBrowserViewModel {
	return {
		id,
		owner: { mainWindowId: 1 },
		url: state.url ?? '',
		title: state.title ?? '',
		favicon: state.favicon,
		error: undefined,
		certificateError: undefined,
		loading: false,
		canGoBack: false,
		canGoForward: false,
		isDevToolsOpen: false,
		isRemoteSession: false,
		zoomFactor: 1,
		canZoomIn: true,
		canZoomOut: true,
		device: undefined,
		storageScope: BrowserViewStorageScope.Workspace,
		history: new BrowserHistoryStore(),
		permissions: new BrowserPermissionStore(),
		sharingState: BrowserViewSharingState.Unavailable,
		onDidFindInPage: BaseEvent.None,
		onDidChangeZoom: BaseEvent.None,
		onWillDispose: BaseEvent.None,
		onWillNavigate: BaseEvent.None,
		onDidClose: BaseEvent.None,
		onDidChangeTitle: BaseEvent.None,
		onDidChangeFavicon: BaseEvent.None,
		onDidChangeLoadingState: BaseEvent.None,
		onDidNavigate: BaseEvent.None,
		onDidChangeFocus: BaseEvent.None,
		onDidChangeVisibility: BaseEvent.None,
		onDidKeyCommand: BaseEvent.None,
		onDidChangeDevToolsState: BaseEvent.None,
		onDidChangeRemoteStatus: BaseEvent.None,
		onDidRequestPermission: BaseEvent.None,
		onDidChangeDevice: BaseEvent.None,
		onDidSelectElement: BaseEvent.None,
		onDidChangeElementSelectionActive: BaseEvent.None,
		onDidPickArea: BaseEvent.None,
		onDidChangeAreaSelectionActive: BaseEvent.None,
		layout: async () => {},
		setVisible: async () => {},
		captureScreenshot: async () => {
			throw new Error('Unexpected screenshot capture in browser contribution test');
		},
		findInPage: async () => {},
		stopFindInPage: async () => {},
		getSelectedText: async () => '',
		focus: async () => {},
		loadURL: async () => {},
		goBack: async () => {},
		goForward: async () => {},
		reload: async () => {},
		toggleDevTools: async () => {},
		trustCertificate: async () => {},
		untrustCertificate: async () => {},
		deleteHistory: async () => {},
		setPermissions: async () => {},
		selectDevice: async () => {},
		setDevice: async () => {},
		zoomIn: async () => {},
		zoomOut: async () => {},
		resetZoom: async () => {},
		getConsoleLogs: async () => '',
		toggleElementSelection: async () => {},
		toggleAreaSelection: async () => {},
		dispose() {},
	} as unknown as IBrowserViewModel;
}

function createTestNativeHostService(): INativeHostService {
	return {
		_serviceBrand: undefined,
		canInvoke: () => false,
		invoke: async () => undefined,
		ipc: undefined,
		windowControls: undefined,
		webContent: undefined,
		fetch: undefined,
		document: undefined,
	};
}

class TestBrowserViewWorkbenchService implements IBrowserViewWorkbenchService {
	declare readonly _serviceBrand: undefined;

	readonly requests: Array<{ readonly id: string; readonly state: IBrowserEditorViewState }> = [];
	readonly resolveCalls: string[] = [];
	readonly onDidChangeBrowserViews = BaseEvent.None;
	readonly onDidChangeSharingAvailable = BaseEvent.None;
	readonly isSharingAvailable = false;
	private readonly known = new Map<string, BrowserEditorInput>();

	constructor(
		private readonly instantiationService: IInstantiationService,
		private readonly createModel: (id: string, state: IBrowserEditorViewState) => IBrowserViewModel = createTestBrowserViewModel,
	) {}

	willUseRemoteProxy(): boolean {
		return false;
	}

	setRemoteProxyInfo(_info: ITunnelProxyInfo | undefined): void {}

	getKnownBrowserViews(): Map<string, BrowserEditorInput> {
		return this.known;
	}

	registerContextualFilter(_filter: IBrowserViewContextualFilter) {
		return toDisposable(() => {});
	}

	getContextualBrowserViews(_context: IBrowserViewFilterContext = {}): Map<string, BrowserEditorInput> {
		return this.known;
	}

	async getPreferredGroup(preferredGroup?: PreferredGroup): Promise<PreferredGroup | undefined> {
		return preferredGroup;
	}

	registerOpenHandler(_handler: IBrowserViewOpenHandler) {
		return toDisposable(() => {});
	}

	getOrCreateLazy(id: string, initialState: IBrowserEditorViewState = {}): BrowserEditorInput {
		this.requests.push({ id, state: initialState });

		let input = this.known.get(id);
		if (!input) {
			input = this.instantiationService.createInstance(
				BrowserEditorInput,
				{ id, ...initialState },
				async () => {
					this.resolveCalls.push(id);
					return this.createModel(id, initialState);
				},
			);
			this.known.set(id, input);
		}
		return input;
	}

	async clearGlobalStorage(): Promise<void> {}

	async clearWorkspaceStorage(): Promise<void> {}
}

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	cleanupResizeObserver = installResizeObserverStub();
	({ BrowserEditorResolverContribution } = await import('cs/workbench/contrib/browserView/electron-browser/browserView.contribution'));
	({ BrowserEditor } = await import('cs/workbench/contrib/browserView/electron-browser/browserEditor'));
	({ BrowserEditorFindContribution } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorFindFeature'));
	({ BrowserFavoritesFeature } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserFavoritesFeature'));
	({ BrowserHistoryFeature } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature'));
	({ BrowserPermissionsFeature } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserPermissionsFeature'));
	({ BrowserEditorEmulationSupport } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorEmulationFeatures'));
});

after(() => {
	cleanupResizeObserver?.();
	cleanupDomEnvironment?.();
});

test('browser contribution registers devtools action in the browser toolbar menu', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ToggleDevTools)?.id,
		BrowserViewCommandId.ToggleDevTools,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.ToggleDevTools),
		true,
	);
});

test('browser contribution registers storage actions and data storage setting', () => {
	const storageCommandIds = [
		BrowserViewCommandId.ClearGlobalStorage,
		BrowserViewCommandId.ClearWorkspaceStorage,
		BrowserViewCommandId.ClearEphemeralStorage,
	];

	assert.deepEqual(
		storageCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		storageCommandIds,
	);
	assert.deepEqual(
		storageCommandIds.map(id =>
			MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
				isIMenuItem(item) && item.command.id === id)),
		[true, true, true],
	);

	const dataStorageSetting = configurationRegistry.getConfigurationProperties()['workbench.browser.dataStorage'];
	assert.deepEqual(dataStorageSetting.enum, [
		'default',
		BrowserViewStorageScope.Global,
		BrowserViewStorageScope.Workspace,
		BrowserViewStorageScope.Ephemeral,
	]);
});

test('browser contribution does not register the upstream browser navigation toolbar', () => {
	const navigationCommandIds = [
		BrowserViewCommandId.GoBack,
		BrowserViewCommandId.GoForward,
		BrowserViewCommandId.Reload,
		BrowserViewCommandId.HardReload,
	];

	assert.deepEqual(
		navigationCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		[undefined, undefined, undefined, undefined],
	);
	assert.deepEqual(
		navigationCommandIds.map(id =>
			MenuRegistry.getMenuItems(MenuId.BrowserNavigationToolbar).some(item =>
				isIMenuItem(item) && item.command.id === id)),
		[false, false, false, false],
	);
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.FocusUrlInput),
		null,
	);
});

test('browser contribution registers tab management actions in browser menus', () => {
	const tabCommandIds = [
		BrowserViewCommandId.Open,
		BrowserViewCommandId.OpenFile,
		BrowserViewCommandId.NewTab,
		BrowserViewCommandId.QuickOpen,
		BrowserViewCommandId.OpenOrList,
		BrowserViewCommandId.CloseAll,
		BrowserViewCommandId.CloseAllInGroup,
	];

	assert.deepEqual(
		tabCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		tabCommandIds,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.NewTab),
		true,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.MenubarViewMenu).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.OpenOrList),
		true,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.EditorTitleContext).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.CloseAllInGroup),
		true,
	);
});

test('browser tab management commands open through the workbench editor controller handlers', async () => {
	const openRequests: EditorOpenRequest[] = [];
	const instantiationService = new InstantiationService(new ServiceCollection(), true);
	const commandServiceInstantiationService = setCommandServiceInstantiationService(instantiationService);
	setWorkbenchEditorCommandHandlers(createTestWorkbenchEditorCommandHandlers(openRequests));

	try {
		await commandService.executeCommand(BrowserViewCommandId.Open, 'https://example.com/article');
		await commandService.executeCommand(BrowserViewCommandId.NewTab);
	} finally {
		setWorkbenchEditorCommandHandlers(null);
		commandServiceInstantiationService.dispose();
		instantiationService.dispose();
	}

	assert.equal(openRequests.length, 2);
	assert.deepEqual(openRequests.map(request => request.kind), ['browser', 'browser']);
	assert.deepEqual(openRequests.map(request => request.disposition), ['new-tab', 'new-tab']);
	const firstRequest = openRequests[0];
	const secondRequest = openRequests[1];
	assert(firstRequest?.kind === 'browser' && firstRequest.disposition === 'new-tab');
	assert(secondRequest?.kind === 'browser' && secondRequest.disposition === 'new-tab');
	assert.equal(firstRequest.options.viewState.url, 'https://example.com/article');
	assert.equal(secondRequest.options.viewState.url, 'about:blank');
	assert.ok(BrowserViewUri.getId(firstRequest.resource));
	assert.ok(BrowserViewUri.getId(secondRequest.resource));
});

test('browser contribution registers find actions in the browser toolbar menu', () => {
	const findCommandIds = [
		BrowserViewCommandId.ShowFind,
		BrowserViewCommandId.HideFind,
		BrowserViewCommandId.FindNext,
		BrowserViewCommandId.FindPrevious,
	];

	assert.deepEqual(
		findCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		findCommandIds,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.ShowFind),
		true,
	);
});

test('browser contribution registers favorites action in the browser toolbar menu', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ToggleFavorite)?.id,
		BrowserViewCommandId.ToggleFavorite,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.ToggleFavorite),
		true,
	);
});

test('browser contribution registers history action and max history setting', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ShowHistory)?.id,
		BrowserViewCommandId.ShowHistory,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.ShowHistory),
		true,
	);

	const historySetting = configurationRegistry.getConfigurationProperties()['workbench.browser.maxHistoryEntries'];
	assert.equal(historySetting.default, 200);
	assert.equal(historySetting.scope, ConfigurationScope.APPLICATION);
});

test('browser contribution registers permissions action in the browser toolbar menu', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ManagePermissions)?.id,
		BrowserViewCommandId.ManagePermissions,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === BrowserViewCommandId.ManagePermissions),
		true,
	);
});

test('browser contribution registers chat actions, submenu, and browser chat settings', () => {
	const chatCommandIds = [
		BrowserViewCommandId.AddElementToChat,
		BrowserViewCommandId.AddConsoleLogsToChat,
		BrowserViewCommandId.AddScreenshotToChat,
		BrowserViewCommandId.AddAreaScreenshotToChat,
		BrowserViewCommandId.AddFullPageScreenshotToChat,
	];

	assert.deepEqual(
		chatCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		chatCommandIds,
	);
	assert.deepEqual(
		chatCommandIds.map(id =>
			MenuRegistry.getMenuItems(MenuId.BrowserChatActionsMenu).some(item =>
				isIMenuItem(item) && item.command.id === id)),
		[true, true, true, true, true],
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			'submenu' in item && item.submenu === MenuId.BrowserChatActionsMenu),
		true,
	);

	const properties = configurationRegistry.getConfigurationProperties();
	assert.equal(properties['workbench.browser.enableChatTools'].default, true);
	assert.equal(properties['workbench.browser.experimentalUserTools.enabled'].default, false);
	assert.equal(properties['workbench.browser.sendElementsToChat.attachImages'].default, true);
});

test('browser chat actions insert console logs and screenshot context into chat', async () => {
	const inserts: ChatContextInsert[] = [];
	const screenshotOptions: unknown[] = [];
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
		[IStorageService, createTestStorageService()],
		[IConfigurationService, new ConfigurationService()],
		[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
		[IChatService, createTestChatService(inserts)],
	);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://example.com',
			getConsoleLogs: async () => 'console.log("hello");',
			captureScreenshot: async options => {
				screenshotOptions.push(options);
				return VSBuffer.fromString('jpeg-bytes');
			},
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const commandServiceInstantiationService = setCommandServiceInstantiationService(instantiationService);
	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'chat-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://example.com',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		await commandService.executeCommand(BrowserViewCommandId.AddConsoleLogsToChat, editor);
		await commandService.executeCommand(BrowserViewCommandId.AddScreenshotToChat, editor);
	} finally {
		commandServiceInstantiationService.dispose();
		editor.dispose();
		instantiationService.dispose();
	}

	assert.equal(inserts.length, 2);
	assert.equal(inserts[0]?.title, 'Browser Console Logs');
	assert.match(inserts[0]?.content ?? '', /console\.log\("hello"\);/);
	assert.equal(inserts[1]?.title, 'Browser Screenshot');
	assert.match(inserts[1]?.content ?? '', /Screenshot Size: 10 bytes/);
	assert.deepEqual(screenshotOptions, [{ quality: 80 }]);
});

test('browser contribution registers address bar search setting', () => {
	const searchEngineSetting = configurationRegistry.getConfigurationProperties()[BrowserSearchEngineSettingId];

	assert.equal(searchEngineSetting.default, BrowserSearchEngineId.Bing);
	assert.deepEqual(searchEngineSetting.enum, [
		BROWSER_SEARCH_NONE,
		...BROWSER_SEARCH_ENGINES.map(engine => engine.id),
	]);
	assert.deepEqual(searchEngineSetting.enumItemLabels, [
		'None',
		...BROWSER_SEARCH_ENGINES.map(engine => engine.label),
	]);
});

test('browser contribution registers remote proxy setting', () => {
	const remoteProxySetting = configurationRegistry.getConfigurationProperties()[BrowserRemoteProxyEnabledSettingId];

	assert.equal(remoteProxySetting.type, 'boolean');
	assert.equal(remoteProxySetting.default, true);
	assert.equal(remoteProxySetting.scope, ConfigurationScope.WINDOW);
	assert.deepEqual(remoteProxySetting.tags, ['experimental']);
	assert.deepEqual(remoteProxySetting.experiment, { mode: 'startup' });
});

test('browser contribution registers zoom actions and page zoom setting', () => {
	const zoomCommandIds = [
		'workbench.action.browser.zoomIn',
		'workbench.action.browser.zoomOut',
		'workbench.action.browser.resetZoom',
	];

	assert.deepEqual(
		zoomCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		zoomCommandIds,
	);
	assert.deepEqual(
		zoomCommandIds.map(id =>
			MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
				isIMenuItem(item) && item.command.id === id)),
		[true, true, true],
	);

	const pageZoomSetting = configurationRegistry.getConfigurationProperties()[BrowserPageZoomSettingId];
	assert.equal(pageZoomSetting.default, MATCH_WINDOW_ZOOM_LABEL);
	assert.equal(pageZoomSetting.scope, ConfigurationScope.MACHINE);
	assert.deepEqual(pageZoomSetting.enum?.slice(0, 2), [
		MATCH_WINDOW_ZOOM_LABEL,
		'25%',
	]);
});

test('browser contribution registers emulation actions in browser menus', () => {
	const emulationCommandIds = [
		'workbench.action.browser.toggleDeviceEmulation',
		'workbench.action.browser.toggleMobileEmulation',
		'workbench.action.browser.pickDevicePreset',
		'workbench.action.browser.setUserAgent',
		'workbench.action.browser.resetEmulation',
	];

	assert.deepEqual(
		emulationCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		emulationCommandIds,
	);
	assert.equal(
		MenuRegistry.getMenuItems(MenuId.BrowserActionsToolbar).some(item =>
			isIMenuItem(item) && item.command.id === 'workbench.action.browser.toggleDeviceEmulation'),
		true,
	);
	assert.deepEqual(
		emulationCommandIds.map(id =>
			MenuRegistry.getMenuItems(MenuId.BrowserEmulationToolbar).some(item =>
				isIMenuItem(item) && item.command.id === id)),
		[true, true, true, true, true],
	);
});

test('browser emulation contribution toggles the model device profile', async () => {
	const deviceEmitter = new Emitter<IBrowserDeviceProfile | undefined>();
	let currentDevice: IBrowserDeviceProfile | undefined;
	const deviceWrites: Array<IBrowserDeviceProfile | undefined> = [];
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService()],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => {
			const base = createTestBrowserViewModel(id, state);
			return {
				...base,
				get device() {
					return currentDevice;
				},
				onDidChangeDevice: deviceEmitter.event,
				setDevice: async (device: IBrowserDeviceProfile | undefined) => {
					currentDevice = device;
					deviceWrites.push(device);
					deviceEmitter.fire(device);
				},
			} as IBrowserViewModel;
		},
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'emulation-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://example.com',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		const support = editor.getContribution(BrowserEditorEmulationSupport);
		assert.ok(support);

		support.setVisible(true);
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.notEqual(deviceWrites[0], undefined);
		assert.equal((editor.getElement().querySelector('.browser-emulation-toolbar') as HTMLElement | null)?.style.display, '');

		support.toggleMobile();
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.equal(currentDevice?.mobile, true);

		support.setVisible(false);
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.equal(deviceWrites.at(-1), undefined);
	} finally {
		editor.dispose();
		instantiationService.dispose();
		deviceEmitter.dispose();
	}
});

test('browser editor renders welcome content for an empty browser tab', () => {
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService()],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(instantiationService);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'welcome-browser',
			kind: 'browser',
			title: '',
			url: '',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		const element = editor.getElement();
		assert.equal(element.querySelector('.browser-navbar'), null);
		assert.equal(element.querySelector('.browser-url-container'), null);
		const welcome = element.querySelector('.browser-welcome-container') as HTMLElement | null;
		assert.ok(welcome);
		assert.equal(
			welcome.querySelector('.browser-welcome-title')?.textContent,
			'Browser',
		);
		assert.equal(
			welcome.querySelector('.browser-welcome-subtitle')?.textContent,
			'Enter a URL above to get started.',
		);
		assert.equal(welcome.style.display, '');
	} finally {
		editor.dispose();
		instantiationService.dispose();
	}
});

test('browser editor error contribution renders certificate errors and trusts on proceed', async () => {
	const trustCalls: Array<{ readonly host: string; readonly fingerprint: string }> = [];
	const certError: IBrowserViewCertificateError = {
		host: 'example.com',
		fingerprint: 'AA:BB:CC',
		error: 'ERR_CERT_AUTHORITY_INVALID',
		url: 'https://example.com',
		hasTrustedException: false,
		issuerName: 'Test Issuer',
		subjectName: 'example.com',
		validStart: 1735689600,
		validExpiry: 1767225600,
	};
	const loadError: IBrowserViewLoadError = {
		url: 'https://example.com',
		errorCode: -202,
		errorDescription: 'Certificate authority invalid',
		certificateError: certError,
	};
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService()],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://example.com',
			error: loadError,
			certificateError: certError,
			trustCertificate: async (host, fingerprint) => {
				trustCalls.push({ host, fingerprint });
			},
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'cert-error-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://example.com',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		const element = editor.getElement();

		assert.equal(
			element.querySelector('.browser-error-title')?.textContent,
			'Certificate Error',
		);
		assert.equal(
			element.querySelector('.browser-cert-details-value')?.textContent,
			'ERR_CERT_AUTHORITY_INVALID',
		);
		assert.equal(element.querySelector('.browser-site-info-container'), null);

		const proceedButton = [...element.querySelectorAll('.browser-cert-action button')]
			.find(button => button.textContent === 'Proceed anyway (unsafe)') as HTMLButtonElement | undefined;
		assert.ok(proceedButton);
		proceedButton.click();
		assert.deepEqual(trustCalls, [{ host: 'example.com', fingerprint: 'AA:BB:CC' }]);
	} finally {
		editor.dispose();
		instantiationService.dispose();
	}
});

test('browser editor find contribution searches selected text in the model', async () => {
	const findCalls: Array<{ readonly text: string; readonly matchCase?: boolean; readonly recompute?: boolean }> = [];
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService()],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://example.com',
			getSelectedText: async () => 'needle',
			findInPage: async (text, options) => {
				findCalls.push({
					text,
					matchCase: options?.matchCase,
					recompute: options?.recompute,
				});
			},
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'find-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://example.com',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		await editor.getContribution(BrowserEditorFindContribution)?.showFind();

		assert.deepEqual(findCalls, [{
			text: 'needle',
			matchCase: false,
			recompute: true,
		}]);
		assert.equal(
			editor.getElement().querySelector('.browser-find-widget-wrapper')?.classList.contains('visible'),
			true,
		);
	} finally {
		editor.dispose();
		instantiationService.dispose();
	}
});

test('browser favorites contribution persists the current URL without mounting the upstream indicator', async () => {
	const storageValues = new Map<string, string>();
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService(storageValues)],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://example.com/article',
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'favorite-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://example.com/article',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		editor.getContribution(BrowserFavoritesFeature)?.toggleCurrent();

		assert.equal(
			storageValues.get(`${StorageScope.WORKSPACE}:workbench.browser.favorites`),
			'["https://example.com/article"]',
		);
		assert.equal(editor.getElement().querySelector('.browser-favorite-indicator-container'), null);
	} finally {
		editor.dispose();
		instantiationService.dispose();
	}
});

test('browser history contribution surfaces recent and matching URL suggestions', async () => {
	const history = new BrowserHistoryStore();
	history.add('https://example.com/a?old=1', 'Old A', undefined, true);
	history.add('https://example.com/a?new=1', 'New A', undefined, true);
	history.add('https://example.com/b', 'Example B', undefined, false);
	history.add('https://example.net/c', 'Example C', undefined, true);
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, createTestNotificationService()],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService()],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://current.example',
			history,
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'history-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://current.example',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		const providers = editor.getContribution(BrowserHistoryFeature)?.urlSuggestionProviders ?? [];
		const recents = await providers[0].getSuggestions(editor.input!, '');
		const matching = await providers[1].getSuggestions(editor.input!, 'example');

		assert.deepEqual(
			recents.map(suggestion => suggestion.description ?? suggestion.label),
			[
				'https://example.net/c',
				'https://example.com/a?new=1',
			],
		);
		assert.deepEqual(
			matching.map(suggestion => suggestion.description ?? suggestion.label),
			[
				'https://example.net/c',
				'https://example.com/b',
				'https://example.com/a?new=1',
			],
		);
	} finally {
		editor.dispose();
		instantiationService.dispose();
		history.dispose();
	}
});

test('browser permissions contribution prompts and records permission decisions', async () => {
	const notificationService = new CapturingNotificationService();
	const permissionRequests = new Emitter<IBrowserViewPermissionRequestEvent>();
	const permissionWrites: Array<{ readonly origin: string; readonly grants: readonly IPermissionCategoryState[] }> = [];
	const permissions = new BrowserPermissionStore();
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
		[ILogService, createTestLogService()],
		[IKeybindingService, createTestKeybindingService()],
		[IHoverService, createTestHoverService()],
		[IContextViewService, createTestContextViewService()],
		[INotificationService, notificationService],
		[IQuickInputService, createTestQuickInputService()],
		[IBrowserZoomService, createTestBrowserZoomService()],
			[IStorageService, createTestStorageService()],
			[IConfigurationService, new ConfigurationService()],
			[IContextKeyServiceDecorator, contextKeyService as IContextKeyService],
			[IChatService, createTestChatService([])],
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://example.com',
			permissions,
			onDidRequestPermission: permissionRequests.event,
			setPermissions: async (origin, grants) => {
				permissionWrites.push({ origin, grants });
				permissions.setMany(origin, grants);
			},
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = instantiationService.createInstance(BrowserEditor, {
		labels: {},
		browserTab: {
			id: 'permissions-browser',
			kind: 'browser',
			title: 'Example',
			url: 'https://example.com',
		},
		nativeHost: createTestNativeHostService(),
	} as ConstructorParameters<typeof BrowserEditorType>[0]);

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.ok(editor.getContribution(BrowserPermissionsFeature));

		permissionRequests.fire({
			origin: 'https://example.com',
			category: PermissionCategory.Camera,
		});
		assert.equal(notificationService.prompts.length, 1);

		notificationService.prompts[0].choices[0].run();
		assert.deepEqual(permissionWrites, [{
			origin: 'https://example.com',
			grants: [{ category: PermissionCategory.Camera, state: 'allow' }],
		}]);
		assert.equal(permissions.getDecision('https://example.com', PermissionCategory.Camera), 'allow');
	} finally {
		editor.dispose();
		instantiationService.dispose();
		permissionRequests.dispose();
		permissions.dispose();
	}
});

test('browser editor resolver creates and starts resolving BrowserEditorInput from browser view resources', async () => {
	const editorResolverService = new EditorResolverService();
	const serviceCollection = new ServiceCollection(
		[IThemeService, createTestThemeService()],
		[ITelemetryService, createTestTelemetryService()],
	);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(instantiationService);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const contribution = new BrowserEditorResolverContribution(
		editorResolverService,
		browserViewWorkbenchService,
	);

	try {
		const viewState = {
			url: 'https://example.com',
			title: 'Example',
			favicon: 'https://example.com/favicon.ico',
		};
		const resolved = editorResolverService.resolveEditor({
			resource: BrowserViewUri.forId('browser-a'),
			options: { viewState },
		});

		assert.ok(resolved);
		assert.ok(resolved.editor instanceof BrowserEditorInput);
		assert.equal(resolved.editor.id, 'browser-a');
		assert.equal(resolved.editor.resource.toString(), 'vscode-browser:/browser-a');
		assert.equal(resolved.options?.pinned, true);
		assert.deepEqual(browserViewWorkbenchService.requests, [
			{ id: 'browser-a', state: viewState },
		]);
		assert.deepEqual(browserViewWorkbenchService.resolveCalls, ['browser-a']);

		const model = await resolved.editor.resolve();
		assert.equal(model.url, 'https://example.com');
		assert.equal(resolved.editor.model, model);
		assert.deepEqual(browserViewWorkbenchService.resolveCalls, ['browser-a']);
	} finally {
		contribution.dispose();
		instantiationService.dispose();
	}

	assert.equal(
		editorResolverService.resolveEditor({ resource: BrowserViewUri.forId('browser-a') }),
		undefined,
	);
});
