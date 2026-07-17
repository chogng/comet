/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationTokenNone,
	isCancellationError,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Event, type Event as EventType } from 'cs/base/common/event';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import {
	type IAgentContentBlobReadRequest,
	type IAgentContentBlobReadResult,
	type IAgentContentResourceLease,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentResourceReaderPort,
	type IAgentContentTreeEntryReadRequest,
	type IAgentContentTreePage,
	type IAgentContentTreePageRequest,
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResultShape,
	assertAgentContentResourceLease,
	assertAgentContentResourceReaderOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources.js';
import { AgentHostError } from 'cs/platform/agentHost/common/errors.js';
import {
	createAgentContentLeaseId,
	type AgentContentLeaseId,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities.js';
import {
	decodeRemoteAgentHostProtocolResponse,
	decodeRemoteAgentHostProtocolPayload,
	encodeRemoteAgentHostAction,
	encodeRemoteAgentHostProtocolError,
	encodeRemoteAgentHostProtocolPayload,
	encodeRemoteAgentHostProtocolSuccess,
	remoteAgentHostClientContentResourceChannelName,
	remoteAgentHostClientToolChannelName,
	remoteAgentHostProtocolActionEvent,
	remoteAgentHostProtocolProgressEvent,
	RemoteAgentHostProtocolCommand,
	remoteServerAgentHostChannelName,
} from 'cs/platform/agentHost/common/remoteProtocol.js';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues.js';
import {
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentClientToolInvocation,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	assertAgentClientToolInvocation,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from 'cs/platform/agentHost/common/tools.js';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments.js';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService.js';
import type { AgentHostAuthority } from 'cs/platform/agentHost/node/host/agentHostAuthority.js';
import {
	RemoteAgentHostProtocolServer,
	type IRemoteAgentHostClientToolPublication,
} from 'cs/platform/agentHost/node/remoteAgentHostProtocolServer.js';
import { AgentClientToolPublication } from 'cs/platform/agentHost/node/tools/agentClientToolPublication.js';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution.js';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry.js';
import {
	isEqualRemoteAuthority,
	type RemoteConnectionGeneration,
} from 'cs/platform/remote/common/remoteAuthority';
import {
	type IRemoteChannel,
	type IRemoteChannelContext,
	type IRemoteChannelServer,
	type RemoteValue,
} from 'cs/platform/remote/common/remoteChannels';
import type { IRemoteServerConnection } from 'cs/platform/remote/common/remoteConnection';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';

const remoteAgentHostCommands = new Set<string>(Object.values(RemoteAgentHostProtocolCommand));

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

async function callClientChannel(
	channel: IRemoteChannel,
	command: string,
	argument: AgentHostProtocolValue,
	cancellation: CancellationToken,
): Promise<AgentHostProtocolValue> {
	const payload = encodeRemoteAgentHostProtocolPayload(argument);
	const response = await channel.call(command, payload, cancellation);
	return decodeRemoteAgentHostProtocolResponse(requireString(response, `${command}.result`));
}

class RemoteClientContentResourceReader implements IAgentContentResourceReaderPort {
	constructor(private readonly remoteConnection: IRemoteServerConnection) {}

	async open(
		request: IAgentContentResourceReaderOpenRequest,
		token: CancellationToken,
	): Promise<IAgentContentResourceLease> {
		assertAgentContentResourceReaderOpenRequest(request);
		const result = await callClientChannel(this.channel(), 'open', protocolValue(request), token);
		assertAgentContentResourceLease(result, request);
		return result;
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentBlobReadRequest(request);
		const result = await callClientChannel(this.channel(), 'readBlob', protocolValue(request), token);
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	async readTreePage(
		request: IAgentContentTreePageRequest,
		token: CancellationToken,
	): Promise<IAgentContentTreePage> {
		assertAgentContentTreePageRequest(request);
		const result = await callClientChannel(this.channel(), 'readTreePage', protocolValue(request), token);
		assertAgentContentTreePage(result, request);
		return result;
	}

	async readTreeEntry(
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentTreeEntryReadRequest(request);
		const result = await callClientChannel(this.channel(), 'readTreeEntry', protocolValue(request), token);
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	async release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		createAgentContentLeaseId(lease);
		const result = await callClientChannel(this.channel(), 'release', lease, token);
		if (result !== null) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Client content release returned a non-null result');
		}
	}

	private channel(): IRemoteChannel {
		return this.remoteConnection.getChannel(remoteAgentHostClientContentResourceChannelName);
	}
}

class RemoteClientAgentToolEndpoint extends Disposable implements IAgentToolExecutorEndpoint {
	private readonly progressBinding = this._register(new MutableDisposable<DisposableStore>());
	private readonly activeProgress = new Map<string, (progress: IAgentToolProgress) => void>();
	private progressStarted = false;
	private protocolFailed = false;

	constructor(private readonly remoteConnection: IRemoteServerConnection) {
		super();
		this._register(remoteConnection.onDidChangeState(change => {
			if (change.state === 'connected' && this.progressStarted) {
				this.bindProgress();
			}
		}));
	}

	startProgress(): void {
		if (this.progressStarted) {
			return;
		}
		this.progressStarted = true;
		this.bindProgress();
	}

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		assertAgentToolCall(call);
		const invocation: IAgentClientToolInvocation = Object.freeze({
			call,
			...(target === undefined ? {} : { target }),
		});
		assertAgentClientToolInvocation(invocation);
		if (this.activeProgress.has(call.id)) {
			throw new Error(`Remote client Tool call '${call.id}' is already active`);
		}
		this.activeProgress.set(call.id, reportProgress);
		try {
			const result = await callClientChannel(this.channel(), 'execute', protocolValue(invocation), cancellation);
			assertAgentToolResult(result);
			if (result.call !== call.id) {
				throw new Error(`Remote client Tool result does not address call '${call.id}'`);
			}
			return result;
		} finally {
			this.activeProgress.delete(call.id);
		}
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		assertAgentToolCall(call);
		const result = await callClientChannel(this.channel(), 'cancel', protocolValue(call), CancellationTokenNone);
		if (result !== null) {
			throw new Error(`Remote client Tool cancellation for '${call.id}' returned a non-null result`);
		}
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		assertAgentToolCall(call);
		const value = await callClientChannel(this.channel(), 'reconcile', protocolValue(call), CancellationTokenNone);
		const result: unknown = value;
		assertAgentToolEndpointReconciliation(result);
		if (result.kind === 'terminal' && result.result.call !== call.id) {
			throw new Error(`Remote client Tool reconciliation does not address call '${call.id}'`);
		}
		return result;
	}

	override dispose(): void {
		this.activeProgress.clear();
		super.dispose();
	}

	private bindProgress(): void {
		const binding = new DisposableStore();
		const listener = binding.add(this.channel().listen('onDidProgress'));
		binding.add(listener.onDidReceive(value => {
			try {
				const progress = decodeRemoteAgentHostProtocolPayload(requireString(value, 'onDidProgress'));
				assertAgentToolProgress(progress);
				const report = this.activeProgress.get(progress.call);
				if (report === undefined) {
					throw new Error(`Remote client Tool progress addresses inactive call '${progress.call}'`);
				}
				report(progress);
			} catch (error) {
				this.failProtocol(error);
			}
		}));
		binding.add(listener.onDidError(error => {
			if (!isTransportInterruption(error) && this.remoteConnection.state === 'connected') {
				this.failProtocol(error);
			}
		}));
		this.progressBinding.value = binding;
	}

	private failProtocol(error: unknown): void {
		if (this.protocolFailed) {
			return;
		}
		this.protocolFailed = true;
		onUnexpectedError(error);
		void this.remoteConnection.end().catch(onUnexpectedError);
	}

	private channel(): IRemoteChannel {
		return this.remoteConnection.getChannel(remoteAgentHostClientToolChannelName);
	}
}

class RemoteClientToolPublication extends Disposable implements IRemoteAgentHostClientToolPublication {
	private readonly publication = this._register(new MutableDisposable<AgentClientToolPublication>());

	constructor(
		private readonly connection: AgentHostClientConnectionId,
		private readonly registrations: AgentToolRegistry,
		private readonly endpoints: AgentToolEndpointRegistry,
		private readonly endpoint: RemoteClientAgentToolEndpoint,
	) {
		super();
	}

	synchronize(snapshot: Parameters<AgentClientToolPublication['synchronize']>[0]): void {
		this.endpoint.startProgress();
		if (this.publication.value === undefined) {
			this.publication.value = new AgentClientToolPublication(
				this.connection,
				this.registrations,
				this.endpoints,
				this.endpoint,
			);
		}
		this.publication.value.synchronize(snapshot);
	}
}

/** Directly binds one Remote logical client channel to one Agent Host authority connection. */
export class RemoteServerAgentHostBinding extends Disposable implements IRemoteChannelServer {
	private readonly protocol: RemoteAgentHostProtocolServer;

	constructor(
		authority: Pick<AgentHostAuthority, 'createConnection'>,
		agentHostConnection: AgentHostClientConnectionId,
		private readonly remoteConnection: IRemoteServerConnection,
		contentResources: IAgentContentResourceClientRouter,
		toolRegistry: AgentToolRegistry,
		toolEndpoints: AgentToolEndpointRegistry,
	) {
		super();
		try {
			const toolEndpoint = this._register(new RemoteClientAgentToolEndpoint(remoteConnection));
			const toolPublication = this._register(new RemoteClientToolPublication(
				agentHostConnection,
				toolRegistry,
				toolEndpoints,
				toolEndpoint,
			));
			this._register(contentResources.bindClientReader(
				agentHostConnection,
				new RemoteClientContentResourceReader(remoteConnection),
			));
			this.protocol = this._register(new RemoteAgentHostProtocolServer(
				authority.createConnection(agentHostConnection),
				toolPublication,
			));
			this._register(remoteConnection.registerChannel(remoteServerAgentHostChannelName, this));
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	async call(
		context: IRemoteChannelContext,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken,
	): Promise<RemoteValue> {
		this.assertContext(context);
		if (!remoteAgentHostCommands.has(command)) {
			throw new RemoteError(RemoteErrorCode.CommandMissing, 'Remote Agent Host command is not registered', {
				command: command.slice(0, 128),
			});
		}
		try {
			const value = argument === undefined
				? undefined
				: decodeRemoteAgentHostProtocolPayload(requireString(argument, command));
			const result = await this.protocol.call(command as RemoteAgentHostProtocolCommand, value, cancellation);
			return encodeRemoteAgentHostProtocolSuccess(result);
		} catch (error) {
			if (error instanceof AgentHostError) {
				return encodeRemoteAgentHostProtocolError(error);
			}
			if (isCancellationError(error)) {
				throw new RemoteError(RemoteErrorCode.OperationCancelled, 'Remote Agent Host command was cancelled');
			}
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote Agent Host command failed');
		}
	}

	listen(
		context: IRemoteChannelContext,
		event: string,
		argument: RemoteValue | undefined,
	): EventType<RemoteValue> {
		this.assertContext(context);
		if (argument !== undefined) {
			throw new RemoteError(RemoteErrorCode.EventMissing, 'Remote Agent Host event is not registered', {
				event: event.slice(0, 128),
			});
		}
		if (event === remoteAgentHostProtocolActionEvent) {
			return Event.map(this.protocol.onDidReceiveAction, action => encodeRemoteAgentHostAction(action));
		}
		if (event === remoteAgentHostProtocolProgressEvent) {
			return Event.map(this.protocol.onDidProgress, progress => encodeRemoteAgentHostProtocolPayload(progress));
		}
		throw new RemoteError(RemoteErrorCode.EventMissing, 'Remote Agent Host event is not registered', {
			event: event.slice(0, 128),
		});
	}

	private assertContext(context: IRemoteChannelContext): void {
		if (
			!isEqualRemoteAuthority(context.authority, this.remoteConnection.authority)
			|| context.client !== this.remoteConnection.client
			|| context.generation !== this.remoteConnection.generation
			|| this.remoteConnection.state !== 'connected'
		) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote Agent Host channel context is not exact', {
				generation: context.generation as RemoteConnectionGeneration,
			});
		}
	}
}
