/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import type { CDPTargetInfo, ICDPConnection, ICDPTarget } from 'cs/platform/browserView/common/cdp/types';
import type { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';

/** A page, frame, or worker target backed by one browser view debugger. */
export class BrowserViewCDPTarget extends Disposable implements ICDPTarget {
	private readonly targetSessions = new Map<string, ICDPConnection>();
	get sessions(): ReadonlyMap<string, ICDPConnection> {
		return this.targetSessions;
	}

	private readonly _onSessionCreated = this._register(new Emitter<{ session: ICDPConnection; waitingForDebugger: boolean }>());
	readonly onSessionCreated = this._onSessionCreated.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private readonly _onTargetInfoChanged = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetInfoChanged = this._onTargetInfoChanged.event;

	private disposed = false;

	constructor(
		readonly viewId: string,
		readonly browserContextId: string,
		readonly debuggerTransport: BrowserViewDebugger,
		private currentTargetInfo: CDPTargetInfo,
		onDidViewClose: Event<void>,
	) {
		super();

		this._register(this.debuggerTransport.onTargetInfoChanged(info => {
			if (info.targetId !== this.currentTargetInfo.targetId) {
				return;
			}
			this.currentTargetInfo = info;
			this._onTargetInfoChanged.fire(this.targetInfo);
		}));
		this._register(this.debuggerTransport.onTargetDestroyed(targetId => {
			if (targetId === this.currentTargetInfo.targetId) {
				this.dispose();
			}
		}));
		this._register(Event.once(onDidViewClose)(() => this.dispose()));
	}

	get targetInfo(): CDPTargetInfo {
		return {
			...this.currentTargetInfo,
			attached: this.targetSessions.size > 0,
			browserContextId: this.browserContextId,
		};
	}

	async attach(): Promise<ICDPConnection> {
		const session = await this.debuggerTransport.attachToTarget(this.currentTargetInfo.targetId);
		this.notifySessionCreated(session, false);
		return session;
	}

	notifySessionCreated(session: ICDPConnection, waitingForDebugger: boolean): void {
		if (session.targetId !== this.currentTargetInfo.targetId) {
			throw new Error(`Session ${session.sessionId} does not belong to target ${this.currentTargetInfo.targetId}`);
		}
		if (this.targetSessions.has(session.sessionId)) {
			return;
		}

		const wasDetached = this.targetSessions.size === 0;
		this.targetSessions.set(session.sessionId, session);
		this._register(Event.once(session.onClose)(() => {
			this.targetSessions.delete(session.sessionId);
			if (this.targetSessions.size === 0) {
				this._onTargetInfoChanged.fire(this.targetInfo);
			}
		}));
		if (wasDetached) {
			this._onTargetInfoChanged.fire(this.targetInfo);
		}
		this._onSessionCreated.fire({ session, waitingForDebugger });
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const session of this.targetSessions.values()) {
			session.dispose();
		}
		this.targetSessions.clear();
		this._onClose.fire();
		super.dispose();
	}
}
