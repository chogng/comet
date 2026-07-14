/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from 'cs/base/common/async';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { AgentChatOrigin, IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import { AgentHostChannelStateReducer } from 'cs/platform/agentHost/common/channelState';
import {
	type IAgentConfigurationCandidate,
	type IAgentConfigurationState,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	createAgentCapabilityRevision,
	createAgentChatId,
	createAgentConfigurationSchemaRevision,
	createAgentDescriptorRevision,
	createAgentHostOperationId,
	createAgentHostProtocolVersion,
	createAgentId,
	createAgentModelId,
	createAgentPackageId,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSchemaProfileId,
	createAgentTurnId,
	type AgentChatId,
	type AgentHostChannelId,
	type AgentHostOperationId,
	type AgentHostPayloadDigest,
	type AgentHostSequence,
	type AgentId,
	type AgentModelId,
	type AgentSessionId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostReconnectResult,
	assertAgentHostSetSubscriptionsResult,
	assertAgentHostChatState,
	computeAgentHostMutationDigest,
	computeAgentHostSubmissionCaptureDigest,
	getAgentHostChatChannelId,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
	reduceAgentHostChatState,
	reduceAgentHostRootState,
	reduceAgentHostSessionCatalogState,
	reduceAgentHostSessionState,
	type AgentHostChannelAction,
	type AgentHostChannelSnapshot,
	type AgentHostMutationOutcome,
	type AgentHostMutationPayload,
	type AgentHostMutationResult,
	type AgentHostReconnectResult,
	type IAgentHostChatState,
	type IAgentHostChatStateAction,
	type IAgentHostImplementationIdentity,
	type IAgentHostRootState,
	type IAgentHostSetSubscriptionsResult,
	type IAgentHostSessionCatalogState,
	type IAgentHostSessionState,
	type IAgentHostSessionStateAction,
	type IAgentHostSessionSummary,
	type IAgentHostSessionTypeDescriptor,
} from 'cs/platform/agentHost/common/protocol';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	AgentHostChat,
	AgentHostSession,
	type IAgentHostChatModelState,
	type IAgentHostSessionModelState,
} from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionModels';
import {
	type AgentHostDisplayTextResolver,
	toAgentWorkspace,
	toChatModelState,
	toChatOrigin,
	toExecutionSelection,
	toModels,
	toSessionModelState,
	toSessionType,
} from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionProjection';
import {
	createAgentHostChatResource,
	createAgentHostSessionResource,
	createAgentHostSessionsProviderId,
} from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionResources';
import {
	ChatInteractivity,
	ChatOriginKind,
	SessionStatus,
	type IChat,
	type ISession,
	type ISessionType,
} from 'cs/sessions/services/sessions/common/session';
import {
	SessionTransitionKind,
	type ISessionDraftOptions,
	type ISessionModel,
	type ISessionsChangeEvent,
	type ISessionsProvider,
} from 'cs/sessions/services/sessions/common/sessionsProvider';
import type {
	IChatModelOwnerReference,
	IChatService,
	IPreparedChatSubmission,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';

type RootSnapshot = Extract<AgentHostChannelSnapshot, { readonly kind: 'root' }>;

interface IAgentHostChatRecord {
	readonly chat: AgentHostChat;
	readonly owner: IChatModelOwnerReference;
	state: IAgentHostChatState;
}

interface IAgentHostSessionRecord {
	readonly session: AgentHostSession;
	readonly chats: Map<AgentChatId, IAgentHostChatRecord>;
	state: IAgentHostSessionState;
}

interface IAgentHostDraftRecord {
	readonly session: AgentHostSession;
	readonly chat: AgentHostChat;
	readonly owner: IChatModelOwnerReference;
	readonly descriptor: IAgentHostSessionTypeDescriptor;
	readonly workspace: ISessionDraftOptions['workspace'];
	readonly configuration: IAgentConfigurationCandidate;
	model: AgentModelId | null;
}

export interface IAgentHostSessionsProviderOptions {
	readonly locale: string;
	readonly implementation: IAgentHostImplementationIdentity;
	readonly resolveDisplayText: AgentHostDisplayTextResolver;
}

class AgentHostOperationFailure extends Error {
	constructor(readonly operation: AgentHostOperationId, message: string) {
		super(message);
		this.name = 'AgentHostOperationFailure';
	}
}

class AgentHostOperationUncertainError extends Error {
	constructor(readonly operation: AgentHostOperationId, readonly digest: AgentHostPayloadDigest) {
		super(`Agent Host operation '${operation}' has not reached a reconciled terminal outcome.`);
		this.name = 'AgentHostOperationUncertainError';
	}
}

function chatKey(session: AgentSessionId, chat: AgentChatId): string {
	return `${session}\0${chat}`;
}

function sameOrigin(left: AgentChatOrigin, right: AgentChatOrigin): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	if (left.kind === 'user' && right.kind === 'user') {
		return true;
	}
	if (left.kind === 'fork' && right.kind === 'fork') {
		return left.parentChat === right.parentChat && left.parentTurn === right.parentTurn;
	}
	if (left.kind === 'tool' && right.kind === 'tool') {
		return left.parentChat === right.parentChat
			&& left.parentTurn === right.parentTurn
			&& left.toolCall === right.toolCall;
	}
	return false;
}

function sameChatOrigin(left: IChat['origin'], right: IChat['origin']): boolean {
	return left.kind === right.kind
		&& (left.kind === ChatOriginKind.User
			|| (right.kind !== ChatOriginKind.User && left.parentChat.toString() === right.parentChat.toString()));
}

function requireTitle(title: string): string {
	const value = title.trim();
	if (value.length === 0 || value.length > 1_024) {
		throw new Error('An Agent Host title must contain between 1 and 1,024 characters.');
	}
	return value;
}

function typeSignature(root: IAgentHostRootState): string {
	return JSON.stringify({
		create: root.capabilities.supportsCreateSession,
		types: root.sessionTypes,
		registrations: root.agentRegistrations.map(registration => ({
			agentId: registration.agentId,
			packageId: registration.packageId,
			revision: registration.revision,
			initialSessionConfigurationSchema: registration.initialSessionConfigurationSchema,
			supportedSessionConfigurationSchemas: registration.supportedSessionConfigurationSchemas,
		})),
	});
}

function sameConfigurationState(left: IAgentConfigurationState, right: IAgentConfigurationState): boolean {
	return encodeAgentHostProtocolValue(left) === encodeAgentHostProtocolValue(right);
}

const runtimeRegistrationFields = Object.freeze([
	'packageId',
	'agentId',
	'revision',
	'descriptorRevision',
	'capabilityRevision',
	'hostDefaultsSchema',
	'initialSessionConfigurationSchema',
	'supportedSessionConfigurationSchemas',
	'supportedToolSchemaProfiles',
	'supportedResumeSchemas',
	'resumeMigrationEdges',
]);

function assertExactObjectFields(value: unknown, fields: readonly string[], name: string): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Agent Host exposes invalid ${name}.`);
	}
	const keys = Object.keys(value);
	if (
		keys.length !== fields.length
		|| fields.some(field => !Object.hasOwn(value, field))
		|| keys.some(key => !fields.includes(key))
	) {
		throw new Error(`Agent Host exposes invalid ${name}.`);
	}
}

function validateUniqueRegistrationIdentities(
	value: unknown,
	name: string,
	validate: (identity: string) => void,
): readonly string[] {
	if (!Array.isArray(value)) {
		throw new Error(`Agent Host exposes invalid ${name}.`);
	}
	const identities = new Set<string>();
	for (const identity of value) {
		if (typeof identity !== 'string') {
			throw new Error(`Agent Host exposes invalid ${name}.`);
		}
		validate(identity);
		if (identities.has(identity)) {
			throw new Error(`Agent Host exposes duplicate ${name} '${identity}'.`);
		}
		identities.add(identity);
	}
	return value;
}

function validateRuntimeRegistration(registration: IAgentRuntimeRegistration) {
	assertExactObjectFields(registration, runtimeRegistrationFields, 'runtime registration fields');
	createAgentPackageId(registration.packageId);
	createAgentId(registration.agentId);
	createAgentRuntimeRegistrationRevision(registration.revision);
	createAgentDescriptorRevision(registration.descriptorRevision);
	createAgentCapabilityRevision(registration.capabilityRevision);
	const hostDefaultsSchema = validateAndFreezeAgentConfigurationSchema(registration.hostDefaultsSchema, {
		agent: registration.agentId,
		scope: 'hostDefault',
	});
	createAgentConfigurationSchemaRevision(registration.initialSessionConfigurationSchema);
	const supportedSessionConfigurationSchemas = validateUniqueRegistrationIdentities(
		registration.supportedSessionConfigurationSchemas,
		'Session configuration schema',
		createAgentConfigurationSchemaRevision,
	);
	if (!supportedSessionConfigurationSchemas.includes(registration.initialSessionConfigurationSchema)) {
		throw new Error(`Agent Host registration '${registration.revision}' has an unsupported initial Session schema.`);
	}
	validateUniqueRegistrationIdentities(
		registration.supportedToolSchemaProfiles,
		'Tool schema profile',
		createAgentToolSchemaProfileId,
	);
	const supportedResumeSchemas = validateUniqueRegistrationIdentities(
		registration.supportedResumeSchemas,
		'resume schema',
		createAgentResumeSchemaId,
	);
	if (!Array.isArray(registration.resumeMigrationEdges)) {
		throw new Error('Agent Host exposes invalid resume migration edges.');
	}
	const migrationEdges = new Set<string>();
	for (const edge of registration.resumeMigrationEdges) {
		assertExactObjectFields(edge, ['sourceSchema', 'targetSchema'], 'resume migration edge');
		createAgentResumeSchemaId(edge.sourceSchema);
		createAgentResumeSchemaId(edge.targetSchema);
		const key = `${edge.sourceSchema}\0${edge.targetSchema}`;
		if (
			edge.sourceSchema === edge.targetSchema
			|| migrationEdges.has(key)
			|| !supportedResumeSchemas.includes(edge.targetSchema)
		) {
			throw new Error(`Agent Host exposes invalid resume migration edge '${key}'.`);
		}
		migrationEdges.add(key);
	}
	return hostDefaultsSchema;
}

function modelSignature(root: IAgentHostRootState): string {
	return JSON.stringify(root.agents.map(agent => ({
		id: agent.id,
		revision: agent.revision,
		models: agent.models,
	})));
}

/** Maps one exact Agent Host connection into the provider-independent Sessions domain. */
export class AgentHostSessionsProvider extends Disposable implements ISessionsProvider {
	readonly id;

	private readonly sessionTypesChangeEmitter = this._register(new Emitter<void>({ onListenerError: onUnexpectedError }));
	readonly onDidChangeSessionTypes: Event<void> = this.sessionTypesChangeEmitter.event;
	private readonly sessionsChangeEmitter = this._register(new Emitter<ISessionsChangeEvent>({ onListenerError: onUnexpectedError }));
	readonly onDidChangeSessions: Event<ISessionsChangeEvent> = this.sessionsChangeEmitter.event;
	private readonly modelsChangeEmitter = this._register(new Emitter<void>({ onListenerError: onUnexpectedError }));
	readonly onDidChangeModels: Event<void> = this.modelsChangeEmitter.event;

	private readonly sequencer = new Sequencer();
	private readonly rootReducer = new AgentHostChannelStateReducer(
		getAgentHostRootChannelId(),
		'root',
		reduceAgentHostRootState,
	);
	private readonly sessionsReducer = new AgentHostChannelStateReducer(
		getAgentHostSessionsChannelId(),
		'sessions',
		reduceAgentHostSessionCatalogState,
	);
	private readonly sessionReducers = new Map<AgentSessionId, AgentHostChannelStateReducer<'session', IAgentHostSessionState, IAgentHostSessionStateAction>>();
	private readonly chatReducers = new Map<string, AgentHostChannelStateReducer<'chat', IAgentHostChatState, IAgentHostChatStateAction>>();
	private readonly subscriptions = new Set<AgentHostChannelId>();
	private readonly records = new Map<AgentSessionId, IAgentHostSessionRecord>();
	private sessions: readonly AgentHostSession[] = Object.freeze([]);
	private draft: IAgentHostDraftRecord | undefined;
	private lastHostSequence: AgentHostSequence | undefined;
	private disposed = false;

	private constructor(
		private readonly connection: IAgentHostConnection,
		private readonly chatService: IChatService,
		private readonly options: IAgentHostSessionsProviderOptions,
	) {
		super();
		this.id = createAgentHostSessionsProviderId(connection.authority);
		this._register(connection);
		this._register(connection.onDidReceiveAction(action => {
			void this.sequencer.queue(() => this.applyAction(action)).catch(onUnexpectedError);
		}));
	}

	static async create(
		connection: IAgentHostConnection,
		chatService: IChatService,
		options: IAgentHostSessionsProviderOptions,
	): Promise<AgentHostSessionsProvider> {
		const provider = new AgentHostSessionsProvider(connection, chatService, options);
		try {
			await provider.initialize();
			return provider;
		} catch (error) {
			provider.dispose();
			throw error;
		}
	}

	get label(): string {
		return this.options.resolveDisplayText(this.requireRootState().label);
	}

	get sessionTypes(): readonly ISessionType[] {
		const root = this.requireRootState();
		if (!root.capabilities.supportsCreateSession) {
			return Object.freeze([]);
		}
		return Object.freeze(root.sessionTypes.map(descriptor => toSessionType(descriptor, this.options.resolveDisplayText)));
	}

	refreshLocalizedPresentation(): void {
		this.assertNotDisposed();
		const root = this.requireRootState();
		this.assertDisplayProjection(root);
		const draft = this.draft;
		if (draft !== undefined) {
			const descriptor = root.sessionTypes.find(candidate => candidate.id === draft.descriptor.id);
			if (descriptor === undefined) {
				throw new Error(`Agent Host does not expose draft Session type '${draft.descriptor.id}'.`);
			}
			const title = this.options.resolveDisplayText(descriptor.displayName);
			draft.chat.setState(Object.freeze({
				title,
				updatedAt: draft.chat.updatedAt.get(),
				status: SessionStatus.Draft,
				isRead: draft.chat.isRead.get(),
				modelId: draft.chat.modelId.get(),
				interactivity: draft.chat.interactivity.get(),
				capabilities: draft.chat.capabilities.get(),
				activeTurn: undefined,
			}), undefined);
			draft.session.setState(Object.freeze({
				title,
				updatedAt: draft.session.updatedAt.get(),
				status: SessionStatus.Draft,
				isRead: draft.session.isRead.get(),
				isArchived: draft.session.isArchived.get(),
				workspace: draft.session.workspace.get(),
				changes: draft.session.changes.get(),
				chats: draft.session.chats.get(),
				capabilities: draft.session.capabilities.get(),
			}), undefined);
		}
		this.sessionTypesChangeEmitter.fire();
	}

	/** Applies one transport-confirmed reconnect before queued live actions resume. */
	recoverConnection(): Promise<void> {
		return this.sequencer.queue(async () => {
			this.assertNotDisposed();
			if (this.lastHostSequence === undefined) {
				throw new Error('Agent Host provider cannot reconnect before initialization.');
			}
			const request = Object.freeze({
				connection: this.connection.connection,
				lastHostSequence: this.lastHostSequence,
				subscriptions: Object.freeze([...this.subscriptions]),
			});
			const result = await this.connection.reconnect(request);
			try {
				assertAgentHostReconnectResult(request, result);
				await this.applyReconnectResult(result);
			} catch (error) {
				this.dispose();
				throw error;
			}
		});
	}

	getSessions(): readonly ISession[] {
		this.assertNotDisposed();
		return this.sessions;
	}

	getModels(session: ISession, chat: IChat): readonly ISessionModel[] {
		const ownership = this.requireOwnership(session, true);
		this.requireChat(ownership, chat);
		return toModels(
			this.requireRootState(),
			ownership.state.type,
			ownership.state.agentId,
		);
	}

	createSessionDraft(options: ISessionDraftOptions): ISession {
		this.assertNotDisposed();
		if (this.draft) {
			throw new Error(`Agent Host provider '${this.id}' already owns a Session draft.`);
		}
		const root = this.requireRootState();
		if (!root.capabilities.supportsCreateSession) {
			throw new Error(`Agent Host provider '${this.id}' does not support Session creation.`);
		}
		const descriptor = root.sessionTypes.find(type => type.id === options.sessionType);
		if (!descriptor) {
			throw new Error(`Agent Host provider '${this.id}' does not expose Session type '${options.sessionType}'.`);
		}
		this.assertWorkspaceAllowed(descriptor, options.workspace);
		const registration = this.requireRuntimeRegistration(descriptor.agentId, descriptor.packageId);
		const configuration: IAgentConfigurationCandidate = Object.freeze({
			schema: registration.initialSessionConfigurationSchema,
			values: Object.freeze({}),
		});

		const sessionId = createAgentSessionId(`draft-${generateUuid()}`);
		const chatId = createAgentChatId(`draft-${generateUuid()}`);
		const createdAt = new Date();
		const title = this.options.resolveDisplayText(descriptor.displayName);
		const chatResource = createAgentHostChatResource(this.connection.authority, sessionId, chatId);
		const chatState: IAgentHostChatModelState = Object.freeze({
			title,
			updatedAt: createdAt,
			status: SessionStatus.Draft,
			isRead: true,
			modelId: undefined,
			interactivity: ChatInteractivity.Full,
			capabilities: Object.freeze({ supportsRename: false, supportsDelete: false }),
			activeTurn: undefined,
		});
		const chat = new AgentHostChat(
			sessionId,
			chatId,
			chatResource,
			createdAt,
			Object.freeze({ kind: ChatOriginKind.User }),
			chatState,
		);
		const sessionResource = createAgentHostSessionResource(this.connection.authority, sessionId);
		const sessionState: IAgentHostSessionModelState = Object.freeze({
			title,
			updatedAt: createdAt,
			status: SessionStatus.Draft,
			isRead: true,
			isArchived: false,
			workspace: options.workspace,
			changes: Object.freeze([]),
			chats: Object.freeze([chat]),
			capabilities: Object.freeze({
				supportsCreateChat: false,
				maximumChatCount: 1,
				supportsFork: false,
				supportsRename: false,
				supportsArchive: false,
				supportsDelete: true,
				supportsChanges: false,
				supportsModels: descriptor.models.length > 0,
			}),
		});
		const session = new AgentHostSession(
			sessionId,
			sessionResource,
			this.id,
			descriptor.id,
			createdAt,
			sessionState,
		);
		let owner: IChatModelOwnerReference;
		try {
			owner = this.chatService.createModel(chatResource);
		} catch (error) {
			throw error;
		}
		this.draft = {
			session,
			chat,
			owner,
			descriptor,
			workspace: options.workspace,
			configuration,
			model: null,
		};
		return session;
	}

	discardSessionDraft(session: ISession): void {
		this.assertNotDisposed();
		const draft = this.draft;
		if (!draft || draft.session !== session) {
			throw new Error(`Session '${session.sessionId}' is not this provider's current draft.`);
		}
		this.draft = undefined;
		draft.owner.delete();
	}

	async sendRequest(session: ISession, chat: IChat): Promise<void> {
		this.assertNotDisposed();
		const ownership = this.requireOwnership(session, true);
		const ownedChat = this.requireChat(ownership, chat);
		if (ownedChat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error(`Chat '${ownedChat.resource.toString()}' is not interactive.`);
		}

		const submissionId = createAgentSubmissionId(generateUuid());
		const composerSubmission = await this.chatService.prepareSubmission(
			ownedChat.resource,
			submissionId,
			CancellationTokenNone,
		);
		await this.sequencer.queue(() => this.submitPrepared(ownership, ownedChat, composerSubmission));
	}

	async createChat(session: ISession): Promise<IChat> {
		return this.sequencer.queue(async () => {
			const record = this.requireCommittedRecord(session);
			this.assertSessionAvailable(record);
			if (!record.state.capabilities.supportsCreateChat) {
				throw new Error(`Session '${session.sessionId}' does not support Chat creation.`);
			}
			const maximum = record.state.capabilities.maximumChatCount;
			if (maximum !== undefined && record.chats.size >= maximum) {
				throw new Error(`Session '${session.sessionId}' has reached its Chat capacity.`);
			}
			const descriptor = this.requireDescriptor(record.state.type, record.state.agentId);
			this.assertModelAllowed(descriptor, record.state.agentId, null);
			const result = await this.mutate({
				kind: 'createChat',
				session: record.state.id,
				model: null,
				origin: Object.freeze({ kind: 'user' }),
			});
			this.assertMutationKind(result, 'createChat');
			await this.refreshAuthoritativeState();
			return this.requireCommittedChat(result.session, result.chat).chat;
		});
	}

	async forkChat(session: ISession, sourceChat: IChat, turnId: string): Promise<IChat> {
		return this.sequencer.queue(async () => {
			const record = this.requireCommittedRecord(session);
			const source = this.requireCommittedChatRecord(record, sourceChat);
			this.assertSessionAvailable(record);
			if (!record.state.capabilities.supportsFork || !source.state.capabilities.supportsFork) {
				throw new Error(`Chat '${sourceChat.resource.toString()}' does not support forks.`);
			}
			const exactTurn = createAgentTurnId(turnId);
			if (!source.state.turns.some(turn => turn.id === exactTurn)) {
				throw new Error(`Turn '${turnId}' does not belong to Chat '${sourceChat.resource.toString()}'.`);
			}
			const result = await this.mutate({
				kind: 'forkChat',
				session: record.state.id,
				sourceChat: source.state.id,
				sourceTurn: exactTurn,
			});
			this.assertMutationKind(result, 'forkChat');
			await this.refreshAuthoritativeState();
			return this.requireCommittedChat(result.session, result.chat).chat;
		});
	}

	async renameSession(session: ISession, title: string): Promise<void> {
		await this.mutateSession(session, record => {
			if (!record.state.capabilities.supportsRename) {
				throw new Error(`Session '${session.sessionId}' does not support rename.`);
			}
			return { kind: 'renameSession', session: record.state.id, title: requireTitle(title) };
		});
	}

	async renameChat(session: ISession, chat: IChat, title: string): Promise<void> {
		await this.mutateChat(session, chat, (record, chatRecord) => {
			if (!chatRecord.state.capabilities.supportsRename) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support rename.`);
			}
			return { kind: 'renameChat', session: record.state.id, chat: chatRecord.state.id, title: requireTitle(title) };
		});
	}

	async setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void> {
		await this.sequencer.queue(async () => {
			const ownership = this.requireOwnership(session, true);
			const ownedChat = this.requireChat(ownership, chat);
			const model = modelId === undefined ? null : createAgentModelId(modelId);
			const descriptor = this.requireDescriptor(ownership.state.type, ownership.state.agentId);
			this.assertModelAllowed(descriptor, ownership.state.agentId, model);
			if (ownership.kind === 'draft') {
				ownership.record.model = model;
				ownedChat.setState(Object.freeze({
					title: ownedChat.title.get(),
					updatedAt: new Date(),
					status: SessionStatus.Draft,
					isRead: ownedChat.isRead.get(),
					modelId: model ?? undefined,
					interactivity: ownedChat.interactivity.get(),
					capabilities: ownedChat.capabilities.get(),
					activeTurn: undefined,
				}), undefined);
				return;
			}
			const chatRecord = this.requireCommittedChatRecord(ownership.record, chat);
			if (!ownership.record.state.capabilities.supportsModels || !chatRecord.state.capabilities.supportsSetModel) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support model selection.`);
			}
			const result = await this.mutate({
				kind: 'setChatModel',
				session: ownership.record.state.id,
				chat: chatRecord.state.id,
				model,
			});
			this.assertMutationKind(result, 'setChatModel');
			await this.refreshAuthoritativeState();
		});
	}

	async setSessionArchived(session: ISession, archived: boolean): Promise<void> {
		await this.mutateSession(session, record => {
			if (!record.state.capabilities.supportsArchive) {
				throw new Error(`Session '${session.sessionId}' does not support archive changes.`);
			}
			return { kind: 'setSessionArchived', session: record.state.id, archived };
		});
	}

	async deleteSession(session: ISession): Promise<void> {
		await this.mutateSession(session, record => {
			if (!record.state.capabilities.supportsDelete) {
				throw new Error(`Session '${session.sessionId}' does not support deletion.`);
			}
			return { kind: 'deleteSession', session: record.state.id };
		});
	}

	async deleteChat(session: ISession, chat: IChat): Promise<void> {
		await this.mutateChat(session, chat, (record, chatRecord) => {
			if (!chatRecord.state.capabilities.supportsDelete) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support deletion.`);
			}
			return { kind: 'deleteChat', session: record.state.id, chat: chatRecord.state.id };
		});
	}

	async releaseSession(session: ISession): Promise<void> {
		await this.mutateSession(session, record => {
			const agent = this.requireRootState().agents.find(candidate => candidate.id === record.state.agentId);
			if (!agent?.capabilities.supportsReleaseSession) {
				throw new Error(`Session '${session.sessionId}' does not support release.`);
			}
			return { kind: 'releaseSession', session: record.state.id };
		});
	}

	async releaseChat(session: ISession, chat: IChat): Promise<void> {
		await this.mutateChat(session, chat, (record, chatRecord) => {
			if (!chatRecord.state.capabilities.supportsRelease) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support release.`);
			}
			return { kind: 'releaseChat', session: record.state.id, chat: chatRecord.state.id };
		});
	}

	async cancelTurn(session: ISession, chat: IChat, turnId: string): Promise<void> {
		await this.mutateChat(session, chat, (record, chatRecord) => {
			if (!chatRecord.state.capabilities.supportsCancel) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support cancellation.`);
			}
			const turn = createAgentTurnId(turnId);
			if (!chatRecord.state.turns.some(candidate => candidate.id === turn)) {
				throw new Error(`Turn '${turn}' does not belong to Chat '${chat.resource.toString()}'.`);
			}
			return { kind: 'cancelTurn', session: record.state.id, chat: chatRecord.state.id, turn };
		});
	}

	async steerTurn(session: ISession, chat: IChat, turnId: string, message: string): Promise<void> {
		await this.mutateChat(session, chat, (record, chatRecord) => {
			const agent = this.requireRootState().agents.find(candidate => candidate.id === record.state.agentId);
			if (!agent?.capabilities.supportsSteering) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support steering.`);
			}
			const turn = createAgentTurnId(turnId);
			if (chatRecord.state.activeTurn !== turn) {
				throw new Error(`Turn '${turn}' is not the active Turn of Chat '${chat.resource.toString()}'.`);
			}
			const exactMessage = message.trim();
			if (!exactMessage) {
				throw new Error('Turn steering requires a non-empty message.');
			}
			return {
				kind: 'steerTurn',
				session: record.state.id,
				chat: chatRecord.state.id,
				turn,
				message: exactMessage,
			};
		});
	}

	private async initialize(): Promise<void> {
		const rootChannel = getAgentHostRootChannelId();
		const sessionsChannel = getAgentHostSessionsChannelId();
		const result = await this.connection.initialize({
			connection: this.connection.connection,
			protocolVersions: Object.freeze([createAgentHostProtocolVersion('2')]),
			capabilities: Object.freeze([]),
			locale: this.options.locale,
			implementation: this.options.implementation,
			subscriptions: Object.freeze([rootChannel, sessionsChannel]),
		});
		if (result.protocolVersion !== '2') {
			throw new Error(`Agent Host selected unsupported protocol version '${result.protocolVersion}'.`);
		}
		this.assertNoMissingChannels(result.missingChannels);
		this.replaceActiveSubscriptions(result.snapshots);
		this.applyRootSnapshot(this.requireSnapshot(result.snapshots, rootChannel, 'root'), false);
		this.sessionsReducer.applySnapshot(this.requireSnapshot(result.snapshots, sessionsChannel, 'sessions'));
		this.noteHostSequence(result.hostSequence);
		await this.hydrateCatalog(false);
	}

	private async submitPrepared(
		ownership: ReturnType<AgentHostSessionsProvider['requireOwnership']>,
		chat: AgentHostChat,
		composerSubmission: IPreparedChatSubmission,
	): Promise<void> {
		let hostAccepted = false;
		try {
			const root = this.requireRootState();
			const descriptor = this.requireDescriptor(ownership.state.type, ownership.state.agentId);
			const model = chat.modelId.get() === undefined ? null : createAgentModelId(chat.modelId.get()!);
			this.assertModelAllowed(descriptor, ownership.state.agentId, model);
			const capture = Object.freeze({
				message: composerSubmission.capture.prompt,
				attachments: composerSubmission.attachments,
				interactionTargets: composerSubmission.interactionTargets,
			});
			const captureDigest = await computeAgentHostSubmissionCaptureDigest(capture);
			const targetWorkspace = ownership.kind === 'draft'
				? toAgentWorkspace(ownership.record.workspace)
				: undefined;
			let expectedSessionConfiguration: IAgentConfigurationState;
			if (ownership.kind === 'draft') {
				const registration = this.requireRuntimeRegistration(descriptor.agentId, descriptor.packageId);
				const resolved = await this.connection.resolveSessionConfiguration(Object.freeze({
					sessionType: descriptor.id,
					...(targetWorkspace === undefined ? {} : { workspace: targetWorkspace }),
					candidate: ownership.record.configuration,
				}));
				if (resolved.agent !== descriptor.agentId) {
					throw new Error(`Agent Host resolved draft configuration for another Agent '${resolved.agent}'.`);
				}
				if (resolved.runtimeRegistration !== registration.revision) {
					throw new Error('Agent Host resolved draft configuration with another runtime registration.');
				}
				expectedSessionConfiguration = validateAndFreezeAgentConfigurationState(resolved.configuration, {
					agent: descriptor.agentId,
					scope: 'session',
				});
				if (!registration.supportedSessionConfigurationSchemas.includes(
					expectedSessionConfiguration.schema.revision,
				)) {
					throw new Error('Agent Host resolved draft configuration to an unsupported Session schema.');
				}
			} else {
				expectedSessionConfiguration = validateAndFreezeAgentConfigurationState(
					ownership.record.state.configuration,
					{ agent: ownership.state.agentId, scope: 'session' },
				);
			}
			const target = ownership.kind === 'draft'
				? Object.freeze({
					kind: 'draft' as const,
					sessionType: ownership.record.descriptor.id,
					...(targetWorkspace ? { workspace: targetWorkspace } : {}),
					configuration: ownership.record.configuration,
				})
				: Object.freeze({
					kind: 'chat' as const,
					session: ownership.record.state.id,
					chat: this.requireCommittedChatRecord(ownership.record, chat).state.id,
				});
			const preparation = await this.connection.prepareSubmission({
				submission: composerSubmission.capture.submissionId,
				target,
				capture,
				captureDigest,
				executionSelection: toExecutionSelection(root, descriptor, ownership.state.agentId, model),
				toolPolicy: descriptor.toolPolicy,
			});
			if (preparation.kind === 'rejected') {
				throw new Error(preparation.failure.message);
			}
			if (preparation.submission.submission !== composerSubmission.capture.submissionId) {
				throw new Error('Agent Host changed the prepared submission identity.');
			}
			const preparedSessionConfiguration = validateAndFreezeAgentConfigurationState(
				preparation.submission.sessionConfiguration,
				{ agent: ownership.state.agentId, scope: 'session' },
			);
			if (!sameConfigurationState(preparedSessionConfiguration, expectedSessionConfiguration)) {
				throw new Error('Agent Host changed the resolved Session configuration during preparation.');
			}
			const preparedCaptureDigest = await computeAgentHostSubmissionCaptureDigest({
				message: preparation.submission.message,
				attachments: preparation.submission.attachments,
				interactionTargets: preparation.submission.interactionTargets,
			});
			if (preparedCaptureDigest !== captureDigest) {
				throw new Error('Agent Host changed the immutable prepared submission capture.');
			}

			if (ownership.kind === 'draft') {
				if (!descriptor.capabilities.supportsInitialTurn) {
					throw new Error(`Session type '${descriptor.id}' does not support an initial Turn.`);
				}
				const draft = ownership.record;
				const workspace = toAgentWorkspace(draft.workspace);
				const result = await this.mutate({
					kind: 'createSession',
					sessionType: descriptor.id,
					...(workspace ? { workspace } : {}),
					configuration: draft.configuration,
					chats: Object.freeze([{
						model,
						origin: Object.freeze({ kind: 'user' }),
						initialSubmission: preparation.submission,
					}]),
				});
				this.assertMutationKind(result, 'createSession');
				if (result.chats.length !== 1 || result.chats[0].submission !== composerSubmission.capture.submissionId) {
					throw new Error('Agent Host did not atomically create the draft Session, Chat, and initial Turn.');
				}
				hostAccepted = true;
				await this.acceptAndRefresh(composerSubmission, draft, result.session);
				return;
			}

			const chatRecord = this.requireCommittedChatRecord(ownership.record, chat);
			this.assertChatAvailable(chatRecord);
			if (!chatRecord.state.capabilities.supportsSubmit) {
				throw new Error(`Chat '${chat.resource.toString()}' does not support submission.`);
			}
			const result = await this.mutate({
				kind: 'submitTurn',
				session: ownership.record.state.id,
				chat: chatRecord.state.id,
				submission: preparation.submission,
			});
			this.assertMutationKind(result, 'submitTurn');
			if (result.submission !== composerSubmission.capture.submissionId) {
				throw new Error('Agent Host committed another submission identity.');
			}
			hostAccepted = true;
			await this.acceptAndRefresh(composerSubmission);
		} catch (error) {
			if (!hostAccepted && !(error instanceof AgentHostOperationUncertainError)) {
				await composerSubmission.reject();
			}
			throw error;
		}
	}

	private async acceptAndRefresh(
		composerSubmission: IPreparedChatSubmission,
		replacedDraft?: IAgentHostDraftRecord,
		expectedSession?: AgentSessionId,
	): Promise<void> {
		let acceptanceError: unknown;
		try {
			await composerSubmission.accept();
		} catch (error) {
			acceptanceError = error;
		}
		if (replacedDraft) {
			if (this.draft !== replacedDraft || !expectedSession) {
				throw new Error('The accepted Agent Host draft ownership changed before replacement.');
			}
			this.draft = undefined;
		}
		try {
			await this.refreshAuthoritativeState(replacedDraft, expectedSession);
		} catch (refreshError) {
			if (acceptanceError) {
				throw new AggregateError([acceptanceError, refreshError], 'Host acceptance committed, but local reconciliation failed.');
			}
			throw refreshError;
		}
		if (acceptanceError) {
			throw acceptanceError;
		}
	}

	private async mutateSession(
		session: ISession,
		createPayload: (record: IAgentHostSessionRecord) => AgentHostMutationPayload,
	): Promise<void> {
		await this.sequencer.queue(async () => {
			const record = this.requireCommittedRecord(session);
			this.assertSessionAvailable(record);
			const payload = createPayload(record);
			const result = await this.mutate(payload);
			this.assertMutationKind(result, payload.kind);
			await this.refreshAuthoritativeState();
		});
	}

	private async mutateChat(
		session: ISession,
		chat: IChat,
		createPayload: (record: IAgentHostSessionRecord, chatRecord: IAgentHostChatRecord) => AgentHostMutationPayload,
	): Promise<void> {
		await this.sequencer.queue(async () => {
			const record = this.requireCommittedRecord(session);
			const chatRecord = this.requireCommittedChatRecord(record, chat);
			this.assertSessionAvailable(record);
			this.assertChatAvailable(chatRecord);
			const payload = createPayload(record, chatRecord);
			const result = await this.mutate(payload);
			this.assertMutationKind(result, payload.kind);
			await this.refreshAuthoritativeState();
		});
	}

	private async mutate(payload: AgentHostMutationPayload): Promise<AgentHostMutationResult> {
		const operation = createAgentHostOperationId(generateUuid());
		const digest = await computeAgentHostMutationDigest(payload);
		const request = Object.freeze({ operation, digest, payload });
		let outcome: AgentHostMutationOutcome;
		try {
			outcome = await this.connection.mutate(request);
		} catch {
			outcome = await this.connection.getOperationOutcome({ operation, digest });
		}

		let resent = false;
		for (let reconciliation = 0; reconciliation < 4; reconciliation++) {
			switch (outcome.kind) {
				case 'succeeded':
					if (outcome.result.operation !== operation || outcome.result.digest !== digest) {
						throw new Error(`Agent Host operation '${operation}' returned another operation identity.`);
					}
					return outcome.result;
				case 'failed':
					if (outcome.failure.reconciliation === 'terminal') {
						throw new AgentHostOperationFailure(operation, outcome.failure.message);
					}
					outcome = await this.connection.getOperationOutcome({ operation, digest });
					break;
				case 'conflict':
					throw new AgentHostOperationFailure(
						operation,
						`Agent Host operation '${operation}' conflicts with digest '${outcome.recordedDigest}'.`,
					);
				case 'pending':
					outcome = await this.connection.getOperationOutcome({ operation, digest });
					break;
				case 'unknown':
					if (!resent) {
						resent = true;
						outcome = await this.connection.mutate(request);
					} else {
						outcome = await this.connection.getOperationOutcome({ operation, digest });
					}
					break;
			}
		}
		throw new AgentHostOperationUncertainError(operation, digest);
	}

	private assertMutationKind<TKind extends AgentHostMutationPayload['kind']>(
		result: AgentHostMutationResult,
		kind: TKind,
	): asserts result is Extract<AgentHostMutationResult, { readonly kind: TKind }> {
		if (result.kind !== kind) {
			throw new Error(`Agent Host mutation '${kind}' returned '${result.kind}'.`);
		}
	}

	private async refreshAuthoritativeState(
		replacedDraft?: IAgentHostDraftRecord,
		expectedSession?: AgentSessionId,
	): Promise<void> {
		const rootChannel = getAgentHostRootChannelId();
		const sessionsChannel = getAgentHostSessionsChannelId();
		const result = await this.setSubscriptions([...this.subscriptions]);
		this.applyRootSnapshot(this.requireSnapshot(result.snapshots, rootChannel, 'root'), true);
		this.sessionsReducer.applySnapshot(this.requireSnapshot(result.snapshots, sessionsChannel, 'sessions'));
		this.noteHostSequence(result.hostSequence);
		await this.hydrateCatalog(true, replacedDraft, expectedSession);
	}

	private async hydrateCatalog(
		emit: boolean,
		replacedDraft?: IAgentHostDraftRecord,
		expectedSession?: AgentSessionId,
	): Promise<void> {
		const rootChannel = getAgentHostRootChannelId();
		const sessionsChannel = getAgentHostSessionsChannelId();
		for (;;) {
			const requestedSessionChannels = this.catalogSessionChannels();
			const sessionResult = await this.setSubscriptions([
				rootChannel,
				sessionsChannel,
				...requestedSessionChannels,
			]);
			this.applyRootSnapshot(this.requireSnapshot(sessionResult.snapshots, rootChannel, 'root'), emit);
			this.sessionsReducer.applySnapshot(this.requireSnapshot(sessionResult.snapshots, sessionsChannel, 'sessions'));
			this.noteHostSequence(sessionResult.hostSequence);

			const sessionChannels = this.catalogSessionChannels();
			if (!this.sameChannelSet(requestedSessionChannels, sessionChannels)) {
				continue;
			}
			this.applySessionSnapshots(sessionResult.snapshots);
			const requestedChatChannels = this.catalogChatChannels();

			const topologyResult = await this.setSubscriptions([
				rootChannel,
				sessionsChannel,
				...sessionChannels,
				...requestedChatChannels,
			]);
			this.applyRootSnapshot(this.requireSnapshot(topologyResult.snapshots, rootChannel, 'root'), emit);
			this.sessionsReducer.applySnapshot(this.requireSnapshot(topologyResult.snapshots, sessionsChannel, 'sessions'));
			this.noteHostSequence(topologyResult.hostSequence);

			const finalSessionChannels = this.catalogSessionChannels();
			if (!this.sameChannelSet(sessionChannels, finalSessionChannels)) {
				continue;
			}
			this.applySessionSnapshots(topologyResult.snapshots);
			const finalChatChannels = this.catalogChatChannels();
			if (!this.sameChannelSet(requestedChatChannels, finalChatChannels)) {
				continue;
			}
			this.applyChatSnapshots(topologyResult.snapshots);
			this.retainReducersForCurrentTopology();
			this.reconcileCatalog(emit, replacedDraft, expectedSession);
			return;
		}
	}

	private async setSubscriptions(
		subscriptions: readonly AgentHostChannelId[],
	): Promise<IAgentHostSetSubscriptionsResult> {
		const request = Object.freeze({ subscriptions: Object.freeze([...subscriptions]) });
		const result = await this.connection.setSubscriptions(request);
		assertAgentHostSetSubscriptionsResult(request, result);
		this.replaceActiveSubscriptions(result.snapshots);
		this.dropMissingChannels(result.missingChannels);
		return result;
	}

	private replaceActiveSubscriptions(snapshots: readonly AgentHostChannelSnapshot[]): void {
		this.subscriptions.clear();
		for (const snapshot of snapshots) {
			this.subscriptions.add(snapshot.channel);
		}
	}

	private sameChannelSet(left: readonly AgentHostChannelId[], right: readonly AgentHostChannelId[]): boolean {
		const leftSet = new Set(left);
		return leftSet.size === right.length && right.every(channel => leftSet.has(channel));
	}

	private catalogSessionChannels(): readonly AgentHostChannelId[] {
		const catalog = this.requireCatalogState();
		const sessionIds = new Set<AgentSessionId>();
		const channels: AgentHostChannelId[] = [];
		for (const summary of catalog.sessions) {
			createAgentSessionId(summary.id);
			if (sessionIds.has(summary.id)) {
				throw new Error(`Agent Host catalog contains duplicate Session '${summary.id}'.`);
			}
			sessionIds.add(summary.id);
			channels.push(getAgentHostSessionChannelId(summary.id));
		}
		return Object.freeze(channels);
	}

	private applySessionSnapshots(snapshots: readonly AgentHostChannelSnapshot[]): void {
		for (const summary of this.requireCatalogState().sessions) {
			const channel = getAgentHostSessionChannelId(summary.id);
			const snapshot = this.requireSnapshot(snapshots, channel, 'session');
			this.getSessionReducer(summary.id).applySnapshot(snapshot);
			this.assertSessionMatchesSummary(snapshot.state, summary);
		}
	}

	private catalogChatChannels(): readonly AgentHostChannelId[] {
		const channels: AgentHostChannelId[] = [];
		for (const summary of this.requireCatalogState().sessions) {
			const state = this.requireSessionReducerState(summary.id);
			const chatIds = new Set<AgentChatId>();
			for (const chat of state.chats) {
				if (chatIds.has(chat.id)) {
					throw new Error(`Agent Host Session '${state.id}' contains duplicate Chat '${chat.id}'.`);
				}
				chatIds.add(chat.id);
				channels.push(getAgentHostChatChannelId(state.id, chat.id));
			}
		}
		return Object.freeze(channels);
	}

	private applyChatSnapshots(snapshots: readonly AgentHostChannelSnapshot[]): void {
		for (const summary of this.requireCatalogState().sessions) {
			const state = this.requireSessionReducerState(summary.id);
			for (const chat of state.chats) {
				const channel = getAgentHostChatChannelId(state.id, chat.id);
				const snapshot = this.requireSnapshot(snapshots, channel, 'chat');
				assertAgentHostChatState(snapshot.state);
				this.assertChatMatchesSummary(snapshot.state, state.id, chat);
				this.getChatReducer(state.id, chat.id).applySnapshot(snapshot);
			}
		}
	}

	private retainReducersForCurrentTopology(): void {
		const sessions = new Set(this.requireCatalogState().sessions.map(summary => summary.id));
		const chats = new Set<string>();
		for (const session of sessions) {
			for (const chat of this.requireSessionReducerState(session).chats) {
				chats.add(chatKey(session, chat.id));
			}
		}
		for (const session of this.sessionReducers.keys()) {
			if (!sessions.has(session)) {
				this.sessionReducers.delete(session);
			}
		}
		for (const key of this.chatReducers.keys()) {
			if (!chats.has(key)) {
				this.chatReducers.delete(key);
			}
		}
	}

	private reconcileCatalog(
		emit: boolean,
		replacedDraft?: IAgentHostDraftRecord,
		expectedSession?: AgentSessionId,
	): void {
		const catalog = this.requireCatalogState();
		const nextRecords = new Map<AgentSessionId, IAgentHostSessionRecord>();
		const nextSessions: AgentHostSession[] = [];
		const createdRecords: IAgentHostSessionRecord[] = [];
		const transitions: ISessionsChangeEvent['transitions'][number][] = [];
		try {
			for (const summary of catalog.sessions) {
				const state = this.requireSessionReducerState(summary.id);
				const descriptor = this.requireDescriptor(state.type, state.agentId);
				if (descriptor.packageId !== state.packageId) {
					throw new Error(`Agent Host Session '${state.id}' changed its package ownership.`);
				}
				const previous = this.records.get(state.id);
				const record = previous ?? this.createSessionRecord(state);
				if (!previous) {
					createdRecords.push(record);
				}
				this.updateSessionRecord(record, state);
				nextRecords.set(state.id, record);
				nextSessions.push(record.session);
				if (emit) {
					if (replacedDraft && expectedSession === state.id) {
						transitions.push({ kind: SessionTransitionKind.Replaced, from: replacedDraft.session, to: record.session });
					} else if (previous) {
						transitions.push({ kind: SessionTransitionKind.Changed, session: record.session });
					} else {
						transitions.push({ kind: SessionTransitionKind.Added, session: record.session });
					}
				}
			}
			if (replacedDraft && expectedSession && !nextRecords.has(expectedSession)) {
				throw new Error(`Agent Host accepted draft replacement Session '${expectedSession}' without publishing it.`);
			}
		} catch (error) {
			for (const record of createdRecords) {
				this.disposeSessionRecord(record);
			}
			throw error;
		}

		const removed = [...this.records.entries()].filter(([id]) => !nextRecords.has(id));
		if (emit) {
			for (const [, record] of removed) {
				transitions.push({ kind: SessionTransitionKind.Removed, session: record.session });
			}
		}
		this.records.clear();
		for (const [id, record] of nextRecords) {
			this.records.set(id, record);
		}
		this.sessions = Object.freeze(nextSessions);
		if (emit && transitions.length > 0) {
			this.sessionsChangeEmitter.fire({ transitions: Object.freeze(transitions) });
		}
		for (const [, record] of removed) {
			this.deleteSessionRecord(record);
		}
		if (replacedDraft) {
			replacedDraft.owner.delete();
		}
	}

	private createSessionRecord(state: IAgentHostSessionState): IAgentHostSessionRecord {
		const chats = new Map<AgentChatId, IAgentHostChatRecord>();
		const chatResources = new Map(state.chats.map(chat => [
			chat.id,
			createAgentHostChatResource(this.connection.authority, state.id, chat.id),
		]));
		try {
			for (const summary of state.chats) {
				const chatState = this.requireChatReducerState(state.id, summary.id);
				const resource = chatResources.get(summary.id)!;
				const owner = this.chatService.createModel(resource);
				try {
					owner.replaceHostState({ session: state.id, chat: summary.id }, chatState);
					const chat = new AgentHostChat(
						state.id,
						summary.id,
						resource,
						new Date(chatState.createdAt),
						toChatOrigin(chatState, chatResources),
						toChatModelState(chatState),
					);
					chats.set(summary.id, { chat, owner, state: chatState });
				} catch (error) {
					owner.dispose();
					throw error;
				}
			}
			const orderedChats = state.chats.map(chat => chats.get(chat.id)!.chat);
			const session = new AgentHostSession(
				state.id,
				createAgentHostSessionResource(this.connection.authority, state.id),
				this.id,
				state.type,
				new Date(state.createdAt),
				toSessionModelState(state, orderedChats),
			);
			return { session, chats, state };
		} catch (error) {
			for (const record of chats.values()) {
				record.owner.dispose();
			}
			throw error;
		}
	}

	private updateSessionRecord(record: IAgentHostSessionRecord, state: IAgentHostSessionState): void {
		if (record.session.hostSessionId !== state.id
			|| record.session.sessionType !== state.type
			|| record.session.createdAt.getTime() !== state.createdAt) {
			throw new Error(`Agent Host Session '${state.id}' changed immutable identity fields.`);
		}
		const chatResources = new Map(state.chats.map(chat => [
			chat.id,
			createAgentHostChatResource(this.connection.authority, state.id, chat.id),
		]));
		const nextChats = new Map<AgentChatId, IAgentHostChatRecord>();
		const created: IAgentHostChatRecord[] = [];
		try {
			for (const summary of state.chats) {
				const chatState = this.requireChatReducerState(state.id, summary.id);
				let chatRecord = record.chats.get(summary.id);
				if (!chatRecord) {
					const resource = chatResources.get(summary.id)!;
					const owner = this.chatService.createModel(resource);
					try {
						owner.replaceHostState({ session: state.id, chat: summary.id }, chatState);
						chatRecord = {
							chat: new AgentHostChat(
								state.id,
								summary.id,
								resource,
								new Date(chatState.createdAt),
								toChatOrigin(chatState, chatResources),
								toChatModelState(chatState),
							),
							owner,
							state: chatState,
						};
						created.push(chatRecord);
					} catch (error) {
						owner.dispose();
						throw error;
					}
				} else {
					if (chatRecord.chat.createdAt.getTime() !== chatState.createdAt
						|| !sameChatOrigin(chatRecord.chat.origin, toChatOrigin(chatState, chatResources))) {
						throw new Error(`Agent Host Chat '${summary.id}' changed immutable identity fields.`);
					}
					chatRecord.owner.replaceHostState({ session: state.id, chat: summary.id }, chatState);
					chatRecord.chat.setState(toChatModelState(chatState), undefined);
					chatRecord.state = chatState;
				}
				nextChats.set(summary.id, chatRecord);
			}
		} catch (error) {
			for (const chat of created) {
				chat.owner.dispose();
			}
			throw error;
		}

		const removed = [...record.chats.entries()].filter(([id]) => !nextChats.has(id));
		record.chats.clear();
		for (const [id, chat] of nextChats) {
			record.chats.set(id, chat);
		}
		record.state = state;
		record.session.setState(toSessionModelState(
			state,
			state.chats.map(chat => record.chats.get(chat.id)!.chat),
		), undefined);
		for (const [, chat] of removed) {
			chat.owner.delete();
		}
	}

	private async applyReconnectResult(result: AgentHostReconnectResult): Promise<void> {
		if (result.kind === 'replay') {
			const previousRoot = this.requireRootState();
			this.assertReplayActionsApplicable(result.actions);
			for (const action of result.actions) {
				this.applyReplayAction(action);
			}
			this.dropMissingChannels(result.missingChannels);
			this.lastHostSequence = result.throughHostSequence;
			const currentRoot = this.requireRootState();
			if (currentRoot !== previousRoot) {
				this.fireRootChanges(previousRoot, currentRoot);
			}
		} else {
			this.replaceActiveSubscriptions(result.snapshots);
			this.dropMissingChannels(result.missingChannels);
			const rootChannel = getAgentHostRootChannelId();
			const sessionsChannel = getAgentHostSessionsChannelId();
			this.applyRootSnapshot(this.requireSnapshot(result.snapshots, rootChannel, 'root'), true);
			this.sessionsReducer.applySnapshot(this.requireSnapshot(result.snapshots, sessionsChannel, 'sessions'));
			for (const summary of this.requireCatalogState().sessions) {
				const channel = getAgentHostSessionChannelId(summary.id);
				if (!this.subscriptions.has(channel)) {
					continue;
				}
				const snapshot = this.requireSnapshot(result.snapshots, channel, 'session');
				this.getSessionReducer(summary.id).applySnapshot(snapshot);
				this.assertSessionMatchesSummary(snapshot.state, summary);
			}
			for (const summary of this.requireCatalogState().sessions) {
				const reducer = this.sessionReducers.get(summary.id);
				if (!reducer?.state) {
					continue;
				}
				for (const chat of reducer.state.chats) {
					const channel = getAgentHostChatChannelId(summary.id, chat.id);
					if (!this.subscriptions.has(channel)) {
						continue;
					}
					const snapshot = this.requireSnapshot(result.snapshots, channel, 'chat');
					assertAgentHostChatState(snapshot.state);
					this.assertChatMatchesSummary(snapshot.state, summary.id, chat);
					this.getChatReducer(summary.id, chat.id).applySnapshot(snapshot);
				}
			}
			this.noteHostSequence(result.hostSequence);
		}
		await this.hydrateCatalog(true);
	}

	private assertReplayActionsApplicable(actions: readonly AgentHostChannelAction[]): void {
		const progress = new Map<AgentHostChannelId, { hostSequence: number; revision: number }>();
		for (const action of actions) {
			const current = progress.get(action.channel) ?? this.reducerProgress(action.channel);
			if (
				current === undefined
				|| action.revision !== current.revision + 1
				|| action.hostSequence <= current.hostSequence
			) {
				throw new Error(`Agent Host reconnect replay is not contiguous for '${action.channel}'.`);
			}
			progress.set(action.channel, { hostSequence: action.hostSequence, revision: action.revision });
		}
	}

	private reducerProgress(channel: AgentHostChannelId): { hostSequence: number; revision: number } | undefined {
		const reducer = channel === this.rootReducer.channel
			? this.rootReducer
			: channel === this.sessionsReducer.channel
				? this.sessionsReducer
				: [...this.sessionReducers.values(), ...this.chatReducers.values()].find(candidate => candidate.channel === channel);
		if (
			!this.subscriptions.has(channel)
			|| reducer === undefined
			|| reducer.requiresFreshSnapshot
			|| reducer.hostSequence === undefined
			|| reducer.revision === undefined
		) {
			return undefined;
		}
		return { hostSequence: reducer.hostSequence, revision: reducer.revision };
	}

	private applyReplayAction(envelope: AgentHostChannelAction): void {
		if (envelope.channel === this.rootReducer.channel) {
			const application = this.rootReducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'root' }>);
			if (application.kind !== 'applied') {
				throw application.kind === 'snapshotRequired'
					? application.error
					: new Error(`Agent Host reconnect replay duplicated '${envelope.channel}'.`);
			}
			this.assertRootState(application.state);
			return;
		}
		if (envelope.channel === this.sessionsReducer.channel) {
			const application = this.sessionsReducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'sessions' }>);
			if (application.kind !== 'applied') {
				throw application.kind === 'snapshotRequired'
					? application.error
					: new Error(`Agent Host reconnect replay duplicated '${envelope.channel}'.`);
			}
			return;
		}
		for (const reducer of this.sessionReducers.values()) {
			if (reducer.channel !== envelope.channel) {
				continue;
			}
			const application = reducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'session' }>);
			if (application.kind !== 'applied') {
				throw application.kind === 'snapshotRequired'
					? application.error
					: new Error(`Agent Host reconnect replay duplicated '${envelope.channel}'.`);
			}
			return;
		}
		for (const reducer of this.chatReducers.values()) {
			if (reducer.channel !== envelope.channel) {
				continue;
			}
			const application = reducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'chat' }>);
			if (application.kind !== 'applied') {
				throw application.kind === 'snapshotRequired'
					? application.error
					: new Error(`Agent Host reconnect replay duplicated '${envelope.channel}'.`);
			}
			assertAgentHostChatState(application.state);
			return;
		}
		throw new Error(`Agent Host reconnect replay addressed unsubscribed channel '${envelope.channel}'.`);
	}

	private dropMissingChannels(
		missingChannels: readonly { readonly channel: AgentHostChannelId; readonly reason: string }[],
	): void {
		for (const missing of missingChannels) {
			this.subscriptions.delete(missing.channel);
			if (missing.channel === this.rootReducer.channel || missing.channel === this.sessionsReducer.channel) {
				throw new Error(`Agent Host reconnect omitted required channel '${missing.channel}:${missing.reason}'.`);
			}
			for (const [session, reducer] of this.sessionReducers) {
				if (reducer.channel !== missing.channel) {
					continue;
				}
				this.sessionReducers.delete(session);
				for (const [key, chatReducer] of this.chatReducers) {
					if (chatReducer.state?.session === session) {
						this.chatReducers.delete(key);
					}
				}
			}
			for (const [key, reducer] of this.chatReducers) {
				if (reducer.channel === missing.channel) {
					this.chatReducers.delete(key);
				}
			}
		}
	}

	private async applyAction(envelope: AgentHostChannelAction): Promise<void> {
		if (this.disposed) {
			return;
		}
		if (envelope.channel === getAgentHostRootChannelId()) {
			const previous = this.requireRootState();
			const application = this.rootReducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'root' }>);
			if (application.kind === 'snapshotRequired') {
				const snapshot = await this.refreshSubscribedChannel(getAgentHostRootChannelId(), 'root');
				this.applyRootSnapshot(snapshot, true);
			} else if (application.kind === 'applied') {
				this.assertRootState(application.state);
				this.fireRootChanges(previous, application.state);
			}
			this.noteHostSequence(envelope.hostSequence);
			return;
		}
		if (envelope.channel === getAgentHostSessionsChannelId()) {
			const application = this.sessionsReducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'sessions' }>);
			if (application.kind === 'duplicate') {
				return;
			}
			if (application.kind === 'snapshotRequired') {
				this.sessionsReducer.applySnapshot(await this.refreshSubscribedChannel(getAgentHostSessionsChannelId(), 'sessions'));
			}
			this.noteHostSequence(envelope.hostSequence);
			await this.hydrateCatalog(true);
			return;
		}

		for (const [sessionId, reducer] of this.sessionReducers) {
			if (envelope.channel !== reducer.channel) {
				continue;
			}
			const application = reducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'session' }>);
			if (application.kind === 'duplicate') {
				return;
			}
			if (application.kind === 'snapshotRequired') {
				reducer.applySnapshot(await this.refreshSubscribedChannel(reducer.channel, 'session'));
			}
			this.noteHostSequence(envelope.hostSequence);
			await this.refreshOneSession(sessionId);
			return;
		}
		for (const [key, reducer] of this.chatReducers) {
			if (envelope.channel !== reducer.channel) {
				continue;
			}
			const application = reducer.applyAction(envelope as Extract<AgentHostChannelAction, { readonly kind: 'chat' }>);
			if (application.kind === 'duplicate') {
				return;
			}
			if (application.kind === 'snapshotRequired') {
				reducer.applySnapshot(await this.refreshSubscribedChannel(reducer.channel, 'chat'));
			}
			this.noteHostSequence(envelope.hostSequence);
			const separator = key.indexOf('\0');
			await this.refreshOneChat(
				createAgentSessionId(key.slice(0, separator)),
				createAgentChatId(key.slice(separator + 1)),
			);
			return;
		}
		if (this.lastHostSequence !== undefined && envelope.hostSequence <= this.lastHostSequence) {
			return;
		}
		throw new Error(`Agent Host emitted an action for unsubscribed channel '${envelope.channel}'.`);
	}

	private applyRootSnapshot(snapshot: RootSnapshot, emit: boolean): void {
		const previous = this.rootReducer.state;
		this.rootReducer.applySnapshot(snapshot);
		this.assertRootState(snapshot.state);
		this.noteHostSequence(snapshot.hostSequence);
		if (emit && previous) {
			this.fireRootChanges(previous, snapshot.state);
		}
	}

	private fireRootChanges(previous: IAgentHostRootState, current: IAgentHostRootState): void {
		if (typeSignature(previous) !== typeSignature(current)) {
			this.sessionTypesChangeEmitter.fire();
		}
		if (modelSignature(previous) !== modelSignature(current)) {
			this.modelsChangeEmitter.fire();
		}
	}

	private async refreshOneSession(sessionId: AgentSessionId): Promise<void> {
		if (!this.records.has(sessionId)) {
			throw new Error(`Agent Host changed unknown Session '${sessionId}'.`);
		}
		await this.hydrateCatalog(false);
		const current = this.records.get(sessionId);
		if (!current) {
			throw new Error(`Agent Host removed Session '${sessionId}' outside the Session catalog.`);
		}
		this.sessionsChangeEmitter.fire({ transitions: [{ kind: SessionTransitionKind.Changed, session: current.session }] });
	}

	private async refreshOneChat(sessionId: AgentSessionId, chatId: AgentChatId): Promise<void> {
		const session = this.records.get(sessionId);
		const chat = session?.chats.get(chatId);
		if (!session || !chat) {
			throw new Error(`Agent Host changed unknown Chat '${sessionId}/${chatId}'.`);
		}
		const state = this.requireChatReducerState(sessionId, chatId);
		assertAgentHostChatState(state);
		if (!session.state.chats.some(candidate => candidate.id === chatId)) {
			throw new Error(`Agent Host Chat '${chatId}' is absent from Session '${sessionId}'.`);
		}
		chat.owner.replaceHostState({ session: sessionId, chat: chatId }, state);
		chat.chat.setState(toChatModelState(state), undefined);
		chat.state = state;
		session.session.setState(toSessionModelState(
			session.state,
			session.state.chats.map(candidate => session.chats.get(candidate.id)!.chat),
		), undefined);
		this.sessionsChangeEmitter.fire({ transitions: [{ kind: SessionTransitionKind.Changed, session: session.session }] });
	}

	private async refreshSubscribedChannel<TKind extends AgentHostChannelSnapshot['kind']>(
		channel: AgentHostChannelId,
		kind: TKind,
	): Promise<Extract<AgentHostChannelSnapshot, { readonly kind: TKind }>> {
		if (!this.subscriptions.has(channel)) {
			throw new Error(`Agent Host cannot refresh unsubscribed channel '${channel}'.`);
		}
		const result = await this.setSubscriptions([...this.subscriptions]);
		this.noteHostSequence(result.hostSequence);
		return this.requireSnapshot(result.snapshots, channel, kind);
	}

	private requireSnapshot<TKind extends AgentHostChannelSnapshot['kind']>(
		snapshots: readonly AgentHostChannelSnapshot[],
		channel: AgentHostChannelId,
		kind: TKind,
	): Extract<AgentHostChannelSnapshot, { readonly kind: TKind }> {
		const matches = snapshots.filter(snapshot => snapshot.channel === channel);
		if (matches.length !== 1 || matches[0].kind !== kind) {
			throw new Error(`Agent Host did not return one '${kind}' snapshot for '${channel}'.`);
		}
		return matches[0] as Extract<AgentHostChannelSnapshot, { readonly kind: TKind }>;
	}

	private getSessionReducer(session: AgentSessionId): AgentHostChannelStateReducer<'session', IAgentHostSessionState, IAgentHostSessionStateAction> {
		let reducer = this.sessionReducers.get(session);
		if (!reducer) {
			reducer = new AgentHostChannelStateReducer(getAgentHostSessionChannelId(session), 'session', reduceAgentHostSessionState);
			this.sessionReducers.set(session, reducer);
		}
		return reducer;
	}

	private getChatReducer(session: AgentSessionId, chat: AgentChatId): AgentHostChannelStateReducer<'chat', IAgentHostChatState, IAgentHostChatStateAction> {
		const key = chatKey(session, chat);
		let reducer = this.chatReducers.get(key);
		if (!reducer) {
			reducer = new AgentHostChannelStateReducer(getAgentHostChatChannelId(session, chat), 'chat', reduceAgentHostChatState);
			this.chatReducers.set(key, reducer);
		}
		return reducer;
	}

	private requireRootState(): IAgentHostRootState {
		const state = this.rootReducer.state;
		if (!state) {
			throw new Error('Agent Host provider has no root snapshot.');
		}
		return state;
	}

	private requireCatalogState(): IAgentHostSessionCatalogState {
		const state = this.sessionsReducer.state;
		if (!state) {
			throw new Error('Agent Host provider has no Session catalog snapshot.');
		}
		return state;
	}

	private requireSessionReducerState(session: AgentSessionId): IAgentHostSessionState {
		const state = this.sessionReducers.get(session)?.state;
		if (!state || state.id !== session) {
			throw new Error(`Agent Host provider has no exact state for Session '${session}'.`);
		}
		return state;
	}

	private requireChatReducerState(session: AgentSessionId, chat: AgentChatId): IAgentHostChatState {
		const state = this.chatReducers.get(chatKey(session, chat))?.state;
		if (!state || state.session !== session || state.id !== chat) {
			throw new Error(`Agent Host provider has no exact state for Chat '${session}/${chat}'.`);
		}
		return state;
	}

	private requireDescriptor(sessionType: string, agentId: string): IAgentHostSessionTypeDescriptor {
		const descriptor = this.requireRootState().sessionTypes.find(type => type.id === sessionType && type.agentId === agentId);
		if (!descriptor) {
			throw new Error(`Agent Host does not expose Session type '${sessionType}' for Agent '${agentId}'.`);
		}
		return descriptor;
	}

	private requireRuntimeRegistration(
		agentId: AgentId,
		packageId: IAgentHostSessionTypeDescriptor['packageId'],
	): IAgentRuntimeRegistration {
		const registrations = this.requireRootState().agentRegistrations.filter(candidate => (
			candidate.agentId === agentId && candidate.packageId === packageId
		));
		if (registrations.length !== 1) {
			throw new Error(`Agent Host does not expose one exact runtime registration for Agent '${agentId}'.`);
		}
		const registration = registrations[0];
		if (!registration.supportedSessionConfigurationSchemas.includes(
			registration.initialSessionConfigurationSchema,
		)) {
			throw new Error(`Agent Host registration '${registration.revision}' has an unsupported initial Session schema.`);
		}
		return registration;
	}

	private requireCommittedRecord(session: ISession): IAgentHostSessionRecord {
		this.assertNotDisposed();
		const record = [...this.records.values()].find(candidate => candidate.session === session);
		if (!record) {
			throw new Error(`Session '${session.sessionId}' is not committed by Agent Host provider '${this.id}'.`);
		}
		return record;
	}

	private requireCommittedChatRecord(record: IAgentHostSessionRecord, chat: IChat): IAgentHostChatRecord {
		const chatRecord = [...record.chats.values()].find(candidate => candidate.chat === chat);
		if (!chatRecord) {
			throw new Error(`Chat '${chat.resource.toString()}' does not belong to Session '${record.session.sessionId}'.`);
		}
		return chatRecord;
	}

	private requireCommittedChat(session: AgentSessionId, chat: AgentChatId): IAgentHostChatRecord {
		const record = this.records.get(session)?.chats.get(chat);
		if (!record) {
			throw new Error(`Agent Host did not publish Chat '${session}/${chat}'.`);
		}
		return record;
	}

	private requireOwnership(session: ISession, allowDraft: boolean):
		| { readonly kind: 'committed'; readonly record: IAgentHostSessionRecord; readonly state: IAgentHostSessionState }
		| { readonly kind: 'draft'; readonly record: IAgentHostDraftRecord; readonly state: Pick<IAgentHostSessionState, 'type' | 'agentId'> } {
		this.assertNotDisposed();
		if (allowDraft && this.draft?.session === session) {
			return {
				kind: 'draft',
				record: this.draft,
				state: { type: this.draft.descriptor.id, agentId: this.draft.descriptor.agentId },
			};
		}
		const record = this.requireCommittedRecord(session);
		return { kind: 'committed', record, state: record.state };
	}

	private requireChat(ownership: ReturnType<AgentHostSessionsProvider['requireOwnership']>, chat: IChat): AgentHostChat {
		if (ownership.kind === 'draft') {
			if (ownership.record.chat !== chat) {
				throw new Error(`Chat '${chat.resource.toString()}' does not belong to the current draft.`);
			}
			return ownership.record.chat;
		}
		return this.requireCommittedChatRecord(ownership.record, chat).chat;
	}

	private assertWorkspaceAllowed(descriptor: IAgentHostSessionTypeDescriptor, workspace: ISessionDraftOptions['workspace']): void {
		if (descriptor.capabilities.workspace === 'required' && workspace.kind === 'workspace-less') {
			throw new Error(`Session type '${descriptor.id}' requires a workspace.`);
		}
		if (descriptor.capabilities.workspace === 'unsupported' && workspace.kind !== 'workspace-less') {
			throw new Error(`Session type '${descriptor.id}' does not support a workspace.`);
		}
	}

	private assertModelAllowed(descriptor: IAgentHostSessionTypeDescriptor, agentId: string, model: AgentModelId | null): void {
		if (model === null) {
			if (descriptor.automaticExecutionPreset === null) {
				throw new Error(`Session type '${descriptor.id}' has no automatic execution preset.`);
			}
			return;
		}
		if (!descriptor.models.includes(model)) {
			throw new Error(`Session type '${descriptor.id}' does not expose model '${model}'.`);
		}
		const agent = this.requireRootState().agents.find(candidate => candidate.id === agentId);
		const modelDescriptor = agent?.models.find(candidate => candidate.id === model);
		if (!modelDescriptor?.enabled) {
			throw new Error(`Agent model '${model}' is not enabled.`);
		}
	}

	private assertSessionAvailable(record: IAgentHostSessionRecord): void {
		if (record.state.lifecycle !== 'available') {
			throw new Error(`Session '${record.session.sessionId}' is '${record.state.lifecycle}'.`);
		}
	}

	private assertChatAvailable(record: IAgentHostChatRecord): void {
		if (record.state.lifecycle !== 'available') {
			throw new Error(`Chat '${record.chat.resource.toString()}' is '${record.state.lifecycle}'.`);
		}
	}

	private assertRootState(state: IAgentHostRootState): void {
		if (state.authority !== this.connection.authority) {
			throw new Error(`Agent Host root authority '${state.authority}' does not match connection '${this.connection.authority}'.`);
		}
		this.assertDisplayProjection(state);
		const registrations = new Map<AgentId, IAgentRuntimeRegistration>();
		const hostDefaultSchemas = new Map<AgentId, ReturnType<typeof validateRuntimeRegistration>>();
		for (const registration of state.agentRegistrations) {
			const hostDefaultsSchema = validateRuntimeRegistration(registration);
			if (registrations.has(registration.agentId)) {
				throw new Error(`Agent Host exposes duplicate runtime registrations for Agent '${registration.agentId}'.`);
			}
			if (!state.agents.some(agent => (
				agent.id === registration.agentId && agent.packageId === registration.packageId
			))) {
				throw new Error(`Agent Host registration '${registration.revision}' has no exact Agent descriptor.`);
			}
			registrations.set(registration.agentId, registration);
			hostDefaultSchemas.set(registration.agentId, hostDefaultsSchema);
		}
		const defaults = new Map<AgentId, IAgentConfigurationState>();
		for (const value of state.agentDefaults) {
			const validated = validateAndFreezeAgentConfigurationState(value);
			const registration = registrations.get(validated.schema.agent);
			if (registration === undefined || defaults.has(validated.schema.agent)) {
				throw new Error(`Agent Host exposes invalid defaults for Agent '${validated.schema.agent}'.`);
			}
			const exact = validateAndFreezeAgentConfigurationState(validated, {
				agent: registration.agentId,
				scope: 'hostDefault',
				revision: registration.hostDefaultsSchema.revision,
			});
			const registeredSchema = hostDefaultSchemas.get(registration.agentId);
			if (
				registeredSchema === undefined
				|| encodeAgentHostProtocolValue(exact.schema) !== encodeAgentHostProtocolValue(registeredSchema)
			) {
				throw new Error(`Agent Host defaults for Agent '${registration.agentId}' do not match its runtime registration schema.`);
			}
			defaults.set(registration.agentId, exact);
		}
		for (const registration of registrations.values()) {
			if (!defaults.has(registration.agentId)) {
				throw new Error(`Agent Host registration '${registration.revision}' has no defaults state.`);
			}
		}
		const typeIds = new Set<string>();
		for (const descriptor of state.sessionTypes) {
			if (typeIds.has(descriptor.id)) {
				throw new Error(`Agent Host exposes duplicate Session type '${descriptor.id}'.`);
			}
			typeIds.add(descriptor.id);
			if (!state.agents.some(agent => agent.id === descriptor.agentId && agent.packageId === descriptor.packageId)) {
				throw new Error(`Agent Host Session type '${descriptor.id}' has no exact Agent owner.`);
			}
			if (!registrations.has(descriptor.agentId)) {
				throw new Error(`Agent Host Session type '${descriptor.id}' has no runtime registration.`);
			}
			const exposedModels = new Set(descriptor.models);
			if (exposedModels.size !== descriptor.models.length) {
				throw new Error(`Agent Host Session type '${descriptor.id}' exposes duplicate models.`);
			}
			const presetIds = new Set<string>();
			for (const preset of descriptor.executionPresets) {
				if (presetIds.has(preset.id)) {
					throw new Error(`Agent Host Session type '${descriptor.id}' exposes duplicate execution presets.`);
				}
				presetIds.add(preset.id);
				if (!exposedModels.has(preset.model)) {
					throw new Error(
						`Agent Host Session type '${descriptor.id}' preset '${preset.id}' binds an unexposed model.`,
					);
				}
			}
			if (descriptor.automaticExecutionPreset !== null
				&& !presetIds.has(descriptor.automaticExecutionPreset)) {
				throw new Error(`Agent Host Session type '${descriptor.id}' has an undeclared automatic execution preset.`);
			}
		}
	}

	private assertDisplayProjection(state: IAgentHostRootState): void {
		this.options.resolveDisplayText(state.label);
		for (const descriptor of state.sessionTypes) {
			this.options.resolveDisplayText(descriptor.displayName);
			this.options.resolveDisplayText(descriptor.description);
			for (const preset of descriptor.executionPresets) {
				this.options.resolveDisplayText(preset.displayName);
			}
		}
	}

	private assertSessionMatchesSummary(state: IAgentHostSessionState, summary: IAgentHostSessionSummary): void {
		const configuration = validateAndFreezeAgentConfigurationState(state.configuration, {
			agent: state.agentId,
			scope: 'session',
		});
		const registration = this.requireRuntimeRegistration(state.agentId, state.packageId);
		if (!registration.supportedSessionConfigurationSchemas.includes(configuration.schema.revision)) {
			throw new Error(`Agent Host Session '${state.id}' uses an unsupported configuration schema.`);
		}
		if (state.id !== summary.id
			|| state.packageId !== summary.packageId
			|| state.agentId !== summary.agentId
			|| state.type !== summary.type
			|| state.createdAt !== summary.createdAt
			|| state.title !== summary.title
			|| state.archived !== summary.archived
			|| state.lifecycle !== summary.lifecycle
			|| state.status !== summary.status
			|| state.isRead !== summary.isRead
			|| state.modifiedAt !== summary.modifiedAt) {
			throw new Error(`Agent Host Session '${summary.id}' state does not match its catalog summary.`);
		}
	}

	private assertChatMatchesSummary(
		state: IAgentHostChatState,
		session: AgentSessionId,
		summary: IAgentHostSessionState['chats'][number],
	): void {
		if (state.session !== session
			|| state.id !== summary.id
			|| state.createdAt !== summary.createdAt
			|| state.title !== summary.title
			|| !sameOrigin(state.origin, summary.origin)
			|| state.model !== summary.model
			|| state.lifecycle !== summary.lifecycle
			|| state.interactivity !== summary.interactivity
			|| state.status !== summary.status
			|| state.isRead !== summary.isRead
			|| state.modifiedAt !== summary.modifiedAt
			|| JSON.stringify(state.capabilities) !== JSON.stringify(summary.capabilities)) {
			throw new Error(`Agent Host Chat '${session}/${summary.id}' state does not match its Session summary.`);
		}
	}

	private assertNoMissingChannels(missing: readonly { readonly channel: AgentHostChannelId; readonly reason: string }[]): void {
		if (missing.length > 0) {
			const detail = missing.map(value => `${value.channel}:${value.reason}`).join(', ');
			throw new Error(`Agent Host omitted required channels: ${detail}.`);
		}
	}

	private noteHostSequence(sequence: AgentHostSequence): void {
		if (this.lastHostSequence === undefined || sequence > this.lastHostSequence) {
			this.lastHostSequence = sequence;
		}
	}

	private disposeSessionRecord(record: IAgentHostSessionRecord): void {
		for (const chat of record.chats.values()) {
			chat.owner.dispose();
		}
		record.chats.clear();
	}

	private deleteSessionRecord(record: IAgentHostSessionRecord): void {
		const errors: unknown[] = [];
		for (const chat of record.chats.values()) {
			try {
				chat.owner.delete();
			} catch (error) {
				errors.push(error);
			}
		}
		record.chats.clear();
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, `Failed to delete Agent Host Session '${record.state.id}'.`);
		}
	}

	private assertNotDisposed(): void {
		if (this.disposed) {
			throw new Error(`Agent Host provider '${this.id}' is disposed.`);
		}
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.draft?.owner.dispose();
		this.draft = undefined;
		for (const record of this.records.values()) {
			this.disposeSessionRecord(record);
		}
		this.records.clear();
		this.sessions = Object.freeze([]);
		super.dispose();
	}
}
