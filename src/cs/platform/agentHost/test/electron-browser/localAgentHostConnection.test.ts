/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { suite, test } from 'node:test';

import type { IpcMainInvokeEvent } from 'electron';

import {
	type CancellationToken,
	CancellationTokenCancelled,
	CancellationTokenNone,
	isCancellationError,
} from 'cs/base/common/cancellation';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { AppError } from 'cs/base/parts/sandbox/common/appError';
import { ClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	AgentConfigurationSchemaProfile,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import { localAgentHostClientToolChannelName } from 'cs/platform/agentHost/common/connectionChannel';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentHostActionDigest,
	createAgentAttachmentId,
	createAgentHostAuthorityId,
	createAgentChatId,
	createAgentHostChannelId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentConfigurationPropertyId,
	createAgentConfigurationStateRevision,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentId,
	createAgentModelId,
	createAgentModelDescriptorRevision,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type {
	AgentPackageOperationOutcome,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import type {
	AgentHostChannelAction,
	AgentHostMutationOutcome,
	AgentHostPrepareSubmissionResult,
	AgentHostReconnectResult,
	IAgentHostInitializeRequest,
	IAgentHostInitializeResult,
	IAgentHostMutationRequest,
	IAgentHostOperationProgress,
	IAgentHostOperationOutcomeRequest,
	IAgentHostPrepareSubmissionRequest,
	IAgentHostReconnectRequest,
	IAgentHostResolveSessionConfigurationRequest,
	IAgentHostResolveSessionConfigurationResult,
	IAgentHostSetSubscriptionsRequest,
	IAgentHostSetSubscriptionsResult,
	IAgentHostSessionConfigurationCompletionsRequest,
	IAgentHostSessionConfigurationCompletionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import { LocalAgentHostConnection } from 'cs/platform/agentHost/electron-browser/localAgentHostConnection';
import { ClientAgentToolChannel } from 'cs/platform/agentHost/electron-browser/clientAgentToolChannel';
import { ClientContentResourceChannel } from 'cs/platform/agentHost/electron-browser/clientContentResourceChannel';
import {
	AgentHostConnectionChannel,
	AgentHostConnectionChannelFactory,
} from 'cs/platform/agentHost/electron-main/agentHostConnectionChannel';
import { ClientContentResourceChannelClient } from 'cs/platform/agentHost/electron-main/clientContentResourceChannel';
import type { IAgentContentResourceReaderPort } from 'cs/platform/agentHost/common/contentResources';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';

const authority = createAgentHostAuthorityId('local');
const connectionId = createAgentHostClientConnectionId('desktop-renderer');
const protocolVersion = createAgentHostProtocolVersion('5');
const sessionsChannel = createAgentHostChannelId('sessions');
const sessionType = createAgentSessionTypeId('comet');
const sessionId = createAgentSessionId('session-1');
const modelId = createAgentModelId('model-1');
const agentId = createAgentId('comet');
const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.embedded.v2');
const submissionId = createAgentSubmissionId('submission-1');
const operationId = createAgentHostOperationId('operation-1');
const payloadDigest = createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`);
const packageId = createAgentPackageId('optional-agent');
const packageOperationId = createAgentPackageOperationId('package-operation-1');
const packagePayloadDigest = createAgentHostPayloadDigest(`sha256:${'3'.repeat(64)}`);
const configurationProperty = createAgentConfigurationPropertyId('comet.mode');
const sessionConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'session',
	revision: 'comet.session-configuration.v1',
	properties: [{
		id: configurationProperty,
		owner: { kind: 'agent', agent: agentId },
		scopes: ['session'],
		value: { type: 'string' },
		required: false,
		sessionMutable: true,
		dynamicCompletion: true,
		display: { label: 'Mode' },
		persistence: 'persisted',
		redaction: 'public',
	}],
});
const resolvedSessionConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	...sessionConfigurationSchema,
	revision: 'comet.session-configuration.v2',
});
const modelConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'model',
	revision: 'comet.model-configuration.v1',
	properties: [],
});
const sessionConfigurationCandidate = validateAndFreezeAgentConfigurationCandidate(
	sessionConfigurationSchema,
	{ schema: sessionConfigurationSchema.revision, values: {} },
	'session',
);
const modelConfigurationCandidate = validateAndFreezeAgentConfigurationCandidate(
	modelConfigurationSchema,
	{ schema: modelConfigurationSchema.revision, values: {} },
	'model',
	true,
);
const sessionConfigurationState = validateAndFreezeAgentConfigurationState({
	schema: resolvedSessionConfigurationSchema,
	revision: createAgentConfigurationStateRevision('comet.session-configuration.state.v1'),
	values: {},
});

const initializeRequest: IAgentHostInitializeRequest = Object.freeze({
	connection: connectionId,
	protocolVersions: Object.freeze([protocolVersion]),
	capabilities: Object.freeze([]),
	locale: 'en',
	implementation: Object.freeze({ name: 'Comet renderer', build: 'test' }),
	subscriptions: Object.freeze([sessionsChannel]),
});

const initializeResult: IAgentHostInitializeResult = Object.freeze({
	protocolVersion,
	capabilities: Object.freeze([]),
	implementation: Object.freeze({ name: 'Comet Agent Host', build: 'test' }),
	hostSequence: createAgentHostSequence(0),
	snapshots: Object.freeze([]),
	missingChannels: Object.freeze([{ channel: sessionsChannel, reason: 'notFound' as const }]),
});

const setSubscriptionsRequest: IAgentHostSetSubscriptionsRequest = Object.freeze({
	subscriptions: Object.freeze([sessionsChannel]),
});

const setSubscriptionsResult: IAgentHostSetSubscriptionsResult = Object.freeze({
	hostSequence: createAgentHostSequence(0),
	snapshots: Object.freeze([]),
	missingChannels: Object.freeze([{ channel: sessionsChannel, reason: 'notFound' as const }]),
});

const resolveConfigurationRequest: IAgentHostResolveSessionConfigurationRequest = Object.freeze({
	sessionType,
	candidate: sessionConfigurationCandidate,
});

const resolveConfigurationResult: IAgentHostResolveSessionConfigurationResult = Object.freeze({
	agent: agentId,
	runtimeRegistration,
	configuration: sessionConfigurationState,
});

const completionRequest: IAgentHostSessionConfigurationCompletionsRequest = Object.freeze({
	sessionType,
	candidate: sessionConfigurationCandidate,
	resolvedSchema: sessionConfigurationSchema,
	property: configurationProperty,
	query: 'pre',
	limit: 10,
});

const completionResult: IAgentHostSessionConfigurationCompletionsResult = Object.freeze({
	agent: agentId,
	runtimeRegistration,
	schema: sessionConfigurationSchema.revision,
	completions: validateAndFreezeAgentConfigurationCompletions(
		sessionConfigurationSchema,
		configurationProperty,
		[{ label: 'Precise', value: 'precise' }],
	),
});

const prepareRequest: IAgentHostPrepareSubmissionRequest = Object.freeze({
	submission: submissionId,
	target: Object.freeze({ kind: 'draft', sessionType, configuration: sessionConfigurationCandidate }),
	capture: Object.freeze({
		message: 'hello',
		attachments: Object.freeze([]),
		interactionTargets: Object.freeze([]),
	}),
	captureDigest: payloadDigest,
	executionSelection: Object.freeze({ kind: 'model', model: modelId, configuration: modelConfigurationCandidate }),
	toolPolicy: Object.freeze({ kind: 'all' }),
});

const prepareResult: AgentHostPrepareSubmissionResult = Object.freeze({
	kind: 'rejected',
	failure: Object.freeze({
		code: 'invalidPayload',
		message: 'rejected by test Host',
		reconciliation: 'terminal',
	}),
});

const mutationRequest: IAgentHostMutationRequest = Object.freeze({
	operation: operationId,
	digest: payloadDigest,
	payload: Object.freeze({ kind: 'renameSession', session: sessionId, title: 'Renamed' }),
});

const operationOutcomeRequest: IAgentHostOperationOutcomeRequest = Object.freeze({
	operation: operationId,
	digest: payloadDigest,
});

const unknownOutcome: AgentHostMutationOutcome = Object.freeze({ kind: 'unknown' });

const packageOperationRequest: IAgentPackageOperationRequest = Object.freeze({
	operation: packageOperationId,
	digest: packagePayloadDigest,
	expectedCatalogRevision: 4,
	payload: Object.freeze({ kind: 'uninstall', packageId }),
});

const packageOperationOutcomeRequest: IAgentPackageOperationOutcomeRequest = Object.freeze({
	operation: packageOperationId,
	digest: packagePayloadDigest,
});

const unknownPackageOutcome: AgentPackageOperationOutcome = Object.freeze({ kind: 'unknown' });

const reconnectRequest: IAgentHostReconnectRequest = Object.freeze({
	connection: connectionId,
	lastHostSequence: createAgentHostSequence(0),
	subscriptions: Object.freeze([sessionsChannel]),
});

const reconnectResult: AgentHostReconnectResult = Object.freeze({
	kind: 'replay',
	fromHostSequence: createAgentHostSequence(0),
	throughHostSequence: createAgentHostSequence(0),
	actions: Object.freeze([]),
	missingChannels: Object.freeze([]),
});

const channelAction: AgentHostChannelAction = Object.freeze({
	channel: sessionsChannel,
	kind: 'sessions',
	hostSequence: createAgentHostSequence(1),
	revision: createAgentHostChannelRevision(1),
	digest: createAgentHostActionDigest(`sha256:${'2'.repeat(64)}`),
	cause: Object.freeze({ kind: 'host' }),
	action: Object.freeze({
		kind: 'sessionCatalogStateChanged',
		state: Object.freeze({ sessions: Object.freeze([]) }),
	}),
});

const clientToolId = createAgentToolId('renderer.read-draft');
const clientToolDescriptorRevision = createAgentToolDescriptorRevision('renderer.read-draft.descriptor.v1');
const clientToolRegistrationId = createAgentToolRegistrationId('renderer.read-draft.registration');
const clientToolRegistrationRevision = createAgentToolRegistrationRevision('renderer.read-draft.registration.v1');
const clientToolRegistration: IAgentToolRegistration = Object.freeze({
	id: clientToolRegistrationId,
	revision: clientToolRegistrationRevision,
	descriptor: Object.freeze({
		id: clientToolId,
		revision: clientToolDescriptorRevision,
		contributor: createAgentToolContributorId('renderer-test'),
		functionName: 'renderer_read_draft',
		displayName: 'Read Draft',
		description: 'Reads the exact renderer draft for the integration test.',
		inputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({
				type: 'object',
				properties: Object.freeze({}),
				required: Object.freeze([]),
				additionalProperties: false,
			}),
		}),
		outputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({ type: 'literal', value: null }),
		}),
		safety: 'read',
		confirmation: 'never',
		allowsEditedInput: false,
		targetTypes: Object.freeze([]),
		limits: Object.freeze({
			maximumInputBytes: 1_024,
			maximumOutputBytes: 1_024,
			maximumContentBytes: 1_024,
			timeoutMilliseconds: 30_000,
			maximumConcurrency: 1,
		}),
	}),
	executor: Object.freeze({
		kind: 'client',
		connection: connectionId,
		executor: createAgentToolExecutorId('renderer.read-draft.executor'),
	}),
});

function clientToolCall(id: string): IAgentToolCall {
	return Object.freeze({
		id: createAgentToolCallId(id),
		agent: createAgentId('comet'),
		registration: createAgentRuntimeRegistrationRevision('comet.embedded.v2'),
		session: sessionId,
		chat: createAgentChatId('tool-chat'),
		turn: createAgentTurnId('tool-turn'),
		toolSet: createAgentToolSetRevision('tool-set.v1'),
		tool: clientToolId,
		descriptor: clientToolDescriptorRevision,
		registrationId: clientToolRegistrationId,
		registrationRevision: clientToolRegistrationRevision,
		input: Object.freeze({}),
		effect: Object.freeze({ kind: 'read' }),
		deadline: Date.now() + 30_000,
	});
}

interface IDeferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): IDeferred<T> {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>(complete => { resolve = complete; }),
		resolve,
	};
}

class TestClientToolEndpoint implements IAgentToolExecutorEndpoint {
	readonly executeCalls: Array<{
		readonly call: IAgentToolCall;
		readonly target: IAgentHostInteractionTarget | undefined;
		readonly cancellation: CancellationToken;
	}> = [];
	readonly cancelCalls: IAgentToolCall[] = [];
	readonly reconcileCalls: IAgentToolCall[] = [];
	readonly pendingStarted = deferred<void>();
	readonly pendingResult = deferred<AgentToolResult>();

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		this.executeCalls.push({ call, target, cancellation });
		reportProgress(Object.freeze({
			call: call.id,
			sequence: 1,
			data: Object.freeze({ phase: 'renderer' }),
		}));
		if (call.id === createAgentToolCallId('electron-tool-pending')) {
			this.pendingStarted.resolve();
			return this.pendingResult.promise;
		}
		return Object.freeze({ call: call.id, status: 'completed', output: null });
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		this.cancelCalls.push(call);
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		this.reconcileCalls.push(call);
		return Object.freeze({
			kind: 'terminal',
			result: Object.freeze({ call: call.id, status: 'completed', output: null }),
		});
	}
}

class TestAgentHostConnection extends Disposable implements IAgentHostConnection {
	readonly authority = authority;
	private readonly actionEmitter = this._register(new Emitter<AgentHostChannelAction>());
	readonly onDidReceiveAction: Event<AgentHostChannelAction> = this.actionEmitter.event;
	private readonly progressEmitter = this._register(new Emitter<IAgentHostOperationProgress>());
	readonly onDidProgress = this.progressEmitter.event;

	readonly initializeRequests: IAgentHostInitializeRequest[] = [];
	readonly reconnectRequests: IAgentHostReconnectRequest[] = [];
	readonly setSubscriptionsRequests: IAgentHostSetSubscriptionsRequest[] = [];
	readonly resolveConfigurationRequests: IAgentHostResolveSessionConfigurationRequest[] = [];
	readonly completionRequests: IAgentHostSessionConfigurationCompletionsRequest[] = [];
	readonly prepareRequests: IAgentHostPrepareSubmissionRequest[] = [];
	readonly mutationRequests: IAgentHostMutationRequest[] = [];
	readonly outcomeRequests: IAgentHostOperationOutcomeRequest[] = [];
	readonly packageOperationRequests: IAgentPackageOperationRequest[] = [];
	readonly packageOutcomeRequests: IAgentPackageOperationOutcomeRequest[] = [];
	initializeError: unknown;
	reconnectResponse: AgentHostReconnectResult = reconnectResult;
	setSubscriptionsResponse: Promise<IAgentHostSetSubscriptionsResult> = Promise.resolve(setSubscriptionsResult);
	resolveConfigurationResponse: IAgentHostResolveSessionConfigurationResult = resolveConfigurationResult;
	completionResponse: IAgentHostSessionConfigurationCompletionsResult = completionResult;
	prepareResponse: AgentHostPrepareSubmissionResult = prepareResult;
	disposed = false;

	constructor(readonly connection = connectionId) {
		super();
	}

	initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		this.initializeRequests.push(request);
		return this.initializeError === undefined
			? Promise.resolve(initializeResult)
			: Promise.reject(this.initializeError);
	}

	reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		this.reconnectRequests.push(request);
		return Promise.resolve(this.reconnectResponse);
	}

	setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		this.setSubscriptionsRequests.push(request);
		return this.setSubscriptionsResponse;
	}

	resolveSessionConfiguration(
		request: IAgentHostResolveSessionConfigurationRequest,
	): Promise<IAgentHostResolveSessionConfigurationResult> {
		this.resolveConfigurationRequests.push(request);
		return Promise.resolve(this.resolveConfigurationResponse);
	}

	completeSessionConfiguration(
		request: IAgentHostSessionConfigurationCompletionsRequest,
	): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		this.completionRequests.push(request);
		return Promise.resolve(this.completionResponse);
	}

	prepareSubmission(request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult> {
		this.prepareRequests.push(request);
		return Promise.resolve(this.prepareResponse);
	}

	mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		this.mutationRequests.push(request);
		return Promise.resolve(unknownOutcome);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		this.outcomeRequests.push(request);
		return Promise.resolve(unknownOutcome);
	}

	executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		this.packageOperationRequests.push(request);
		return Promise.resolve(unknownPackageOutcome);
	}

	getPackageOperationOutcome(request: IAgentPackageOperationOutcomeRequest): Promise<AgentPackageOperationOutcome> {
		this.packageOutcomeRequests.push(request);
		return Promise.resolve(unknownPackageOutcome);
	}

	fireAction(action: AgentHostChannelAction): void {
		this.actionEmitter.fire(action);
	}

	fireProgress(progress: IAgentHostOperationProgress): void {
		this.progressEmitter.fire(progress);
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}
}

class TestWebContents extends NodeEventEmitter {
	private destroyed = false;

	constructor(readonly id: number) {
		super();
	}

	isDestroyed(): boolean {
		return this.destroyed;
	}

	destroy(): void {
		this.destroyed = true;
		this.emit('destroyed');
	}
}

class TestChannel implements IChannel {
	private readonly context: IpcMainInvokeEvent;

	constructor(
		private readonly server: IServerChannel<IpcMainInvokeEvent>,
		sender: TestWebContents,
	) {
		this.context = { sender } as unknown as IpcMainInvokeEvent;
	}

	call<T = unknown>(
		command: string,
		arg?: unknown,
		cancellationToken: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		return this.server.call<T>(this.context, command, arg, cancellationToken);
	}

	listen<T = unknown>(event: string, arg?: unknown): Event<T> {
		return this.server.listen<T>(this.context, event, arg);
	}
}

class TestContentResourceRouter implements IAgentContentResourceClientRouter {
	readonly readers: Array<{
		readonly connection: ReturnType<typeof createAgentHostClientConnectionId>;
		readonly reader: IAgentContentResourceReaderPort;
	}> = [];

	bindClientReader(
		connection: ReturnType<typeof createAgentHostClientConnectionId>,
		reader: IAgentContentResourceReaderPort,
	) {
		const binding = { connection, reader };
		this.readers.push(binding);
		return toDisposable(() => {
			const index = this.readers.indexOf(binding);
			if (index >= 0) {
				this.readers.splice(index, 1);
			}
		});
	}
}

const reverseChannelServer = {
	getRendererChannel: (_senderId: number, _channelName: string): IChannel => ({
		call: () => Promise.reject(new Error('Unexpected reverse IPC call')),
		listen: () => {
			throw new Error('Unexpected reverse IPC event');
		},
	}),
};

function createServer(
	host: TestAgentHostConnection,
	contentResources = new TestContentResourceRouter(),
): AgentHostConnectionChannel {
	return new AgentHostConnectionChannel(
		host,
		contentResources,
		new AgentToolRegistry(),
		new AgentToolEndpointRegistry(),
		reverseChannelServer,
	);
}

function assertAgentHostError(error: unknown, code: AgentHostErrorCode): boolean {
	assert.ok(error instanceof AgentHostError);
	assert.equal(error.code, code);
	return true;
}

function assertChannelError(error: unknown): boolean {
	assert.ok(error instanceof AppError);
	assert.equal(error.code, 'AGENT_HOST_CHANNEL_ERROR');
	return true;
}

async function createClient(
	server: IServerChannel<IpcMainInvokeEvent>,
	sender: TestWebContents,
): Promise<LocalAgentHostConnection> {
	return LocalAgentHostConnection.create(new TestChannel(server, sender), 16);
}

suite('local Agent Host connection channel', { concurrency: false }, () => {
	test('forwards the complete connection contract, actions, and operation progress', async () => {
		const host = new TestAgentHostConnection();
		const server = createServer(host);
		const sender = new TestWebContents(1);
		const client = await createClient(server, sender);
		try {
			assert.equal(client.authority, authority);
			assert.equal(client.connection, connectionId);
			assert.deepEqual(await client.initialize(initializeRequest), initializeResult);
			assert.deepEqual(await client.reconnect(reconnectRequest), reconnectResult);
			assert.deepEqual(await client.setSubscriptions(setSubscriptionsRequest), setSubscriptionsResult);
			assert.deepEqual(
				await client.resolveSessionConfiguration(resolveConfigurationRequest),
				resolveConfigurationResult,
			);
			assert.deepEqual(await client.completeSessionConfiguration(completionRequest), completionResult);
			assert.deepEqual(await client.prepareSubmission(prepareRequest), prepareResult);
			assert.deepEqual(await client.mutate(mutationRequest), unknownOutcome);
			assert.deepEqual(await client.getOperationOutcome(operationOutcomeRequest), unknownOutcome);
			assert.deepEqual(await client.executePackageOperation(packageOperationRequest), unknownPackageOutcome);
			assert.deepEqual(
				await client.getPackageOperationOutcome(packageOperationOutcomeRequest),
				unknownPackageOutcome,
			);
			assert.deepEqual(host.initializeRequests, [initializeRequest]);
			assert.deepEqual(host.reconnectRequests, [reconnectRequest]);
			assert.deepEqual(host.setSubscriptionsRequests, [setSubscriptionsRequest]);
			assert.deepEqual(host.resolveConfigurationRequests, [resolveConfigurationRequest]);
			assert.deepEqual(host.completionRequests, [completionRequest]);
			assert.deepEqual(host.prepareRequests, [prepareRequest]);
			assert.deepEqual(host.mutationRequests, [mutationRequest]);
			assert.deepEqual(host.outcomeRequests, [operationOutcomeRequest]);
			assert.deepEqual(host.packageOperationRequests, [packageOperationRequest]);
			assert.deepEqual(host.packageOutcomeRequests, [packageOperationOutcomeRequest]);

			const received: AgentHostChannelAction[] = [];
			const listener = client.onDidReceiveAction(action => received.push(action));
			host.fireAction(channelAction);
			assert.deepEqual(received, [channelAction]);
			listener.dispose();

			const progress = {
				operation: createAgentHostOperationId('download-sdk'),
				progress: 50,
				total: 100,
				message: 'Downloading Agent',
			};
			const receivedProgress: IAgentHostOperationProgress[] = [];
			const progressListener = client.onDidProgress(frame => receivedProgress.push(frame));
			host.fireProgress(progress);
			assert.deepEqual(receivedProgress, [progress]);
			progressListener.dispose();
		} finally {
			client.dispose();
			server.dispose();
			assert.equal(host.disposed, false);
			host.dispose();
		}
	});

	test('preserves Agent Host error identity and structured data', async () => {
		const host = new TestAgentHostConnection();
		const server = createServer(host);
		const client = await createClient(server, new TestWebContents(1));
		host.initializeError = new AgentHostError(
			AgentHostErrorCode.UnsupportedProtocolVersion,
			'no common protocol',
			{ offered: ['2'], supported: ['3'] },
		);
		try {
			await assert.rejects(
				client.initialize(initializeRequest),
				error => {
					assert.ok(error instanceof AgentHostError);
					assert.equal(error.code, AgentHostErrorCode.UnsupportedProtocolVersion);
					assert.equal(error.message, 'no common protocol');
					assert.deepEqual(error.data, { offered: ['2'], supported: ['3'] });
					return true;
				},
			);
		} finally {
			client.dispose();
			server.dispose();
			host.dispose();
		}
	});

	test('cancels in-flight calls when the renderer connection is disposed', async () => {
		const host = new TestAgentHostConnection();
		const pendingSetSubscriptions = deferred<IAgentHostSetSubscriptionsResult>();
		host.setSubscriptionsResponse = pendingSetSubscriptions.promise;
		const server = createServer(host);
		const client = await createClient(server, new TestWebContents(1));
		try {
			const result = client.setSubscriptions(setSubscriptionsRequest);
			client.dispose();
			await assert.rejects(result, error => {
				assert.ok(isCancellationError(error));
				return true;
			});
			assert.equal(host.disposed, false);
			pendingSetSubscriptions.resolve(setSubscriptionsResult);
		} finally {
			client.dispose();
			server.dispose();
			host.dispose();
		}
	});

	test('creates a fresh logical connection and reader binding after renderer replacement', async () => {
		const replacementConnectionId = createAgentHostClientConnectionId('desktop-renderer-replacement');
		const contentResources = new TestContentResourceRouter();
		const hosts: TestAgentHostConnection[] = [];
		const server = new AgentHostConnectionChannelFactory(
			context => {
				const host = new TestAgentHostConnection(
					context.sender.id === 1 ? connectionId : replacementConnectionId,
				);
				hosts.push(host);
				return host;
			},
			contentResources,
			new AgentToolRegistry(),
			new AgentToolEndpointRegistry(),
			reverseChannelServer,
		);
		const firstSender = new TestWebContents(1);
		const firstClient = await createClient(server, firstSender);
		try {
			await firstClient.initialize(initializeRequest);
			assert.equal(contentResources.readers.length, 1);
			assert.equal(contentResources.readers[0].connection, connectionId);
			firstClient.dispose();
			firstSender.destroy();
			assert.equal(contentResources.readers.length, 0);
			assert.equal(hosts[0].disposed, true);

			const replacement = await createClient(server, new TestWebContents(2));
			try {
				assert.equal(replacement.connection, replacementConnectionId);
				assert.equal(contentResources.readers.length, 1);
				assert.equal(contentResources.readers[0].connection, replacementConnectionId);
				const replacementInitializeRequest = Object.freeze({
					...initializeRequest,
					connection: replacementConnectionId,
				});
				assert.deepEqual(await replacement.initialize(replacementInitializeRequest), initializeResult);
				assert.deepEqual(hosts[0].initializeRequests, [initializeRequest]);
				assert.deepEqual(hosts[1].initializeRequests, [replacementInitializeRequest]);
				assert.deepEqual(hosts[1].reconnectRequests, []);
			} finally {
				replacement.dispose();
			}
		} finally {
			firstClient.dispose();
			server.dispose();
			assert.ok(hosts.every(host => host.disposed));
		}
	});

	test('rejects malformed requests and invalid subscription or reconnect results at the boundary', async () => {
		const host = new TestAgentHostConnection();
		const server = createServer(host);
		const channel = new TestChannel(server, new TestWebContents(1));
		try {
			await assert.rejects(
				channel.call('resolveSessionConfiguration', {
					...resolveConfigurationRequest,
					candidate: { ...sessionConfigurationCandidate, unexpected: true },
				}),
				error => {
					assert.ok(error instanceof AppError);
					assert.equal(error.code, 'AGENT_HOST_ERROR');
					return true;
				},
			);
			await assert.rejects(
				channel.call('completeSessionConfiguration', {
					...completionRequest,
					resolvedSchema: { ...sessionConfigurationSchema, unexpected: true },
				}),
				error => {
					assert.ok(error instanceof AppError);
					assert.equal(error.code, 'AGENT_HOST_ERROR');
					return true;
				},
			);
			await assert.rejects(
				channel.call('setSubscriptions', { subscriptions: [sessionsChannel], unexpected: true }),
				error => {
					assert.ok(error instanceof AppError);
					assert.equal(error.code, 'AGENT_HOST_ERROR');
					return true;
				},
			);
			await assert.rejects(channel.call('unknown-command'), assertChannelError);
			await assert.rejects(
				channel.call('executePackageOperation', {
					...packageOperationRequest,
					expectedCatalogRevision: -1,
				}),
				error => {
					assert.ok(error instanceof AppError);
					assert.equal(error.code, 'AGENT_HOST_ERROR');
					return true;
				},
			);

			const client = await LocalAgentHostConnection.create(channel, 16);
			try {
				const agentDescriptor = createAgentDescriptorRevision('comet.descriptor.v2');
				const modelDescriptor = createAgentModelDescriptorRevision('comet.model.v1');
				host.prepareResponse = Object.freeze({
					kind: 'prepared',
					submission: Object.freeze({
						submission: submissionId,
						payloadDigest,
						message: 'hello',
						attachments: Object.freeze([]),
						interactionTargets: Object.freeze([]),
						sessionConfiguration: Object.freeze({
							...sessionConfigurationState,
							unexpected: true,
						}),
						modelConfiguration: modelConfigurationCandidate,
						credentials: Object.freeze([]),
						executionProfile: Object.freeze({
							revision: createAgentExecutionProfileRevision('profile.v1'),
							digest: createAgentExecutionProfileDigest(`sha256:${'4'.repeat(64)}`),
							agentDescriptor,
							modelDescriptor,
							data: '{}',
						}),
						runtimeRegistration,
						toolSet: Object.freeze({
							revision: createAgentToolSetRevision('tools.v1'),
							schemaProfile: createAgentToolSchemaProfileId('comet.tools'),
							runtimeRegistration,
							agentDescriptor,
							modelDescriptor,
							registrations: Object.freeze([]),
						}),
						requestedDeadline: 100,
						outputConstraints: Object.freeze({}),
					}),
				});
				await assert.rejects(
					client.prepareSubmission(prepareRequest),
					error => assertAgentHostError(error, AgentHostErrorCode.InvalidConfigurationValue),
				);
				host.setSubscriptionsResponse = Promise.resolve(Object.freeze({
					...setSubscriptionsResult,
					missingChannels: Object.freeze([]),
				}));
				await assert.rejects(
					client.setSubscriptions(setSubscriptionsRequest),
					error => assertAgentHostError(error, AgentHostErrorCode.InvalidProtocolValue),
				);
				host.reconnectResponse = Object.freeze({
					...reconnectResult,
					fromHostSequence: createAgentHostSequence(1),
				});
				await assert.rejects(
					client.reconnect(reconnectRequest),
					error => assertAgentHostError(error, AgentHostErrorCode.InvalidProtocolValue),
				);
			} finally {
				client.dispose();
			}
		} finally {
			server.dispose();
			host.dispose();
		}
	});

	test('publishes, invokes, cancels, reconciles, and removes renderer Tools through reverse IPC', async () => {
		const host = new TestAgentHostConnection();
		const registrations = new AgentToolRegistry();
		const endpoints = new AgentToolEndpointRegistry();
		const sender = new TestWebContents(7);
		let rendererTools: ClientAgentToolChannel | undefined;
		const requireRendererTools = (): ClientAgentToolChannel => {
			if (rendererTools === undefined) {
				throw new Error('Renderer Tool channel is not registered');
			}
			return rendererTools;
		};
		const channelServer = {
			getRendererChannel: (senderId: number, channelName: string): IChannel => {
				assert.equal(senderId, sender.id);
				if (channelName !== localAgentHostClientToolChannelName) {
					return reverseChannelServer.getRendererChannel(senderId, channelName);
				}
				return {
					call: <T = unknown>(
						command: string,
						arg?: unknown,
						cancellation: CancellationToken = CancellationTokenNone,
					) => requireRendererTools().call<T>('main', command, arg, cancellation),
					listen: <T = unknown>(event: string, arg?: unknown) => (
						requireRendererTools().listen<T>('main', event, arg)
					),
				};
			},
		};
		const server = new AgentHostConnectionChannel(
			host,
			new TestContentResourceRouter(),
			registrations,
			endpoints,
			channelServer,
		);
		const client = await createClient(server, sender);
		rendererTools = new ClientAgentToolChannel(client.clientTools);
		const rendererEndpoint = new TestClientToolEndpoint();
		const publication = client.clientTools.publish(clientToolRegistration, rendererEndpoint);
		try {
			await client.clientTools.synchronize();
			assert.deepEqual(registrations.snapshot(), [clientToolRegistration]);
			const mainEndpoint = endpoints.resolve(clientToolRegistration.executor);
			assert.ok(mainEndpoint !== undefined);

			const completedCall = clientToolCall('electron-tool-completed');
			const progress: IAgentToolProgress[] = [];
			assert.deepEqual(
				await mainEndpoint.execute(
					completedCall,
					undefined,
					value => progress.push(value),
					CancellationTokenNone,
				),
				{ call: completedCall.id, status: 'completed', output: null },
			);
			assert.deepEqual(progress, [{
				call: completedCall.id,
				sequence: 1,
				data: { phase: 'renderer' },
			}]);
			assert.deepEqual(rendererEndpoint.executeCalls[0], {
				call: completedCall,
				target: undefined,
				cancellation: CancellationTokenNone,
			});
			assert.deepEqual(await mainEndpoint.reconcile(completedCall), {
				kind: 'terminal',
				result: { call: completedCall.id, status: 'completed', output: null },
			});

			const pendingCall = clientToolCall('electron-tool-pending');
			const pendingExecution = mainEndpoint.execute(
				pendingCall,
				undefined,
				() => {},
				CancellationTokenNone,
			);
			await rendererEndpoint.pendingStarted.promise;
			await mainEndpoint.cancel(pendingCall);
			await mainEndpoint.cancel(pendingCall);
			assert.deepEqual(rendererEndpoint.cancelCalls, [pendingCall]);
			rendererEndpoint.pendingResult.resolve(Object.freeze({
				call: pendingCall.id,
				status: 'cancelled',
				failure: Object.freeze({
					code: 'cancelled',
					message: 'Cancelled by the Host',
					reconciliation: 'terminal',
				}),
			}));
			assert.equal((await pendingExecution).status, 'cancelled');

			sender.destroy();
			assert.deepEqual(registrations.snapshot(), []);
			assert.equal(endpoints.resolve(clientToolRegistration.executor), undefined);
		} finally {
			client.dispose();
			publication.dispose();
			rendererTools.dispose();
			server.dispose();
			host.dispose();
		}
	});

	test('routes strict cancellable content reads through the reverse channel contract', async () => {
		const resources = new ClientContentResourceService(connectionId, {
			maximumBlobBytes: 1024,
			maximumTreeBytes: 4096,
			maximumTreeEntries: 16,
			maximumTreeDepth: 4,
			maximumReadLength: 4,
			maximumOpenLeases: 4,
			maximumConcurrentOperations: 2,
			maximumTotalReadBytes: 4096,
			maximumTreePageEntries: 4,
			maximumTreePages: 16,
			maximumLeaseDurationMilliseconds: 60_000,
		});
		const rendererChannel = new ClientContentResourceChannel(resources);
		const transport: IChannel = {
			call: <T = unknown>(command: string, arg?: unknown, token: CancellationToken = CancellationTokenNone) => (
				rendererChannel.call<T>('main', command, arg, token)
			),
			listen: <T = unknown>(event: string) => rendererChannel.listen<T>('main', event),
		};
		const mainClient = new ClientContentResourceChannelClient(transport);
		const publication = await resources.publishBlob({
			mediaType: 'text/plain',
			bytes: new TextEncoder().encode('exact'),
		});
		const request = Object.freeze({
			session: sessionId,
			chat: createAgentChatId('content-chat'),
			turn: createAgentTurnId('content-turn'),
			attachment: createAgentAttachmentId('content-attachment'),
			content: publication.content,
			limits: Object.freeze({
				maximumReadLength: publication.content.bounds.maximumReadLength,
				maximumTotalReadBytes: 64,
				maximumTreePageEntries: 4,
				maximumTreePages: 4,
				maximumConcurrentOperations: 2,
				deadline: Date.now() + 30_000,
			}),
		});
		const lease = await mainClient.open(request, CancellationTokenNone);
		assert.equal((await mainClient.readBlob({
			lease: lease.lease,
			offset: 0,
			length: 4,
		}, CancellationTokenNone)).data, 'ZXhhYw==');
		await assert.rejects(
			mainClient.readBlob({ lease: lease.lease, offset: 4, length: 1 }, CancellationTokenCancelled),
			isCancellationError,
		);
		await assert.rejects(
			rendererChannel.call('renderer', 'open', request, CancellationTokenNone),
			/rejected context/,
		);
		await mainClient.release(lease.lease, CancellationTokenNone);
		publication.release();

		const malformedClient = new ClientContentResourceChannelClient({
			call: async <T = unknown>() => ({ lease: 'missing-content' } as T),
			listen: () => {
				throw new Error('Unexpected malformed-channel event');
			},
		});
		await assert.rejects(malformedClient.open(request, CancellationTokenNone), /Invalid Agent content-resource protocol value/);
	});
});
