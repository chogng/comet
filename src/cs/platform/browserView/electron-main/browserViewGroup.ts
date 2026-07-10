/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, session } from 'electron';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableMap, DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { IBrowserViewGroup, IBrowserViewGroupViewEvent } from 'cs/platform/browserView/common/browserViewGroup';
import { BrowserViewStorageScope, type IBrowserViewOwner } from 'cs/platform/browserView/common/browserView';
import { CDPBrowserProxy } from 'cs/platform/browserView/common/cdp/proxy';
import type {
	CDPBrowserVersion,
	CDPEvent,
	CDPRequest,
	CDPResponse,
	CDPTargetInfo,
	CDPWindowBounds,
	ICDPBrowserTarget,
	ICDPConnection,
	ICDPTarget,
} from 'cs/platform/browserView/common/cdp/types';
import { BrowserViewCDPTarget } from 'cs/platform/browserView/electron-main/browserViewCDPTarget';
import type {
	BrowserViewMainContext,
	BrowserViewMainTarget,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import { BrowserViewMainService } from 'cs/platform/browserView/electron-main/browserViewMainService';

type BrowserContextEntry = {
	readonly context: BrowserViewMainContext;
	readonly owned: boolean;
};

class BrowserViewGroupViewResources extends Disposable {
	readonly childTargets = this._register(new DisposableMap<string, DisposableStore>());

	add<T extends IDisposable>(disposable: T): T {
		return this._register(disposable);
	}
}

/** A set of browser views exposed through one CDP browser endpoint. */
export class BrowserViewGroup extends Disposable implements ICDPBrowserTarget, IBrowserViewGroup {
	private readonly views = new Map<string, BrowserViewMainTarget>();
	private readonly viewTargets = this._register(new DisposableMap<string, BrowserViewCDPTarget>());
	private readonly viewResources = this._register(new DisposableMap<string, BrowserViewGroupViewResources>());
	private readonly contexts = new Map<string, BrowserContextEntry>();
	private defaultContextId: string | undefined;
	private disposed = false;

	private readonly _onDidAddView = this._register(new Emitter<IBrowserViewGroupViewEvent>());
	readonly onDidAddView = this._onDidAddView.event;

	private readonly _onDidRemoveView = this._register(new Emitter<IBrowserViewGroupViewEvent>());
	readonly onDidRemoveView = this._onDidRemoveView.event;

	private readonly _onDidDestroy = this._register(new Emitter<void>());
	readonly onDidDestroy = this._onDidDestroy.event;

	readonly debugger = this._register(new CDPBrowserProxy(this));

	constructor(
		readonly id: string,
		readonly owner: IBrowserViewOwner,
		private readonly browserViewMainService: BrowserViewMainService,
	) {
		super();
	}

	get onCDPMessage(): Event<CDPResponse | CDPEvent> {
		return this.debugger.onMessage;
	}

	async sendCDPMessage(message: CDPRequest): Promise<void> {
		await this.debugger.sendMessage(message);
	}

	async addView(viewId: string): Promise<void> {
		if (this.views.has(viewId)) {
			return;
		}

		const view = this.browserViewMainService.tryGetTarget(viewId);
		if (!view) {
			throw new Error(`Browser view ${viewId} not found`);
		}

		const existingContext = this.contexts.get(view.context.id);
		if (existingContext && existingContext.context.session !== view.context.session) {
			throw new Error(`Browser context ${view.context.id} is backed by a different Electron session`);
		}

		this.views.set(viewId, view);
		if (!existingContext) {
			this.contexts.set(view.context.id, { context: view.context, owned: false });
		}
		this.defaultContextId ??= view.context.id;

		const resources = new BrowserViewGroupViewResources();
		this.viewResources.set(viewId, resources);
		resources.add(Event.once(view.onDidClose)(() => {
			void this.removeView(viewId);
		}));

		try {
			const targetInfo = await view.debuggerTransport.getTargetInfo();
			if (this.views.get(viewId) !== view) {
				return;
			}

			const target = new BrowserViewCDPTarget(
				view.targetId,
				view.context.id,
				view.debuggerTransport,
				targetInfo,
				view.onDidClose,
			);
			this.viewTargets.set(viewId, target);
			this.debugger.registerTarget(target);

			for (const childTargetInfo of view.debuggerTransport.knownTargets.values()) {
				this.registerChildTarget(view, childTargetInfo);
			}
			resources.add(view.debuggerTransport.onTargetDiscovered(info => {
				this.registerChildTarget(view, info);
			}));
			resources.add(view.debuggerTransport.onSessionCreated(({ session, waitingForDebugger }) => {
				this.debugger.notifySessionCreated(session, waitingForDebugger);
			}));

			this._onDidAddView.fire({ viewId });
		} catch (error) {
			await this.removeView(viewId);
			throw error;
		}
	}

	async removeView(viewId: string): Promise<void> {
		const view = this.views.get(viewId);
		if (!view || !this.views.delete(viewId)) {
			return;
		}

		this.viewResources.deleteAndDispose(viewId);
		this.viewTargets.deleteAndDispose(viewId);
		if (!this.contexts.get(view.context.id)?.owned && !this.hasViewInContext(view.context.id)) {
			this.contexts.delete(view.context.id);
		}
		if (this.defaultContextId === view.context.id && !this.hasViewInContext(view.context.id)) {
			this.defaultContextId = this.views.values().next().value?.context.id;
		}
		this._onDidRemoveView.fire({ viewId });
	}

	private registerChildTarget(view: BrowserViewMainTarget, targetInfo: CDPTargetInfo): void {
		if (targetInfo.targetId === view.debuggerTransport.targetId) {
			return;
		}
		const resources = this.viewResources.get(view.targetId);
		if (!resources || resources.childTargets.has(targetInfo.targetId)) {
			return;
		}
		const target = new BrowserViewCDPTarget(
			view.targetId,
			view.context.id,
			view.debuggerTransport,
			targetInfo,
			view.onDidClose,
		);
		const targetDisposables = new DisposableStore();
		targetDisposables.add(target);
		targetDisposables.add(Event.once(target.onClose)(() => {
			resources.childTargets.deleteAndDispose(targetInfo.targetId);
		}));
		resources.childTargets.set(targetInfo.targetId, targetDisposables);
		this.debugger.registerTarget(target);
	}

	private hasViewInContext(browserContextId: string): boolean {
		for (const view of this.views.values()) {
			if (view.context.id === browserContextId) {
				return true;
			}
		}
		return false;
	}

	private readonly _onTargetInfoChanged = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetInfoChanged = this._onTargetInfoChanged.event;

	get targetInfo(): CDPTargetInfo {
		return {
			targetId: this.id,
			type: 'browser',
			title: this.getVersion().product,
			url: '',
			attached: true,
			canAccessOpener: false,
		};
	}

	getVersion(): CDPBrowserVersion {
		return {
			protocolVersion: '1.3',
			product: `${app.getName()}/${app.getVersion()}`,
			revision: process.versions.chrome,
			userAgent: `Electron/${process.versions.electron}`,
			jsVersion: process.versions.v8,
		};
	}

	getWindowForTarget(target: ICDPTarget): { windowId: number; bounds: CDPWindowBounds } {
		if (!(target instanceof BrowserViewCDPTarget)) {
			throw new Error('Target is not backed by an integrated browser view');
		}
		const view = this.views.get(target.viewId);
		if (!view) {
			throw new Error(`Browser view ${target.viewId} not found in group ${this.id}`);
		}
		const bounds = view.view.getBounds();
		return {
			windowId: view.owner.mainWindowId,
			bounds: {
				left: bounds.x,
				top: bounds.y,
				width: bounds.width,
				height: bounds.height,
				windowState: 'normal',
			},
		};
	}

	async attach(): Promise<ICDPConnection> {
		const connection = new CDPBrowserProxy(this);
		for (const target of this.viewTargets.values()) {
			connection.registerTarget(target);
		}
		return connection;
	}

	readonly sessions: ReadonlyMap<string, ICDPConnection> = new Map();
	readonly onSessionCreated = Event.None;
	readonly onClose = this.onDidDestroy;

	notifySessionCreated(): void {
	}

	async createTarget(url: string, browserContextId?: string): Promise<ICDPTarget> {
		const resolvedContextId = browserContextId ?? this.defaultContextId;
		if (!resolvedContextId) {
			throw new Error(`Browser view group ${this.id} has no default browser context`);
		}
		const context = this.contexts.get(resolvedContextId)?.context;
		if (!context) {
			throw new Error(`Unknown browser context ${resolvedContextId}`);
		}

		const view = await this.browserViewMainService.createTarget(url, this.owner, context);
		await this.addView(view.targetId);
		const target = this.viewTargets.get(view.targetId);
		if (!target) {
			throw new Error(`CDP target for browser view ${view.targetId} was not registered`);
		}
		return target;
	}

	async activateTarget(target: ICDPTarget): Promise<void> {
		if (!(target instanceof BrowserViewCDPTarget)) {
			throw new Error('Target is not backed by an integrated browser view');
		}
		await this.browserViewMainService.activateTarget(target.viewId);
	}

	async closeTarget(target: ICDPTarget): Promise<boolean> {
		if (!(target instanceof BrowserViewCDPTarget)) {
			throw new Error('Target is not backed by an integrated browser view');
		}
		await this.removeView(target.viewId);
		await this.browserViewMainService.destroyBrowserView(target.viewId);
		return true;
	}

	getBrowserContexts(): string[] {
		return [...this.contexts.keys()];
	}

	async createBrowserContext(): Promise<string> {
		const id = generateUuid();
		this.contexts.set(id, {
			context: {
				id,
				session: session.fromPartition(`comet-cdp-${id}`),
				storageScope: BrowserViewStorageScope.Ephemeral,
			},
			owned: true,
		});
		return id;
	}

	async disposeBrowserContext(browserContextId: string): Promise<void> {
		const entry = this.contexts.get(browserContextId);
		if (!entry?.owned) {
			throw new Error(`Browser context ${browserContextId} is not owned by group ${this.id}`);
		}

		const viewIds = [...this.views.values()]
			.filter(view => view.context.id === browserContextId)
			.map(view => view.targetId);
		for (const viewId of viewIds) {
			await this.removeView(viewId);
			await this.browserViewMainService.destroyBrowserView(viewId);
		}
		await entry.context.session.closeAllConnections();
		await entry.context.session.clearStorageData();
		await entry.context.session.clearCache();
		this.contexts.delete(browserContextId);
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this._onDidDestroy.fire();
		this.contexts.clear();
		this.views.clear();
		super.dispose();
	}
}
