/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from 'cs/base/browser/window';
import { BrowserMaxHistoryEntriesSettingId } from 'cs/base/parts/sandbox/common/browserSettings';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import {
	BrowserHistoryStore,
	type ISerializedBrowserFaviconsSnapshot,
	type ISerializedBrowserHistoryEntriesSnapshot,
} from 'cs/platform/browserView/common/browserHistory';
import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import {
	BrowserViewCommandId,
	BrowserViewStorageScope,
	IBrowserViewOpenOptions,
	IBrowserViewOwner,
	IBrowserViewService,
	IBrowserViewState,
	IBrowserViewWindowConfiguration,
	ipcBrowserViewChannelName,
} from 'cs/platform/browserView/common/browserView';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { IKeybindingService } from 'cs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'cs/platform/configuration/common/configuration';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ILogService } from 'cs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import { IThemeService } from 'cs/platform/theme/common/themeService';
import { ITunnelProxyInfo } from 'cs/platform/tunnel/common/tunnelProxy';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import {
	BrowserViewModel,
	IBrowserEditorViewState,
	IBrowserViewContextualFilter,
	IBrowserViewFilterContext,
	IBrowserViewModel,
	IBrowserViewOpenHandler,
	IBrowserViewWorkbenchService,
} from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserHistoryTracker } from 'cs/workbench/contrib/browserView/electron-browser/browserHistoryTracker';
import { PreferredGroup } from 'cs/workbench/services/editor/common/editorService';

export const BrowserNewTabPlacementSettingId = 'workbench.browser.newTabPlacement';
export const BrowserRemoteProxyEnabledSettingId = 'workbench.browser.enableRemoteProxy';

const BrowserHistoryEntriesStorageKey = 'workbench.browser.history.entries';
const BrowserHistoryFaviconsStorageKey = 'workbench.browser.history.favicons';

export type BrowserNewTabPlacement = 'activeGroup' | 'sideGroup' | 'window';

const browserViewContextMenuCommands = [
	BrowserViewCommandId.GoBack,
	BrowserViewCommandId.GoForward,
	BrowserViewCommandId.Reload,
] as const;

export class BrowserViewWorkbenchService extends Disposable implements IBrowserViewWorkbenchService {
	declare readonly _serviceBrand: undefined;

	private browserViewService: IBrowserViewService | undefined;
	readonly browserHistory: BrowserHistoryStore;
	private readonly known = new Map<string, BrowserEditorInput>();
	private readonly contextualFilters = new Set<IBrowserViewContextualFilter>();
	private readonly openHandlers = new Set<IBrowserViewOpenHandler>();
	private readonly mainWindowId = mainWindow.vscodeWindowId;
	private readonly _onDidChangeBrowserViews = this._register(new Emitter<void>());
	private readonly _onDidChangeSharingAvailable = this._register(new Emitter<boolean>());
	private remoteProxyInfo: ITunnelProxyInfo | undefined;
	private _isSharingAvailable = false;

	readonly onDidChangeBrowserViews: Event<void> = this._onDidChangeBrowserViews.event;
	readonly onDidChangeSharingAvailable: Event<boolean> = this._onDidChangeSharingAvailable.event;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IThemeService private readonly themeService: IThemeService,
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.browserHistory = this._register(new BrowserHistoryStore(
			this.configurationService.getValue<number>(BrowserMaxHistoryEntriesSettingId),
		));
		this.restoreBrowserHistory();
		this._register(this.browserHistory.entries.onDidChange(() => this.persistBrowserHistoryEntries()));
		this._register(this.browserHistory.favicons.onDidChange(() => this.persistBrowserHistoryFavicons()));
		this.persistBrowserHistoryEntries();
		this.persistBrowserHistoryFavicons();

		this._register(this.keybindingService.onDidUpdateKeybindings(() => {
			if (this.browserViewService) {
				this.updateWindowConfiguration();
			}
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(BrowserMaxHistoryEntriesSettingId)) {
				this.browserHistory.setMaxEntries(
					this.configurationService.getValue<number>(BrowserMaxHistoryEntriesSettingId),
				);
			}
			if (this.browserViewService && e.affectsConfiguration(BrowserRemoteProxyEnabledSettingId)) {
				this.updateWindowConfiguration();
			}
		}));
	}

	get isSharingAvailable(): boolean {
		return this._isSharingAvailable;
	}

	willUseRemoteProxy(): boolean {
		return this.configurationService.getValue<boolean>(BrowserRemoteProxyEnabledSettingId) === true;
	}

	setRemoteProxyInfo(info: ITunnelProxyInfo | undefined): void {
		this.remoteProxyInfo = info;
		if (this.browserViewService) {
			this.updateWindowConfiguration();
		}
	}

	getKnownBrowserViews(): Map<string, BrowserEditorInput> {
		return this.known;
	}

	registerContextualFilter(filter: IBrowserViewContextualFilter) {
		this.contextualFilters.add(filter);
		const listener = filter.onDidChange?.(() => this._onDidChangeBrowserViews.fire());
		this._onDidChangeBrowserViews.fire();
		return toDisposable(() => {
			this.contextualFilters.delete(filter);
			listener?.dispose();
			this._onDidChangeBrowserViews.fire();
		});
	}

	getContextualBrowserViews(context: IBrowserViewFilterContext = {}): Map<string, BrowserEditorInput> {
		if (this.contextualFilters.size === 0) {
			return this.known;
		}

		const result = new Map<string, BrowserEditorInput>();
		for (const [id, input] of this.known) {
			if ([...this.contextualFilters].every(filter => filter.include(input, context))) {
				result.set(id, input);
			}
		}
		return result;
	}

	async getPreferredGroup(preferredGroup?: PreferredGroup): Promise<PreferredGroup | undefined> {
		const placement = this.configurationService.getValue<BrowserNewTabPlacement>(BrowserNewTabPlacementSettingId);
		if (preferredGroup === undefined && placement === 'sideGroup') {
			return 'side';
		}
		if (preferredGroup === undefined && placement === 'window') {
			return 'auxiliary';
		}
		return preferredGroup;
	}

	registerOpenHandler(handler: IBrowserViewOpenHandler) {
		this.openHandlers.add(handler);
		return toDisposable(() => {
			this.openHandlers.delete(handler);
		});
	}

	getOrCreateLazy(id: string, initialState: IBrowserEditorViewState = {}, model?: IBrowserViewModel): BrowserEditorInput {
		const browserViewService = this.getBrowserViewService();
		let input = this.known.get(id);
		if (!input) {
			input = this.instantiationService.createInstance(BrowserEditorInput, { id, ...initialState }, async () => {
				const state = await browserViewService.getOrCreateBrowserView(id, {
					owner: this.getDefaultOwner(),
					sessionOptions: {
						scope: BrowserViewStorageScope.Global,
					},
					presentation: 'editor',
					initialState: {
						url: initialState.url,
						title: initialState.title,
						lastFavicon: initialState.favicon,
					},
				});
				return this.createModel(id, this.getDefaultOwner(), state);
			});
			this._register(input.onWillDispose(() => {
				this.known.delete(id);
				this._onDidChangeBrowserViews.fire();
			}));
			this.known.set(id, input);
			this._onDidChangeBrowserViews.fire();
		}
		if (model) {
			input.model = model;
		}
		return input;
	}

	async clearGlobalStorage(): Promise<void> {
		this.browserHistory.clear();
		await this.getBrowserViewService().clearGlobalStorage();
	}

	async clearWorkspaceStorage(): Promise<void> {
		throw new Error('Workspace-scoped browser storage is not supported by this Comet workbench.');
	}

	shouldOpenEditor(input: BrowserEditorInput, owner: IBrowserViewOwner, openOptions: IBrowserViewOpenOptions): boolean {
		return [...this.openHandlers].every(handler => handler.shouldOpenEditor(input, owner, openOptions));
	}

	private getDefaultOwner(): IBrowserViewOwner {
		return { mainWindowId: this.mainWindowId };
	}

	private async initializeExistingViews(): Promise<void> {
		try {
			const views = await this.getBrowserViewService().getBrowserViews(this.mainWindowId);
			for (const info of views) {
				this.createModel(info.id, info.owner, info.state);
			}
		} catch (error) {
			this.logService.error('[BrowserViewWorkbenchService] Failed to initialize existing browser views.', error);
		}
	}

	private createModel(id: string, owner: IBrowserViewOwner, state: IBrowserViewState): IBrowserViewModel {
		const existing = this.known.get(id)?.model;
		if (existing) {
			return existing;
		}

		const model = this.instantiationService.createInstance(
			new SyncDescriptor(BrowserViewModel, [id, owner, state, this.getBrowserViewService()]),
		);
		this.trackBrowserHistory(model);
		this.getOrCreateLazy(id, {
			url: state.url,
			title: state.title,
			favicon: state.lastFavicon,
		}, model);
		this._onDidChangeBrowserViews.fire();
		return model;
	}

	private trackBrowserHistory(model: IBrowserViewModel): void {
		if (model.storageScope === BrowserViewStorageScope.Ephemeral) {
			return;
		}
		const store = this._register(new DisposableStore());
		store.add(new BrowserHistoryTracker(model, this.browserHistory));
		store.add(model.onWillDispose(() => store.dispose()));
	}

	private restoreBrowserHistory(): void {
		this.browserHistory.favicons.hydrate(
			parseBrowserHistorySnapshot<ISerializedBrowserFaviconsSnapshot>(
				this.storageService.get(BrowserHistoryFaviconsStorageKey, StorageScope.APPLICATION),
			),
		);
		this.browserHistory.entries.hydrate(
			parseBrowserHistorySnapshot<ISerializedBrowserHistoryEntriesSnapshot>(
				this.storageService.get(BrowserHistoryEntriesStorageKey, StorageScope.APPLICATION),
			),
		);
	}

	private persistBrowserHistoryEntries(): void {
		const snapshot = this.browserHistory.entries.serialize();
		if (snapshot.items.length === 0) {
			this.storageService.remove(BrowserHistoryEntriesStorageKey, StorageScope.APPLICATION);
			return;
		}
		this.storageService.store(
			BrowserHistoryEntriesStorageKey,
			JSON.stringify(snapshot),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}

	private persistBrowserHistoryFavicons(): void {
		const snapshot = this.browserHistory.favicons.serialize();
		if (Object.keys(snapshot.map).length === 0) {
			this.storageService.remove(BrowserHistoryFaviconsStorageKey, StorageScope.APPLICATION);
			return;
		}
		this.storageService.store(
			BrowserHistoryFaviconsStorageKey,
			JSON.stringify(snapshot),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}

	private getBrowserViewService(): IBrowserViewService {
		if (!this.browserViewService) {
			const channel = this.mainProcessService.getChannel(ipcBrowserViewChannelName);
			const browserViewService = ProxyChannel.toService<IBrowserViewService>(channel);
			this.browserViewService = browserViewService;

			this.updateWindowConfiguration();
			void this.initializeExistingViews();
			this._register(browserViewService.onDidCreateBrowserView(event => {
				if (event.info.owner.mainWindowId !== this.mainWindowId) {
					return;
				}

				const model = this.createModel(event.info.id, event.info.owner, event.info.state);
				const input = this.getOrCreateLazy(event.info.id, {
					url: model.url,
					title: model.title,
					favicon: model.favicon,
				}, model);

				if (event.openOptions) {
					this.shouldOpenEditor(input, event.info.owner, event.openOptions);
				}
			}));
		}

		return this.browserViewService;
	}

	private updateWindowConfiguration(): void {
		const browserViewService = this.browserViewService;
		if (!browserViewService) {
			return;
		}

		const nextSharingAvailable = false;
		if (this._isSharingAvailable !== nextSharingAvailable) {
			this._isSharingAvailable = nextSharingAvailable;
			this._onDidChangeSharingAvailable.fire(nextSharingAvailable);
		}

		const config: IBrowserViewWindowConfiguration = {
			theme: this.getTheme(),
			keybindings: this.getKeybindings(),
			aiFeaturesDisabled: true,
			proxyInfo: this.remoteProxyInfo,
			trustedFileRoots: [],
			trustAllFiles: true,
		};
		void browserViewService.updateWindowConfiguration(this.mainWindowId, config);
	}

	private getKeybindings(): { [commandId: string]: string } {
		const keybindings: { [commandId: string]: string } = Object.create(null);
		for (const commandId of browserViewContextMenuCommands) {
			const accelerator = this.keybindingService.lookupKeybinding(commandId)?.getElectronAccelerator();
			if (accelerator) {
				keybindings[commandId] = accelerator;
			}
		}
		return keybindings;
	}

	private getTheme() {
		const theme = this.themeService.getColorTheme();
		return {
			focusBorder: theme.getColor('focusBorder')?.toString(),
			buttonBackground: theme.getColor('button.background')?.toString(),
			buttonForeground: theme.getColor('button.foreground')?.toString(),
		};
	}
}

function parseBrowserHistorySnapshot<T>(raw: string | undefined): T | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as T;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}
