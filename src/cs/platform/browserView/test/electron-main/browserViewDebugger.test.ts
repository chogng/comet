/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { WebContents, WebContentsView } from 'electron';
import { Emitter } from 'cs/base/common/event';
import type { ICDPConnection } from 'cs/platform/browserView/common/cdp/types';
import { BrowserViewCDPTarget } from 'cs/platform/browserView/electron-main/browserViewCDPTarget';
import { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';
import { BrowserViewInspector } from 'cs/platform/browserView/electron-main/browserViewInspector';
import { BrowserViewScreenshot } from 'cs/platform/browserView/electron-main/browserViewScreenshot';

type RecordedCommand = {
	readonly method: string;
	readonly params: unknown;
	readonly sessionId?: string;
};

class TestElectronDebugger extends EventEmitter {
	readonly commands: RecordedCommand[] = [];
	private attached = false;
	private sessionCounter = 0;
	private outerHTMLGate: { readonly promise: Promise<void>; notifyRequested(): void } | undefined;
	private inspectModeGate: { readonly promise: Promise<void>; notifyRequested(): void } | undefined;

	deferNextOuterHTML(): { readonly requested: Promise<void>; release(): void } {
		let releaseRequest!: () => void;
		let notifyRequested!: () => void;
		const promise = new Promise<void>(resolve => {
			releaseRequest = resolve;
		});
		const requested = new Promise<void>(resolve => {
			notifyRequested = resolve;
		});
		const gate = { promise, notifyRequested };
		this.outerHTMLGate = gate;
		return {
			requested,
			release: () => {
				if (this.outerHTMLGate === gate) {
					this.outerHTMLGate = undefined;
				}
				releaseRequest();
			},
		};
	}

	deferNextInspectMode(): { readonly requested: Promise<void>; release(): void } {
		let releaseRequest!: () => void;
		let notifyRequested!: () => void;
		const promise = new Promise<void>(resolve => {
			releaseRequest = resolve;
		});
		const requested = new Promise<void>(resolve => {
			notifyRequested = resolve;
		});
		const gate = { promise, notifyRequested };
		this.inspectModeGate = gate;
		return {
			requested,
			release: () => {
				if (this.inspectModeGate === gate) {
					this.inspectModeGate = undefined;
				}
				releaseRequest();
			},
		};
	}

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
		if (method === 'Runtime.evaluate') {
			const evaluation = params as { expression?: string; uniqueContextId?: string } | undefined;
			const expression = evaluation?.expression ?? '';
			if (expression.includes('getFrameToken')) {
				return { result: { value: `${evaluation?.uniqueContextId}-token` } };
			}
			if (expression.includes('__vscode_helpers?.getElement')) {
				return { result: { objectId: 'picked-element' } };
			}
		}
		if (method === 'DOM.describeNode') {
			return {
				node: {
					nodeId: 1,
					backendNodeId: 10,
					localName: 'button',
					attributes: ['id', 'submit', 'class', 'primary'],
				},
			};
		}
		if (method === 'DOM.getBoxModel') {
			return {
				model: {
					content: [10, 20, 110, 20, 110, 60, 10, 60],
					padding: [10, 20, 110, 20, 110, 60, 10, 60],
					border: [10, 20, 110, 20, 110, 60, 10, 60],
					margin: [8, 18, 112, 18, 112, 62, 8, 62],
					width: 100,
					height: 40,
				},
			};
		}
		if (method === 'DOM.getFrameOwner') {
			return { backendNodeId: 99 };
		}
		if (method === 'CSS.getMatchedStylesForNode') {
			return {};
		}
		if (method === 'DOM.getOuterHTML') {
			const gate = this.outerHTMLGate;
			if (gate) {
				gate.notifyRequested();
				await gate.promise;
			}
			return { outerHTML: '<button id="submit" class="primary">Send</button>' };
		}
		if (method === 'CSS.getComputedStyleForNode') {
			return { computedStyle: [] };
		}
		if (method === 'Overlay.setInspectMode') {
			const gate = this.inspectModeGate;
			if (gate) {
				gate.notifyRequested();
				await gate.promise;
			}
			return {};
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

type PostedFrameMessage = {
	readonly channel: string;
	readonly message: unknown;
};

type TestFrame = {
	detached: boolean;
	ipc: EventEmitter;
	isDestroyed(): boolean;
	parent: TestFrame | null;
	postMessage(channel: string, message: unknown): void;
	url: string;
};

function createInspectorHarness() {
	const electronDebugger = new TestElectronDebugger();
	const frameIpc = new EventEmitter();
	const postedMessages: PostedFrameMessage[] = [];
	let frameDestroyed = false;
	const mainFrame: TestFrame = {
		detached: false,
		ipc: frameIpc,
		isDestroyed: () => frameDestroyed,
		parent: null,
		postMessage: (channel: string, message: unknown) => {
			postedMessages.push({ channel, message });
		},
		url: 'https://example.com/page',
	};
	const webContentsEmitter = new EventEmitter();
	const webContents = Object.assign(webContentsEmitter, {
		debugger: electronDebugger,
		getOrCreateDevToolsTargetId: () => 'root-target',
		isDestroyed: () => false,
		mainFrame,
	}) as unknown as WebContents;
	const browserViewDebugger = new BrowserViewDebugger(webContents);
	let rootSession: ICDPConnection | undefined;
	const sessionSubscription = browserViewDebugger.onSessionCreated(({ session }) => {
		if (session.targetId === 'root-target') {
			rootSession = session;
		}
	});
	const inspector = new BrowserViewInspector(webContents, browserViewDebugger);
	const adoptFrame = async (frame: TestFrame, uniqueContextId: string, frameId: string): Promise<void> => {
		assert.ok(rootSession);
		webContentsEmitter.emit(
			'ipc-message',
			{ senderFrame: frame },
			'vscode:browserView:preloadReady',
			`${uniqueContextId}-token`,
		);
		electronDebugger.emit(
			'message',
			{},
			'Runtime.executionContextCreated',
			{
				context: {
					uniqueId: uniqueContextId,
					auxData: { isDefault: true, frameId },
				},
			},
			rootSession.sessionId,
		);
		await nextTask();
	};

	return {
		adoptFrame,
		browserViewDebugger,
		electronDebugger,
		frameIpc,
		inspector,
		mainFrame,
		postedMessages,
		webContentsEmitter,
		emitRootSessionEvent(method: string, params: unknown): void {
			assert.ok(rootSession);
			electronDebugger.emit('message', {}, method, params, rootSession.sessionId);
		},
		async adoptMainFrame(): Promise<void> {
			await nextTask();
			await adoptFrame(mainFrame, 'main-context', 'main-frame');
		},
		destroyFrame(): void {
			frameDestroyed = true;
		},
		dispose(): void {
			inspector.dispose();
			sessionSubscription.dispose();
			browserViewDebugger.dispose();
		},
	};
}

function nextTask(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

function createScreenshotHarness() {
	const operations: Array<{ readonly method: string; readonly value?: unknown }> = [];
	const webContents = {
		capturePage: async (rect: unknown, options: unknown) => {
			operations.push({ method: 'capturePage', value: { rect, options } });
			return {
				isEmpty: () => false,
				toJPEG: (quality: number) => Buffer.from(`jpeg-${quality}`),
				toPNG: () => Buffer.from('png'),
			};
		},
		getZoomFactor: () => 1.5,
		setVisualZoomLevelLimits: async (minimum: number, maximum: number) => {
			operations.push({ method: 'setVisualZoomLevelLimits', value: { minimum, maximum } });
		},
	};
	let visible = false;
	const view = {
		getVisible: () => visible,
		setVisible: (nextVisible: boolean) => {
			visible = nextVisible;
			operations.push({ method: 'setVisible', value: nextVisible });
		},
		webContents,
	} as unknown as WebContentsView;
	const debuggerTransport = {
		sendCommand: async (method: string, params?: unknown) => {
			operations.push({ method, value: params });
			if (method === 'Page.getLayoutMetrics') {
				return { cssContentSize: { width: 2000, height: 4000 } };
			}
			if (method === 'Page.captureScreenshot') {
				return { data: Buffer.from('full-page').toString('base64') };
			}
			return {};
		},
	} as unknown as BrowserViewDebugger;
	const inspector = {
		getVisualViewportScale: async () => 2,
	} as unknown as BrowserViewInspector;
	return {
		operations,
		screenshot: new BrowserViewScreenshot(view, debuggerTransport, inspector),
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

test('BrowserViewScreenshot converts page coordinates and waits for paint before capture', async () => {
	const harness = createScreenshotHarness();
	const screenshot = await harness.screenshot.capture({
		pageRect: { x: 10, y: 20, width: 30, height: 40 },
		awaitNextPaint: true,
	}, 0.5, 2);
	const capture = harness.operations.find(operation => operation.method === 'capturePage');

	assert.deepEqual(harness.operations.slice(0, 3).map(operation => operation.method), [
		'setVisible',
		'setVisible',
		'Runtime.evaluate',
	]);
	assert.deepEqual(capture?.value, {
		rect: { x: 15, y: 30, width: 45, height: 60 },
		options: { stayHidden: true },
	});
	assert.equal(Buffer.from(screenshot.buffer).toString(), 'jpeg-80');
});

test('BrowserViewScreenshot captures a bounded full document through CDP and restores visual zoom', async () => {
	const harness = createScreenshotHarness();
	const screenshot = await harness.screenshot.capture({ fullPage: true, format: 'png' }, 1, 2);
	const capture = harness.operations.find(operation => operation.method === 'Page.captureScreenshot');

	assert.deepEqual(capture?.value, {
		format: 'png',
		captureBeyondViewport: true,
		clip: { x: 0, y: 0, width: 3000, height: 6000, scale: 2576 / 2 / 6000 },
	});
	assert.equal(harness.operations.some(operation => operation.method === 'capturePage'), false);
	assert.equal(harness.operations.some(operation => operation.method === 'setVisualZoomLevelLimits'), true);
	assert.equal(Buffer.from(screenshot.buffer).toString(), 'full-page');
});

test('BrowserViewInspector drives the preload picker and extracts selected element data through CDP', async () => {
	const harness = createInspectorHarness();
	const activeStates: boolean[] = [];
	const selectedElements: Array<{ outerHTML: string; url?: string; bounds: { x: number; y: number; width: number; height: number } }> = [];

	try {
		harness.inspector.setTheme({ focusBorder: '#123456' });
		harness.inspector.onDidChangeElementSelectionActive(active => activeStates.push(active));
		harness.inspector.onDidSelectElement(element => selectedElements.push({
			outerHTML: element.outerHTML,
			url: element.url,
			bounds: element.bounds,
		}));
		await harness.adoptMainFrame();
		await harness.inspector.toggleElementSelection(true);

		assert.equal(harness.inspector.isElementSelectionActive, true);
		assert.equal(harness.postedMessages.some(message =>
			message.channel === 'vscode:browserView:setTheme' &&
			(message.message as { focusBorder?: string }).focusBorder === '#123456'
		), true);
		assert.equal(harness.postedMessages.some(message => message.channel === 'vscode:browserView:startElementPicker'), true);

		harness.frameIpc.emit(
			'vscode:browserView:elementPickStopped',
			{ senderFrame: harness.mainFrame },
		);
		harness.frameIpc.emit(
			'vscode:browserView:elementPicked',
			{ senderFrame: harness.mainFrame },
			'element-1',
		);
		await nextTask();

		assert.deepEqual(activeStates, [true, false]);
		assert.deepEqual(selectedElements, [{
			outerHTML: '<button id="submit" class="primary">Send</button>',
			url: 'https://example.com/page',
			bounds: { x: 8, y: 18, width: 104, height: 44 },
		}]);
		assert.equal(harness.postedMessages.some(message => message.channel === 'vscode:browserView:stopElementPicker'), true);
	} finally {
		harness.dispose();
	}
});

test('BrowserViewInspector correlates child frames and offsets their selected element bounds', async () => {
	const harness = createInspectorHarness();
	const childFrameIpc = new EventEmitter();
	const childPostedMessages: PostedFrameMessage[] = [];
	const childFrame: TestFrame = {
		detached: false,
		ipc: childFrameIpc,
		isDestroyed: () => false,
		parent: harness.mainFrame,
		postMessage: (channel, message) => childPostedMessages.push({ channel, message }),
		url: 'https://frames.example.com/child',
	};
	const selectedBounds: Array<{ x: number; y: number; width: number; height: number }> = [];

	try {
		harness.inspector.onDidSelectElement(element => selectedBounds.push(element.bounds));
		await harness.adoptMainFrame();
		await harness.adoptFrame(childFrame, 'child-context', 'child-frame');
		await harness.inspector.toggleElementSelection(true);
		childFrameIpc.emit(
			'vscode:browserView:elementPickStopped',
			{ senderFrame: childFrame },
		);
		childFrameIpc.emit(
			'vscode:browserView:elementPicked',
			{ senderFrame: childFrame },
			'child-element',
		);
		await nextTask();

		assert.deepEqual(selectedBounds, [{ x: 18, y: 38, width: 104, height: 44 }]);
		assert.equal(childPostedMessages.some(message => message.channel === 'vscode:browserView:startElementPicker'), true);
		assert.equal(childPostedMessages.some(message => message.channel === 'vscode:browserView:stopElementPicker'), true);
	} finally {
		harness.dispose();
	}
});

test('BrowserViewInspector does not publish element data after navigation or picker supersession', async () => {
	const harness = createInspectorHarness();
	const selectedElements: string[] = [];

	try {
		harness.inspector.onDidSelectElement(element => selectedElements.push(element.outerHTML));
		await harness.adoptMainFrame();

		await harness.inspector.toggleElementSelection(true);
		const navigationGate = harness.electronDebugger.deferNextOuterHTML();
		harness.frameIpc.emit(
			'vscode:browserView:elementPickStopped',
			{ senderFrame: harness.mainFrame },
		);
		harness.frameIpc.emit(
			'vscode:browserView:elementPicked',
			{ senderFrame: harness.mainFrame },
			'navigation-element',
		);
		await navigationGate.requested;
		harness.webContentsEmitter.emit('did-navigate');
		navigationGate.release();
		await nextTask();

		await harness.inspector.toggleElementSelection(true);
		const supersessionGate = harness.electronDebugger.deferNextOuterHTML();
		harness.frameIpc.emit(
			'vscode:browserView:elementPickStopped',
			{ senderFrame: harness.mainFrame },
		);
		harness.frameIpc.emit(
			'vscode:browserView:elementPicked',
			{ senderFrame: harness.mainFrame },
			'superseded-element',
		);
		await supersessionGate.requested;
		await harness.inspector.toggleAreaSelection(true);
		supersessionGate.release();
		await nextTask();
		await harness.inspector.toggleAreaSelection(false);

		assert.deepEqual(selectedElements, []);
	} finally {
		harness.dispose();
	}
});

test('BrowserViewInspector cancels a pending CDP inspect-mode activation when area picking supersedes it', async () => {
	const harness = createInspectorHarness();
	const elementActiveStates: boolean[] = [];

	try {
		harness.inspector.onDidChangeElementSelectionActive(active => elementActiveStates.push(active));
		await harness.adoptMainFrame();
		harness.emitRootSessionEvent('Debugger.paused', {});
		const inspectModeGate = harness.electronDebugger.deferNextInspectMode();
		const activation = harness.inspector.toggleElementSelection(true);
		await inspectModeGate.requested;
		await harness.inspector.toggleAreaSelection(true);
		inspectModeGate.release();
		await activation;

		assert.deepEqual(elementActiveStates, []);
		assert.equal(harness.inspector.isElementSelectionActive, false);
		assert.equal(harness.inspector.isAreaSelectionActive, true);
		assert.deepEqual(
			harness.electronDebugger.commands
				.filter(command => command.method === 'Overlay.setInspectMode')
				.map(command => (command.params as { mode: string }).mode),
			['searchForNode', 'none'],
		);
		await harness.inspector.toggleAreaSelection(false);
	} finally {
		harness.dispose();
	}
});

test('BrowserViewInspector keeps picker modes mutually exclusive and cancels them on navigation', async () => {
	const harness = createInspectorHarness();
	const areaActiveStates: boolean[] = [];
	const elementActiveStates: boolean[] = [];
	const pickedAreas: Array<{ x: number; y: number; width: number; height: number } | undefined> = [];

	try {
		harness.inspector.onDidChangeAreaSelectionActive(active => areaActiveStates.push(active));
		harness.inspector.onDidChangeElementSelectionActive(active => elementActiveStates.push(active));
		harness.inspector.onDidPickArea(rect => pickedAreas.push(rect));
		await harness.adoptMainFrame();

		await harness.inspector.toggleAreaSelection(true);
		harness.webContentsEmitter.emit(
			'ipc-message',
			{ senderFrame: harness.mainFrame },
			'vscode:browserView:areaPicked',
			{ x: 10, y: 20, width: 30, height: 40 },
		);
		await harness.inspector.toggleAreaSelection(true);
		await harness.inspector.toggleElementSelection(true);
		harness.webContentsEmitter.emit('did-navigate');
		await harness.inspector.toggleAreaSelection(true);
		harness.webContentsEmitter.emit('did-navigate');

		assert.deepEqual(areaActiveStates, [true, false, true, false, true, false]);
		assert.deepEqual(elementActiveStates, [true, false]);
		assert.deepEqual(pickedAreas, [
			{ x: 10, y: 20, width: 30, height: 40 },
			undefined,
			undefined,
		]);
		assert.equal(harness.inspector.isAreaSelectionActive, false);
		assert.equal(harness.inspector.isElementSelectionActive, false);
		assert.equal(harness.postedMessages.filter(message => message.channel === 'vscode:browserView:stopAreaPicker').length, 2);
	} finally {
		harness.dispose();
	}
});

test('BrowserViewInspector terminates active picker state when its debugger session closes', async () => {
	const harness = createInspectorHarness();
	const activeStates: boolean[] = [];

	try {
		harness.inspector.onDidChangeElementSelectionActive(active => activeStates.push(active));
		await harness.adoptMainFrame();
		await harness.inspector.toggleElementSelection(true);
		harness.destroyFrame();
		harness.electronDebugger.detach();

		assert.deepEqual(activeStates, [true, false]);
		assert.equal(harness.inspector.isElementSelectionActive, false);
		await assert.rejects(
			harness.inspector.toggleElementSelection(true),
			/CDP session is closed/,
		);
	} finally {
		harness.dispose();
	}
});
