/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { Emitter, Event as BaseEvent } from 'cs/base/common/event';
import { mainWindow } from 'cs/base/browser/window';
import {
	CancellationTokenNone,
	CancellationTokenSource,
	isCancellationError,
} from 'cs/base/common/cancellation';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import { isUUID } from 'cs/base/common/uuid';
import { isIMenuItem, MenuId, MenuRegistry } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, BrowserViewStorageScope, browserZoomDefaultIndex, type IBrowserDeviceProfile, type IBrowserViewCertificateError, type IBrowserViewCreatedEvent, type IBrowserViewLoadError, type IBrowserViewPermissionRequestEvent, type IBrowserViewState } from 'cs/platform/browserView/common/browserView';
import { BrowserHistoryStore } from 'cs/platform/browserView/common/browserHistory';
import { BrowserPermissionStore, PermissionCategory, type IPermissionCategoryState } from 'cs/platform/browserView/common/browserPermissions';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { commandService, commandsRegistry, setCommandServiceInstantiationService } from 'cs/platform/commands/common/commands';
import { IConfigurationService } from 'cs/platform/configuration/common/configuration';
import { ConfigurationService } from 'cs/platform/configuration/common/configurationService';
import {
	BrowserPageZoomSettingId,
	BrowserSearchEngineSettingId,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { configurationRegistry, ConfigurationScope } from 'cs/platform/configuration/common/configurationRegistry';
import { IContextMenuService, IContextViewService, type IContextMenuService as IContextMenuServiceType, type IContextViewService as IContextViewServiceType } from 'cs/platform/contextview/browser/contextView';
import type { IContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { contextKeyService, ContextKeyServiceImpl, IContextKeyService as IContextKeyServiceDecorator } from 'cs/platform/contextkey/common/contextkey';
import type { HoverHandle, HoverInput } from 'cs/base/browser/ui/hover/hover';
import { IHoverService, type IHoverService as IHoverServiceType } from 'cs/platform/hover/browser/hover';
import type { ITunnelProxyInfo } from 'cs/platform/tunnel/common/tunnelProxy';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IKeybindingService, type IKeybindingService as IKeybindingServiceType } from 'cs/platform/keybinding/common/keybinding';
import { KeybindingsRegistry } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { ILogService, type ILogService as ILogServiceType } from 'cs/platform/log/common/log';
import type { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { INativeHostService } from 'cs/platform/native/common/native';
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
} from 'cs/workbench/contrib/browserView/common/browserSearch';
import { IBrowserZoomService, MATCH_WINDOW_ZOOM_LABEL, type IBrowserZoomService as IBrowserZoomServiceType } from 'cs/workbench/contrib/browserView/common/browserZoomService';
import {
	BrowserViewSharingState,
	IBrowserViewWorkbenchService,
	type IBrowserEditorViewState,
	type IBrowserViewContextualFilter,
		type IBrowserViewFilterContext,
		type IBrowserViewModel,
	} from 'cs/workbench/contrib/browserView/common/browserView';
import {
	IEditorService,
	type IEditorService as IEditorServiceType,
} from 'cs/workbench/services/editor/common/editorService';
import { IEditorGroupsService, type IEditorGroupsService as IEditorGroupsServiceType } from 'cs/workbench/services/editor/common/editorGroupsService';
import type { IUntypedEditorInput } from 'cs/workbench/common/editor';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { URI } from 'cs/base/common/uri';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import { locales } from 'language/locales';

const BrowserRemoteProxyEnabledSettingId = 'workbench.browser.enableRemoteProxy';

let cleanupDomEnvironment: (() => void) | null = null;
let cleanupResizeObserver: (() => void) | null = null;
let BrowserEditorResolverContribution: typeof import('cs/workbench/contrib/browserView/electron-browser/browserView.contribution').BrowserEditorResolverContribution;
let BrowserEditor: typeof import('cs/workbench/contrib/browserView/electron-browser/browserEditor').BrowserEditor;
let BrowserEditorFindContribution: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorFindFeature').BrowserEditorFindContribution;
let BrowserFavoritesFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserFavoritesFeature').BrowserFavoritesFeature;
let BrowserHistoryFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature').BrowserHistoryFeature;
let BrowserWelcomeFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserWelcomeFeature').BrowserWelcomeFeature;
let BrowserPermissionsFeature: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserPermissionsFeature').BrowserPermissionsFeature;
let BrowserEditorEmulationSupport: typeof import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorEmulationFeatures').BrowserEditorEmulationSupport;
let BrowserViewWorkbenchService: typeof import('cs/workbench/contrib/browserView/electron-browser/browserViewWorkbenchService').BrowserViewWorkbenchService;

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

function createTestMainProcessService(): IMainProcessService {
	const browserViewChannel: IChannel = {
		async call(command) {
			switch (command) {
				case 'getBrowserViews':
					return [];
				case 'updateWindowConfiguration':
					return undefined;
				default:
					throw new Error(`Unexpected BrowserView channel call '${command}'.`);
			}
		},
		listen(event) {
			if (event !== 'onDidCreateBrowserView') {
				throw new Error(`Unexpected BrowserView channel event '${event}'.`);
			}
			return BaseEvent.None;
		},
	};
	return {
		_serviceBrand: undefined,
		getChannel: () => browserViewChannel,
		registerChannel() {},
	};
}

function createTestHoverHandle(): HoverHandle {
	return {
		show() {},
		hide() {},
		update(_input: HoverInput) {},
		dispose() {},
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
		showContextView: () => ({ close: () => {} }),
		hideContextView() {},
		getContextViewElement: () => document.body,
		layout() {},
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

function createBrowserEditorTestServiceCollection(): ServiceCollection {
	return new ServiceCollection(
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
	);
}

function createTestEditorService(
	openRequests: Array<EditorInput | IUntypedEditorInput>,
): IEditorServiceType {
	return {
		_serviceBrand: undefined,
		activeEditorPane: undefined,
		activeEditor: undefined,
		openEditor: async request => {
			openRequests.push(request);
			if (request instanceof EditorInput) {
				return request;
			}
			if (!('resource' in request) || !request.resource) {
				throw new Error('Test editor request has no resource.');
			}
			return new TestEditorInput(request.resource);
		},
		activateEditor: async () => {},
		closeEditor: async () => false,
		getEditors: () => [],
		getActiveGroupId: () => 'editor-group-main',
	};
}

class TestEditorInput extends EditorInput {
	constructor(readonly resource: URI) {
		super();
	}

	get typeId(): string {
		return 'test.editorInput';
	}
}

async function createTestBrowserEditor(
	serviceCollection: ServiceCollection,
	instantiationService: IInstantiationService,
	browserViewWorkbenchService: TestBrowserViewWorkbenchService,
	options: { id: string; title: string; url: string },
) {
	const { editor, input } = createUnresolvedTestBrowserEditor(
		serviceCollection,
		instantiationService,
		browserViewWorkbenchService,
		options,
	);
	await editor.setInput(input, undefined, {}, CancellationTokenNone);
	return editor;
}

function createUnresolvedTestBrowserEditor(
	serviceCollection: ServiceCollection,
	instantiationService: IInstantiationService,
	browserViewWorkbenchService: TestBrowserViewWorkbenchService,
	options: { id: string; title: string; url: string },
) {
	serviceCollection.set(INativeHostService, createTestNativeHostService());
	serviceCollection.set(IWorkbenchLanguageService, {
		_serviceBrand: undefined,
		detectInitialLocale: () => 'en',
		getLocaleMessages: () => locales.en,
		toDocumentLang: () => 'en',
	});
	serviceCollection.set(IWorkbenchLocaleService, {
		_serviceBrand: undefined,
		getLocale: () => 'en',
		subscribe: () => () => {},
		applyLocale() {},
		updateLocalePreference: async () => {},
		syncDocumentLanguage() {},
		initialize: async () => 'en',
	});
	serviceCollection.set(IContextMenuService, {
		_serviceBrand: undefined,
		showContextMenu() {},
		hideContextMenu() {},
		isVisible: () => false,
		onDidShowContextMenu: () => toDisposable(() => {}),
		onDidHideContextMenu: () => toDisposable(() => {}),
		dispose() {},
	} as IContextMenuServiceType);
	const input = browserViewWorkbenchService.getOrCreateLazy(options.id, options);
	const editor = instantiationService.createInstance(BrowserEditor);
	return { editor, input };
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
		viewState: {
			url: state.url ?? '',
			scrollX: 0,
			scrollY: 0,
		},
		storageScope: BrowserViewStorageScope.Workspace,
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
		onDidChangeViewState: BaseEvent.None,
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
		captureViewState: async () => ({
			url: state.url ?? '',
			scrollX: 0,
			scrollY: 0,
		}),
		restoreViewState: async () => true,
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
		document: undefined,
	};
}

class TestBrowserViewWorkbenchService implements IBrowserViewWorkbenchService {
	declare readonly _serviceBrand: undefined;

	readonly requests: Array<{ readonly id: string; readonly state: IBrowserEditorViewState }> = [];
	readonly resolveCalls: string[] = [];
	readonly browserHistory = new BrowserHistoryStore(Number.MAX_SAFE_INTEGER);
	readonly onDidChangeBrowserViews = BaseEvent.None;
	readonly onDidChangeSharingAvailable = BaseEvent.None;
	readonly isSharingAvailable = false;
	private readonly known = new Map<string, BrowserEditorInput>();

	constructor(
		private readonly instantiationService: IInstantiationService,
		private readonly createModel: (
			id: string,
			state: IBrowserEditorViewState,
		) => IBrowserViewModel | Promise<IBrowserViewModel> = createTestBrowserViewModel,
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
	({ BrowserWelcomeFeature } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserWelcomeFeature'));
	({ BrowserPermissionsFeature } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserPermissionsFeature'));
	({ BrowserEditorEmulationSupport } = await import('cs/workbench/contrib/browserView/electron-browser/features/browserEditorEmulationFeatures'));
	({ BrowserViewWorkbenchService } = await import('cs/workbench/contrib/browserView/electron-browser/browserViewWorkbenchService'));
});

after(() => {
	cleanupResizeObserver?.();
	cleanupDomEnvironment?.();
});

test('browser contribution registers the devtools action', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ToggleDevTools)?.id,
		BrowserViewCommandId.ToggleDevTools,
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
	const dataStorageSetting = configurationRegistry.getConfigurationProperties()['workbench.browser.dataStorage'];
	assert.deepEqual(dataStorageSetting.enum, [
		'default',
		BrowserViewStorageScope.Global,
		BrowserViewStorageScope.Workspace,
		BrowserViewStorageScope.Ephemeral,
	]);
});

test('browser contribution registers navigation commands without mounting the upstream navbar', () => {
	const navigationCommandIds = [
		BrowserViewCommandId.GoBack,
		BrowserViewCommandId.GoForward,
		BrowserViewCommandId.Reload,
		BrowserViewCommandId.HardReload,
		BrowserViewCommandId.FocusUrlInput,
		BrowserViewCommandId.OpenExternal,
	];

	assert.deepEqual(
		navigationCommandIds.map(id => commandsRegistry.getCommand(id)?.id),
		navigationCommandIds,
	);
	assert.equal(document.querySelector('.browser-navbar'), null);
});

test('browser navigation commands target the active Pane and focus the Comet address input', async () => {
	const serviceCollection = createBrowserEditorTestServiceCollection();
	const instantiationService = new InstantiationService(serviceCollection, true);
	const calls = {
		back: 0,
		forward: 0,
		reload: [] as boolean[],
		focusPrimaryInput: 0,
	};
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			canGoBack: true,
			canGoForward: true,
			goBack: async () => { calls.back += 1; },
			goForward: async () => { calls.forward += 1; },
			reload: async hard => { calls.reload.push(Boolean(hard)); },
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const editor = await createTestBrowserEditor(
		serviceCollection,
		instantiationService,
		browserViewWorkbenchService,
		{ id: 'navigation-browser', title: 'Navigation', url: 'https://example.com' },
	);
	serviceCollection.set(IEditorService, {
		...createTestEditorService([]),
		activeEditorPane: editor,
		activeEditor: editor.input,
	});
	serviceCollection.set(IEditorGroupsService, {
		mainPart: {
			activeEditorPane: editor,
			openEditor: async () => {},
			revealEditor() {},
			focusPrimaryInput: () => { calls.focusPrimaryInput += 1; },
		},
	} as unknown as IEditorGroupsServiceType);
	const commandServiceInstantiationService = setCommandServiceInstantiationService(instantiationService);

	try {
		await commandService.executeCommand(BrowserViewCommandId.GoBack);
		await commandService.executeCommand(BrowserViewCommandId.GoForward, editor);
		await commandService.executeCommand(BrowserViewCommandId.Reload, editor);
		await commandService.executeCommand(BrowserViewCommandId.HardReload, editor);
		await commandService.executeCommand(BrowserViewCommandId.FocusUrlInput);
		assert.deepEqual(calls, {
			back: 1,
			forward: 1,
			reload: [false, true],
			focusPrimaryInput: 1,
		});
	} finally {
		commandServiceInstantiationService.dispose();
		editor.dispose();
		instantiationService.dispose();
		browserViewWorkbenchService.browserHistory.dispose();
	}
});

test('browser contribution registers tab management actions in their product menus', () => {
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

test('contextual Browser shortcuts require the active Browser editor to have focus', () => {
	const contextualCommandIds = [
		BrowserViewCommandId.QuickOpen,
		BrowserViewCommandId.NewTab,
		BrowserViewCommandId.ShowFind,
		BrowserViewCommandId.HideFind,
		BrowserViewCommandId.FindNext,
		BrowserViewCommandId.FindPrevious,
		BrowserViewCommandId.ShowHistory,
		BrowserViewCommandId.ToggleFavorite,
		BrowserViewCommandId.ToggleDevTools,
		'workbench.action.browser.zoomIn',
		'workbench.action.browser.zoomOut',
		'workbench.action.browser.resetZoom',
	];
	const keybindingsByCommand = contextualCommandIds.map(commandId =>
		KeybindingsRegistry.getDefaultKeybindings().filter(keybinding => keybinding.command === commandId),
	);
	assert.equal(keybindingsByCommand.every(keybindings => keybindings.length > 0), true);

	const contextKeyService = new ContextKeyServiceImpl();
	contextKeyService.setContextKeyValue('activeEditor', BrowserEditorInput.EDITOR_ID);
	contextKeyService.setContextKeyValue('browserHasUrl', true);
	contextKeyService.setContextKeyValue('browserHasError', false);
	contextKeyService.setContextKeyValue('browserStorageScope', BrowserViewStorageScope.Global);
	contextKeyService.setContextKeyValue('browserFindWidgetVisible', true);
	contextKeyService.setContextKeyValue('browserFindWidgetFocused', true);
	contextKeyService.setContextKeyValue(ActiveEditorFocusedContext.key, false);

	const matchingKeybindingCounts = () => keybindingsByCommand.map(keybindings =>
		keybindings.filter(keybinding => contextKeyService.contextMatchesRules(keybinding.when)).length,
	);
	assert.deepEqual(matchingKeybindingCounts(), contextualCommandIds.map(() => 0));

	contextKeyService.setContextKeyValue(ActiveEditorFocusedContext.key, true);
	assert.deepEqual(matchingKeybindingCounts(), keybindingsByCommand.map(keybindings => keybindings.length));

	contextKeyService.setContextKeyValue('activeEditor', 'workbench.editor.draft');
	assert.deepEqual(matchingKeybindingCounts(), contextualCommandIds.map(() => 0));
});

test('browser tab management commands open through the editor service', async () => {
	const openRequests: Array<EditorInput | IUntypedEditorInput> = [];
	const instantiationService = new InstantiationService(new ServiceCollection(
		[IEditorService, createTestEditorService(openRequests)],
	), true);
	const commandServiceInstantiationService = setCommandServiceInstantiationService(instantiationService);

	try {
		await commandService.executeCommand(BrowserViewCommandId.Open, 'https://example.com/article');
		await commandService.executeCommand(BrowserViewCommandId.NewTab);
	} finally {
		commandServiceInstantiationService.dispose();
		instantiationService.dispose();
	}

	assert.equal(openRequests.length, 2);
	const firstRequest = openRequests[0];
	const secondRequest = openRequests[1];
	assert(firstRequest && !(firstRequest instanceof EditorInput) && 'resource' in firstRequest && firstRequest.resource);
	assert(secondRequest && !(secondRequest instanceof EditorInput) && 'resource' in secondRequest && secondRequest.resource);
	assert.equal(firstRequest.options?.viewState?.url, 'https://example.com/article');
	assert.equal(secondRequest.options?.viewState?.url, 'about:blank');
	assert.equal(isUUID(BrowserViewUri.getId(firstRequest.resource) ?? ''), true);
	assert.equal(isUUID(BrowserViewUri.getId(secondRequest.resource) ?? ''), true);
});

test('browser contribution registers find actions', () => {
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
});

test('browser contribution registers the favorites action', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ToggleFavorite)?.id,
		BrowserViewCommandId.ToggleFavorite,
	);
});

test('browser contribution registers history action and max history setting', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ShowHistory)?.id,
		BrowserViewCommandId.ShowHistory,
	);
	const historySetting = configurationRegistry.getConfigurationProperties()['workbench.browser.maxHistoryEntries'];
	assert.equal(historySetting.default, 200);
	assert.equal(historySetting.scope, ConfigurationScope.APPLICATION);
});

test('browser history service restores, limits, persists, and disables global history', async () => {
	const storageValues = new Map<string, string>();
	storageValues.set(`${StorageScope.APPLICATION}:workbench.browser.history.entries`, JSON.stringify({
		items: [
			{ id: 1, url: 'https://example.com/a', time: 1, title: 'A' },
			{ id: 2, url: 'https://example.com/b', time: 2, title: 'B' },
			{ id: 3, url: 'https://example.com/c', time: 3, title: 'C' },
		],
	}));
	const configurationService = new ConfigurationService();
	await configurationService.updateValue('workbench.browser.maxHistoryEntries', 2);
	const instantiationService = new InstantiationService(new ServiceCollection(), true);
	const service = new BrowserViewWorkbenchService(
		createTestMainProcessService(),
		instantiationService,
		configurationService,
		createTestKeybindingService(),
		createTestThemeService(),
		createTestLogService(),
		createTestStorageService(storageValues),
		{ getEditors: () => [], openEditor: async () => { throw new Error('Unexpected Editor open.'); } } as never,
	);

	try {
		const restored = service.browserHistory.entries.items.map(entry => entry.url);
		service.browserHistory.add('https://example.com/d', 'D');
		const afterAdd = service.browserHistory.entries.items.map(entry => entry.url);
		await configurationService.updateValue('workbench.browser.maxHistoryEntries', 1);
		const afterLimitChange = service.browserHistory.entries.items.map(entry => entry.url);
		await configurationService.updateValue('workbench.browser.maxHistoryEntries', 0);
		service.browserHistory.add('https://example.com/e', 'E');

		assert.deepEqual({
			restored,
			afterAdd,
			afterLimitChange,
			afterDisable: service.browserHistory.entries.items.map(entry => entry.url),
			persistedEntries: storageValues.get(`${StorageScope.APPLICATION}:workbench.browser.history.entries`),
		}, {
			restored: ['https://example.com/b', 'https://example.com/c'],
			afterAdd: ['https://example.com/c', 'https://example.com/d'],
			afterLimitChange: ['https://example.com/d'],
			afterDisable: [],
			persistedEntries: undefined,
		});
	} finally {
		service.dispose();
		instantiationService.dispose();
	}
});

test('BrowserView service subscribes during construction and opens created views in the addressed editor group', async () => {
	const onDidCreateBrowserView = new Emitter<IBrowserViewCreatedEvent>();
	const browserViewChannel: IChannel = {
		async call(command) {
			switch (command) {
				case 'getBrowserViews':
					return [];
				case 'updateWindowConfiguration':
					return undefined;
				default:
					throw new Error(`Unexpected BrowserView channel call '${command}'.`);
			}
		},
		listen(event) {
			if (event === 'onDidCreateBrowserView') {
				return onDidCreateBrowserView.event;
			}
			if (event.startsWith('onDynamicDid')) {
				return BaseEvent.None;
			}
			throw new Error(`Unexpected BrowserView channel event '${event}'.`);
		},
	};
	const serviceCollection = createBrowserEditorTestServiceCollection();
	const instantiationService = new InstantiationService(serviceCollection, true);
	const opened: Array<{
		readonly editor: BrowserEditorInput;
		readonly options: Parameters<IEditorServiceType['openEditor']>[1];
		readonly groupId: string;
	}> = [];
	const editorService: IEditorServiceType = {
		_serviceBrand: undefined,
		activeEditorPane: undefined,
		activeEditor: undefined,
		async openEditor(editor, options) {
			assert.ok(editor instanceof BrowserEditorInput);
			const groupId = options?.groupId ?? 'editor-group-main';
			opened.push({ editor, options, groupId });
			return editor;
		},
		activateEditor: async () => {},
		closeEditor: async () => false,
		getEditors: () => opened.map(({ editor, groupId }) => ({ editor, groupId })),
		getActiveGroupId: () => 'editor-group-main',
	};
	const service = new BrowserViewWorkbenchService(
		{
			_serviceBrand: undefined,
			getChannel: () => browserViewChannel,
			registerChannel() {},
		},
		instantiationService,
		serviceCollection.get(IConfigurationService)!,
		serviceCollection.get(IKeybindingService)!,
		serviceCollection.get(IThemeService)!,
		serviceCollection.get(ILogService)!,
		serviceCollection.get(IStorageService)!,
		editorService,
	);
	serviceCollection.set(IBrowserViewWorkbenchService, service);

	const createState = (url: string, title: string): IBrowserViewState => ({
		url,
		title,
		canGoBack: false,
		canGoForward: false,
		loading: false,
		focused: false,
		visible: false,
		isDevToolsOpen: false,
		lastScreenshot: undefined,
		lastFavicon: undefined,
		lastError: undefined,
		certificateError: undefined,
		storageScope: BrowserViewStorageScope.Global,
		permissions: { origins: {} },
		browserZoomIndex: browserZoomDefaultIndex,
		isElementSelectionActive: false,
		isRemoteSession: false,
		isAreaSelectionActive: false,
		device: undefined,
	});

	try {
		onDidCreateBrowserView.fire({
			info: {
				id: 'created-parent',
				owner: { mainWindowId: mainWindow.vscodeWindowId },
				state: createState('https://example.com/parent', 'Parent'),
			},
			openOptions: { preserveFocus: true, pinned: true },
		});
		onDidCreateBrowserView.fire({
			info: {
				id: 'created-child',
				owner: { mainWindowId: mainWindow.vscodeWindowId },
				state: createState('https://example.com/child', 'Child'),
			},
			openOptions: { background: true, parentViewId: 'created-parent' },
		});
		await Promise.resolve();

		assert.deepEqual(opened.map(({ editor, options, groupId }) => ({
			id: editor.id,
			groupId,
			active: options?.active,
			pinned: options?.editorOptions?.pinned,
		})), [
			{
				id: 'created-parent',
				groupId: 'editor-group-main',
				active: true,
				pinned: true,
			},
			{
				id: 'created-child',
				groupId: 'editor-group-main',
				active: false,
				pinned: undefined,
			},
		]);
	} finally {
		service.dispose();
		onDidCreateBrowserView.dispose();
		instantiationService.dispose();
	}
});

test('browser contribution registers the permissions action', () => {
	assert.equal(
		commandsRegistry.getCommand(BrowserViewCommandId.ManagePermissions)?.id,
		BrowserViewCommandId.ManagePermissions,
	);
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
	assert.deepEqual(
		emulationCommandIds.map(id =>
			MenuRegistry.getMenuItems(MenuId.BrowserEmulationToolbar).some(item =>
				isIMenuItem(item) && item.command.id === id)),
		[true, true, true, true, true],
	);
});

test('browser editor setInput propagates model resolution failure and supports a direct retry', async () => {
	const serviceCollection = createBrowserEditorTestServiceCollection();
	const instantiationService = new InstantiationService(serviceCollection, true);
	let resolveAttempts = 0;
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => {
			resolveAttempts += 1;
			if (resolveAttempts === 1) {
				throw new Error('Browser model resolution failed.');
			}
			return createTestBrowserViewModel(id, state);
		},
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const { editor, input } = createUnresolvedTestBrowserEditor(
		serviceCollection,
		instantiationService,
		browserViewWorkbenchService,
		{ id: 'retry-browser', title: 'Retry', url: 'https://example.com/retry' },
	);

	try {
		await assert.rejects(
			editor.setInput(input, undefined, {}, CancellationTokenNone),
			/Browser model resolution failed/,
		);
		assert.equal(editor.model, undefined);

		await editor.setInput(input, undefined, {}, CancellationTokenNone);
		assert.equal(input.model?.id, 'retry-browser');
		assert.equal(editor.model, input.model);
		assert.equal(resolveAttempts, 2);
	} finally {
		editor.dispose();
		instantiationService.dispose();
	}
});

test('browser editor setInput cancellation cannot attach a stale resolved model', async () => {
	const serviceCollection = createBrowserEditorTestServiceCollection();
	const instantiationService = new InstantiationService(serviceCollection, true);
	let resolveFirstModel!: (model: IBrowserViewModel) => void;
	const firstModelPromise = new Promise<IBrowserViewModel>(resolve => {
		resolveFirstModel = resolve;
	});
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => id === 'first-browser'
			? firstModelPromise
			: createTestBrowserViewModel(id, state),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const { editor, input: firstInput } = createUnresolvedTestBrowserEditor(
		serviceCollection,
		instantiationService,
		browserViewWorkbenchService,
		{ id: 'first-browser', title: 'First', url: 'https://example.com/first' },
	);
	const secondInput = browserViewWorkbenchService.getOrCreateLazy('second-browser', {
		title: 'Second',
		url: 'https://example.com/second',
	});
	const cancellationSource = new CancellationTokenSource();

	try {
		const firstSetInput = editor.setInput(firstInput, undefined, {}, cancellationSource.token);
		await Promise.resolve();
		cancellationSource.cancel();
		await assert.rejects(firstSetInput, error => isCancellationError(error));

		await editor.setInput(secondInput, undefined, {}, CancellationTokenNone);
		resolveFirstModel(createTestBrowserViewModel('first-browser', {
			title: 'First',
			url: 'https://example.com/first',
		}));
		await Promise.resolve();
		await Promise.resolve();

		assert.equal(editor.input, secondInput);
		assert.equal(editor.model?.id, 'second-browser');
	} finally {
		cancellationSource.dispose();
		editor.dispose();
		instantiationService.dispose();
	}
});

test('browser editor publishes BrowserView scroll state through the Pane view-state event', async () => {
	const serviceCollection = createBrowserEditorTestServiceCollection();
	const instantiationService = new InstantiationService(serviceCollection, true);
	const viewStateEmitter = new Emitter<{ url: string; scrollX: number; scrollY: number }>();
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			onDidChangeViewState: viewStateEmitter.event,
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const editor = await createTestBrowserEditor(
		serviceCollection,
		instantiationService,
		browserViewWorkbenchService,
		{ id: 'view-state-browser', title: 'View State', url: 'https://example.com/state' },
	);
	const published: Array<{ url: string; scrollX: number; scrollY: number }> = [];
	const listener = editor.onDidChangeViewState(viewState => published.push(viewState));

	try {
		viewStateEmitter.fire({
			url: 'https://example.com/state',
			scrollX: 12,
			scrollY: 930,
		});
		assert.deepEqual(editor.getViewState(), published[0]);
		assert.deepEqual(published, [{
			url: 'https://example.com/state',
			scrollX: 12,
			scrollY: 930,
		}]);
	} finally {
		listener.dispose();
		editor.dispose();
		instantiationService.dispose();
		viewStateEmitter.dispose();
	}
});

test('browser editor retries unreachable view state when the page reports unchanged scroll coordinates', async () => {
	const serviceCollection = createBrowserEditorTestServiceCollection();
	const instantiationService = new InstantiationService(serviceCollection, true);
	const viewState = {
		url: 'https://example.com/delayed-content',
		scrollX: 0,
		scrollY: 930,
	};
	const viewStateEmitter = new Emitter<typeof viewState>();
	const restoreRequests: Array<typeof viewState> = [];
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			visible: true,
			viewState,
			onDidChangeViewState: viewStateEmitter.event,
			restoreViewState: async restoredViewState => {
				restoreRequests.push(restoredViewState);
				return restoreRequests.length === 2;
			},
		} as IBrowserViewModel),
	);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);
	const editor = await createTestBrowserEditor(
		serviceCollection,
		instantiationService,
		browserViewWorkbenchService,
		{ id: 'delayed-view-state-browser', title: 'Delayed View State', url: viewState.url },
	);

	try {
		const wrapper = editor.getElement().querySelector<HTMLElement>('.browser-container-wrapper');
		assert.ok(wrapper);
		wrapper.getBoundingClientRect = () => ({
			x: 0,
			y: 0,
			width: 800,
			height: 600,
			top: 0,
			right: 800,
			bottom: 600,
			left: 0,
			toJSON: () => ({}),
		});
		editor.restoreViewState(viewState);
		editor.setVisible(true);
		await editor.layoutBrowserContainer();
		await Promise.resolve();
		assert.deepEqual(restoreRequests, [viewState]);

		viewStateEmitter.fire(viewState);
		await Promise.resolve();
		assert.deepEqual(restoreRequests, [viewState, viewState]);

		viewStateEmitter.fire(viewState);
		assert.deepEqual(restoreRequests, [viewState, viewState]);
	} finally {
		editor.dispose();
		instantiationService.dispose();
		viewStateEmitter.dispose();
	}
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

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'emulation-browser',
		title: 'Example',
		url: 'https://example.com',
	});

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

test('browser editor renders welcome content for an empty browser tab', async () => {
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
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(instantiationService);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'welcome-browser',
		title: '',
		url: 'about:blank',
	});

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

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'cert-error-browser',
		title: 'Example',
		url: 'https://example.com',
	});

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

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'find-browser',
		title: 'Example',
		url: 'https://example.com',
	});

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

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'favorite-browser',
		title: 'Example',
		url: 'https://example.com/article',
	});

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

test('browser history contribution exposes and mutates the toolbar panel history', async () => {
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
		);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			url: 'https://current.example',
		} as IBrowserViewModel),
	);
	browserViewWorkbenchService.browserHistory.add('https://example.com/a?old=1', 'Old A', undefined, true);
	browserViewWorkbenchService.browserHistory.add('https://example.com/a?new=1', 'New A', undefined, true);
	browserViewWorkbenchService.browserHistory.add('https://example.com/b', 'Example B');
	browserViewWorkbenchService.browserHistory.add('https://example.net/c', 'Example C', undefined, true);
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'history-browser',
		title: 'Example',
		url: 'https://current.example',
	});

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		const feature = editor.getContribution(BrowserHistoryFeature);
		assert.ok(feature);
		assert.deepEqual(feature.entries.map(entry => entry.url), [
			'https://example.com/a?old=1',
			'https://example.com/a?new=1',
			'https://example.com/b',
			'https://example.net/c',
		]);
		assert.equal(feature.removeEntry(feature.entries[2].id), true);
		assert.deepEqual(feature.entries.map(entry => entry.url), [
			'https://example.com/a?old=1',
			'https://example.com/a?new=1',
			'https://example.net/c',
		]);
	} finally {
		editor.dispose();
		instantiationService.dispose();
		browserViewWorkbenchService.browserHistory.dispose();
	}
});

test('browser welcome contribution renders recents and opens the selected entry', async () => {
	const expectedRecentUrls = [
		...Array.from({ length: 26 }, (_, index) => `https://example.dev/history-${25 - index}`),
		'https://example.net/c',
		'https://example.org/g',
		'https://example.org/f',
		'https://example.org/e',
		'https://example.org/d',
		'https://example.com/a',
		'https://example.com/background',
	];
	const loadedUrls: string[] = [];
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
	);
	const instantiationService = new InstantiationService(serviceCollection, true);
	const browserViewWorkbenchService = new TestBrowserViewWorkbenchService(
		instantiationService,
		(id, state) => ({
			...createTestBrowserViewModel(id, state),
			loadURL: async url => {
				loadedUrls.push(url);
			},
		} as IBrowserViewModel),
	);
	browserViewWorkbenchService.browserHistory.add('https://example.com/background', 'Background');
	browserViewWorkbenchService.browserHistory.add('https://example.com/a', 'Old A');
	browserViewWorkbenchService.browserHistory.add('https://example.org/d', 'Example D');
	browserViewWorkbenchService.browserHistory.add('https://example.org/e', 'Example E');
	browserViewWorkbenchService.browserHistory.add('https://example.org/f', 'Example F');
	browserViewWorkbenchService.browserHistory.add('https://example.org/g', 'Example G');
	browserViewWorkbenchService.browserHistory.add('https://example.net/c', 'Example C', 'https://example.net/missing.ico');
	for (let index = 0; index < 26; index++) {
		browserViewWorkbenchService.browserHistory.add(`https://example.dev/history-${index}`, `History ${index}`);
	}
	serviceCollection.set(IBrowserViewWorkbenchService, browserViewWorkbenchService);

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'welcome-browser',
		title: 'Browser',
		url: '',
	});

	try {
		await editor.input?.resolve();
		await new Promise(resolve => setTimeout(resolve, 0));
		const welcome = editor.getContribution(BrowserWelcomeFeature);
		const recents = welcome?.widgets[0].element.querySelectorAll<HTMLAnchorElement>('.comet-browser-recents-link');

		assert.deepEqual(
			[...recents ?? []].map(recent => recent.getAttribute('href')),
			expectedRecentUrls,
		);
		const favicon = recents?.[26].querySelector('img');
		assert.ok(favicon);
		favicon.dispatchEvent(new window.Event('error'));
		assert.ok(recents?.[26].querySelector('.codicon-globe'));
		const removeButtons = welcome?.widgets[0].element.querySelectorAll<HTMLButtonElement>('.comet-browser-recents-delete .comet-actionbar-action');
		assert.equal(removeButtons?.[1].getAttribute('aria-label'), 'Remove from history');
		removeButtons?.[1].click();
		assert.deepEqual(
			[...welcome?.widgets[0].element.querySelectorAll<HTMLAnchorElement>('.comet-browser-recents-link') ?? []].map(recent => recent.getAttribute('href')),
			expectedRecentUrls.filter(url => url !== 'https://example.dev/history-24'),
		);
		assert.deepEqual(loadedUrls, []);
		welcome?.widgets[0].element.querySelector<HTMLAnchorElement>('.comet-browser-recents-link')?.click();
		assert.deepEqual(loadedUrls, ['https://example.dev/history-25']);

		welcome?.widgets[0].element.querySelector<HTMLButtonElement>('.comet-browser-recents-clear')?.click();
		assert.equal(welcome?.widgets[0].element.querySelector('.comet-browser-recents'), null);
		assert.equal(welcome?.widgets[0].element.querySelector('.browser-welcome-subtitle')?.textContent, 'Enter a URL above to get started.');
	} finally {
		editor.dispose();
		instantiationService.dispose();
		browserViewWorkbenchService.browserHistory.dispose();
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

	const editor = await createTestBrowserEditor(serviceCollection, instantiationService, browserViewWorkbenchService, {
		id: 'permissions-browser',
		title: 'Example',
		url: 'https://example.com',
	});

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

test('browser editor resolver creates and reuses BrowserEditorInput without navigating the BrowserView', async () => {
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
		assert.deepEqual(browserViewWorkbenchService.resolveCalls, []);

		const model = await resolved.editor.resolve();
		assert.equal(model.url, 'https://example.com');
		assert.equal(resolved.editor.model, model);
		assert.deepEqual(browserViewWorkbenchService.resolveCalls, ['browser-a']);

		const reopened = editorResolverService.resolveEditor({
			resource: BrowserViewUri.forId('browser-a'),
			options: {
				viewState: {
					url: 'https://example.com/reopen-must-not-navigate',
				},
			},
		});
		assert.ok(reopened);
		assert.equal(reopened.editor, resolved.editor);
		assert.equal(await reopened.editor.resolve(), model);
		assert.equal(model.url, 'https://example.com');
		assert.equal(browserViewWorkbenchService.getKnownBrowserViews().size, 1);
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
