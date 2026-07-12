/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, session } from 'electron';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableMap, DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { IBrowserViewGroup, IBrowserViewGroupViewEvent, IBrowserViewGroupViewRemovalEvent } from 'cs/platform/browserView/common/browserViewGroup';
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
	private destroying = false;
	private readonly activeOperations = new Set<Promise<unknown>>();
	private destroyPromise: Promise<void> | undefined;

	private readonly _onDidAddView = this._register(new Emitter<IBrowserViewGroupViewEvent>());
	readonly onDidAddView = this._onDidAddView.event;

	private readonly _onDidRemoveView = this._register(new Emitter<IBrowserViewGroupViewRemovalEvent>());
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
		await this.runOperation(() => this.debugger.sendMessage(message));
	}

	async addView(viewId: string): Promise<IBrowserViewGroupViewEvent> {
		return this.runOperation(() => this.addViewInternal(viewId));
	}

	private async addViewInternal(viewId: string): Promise<IBrowserViewGroupViewEvent> {
		const existingView = this.views.get(viewId);
		if (existingView) {
			return { viewId, targetId: existingView.debuggerTransport.targetId };
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
			if (this.destroying || this.disposed) {
				return;
			}
			void this.removeView(viewId, 'closed').catch(error => {
				console.error(`Failed to remove closed Browser view ${viewId} from group ${this.id}.`, error);
			});
		}));

		try {
			const targetInfo = await view.debuggerTransport.getTargetInfo();
			if (this.views.get(viewId) !== view) {
				throw new Error(`Browser view ${viewId} closed while it was being added to group ${this.id}`);
			}

			const target = new BrowserViewCDPTarget(
				view.targetId,
				view.context.id,
				view.debuggerTransport,
				targetInfo,
				view.onDidClose,
			);
			this.viewTargets.set(viewId, target);
			await this.debugger.registerTarget(target);
			if (this.views.get(viewId) !== view || this.viewTargets.get(viewId) !== target) {
				throw new Error(`Browser view ${viewId} closed while it was being added to group ${this.id}`);
			}

			for (const childTargetInfo of view.debuggerTransport.knownTargets.values()) {
				await this.registerChildTarget(view, childTargetInfo);
			}
			resources.add(view.debuggerTransport.onTargetDiscovered(info => {
				if (this.destroying || this.disposed) {
					return;
				}
				void this.runOperation(() => this.registerChildTarget(view, info)).catch(error => {
					console.error(`Failed to register child target ${info.targetId} in Browser view group ${this.id}.`, error);
				});
			}));
			resources.add(view.debuggerTransport.onSessionCreated(({ session, waitingForDebugger }) => {
				this.debugger.notifySessionCreated(session, waitingForDebugger);
			}));

			const event = { viewId, targetId: view.debuggerTransport.targetId };
			this._onDidAddView.fire(event);
			return event;
		} catch (error) {
			await this.removeViewInternal(viewId);
			throw error;
		}
	}

	async removeView(viewId: string, reason: IBrowserViewGroupViewRemovalEvent['reason'] = 'detached'): Promise<void> {
		await this.runOperation(() => this.removeViewInternal(viewId, reason));
	}

	private async removeViewInternal(viewId: string, reason: IBrowserViewGroupViewRemovalEvent['reason'] = 'detached'): Promise<void> {
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
		this._onDidRemoveView.fire({ viewId, targetId: view.debuggerTransport.targetId, reason });
	}

	private async registerChildTarget(view: BrowserViewMainTarget, targetInfo: CDPTargetInfo): Promise<void> {
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
		try {
			await this.debugger.registerTarget(target);
			if (
				this.viewResources.get(view.targetId) !== resources
				|| resources.childTargets.get(targetInfo.targetId) !== targetDisposables
			) {
				throw new Error(`Browser view ${view.targetId} closed while child target ${targetInfo.targetId} was being registered`);
			}
		} catch (error) {
			resources.childTargets.deleteAndDispose(targetInfo.targetId);
			throw error;
		}
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
		this.assertActive();
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
		return this.runOperation(async () => {
			const connection = new CDPBrowserProxy(this);
			for (const target of this.viewTargets.values()) {
				await connection.registerTarget(target);
			}
			return connection;
		});
	}

	readonly sessions: ReadonlyMap<string, ICDPConnection> = new Map();
	readonly onSessionCreated = Event.None;
	readonly onClose = this.onDidDestroy;

	notifySessionCreated(): void {
	}

	async createTarget(url: string, browserContextId?: string): Promise<ICDPTarget> {
		return this.runOperation(async () => {
			const resolvedContextId = browserContextId ?? this.defaultContextId;
			if (!resolvedContextId) {
				throw new Error(`Browser view group ${this.id} has no default browser context`);
			}
			const context = this.contexts.get(resolvedContextId)?.context;
			if (!context) {
				throw new Error(`Unknown browser context ${resolvedContextId}`);
			}

			const view = await this.browserViewMainService.createTarget(url, this.owner, context);
			await this.addViewInternal(view.targetId);
			const target = this.viewTargets.get(view.targetId);
			if (!target) {
				throw new Error(`CDP target for browser view ${view.targetId} was not registered`);
			}
			return target;
		});
	}

	async activateTarget(target: ICDPTarget): Promise<void> {
		await this.runOperation(async () => {
			if (!(target instanceof BrowserViewCDPTarget)) {
				throw new Error('Target is not backed by an integrated browser view');
			}
			await this.browserViewMainService.activateTarget(target.viewId);
		});
	}

	async closeTarget(target: ICDPTarget): Promise<boolean> {
		return this.runOperation(async () => {
			if (!(target instanceof BrowserViewCDPTarget)) {
				throw new Error('Target is not backed by an integrated browser view');
			}
			await this.removeViewInternal(target.viewId, 'closed');
			await this.browserViewMainService.destroyBrowserView(target.viewId);
			return true;
		});
	}

	getBrowserContexts(): string[] {
		this.assertActive();
		return [...this.contexts.keys()];
	}

	async createBrowserContext(): Promise<string> {
		return this.runOperation(async () => {
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
		});
	}

	async disposeBrowserContext(browserContextId: string): Promise<void> {
		await this.runOperation(async () => {
			const entry = this.contexts.get(browserContextId);
			if (!entry?.owned) {
				throw new Error(`Browser context ${browserContextId} is not owned by group ${this.id}`);
			}

			const viewIds = [...this.views.values()]
				.filter(view => view.context.id === browserContextId)
				.map(view => view.targetId);
			for (const viewId of viewIds) {
				await this.removeViewInternal(viewId, 'closed');
				await this.browserViewMainService.destroyBrowserView(viewId);
			}
			await entry.context.session.closeAllConnections();
			await entry.context.session.clearStorageData();
			await entry.context.session.clearCache();
			this.contexts.delete(browserContextId);
		});
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const errors: unknown[] = [];
		try {
			this._onDidDestroy.fire();
		} catch (error) {
			errors.push(error);
		}
		this.contexts.clear();
		this.views.clear();
		try {
			super.dispose();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, `Failed to dispose Browser view group ${this.id}.`);
		}
	}

	destroy(): Promise<void> {
		if (!this.destroyPromise) {
			this.destroying = true;
			this.destroyPromise = this.destroyAfterOperations([...this.activeOperations]);
		}
		return this.destroyPromise;
	}

	private async destroyAfterOperations(operations: readonly Promise<unknown>[]): Promise<void> {
		await Promise.allSettled(operations);
		const errors: unknown[] = [];
		for (const viewId of [...this.views.keys()]) {
			try {
				await this.removeViewInternal(viewId);
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			this.dispose();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, `Failed to destroy Browser view group ${this.id}.`);
		}
	}

	private runOperation<T>(operation: () => Promise<T>): Promise<T> {
		this.assertActive();
		const pending = Promise.resolve().then(operation);
		this.activeOperations.add(pending);
		return pending.finally(() => this.activeOperations.delete(pending));
	}

	private assertActive(): void {
		if (this.destroying || this.disposed) {
			throw new Error(`Browser view group ${this.id} is being destroyed.`);
		}
	}
}
