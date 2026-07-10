/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { WebContents } from 'electron';
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
