/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type {
	ElectronIpcApi,
	ElectronRendererChannelApi,
	ElectronRendererChannelCallRequest,
	ElectronRendererChannelCallResponse,
	ElectronRendererChannelEventPayload,
	ElectronRendererChannelEventSubscribeRequest,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { ElectronIPCMainProcessService } from 'cs/platform/ipc/electron-browser/mainProcessService';

class TestElectronRendererChannelApi implements ElectronRendererChannelApi {
	readonly registeredChannels: string[] = [];
	readonly disposedChannels: string[] = [];
	readonly registrationArgumentCounts: number[] = [];
	readonly callResponses: ElectronRendererChannelCallResponse[] = [];
	readonly eventPayloads: ElectronRendererChannelEventPayload[] = [];
	private readonly callResponseResolvers: Array<(response: ElectronRendererChannelCallResponse) => void> = [];
	private callListener: ((request: ElectronRendererChannelCallRequest) => void) | undefined;
	private callCancellationListener: ((requestId: string) => void) | undefined;
	private eventSubscriptionListener: ((request: ElectronRendererChannelEventSubscribeRequest) => void) | undefined;
	private eventDisposalListener: ((subscriptionId: string) => void) | undefined;

	register(channelName: string): void {
		this.registrationArgumentCounts.push(arguments.length);
		this.registeredChannels.push(structuredClone(channelName));
	}

	dispose(channelName: string): void {
		this.disposedChannels.push(structuredClone(channelName));
	}

	sendCallResult(response: ElectronRendererChannelCallResponse): void {
		const cloned = structuredClone(response);
		this.callResponses.push(cloned);
		this.callResponseResolvers.shift()?.(cloned);
	}

	sendEvent(payload: ElectronRendererChannelEventPayload): void {
		this.eventPayloads.push(structuredClone(payload));
	}

	onCall(listener: (request: ElectronRendererChannelCallRequest) => void): () => void {
		this.callListener = listener;
		return () => {
			if (this.callListener === listener) {
				this.callListener = undefined;
			}
		};
	}

	onCallCancellation(listener: (requestId: string) => void): () => void {
		this.callCancellationListener = listener;
		return () => {
			if (this.callCancellationListener === listener) {
				this.callCancellationListener = undefined;
			}
		};
	}

	onEventSubscription(listener: (request: ElectronRendererChannelEventSubscribeRequest) => void): () => void {
		this.eventSubscriptionListener = listener;
		return () => {
			if (this.eventSubscriptionListener === listener) {
				this.eventSubscriptionListener = undefined;
			}
		};
	}

	onEventDisposal(listener: (subscriptionId: string) => void): () => void {
		this.eventDisposalListener = listener;
		return () => {
			if (this.eventDisposalListener === listener) {
				this.eventDisposalListener = undefined;
			}
		};
	}

	emitCall(request: ElectronRendererChannelCallRequest): void {
		this.callListener?.(structuredClone(request));
	}

	emitCallCancellation(requestId: string): void {
		this.callCancellationListener?.(structuredClone(requestId));
	}

	emitEventSubscription(request: ElectronRendererChannelEventSubscribeRequest): void {
		this.eventSubscriptionListener?.(structuredClone(request));
	}

	emitEventDisposal(subscriptionId: string): void {
		this.eventDisposalListener?.(structuredClone(subscriptionId));
	}

	nextCallResponse(): Promise<ElectronRendererChannelCallResponse> {
		return new Promise(resolve => {
			this.callResponseResolvers.push(resolve);
		});
	}
}

class TestElectronIpcApi implements ElectronIpcApi {
	lastCallCancellationId: string | undefined;
	readonly cancelledIds: string[] = [];
	readonly rendererChannels = new TestElectronRendererChannelApi();
	private completeCall: ((value: unknown) => void) | undefined;

	call<T = unknown>(
		_channelName: string,
		_command: string,
		_arg?: unknown,
		cancellationId?: string,
	): Promise<T> {
		this.lastCallCancellationId = cancellationId;
		return new Promise<T>(resolve => {
			this.completeCall = value => resolve(value as T);
		});
	}

	cancel(cancellationId: string): void {
		this.cancelledIds.push(cancellationId);
	}

	listen<T = unknown>(
		_channelName: string,
		_event: string,
		_arg: unknown,
		_listener: (payload: T) => void,
	): () => void {
		return () => {};
	}

	complete(value: unknown): void {
		this.completeCall?.(value);
	}
}

test('forwards channel cancellation to the Electron IPC bridge', async () => {
	const ipc = new TestElectronIpcApi();
	const service = new ElectronIPCMainProcessService(ipc);
	const source = new CancellationTokenSource();

	try {
		const call = service.getChannel('playwright').call<string>('captureSnapshot', undefined, source.token);
		source.cancel();

		assert.ok(ipc.lastCallCancellationId);
		assert.deepEqual(ipc.cancelledIds, [ipc.lastCallCancellationId]);

		ipc.complete('cancelled');
		assert.equal(await call, 'cancelled');
	} finally {
		source.dispose();
		service.dispose();
	}
});

test('keeps renderer channel implementations in the renderer process', async () => {
	const ipc = new TestElectronIpcApi();
	const service = new ElectronIPCMainProcessService(ipc);
	const events = new Emitter<unknown>();
	const calls: Array<{
		readonly context: string;
		readonly command: string;
		readonly arg: unknown;
	}> = [];
	const channel: IServerChannel<string> = {
		async call<T = unknown>(context: string, command: string, arg?: unknown): Promise<T> {
			calls.push({ context, command, arg });
			return { accepted: true } as T;
		},
		listen<T = unknown>(context: string, event: string, arg?: unknown): Event<T> {
			assert.deepStrictEqual({ context, event, arg }, {
				context: 'main',
				event: 'onDidProgress',
				arg: { call: 'call-1' },
			});
			return events.event as Event<T>;
		},
	};

	try {
		service.registerChannel('agentHost.clientTools', channel);

		assert.deepStrictEqual(ipc.rendererChannels.registeredChannels, ['agentHost.clientTools']);
		assert.deepStrictEqual(ipc.rendererChannels.registrationArgumentCounts, [1]);

		const response = ipc.rendererChannels.nextCallResponse();
		ipc.rendererChannels.emitCall({
			requestId: 'request-1',
			channelName: 'agentHost.clientTools',
			command: 'execute',
			arg: { call: 'call-1' },
		});
		assert.deepStrictEqual(await response, {
			requestId: 'request-1',
			ok: true,
			result: { accepted: true },
		});
		assert.deepStrictEqual(calls, [{
			context: 'main',
			command: 'execute',
			arg: { call: 'call-1' },
		}]);

		ipc.rendererChannels.emitEventSubscription({
			subscriptionId: 'subscription-1',
			channelName: 'agentHost.clientTools',
			eventName: 'onDidProgress',
			arg: { call: 'call-1' },
		});
		events.fire({ call: 'call-1', message: 'running' });
		assert.deepStrictEqual(ipc.rendererChannels.eventPayloads, [{
			subscriptionId: 'subscription-1',
			data: { call: 'call-1', message: 'running' },
		}]);

		ipc.rendererChannels.emitEventDisposal('subscription-1');
		events.fire({ call: 'call-1', message: 'late' });
		assert.equal(ipc.rendererChannels.eventPayloads.length, 1);
	} finally {
		service.dispose();
		events.dispose();
	}

	assert.deepStrictEqual(ipc.rendererChannels.disposedChannels, ['agentHost.clientTools']);
});

test('forwards renderer channel call cancellation to the local implementation', async () => {
	const ipc = new TestElectronIpcApi();
	const service = new ElectronIPCMainProcessService(ipc);
	let markCallStarted: (() => void) | undefined;
	const callStarted = new Promise<void>(resolve => {
		markCallStarted = resolve;
	});
	let cancellationObserved = false;
	const channel: IServerChannel<string> = {
		call<T = unknown>(
			_context: string,
			_command: string,
			_arg?: unknown,
			cancellationToken?: CancellationToken,
		): Promise<T> {
			markCallStarted?.();
			return new Promise<T>(resolve => {
				cancellationToken?.onCancellationRequested(() => {
					cancellationObserved = true;
					resolve('cancelled' as T);
				});
			});
		},
		listen<T = unknown>(): Event<T> {
			throw new Error('Cancellation test channel does not expose events.');
		},
	};

	try {
		service.registerChannel('renderer', channel);
		ipc.rendererChannels.emitCall({
			requestId: 'request-1',
			channelName: 'renderer',
			command: 'wait',
		});
		await callStarted;
		const response = ipc.rendererChannels.nextCallResponse();
		ipc.rendererChannels.emitCallCancellation('request-1');

		assert.equal(cancellationObserved, true);
		assert.deepStrictEqual(await response, {
			requestId: 'request-1',
			ok: true,
			result: 'cancelled',
		});
	} finally {
		service.dispose();
	}
});
