/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Debugger as ElectronDebugger, Event as ElectronEvent, WebContents } from 'electron';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableMap } from 'cs/base/common/lifecycle';
import type { CDPEvent, CDPTargetInfo, ICDPConnection } from 'cs/platform/browserView/common/cdp/types';

/** CDP transport for one Electron WebContents. */
export class BrowserViewDebugger extends Disposable {
	private readonly sessions = this._register(new DisposableMap<string, DebugSession>());
	private readonly _onSessionCreated = this._register(new Emitter<{ session: ICDPConnection; waitingForDebugger: boolean }>());
	readonly onSessionCreated = this._onSessionCreated.event;

	private readonly targets = new Map<string, CDPTargetInfo>();
	get knownTargets(): ReadonlyMap<string, CDPTargetInfo> {
		return this.targets;
	}

	private readonly _onTargetDiscovered = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetDiscovered = this._onTargetDiscovered.event;

	private readonly _onTargetDestroyed = this._register(new Emitter<string>());
	readonly onTargetDestroyed = this._onTargetDestroyed.event;

	private readonly _onTargetInfoChanged = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetInfoChanged = this._onTargetInfoChanged.event;

	readonly targetId: string;

	private readonly electronDebugger: ElectronDebugger;
	private readonly messageHandler: (event: ElectronEvent, method: string, params: unknown, sessionId?: string) => void;
	private readonly detachHandler: (event: ElectronEvent, reason: string) => void;

	constructor(private readonly webContents: WebContents) {
		super();

		this.electronDebugger = webContents.debugger;
		this.targetId = webContents.getOrCreateDevToolsTargetId();
		this.messageHandler = (_event, method, params, sessionId) => {
			this.routeEvent(method, params, sessionId);
		};
		this.detachHandler = () => this.handleDebuggerDetach();
		this.electronDebugger.on('message', this.messageHandler);
		this.electronDebugger.on('detach', this.detachHandler);
	}

	async attach(): Promise<ICDPConnection> {
		return this.attachToTarget(this.targetId);
	}

	async attachToTarget(targetId: string): Promise<ICDPConnection> {
		this.ensureAttached();
		const result = await this.electronDebugger.sendCommand('Target.attachToTarget', {
			targetId,
			flatten: true,
		}) as { sessionId: string };
		const session = this.sessions.get(result.sessionId);
		if (!session) {
			throw new Error(`Failed to attach to target ${targetId}`);
		}
		return session;
	}

	async getTargetInfo(): Promise<CDPTargetInfo> {
		this.ensureAttached();
		const result = await this.electronDebugger.sendCommand('Target.getTargetInfo') as { targetInfo: CDPTargetInfo };
		return result.targetInfo;
	}

	sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
		if (method === 'Emulation.setDeviceMetricsOverride') {
			return Promise.resolve({});
		}

		this.ensureAttached();
		const result = this.electronDebugger.sendCommand(method, params, sessionId);
		if (method === 'Page.handleJavaScriptDialog') {
			this.webContents.emit('-cancel-dialogs');
		}
		return result;
	}

	private ensureAttached(): void {
		if (this.webContents.isDestroyed()) {
			throw new Error('Cannot attach CDP to a destroyed browser view');
		}
		if (this.electronDebugger.isAttached()) {
			return;
		}

		this.electronDebugger.attach('1.3');
		void this.electronDebugger.sendCommand('Target.setAutoAttach', {
			autoAttach: true,
			flatten: true,
			waitForDebuggerOnStart: false,
		}).catch(() => undefined);
		void this.electronDebugger.sendCommand('Target.setDiscoverTargets', {
			discover: true,
		}).catch(() => undefined);
	}

	private routeEvent(method: string, params: unknown, sessionId?: string): void {
		if (method === 'Target.attachedToTarget') {
			const event = params as { sessionId: string; targetInfo: CDPTargetInfo; waitingForDebugger: boolean };
			this.registerSession(event.sessionId, event.targetInfo, event.waitingForDebugger, sessionId);
		} else if (method === 'Target.detachedFromTarget') {
			const event = params as { sessionId: string };
			this.closeSessionFromDebugger(event.sessionId);
		} else if (method === 'Target.targetDestroyed') {
			const event = params as { targetId: string };
			this.destroyTarget(event.targetId);
		} else if (method === 'Target.targetInfoChanged' && !sessionId) {
			const event = params as { targetInfo: CDPTargetInfo };
			if (event.targetInfo.targetId === this.targetId || this.targets.has(event.targetInfo.targetId)) {
				if (event.targetInfo.targetId !== this.targetId) {
					this.targets.set(event.targetInfo.targetId, event.targetInfo);
				}
				this._onTargetInfoChanged.fire(event.targetInfo);
			}
		}

		const session = sessionId ? this.sessions.get(sessionId) : undefined;
		session?.emitEvent({ method, params, sessionId });
	}

	private destroyTarget(targetId: string): void {
		const sessionIds: string[] = [];
		for (const session of this.sessions.values()) {
			if (session.targetId === targetId) {
				sessionIds.push(session.sessionId);
			}
		}
		for (const sessionId of sessionIds) {
			this.closeSessionFromDebugger(sessionId);
		}

		if (this.targets.delete(targetId)) {
			this._onTargetDestroyed.fire(targetId);
		}
	}

	private registerSession(
		sessionId: string,
		targetInfo: CDPTargetInfo,
		waitingForDebugger: boolean,
		parentSessionId: string | undefined,
	): DebugSession {
		if (!this.targets.has(targetInfo.targetId) && targetInfo.targetId !== this.targetId) {
			this.targets.set(targetInfo.targetId, targetInfo);
			this._onTargetDiscovered.fire(targetInfo);
		}

		const existing = this.sessions.get(sessionId);
		if (existing) {
			return existing;
		}

		const session = new DebugSession(parentSessionId, sessionId, targetInfo.targetId, this);
		this.sessions.set(sessionId, session);
		Event.once(session.onClose)(() => this.sessions.deleteAndLeak(sessionId));
		this._onSessionCreated.fire({ session, waitingForDebugger });
		return session;
	}

	detachSession(sessionId: string): void {
		this.sessions.deleteAndLeak(sessionId);
		if (this.webContents.isDestroyed() || !this.electronDebugger.isAttached()) {
			return;
		}
		void this.electronDebugger.sendCommand('Target.detachFromTarget', { sessionId }).catch(() => undefined);
	}

	private closeSessionFromDebugger(sessionId: string): void {
		const session = this.sessions.deleteAndLeak(sessionId);
		session?.closeFromDebugger();
	}

	private handleDebuggerDetach(): void {
		for (const session of [...this.sessions.values()]) {
			this.sessions.deleteAndLeak(session.sessionId);
			session.closeFromDebugger();
		}
		const targetIds = [...this.targets.keys()];
		this.targets.clear();
		for (const targetId of targetIds) {
			this._onTargetDestroyed.fire(targetId);
		}
	}

	override dispose(): void {
		this.handleDebuggerDetach();
		try {
			this.electronDebugger.removeListener('message', this.messageHandler);
			this.electronDebugger.removeListener('detach', this.detachHandler);
			if (!this.webContents.isDestroyed() && this.electronDebugger.isAttached()) {
				this.electronDebugger.detach();
			}
		} catch {
			// The WebContents may already be destroyed.
		}
		super.dispose();
	}
}

class DebugSession extends Disposable implements ICDPConnection {
	private readonly _onEvent = this._register(new Emitter<CDPEvent>());
	readonly onEvent = this._onEvent.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private disposed = false;

	constructor(
		readonly parentSessionId: string | undefined,
		readonly sessionId: string,
		readonly targetId: string,
		private readonly browserViewDebugger: BrowserViewDebugger,
	) {
		super();
	}

	emitEvent(event: CDPEvent): void {
		this._onEvent.fire(event);
	}

	async sendCommand(method: string, params?: unknown): Promise<unknown> {
		return this.browserViewDebugger.sendCommand(method, params, this.sessionId);
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.browserViewDebugger.detachSession(this.sessionId);
		this._onClose.fire();
		super.dispose();
	}

	closeFromDebugger(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this._onClose.fire();
		super.dispose();
	}
}
