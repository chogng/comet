/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationTokenNone,
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
	toDisposable,
} from 'cs/base/common/lifecycle';
import {
	createRemoteChannelName,
	type IRemoteAuthority,
	type RemoteChannelName,
	type RemoteClientId,
	type RemoteConnectionGeneration,
} from './remoteAuthority.js';
import {
	deserializeRemoteError,
	RemoteError,
	RemoteErrorCode,
	serializeRemoteError,
	type ISerializedRemoteError,
} from './remoteErrors.js';
import type { IRemoteTransport } from './remoteTransport.js';
import type { IRemoteTransportLimits } from './remoteEnvironment.js';

export type RemoteValue = null | boolean | number | string | readonly RemoteValue[] | IRemoteObjectValue;

export interface IRemoteObjectValue {
	readonly [key: string]: RemoteValue;
}

export interface IRemoteChannelContext {
	readonly authority: IRemoteAuthority;
	readonly client: RemoteClientId;
	readonly generation: RemoteConnectionGeneration;
}

export interface IRemoteChannelServer {
	call(
		context: IRemoteChannelContext,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken,
	): Promise<RemoteValue>;
	listen(
		context: IRemoteChannelContext,
		event: string,
		argument: RemoteValue | undefined,
	): Event<RemoteValue>;
}

export interface IRemoteChannelListener extends IDisposable {
	readonly onDidReceive: Event<RemoteValue>;
	readonly onDidError: Event<RemoteError>;
}

export interface IRemoteChannel {
	call<TResult extends RemoteValue = RemoteValue>(
		command: string,
		argument?: RemoteValue,
		cancellation?: CancellationToken,
	): Promise<TResult>;
	listen(event: string, argument?: RemoteValue): IRemoteChannelListener;
}

type RemoteMessage =
	| { readonly kind: 'call'; readonly id: number; readonly channel: string; readonly name: string; readonly argument?: RemoteValue }
	| { readonly kind: 'cancel'; readonly id: number }
	| { readonly kind: 'callResult'; readonly id: number; readonly result: RemoteValue }
	| { readonly kind: 'callError'; readonly id: number; readonly error: ISerializedRemoteError }
	| { readonly kind: 'listen'; readonly id: number; readonly channel: string; readonly name: string; readonly argument?: RemoteValue }
	| { readonly kind: 'event'; readonly id: number; readonly value: RemoteValue }
	| { readonly kind: 'listenError'; readonly id: number; readonly error: ISerializedRemoteError }
	| { readonly kind: 'dispose'; readonly id: number }
	| { readonly kind: 'protocolError'; readonly error: ISerializedRemoteError };

interface IRemoteWireFrame {
	readonly generation: number;
	readonly message: RemoteMessage;
}

interface IPendingCall {
	readonly resolve: (value: RemoteValue) => void;
	readonly reject: (error: RemoteError) => void;
	readonly cancellation: IDisposable;
}

interface IIncomingCall {
	readonly cancellation: CancellationTokenSource;
	readonly generation: number;
}

const remoteErrorCodes = new Set<string>(Object.values(RemoteErrorCode));

function utf8Length(value: string): number {
	let length = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x7f) {
			length += 1;
		} else if (code <= 0x7ff) {
			length += 2;
		} else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				length += 4;
				index += 1;
			} else {
				length += 3;
			}
		} else {
			length += 3;
		}
	}
	return length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRemoteValue(value: unknown, depth = 0, visited = new Set<object>()): value is RemoteValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return true;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value);
	}
	if (typeof value !== 'object' || depth >= 32 || visited.has(value)) {
		return false;
	}

	visited.add(value);
	const entries = Array.isArray(value) ? value : Object.values(value);
	if (entries.length > 4096) {
		return false;
	}
	for (const entry of entries) {
		if (!isRemoteValue(entry, depth + 1, visited)) {
			return false;
		}
	}
	visited.delete(value);
	return true;
}

function assertRemoteValue(value: RemoteValue): void {
	if (!isRemoteValue(value)) {
		throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Invalid Remote channel value');
	}
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isBoundedName(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= 128;
}

function readOptionalRemoteValue(record: Record<string, unknown>, key: string): RemoteValue | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (!isRemoteValue(value)) {
		throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote frame contains an invalid value', { field: key });
	}
	return value;
}

function readSerializedError(value: unknown): ISerializedRemoteError {
	if (!isRecord(value) || typeof value.code !== 'string' || !remoteErrorCodes.has(value.code) || !isRecord(value.data)) {
		throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote frame contains an invalid error');
	}

	const data: Record<string, string | number | boolean> = {};
	for (const [key, entry] of Object.entries(value.data)) {
		if (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
			throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote frame contains invalid error data', { field: key });
		}
		data[key] = entry;
	}

	return {
		code: value.code as RemoteErrorCode,
		data,
	};
}

function readMessage(value: unknown): RemoteMessage {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote frame has no message kind');
	}

	switch (value.kind) {
		case 'call':
		case 'listen': {
			if (!isPositiveInteger(value.id) || !isBoundedName(value.channel) || !isBoundedName(value.name)) {
				throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote request frame is invalid');
			}
			return {
				kind: value.kind,
				id: value.id,
				channel: value.channel,
				name: value.name,
				...(value.argument === undefined ? {} : { argument: readOptionalRemoteValue(value, 'argument') }),
			};
		}
		case 'cancel':
		case 'dispose':
			if (!isPositiveInteger(value.id)) {
				throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote control frame is invalid');
			}
			return { kind: value.kind, id: value.id };
		case 'callResult':
		case 'event': {
			const field = value.kind === 'callResult' ? 'result' : 'value';
			if (!isPositiveInteger(value.id) || !isRemoteValue(value[field])) {
				throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote result frame is invalid');
			}
			return value.kind === 'callResult'
				? { kind: value.kind, id: value.id, result: value.result as RemoteValue }
				: { kind: value.kind, id: value.id, value: value.value as RemoteValue };
		}
		case 'callError':
		case 'listenError':
			if (!isPositiveInteger(value.id)) {
				throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote error frame is invalid');
			}
			return { kind: value.kind, id: value.id, error: readSerializedError(value.error) };
		case 'protocolError':
			return { kind: value.kind, error: readSerializedError(value.error) };
		default:
			throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Unknown Remote message kind', {
				kind: value.kind.slice(0, 128),
			});
	}
}

function decodeFrame(payload: string, maximumFrameBytes: number): IRemoteWireFrame {
	const bytes = utf8Length(payload);
	if (bytes > maximumFrameBytes) {
		throw new RemoteError(RemoteErrorCode.FrameTooLarge, 'Remote frame exceeds the negotiated limit', {
			bytes,
			maximum: maximumFrameBytes,
		});
	}

	let value: unknown;
	try {
		value = JSON.parse(payload);
	} catch {
		throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote frame is not valid JSON');
	}
	if (!isRecord(value) || !isPositiveInteger(value.generation)) {
		throw new RemoteError(RemoteErrorCode.MalformedFrame, 'Remote frame generation is invalid');
	}

	return {
		generation: value.generation,
		message: readMessage(value.message),
	};
}

function encodeFrame(frame: IRemoteWireFrame, maximumFrameBytes: number): string {
	const payload = JSON.stringify(frame);
	const bytes = utf8Length(payload);
	if (bytes > maximumFrameBytes) {
		throw new RemoteError(RemoteErrorCode.FrameTooLarge, 'Remote frame exceeds the negotiated limit', {
			bytes,
			maximum: maximumFrameBytes,
		});
	}
	return payload;
}

function asRemoteError(error: unknown): RemoteError {
	if (error instanceof RemoteError) {
		return error;
	}
	return new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote channel implementation failed');
}

class RemoteChannelListener extends Disposable implements IRemoteChannelListener {
	private readonly receiveEmitter = this._register(new EventEmitter<RemoteValue>({ onListenerError: onUnexpectedError }));
	private readonly errorEmitter = this._register(new EventEmitter<RemoteError>({ onListenerError: onUnexpectedError }));
	private disposed = false;
	private terminalError: RemoteError | undefined;

	readonly onDidReceive = this.receiveEmitter.event;
	readonly onDidError: Event<RemoteError> = (listener, thisArgs, disposables) => {
		if (!this.terminalError) {
			return this.errorEmitter.event(listener, thisArgs, disposables);
		}

		try {
			listener.call(thisArgs, this.terminalError);
		} catch (error) {
			onUnexpectedError(error);
		}
		const disposable = toDisposable(() => {});
		if (disposables instanceof DisposableStore) {
			disposables.add(disposable);
		} else {
			disposables?.push(disposable);
		}
		return disposable;
	};

	constructor(private readonly disposeListener: () => void) {
		super();
	}

	receive(value: RemoteValue): void {
		if (!this.disposed) {
			this.receiveEmitter.fire(value);
		}
	}

	fail(error: RemoteError): void {
		if (this.disposed) {
			return;
		}
		this.terminalError = error;
		this.errorEmitter.fire(error);
		this.dispose();
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		try {
			this.disposeListener();
		} finally {
			super.dispose();
		}
	}
}

/** Multiplexes exact named calls and event subscriptions in both directions. */
export class RemoteChannelMultiplexer extends Disposable {
	private readonly protocolErrorEmitter = this._register(new EventEmitter<RemoteError>());
	private readonly channels = new Map<RemoteChannelName, IRemoteChannelServer>();
	private readonly pendingCalls = new Map<number, IPendingCall>();
	private readonly incomingCalls = new Map<number, IIncomingCall>();
	private readonly outgoingListeners = new Map<number, RemoteChannelListener>();
	private readonly incomingListeners = new Map<number, IDisposable>();
	private readonly transportSubscriptions = this._register(new MutableDisposable<DisposableStore>());
	private transport: IRemoteTransport | undefined;
	private generation: RemoteConnectionGeneration | undefined;
	private nextRequestId = 1;
	private nextListenerId = 1;
	private disposed = false;

	readonly onDidProtocolError = this.protocolErrorEmitter.event;

	constructor(
		private readonly authority: IRemoteAuthority,
		private readonly client: RemoteClientId,
		private readonly limits: IRemoteTransportLimits,
	) {
		super();
	}

	registerChannel(name: string, channel: IRemoteChannelServer): IDisposable {
		const channelName = createRemoteChannelName(name);
		if (this.channels.has(channelName)) {
			throw new RemoteError(RemoteErrorCode.DuplicateChannel, 'Remote channel is already registered', {
				channel: channelName,
			});
		}
		this.channels.set(channelName, channel);
		return toDisposable(() => {
			if (this.channels.get(channelName) === channel) {
				this.channels.delete(channelName);
			}
		});
	}

	getChannel(name: string): IRemoteChannel {
		const channel = createRemoteChannelName(name);
		return {
			call: <TResult extends RemoteValue>(command: string, argument?: RemoteValue, cancellation?: CancellationToken) =>
				this.call<TResult>(channel, command, argument, cancellation),
			listen: (event: string, argument?: RemoteValue) => this.listen(channel, event, argument),
		};
	}

	attach(generation: RemoteConnectionGeneration, transport: IRemoteTransport): void {
		if (this.transport) {
			throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Remote multiplexer already has a transport', {
				generation,
			});
		}
		this.transport = transport;
		this.generation = generation;
		const subscriptions = new DisposableStore();
		subscriptions.add(transport.onDidReceivePayload(payload => this.receivePayload(payload)));
		this.transportSubscriptions.value = subscriptions;
	}

	detach(error: RemoteError): void {
		this.transportSubscriptions.clear();
		this.transport = undefined;
		this.generation = undefined;

		for (const pending of this.pendingCalls.values()) {
			pending.cancellation.dispose();
			pending.reject(error);
		}
		this.pendingCalls.clear();

		for (const listener of [...this.outgoingListeners.values()]) {
			listener.fail(error);
		}
		this.outgoingListeners.clear();

		for (const call of this.incomingCalls.values()) {
			call.cancellation.cancel();
			call.cancellation.dispose();
		}
		this.incomingCalls.clear();

		for (const listener of this.incomingListeners.values()) {
			listener.dispose();
		}
		this.incomingListeners.clear();
	}

	private call<TResult extends RemoteValue>(
		channel: RemoteChannelName,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken = CancellationTokenNone,
	): Promise<TResult> {
		this.assertAvailable();
		if (!isBoundedName(command)) {
			return Promise.reject(new RemoteError(RemoteErrorCode.ProtocolViolation, 'Invalid Remote command name'));
		}
		if (argument !== undefined) {
			assertRemoteValue(argument);
		}
		if (cancellation.isCancellationRequested) {
			return Promise.reject(new RemoteError(RemoteErrorCode.OperationCancelled, 'Remote call was cancelled'));
		}
		if (this.pendingCalls.size >= this.limits.maximumPendingCalls) {
			return Promise.reject(new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote pending-call limit exceeded'));
		}

		const id = this.allocateRequestId();
		return new Promise<TResult>((resolve, reject) => {
			const cancellationListener = cancellation.onCancellationRequested(() => {
				if (this.pendingCalls.has(id)) {
					this.send({ kind: 'cancel', id });
				}
			});
			this.pendingCalls.set(id, {
				resolve: value => resolve(value as TResult),
				reject,
				cancellation: cancellationListener,
			});
			try {
				this.send({
					kind: 'call',
					id,
					channel,
					name: command,
					...(argument === undefined ? {} : { argument }),
				});
			} catch (error) {
				this.pendingCalls.delete(id);
				cancellationListener.dispose();
				reject(asRemoteError(error));
			}
		});
	}

	private listen(channel: RemoteChannelName, event: string, argument: RemoteValue | undefined): IRemoteChannelListener {
		this.assertAvailable();
		if (!isBoundedName(event)) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Invalid Remote event name');
		}
		if (argument !== undefined) {
			assertRemoteValue(argument);
		}
		if (this.outgoingListeners.size >= this.limits.maximumEventListeners) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote event-listener limit exceeded');
		}

		const id = this.allocateListenerId();
		const listener = new RemoteChannelListener(() => {
			if (this.outgoingListeners.delete(id) && this.transport) {
				this.send({ kind: 'dispose', id });
			}
		});
		this.outgoingListeners.set(id, listener);
		try {
			this.send({
				kind: 'listen',
				id,
				channel,
				name: event,
				...(argument === undefined ? {} : { argument }),
			});
		} catch (error) {
			this.outgoingListeners.delete(id);
			listener.fail(asRemoteError(error));
		}
		return listener;
	}

	private receivePayload(payload: string): void {
		try {
			const frame = decodeFrame(payload, this.limits.maximumFrameBytes);
			if (frame.generation !== this.generation) {
				throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Remote frame uses another generation', {
					expected: this.generation ?? 0,
					received: frame.generation,
				});
			}
			this.receive(frame.message);
		} catch (error) {
			this.protocolErrorEmitter.fire(asRemoteError(error));
		}
	}

	private receive(message: RemoteMessage): void {
		switch (message.kind) {
			case 'call':
				this.receiveCall(message);
				return;
			case 'cancel':
				this.receiveCancellation(message.id);
				return;
			case 'callResult':
				this.receiveCallResult(message.id, message.result);
				return;
			case 'callError':
				this.receiveCallError(message.id, deserializeRemoteError(message.error));
				return;
			case 'listen':
				this.receiveListen(message);
				return;
			case 'event':
				this.receiveEvent(message.id, message.value);
				return;
			case 'listenError':
				this.receiveListenError(message.id, deserializeRemoteError(message.error));
				return;
			case 'dispose':
				this.receiveDispose(message.id);
				return;
			case 'protocolError':
				this.protocolErrorEmitter.fire(deserializeRemoteError(message.error));
				return;
		}
	}

	private receiveCall(message: Extract<RemoteMessage, { readonly kind: 'call' }>): void {
		if (this.incomingCalls.has(message.id)) {
			this.sendCallError(message.id, new RemoteError(RemoteErrorCode.DuplicateOperation, 'Duplicate Remote call', {
				operation: message.id,
			}));
			return;
		}
		if (this.incomingCalls.size >= this.limits.maximumPendingCalls) {
			this.sendCallError(message.id, new RemoteError(
				RemoteErrorCode.ProtocolViolation,
				'Remote incoming-call limit exceeded',
			));
			return;
		}

		const channel = this.channels.get(createRemoteChannelName(message.channel));
		if (!channel) {
			this.sendCallError(message.id, new RemoteError(RemoteErrorCode.ChannelMissing, 'Remote channel is not registered', {
				channel: message.channel,
			}));
			return;
		}

		const cancellation = new CancellationTokenSource();
		const generation = this.generation as RemoteConnectionGeneration;
		this.incomingCalls.set(message.id, { cancellation, generation });
		void this.executeIncomingCall(message, channel, cancellation, generation);
	}

	private async executeIncomingCall(
		message: Extract<RemoteMessage, { readonly kind: 'call' }>,
		channel: IRemoteChannelServer,
		cancellation: CancellationTokenSource,
		generation: RemoteConnectionGeneration,
	): Promise<void> {
		try {
			const result = await channel.call(this.createContext(generation), message.name, message.argument, cancellation.token);
			assertRemoteValue(result);
			if (this.incomingCalls.get(message.id)?.cancellation === cancellation) {
				this.send({ kind: 'callResult', id: message.id, result });
			}
		} catch (error) {
			if (this.incomingCalls.get(message.id)?.cancellation === cancellation) {
				this.sendCallError(message.id, asRemoteError(error));
			}
		} finally {
			if (this.incomingCalls.get(message.id)?.cancellation === cancellation) {
				this.incomingCalls.delete(message.id);
			}
			cancellation.dispose();
		}
	}

	private receiveCancellation(id: number): void {
		const call = this.incomingCalls.get(id);
		if (!call) {
			// Cancellation is best effort. The terminal response may already be in flight.
			return;
		}

		this.incomingCalls.delete(id);
		call.cancellation.cancel();
		call.cancellation.dispose();
		this.sendCallError(id, new RemoteError(RemoteErrorCode.OperationCancelled, 'Remote call was cancelled'));
	}

	private receiveCallResult(id: number, result: RemoteValue): void {
		const pending = this.pendingCalls.get(id);
		if (!pending) {
			this.sendProtocolError(new RemoteError(RemoteErrorCode.OperationMissing, 'Remote call result has no request', {
				operation: id,
			}));
			return;
		}
		this.pendingCalls.delete(id);
		pending.cancellation.dispose();
		pending.resolve(result);
	}

	private receiveCallError(id: number, error: RemoteError): void {
		const pending = this.pendingCalls.get(id);
		if (!pending) {
			this.sendProtocolError(new RemoteError(RemoteErrorCode.OperationMissing, 'Remote call error has no request', {
				operation: id,
			}));
			return;
		}
		this.pendingCalls.delete(id);
		pending.cancellation.dispose();
		pending.reject(error);
	}

	private receiveListen(message: Extract<RemoteMessage, { readonly kind: 'listen' }>): void {
		if (this.incomingListeners.has(message.id)) {
			this.sendListenError(message.id, new RemoteError(RemoteErrorCode.DuplicateOperation, 'Duplicate Remote listener', {
				operation: message.id,
			}));
			return;
		}
		if (this.incomingListeners.size >= this.limits.maximumEventListeners) {
			this.sendListenError(message.id, new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote listener limit exceeded'));
			return;
		}

		const channel = this.channels.get(createRemoteChannelName(message.channel));
		if (!channel) {
			this.sendListenError(message.id, new RemoteError(RemoteErrorCode.ChannelMissing, 'Remote channel is not registered', {
				channel: message.channel,
			}));
			return;
		}

		let failed = false;
		try {
			const generation = this.generation as RemoteConnectionGeneration;
			const event = channel.listen(this.createContext(generation), message.name, message.argument);
			const subscription = event(value => {
				if (failed) {
					return;
				}
				try {
					assertRemoteValue(value);
					this.send({ kind: 'event', id: message.id, value });
				} catch (error) {
					failed = true;
					const active = this.incomingListeners.get(message.id);
					if (active !== undefined) {
						this.incomingListeners.delete(message.id);
						active.dispose();
					}
					this.sendListenError(message.id, asRemoteError(error));
				}
			});
			if (failed) {
				subscription.dispose();
				return;
			}
			this.incomingListeners.set(message.id, subscription);
		} catch (error) {
			if (!failed) {
				this.sendListenError(message.id, asRemoteError(error));
			}
		}
	}

	private receiveEvent(id: number, value: RemoteValue): void {
		const listener = this.outgoingListeners.get(id);
		if (!listener) {
			this.sendProtocolError(new RemoteError(RemoteErrorCode.OperationMissing, 'Remote event has no listener', {
				operation: id,
			}));
			return;
		}
		listener.receive(value);
	}

	private receiveListenError(id: number, error: RemoteError): void {
		const listener = this.outgoingListeners.get(id);
		if (!listener) {
			this.sendProtocolError(new RemoteError(RemoteErrorCode.OperationMissing, 'Remote listener error has no request', {
				operation: id,
			}));
			return;
		}
		this.outgoingListeners.delete(id);
		listener.fail(error);
	}

	private receiveDispose(id: number): void {
		const listener = this.incomingListeners.get(id);
		if (!listener) {
			this.sendProtocolError(new RemoteError(RemoteErrorCode.OperationMissing, 'Remote listener is not active', {
				operation: id,
			}));
			return;
		}
		this.incomingListeners.delete(id);
		listener.dispose();
	}

	private createContext(generation: RemoteConnectionGeneration): IRemoteChannelContext {
		return Object.freeze({
			authority: this.authority,
			client: this.client,
			generation,
		});
	}

	private sendCallError(id: number, error: RemoteError): void {
		this.send({ kind: 'callError', id, error: serializeRemoteError(error) });
	}

	private sendListenError(id: number, error: RemoteError): void {
		this.send({ kind: 'listenError', id, error: serializeRemoteError(error) });
	}

	private sendProtocolError(error: RemoteError): void {
		this.send({ kind: 'protocolError', error: serializeRemoteError(error) });
	}

	private send(message: RemoteMessage): void {
		this.assertAvailable();
		const payload = encodeFrame({
			generation: this.generation as RemoteConnectionGeneration,
			message,
		}, this.limits.maximumFrameBytes);
		const transport = this.transport as IRemoteTransport;
		try {
			transport.send(payload);
		} catch (error) {
			const remoteError = asRemoteError(error);
			if (remoteError.code === RemoteErrorCode.TransportUnavailable) {
				transport.close({ kind: 'lost', error: serializeRemoteError(remoteError) });
			} else {
				this.protocolErrorEmitter.fire(remoteError);
			}
			throw remoteError;
		}
	}

	private assertAvailable(): void {
		if (!this.transport || this.generation === undefined || this.disposed) {
			throw new RemoteError(RemoteErrorCode.TransportUnavailable, 'Remote transport is unavailable');
		}
	}

	private allocateRequestId(): number {
		const id = this.nextRequestId;
		this.nextRequestId += 1;
		if (!Number.isSafeInteger(this.nextRequestId)) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote request identity exhausted');
		}
		return id;
	}

	private allocateListenerId(): number {
		const id = this.nextListenerId;
		this.nextListenerId += 1;
		if (!Number.isSafeInteger(this.nextListenerId)) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote listener identity exhausted');
		}
		return id;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.detach(new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote multiplexer was disposed'));
		this.channels.clear();
		super.dispose();
	}
}
