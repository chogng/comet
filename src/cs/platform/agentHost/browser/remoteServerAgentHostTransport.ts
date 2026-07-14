/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Event, EventEmitter, type Event as EventType } from 'cs/base/common/event';
import { Disposable, DisposableStore, MutableDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	type IAgentContentBlobReadRequest,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentTreeEntryReadRequest,
	type IAgentContentTreePageRequest,
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResultShape,
	assertAgentContentResourceLease,
	assertAgentContentResourceReaderOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from '../common/contentResources.js';
import { AgentHostError } from '../common/errors.js';
import { createAgentContentLeaseId, type AgentHostClientConnectionId } from '../common/identities.js';
import {
	decodeRemoteAgentHostAction,
	decodeRemoteAgentHostProtocolPayload,
	decodeRemoteAgentHostProtocolResponse,
	encodeRemoteAgentHostProtocolError,
	encodeRemoteAgentHostProtocolPayload,
	encodeRemoteAgentHostProtocolSuccess,
	remoteAgentHostClientContentResourceChannelName,
	remoteAgentHostClientToolChannelName,
	remoteAgentHostProtocolActionEvent,
	remoteServerAgentHostCapability,
	remoteServerAgentHostChannelName,
	type RemoteAgentHostProtocolCommand,
} from '../common/remoteProtocol.js';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from '../common/protocolValues.js';
import {
	type IAgentClientToolInvocation,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	assertAgentClientToolInvocation,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from '../common/tools.js';
import type { IClientContentResourceService } from './clientContentResources.js';
import {
	type IRemoteAgentHostClientToolEndpoint,
	type IRemoteAgentHostProtocolTransport,
	type IRemoteAgentHostTransportStateChange,
	type RemoteAgentHostTransportState,
} from './remoteAgentHostConnection.js';
import { isEqualRemoteAuthority } from 'cs/platform/remote/common/remoteAuthority';
import {
	type IRemoteChannelContext,
	type IRemoteChannelServer,
	type RemoteValue,
} from 'cs/platform/remote/common/remoteChannels';
import type { IRemoteServerConnection } from 'cs/platform/remote/common/remoteConnection';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';

function isTransportInterruption(error: unknown): boolean {
	return error instanceof RemoteError
		&& (error.code === RemoteErrorCode.TransportUnavailable
			|| error.code === RemoteErrorCode.ConnectionTerminal);
}

function requireString(value: RemoteValue | undefined, field: string): string {
	if (typeof value !== 'string') {
		throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote Agent Host channel value must be a string', {
			field,
		});
	}
	return value;
}

function protocolValue(value: object): AgentHostProtocolValue {
	assertAgentHostProtocolValue(value);
	return value as unknown as AgentHostProtocolValue;
}

abstract class RemoteAgentHostClientChannel extends Disposable implements IRemoteChannelServer {
	constructor(protected readonly remoteConnection: IRemoteServerConnection) {
		super();
	}

	abstract call(
		context: IRemoteChannelContext,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken,
	): Promise<RemoteValue>;

	abstract listen(
		context: IRemoteChannelContext,
		event: string,
		argument: RemoteValue | undefined,
	): EventType<RemoteValue>;

	protected assertContext(context: IRemoteChannelContext): void {
		if (
			!isEqualRemoteAuthority(context.authority, this.remoteConnection.authority)
			|| context.client !== this.remoteConnection.client
			|| context.generation !== this.remoteConnection.generation
			|| this.remoteConnection.state !== 'connected'
		) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote reverse channel context is not exact', {
				generation: context.generation,
			});
		}
	}

	protected async execute(
		argument: RemoteValue | undefined,
		field: string,
		run: (value: AgentHostProtocolValue) => Promise<AgentHostProtocolValue>,
	): Promise<RemoteValue> {
		try {
			const value = decodeRemoteAgentHostProtocolPayload(requireString(argument, field));
			return encodeRemoteAgentHostProtocolSuccess(await run(value));
		} catch (error) {
			if (error instanceof AgentHostError) {
				return encodeRemoteAgentHostProtocolError(error);
			}
			throw error;
		}
	}
}

class RemoteClientContentResourceChannel extends RemoteAgentHostClientChannel {
	constructor(
		remoteConnection: IRemoteServerConnection,
		private readonly resources: IClientContentResourceService,
	) {
		super(remoteConnection);
	}

	async call(
		context: IRemoteChannelContext,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken,
	): Promise<RemoteValue> {
		this.assertContext(context);
		return this.execute(argument, command, async value => {
			switch (command) {
				case 'open':
					assertAgentContentResourceReaderOpenRequest(value);
					return this.validateOpen(value, protocolValue(await this.resources.open(value, cancellation)));
				case 'readBlob':
					assertAgentContentBlobReadRequest(value);
					return this.validateBlob(value, protocolValue(await this.resources.readBlob(value, cancellation)));
				case 'readTreePage':
					assertAgentContentTreePageRequest(value);
					return this.validateTreePage(value, protocolValue(await this.resources.readTreePage(value, cancellation)));
				case 'readTreeEntry':
					assertAgentContentTreeEntryReadRequest(value);
					return this.validateTreeEntry(value, protocolValue(await this.resources.readTreeEntry(value, cancellation)));
				case 'release':
					if (typeof value !== 'string') {
						throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Content lease identity must be a string');
					}
					await this.resources.release(createAgentContentLeaseId(value), cancellation);
					return null;
				default:
					throw new RemoteError(RemoteErrorCode.CommandMissing, 'Client content command is not registered', {
						command: command.slice(0, 128),
					});
			}
		});
	}

	listen(_context: IRemoteChannelContext, event: string): EventType<RemoteValue> {
		throw new RemoteError(RemoteErrorCode.EventMissing, 'Client content channel exposes no events', {
			event: event.slice(0, 128),
		});
	}

	private validateOpen(request: IAgentContentResourceReaderOpenRequest, result: AgentHostProtocolValue): AgentHostProtocolValue {
		assertAgentContentResourceLease(result, request);
		return result;
	}

	private validateBlob(request: IAgentContentBlobReadRequest, result: AgentHostProtocolValue): AgentHostProtocolValue {
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	private validateTreePage(request: IAgentContentTreePageRequest, result: AgentHostProtocolValue): AgentHostProtocolValue {
		assertAgentContentTreePage(result, request);
		return result;
	}

	private validateTreeEntry(request: IAgentContentTreeEntryReadRequest, result: AgentHostProtocolValue): AgentHostProtocolValue {
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}
}

class RemoteClientAgentToolChannel extends RemoteAgentHostClientChannel {
	private readonly progressEmitter = this._register(new EventEmitter<IAgentToolProgress>({
		onListenerError: onUnexpectedError,
	}));

	constructor(
		remoteConnection: IRemoteServerConnection,
		private readonly tools: IAgentToolExecutorEndpoint,
	) {
		super(remoteConnection);
	}

	async call(
		context: IRemoteChannelContext,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken,
	): Promise<RemoteValue> {
		this.assertContext(context);
		return this.execute(argument, command, async value => {
			switch (command) {
				case 'execute': {
					assertAgentClientToolInvocation(value);
					const invocation = value as IAgentClientToolInvocation;
					const result = await this.tools.execute(
						invocation.call,
						invocation.target,
						progress => {
							assertAgentToolProgress(progress);
							this.progressEmitter.fire(progress);
						},
						cancellation,
					);
					assertAgentToolResult(result);
					return protocolValue(result);
				}
				case 'cancel':
					assertAgentToolCall(value);
					await this.tools.cancel(value as IAgentToolCall);
					return null;
				case 'reconcile': {
					assertAgentToolCall(value);
					const result = await this.tools.reconcile(value as IAgentToolCall);
					assertAgentToolEndpointReconciliation(result);
					return protocolValue(result);
				}
				default:
					throw new RemoteError(RemoteErrorCode.CommandMissing, 'Client Tool command is not registered', {
						command: command.slice(0, 128),
					});
			}
		});
	}

	listen(
		context: IRemoteChannelContext,
		event: string,
		argument: RemoteValue | undefined,
	): EventType<RemoteValue> {
		this.assertContext(context);
		if (event !== 'onDidProgress' || argument !== undefined) {
			throw new RemoteError(RemoteErrorCode.EventMissing, 'Client Tool event is not registered', {
				event: event.slice(0, 128),
			});
		}
		return Event.map(this.progressEmitter.event, progress => encodeRemoteAgentHostProtocolPayload(progress));
	}
}

/** Carries the common Agent Host protocol over one shared Remote Server channel. */
export class RemoteServerAgentHostTransport extends Disposable implements IRemoteAgentHostProtocolTransport {
	private readonly actionEmitter = this._register(new EventEmitter<ReturnType<typeof decodeRemoteAgentHostAction>>({
		onListenerError: onUnexpectedError,
	}));
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteAgentHostTransportStateChange>({
		onListenerError: onUnexpectedError,
	}));
	private readonly actionBinding = this._register(new MutableDisposable<DisposableStore>());
	private clientEndpointsBound = false;
	private lastBoundGeneration: number;
	private protocolFailed = false;
	private transportState: RemoteAgentHostTransportState = 'connected';

	readonly onDidReceiveAction = this.actionEmitter.event;
	readonly onDidChangeState = this.stateEmitter.event;

	constructor(private readonly remoteConnection: IRemoteServerConnection) {
		super();
		if (
			remoteConnection.state !== 'connected'
			|| !remoteConnection.environment.capabilities.includes(remoteServerAgentHostCapability)
		) {
			throw new RemoteError(RemoteErrorCode.ChannelMissing, 'Remote Server does not advertise Agent Host');
		}
		this.lastBoundGeneration = remoteConnection.generation;
		this.bindActions();
		this._register(remoteConnection.onDidChangeState(change => {
			try {
				if (change.state === 'reconnecting') {
					this.actionBinding.clear();
					this.setState('restoring', change.generation);
					return;
				}
				if (change.state === 'terminal' || change.state === 'disposed') {
					this.actionBinding.clear();
					this.setState('terminal', change.generation);
					return;
				}
				if (change.generation <= this.lastBoundGeneration) {
					this.failProtocol(new RemoteError(
						RemoteErrorCode.GenerationConflict,
						'Remote Agent Host generation did not advance',
					));
					return;
				}
				this.lastBoundGeneration = change.generation;
				this.bindActions();
				this.setState('connected', change.generation);
			} catch (error) {
				this.failProtocol(error);
			}
		}));
	}

	get generation(): number {
		return this.remoteConnection.generation;
	}

	get state(): RemoteAgentHostTransportState {
		return this.transportState;
	}

	async call(
		command: RemoteAgentHostProtocolCommand,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		if (this.transportState !== 'connected' || this.remoteConnection.state !== 'connected') {
			throw new RemoteError(RemoteErrorCode.TransportUnavailable, 'Remote Agent Host transport is unavailable');
		}
		const result = await this.remoteConnection.getChannel(remoteServerAgentHostChannelName).call(
			command,
			argument === undefined ? undefined : encodeRemoteAgentHostProtocolPayload(argument),
			cancellation,
		);
		return decodeRemoteAgentHostProtocolResponse(requireString(result, `${command}.result`));
	}

	bindClientEndpoints(
		connection: AgentHostClientConnectionId,
		contentResources: IClientContentResourceService,
		tools: IRemoteAgentHostClientToolEndpoint,
	): IDisposable {
		if (this.clientEndpointsBound) {
			throw new RemoteError(RemoteErrorCode.DuplicateChannel, 'Remote Agent Host client endpoints are already bound');
		}
		if (contentResources.connection !== connection || tools.connection !== connection) {
			throw new RemoteError(
				RemoteErrorCode.ConnectionMismatch,
				'Remote Agent Host client endpoints address another connection',
			);
		}
		this.clientEndpointsBound = true;
		const binding = new DisposableStore();
		try {
			binding.add(this.remoteConnection.registerChannel(
				remoteAgentHostClientContentResourceChannelName,
				binding.add(new RemoteClientContentResourceChannel(this.remoteConnection, contentResources)),
			));
			binding.add(this.remoteConnection.registerChannel(
				remoteAgentHostClientToolChannelName,
				binding.add(new RemoteClientAgentToolChannel(this.remoteConnection, tools)),
			));
			return binding;
		} catch (error) {
			binding.dispose();
			this.clientEndpointsBound = false;
			throw error;
		}
	}

	private bindActions(): void {
		const binding = new DisposableStore();
		const listener = binding.add(this.remoteConnection.getChannel(remoteServerAgentHostChannelName).listen(
			remoteAgentHostProtocolActionEvent,
		));
		binding.add(listener.onDidReceive(value => {
			try {
				this.actionEmitter.fire(decodeRemoteAgentHostAction(requireString(value, remoteAgentHostProtocolActionEvent)));
			} catch (error) {
				this.failProtocol(error);
			}
		}));
		binding.add(listener.onDidError(error => {
			if (!isTransportInterruption(error) && this.remoteConnection.state === 'connected') {
				this.failProtocol(error);
			}
		}));
		this.actionBinding.value = binding;
	}

	private failProtocol(error: unknown): void {
		if (this.protocolFailed) {
			return;
		}
		this.protocolFailed = true;
		this.actionBinding.clear();
		this.setState('terminal', this.remoteConnection.generation);
		onUnexpectedError(error);
		void this.remoteConnection.end().catch(onUnexpectedError);
	}

	private setState(state: RemoteAgentHostTransportState, generation: number): void {
		if (this.transportState === state) {
			return;
		}
		this.transportState = state;
		this.stateEmitter.fire(Object.freeze({ state, generation }));
	}
}
