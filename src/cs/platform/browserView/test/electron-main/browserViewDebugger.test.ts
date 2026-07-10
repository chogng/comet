/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { WebContents } from 'electron';
import { Emitter } from 'cs/base/common/event';
import { BrowserViewCDPTarget } from 'cs/platform/browserView/electron-main/browserViewCDPTarget';
import { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';

type RecordedCommand = {
	readonly method: string;
	readonly params: unknown;
	readonly sessionId?: string;
};

class TestElectronDebugger extends EventEmitter {
	readonly commands: RecordedCommand[] = [];
	private attached = false;
	private sessionCounter = 0;

	attach(): void {
		this.attached = true;
	}

	detach(): void {
		this.attached = false;
		this.emit('detach', {}, 'target closed');
	}

	isAttached(): boolean {
		return this.attached;
	}

	async sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
		this.commands.push({ method, params, sessionId });
		if (method === 'Target.getTargetInfo') {
			return {
				targetInfo: {
					targetId: 'root-target',
					type: 'page',
					title: 'Example',
					url: 'https://example.com',
					attached: false,
					canAccessOpener: false,
				},
			};
		}
		if (method === 'Target.attachToTarget') {
			this.sessionCounter += 1;
			const attachedSessionId = `electron-session-${this.sessionCounter}`;
			const targetId = (params as { targetId: string }).targetId;
			this.emit('message', {}, 'Target.attachedToTarget', {
				sessionId: attachedSessionId,
				targetInfo: {
					targetId,
					type: 'page',
					title: 'Example',
					url: 'https://example.com',
					attached: true,
					canAccessOpener: false,
				},
				waitingForDebugger: false,
			}, undefined);
			return { sessionId: attachedSessionId };
		}
		return { acknowledged: true };
	}
}

function createDebugger(): {
	readonly browserViewDebugger: BrowserViewDebugger;
	readonly electronDebugger: TestElectronDebugger;
} {
	const electronDebugger = new TestElectronDebugger();
	const webContents = {
		debugger: electronDebugger,
		emit: () => false,
		getOrCreateDevToolsTargetId: () => 'root-target',
		isDestroyed: () => false,
	} as unknown as WebContents;
	return {
		browserViewDebugger: new BrowserViewDebugger(webContents),
		electronDebugger,
	};
}

test('BrowserViewDebugger attaches Electron sessions and detaches disposed CDP sessions', async () => {
	const { browserViewDebugger, electronDebugger } = createDebugger();

	try {
		const targetInfo = await browserViewDebugger.getTargetInfo();
		const session = await browserViewDebugger.attach();
		await session.sendCommand('Runtime.evaluate', { expression: 'document.title' });
		let closed = false;
		session.onClose(() => {
			closed = true;
		});
		session.dispose();

		assert.equal(targetInfo.targetId, 'root-target');
		assert.equal(closed, true);
		assert.equal(electronDebugger.commands.some(command =>
			command.method === 'Runtime.evaluate' && command.sessionId === session.sessionId
		), true);
		assert.equal(electronDebugger.commands.some(command =>
			command.method === 'Target.detachFromTarget' &&
			(command.params as { sessionId?: string }).sessionId === session.sessionId
		), true);
	} finally {
		browserViewDebugger.dispose();
	}
});

test('BrowserViewDebugger closes active sessions when Electron detaches', async () => {
	const { browserViewDebugger, electronDebugger } = createDebugger();

	try {
		const session = await browserViewDebugger.attach();
		let closed = false;
		session.onClose(() => {
			closed = true;
		});
		electronDebugger.detach();

		assert.equal(closed, true);
	} finally {
		browserViewDebugger.dispose();
	}
});

test('BrowserViewDebugger routes nested target lifecycle and session events', async () => {
	const { browserViewDebugger, electronDebugger } = createDebugger();
	const discoveredTargets: string[] = [];
	const changedTargets: string[] = [];
	const destroyedTargets: string[] = [];
	const childEvents: string[] = [];
	let childSessionId: string | undefined;

	try {
		browserViewDebugger.onTargetDiscovered(info => discoveredTargets.push(info.targetId));
		browserViewDebugger.onTargetInfoChanged(info => changedTargets.push(info.targetId));
		browserViewDebugger.onTargetDestroyed(targetId => destroyedTargets.push(targetId));
		browserViewDebugger.onSessionCreated(({ session }) => {
			if (session.targetId !== 'worker-target') {
				return;
			}
			childSessionId = session.sessionId;
			session.onEvent(event => childEvents.push(event.method));
		});

		const parentSession = await browserViewDebugger.attach();
		electronDebugger.emit('message', {}, 'Target.attachedToTarget', {
			sessionId: 'worker-session',
			targetInfo: {
				targetId: 'worker-target',
				type: 'worker',
				title: 'Worker',
				url: 'https://example.com/worker.js',
				attached: true,
				canAccessOpener: false,
			},
			waitingForDebugger: false,
		}, parentSession.sessionId);
		electronDebugger.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log' }, 'worker-session');
		electronDebugger.emit('message', {}, 'Target.targetInfoChanged', {
			targetInfo: {
				targetId: 'worker-target',
				type: 'worker',
				title: 'Updated Worker',
				url: 'https://example.com/worker.js',
				attached: true,
				canAccessOpener: false,
			},
		}, undefined);
		electronDebugger.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'worker-session' }, undefined);
		electronDebugger.emit('message', {}, 'Target.targetDestroyed', { targetId: 'worker-target' }, undefined);

		assert.equal(childSessionId, 'worker-session');
		assert.deepEqual(discoveredTargets, ['worker-target']);
		assert.deepEqual(changedTargets, ['worker-target']);
		assert.deepEqual(destroyedTargets, ['worker-target']);
		assert.deepEqual(childEvents, ['Runtime.consoleAPICalled']);
		assert.equal(browserViewDebugger.knownTargets.has('worker-target'), false);
	} finally {
		browserViewDebugger.dispose();
	}
});

test('BrowserViewDebugger applies intercepted device metrics and rejects unhandled overrides', async () => {
	const { browserViewDebugger, electronDebugger } = createDebugger();
	let interceptedParams: unknown;
	const interceptor = browserViewDebugger.registerCommandInterceptor((method, params) => {
		if (method !== 'Emulation.setDeviceMetricsOverride') {
			return undefined;
		}
		interceptedParams = params;
		return Promise.resolve({});
	});

	try {
		const session = await browserViewDebugger.attach();
		await session.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844 });
		assert.deepEqual(interceptedParams, { width: 390, height: 844 });
		assert.equal(electronDebugger.commands.some(command => command.method === 'Emulation.setDeviceMetricsOverride'), false);

		interceptor.dispose();
		await assert.rejects(
			session.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768 }),
			/only supported for integrated browser page targets/,
		);
	} finally {
		interceptor.dispose();
		browserViewDebugger.dispose();
	}
});

test('BrowserViewCDPTarget updates attachment state and closes with its view', async () => {
	const { browserViewDebugger } = createDebugger();
	const viewClose = new Emitter<void>();
	const targetInfo = await browserViewDebugger.getTargetInfo();
	const target = new BrowserViewCDPTarget(
		'view',
		'context',
		browserViewDebugger,
		targetInfo,
		viewClose.event,
	);
	const attachmentStates: boolean[] = [];
	let closed = false;

	try {
		target.onTargetInfoChanged(info => attachmentStates.push(info.attached));
		target.onClose(() => {
			closed = true;
		});
		const session = await target.attach();
		target.notifySessionCreated(session, false);
		session.dispose();

		assert.deepEqual(attachmentStates, [true, false]);
		assert.equal(target.sessions.size, 0);

		viewClose.fire();
		assert.equal(closed, true);
	} finally {
		target.dispose();
		viewClose.dispose();
		browserViewDebugger.dispose();
	}
});
