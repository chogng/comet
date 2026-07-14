/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationError,
	CancellationTokenSource,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter, type Event } from 'cs/base/common/event';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable,
} from 'cs/base/common/lifecycle';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	decodeRemoteAgentHostProtocolPayload,
	decodeRemoteAgentHostProtocolResponse,
	encodeRemoteAgentHostProtocolError,
	encodeRemoteAgentHostProtocolPayload,
	encodeRemoteAgentHostProtocolSuccess,
} from './remoteProtocol.js';
import type { AgentHostProtocolValue } from './protocolValues.js';
import {
	decodeRemoteAgentHostTunnelMessage,
	encodeRemoteAgentHostTunnelMessage,
	type RemoteAgentHostTunnelMessage,
	type RemoteAgentHostTunnelTarget,
} from './remoteTunnelProtocol.js';

export interface IRemoteAgentHostTunnelFrameLink extends IDisposable {
	readonly generation: number;
	readonly onDidReceiveFrame: Event<Uint8Array>;
	send(frame: Uint8Array): Promise<void>;
}

export interface IRemoteAgentHostTunnelEvent {
	readonly target: 'host' | 'clientTools';
	readonly name: string;
	readonly value: AgentHostProtocolValue;
}

export interface IRemoteAgentHostTunnelRequestHandler {
	call(
		target: RemoteAgentHostTunnelTarget,
		command: string,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue>;
}

interface IPendingCall {
	readonly resolve: (value: AgentHostProtocolValue) => void;
	readonly reject: (error: unknown) => void;
	readonly cancellation: IDisposable;
}

const maximumConcurrentCalls = 1_024;
const maximumCompletedCalls = 4_096;

/** Correlates the common Agent Host request, response, cancellation, and event wire protocol. */
export class RemoteAgentHostTunnelProtocolPeer extends Disposable {
	private readonly eventEmitter = this._register(new EventEmitter<IRemoteAgentHostTunnelEvent>({
		onListenerError: onUnexpectedError,
	}));
	private readonly protocolErrorEmitter = this._register(new EventEmitter<AgentHostError>({
		onListenerError: onUnexpectedError,
	}));
	private readonly linkBinding = this._register(new MutableDisposable<DisposableStore>());
	private readonly pendingCalls = new Map<number, IPendingCall>();
	private readonly incomingCalls = new Map<number, CancellationTokenSource>();
	private readonly completedOutgoingCalls = new Set<number>();
	private readonly completedOutgoingCallOrder: number[] = [];
	private readonly completedIncomingCalls = new Set<number>();
	private readonly completedIncomingCallOrder: number[] = [];
	private link: IRemoteAgentHostTunnelFrameLink | undefined;
	private nextCallId = 1;

	readonly onDidReceiveEvent = this.eventEmitter.event;
	readonly onDidProtocolError = this.protocolErrorEmitter.event;

	constructor(private readonly requestHandler: IRemoteAgentHostTunnelRequestHandler) {
		super();
	}

	get generation(): number | undefined {
		return this.link?.generation;
	}

	attach(link: IRemoteAgentHostTunnelFrameLink): void {
		if (this.link !== undefined) {
			throw this.protocolError('link', 'alreadyAttached');
		}
		const binding = new DisposableStore();
		binding.add(link.onDidReceiveFrame(frame => this.receiveFrame(frame)));
		this.link = link;
		this.linkBinding.value = binding;
	}

	detach(error: unknown): void {
		this.linkBinding.clear();
		this.link = undefined;
		this.interrupt(error);
	}

	interrupt(error: unknown): void {
		for (const [id, pending] of this.pendingCalls) {
			pending.cancellation.dispose();
			pending.reject(error);
			this.recordCompleted(this.completedOutgoingCalls, this.completedOutgoingCallOrder, id);
		}
		this.pendingCalls.clear();
		for (const [id, cancellation] of this.incomingCalls) {
			cancellation.cancel();
			cancellation.dispose();
			this.recordCompleted(this.completedIncomingCalls, this.completedIncomingCallOrder, id);
		}
		this.incomingCalls.clear();
	}

	call(
		target: RemoteAgentHostTunnelTarget,
		command: string,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		if (this.link === undefined) {
			return Promise.reject(this.protocolError('link', 'unavailable'));
		}
		if (cancellation.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		if (this.pendingCalls.size >= maximumConcurrentCalls) {
			return Promise.reject(this.protocolError('pendingCalls', this.pendingCalls.size));
		}
		const id = this.allocateCallId();
		return new Promise<AgentHostProtocolValue>((resolve, reject) => {
			const cancellationListener = cancellation.onCancellationRequested(() => {
				const pending = this.pendingCalls.get(id);
				if (pending === undefined) {
					return;
				}
				this.pendingCalls.delete(id);
				pending.cancellation.dispose();
				this.recordCompleted(this.completedOutgoingCalls, this.completedOutgoingCallOrder, id);
				void this.send({ kind: 'cancel', id }).catch(onUnexpectedError);
				reject(new CancellationError());
			});
			this.pendingCalls.set(id, { resolve, reject, cancellation: cancellationListener });
			void this.send(Object.freeze({
				kind: 'request',
				id,
				target,
				command,
				...(argument === undefined
					? {}
					: { argument: encodeRemoteAgentHostProtocolPayload(argument) }),
			})).catch(error => {
				const pending = this.pendingCalls.get(id);
				if (pending === undefined) {
					return;
				}
				this.pendingCalls.delete(id);
				pending.cancellation.dispose();
				this.recordCompleted(this.completedOutgoingCalls, this.completedOutgoingCallOrder, id);
				pending.reject(error);
			});
		});
	}

	sendEvent(
		target: 'host' | 'clientTools',
		name: string,
		value: AgentHostProtocolValue,
	): Promise<void> {
		return this.send(Object.freeze({
			kind: 'event',
			target,
			name,
			payload: encodeRemoteAgentHostProtocolPayload(value),
		}));
	}

	override dispose(): void {
		this.detach(new CancellationError());
		super.dispose();
	}

	private receiveFrame(frame: Uint8Array): void {
		try {
			this.receive(decodeRemoteAgentHostTunnelMessage(frame));
		} catch (error) {
			this.protocolErrorEmitter.fire(error instanceof AgentHostError
				? error
				: this.protocolError('frame', 'invalid'));
		}
	}

	private receive(message: RemoteAgentHostTunnelMessage): void {
		switch (message.kind) {
			case 'request':
				this.receiveRequest(message);
				return;
			case 'cancel':
				this.receiveCancellation(message.id);
				return;
			case 'response':
				this.receiveResponse(message.id, message.payload);
				return;
			case 'event':
				this.eventEmitter.fire(Object.freeze({
					target: message.target,
					name: message.name,
					value: decodeRemoteAgentHostProtocolPayload(message.payload),
				}));
				return;
		}
	}

	private receiveRequest(message: Extract<RemoteAgentHostTunnelMessage, { readonly kind: 'request' }>): void {
		if (
			this.incomingCalls.has(message.id)
			|| this.completedIncomingCalls.has(message.id)
			|| this.incomingCalls.size >= maximumConcurrentCalls
		) {
			this.protocolErrorEmitter.fire(this.protocolError('request.id', message.id));
			return;
		}
		const argument = message.argument === undefined
			? undefined
			: decodeRemoteAgentHostProtocolPayload(message.argument);
		const cancellation = new CancellationTokenSource();
		this.incomingCalls.set(message.id, cancellation);
		void this.executeRequest(message, argument, cancellation).catch(error => {
			this.protocolErrorEmitter.fire(error instanceof AgentHostError
				? error
				: this.protocolError('request.send', 'failed'));
		});
	}

	private async executeRequest(
		message: Extract<RemoteAgentHostTunnelMessage, { readonly kind: 'request' }>,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationTokenSource,
	): Promise<void> {
		try {
			const value = await this.requestHandler.call(
				message.target,
				message.command,
				argument,
				cancellation.token,
			);
			if (this.incomingCalls.get(message.id) === cancellation) {
				await this.send({
					kind: 'response',
					id: message.id,
					payload: encodeRemoteAgentHostProtocolSuccess(value),
				});
			}
		} catch (error) {
			if (this.incomingCalls.get(message.id) === cancellation) {
				const protocolError = error instanceof AgentHostError
					? error
					: this.protocolError('request', 'failed');
				await this.send({
					kind: 'response',
					id: message.id,
					payload: encodeRemoteAgentHostProtocolError(protocolError),
				});
			}
		} finally {
			if (this.incomingCalls.get(message.id) === cancellation) {
				this.incomingCalls.delete(message.id);
			}
			this.recordCompleted(this.completedIncomingCalls, this.completedIncomingCallOrder, message.id);
			cancellation.dispose();
		}
	}

	private receiveCancellation(id: number): void {
		const cancellation = this.incomingCalls.get(id);
		if (cancellation === undefined) {
			if (!this.completedIncomingCalls.has(id)) {
				this.protocolErrorEmitter.fire(this.protocolError('cancel.id', id));
			}
			return;
		}
		this.incomingCalls.delete(id);
		this.recordCompleted(this.completedIncomingCalls, this.completedIncomingCallOrder, id);
		cancellation.cancel();
		cancellation.dispose();
	}

	private receiveResponse(id: number, payload: string): void {
		const pending = this.pendingCalls.get(id);
		if (pending === undefined) {
			if (!this.completedOutgoingCalls.has(id)) {
				this.protocolErrorEmitter.fire(this.protocolError('response.id', id));
			}
			return;
		}
		this.pendingCalls.delete(id);
		pending.cancellation.dispose();
		this.recordCompleted(this.completedOutgoingCalls, this.completedOutgoingCallOrder, id);
		try {
			pending.resolve(decodeRemoteAgentHostProtocolResponse(payload));
		} catch (error) {
			pending.reject(error);
		}
	}

	private send(message: RemoteAgentHostTunnelMessage): Promise<void> {
		const link = this.link;
		if (link === undefined) {
			return Promise.reject(this.protocolError('link', 'unavailable'));
		}
		return link.send(encodeRemoteAgentHostTunnelMessage(message));
	}

	private allocateCallId(): number {
		for (let offset = 0; offset < Number.MAX_SAFE_INTEGER; offset += 1) {
			const id = this.nextCallId;
			this.nextCallId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
			if (!this.pendingCalls.has(id) && !this.completedOutgoingCalls.has(id)) {
				return id;
			}
		}
		throw this.protocolError('request.id', 'exhausted');
	}

	private recordCompleted(completed: Set<number>, order: number[], id: number): void {
		if (completed.has(id)) {
			return;
		}
		completed.add(id);
		order.push(id);
		if (order.length > maximumCompletedCalls) {
			const removed = order.shift();
			if (removed !== undefined) {
				completed.delete(removed);
			}
		}
	}

	private protocolError(field: string, value: string | number): AgentHostError {
		return new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Remote Tunnel Agent Host protocol violation',
			{ field, value },
		);
	}
}
