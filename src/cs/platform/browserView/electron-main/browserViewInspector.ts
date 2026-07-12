/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event as ElectronEvent, WebContents, WebFrameMain } from 'electron';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableMap, DisposableStore, MutableDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IElementData, IBrowserViewRect, IBrowserViewTheme } from 'cs/platform/browserView/common/browserView';
import type { ICDPConnection } from 'cs/platform/browserView/common/cdp/types';
import type { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';
import { BrowserViewFrameInspector } from 'cs/platform/browserView/electron-main/browserViewFrameInspector';

/** Coordinates BrowserView inspection across the main frame and child frames. */
export class BrowserViewInspector extends Disposable {
	private readonly _onDidSelectElement = this._register(new Emitter<IElementData>());
	readonly onDidSelectElement: Event<IElementData> = this._onDidSelectElement.event;

	private readonly _onDidChangeElementSelectionActive = this._register(new Emitter<boolean>());
	readonly onDidChangeElementSelectionActive: Event<boolean> = this._onDidChangeElementSelectionActive.event;

	private elementSelectionActive = false;
	get isElementSelectionActive(): boolean {
		return this.elementSelectionActive;
	}

	private readonly activeSelection = this._register(new MutableDisposable<IDisposable>());
	private elementSelectionId = 0;
	private theme: IBrowserViewTheme = {};

	private readonly _onDidPickArea = this._register(new Emitter<IBrowserViewRect | undefined>());
	readonly onDidPickArea: Event<IBrowserViewRect | undefined> = this._onDidPickArea.event;

	private readonly _onDidChangeAreaSelectionActive = this._register(new Emitter<boolean>());
	readonly onDidChangeAreaSelectionActive: Event<boolean> = this._onDidChangeAreaSelectionActive.event;

	private areaSelectionActive = false;
	get isAreaSelectionActive(): boolean {
		return this.areaSelectionActive;
	}

	private readonly activeAreaSelection = this._register(new MutableDisposable<IDisposable>());
	private readonly registry = this._register(new FrameInspectorRegistry());
	private readonly inspectorSubscriptions = this._register(new DisposableMap<BrowserViewFrameInspector, DisposableStore>());
	private readonly initialization: Promise<void>;
	private rootSessionActive = false;

	constructor(
		private readonly webContents: WebContents,
		debuggerTransport: BrowserViewDebugger,
	) {
		super();

		this._register(this.registry.onDidAdopt(inspector => this.onInspectorAdopted(inspector)));

		const onNavigated = () => {
			this.elementSelectionId += 1;
			this.activeSelection.clear();
			this.activeAreaSelection.clear();
		};
		webContents.on('did-navigate', onNavigated);
		this._register({ dispose: () => webContents.removeListener('did-navigate', onNavigated) });

		const onIpcMessage = (event: ElectronEvent, channel: string, ...args: unknown[]) => {
			const senderFrame = (event as ElectronEvent & { senderFrame?: WebFrameMain }).senderFrame;
			switch (channel) {
				case 'vscode:browserView:preloadReady': {
					const frameToken = args[0];
					if (!senderFrame || typeof frameToken !== 'string' || frameToken.length === 0) {
						return;
					}
					senderFrame.postMessage('vscode:browserView:setTheme', this.theme);
					this.registry.notifyFrameReady(senderFrame, frameToken);
					if (senderFrame === webContents.mainFrame && this.activeAreaSelection.value) {
						try {
							senderFrame.postMessage('vscode:browserView:startAreaPicker', undefined);
						} catch {
							this.finishAreaPick(undefined);
						}
					}
					break;
				}
				case 'vscode:browserView:areaPicked': {
					if (senderFrame !== webContents.mainFrame) {
						return;
					}
					const rect = args[0];
					this.finishAreaPick(isValidArea(rect) ? rect : undefined);
					break;
				}
				case 'vscode:browserView:areaPickStopped':
					if (senderFrame === webContents.mainFrame) {
						this.finishAreaPick(undefined);
					}
					break;
			}
		};
		webContents.on('ipc-message', onIpcMessage);
		this._register({ dispose: () => webContents.removeListener('ipc-message', onIpcMessage) });

		this._register(debuggerTransport.onTargetDiscovered(async ({ targetId, type }) => {
			if (type !== 'iframe') {
				return;
			}
			try {
				const connection = await debuggerTransport.attachToTarget(targetId);
				await this.watchSession(connection);
			} catch {
				// The iframe target may close before attachment completes.
			}
		}));

		this.initialization = debuggerTransport.attach().then(async connection => {
			this.rootSessionActive = true;
			this._register(Event.once(connection.onClose)(() => {
				this.rootSessionActive = false;
				this.elementSelectionId += 1;
				this.activeSelection.clear();
				this.activeAreaSelection.clear();
			}));
			try {
				await this.watchSession(connection);
			} catch (error) {
				this.rootSessionActive = false;
				throw error;
			}
		});
		void this.initialization.catch(() => undefined);
	}

	private async watchSession(session: ICDPConnection): Promise<void> {
		this._register(session.onEvent(async event => {
			if (event.method === 'Runtime.executionContextCreated') {
				const context = (event.params as {
					context: {
						uniqueId: string;
						auxData?: { isDefault?: boolean; frameId?: string };
					};
				}).context;
				if (!context?.auxData?.isDefault || !context.auxData.frameId) {
					return;
				}
				try {
					const { result } = await session.sendCommand('Runtime.evaluate', {
						expression: 'window.__vscode_helpers?.getFrameToken?.()',
						returnByValue: true,
						uniqueContextId: context.uniqueId,
					}) as { result: { value?: string } };
					if (result.value) {
						this.registry.notifyContextDiscovered(
							session,
							context.uniqueId,
							context.auxData.frameId,
							result.value,
						);
					}
				} catch {
					// Navigation may destroy the execution context during correlation.
				}
			} else if (event.method === 'Page.frameDetached') {
				const frameId = (event.params as { frameId?: string }).frameId;
				if (frameId) {
					this.registry.disposeByFrameId(frameId);
				}
			} else if (event.method === 'Runtime.executionContextsCleared') {
				this.registry.disposeBySession(session);
			}
		}));
		this._register(Event.once(session.onClose)(() => this.registry.disposeBySession(session)));
		try {
			await Promise.all([
				session.sendCommand('Runtime.enable'),
				session.sendCommand('Page.enable'),
			]);
		} catch (error) {
			this.registry.disposeBySession(session);
			throw error;
		}
	}

	private onInspectorAdopted(inspector: BrowserViewFrameInspector): void {
		const subscriptions = new DisposableStore();
		this.inspectorSubscriptions.set(inspector, subscriptions);
		subscriptions.add(inspector.onDidInspectElement(async ({ data, selectionId }) => {
			if (selectionId !== this.elementSelectionId) {
				return;
			}
			this.activeSelection.clear();
			try {
				const offset = await this.getFrameOffsetInPage(inspector.frame);
				data = offsetElementData(data, offset);
			} catch {
				return;
			}
			if (selectionId === this.elementSelectionId) {
				this._onDidSelectElement.fire(data);
			}
		}));
		subscriptions.add(inspector.onDidStopPicking(() => this.activeSelection.clear()));
		subscriptions.add(inspector.onWillDispose(() => this.inspectorSubscriptions.deleteAndDispose(inspector)));
		if (this.activeSelection.value) {
			void inspector.startInspection(this.elementSelectionId).catch(() => this.activeSelection.clear());
		}
		inspector.setTheme(this.theme);
	}

	setTheme(theme: IBrowserViewTheme): void {
		this.theme = theme;
		for (const inspector of this.registry.inspectors) {
			inspector.setTheme(theme);
		}
	}

	async toggleElementSelection(enabled?: boolean): Promise<void> {
		await this.ensureRootSession();
		const selectionEnabled = this.activeSelection.value !== undefined;
		const nextEnabled = enabled ?? !selectionEnabled;
		if (nextEnabled === selectionEnabled) {
			return;
		}
		if (!nextEnabled) {
			this.elementSelectionId += 1;
			this.activeSelection.clear();
			return;
		}

		this.activeAreaSelection.clear();
		this.elementSelectionId += 1;
		const selectionId = this.elementSelectionId;
		const selection: IDisposable = {
			dispose: () => {
				const wasActive = this.elementSelectionActive;
				this.elementSelectionActive = false;
				if (wasActive) {
					this._onDidChangeElementSelectionActive.fire(false);
				}
				void Promise.all([...this.registry.inspectors].map(inspector => inspector.stopInspection()));
			},
		};
		this.activeSelection.value = selection;

		try {
			await Promise.all([...this.registry.inspectors].map(inspector => inspector.startInspection(selectionId)));
			if (this.activeSelection.value === selection) {
				this.elementSelectionActive = true;
				this._onDidChangeElementSelectionActive.fire(true);
			}
		} catch (error) {
			this.activeSelection.clear();
			throw error;
		}
	}

	async toggleAreaSelection(enabled?: boolean): Promise<void> {
		await this.ensureRootSession();
		const selectionEnabled = this.activeAreaSelection.value !== undefined;
		const nextEnabled = enabled ?? !selectionEnabled;
		if (nextEnabled === selectionEnabled) {
			return;
		}
		if (!nextEnabled) {
			this.activeAreaSelection.clear();
			return;
		}

		this.elementSelectionId += 1;
		this.activeSelection.clear();
		const mainFrame = this.webContents.mainFrame;
		const selection: IDisposable = {
			dispose: () => {
				try {
					if (!mainFrame.isDestroyed()) {
						mainFrame.postMessage('vscode:browserView:stopAreaPicker', undefined);
					}
				} catch {
					// The main frame may be destroyed between the lifecycle check and IPC.
				}
				this.finishAreaPick(undefined);
			},
		};
		this.activeAreaSelection.value = selection;

		try {
			mainFrame.postMessage('vscode:browserView:startAreaPicker', undefined);
			if (this.activeAreaSelection.value === selection) {
				this.areaSelectionActive = true;
				this._onDidChangeAreaSelectionActive.fire(true);
			}
		} catch (error) {
			this.activeAreaSelection.clear();
			throw error;
		}
	}

	private finishAreaPick(rect: IBrowserViewRect | undefined): void {
		if (!this.areaSelectionActive && !this.activeAreaSelection.value) {
			return;
		}
		const wasActive = this.areaSelectionActive;
		this.areaSelectionActive = false;
		this.activeAreaSelection.clearAndLeak();
		this._onDidPickArea.fire(rect);
		if (wasActive) {
			this._onDidChangeAreaSelectionActive.fire(false);
		}
	}

	private async ensureRootSession(): Promise<void> {
		await this.initialization;
		if (!this.rootSessionActive) {
			throw new Error('Browser view inspector CDP session is closed.');
		}
	}

	async getVisualViewportScale(): Promise<number> {
		await this.ensureRootSession();
		const inspector = this.registry.getByFrame(this.webContents.mainFrame);
		if (!inspector) {
			throw new Error('Main browser frame inspector is not ready.');
		}
		return inspector.getVisualViewportScale();
	}

	private async getFrameOffsetInPage(frame: WebFrameMain): Promise<{ x: number; y: number }> {
		const mainFrame = this.webContents.mainFrame;
		let x = 0;
		let y = 0;
		let current = frame;
		while (current !== mainFrame) {
			const parent = current.parent;
			if (!parent) {
				throw new Error('Browser frame has no parent before reaching the main frame.');
			}
			const childInspector = this.registry.getByFrame(current);
			const parentInspector = this.registry.getByFrame(parent);
			if (!childInspector || !parentInspector) {
				throw new Error('Browser frame inspector hierarchy is incomplete.');
			}
			const frameOwner = await parentInspector.connection.sendCommand('DOM.getFrameOwner', {
				frameId: childInspector.frameId,
			}) as { backendNodeId: number };
			const boxModel = await parentInspector.connection.sendCommand('DOM.getBoxModel', {
				backendNodeId: frameOwner.backendNodeId,
			}) as { model: { content: number[] } };
			x += boxModel.model.content[0];
			y += boxModel.model.content[1];
			current = parent;
		}
		return { x, y };
	}
}

interface IPendingContext {
	readonly session: ICDPConnection;
	readonly uniqueContextId: string;
	readonly frameId: string;
}

class FrameInspectorRegistry extends Disposable {
	private readonly _onDidAdopt = this._register(new Emitter<BrowserViewFrameInspector>());
	readonly onDidAdopt: Event<BrowserViewFrameInspector> = this._onDidAdopt.event;

	private readonly pendingFrames = new Map<string, WebFrameMain>();
	private readonly pendingSessions = new Map<string, IPendingContext>();
	private readonly all = new Set<BrowserViewFrameInspector>();
	private readonly byFrame = new WeakMap<WebFrameMain, BrowserViewFrameInspector>();
	private readonly byFrameId = new Map<string, BrowserViewFrameInspector>();
	private readonly bySession = new Map<ICDPConnection, Set<BrowserViewFrameInspector>>();
	private readonly inspectorDisposalSubscriptions = this._register(new DisposableMap<BrowserViewFrameInspector, IDisposable>());

	get inspectors(): Iterable<BrowserViewFrameInspector> {
		return this.all;
	}

	getByFrame(frame: WebFrameMain): BrowserViewFrameInspector | undefined {
		return this.byFrame.get(frame);
	}

	notifyFrameReady(frame: WebFrameMain, token: string): void {
		const pending = this.pendingSessions.get(token);
		if (!pending) {
			this.pendingFrames.set(token, frame);
			return;
		}
		this.pendingSessions.delete(token);
		this.adopt(pending.session, pending.uniqueContextId, pending.frameId, frame);
	}

	notifyContextDiscovered(session: ICDPConnection, uniqueContextId: string, frameId: string, token: string): void {
		const frame = this.pendingFrames.get(token);
		if (!frame) {
			this.pendingSessions.set(token, { session, uniqueContextId, frameId });
			return;
		}
		this.pendingFrames.delete(token);
		this.adopt(session, uniqueContextId, frameId, frame);
	}

	disposeByFrameId(frameId: string): void {
		this.byFrameId.get(frameId)?.dispose();
		for (const [token, pending] of this.pendingSessions) {
			if (pending.frameId === frameId) {
				this.pendingSessions.delete(token);
			}
		}
		for (const [token, frame] of this.pendingFrames) {
			if (frame.detached || frame.isDestroyed()) {
				this.pendingFrames.delete(token);
			}
		}
	}

	disposeBySession(session: ICDPConnection): void {
		const inspectors = this.bySession.get(session);
		if (inspectors) {
			for (const inspector of [...inspectors]) {
				inspector.dispose();
			}
		}
		for (const [token, pending] of this.pendingSessions) {
			if (pending.session === session) {
				this.pendingSessions.delete(token);
			}
		}
	}

	private adopt(
		session: ICDPConnection,
		uniqueContextId: string,
		frameId: string,
		frame: WebFrameMain,
	): void {
		if (frame.detached || frame.isDestroyed()) {
			return;
		}
		const existingInspectors = new Set<BrowserViewFrameInspector>();
		const existingFrameInspector = this.byFrame.get(frame);
		const existingFrameIdInspector = this.byFrameId.get(frameId);
		if (existingFrameInspector) {
			existingInspectors.add(existingFrameInspector);
		}
		if (existingFrameIdInspector) {
			existingInspectors.add(existingFrameIdInspector);
		}
		for (const existingInspector of existingInspectors) {
			existingInspector.dispose();
		}
		const inspector = new BrowserViewFrameInspector(session, frame, uniqueContextId, frameId);
		this.all.add(inspector);
		this.byFrame.set(frame, inspector);
		this.byFrameId.set(frameId, inspector);
		let sessionInspectors = this.bySession.get(session);
		if (!sessionInspectors) {
			sessionInspectors = new Set();
			this.bySession.set(session, sessionInspectors);
		}
		sessionInspectors.add(inspector);
		const disposalSubscription = inspector.onWillDispose(() => {
			this.inspectorDisposalSubscriptions.deleteAndLeak(inspector);
			this.all.delete(inspector);
			if (this.byFrame.get(frame) === inspector) {
				this.byFrame.delete(frame);
			}
			if (this.byFrameId.get(frameId) === inspector) {
				this.byFrameId.delete(frameId);
			}
			const registeredInspectors = this.bySession.get(session);
			registeredInspectors?.delete(inspector);
			if (registeredInspectors?.size === 0) {
				this.bySession.delete(session);
			}
		});
		this.inspectorDisposalSubscriptions.set(inspector, disposalSubscription);
		this._onDidAdopt.fire(inspector);
	}

	override dispose(): void {
		for (const inspector of [...this.all]) {
			inspector.dispose();
		}
		this.pendingFrames.clear();
		this.pendingSessions.clear();
		super.dispose();
	}
}

function isValidArea(value: unknown): value is IBrowserViewRect {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const rect = value as Partial<IBrowserViewRect>;
	return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && Number(rect.width) > 0 && Number(rect.height) > 0;
}

function offsetElementData(data: IElementData, offset: { x: number; y: number }): IElementData {
	if (offset.x === 0 && offset.y === 0) {
		return data;
	}
	return {
		...data,
		bounds: {
			x: data.bounds.x + offset.x,
			y: data.bounds.y + offset.y,
			width: data.bounds.width,
			height: data.bounds.height,
		},
	};
}
