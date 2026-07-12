/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Emitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { CDPBrowserProxy } from 'cs/platform/browserView/common/cdp/proxy';
import { CDPErrorCode } from 'cs/platform/browserView/common/cdp/types';
import type {
	CDPBrowserVersion,
	CDPEvent,
	CDPResponse,
	CDPTargetInfo,
	CDPWindowBounds,
	ICDPBrowserTarget,
	ICDPConnection,
	ICDPTarget,
} from 'cs/platform/browserView/common/cdp/types';

class TestConnection extends Disposable implements ICDPConnection {
	private readonly _onEvent = this._register(new Emitter<CDPEvent>());
	readonly onEvent = this._onEvent.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	readonly commands: Array<{ method: string; params: unknown }> = [];
	commandBarrier: Promise<void> | undefined;
	private disposed = false;

	constructor(
		readonly sessionId: string,
		readonly targetId: string,
		readonly parentSessionId?: string,
	) {
		super();
	}

	emitEvent(method: string, params: unknown): void {
		this._onEvent.fire({ method, params });
	}

	async sendCommand(method: string, params?: unknown): Promise<unknown> {
		this.commands.push({ method, params });
		await this.commandBarrier;
		return { acknowledged: true };
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this._onClose.fire();
		super.dispose();
	}
}

class TestTarget extends Disposable implements ICDPTarget {
	private readonly targetSessions = new Map<string, ICDPConnection>();
	readonly sessions: ReadonlyMap<string, ICDPConnection> = this.targetSessions;

	private readonly _onSessionCreated = this._register(new Emitter<{ session: ICDPConnection; waitingForDebugger: boolean }>());
	readonly onSessionCreated = this._onSessionCreated.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private readonly _onTargetInfoChanged = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetInfoChanged = this._onTargetInfoChanged.event;

	attachCount = 0;
	lastConnection: TestConnection | undefined;
	attachBarrier: Promise<void> | undefined;
	private disposed = false;

	constructor(readonly targetInfo: CDPTargetInfo) {
		super();
	}

	async attach(): Promise<ICDPConnection> {
		this.attachCount += 1;
		await this.attachBarrier;
		const connection = new TestConnection(
			`session-${this.targetInfo.targetId}-${this.attachCount}`,
			this.targetInfo.targetId,
		);
		this.lastConnection = connection;
		this.notifySessionCreated(connection, false);
		return connection;
	}

	notifySessionCreated(session: ICDPConnection, waitingForDebugger: boolean): void {
		if (this.targetSessions.has(session.sessionId)) {
			return;
		}
		this.targetSessions.set(session.sessionId, session);
		this._onSessionCreated.fire({ session, waitingForDebugger });
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this._onClose.fire();
		for (const session of this.targetSessions.values()) {
			session.dispose();
		}
		this.targetSessions.clear();
		super.dispose();
	}
}

class TestBrowserTarget extends TestTarget implements ICDPBrowserTarget {
	readonly contexts = new Set<string>(['default-context']);
	createdTarget: TestTarget | undefined;
	createdTargetBarrier: Promise<void> | undefined;

	constructor() {
		super({
			targetId: 'browser',
			type: 'browser',
			title: 'Comet/Test',
			url: '',
			attached: true,
			canAccessOpener: false,
		});
	}

	getVersion(): CDPBrowserVersion {
		return {
			protocolVersion: '1.3',
			product: 'Comet/Test',
			revision: 'test',
			userAgent: 'Electron/Test',
			jsVersion: 'test',
		};
	}

	getWindowForTarget(): { windowId: number; bounds: CDPWindowBounds } {
		return {
			windowId: 1,
			bounds: {
				left: 0,
				top: 0,
				width: 1024,
				height: 768,
				windowState: 'normal',
			},
		};
	}

	async createTarget(url: string, browserContextId?: string): Promise<ICDPTarget> {
		const target = new TestTarget({
			targetId: 'created-page',
			type: 'page',
			title: '',
			url,
			attached: false,
			canAccessOpener: false,
			browserContextId,
		});
		target.attachBarrier = this.createdTargetBarrier;
		this.createdTarget = target;
		return target;
	}

	async activateTarget(): Promise<void> {
	}

	async closeTarget(target: ICDPTarget): Promise<boolean> {
		target.dispose();
		return true;
	}

	getBrowserContexts(): string[] {
		return [...this.contexts];
	}

	async createBrowserContext(): Promise<string> {
		const id = 'created-context';
		this.contexts.add(id);
		return id;
	}

	async disposeBrowserContext(browserContextId: string): Promise<void> {
		this.contexts.delete(browserContextId);
	}
}

function createPageTarget(targetId = 'page'): TestTarget {
	return new TestTarget({
		targetId,
		type: 'page',
		title: 'Page',
		url: 'https://example.com',
		attached: false,
		canAccessOpener: false,
		browserContextId: 'default-context',
	});
}

test('CDP browser proxy discovers, attaches, and routes page commands', async () => {
	const browser = new TestBrowserTarget();
	const proxy = new CDPBrowserProxy(browser);
	const page = createPageTarget();
	const messages: Array<CDPEvent | { id: number; result?: unknown }> = [];
	const listener = proxy.onMessage(message => messages.push(message));
	await proxy.registerTarget(page);

	try {
		await proxy.sendCommand('Target.setDiscoverTargets', { discover: true });
		await proxy.sendCommand('Target.setAutoAttach', { autoAttach: true, flatten: true });
		const connection = page.lastConnection;
		assert.ok(connection);

		const result = await proxy.sendCommand(
			'Runtime.evaluate',
			{ expression: 'document.title' },
			connection.sessionId,
		);
		connection.emitEvent('Runtime.consoleAPICalled', { type: 'log' });
		await proxy.sendMessage({ id: 7, method: 'Browser.getVersion' });

		assert.deepEqual(result, { acknowledged: true });
		assert.deepEqual(connection.commands, [{
			method: 'Runtime.evaluate',
			params: { expression: 'document.title' },
		}]);
		assert.equal(messages.some(message => 'method' in message && message.method === 'Target.targetCreated'), true);
		assert.equal(messages.some(message => 'method' in message && message.method === 'Target.attachedToTarget'), true);
		assert.equal(messages.some(message => 'method' in message && message.method === 'Runtime.consoleAPICalled'), true);
		assert.equal(messages.some(message => 'id' in message && message.id === 7), true);
	} finally {
		listener.dispose();
		proxy.dispose();
	}
});

test('CDP browser proxy waits for auto-attachment while registering a target', async () => {
	const browser = new TestBrowserTarget();
	const proxy = new CDPBrowserProxy(browser);
	const page = createPageTarget();
	let releaseAttachment: (() => void) | undefined;
	page.attachBarrier = new Promise<void>(resolve => {
		releaseAttachment = resolve;
	});

	try {
		await proxy.sendCommand('Target.setAutoAttach', { autoAttach: true, flatten: true });
		let completed = false;
		const registration = proxy.registerTarget(page).then(() => {
			completed = true;
		});

		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(page.attachCount, 1);
		assert.equal(completed, false);
		releaseAttachment?.();

		await registration;
		assert.equal(completed, true);
	} finally {
		releaseAttachment?.();
		proxy.dispose();
	}
});

test('CDP browser proxy interrupts a pending session command when disposed', async () => {
	const browser = new TestBrowserTarget();
	const proxy = new CDPBrowserProxy(browser);
	const page = createPageTarget();
	await proxy.registerTarget(page);
	const connection = await page.attach() as TestConnection;
	connection.commandBarrier = new Promise<void>(() => {});
	let completed = false;
	const sending = proxy.sendMessage({
		id: 1,
		method: 'Runtime.evaluate',
		params: { expression: 'new Promise(() => {})', awaitPromise: true },
		sessionId: connection.sessionId,
	}).then(() => {
		completed = true;
	});

	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(completed, false);
	proxy.dispose();
	await sending;
	assert.equal(completed, true);
});

test('Target.createTarget waits for auto-attachment before responding', async () => {
	const browser = new TestBrowserTarget();
	const proxy = new CDPBrowserProxy(browser);
	let releaseAttachment: (() => void) | undefined;
	browser.createdTargetBarrier = new Promise<void>(resolve => {
		releaseAttachment = resolve;
	});

	try {
		await proxy.sendCommand('Target.setAutoAttach', { autoAttach: true, flatten: true });
		let completed = false;
		const creation = proxy.sendCommand('Target.createTarget', {
			url: 'https://example.com/new',
			browserContextId: 'default-context',
		}).then(result => {
			completed = true;
			return result;
		});

		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(browser.createdTarget?.attachCount, 1);
		assert.equal(completed, false);
		releaseAttachment?.();

		assert.deepEqual(await creation, { targetId: 'created-page' });
		assert.equal(completed, true);
	} finally {
		proxy.dispose();
	}
});

test('CDP browser proxy returns protocol errors with request context', async () => {
	const browser = new TestBrowserTarget();
	const proxy = new CDPBrowserProxy(browser);
	const messages: Array<CDPResponse | CDPEvent> = [];
	const listener = proxy.onMessage(message => messages.push(message));

	try {
		await proxy.sendMessage({ id: 1, method: 'Missing.method', sessionId: proxy.sessionId });
		await proxy.sendMessage({
			id: 2,
			method: 'Target.setAutoAttach',
			params: { autoAttach: true, flatten: false },
		});
		await proxy.sendMessage({
			id: 3,
			method: 'Runtime.evaluate',
			params: { expression: 'document.title' },
			sessionId: 'missing-session',
		});

		assert.deepEqual(messages, [
			{
				id: 1,
				error: {
					code: CDPErrorCode.MethodNotFound,
					message: 'Method not found: Missing.method',
				},
				sessionId: proxy.sessionId,
			},
			{
				id: 2,
				error: {
					code: CDPErrorCode.InvalidParams,
					message: 'This implementation only supports auto-attach with flatten=true',
				},
				sessionId: undefined,
			},
			{
				id: 3,
				error: {
					code: CDPErrorCode.ServerError,
					message: 'Session not found: missing-session',
				},
				sessionId: 'missing-session',
			},
		]);
	} finally {
		listener.dispose();
		proxy.dispose();
	}
});
