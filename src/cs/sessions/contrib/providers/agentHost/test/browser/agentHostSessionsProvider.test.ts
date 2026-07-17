/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { Emitter } from 'cs/base/common/event';
import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import { AgentHostManagementService } from 'cs/platform/agentHost/browser/agentHostManagementService';
import {
	RemoteAgentHostConnection,
	type IRemoteAgentHostClientToolEndpoint,
	type IRemoteAgentHostProtocolTransport,
	type IRemoteAgentHostTransportStateChange,
	type RemoteAgentHostTransportState,
} from 'cs/platform/agentHost/browser/remoteAgentHostConnection';
import type { IClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	AgentConfigurationSchemaProfile,
	validateAndFreezeAgentConfigurationSchema,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	createAgentCapabilityRevision,
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentChatId,
	createAgentConfigurationPropertyId,
	createAgentConfigurationStateRevision,
	createAgentContentDigest,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentDescriptorRevision,
	createAgentExecutionPresetId,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostActionDigest,
	createAgentHostAuthorityId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentPackageContentDigest,
	createAgentPackageRevision,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
	type AgentHostChannelId,
	type AgentHostClientConnectionId,
	type AgentSessionId,
} from 'cs/platform/agentHost/common/identities';
import type {
	AgentPackageOperationOutcome,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import { RemoteAgentHostProtocolCommand } from 'cs/platform/agentHost/common/remoteProtocol';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	AgentHostOperationFailureCode,
	computeAgentHostMutationDigest,
	getAgentHostChatChannelId,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
	type AgentHostChannelAction,
	type AgentHostChannelSnapshot,
	type AgentHostMutationOutcome,
	type AgentHostReconnectResult,
	type IAgentHostChatState,
	type IAgentHostInitializeRequest,
	type IAgentHostInitializeResult,
	type IAgentHostMutationRequest,
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostReconnectRequest,
	type IAgentHostResolveSessionConfigurationRequest,
	type IAgentHostResolveSessionConfigurationResult,
	type IAgentHostRootState,
	type IAgentHostSessionCatalogState,
	type IAgentHostSessionState,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
	type IAgentHostSessionConfigurationCompletionsRequest,
	type IAgentHostSessionConfigurationCompletionsResult,
} from 'cs/platform/agentHost/common/protocol';
import { AgentHostSessionsProvider } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionsProvider';
import { RemoteAgentHostSessionsContribution } from 'cs/sessions/contrib/providers/agentHost/browser/remoteAgentHost';
import { resolveAgentHostDisplayText } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionProjection';
import {
	ChatInteractivity,
	ChatOriginKind,
	SessionWorkspaceKind,
} from 'cs/sessions/services/sessions/common/session';
import { SessionTransitionKind } from 'cs/sessions/services/sessions/common/sessionsProvider';
import { SessionsProvidersService } from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import type { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import type { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { getLocaleMessages } from 'language/i18n';

const authority = createAgentHostAuthorityId('local');
const packageId = createAgentPackageId('comet');
const agentId = createAgentId('comet');
const sessionType = createAgentSessionTypeId('comet.chat');
const modelId = createAgentModelId('comet-model');
const automaticPreset = createAgentExecutionPresetId('automatic');
const payloadDigest = createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`);
const registrationRevision = createAgentRuntimeRegistrationRevision('comet.embedded.v2');
const remoteContentResourceLimits = Object.freeze({
	maximumBlobBytes: 4_096,
	maximumTreeBytes: 8_192,
	maximumTreeEntries: 32,
	maximumTreeDepth: 8,
	maximumReadLength: 1_024,
	maximumOpenLeases: 8,
	maximumConcurrentOperations: 4,
	maximumTotalReadBytes: 8_192,
	maximumTreePageEntries: 32,
	maximumTreePages: 32,
	maximumLeaseDurationMilliseconds: 60_000,
});
const hostDefaultsSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'hostDefault',
	revision: 'comet.host-defaults.v1',
	properties: [],
});
const sessionConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'session',
	revision: 'comet.session-configuration.v1',
	properties: [],
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
const hostDefaultsState = Object.freeze({
	schema: hostDefaultsSchema,
	revision: createAgentConfigurationStateRevision('comet.host-defaults.state.v1'),
	values: Object.freeze({}),
});
const sessionConfigurationState = Object.freeze({
	schema: resolvedSessionConfigurationSchema,
	revision: createAgentConfigurationStateRevision('comet.session-configuration.state.v1'),
	values: Object.freeze({}),
});

function createRootState(): IAgentHostRootState {
	return {
		authority,
		label: { kind: 'literal', value: 'Local Agent Host' },
		capabilities: {
			supportsCreateSession: true,
			supportsPackageOperations: false,
			supportsAgentAuthentication: false,
		},
		packages: {
			revision: 0,
			installablePackages: [],
			installedPackages: [],
			activations: [],
			retainedBackingRecords: [],
			materializedBackings: [],
		},
		agents: [{
			id: agentId,
			packageId,
			revision: createAgentDescriptorRevision('agent-revision-1'),
			displayName: 'Comet',
			description: 'Comet test Agent',
			capabilities: {
				revision: createAgentCapabilityRevision('capabilities-1'),
				supportsEmptySession: true,
				supportsCreateChat: true,
				maximumChatCount: 5,
				supportsForkChat: true,
				supportsQueue: false,
				supportsSteering: false,
				supportsCancellation: true,
				supportsReleaseSession: true,
				supportsReleaseChat: true,
				supportsDeleteSession: true,
				supportsDeleteChat: true,
			},
			models: [{
				id: modelId,
				revision: createAgentModelDescriptorRevision('model-revision-1'),
				displayName: 'Comet Model',
				enabled: true,
				configurationSchema: modelConfigurationSchema,
				toolSchemaProfiles: [createAgentToolSchemaProfileId('comet.tools')],
				attachments: {
					carriers: ['inline', 'reference'],
					shapes: ['blob', 'tree'],
					mediaTypes: ['text/plain', 'image/png'],
					maximumCount: 16,
					maximumItemBytes: 1_000_000,
					maximumTotalBytes: 4_000_000,
					maximumTreeDepth: 8,
					maximumTreeEntries: 1_000,
					supportsClientContentForBackgroundExecution: true,
				},
			}],
			requiresAgentAuthentication: false,
		}],
		agentRegistrations: [{
			packageId,
			agentId,
			revision: registrationRevision,
			descriptorRevision: createAgentDescriptorRevision('agent-revision-1'),
			capabilityRevision: createAgentCapabilityRevision('capabilities-1'),
			hostDefaultsSchema,
			initialSessionConfigurationSchema: sessionConfigurationSchema.revision,
			supportedSessionConfigurationSchemas: [
				resolvedSessionConfigurationSchema.revision,
				sessionConfigurationSchema.revision,
			],
			supportedToolSchemaProfiles: [createAgentToolSchemaProfileId('comet.tools')],
			supportedResumeSchemas: [],
			resumeMigrationEdges: [],
		}],
		agentDefaults: [hostDefaultsState],
		sessionTypes: [{
			id: sessionType,
			packageId,
			agentId,
			displayName: { kind: 'literal', value: 'Comet Session' },
			description: { kind: 'literal', value: 'Comet Session type' },
			capabilities: {
				workspace: 'optional',
				supportsEmptySession: true,
				supportsInitialTurn: true,
				supportsCreateChat: true,
				maximumChatCount: 5,
				supportsForkChat: true,
			},
			models: [modelId],
			executionPresets: [{
				id: automaticPreset,
				displayName: { kind: 'literal', value: 'Automatic' },
				model: modelId,
			}],
			automaticExecutionPreset: automaticPreset,
			toolPolicy: { kind: 'all' },
		}],
	};
}

function createChatState(
	session: AgentSessionId,
	id: string,
	title: string,
	overrides: Partial<IAgentHostChatState> = {},
): IAgentHostChatState {
	const chat = createAgentChatId(id);
	return {
		id: chat,
		createdAt: 10,
		title,
		origin: { kind: 'user' },
		model: modelId,
		lifecycle: 'available',
		interactivity: 'full',
		status: 'completed',
		isRead: true,
		capabilities: {
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: true,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: true,
			supportsCancel: true,
		},
		modifiedAt: 11,
		session,
		turns: [],
		...overrides,
	};
}

function toChatSummary(chat: IAgentHostChatState): IAgentHostSessionState['chats'][number] {
	return {
		id: chat.id,
		createdAt: chat.createdAt,
		title: chat.title,
		origin: chat.origin,
		model: chat.model,
		lifecycle: chat.lifecycle,
		interactivity: chat.interactivity,
		status: chat.status,
		isRead: chat.isRead,
		capabilities: chat.capabilities,
		modifiedAt: chat.modifiedAt,
	};
}

function createSessionState(
	id: string,
	title: string,
	chats: readonly IAgentHostChatState[],
	overrides: Partial<IAgentHostSessionState> = {},
): IAgentHostSessionState {
	return {
		id: createAgentSessionId(id),
		packageId,
		agentId,
		type: sessionType,
		createdAt: 1,
		title,
		archived: false,
		lifecycle: 'available',
		status: 'completed',
		isRead: true,
		modifiedAt: 2,
		configuration: sessionConfigurationState,
		capabilities: {
			supportsCreateChat: true,
			maximumChatCount: 5,
			supportsFork: true,
			supportsRename: true,
			supportsArchive: true,
			supportsDelete: true,
			supportsChanges: true,
			supportsModels: true,
		},
		changes: [],
		chats: chats.map(toChatSummary),
		...overrides,
	};
}

function toSessionSummary(session: IAgentHostSessionState): IAgentHostSessionCatalogState['sessions'][number] {
	return {
		id: session.id,
		packageId: session.packageId,
		agentId: session.agentId,
		type: session.type,
		createdAt: session.createdAt,
		title: session.title,
		archived: session.archived,
		lifecycle: session.lifecycle,
		status: session.status,
		isRead: session.isRead,
		modifiedAt: session.modifiedAt,
	};
}

class TestAgentHostConnection implements IAgentHostConnection {
	readonly authority = authority;
	readonly connection = createAgentHostClientConnectionId('test-connection');
	private readonly actionEmitter = new Emitter<AgentHostChannelAction>();
	readonly onDidReceiveAction = this.actionEmitter.event;
	root = createRootState();
	readonly sessions = new Map<AgentSessionId, IAgentHostSessionState>();
	catalog: IAgentHostSessionCatalogState = { sessions: [] };
	sequence = 1;
	readonly revisions = new Map<AgentHostChannelId, number>();
	readonly activeSubscriptions = new Set<AgentHostChannelId>();
	readonly setSubscriptionsRequests: IAgentHostSetSubscriptionsRequest[] = [];
	readonly reconnectRequests: IAgentHostReconnectRequest[] = [];
	readonly resolveConfigurationRequests: IAgentHostResolveSessionConfigurationRequest[] = [];
	readonly completionRequests: IAgentHostSessionConfigurationCompletionsRequest[] = [];
	readonly prepareRequests: IAgentHostPrepareSubmissionRequest[] = [];
	readonly mutationRequests: IAgentHostMutationRequest[] = [];
	readonly operationOutcomeRequests: IAgentHostOperationOutcomeRequest[] = [];
	readonly packageOperationRequests: IAgentPackageOperationRequest[] = [];
	readonly packageOperationOutcomeRequests: IAgentPackageOperationOutcomeRequest[] = [];
	reconnectResult: AgentHostReconnectResult | undefined;
	reconnectRequest: ((request: IAgentHostReconnectRequest) => Promise<AgentHostReconnectResult>) | undefined;
	resolveConfiguration: (
		request: IAgentHostResolveSessionConfigurationRequest,
	) => Promise<IAgentHostResolveSessionConfigurationResult> = async () => ({
		agent: agentId,
		runtimeRegistration: registrationRevision,
		configuration: sessionConfigurationState,
	});
	completeConfiguration: (
		request: IAgentHostSessionConfigurationCompletionsRequest,
	) => Promise<IAgentHostSessionConfigurationCompletionsResult> = async request => ({
		agent: agentId,
		runtimeRegistration: registrationRevision,
		schema: request.resolvedSchema.revision,
		completions: [],
	});
	prepare: (request: IAgentHostPrepareSubmissionRequest) => ReturnType<IAgentHostConnection['prepareSubmission']> = async () => ({
		kind: 'rejected',
		failure: {
			code: AgentHostOperationFailureCode.InvalidPayload,
			message: 'Preparation is not configured.',
			reconciliation: 'terminal',
		},
	});
	mutateRequest: (request: IAgentHostMutationRequest) => Promise<AgentHostMutationOutcome> = async () => {
		throw new Error('Mutation is not configured.');
	};
	operationOutcome: (request: IAgentHostOperationOutcomeRequest) => Promise<AgentHostMutationOutcome> = async () => ({ kind: 'unknown' });
	packageOperation: (
		request: IAgentPackageOperationRequest,
	) => Promise<AgentPackageOperationOutcome> = async () => ({ kind: 'unknown' });
	packageOperationOutcome: (
		request: IAgentPackageOperationOutcomeRequest,
	) => Promise<AgentPackageOperationOutcome> = async () => ({ kind: 'unknown' });

	constructor(sessions: readonly IAgentHostSessionState[] = []) {
		this.replaceSessions(sessions);
	}

	replaceSessions(sessions: readonly IAgentHostSessionState[]): void {
		this.sessions.clear();
		for (const session of sessions) {
			this.sessions.set(session.id, session);
		}
		this.catalog = { sessions: sessions.map(toSessionSummary) };
	}

	setRevision(channel: AgentHostChannelId, revision: number): void {
		this.revisions.set(channel, revision);
	}

	async initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		assert.deepStrictEqual(request.subscriptions, [getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]);
		assert.deepStrictEqual(request.protocolVersions, [createAgentHostProtocolVersion('3')]);
		this.replaceActiveSubscriptions(request.subscriptions);
		return {
			protocolVersion: createAgentHostProtocolVersion('3'),
			capabilities: [],
			implementation: { name: 'test-host', build: '1' },
			hostSequence: createAgentHostSequence(this.sequence),
			snapshots: request.subscriptions.map(channel => this.snapshot(channel)!),
			missingChannels: [],
		};
	}

	async reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		this.reconnectRequests.push(request);
		const result = this.reconnectRequest !== undefined
			? await this.reconnectRequest(request)
			: this.reconnectResult;
		if (result === undefined) {
			throw new Error('Reconnect is not configured.');
		}
		const missing = new Set(result.missingChannels.map(item => item.channel));
		this.replaceActiveSubscriptions(request.subscriptions.filter(channel => !missing.has(channel)));
		return result;
	}

	async setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		this.setSubscriptionsRequests.push(request);
		const snapshots: AgentHostChannelSnapshot[] = [];
		const missingChannels: IAgentHostSetSubscriptionsResult['missingChannels'][number][] = [];
		for (const channel of request.subscriptions) {
			const snapshot = this.snapshot(channel);
			if (snapshot) {
				snapshots.push(snapshot);
			} else {
				missingChannels.push({ channel, reason: 'notFound' });
			}
		}
		this.replaceActiveSubscriptions(snapshots.map(snapshot => snapshot.channel));
		return {
			hostSequence: createAgentHostSequence(this.sequence),
			snapshots,
			missingChannels,
		};
	}

	resolveSessionConfiguration(
		request: IAgentHostResolveSessionConfigurationRequest,
	): Promise<IAgentHostResolveSessionConfigurationResult> {
		this.resolveConfigurationRequests.push(request);
		return this.resolveConfiguration(request);
	}

	completeSessionConfiguration(
		request: IAgentHostSessionConfigurationCompletionsRequest,
	): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		this.completionRequests.push(request);
		return this.completeConfiguration(request);
	}

	prepareSubmission(request: IAgentHostPrepareSubmissionRequest): ReturnType<IAgentHostConnection['prepareSubmission']> {
		this.prepareRequests.push(request);
		return this.prepare(request);
	}

	async mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		this.mutationRequests.push(request);
		return this.mutateRequest(request);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		this.operationOutcomeRequests.push(request);
		return this.operationOutcome(request);
	}

	executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		this.packageOperationRequests.push(request);
		return this.packageOperation(request);
	}

	getPackageOperationOutcome(request: IAgentPackageOperationOutcomeRequest): Promise<AgentPackageOperationOutcome> {
		this.packageOperationOutcomeRequests.push(request);
		return this.packageOperationOutcome(request);
	}

	emitSessionState(state: IAgentHostSessionState, revision: number, digestCharacter: string): AgentHostChannelAction {
		this.sessions.set(state.id, state);
		this.catalog = { sessions: [...this.sessions.values()].map(toSessionSummary) };
		this.sequence++;
		const channel = getAgentHostSessionChannelId(state.id);
		this.setRevision(channel, revision);
		const action: AgentHostChannelAction = {
			channel,
			kind: 'session',
			hostSequence: createAgentHostSequence(this.sequence),
			revision: createAgentHostChannelRevision(revision),
			digest: createAgentHostActionDigest(`sha256:${digestCharacter.repeat(64)}`),
			cause: { kind: 'host' },
			action: { kind: 'sessionStateChanged', state },
		};
		if (this.activeSubscriptions.has(channel)) {
			this.actionEmitter.fire(action);
		}
		return action;
	}

	emit(action: AgentHostChannelAction): void {
		if (this.activeSubscriptions.has(action.channel)) {
			this.actionEmitter.fire(action);
		}
	}

	dispose(): void {
		this.actionEmitter.dispose();
	}

	private replaceActiveSubscriptions(subscriptions: readonly AgentHostChannelId[]): void {
		this.activeSubscriptions.clear();
		for (const channel of subscriptions) {
			this.activeSubscriptions.add(channel);
		}
	}

	snapshot(channel: AgentHostChannelId): AgentHostChannelSnapshot | undefined {
		const revision = createAgentHostChannelRevision(this.revisions.get(channel) ?? 1);
		const hostSequence = createAgentHostSequence(this.sequence);
		if (channel === getAgentHostRootChannelId()) {
			return { channel, kind: 'root', hostSequence, revision, state: this.root };
		}
		if (channel === getAgentHostSessionsChannelId()) {
			return { channel, kind: 'sessions', hostSequence, revision, state: this.catalog };
		}
		for (const session of this.sessions.values()) {
			if (channel === getAgentHostSessionChannelId(session.id)) {
				return { channel, kind: 'session', hostSequence, revision, state: session };
			}
			for (const summary of session.chats) {
				if (channel === getAgentHostChatChannelId(session.id, summary.id)) {
					const chat = (session as IAgentHostSessionState & { readonly fullChats?: readonly IAgentHostChatState[] }).fullChats
						?.find(candidate => candidate.id === summary.id);
					if (!chat) {
						throw new Error(`Test Session '${session.id}' has no full Chat '${summary.id}'.`);
					}
					return { channel, kind: 'chat', hostSequence, revision, state: chat };
				}
			}
		}
		return undefined;
	}
}

class TestRemoteAgentHostTransport implements IRemoteAgentHostProtocolTransport {
	private readonly stateEmitter = new Emitter<IRemoteAgentHostTransportStateChange>();
	private readonly actionEmitter = new Emitter<AgentHostChannelAction>();
	private readonly hostActionListener: IDisposable;
	private currentGeneration = 1;
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidReceiveAction = this.actionEmitter.event;
	state: RemoteAgentHostTransportState = 'connected';
	disposed = false;

	constructor(private readonly host: TestAgentHostConnection) {
		this.hostActionListener = host.onDidReceiveAction(action => this.actionEmitter.fire(action));
	}

	get generation(): number {
		return this.currentGeneration;
	}

	async call(
		command: typeof RemoteAgentHostProtocolCommand[keyof typeof RemoteAgentHostProtocolCommand],
		argument: AgentHostProtocolValue | undefined,
		_cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		switch (command) {
			case RemoteAgentHostProtocolCommand.Identity:
				return { authority: this.host.authority, connection: this.host.connection };
			case RemoteAgentHostProtocolCommand.Initialize:
				return await this.host.initialize(argument as unknown as IAgentHostInitializeRequest) as unknown as AgentHostProtocolValue;
			case RemoteAgentHostProtocolCommand.SetSubscriptions:
				return await this.host.setSubscriptions(
					argument as unknown as IAgentHostSetSubscriptionsRequest,
				) as unknown as AgentHostProtocolValue;
			case RemoteAgentHostProtocolCommand.Reconnect:
				return await this.host.reconnect(
					argument as unknown as IAgentHostReconnectRequest,
				) as unknown as AgentHostProtocolValue;
			case RemoteAgentHostProtocolCommand.Mutate:
				return await this.host.mutate(
					argument as unknown as IAgentHostMutationRequest,
				) as unknown as AgentHostProtocolValue;
			case RemoteAgentHostProtocolCommand.GetOperationOutcome:
				return await this.host.getOperationOutcome(
					argument as unknown as IAgentHostOperationOutcomeRequest,
				) as unknown as AgentHostProtocolValue;
			default:
				throw new Error(`Unexpected remote Agent Host command '${command}'.`);
		}
	}

	bindClientEndpoints(
		_connection: AgentHostClientConnectionId,
		_contentResources: IClientContentResourceService,
		_tools: IRemoteAgentHostClientToolEndpoint,
	) {
		return toDisposable(() => {});
	}

	terminate(): void {
		this.state = 'terminal';
		this.stateEmitter.fire(Object.freeze({ state: this.state, generation: this.generation }));
	}

	interrupt(): void {
		this.state = 'restoring';
		this.stateEmitter.fire(Object.freeze({ state: this.state, generation: this.generation }));
	}

	restore(): void {
		this.currentGeneration += 1;
		this.state = 'connected';
		this.stateEmitter.fire(Object.freeze({ state: this.state, generation: this.generation }));
	}

	emitAction(action: AgentHostChannelAction): void {
		this.actionEmitter.fire(action);
	}

	dispose(): void {
		this.disposed = true;
		this.hostActionListener.dispose();
		this.actionEmitter.dispose();
		this.stateEmitter.dispose();
	}
}

type TestSessionState = IAgentHostSessionState & { readonly fullChats: readonly IAgentHostChatState[] };

function withFullChats(state: IAgentHostSessionState, chats: readonly IAgentHostChatState[]): TestSessionState {
	return Object.assign(state, { fullChats: chats });
}

function createFixture(sessions: readonly IAgentHostSessionState[] = []) {
	const connection = new TestAgentHostConnection(sessions);
	const chatService = new ChatService(createTestChatStorageService());
	return { connection, chatService };
}

async function createProvider(connection: TestAgentHostConnection, chatService: ChatService): Promise<AgentHostSessionsProvider> {
	return AgentHostSessionsProvider.create(connection, chatService, {
		locale: 'en',
		resolveDisplayText: displayText => {
			if (displayText.kind !== 'literal') {
				throw new Error(`Unexpected localized display text '${displayText.key}'.`);
			}
			return displayText.value;
		},
		implementation: { name: 'comet-test', build: '1' },
	});
}

function createRemoteContribution(
	transport: IRemoteAgentHostProtocolTransport,
	chatService: ChatService,
	providers: SessionsProvidersService,
): RemoteAgentHostSessionsContribution {
	const localeService: IWorkbenchLocaleService = {
		_serviceBrand: undefined,
		getLocale: () => 'en',
		subscribe: () => () => {},
		applyLocale: () => {},
		updateLocalePreference: async () => {},
		syncDocumentLanguage: () => {},
		initialize: async () => 'en',
	};
	const languageService: IWorkbenchLanguageService = {
		_serviceBrand: undefined,
		detectInitialLocale: () => 'en',
		getLocaleMessages,
		toDocumentLang: () => 'en',
	};
	return new RemoteAgentHostSessionsContribution(
		transport,
		{
			implementation: { name: 'remote-provider-test', build: '1' },
			maximumClientToolCallRecords: 4,
			maximumBufferedActions: 4,
			contentResourceLimits: remoteContentResourceLimits,
		},
		chatService,
		providers,
		new AgentHostManagementService(),
		localeService,
		languageService,
	);
}

function waitForSessionsChange(provider: AgentHostSessionsProvider) {
	return new Promise<Parameters<Parameters<typeof provider.onDidChangeSessions>[0]>[0]>(resolve => {
		const disposable = provider.onDidChangeSessions(event => {
			disposable.dispose();
			resolve(event);
		});
	});
}

suite('AgentHostSessionsProvider', { concurrency: false }, () => {
	test('rejects a root snapshot with non-exact runtime registration fields', async () => {
		const { connection, chatService } = createFixture();
		connection.root = {
			...connection.root,
			agentRegistrations: [{
				...connection.root.agentRegistrations[0],
				unexpected: true,
			} as typeof connection.root.agentRegistrations[number]],
		};

		await assert.rejects(createProvider(connection, chatService), /invalid runtime registration fields/);
	});

	test('rejects Host defaults whose validated schema differs from the registration at the same revision', async () => {
		const { connection, chatService } = createFixture();
		const conflictingSchema = validateAndFreezeAgentConfigurationSchema({
			...hostDefaultsSchema,
			properties: [{
				id: 'comet.endpoint',
				owner: { kind: 'agent', agent: agentId },
				scopes: ['hostDefault'],
				value: { type: 'string', maximumLength: 512 },
				required: false,
				sessionMutable: false,
				dynamicCompletion: false,
				display: { label: 'Endpoint' },
				persistence: 'persisted',
				redaction: 'public',
			}],
		});
		connection.root = {
			...connection.root,
			agentDefaults: [{
				schema: conflictingSchema,
				revision: hostDefaultsState.revision,
				values: {},
			}],
		};

		await assert.rejects(
			createProvider(connection, chatService),
			/Host defaults for Agent 'comet' do not match its runtime registration schema/,
		);
	});

	test('resends an unknown package install with the same operation identity and digest', async () => {
		const { connection, chatService } = createFixture();
		const optionalPackageId = createAgentPackageId('claude');
		const offering = Object.freeze({
			packageId: optionalPackageId,
			revision: createAgentPackageRevision('claude.test.v1'),
			contentDigest: createAgentPackageContentDigest(`sha256:${'c'.repeat(64)}`),
			source: 'file:///verified/claude-runtime.js',
			distribution: 'user' as const,
		});
		connection.root = {
			...connection.root,
			capabilities: { ...connection.root.capabilities, supportsPackageOperations: true },
			packages: { ...connection.root.packages, installablePackages: [offering] },
		};
		let attempt = 0;
		connection.packageOperation = async request => {
			attempt += 1;
			if (attempt === 1) {
				return { kind: 'unknown' };
			}
			return {
				kind: 'succeeded',
				result: {
					operationId: request.operation,
					requestDigest: request.digest,
					kind: 'install',
					packageId: optionalPackageId,
					stateRevision: 1,
					affectedRecords: 0,
				},
			};
		};
		const provider = await createProvider(connection, chatService);
		try {
			await provider.installPackage(optionalPackageId);
			assert.equal(connection.packageOperationRequests.length, 2);
			assert.deepStrictEqual(connection.packageOperationRequests[1], connection.packageOperationRequests[0]);
			assert.deepStrictEqual(provider.getManagementSnapshot().pendingPackages, []);
		} finally {
			provider.dispose();
		}
	});

	test('reconciles a package install after transport loss without creating another operation', async () => {
		const { connection, chatService } = createFixture();
		const optionalPackageId = createAgentPackageId('claude');
		const offering = Object.freeze({
			packageId: optionalPackageId,
			revision: createAgentPackageRevision('claude.recovery.v1'),
			contentDigest: createAgentPackageContentDigest(`sha256:${'d'.repeat(64)}`),
			source: 'file:///verified/claude-recovery-runtime.js',
			distribution: 'user' as const,
		});
		connection.root = {
			...connection.root,
			capabilities: { ...connection.root.capabilities, supportsPackageOperations: true },
			packages: { ...connection.root.packages, installablePackages: [offering] },
		};
		let committed: IAgentPackageOperationRequest | undefined;
		connection.packageOperation = async request => {
			committed = request;
			throw new Error('Transport was lost after package commit.');
		};
		let outcomeAttempt = 0;
		connection.packageOperationOutcome = async request => {
			outcomeAttempt += 1;
			if (outcomeAttempt === 1) {
				throw new Error('Transport is unavailable.');
			}
			return {
				kind: 'succeeded',
				result: {
					operationId: request.operation,
					requestDigest: request.digest,
					kind: 'install',
					packageId: optionalPackageId,
					stateRevision: 1,
					affectedRecords: 0,
				},
			};
		};
		const provider = await createProvider(connection, chatService);
		try {
			await assert.rejects(
				provider.installPackage(optionalPackageId),
				/not reached a reconciled terminal outcome/,
			);
			assert.ok(committed);
			assert.deepStrictEqual(provider.getManagementSnapshot().pendingPackages, [optionalPackageId]);

			const recoverySubscriptions = [...connection.activeSubscriptions];
			connection.reconnectResult = {
				kind: 'snapshots',
				hostSequence: createAgentHostSequence(connection.sequence),
				snapshots: recoverySubscriptions.map(channel => connection.snapshot(channel)!),
				missingChannels: [],
			};
			provider.beginConnectionRecovery(1);
			assert.equal(await provider.recoverConnection(2), true);
			await provider.completeConnectionRecovery(2);

			assert.equal(connection.packageOperationRequests.length, 1);
			assert.equal(connection.packageOperationOutcomeRequests.length, 2);
			assert.deepStrictEqual(connection.packageOperationOutcomeRequests[1], {
				operation: committed.operation,
				digest: committed.digest,
			});
			assert.deepStrictEqual(provider.getManagementSnapshot().pendingPackages, []);
		} finally {
			provider.dispose();
		}
	});

	test('updates Host defaults through the reconciled mutation path and refreshes the management snapshot', async () => {
		const { connection, chatService } = createFixture();
		const propertyId = createAgentConfigurationPropertyId('comet.enabled');
		const configurationSchema = validateAndFreezeAgentConfigurationSchema({
			profile: AgentConfigurationSchemaProfile,
			agent: agentId,
			scope: 'hostDefault',
			revision: 'comet.management-defaults.v1',
			properties: [{
				id: propertyId,
				owner: { kind: 'agent', agent: agentId },
				scopes: ['hostDefault'],
				value: { type: 'boolean' },
				required: false,
				sessionMutable: false,
				dynamicCompletion: false,
				display: { label: 'Enabled' },
				persistence: 'persisted',
				redaction: 'public',
			}],
		});
		const initialConfiguration = Object.freeze({
			schema: configurationSchema,
			revision: createAgentConfigurationStateRevision('comet.management-defaults.state.v1'),
			values: Object.freeze({}),
		});
		connection.root = {
			...connection.root,
			agentRegistrations: [{
				...connection.root.agentRegistrations[0],
				hostDefaultsSchema: configurationSchema,
			}],
			agentDefaults: [initialConfiguration],
		};
		let attempt = 0;
		connection.mutateRequest = async request => {
			attempt += 1;
			if (attempt === 1) {
				return { kind: 'unknown' };
			}
			const updatedConfiguration = Object.freeze({
				schema: configurationSchema,
				revision: createAgentConfigurationStateRevision('comet.management-defaults.state.v2'),
				values: Object.freeze({ [propertyId]: true }),
			});
			connection.sequence += 1;
			connection.setRevision(getAgentHostRootChannelId(), 2);
			connection.root = { ...connection.root, agentDefaults: [updatedConfiguration] };
			return {
				kind: 'succeeded',
				result: {
					kind: 'updateAgentDefaults',
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(connection.sequence),
					revisions: [],
					agent: agentId,
					configuration: updatedConfiguration.revision,
				},
			};
		};
		const provider = await createProvider(connection, chatService);
		try {
			await provider.updateAgentDefault(agentId, propertyId, true);
			assert.equal(connection.mutationRequests.length, 2);
			assert.deepStrictEqual(connection.mutationRequests[1], connection.mutationRequests[0]);
			assert.deepStrictEqual(provider.getManagementSnapshot().agentDefaults[0].values, {
				[propertyId]: true,
			});
			assert.deepStrictEqual(provider.getManagementSnapshot().pendingConfigurations, []);
		} finally {
			provider.dispose();
		}
	});

	test('reprojects provider, Session type, draft, and preset display across consecutive locale changes without changing identity', async () => {
		const { connection, chatService } = createFixture();
		connection.root = {
			...connection.root,
			label: { kind: 'localized', key: 'agentHost.local.label' },
			sessionTypes: connection.root.sessionTypes.map(descriptor => ({
				...descriptor,
				displayName: { kind: 'localized', key: 'agentHost.cometSession.displayName' },
				description: { kind: 'localized', key: 'agentHost.cometSession.description' },
				executionPresets: descriptor.executionPresets.map(preset => ({
					...preset,
					displayName: { kind: 'localized', key: 'agentHost.executionPreset.automatic' },
				})),
			})),
		};
		const localized = {
			en: {
				'agentHost.local.label': 'Local',
				'agentHost.cometSession.displayName': 'Comet Session',
				'agentHost.cometSession.description': 'General Agent session',
				'agentHost.executionPreset.automatic': 'Automatic',
			},
			zh: {
				'agentHost.local.label': '本地',
				'agentHost.cometSession.displayName': '智能体会话',
				'agentHost.cometSession.description': '通用智能体会话',
				'agentHost.executionPreset.automatic': '自动',
			},
		} as const;
		let locale: keyof typeof localized = 'en';
		const resolveDisplayText = (displayText: Parameters<typeof resolveAgentHostDisplayText>[0]) => (
			resolveAgentHostDisplayText(displayText, localized[locale])
		);
		const provider = await AgentHostSessionsProvider.create(connection, chatService, {
			locale,
			resolveDisplayText,
			implementation: { name: 'comet-test', build: '1' },
		});
		try {
			const providerId = provider.id;
			const projectedTypeId = provider.sessionTypes[0].id;
			const draft = provider.createSessionDraft({
				sessionType,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			});
			assert.equal(provider.label, 'Local');
			assert.equal(provider.sessionTypes[0].label, 'Comet Session');
			assert.equal(draft.title.get(), 'Comet Session');
			assert.equal(resolveDisplayText(connection.root.sessionTypes[0].executionPresets[0].displayName), 'Automatic');

			let presentationChanges = 0;
			provider.onDidChangeSessionTypes(() => presentationChanges++);
			locale = 'zh';
			provider.refreshLocalizedPresentation();
			assert.equal(provider.label, '本地');
			assert.equal(provider.sessionTypes[0].label, '智能体会话');
			assert.equal(draft.title.get(), '智能体会话');
			assert.equal(resolveDisplayText(connection.root.sessionTypes[0].executionPresets[0].displayName), '自动');

			locale = 'en';
			provider.refreshLocalizedPresentation();
			assert.equal(provider.label, 'Local');
			assert.equal(provider.sessionTypes[0].label, 'Comet Session');
			assert.equal(draft.title.get(), 'Comet Session');
			assert.equal(presentationChanges, 2);
			assert.equal(provider.id, providerId);
			assert.equal(provider.sessionTypes[0].id, projectedTypeId);
			assert.equal(provider.getSessions().length, 0);
		} finally {
			provider.dispose();
		}
	});

	test('projects ordered zero-to-many Chats without a privileged or fallback Chat', async () => {
		const empty = withFullChats(createSessionState('empty-session', 'Empty', []), []);
		const fullSessionId = createAgentSessionId('full-session');
		const first = createChatState(fullSessionId, 'chat-one', 'First');
		const second = createChatState(fullSessionId, 'chat-two', 'Second', {
			origin: { kind: 'fork', parentChat: first.id, parentTurn: createAgentTurnId('turn-parent') },
			lifecycle: 'released',
		});
		const full = withFullChats(createSessionState('full-session', 'Full', [first, second]), [first, second]);
		const { connection, chatService } = createFixture([empty, full]);
		const provider = await createProvider(connection, chatService);
		try {
			const sessions = provider.getSessions();
			assert.equal(sessions.length, 2);
			assert.deepStrictEqual(sessions[0]!.chats.get(), []);
			const chats = sessions[1]!.chats.get();
			assert.equal(chats.length, 2);
			assert.equal(chats[0]!.origin.kind, ChatOriginKind.User);
			assert.equal(chats[1]!.origin.kind, ChatOriginKind.Fork);
			assert.equal(
				chats[1]!.origin.kind === ChatOriginKind.Fork
					? chats[1]!.origin.parentChat.toString()
					: undefined,
				chats[0]!.resource.toString(),
			);
			assert.equal(chats[1]!.interactivity.get(), ChatInteractivity.ReadOnly);
		} finally {
			provider.dispose();
		}
	});

	test('hydrates retained unavailable history without an active Agent registration or Session type', async () => {
		const sessionId = createAgentSessionId('unavailable-session');
		const chat = createChatState(sessionId, 'unavailable-chat', 'Unavailable Chat', {
			lifecycle: 'unavailable',
		});
		const session = withFullChats(createSessionState(
			'unavailable-session',
			'Unavailable Session',
			[chat],
			{ lifecycle: 'unavailable' },
		), [chat]);
		const { connection, chatService } = createFixture([session]);
		connection.root = {
			...connection.root,
			capabilities: { ...connection.root.capabilities, supportsCreateSession: false },
			agents: [],
			agentRegistrations: [],
			agentDefaults: [],
			sessionTypes: [],
		};
		const provider = await createProvider(connection, chatService);
		try {
			assert.deepStrictEqual(provider.sessionTypes, []);
			const retained = provider.getSessions();
			assert.equal(retained.length, 1);
			assert.equal(retained[0].title.get(), 'Unavailable Session');
			assert.equal(retained[0].chats.get()[0].title.get(), 'Unavailable Chat');
			assert.equal(retained[0].chats.get()[0].interactivity.get(), ChatInteractivity.ReadOnly);
			assert.throws(
				() => provider.getModels(retained[0], retained[0].chats.get()[0]),
				/does not expose Session type/,
			);
			await assert.rejects(provider.renameSession(retained[0], 'Renamed'), /is 'unavailable'/);
			assert.deepStrictEqual(connection.mutationRequests, []);
		} finally {
			provider.dispose();
		}
	});

	test('applies contiguous actions once and requires a fresh exact snapshot after a gap', async () => {
		const initial = withFullChats(createSessionState('action-session', 'Initial', []), []);
		const { connection, chatService } = createFixture([initial]);
		connection.setRevision(getAgentHostSessionChannelId(initial.id), 1);
		const provider = await createProvider(connection, chatService);
		try {
			let changes = 0;
			provider.onDidChangeSessions(() => changes++);
			const contiguous = withFullChats({ ...initial, title: 'Contiguous', modifiedAt: 3 }, []);
			const firstChange = waitForSessionsChange(provider);
			const action = connection.emitSessionState(contiguous, 2, 'b');
			await firstChange;
			assert.equal(provider.getSessions()[0].title.get(), 'Contiguous');
			assert.equal(changes, 1);

			connection.emit(action);
			const gapped = withFullChats({ ...contiguous, title: 'Fresh snapshot', modifiedAt: 4 }, []);
			const gapChange = waitForSessionsChange(provider);
			connection.emitSessionState(gapped, 4, 'c');
			await gapChange;
			assert.equal(provider.getSessions()[0].title.get(), 'Fresh snapshot');
			assert.equal(changes, 2);
		} finally {
			provider.dispose();
		}
	});

	test('applies a strict reconnect replay before synchronizing the exact topology', async () => {
		const initial = withFullChats(createSessionState('replay-session', 'Initial', []), []);
		const { connection, chatService } = createFixture([initial]);
		const sessionChannel = getAgentHostSessionChannelId(initial.id);
		connection.setRevision(sessionChannel, 1);
		const provider = await createProvider(connection, chatService);
		try {
			const replayed = withFullChats({ ...initial, title: 'Replayed', modifiedAt: 3 }, []);
			connection.replaceSessions([replayed]);
			connection.sequence = 2;
			connection.setRevision(sessionChannel, 2);
			connection.reconnectResult = {
				kind: 'replay',
				fromHostSequence: createAgentHostSequence(1),
				throughHostSequence: createAgentHostSequence(2),
				actions: [{
					channel: sessionChannel,
					kind: 'session',
					hostSequence: createAgentHostSequence(2),
					revision: createAgentHostChannelRevision(2),
					digest: createAgentHostActionDigest(`sha256:${'e'.repeat(64)}`),
					cause: { kind: 'host' },
					action: { kind: 'sessionStateChanged', state: replayed },
				}],
				missingChannels: [],
			};

			provider.beginConnectionRecovery(1);
			assert.equal(await provider.recoverConnection(2), true);
			await provider.completeConnectionRecovery(2);
			assert.equal(provider.getSessions()[0].title.get(), 'Replayed');
			assert.deepStrictEqual(connection.reconnectRequests[0].subscriptions, [
				getAgentHostRootChannelId(),
				getAgentHostSessionsChannelId(),
				sessionChannel,
			]);
		} finally {
			provider.dispose();
		}
	});

	test('rejects a reconnect replay gap without requesting a replacement snapshot', async () => {
		const initial = withFullChats(createSessionState('replay-gap-session', 'Initial', []), []);
		const { connection, chatService } = createFixture([initial]);
		const sessionChannel = getAgentHostSessionChannelId(initial.id);
		connection.setRevision(sessionChannel, 1);
		const provider = await createProvider(connection, chatService);
		try {
			const gapped = withFullChats({ ...initial, title: 'Must not apply', modifiedAt: 3 }, []);
			connection.replaceSessions([gapped]);
			connection.sequence = 2;
			connection.setRevision(sessionChannel, 3);
			connection.reconnectResult = {
				kind: 'replay',
				fromHostSequence: createAgentHostSequence(1),
				throughHostSequence: createAgentHostSequence(2),
				actions: [{
					channel: sessionChannel,
					kind: 'session',
					hostSequence: createAgentHostSequence(2),
					revision: createAgentHostChannelRevision(3),
					digest: createAgentHostActionDigest(`sha256:${'f'.repeat(64)}`),
					cause: { kind: 'host' },
					action: { kind: 'sessionStateChanged', state: gapped },
				}],
				missingChannels: [],
			};
			const subscriptionRequestCount = connection.setSubscriptionsRequests.length;

			provider.beginConnectionRecovery(1);
			await assert.rejects(provider.recoverConnection(2), /reconnect replay is not contiguous/);
			assert.equal(connection.setSubscriptionsRequests.length, subscriptionRequestCount);
			assert.throws(() => provider.getSessions(), /is disposed/);
		} finally {
			provider.dispose();
		}
	});

	test('drops reconnect snapshot missing channels, reducers, subscriptions, and Chat models', async () => {
		const sessionId = createAgentSessionId('snapshot-session');
		const first = createChatState(sessionId, 'first-chat', 'First');
		const second = createChatState(sessionId, 'second-chat', 'Second');
		const initial = withFullChats(createSessionState('snapshot-session', 'Snapshot', [first, second]), [first, second]);
		const { connection, chatService } = createFixture([initial]);
		const provider = await createProvider(connection, chatService);
		const firstResource = provider.getSessions()[0].chats.get()[0].resource;
		try {
			const retained = withFullChats(createSessionState('snapshot-session', 'Snapshot', [second]), [second]);
			connection.replaceSessions([retained]);
			connection.sequence = 4;
			connection.setRevision(getAgentHostSessionsChannelId(), 2);
			connection.setRevision(getAgentHostSessionChannelId(sessionId), 2);
			connection.setRevision(getAgentHostChatChannelId(sessionId, second.id), 2);
			const firstChannel = getAgentHostChatChannelId(sessionId, first.id);
			const retainedChannels = [
				getAgentHostRootChannelId(),
				getAgentHostSessionsChannelId(),
				getAgentHostSessionChannelId(sessionId),
				getAgentHostChatChannelId(sessionId, second.id),
			];
			connection.reconnectResult = {
				kind: 'snapshots',
				hostSequence: createAgentHostSequence(4),
				snapshots: retainedChannels.map(channel => connection.snapshot(channel)!),
				missingChannels: [{ channel: firstChannel, reason: 'deleted' }],
			};

			provider.beginConnectionRecovery(1);
			await provider.recoverConnection(2);
			await provider.completeConnectionRecovery(2);
			assert.equal(provider.getSessions()[0].chats.get().length, 1);
			assert.equal(provider.getSessions()[0].chats.get()[0].title.get(), 'Second');
			assert.equal(connection.reconnectRequests[0].subscriptions.includes(firstChannel), true);
			assert.deepStrictEqual([...connection.activeSubscriptions], retainedChannels);
			assert.throws(() => chatService.acquireModel(firstResource), /does not exist/);
		} finally {
			provider.dispose();
		}
	});

	test('drops an ordinary subscription missing channel while refreshing after deletion', async () => {
		const sessionId = createAgentSessionId('ordinary-missing-session');
		const first = createChatState(sessionId, 'first-chat', 'First');
		const second = createChatState(sessionId, 'second-chat', 'Second');
		const initial = withFullChats(createSessionState('ordinary-missing-session', 'Ordinary', [first, second]), [first, second]);
		const { connection, chatService } = createFixture([initial]);
		const provider = await createProvider(connection, chatService);
		const session = provider.getSessions()[0];
		const firstModel = session.chats.get()[0];
		const firstChannel = getAgentHostChatChannelId(sessionId, first.id);
		connection.mutateRequest = async request => {
			assert.equal(request.payload.kind, 'deleteChat');
			const retained = withFullChats(createSessionState('ordinary-missing-session', 'Ordinary', [second]), [second]);
			connection.sequence++;
			connection.replaceSessions([retained]);
			connection.setRevision(getAgentHostSessionsChannelId(), 2);
			connection.setRevision(getAgentHostSessionChannelId(sessionId), 2);
			return {
				kind: 'succeeded',
				result: {
					kind: 'deleteChat',
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(connection.sequence),
					revisions: [],
					session: sessionId,
					chat: first.id,
				},
			};
		};
		try {
			await provider.deleteChat(session, firstModel);
			assert.equal(provider.getSessions()[0].chats.get().length, 1);
			assert.equal(connection.activeSubscriptions.has(firstChannel), false);
			assert.equal(
				connection.setSubscriptionsRequests.some(request => request.subscriptions.includes(firstChannel)),
				true,
			);
			assert.throws(() => chatService.acquireModel(firstModel.resource), /does not exist/);
		} finally {
			provider.dispose();
		}
	});

	test('preserves a rejected draft composer and atomically replaces it after Host acceptance', async () => {
		const { connection, chatService } = createFixture();
		const provider = await createProvider(connection, chatService);
		try {
			const draft = provider.createSessionDraft({
				sessionType,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			});
			const draftChat = draft.chats.get()[0];
			chatService.setInput(draftChat.resource, 'immutable prompt');
			await assert.rejects(provider.sendRequest(draft, draftChat), /Preparation is not configured/);
			assert.equal(connection.resolveConfigurationRequests.length, 1);
			assert.equal(
				connection.resolveConfigurationRequests[0].candidate.schema,
				sessionConfigurationSchema.revision,
			);
			assert.notEqual(
				connection.resolveConfigurationRequests[0].candidate.schema,
				connection.root.agentRegistrations[0].supportedSessionConfigurationSchemas[0],
			);
			assert.equal(connection.prepareRequests[0].target.kind, 'draft');
			if (connection.prepareRequests[0].target.kind !== 'draft') {
				throw new Error('Expected draft preparation target.');
			}
			assert.strictEqual(
				connection.prepareRequests[0].target.configuration,
				connection.resolveConfigurationRequests[0].candidate,
			);
			assert.equal(connection.prepareRequests[0].executionSelection.kind, 'preset');
			assert.equal(
				connection.prepareRequests[0].executionSelection.configuration.schema,
				modelConfigurationSchema.revision,
			);
			const preserved = chatService.acquireModel(draftChat.resource);
			assert.equal(preserved.object.getSnapshot().input, 'immutable prompt');
			preserved.dispose();
			await provider.setChatModel(draft, draftChat, modelId);

			connection.prepare = async request => {
				assert.equal(request.target.kind, 'draft');
				if (request.target.kind !== 'draft') {
					throw new Error('Expected draft preparation target.');
				}
				const resolveRequest = connection.resolveConfigurationRequests[
					connection.resolveConfigurationRequests.length - 1
				];
				assert.strictEqual(request.target.configuration, resolveRequest.candidate);
				assert.equal(request.executionSelection.kind, 'model');
				assert.equal(request.executionSelection.configuration.schema, modelConfigurationSchema.revision);
				assert.deepStrictEqual(request.executionSelection.configuration.values, {});
				const runtimeRegistration = createAgentRuntimeRegistrationRevision('runtime-1');
				const agentDescriptor = createAgentDescriptorRevision('agent-revision-1');
				const modelDescriptor = createAgentModelDescriptorRevision('model-revision-1');
				return {
				kind: 'prepared',
				submission: {
					submission: request.submission,
					payloadDigest,
					message: request.capture.message,
					attachments: request.capture.attachments,
					interactionTargets: request.capture.interactionTargets,
					sessionConfiguration: sessionConfigurationState,
					modelConfiguration: request.executionSelection.configuration,
					credentials: [],
					executionProfile: {
						revision: createAgentExecutionProfileRevision('profile-1'),
						digest: createAgentExecutionProfileDigest(`sha256:${'d'.repeat(64)}`),
						agentDescriptor,
						modelDescriptor,
						data: '{}',
					},
					runtimeRegistration,
					toolSet: {
						revision: createAgentToolSetRevision('tools-1'),
						schemaProfile: createAgentToolSchemaProfileId('comet.tools'),
						runtimeRegistration,
						agentDescriptor,
						modelDescriptor,
						registrations: [],
					},
					requestedDeadline: 100,
					outputConstraints: {},
				},
				};
			};
			connection.mutateRequest = async request => {
				assert.equal(request.payload.kind, 'createSession');
				if (request.payload.kind !== 'createSession') {
					throw new Error('Expected createSession.');
				}
				assert.equal(request.payload.chats.length, 1);
				const prepareRequest = connection.prepareRequests[connection.prepareRequests.length - 1];
				if (prepareRequest.target.kind !== 'draft') {
					throw new Error('Expected draft preparation target.');
				}
				assert.strictEqual(request.payload.configuration, prepareRequest.target.configuration);
				assert.equal(request.payload.chats[0].initialSubmission?.message, 'immutable prompt');
				const sessionId = createAgentSessionId('committed-session');
				const chat = createChatState(sessionId, 'committed-chat', 'Committed', {
					turns: [{
						id: createAgentTurnId('committed-turn'),
						submission: request.payload.chats[0].initialSubmission!.submission,
						payloadDigest: request.payload.chats[0].initialSubmission!.payloadDigest,
						state: 'completed',
						user: { text: 'immutable prompt', attachments: [], interactionTargets: [] },
						behaviors: [{ kind: 'text', text: 'answer' }],
						interactions: [],
					}],
				});
				const session = withFullChats(createSessionState('committed-session', 'Committed', [chat]), [chat]);
				connection.sequence++;
				connection.replaceSessions([session]);
				return {
					kind: 'succeeded',
					result: {
						kind: 'createSession',
						operation: request.operation,
						digest: request.digest,
						hostSequence: createAgentHostSequence(connection.sequence),
						revisions: [],
						session: sessionId,
						chats: [{
							chat: chat.id,
							turn: chat.turns[0].id,
							submission: chat.turns[0].submission,
						}],
					},
				};
			};
			const changed = waitForSessionsChange(provider);
			await provider.sendRequest(draft, draftChat);
			const event = await changed;
			assert.deepStrictEqual(event.transitions.map(transition => transition.kind), [SessionTransitionKind.Replaced]);
			assert.equal(connection.resolveConfigurationRequests.length, 2);
			assert.equal(connection.mutationRequests.length, 1);
			assert.equal(provider.getSessions().length, 1);
			assert.equal(provider.getSessions()[0].chats.get().length, 1);
			assert.throws(() => chatService.acquireModel(draftChat.resource), /does not exist/);
		} finally {
			provider.dispose();
		}
	});

	test('retries an accepted submission with its exact captured content after live Feature state changes', async () => {
		const sessionId = createAgentSessionId('accepted-retry-session');
		const chatState = createChatState(sessionId, 'accepted-retry-chat', 'Accepted Retry');
		const initial = withFullChats(
			createSessionState('accepted-retry-session', 'Accepted Retry', [chatState]),
			[chatState],
		);
		const { connection, chatService } = createFixture([initial]);
		const provider = await createProvider(connection, chatService);
		const attachmentId = createAgentAttachmentId('live-feature-attachment');
		const producerType = createAgentAttachmentProducerTypeId('test.live-feature');
		const representationSchema = createAgentAttachmentRepresentationSchemaId('test.live-feature.v1');
		const acceptedSource = Object.freeze({
			reference: createAgentContentReferenceId('live-feature-content-v1'),
			version: createAgentContentVersion('live-feature-version-v1'),
			digest: createAgentContentDigest(`sha256:${'1'.repeat(64)}`),
			text: 'accepted feature content',
		});
		const replacementSource = Object.freeze({
			reference: createAgentContentReferenceId('live-feature-content-v2'),
			version: createAgentContentVersion('live-feature-version-v2'),
			digest: createAgentContentDigest(`sha256:${'2'.repeat(64)}`),
			text: 'replacement feature content',
		});
		let liveFeatureSource: typeof acceptedSource | typeof replacementSource = acceptedSource;
		let resolveCount = 0;
		let releaseCount = 0;
		let discardCount = 0;
		const producerRegistration = chatService.registerAttachmentProducer({
			type: producerType,
			stateVersion: 1,
			validateState: state => assert.deepStrictEqual(state, { feature: 'live-source' }),
			discard: () => { discardCount += 1; },
			resolve: async ({ attachment }) => {
				resolveCount += 1;
				const source = liveFeatureSource;
				const normalized: IAgentHostAttachment = Object.freeze({
					envelopeVersion: 1,
					id: attachment.id,
					producerType: attachment.producerType,
					display: attachment.display,
					representation: Object.freeze({
						schema: representationSchema,
						mediaType: 'text/plain',
						value: Object.freeze({ text: source.text }),
					}),
					content: Object.freeze({
						kind: 'reference',
						reference: source.reference,
						owner: Object.freeze({ kind: 'client', connection: connection.connection }),
						shape: 'blob',
						mediaType: 'text/plain',
						bounds: Object.freeze({ byteLength: 32, maximumReadLength: 32 }),
						version: source.version,
						digest: source.digest,
					}),
					metadata: Object.freeze([]),
				});
				return Object.freeze({
					attachment: normalized,
					release: async () => { releaseCount += 1; },
				});
			},
		});
		const submittedPayloadDigest = createAgentHostPayloadDigest(`sha256:${'3'.repeat(64)}`);
		const committedTurn = createAgentTurnId('accepted-retry-turn');
		let committedRequest: IAgentHostMutationRequest | undefined;
		let mutationAttempt = 0;
		try {
			const session = provider.getSessions()[0];
			const chat = session.chats.get()[0];
			chatService.setInput(chat.resource, 'use the accepted source');
			chatService.addPendingAttachments(chat.resource, [Object.freeze({
				id: attachmentId,
				producerType,
				producerStateVersion: 1,
				display: Object.freeze({ label: 'Live Feature' }),
				state: Object.freeze({ feature: 'live-source' }),
			})]);
			connection.prepare = async request => ({
				kind: 'prepared',
				submission: {
					submission: request.submission,
					payloadDigest: submittedPayloadDigest,
					message: request.capture.message,
					attachments: request.capture.attachments,
					interactionTargets: request.capture.interactionTargets,
					sessionConfiguration: sessionConfigurationState,
					modelConfiguration: request.executionSelection.configuration,
					credentials: [],
					executionProfile: {
						revision: createAgentExecutionProfileRevision('accepted-retry-profile'),
						digest: createAgentExecutionProfileDigest(`sha256:${'4'.repeat(64)}`),
						agentDescriptor: createAgentDescriptorRevision('agent-revision-1'),
						modelDescriptor: createAgentModelDescriptorRevision('model-revision-1'),
						data: '{}',
					},
					runtimeRegistration: registrationRevision,
					toolSet: {
						revision: createAgentToolSetRevision('accepted-retry-tools'),
						schemaProfile: createAgentToolSchemaProfileId('comet.tools'),
						runtimeRegistration: registrationRevision,
						agentDescriptor: createAgentDescriptorRevision('agent-revision-1'),
						modelDescriptor: createAgentModelDescriptorRevision('model-revision-1'),
						registrations: [],
					},
					requestedDeadline: 100,
					outputConstraints: {},
				},
			});
			connection.mutateRequest = async request => {
				mutationAttempt += 1;
				assert.equal(request.payload.kind, 'submitTurn');
				if (request.payload.kind !== 'submitTurn') {
					throw new Error('Expected submitTurn.');
				}
				const result = Object.freeze({
					kind: 'submitTurn' as const,
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(connection.sequence),
					revisions: Object.freeze([]),
					session: sessionId,
					chat: chatState.id,
					turn: committedTurn,
					submission: request.payload.submission.submission,
				});
				if (mutationAttempt === 1) {
					committedRequest = request;
					const acceptedChat = createChatState(sessionId, 'accepted-retry-chat', 'Accepted Retry', {
						status: 'running',
						activeTurn: committedTurn,
						modifiedAt: 12,
						turns: [Object.freeze({
							id: committedTurn,
							submission: request.payload.submission.submission,
							payloadDigest: request.payload.submission.payloadDigest,
								state: 'running',
							user: Object.freeze({
								text: request.payload.submission.message,
								attachments: request.payload.submission.attachments,
								interactionTargets: request.payload.submission.interactionTargets,
							}),
							behaviors: Object.freeze([]),
							interactions: Object.freeze([]),
						})],
					});
					connection.sequence += 1;
					connection.replaceSessions([withFullChats(
						createSessionState('accepted-retry-session', 'Accepted Retry', [acceptedChat], {
							status: 'running',
							modifiedAt: 3,
						}),
						[acceptedChat],
					)]);
					connection.setRevision(getAgentHostSessionsChannelId(), 2);
					connection.setRevision(getAgentHostSessionChannelId(sessionId), 2);
					connection.setRevision(getAgentHostChatChannelId(sessionId, chatState.id), 2);
					liveFeatureSource = replacementSource;
					return Object.freeze({ kind: 'unknown' });
				}
				assert.strictEqual(request, committedRequest);
				return Object.freeze({ kind: 'succeeded', result });
			};

			await provider.sendRequest(session, chat);

			assert.equal(mutationAttempt, 2);
			assert.equal(connection.prepareRequests.length, 1);
			assert.equal(resolveCount, 1);
			assert.equal(releaseCount, 1);
			assert.equal(discardCount, 1);
			assert.equal(connection.mutationRequests.length, 2);
			assert.strictEqual(connection.mutationRequests[0], connection.mutationRequests[1]);
			assert.ok(committedRequest);
			assert.equal(
				committedRequest.digest,
				await computeAgentHostMutationDigest(committedRequest.payload),
			);
			if (committedRequest.payload.kind !== 'submitTurn') {
				throw new Error('Expected committed submitTurn.');
			}
			const acceptedAttachment = committedRequest.payload.submission.attachments[0];
			assert.equal(acceptedAttachment.id, attachmentId);
			assert.equal(committedRequest.payload.submission.payloadDigest, submittedPayloadDigest);
			assert.equal(acceptedAttachment.content?.kind, 'reference');
			if (acceptedAttachment.content?.kind !== 'reference') {
				throw new Error('Expected accepted reference content.');
			}
			assert.deepStrictEqual({
				reference: acceptedAttachment.content.reference,
				version: acceptedAttachment.content.version,
				digest: acceptedAttachment.content.digest,
			}, {
				reference: acceptedSource.reference,
				version: acceptedSource.version,
				digest: acceptedSource.digest,
			});
			assert.notEqual(acceptedAttachment.content.reference, replacementSource.reference);
			assert.notEqual(acceptedAttachment.content.version, replacementSource.version);
			assert.notEqual(acceptedAttachment.content.digest, replacementSource.digest);
			const committedSnapshot = connection.snapshot(
				getAgentHostChatChannelId(sessionId, chatState.id),
			);
			assert.equal(committedSnapshot?.kind, 'chat');
			if (committedSnapshot?.kind !== 'chat') {
				throw new Error('Expected committed Chat snapshot.');
			}
			const historicalTurn = committedSnapshot.state.turns[0];
			assert.equal(historicalTurn.submission, committedRequest.payload.submission.submission);
			assert.equal(historicalTurn.payloadDigest, submittedPayloadDigest);
			assert.deepStrictEqual(historicalTurn.user.attachments, [acceptedAttachment]);
		} finally {
			provider.dispose();
			producerRegistration.dispose();
		}
	});

	test('resends an explicitly unknown mutation with the same operation identity and digest', async () => {
		const sessionId = createAgentSessionId('retry-session');
		const chat = createChatState(sessionId, 'retry-chat', 'Retry Chat');
		const initial = withFullChats(createSessionState('retry-session', 'Before', [chat]), [chat]);
		const { connection, chatService } = createFixture([initial]);
		let attempt = 0;
		connection.mutateRequest = async request => {
			attempt++;
			if (attempt === 1) {
				return { kind: 'unknown' };
			}
			const renamed = withFullChats({ ...initial, title: 'After', modifiedAt: 5 }, [chat]);
			connection.sequence++;
			connection.replaceSessions([renamed]);
			return {
				kind: 'succeeded',
				result: {
					kind: 'renameSession',
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(connection.sequence),
					revisions: [],
					session: sessionId,
				},
			};
		};
		const provider = await createProvider(connection, chatService);
		const chatResource = provider.getSessions()[0].chats.get()[0].resource;
		try {
			await provider.renameSession(provider.getSessions()[0], 'After');
			assert.equal(connection.mutationRequests.length, 2);
			assert.equal(connection.mutationRequests[0].operation, connection.mutationRequests[1].operation);
			assert.equal(connection.mutationRequests[0].digest, connection.mutationRequests[1].digest);
			assert.equal(provider.getSessions()[0].title.get(), 'After');
		} finally {
			provider.dispose();
		}
		assert.throws(() => chatService.acquireModel(chatResource), /does not exist/);
	});

	test('reconciles a committed mutation after transport loss with its original operation and digest before refresh', async () => {
		const sessionId = createAgentSessionId('committed-before-disconnect');
		const chat = createChatState(sessionId, 'committed-before-disconnect-chat', 'Commit Chat');
		const initial = withFullChats(createSessionState(
			'committed-before-disconnect',
			'Before disconnect',
			[chat],
		), [chat]);
		const { connection, chatService } = createFixture([initial]);
		let committed: IAgentHostMutationRequest | undefined;
		connection.mutateRequest = async request => {
			committed = request;
			const renamed = withFullChats({ ...initial, title: 'Committed remotely', modifiedAt: 5 }, [chat]);
			connection.sequence = 2;
			connection.replaceSessions([renamed]);
			connection.setRevision(getAgentHostSessionsChannelId(), 2);
			connection.setRevision(getAgentHostSessionChannelId(sessionId), 2);
			throw new Error('Transport was lost after the Host committed the mutation.');
		};
		let outcomeAttempt = 0;
		let subscriptionCountBeforeRecovery = 0;
		connection.operationOutcome = async request => {
			outcomeAttempt += 1;
			if (outcomeAttempt === 1) {
				throw new Error('Transport is unavailable.');
			}
			assert.equal(connection.reconnectRequests.length, 1);
			assert.equal(connection.setSubscriptionsRequests.length, subscriptionCountBeforeRecovery);
			assert.ok(committed);
			return {
				kind: 'succeeded',
				result: {
					kind: 'renameSession',
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(2),
					revisions: [],
					session: sessionId,
				},
			};
		};
		const provider = await createProvider(connection, chatService);
		try {
			const session = provider.getSessions()[0];
			await assert.rejects(
				provider.renameSession(session, 'Committed remotely'),
				/not reached a reconciled terminal outcome/,
			);
			assert.ok(committed);
			assert.equal(connection.mutationRequests.length, 1);
			assert.deepStrictEqual(connection.operationOutcomeRequests[0], {
				operation: committed.operation,
				digest: committed.digest,
			});

			const recoverySubscriptions = [...connection.activeSubscriptions];
			connection.reconnectResult = {
				kind: 'snapshots',
				hostSequence: createAgentHostSequence(2),
				snapshots: recoverySubscriptions.map(channel => connection.snapshot(channel)!),
				missingChannels: [],
			};
			subscriptionCountBeforeRecovery = connection.setSubscriptionsRequests.length;
			provider.beginConnectionRecovery(1);
			await assert.rejects(
				provider.renameSession(session, 'Must wait'),
				/connection is recovering/,
			);
			assert.equal(connection.mutationRequests.length, 1);

			assert.equal(await provider.recoverConnection(2), true);
			await provider.completeConnectionRecovery(2);
			assert.equal(connection.mutationRequests.length, 1);
			assert.equal(connection.operationOutcomeRequests.length, 2);
			assert.equal(connection.operationOutcomeRequests[1].operation, committed.operation);
			assert.equal(connection.operationOutcomeRequests[1].digest, committed.digest);
			assert.ok(connection.setSubscriptionsRequests.length > subscriptionCountBeforeRecovery);
			assert.equal(provider.getSessions()[0].title.get(), 'Committed remotely');
		} finally {
			provider.dispose();
		}
	});

	test('routes release, cancellation, and steering to exact Host identities', async () => {
		const sessionId = createAgentSessionId('operation-session');
		const turnId = createAgentTurnId('operation-turn');
		const chat = createChatState(sessionId, 'operation-chat', 'Operations', {
			status: 'running',
			activeTurn: turnId,
			turns: [{
				id: turnId,
				submission: createAgentSubmissionId('operation-submission'),
				payloadDigest,
				state: 'running',
				user: { text: 'prompt', attachments: [], interactionTargets: [] },
				behaviors: [],
				interactions: [],
			}],
		});
		const initial = withFullChats(createSessionState('operation-session', 'Operations', [chat]), [chat]);
		const { connection, chatService } = createFixture([initial]);
		connection.root = {
			...connection.root,
			agents: connection.root.agents.map(agent => ({
				...agent,
				capabilities: { ...agent.capabilities, supportsSteering: true },
			})),
		};
		connection.mutateRequest = async request => {
			connection.sequence++;
			const commit = {
				operation: request.operation,
				digest: request.digest,
				hostSequence: createAgentHostSequence(connection.sequence),
				revisions: [],
			};
			switch (request.payload.kind) {
				case 'releaseSession':
					return { kind: 'succeeded', result: { ...commit, kind: 'releaseSession', session: request.payload.session } };
				case 'releaseChat':
					return { kind: 'succeeded', result: { ...commit, kind: 'releaseChat', session: request.payload.session, chat: request.payload.chat } };
				case 'cancelTurn':
					return { kind: 'succeeded', result: { ...commit, kind: 'cancelTurn', session: request.payload.session, chat: request.payload.chat, turn: request.payload.turn } };
				case 'steerTurn':
					return { kind: 'succeeded', result: { ...commit, kind: 'steerTurn', session: request.payload.session, chat: request.payload.chat, turn: request.payload.turn } };
				default:
					throw new Error(`Unexpected mutation '${request.payload.kind}'.`);
			}
		};
		const provider = await createProvider(connection, chatService);
		try {
			const session = provider.getSessions()[0];
			const addressedChat = session.chats.get()[0];
			await provider.cancelTurn(session, addressedChat, turnId);
			await provider.steerTurn(session, addressedChat, turnId, ' focus on exact tests ');
			await provider.releaseChat(session, addressedChat);
			await provider.releaseSession(session);

			assert.deepStrictEqual(connection.mutationRequests.map(request => request.payload), [
				{ kind: 'cancelTurn', session: sessionId, chat: chat.id, turn: turnId },
				{ kind: 'steerTurn', session: sessionId, chat: chat.id, turn: turnId, message: 'focus on exact tests' },
				{ kind: 'releaseChat', session: sessionId, chat: chat.id },
				{ kind: 'releaseSession', session: sessionId },
			]);
		} finally {
			provider.dispose();
		}
	});

	test('supersedes an overlapping generation recovery and releases live actions before later mutations', async () => {
		const sessionId = createAgentSessionId('overlapping-recovery-session');
		const initial = withFullChats(createSessionState('overlapping-recovery-session', 'Initial', []), []);
		const host = new TestAgentHostConnection([initial]);
		const transport = new TestRemoteAgentHostTransport(host);
		const chatService = new ChatService(createTestChatStorageService());
		const providers = new SessionsProvidersService();
		const contribution = createRemoteContribution(transport, chatService, providers);
		try {
			await contribution.start();
			const provider = providers.getProviders()[0];
			assert.ok(provider instanceof AgentHostSessionsProvider);
			const generation2Started = new DeferredPromise<void>();
			const generation2Result = new DeferredPromise<AgentHostReconnectResult>();
			const generation3Started = new DeferredPromise<void>();
			const generation3Result = new DeferredPromise<AgentHostReconnectResult>();
			let reconnectAttempt = 0;
			host.reconnectRequest = async () => {
				reconnectAttempt += 1;
				if (reconnectAttempt === 1) {
					generation2Started.complete();
					return generation2Result.p;
				}
				generation3Started.complete();
				return generation3Result.p;
			};

			transport.interrupt();
			transport.restore();
			await generation2Started.p;
			await assert.rejects(
				provider.renameSession(provider.getSessions()[0], 'Must not mutate during recovery'),
				/connection is recovering/,
			);
			assert.equal(host.mutationRequests.length, 0);

			transport.interrupt();
			const snapshotRoot = {
				...host.root,
				label: { kind: 'literal' as const, value: 'Generation 3 snapshot' },
			};
			const snapshotSession = withFullChats({ ...initial, title: 'Generation 3 snapshot', modifiedAt: 3 }, []);
			host.root = snapshotRoot;
			host.sequence = 2;
			host.replaceSessions([snapshotSession]);
			host.setRevision(getAgentHostRootChannelId(), 2);
			host.setRevision(getAgentHostSessionsChannelId(), 2);
			host.setRevision(getAgentHostSessionChannelId(sessionId), 2);
			const recoverySubscriptions = [...host.activeSubscriptions];
			const exactGeneration3Result: AgentHostReconnectResult = {
				kind: 'snapshots',
				hostSequence: createAgentHostSequence(2),
				snapshots: recoverySubscriptions.map(channel => host.snapshot(channel)!),
				missingChannels: [],
			};
			transport.restore();
			const liveRoot = {
				...snapshotRoot,
				label: { kind: 'literal' as const, value: 'Generation 3 live action' },
				sessionTypes: snapshotRoot.sessionTypes.map(descriptor => ({
					...descriptor,
					displayName: { kind: 'literal' as const, value: 'Live Session type' },
				})),
			};
			const ordering: string[] = [];
			const liveApplied = new DeferredPromise<void>();
			provider.onDidChangeSessionTypes(() => {
				if (provider.label === 'Generation 3 live action') {
					ordering.push('liveAction');
					liveApplied.complete();
				}
			});
			transport.emitAction({
				channel: getAgentHostRootChannelId(),
				kind: 'root',
				hostSequence: createAgentHostSequence(3),
				revision: createAgentHostChannelRevision(3),
				digest: createAgentHostActionDigest(`sha256:${'8'.repeat(64)}`),
				cause: { kind: 'host' },
				action: { kind: 'rootStateChanged', state: liveRoot },
			});
			assert.equal(provider.label, 'Local Agent Host');

			generation2Result.complete({
				kind: 'replay',
				fromHostSequence: createAgentHostSequence(1),
				throughHostSequence: createAgentHostSequence(1),
				actions: [],
				missingChannels: [],
			});
			await generation3Started.p;
			assert.equal(providers.getProviders().length, 1);
			assert.equal(provider.label, 'Local Agent Host');
			generation3Result.complete(exactGeneration3Result);
			await liveApplied.p;
			await new Promise<void>(resolve => setImmediate(resolve));

			host.mutateRequest = async request => {
				ordering.push('mutation');
				assert.equal(provider.label, 'Generation 3 live action');
				const renamed = withFullChats({ ...snapshotSession, title: 'After recovery', modifiedAt: 4 }, []);
				host.root = liveRoot;
				host.sequence = 4;
				host.replaceSessions([renamed]);
				host.setRevision(getAgentHostRootChannelId(), 3);
				host.setRevision(getAgentHostSessionsChannelId(), 3);
				host.setRevision(getAgentHostSessionChannelId(sessionId), 3);
				return {
					kind: 'succeeded',
					result: {
						kind: 'renameSession',
						operation: request.operation,
						digest: request.digest,
						hostSequence: createAgentHostSequence(4),
						revisions: [],
						session: sessionId,
					},
				};
			};
			await provider.renameSession(provider.getSessions()[0], 'After recovery');
			assert.deepStrictEqual(ordering, ['liveAction', 'mutation']);
			assert.equal(host.reconnectRequests.length, 2);
			assert.equal(host.mutationRequests.length, 1);
			assert.equal(provider.getSessions()[0].title.get(), 'After recovery');
		} finally {
			contribution.dispose();
			providers.dispose();
			host.dispose();
		}
	});

	test('rejects an unbounded remote action buffer configuration and disposes its transport', async () => {
		const host = new TestAgentHostConnection();
		const transport = new TestRemoteAgentHostTransport(host);
		try {
			await assert.rejects(RemoteAgentHostConnection.create(transport, {
				maximumClientToolCallRecords: 4,
				maximumBufferedActions: 0,
				contentResourceLimits: remoteContentResourceLimits,
			}), /maximum buffered actions must be between 1 and 65536/);
			await assert.rejects(RemoteAgentHostConnection.create(transport, {
				maximumClientToolCallRecords: 8,
				maximumBufferedActions: 65_537,
				contentResourceLimits: remoteContentResourceLimits,
			}), /maximum buffered actions must be between 1 and 65536/);
			assert.equal(transport.disposed, true);
		} finally {
			transport.dispose();
			host.dispose();
		}
	});

	test('terminates and disposes a restoring remote transport when its ordered action buffer is full', async () => {
		const session = withFullChats(createSessionState('bounded-buffer-session', 'Buffered', []), []);
		const host = new TestAgentHostConnection([session]);
		const transport = new TestRemoteAgentHostTransport(host);
		const connection = await RemoteAgentHostConnection.create(transport, {
			maximumClientToolCallRecords: 4,
			maximumBufferedActions: 1,
			contentResourceLimits: remoteContentResourceLimits,
		});
		try {
			let deliveredActions = 0;
			connection.onDidReceiveAction(() => deliveredActions += 1);
			const buffered = host.emitSessionState({ ...session, title: 'Buffered once' }, 2, '7');

			transport.interrupt();
			transport.emitAction(buffered);
			assert.equal(connection.state, 'restoring');
			assert.equal(transport.disposed, false);

			transport.emitAction(buffered);
			assert.equal(connection.state, 'terminal');
			assert.equal(transport.disposed, true);
			assert.equal(deliveredActions, 0);
		} finally {
			connection.dispose();
			host.dispose();
		}
	});

	test('removes and disposes the remote provider when its transport becomes terminal', async () => {
		const host = new TestAgentHostConnection();
		const transport = new TestRemoteAgentHostTransport(host);
		const chatService = new ChatService(createTestChatStorageService());
		const providers = new SessionsProvidersService();
		const contribution = createRemoteContribution(transport, chatService, providers);
		try {
			await contribution.start();
			assert.equal(providers.getProviders().length, 1);
			const provider = providers.getProviders()[0];

			transport.terminate();
			assert.equal(providers.getProviders().length, 0);
			assert.throws(() => provider.getSessions(), /is disposed/);
		} finally {
			contribution.dispose();
			providers.dispose();
			host.dispose();
		}
	});
});
