/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type {
	IAgent,
	IAgentAction,
	AgentSessionConfigurationUpdateDecision,
	IAgentBackingIdentity,
	IAgentCancelTurnRequest,
	IAgentChatRequest,
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentInteractionResponseRequest,
	IAgentRuntimeRegistration,
	IAgentSteerRequest,
	IAgentWorkspace,
	AgentTurnProgress,
} from 'cs/platform/agentHost/common/agent';
import { assertAgentHostAttachment, assertAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	IAgentConfigurationCandidate,
	IAgentConfigurationSchema,
	IAgentConfigurationState,
	collectAgentConfigurationCredentialReferences,
	resolveAgentModelConfigurationCandidate,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentCredentialReference } from 'cs/platform/agentHost/common/credentials';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentCancellationId,
	AgentChatId,
	AgentContentLeaseId,
	AgentHostActionDigest,
	AgentHostAuthorityId,
	AgentHostChannelId,
	AgentHostChannelRevision,
	AgentHostClientConnectionId,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentHostProtocolVersion,
	AgentHostSequence,
	AgentId,
	AgentConfigurationSchemaRevision,
	AgentConfigurationStateRevision,
	AgentPackageOperationId,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentSubmissionId,
	AgentTurnId,
	createAgentHostActionDigest,
	createAgentHostChannelRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostSequence,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentPackageOperationId,
} from 'cs/platform/agentHost/common/identities';
import { AgentHostOperationOutcomeRegistry } from 'cs/platform/agentHost/common/operations';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	AgentPackageOperationOutcome,
	IAgentAuthenticationPort,
	IAgentHostPackageCatalogState,
	IAgentPackageBackingRecord,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import { computeAgentPackageOperationDigest } from 'cs/platform/agentHost/common/packages';
import {
	AgentHostChannelAction,
	AgentHostDisplayText,
	AgentHostChannelSnapshot,
	AgentHostExecutionSelection,
	AgentHostMutationOutcome,
	AgentHostMutationResult,
	AgentHostOperationFailureCode,
	AgentHostPrepareSubmissionResult,
	AgentHostReconnectResult,
	AgentHostSubmissionTarget,
	AgentHostToolPolicy,
	AgentHostTurnState,
	IAgentHostCapability,
	IAgentHostChatState,
	IAgentHostChatStateAction,
	IAgentHostChatSummary,
	IAgentHostCommittedChannelRevision,
	IAgentHostCreateSessionChatRequest,
	IAgentHostInitializeRequest,
	IAgentHostInitializeResult,
	IAgentHostMissingChannel,
	IAgentHostMutationRequest,
	IAgentHostOperationFailure,
	IAgentHostOperationOutcomeRequest,
	IAgentHostPrepareSubmissionRequest,
	IAgentHostPreparedSubmission,
	IAgentHostReconnectRequest,
	IAgentHostResolveSessionConfigurationRequest,
	IAgentHostResolveSessionConfigurationResult,
	IAgentHostRootState,
	IAgentHostRootStateAction,
	IAgentHostSessionCatalogState,
	IAgentHostSessionCatalogStateAction,
	IAgentHostSessionState,
	IAgentHostSessionConfigurationCompletionsRequest,
	IAgentHostSessionConfigurationCompletionsResult,
	IAgentHostSessionStateAction,
	IAgentHostSessionTypeDescriptor,
	IAgentHostSetSubscriptionsRequest,
	IAgentHostSetSubscriptionsResult,
	IAgentHostTurn,
	assertAgentHostChatState,
	computeAgentHostMutationDigest,
	computeAgentHostSubmissionCaptureDigest,
	getAgentHostChatChannelId,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
	selectAgentHostProtocolVersion,
} from 'cs/platform/agentHost/common/protocol';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	computeAgentHostPayloadDigest,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	type IAgentToolSet,
	agentToolRegistrationAcceptsTarget,
} from 'cs/platform/agentHost/common/tools';
import {
	AgentPackageLifecycle,
	computeAgentResumeStateDigest,
	type IAgentPackageLifecyclePort,
	type IAgentPackageMutation,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import type { IAgentToolTurnAuthorityPort } from 'cs/platform/agentHost/node/tools/agentToolCallAuthority';
import type { IAgentToolSetPreparationPort } from 'cs/platform/agentHost/node/tools/agentToolSetPreparation';
import type { IAgentCredentialAuthority } from 'cs/platform/agentHost/node/credentials/agentCredentialService';
import {
	IAgentHostCatalogStore,
	IAgentHostPersistedCatalog,
	IAgentHostBackingRemovalOperation,
	IAgentHostPersistedChatRecord,
	IAgentHostPersistedSessionRecord,
	type AgentHostSessionConfigurationFinalizationOutcome,
	type IAgentHostSessionConfigurationFinalization,
	assertAgentHostPersistedCatalog,
	createEmptyAgentHostCatalog,
	maximumRetainedAgentHostSessionConfigurationFinalizations,
} from './agentHostCatalog.js';

const terminalTurnStates: ReadonlySet<AgentHostTurnState> = new Set(['completed', 'cancelled', 'failed']);
const activeTurnStates: ReadonlySet<AgentHostTurnState> = new Set([
	'accepted', 'queued', 'running', 'waitingForPermission', 'waitingForInput', 'cancelling',
]);
export interface IAgentHostIdentityFactory {
	createSession(): AgentSessionId;
	createChat(): AgentChatId;
	createTurn(): AgentTurnId;
	createCancellation(): AgentCancellationId;
}

export interface IAgentHostSubmissionPolicyResult {
	readonly requestedDeadline: number;
	readonly outputConstraints: AgentHostProtocolValue;
}

/** Resolves the exact Host-owned deadline and output constraints for one preparation. */
export interface IAgentHostSubmissionPolicy {
	resolve(agent: IAgentDescriptor, profile: IAgentExecutionProfile): IAgentHostSubmissionPolicyResult;
}

/** Resolves only the immutable runtime endpoint for one exact activated or staged registration. */
export interface IAgentHostRuntimeResolver {
	resolve(registration: IAgentRuntimeRegistration): IAgent;
	resolvePreparedActivation(
		operationId: AgentPackageOperationId,
		registration: IAgentRuntimeRegistration,
	): IAgent;
}

/** Describes one active Agent entry available to the Host Session type catalog. */
export interface IAgentHostActiveAgentCatalogEntry {
	readonly registration: IAgentRuntimeRegistration;
	readonly descriptor: IAgentDescriptor;
}

/** Resolves the createable Session types for the exact active Agent catalog. */
export interface IAgentHostSessionTypeCatalog {
	resolve(activeAgents: readonly IAgentHostActiveAgentCatalogEntry[]): readonly IAgentHostSessionTypeDescriptor[];
}

export interface IAgentHostShutdownRequest {
	readonly operation: AgentHostOperationId;
	readonly payloadDigest: AgentHostPayloadDigest;
}

export interface IAgentHostAuthorityOptions {
	readonly authority: AgentHostAuthorityId;
	readonly label: AgentHostDisplayText;
	readonly supportedProtocolVersions: readonly AgentHostProtocolVersion[];
	readonly capabilities: readonly IAgentHostCapability[];
	readonly implementation: IAgentHostInitializeResult['implementation'];
	readonly sessionTypeCatalog: IAgentHostSessionTypeCatalog;
	readonly agentRuntimes: IAgentHostRuntimeResolver;
	readonly packageLifecycle: AgentPackageLifecycle;
	readonly authentication?: IAgentAuthenticationPort;
	readonly credentials?: IAgentCredentialAuthority;
	readonly catalogStore: IAgentHostCatalogStore;
	readonly identityFactory: IAgentHostIdentityFactory;
	readonly submissionPolicy: IAgentHostSubmissionPolicy;
	readonly toolSets: IAgentToolSetPreparationPort;
	readonly toolCallAuthority: IAgentToolTurnAuthorityPort;
	readonly contentResources: Pick<IAgentContentResourcePort, 'open' | 'release'>;
	readonly now: () => number;
	readonly reportUnexpectedError: (error: unknown) => void;
	readonly maximumReplayActions: number;
}

export interface IAgentHostAgentDescriptorUpdate {
	readonly agent: IAgent;
	readonly descriptor: IAgentDescriptor;
	commit(): void;
}

export interface IAgentHostRootConfigurationUpdate {
	readonly agents: readonly IAgentHostAgentDescriptorUpdate[];
}

interface IPreparedSubmissionRecord {
	readonly connection: AgentHostClientConnectionId;
	readonly requestDigest: AgentHostPayloadDigest;
	readonly target: AgentHostSubmissionTarget;
	readonly promise: Promise<AgentHostPrepareSubmissionResult>;
	result?: AgentHostPrepareSubmissionResult;
	accepted: boolean;
}

interface IAgentHostConnectionState {
	initialized: boolean;
	readonly subscriptions: Set<AgentHostChannelId>;
}

interface IRuntimeChatRecord extends IAgentHostPersistedChatRecord {
	readonly materialized: boolean;
}

interface IRuntimeSessionRecord {
	readonly state: IAgentHostSessionState;
	readonly resume?: IAgentHostPersistedSessionRecord['resume'];
	readonly materialized: boolean;
	readonly chats: ReadonlyMap<AgentChatId, IRuntimeChatRecord>;
}

interface IPendingSessionConfigurationFinalizationBase {
	readonly connection: AgentHostClientConnectionId;
	readonly request: Parameters<IAgent['configuration']['commitSessionUpdate']>[0];
	readonly decision: AgentSessionConfigurationUpdateDecision;
	readonly outcome: AgentHostSessionConfigurationFinalizationOutcome;
}

type IPendingSessionConfigurationFinalization = IPendingSessionConfigurationFinalizationBase & (
	| { readonly finalize: 'complete' }
	| {
		readonly agent: IAgent;
		readonly finalize: 'acknowledge';
	}
	| {
		readonly agent: IAgent;
		readonly finalize: 'commit';
		readonly decision: 'commit';
	}
	| {
		readonly agent: IAgent;
		readonly finalize: 'rollback';
		readonly decision: 'rollback';
	}
);

type HostStateAction =
	| {
		readonly channel: AgentHostChannelId;
		readonly kind: 'root';
		readonly action: IAgentHostRootStateAction;
	}
	| {
		readonly channel: AgentHostChannelId;
		readonly kind: 'sessions';
		readonly action: IAgentHostSessionCatalogStateAction;
	}
	| {
		readonly channel: AgentHostChannelId;
		readonly kind: 'session';
		readonly action: IAgentHostSessionStateAction;
	}
	| {
		readonly channel: AgentHostChannelId;
		readonly kind: 'chat';
		readonly action: IAgentHostChatStateAction;
	};

interface ICommittedHostState {
	readonly hostSequence: AgentHostSequence;
	readonly revisions: readonly IAgentHostCommittedChannelRevision[];
}

type SessionConfigurationFinalizationCommit =
	| readonly IAgentHostSessionConfigurationFinalization[]
	| ((committed: ICommittedHostState) => readonly IAgentHostSessionConfigurationFinalization[]);

interface IMutationExecution {
	readonly result: AgentHostMutationResult;
	readonly afterCommit: readonly (() => void)[];
}

type MutationCommitFields = 'operation' | 'digest' | 'hostSequence' | 'revisions';
type WithoutMutationCommit<T> = T extends AgentHostMutationResult ? Omit<T, MutationCommitFields> : never;
type SimpleMutationResultShape = WithoutMutationCommit<AgentHostMutationResult>;

class HostOperationFailure extends Error {
	constructor(readonly failure: IAgentHostOperationFailure) {
		super(failure.message);
		this.name = 'HostOperationFailure';
	}
}

class PendingSessionConfigurationFinalization extends Error {
	constructor() {
		super('Session configuration finalization requires reconciliation');
		this.name = 'PendingSessionConfigurationFinalization';
	}
}

function operationFailure(
	code: AgentHostOperationFailureCode,
	message: string,
	data?: AgentHostProtocolValue,
	reconciliation: IAgentHostOperationFailure['reconciliation'] = 'terminal',
): HostOperationFailure {
	return new HostOperationFailure(Object.freeze({
		code,
		message,
		...(data === undefined ? {} : { data }),
		reconciliation,
	}));
}

function toOperationFailure(error: unknown): IAgentHostOperationFailure {
	if (error instanceof HostOperationFailure) {
		return error.failure;
	}
	return Object.freeze({
		code: 'agentUnavailable',
		message: error instanceof Error ? error.message : 'Agent Host operation failed',
		reconciliation: 'terminal',
	});
}

function assertSafeTimestamp(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error('Agent Host clock returned an invalid timestamp');
	}
}

function freezeChatState(state: IAgentHostChatState): IAgentHostChatState {
	const frozen = Object.freeze({
		...state,
		capabilities: Object.freeze({ ...state.capabilities }),
		turns: Object.freeze(state.turns.map(turn => Object.freeze({
			...turn,
			user: Object.freeze({
				...turn.user,
				attachments: Object.freeze([...turn.user.attachments]),
				interactionTargets: Object.freeze([...turn.user.interactionTargets]),
			}),
			behaviors: Object.freeze([...turn.behaviors]),
			interactions: Object.freeze(turn.interactions.map(interaction => Object.freeze({
				...interaction,
				request: Object.freeze({ ...interaction.request }),
				...(interaction.response === undefined ? {} : { response: Object.freeze({ ...interaction.response }) }),
			}))),
		}))),
	});
	assertAgentHostChatState(frozen);
	return frozen;
}

function chatSummary(state: IAgentHostChatState): IAgentHostChatSummary {
	return Object.freeze({
		id: state.id,
		createdAt: state.createdAt,
		title: state.title,
		origin: state.origin,
		model: state.model,
		lifecycle: state.lifecycle,
		interactivity: state.interactivity,
		status: state.status,
		isRead: state.isRead,
		capabilities: state.capabilities,
		modifiedAt: state.modifiedAt,
	});
}

function actionDigest(value: object): AgentHostActionDigest {
	const digest = createHash('sha256').update(encodeAgentHostProtocolValue(value)).digest('hex');
	return createAgentHostActionDigest(`sha256:${digest}`);
}

function payloadDigest(value: object): AgentHostPayloadDigest {
	const digest = createHash('sha256').update(encodeAgentHostProtocolValue(value)).digest('hex');
	return createAgentHostPayloadDigest(`sha256:${digest}`);
}

function configurationStateRevision(
	schema: IAgentConfigurationSchema,
	values: IAgentConfigurationState['values'],
): AgentConfigurationStateRevision {
	const digest = createHash('sha256').update(encodeAgentHostProtocolValue({ schema, values })).digest('hex');
	return createAgentConfigurationStateRevision(`sha256:${digest}`);
}

function createConfigurationState(
	schema: IAgentConfigurationSchema,
	values: IAgentConfigurationState['values'],
): IAgentConfigurationState {
	return validateAndFreezeAgentConfigurationState(Object.freeze({
		schema,
		revision: configurationStateRevision(schema, values),
		values,
	}), {
		agent: schema.agent,
		scope: schema.scope,
		revision: schema.revision,
	});
}

function createInitialAgentDefaults(registrations: readonly IAgentRuntimeRegistration[]): readonly IAgentConfigurationState[] {
	return Object.freeze(registrations.map(registration => {
		const schema = validateAndFreezeAgentConfigurationSchema(registration.hostDefaultsSchema, {
			agent: registration.agentId,
			scope: 'hostDefault',
		});
		return createConfigurationState(schema, Object.freeze({}));
	}));
}

function turnKey(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): string {
	return `${session}\u0000${chat}\u0000${turn}`;
}

function sameProtocolValue(left: object, right: object): boolean {
	return encodeAgentHostProtocolValue(left) === encodeAgentHostProtocolValue(right);
}

type AgentConfigurationSchemaRegistry = Map<AgentId, Map<AgentConfigurationSchemaRevision, IAgentConfigurationSchema>>;

function cloneConfigurationSchemaRegistry(
	registry: ReadonlyMap<AgentId, ReadonlyMap<AgentConfigurationSchemaRevision, IAgentConfigurationSchema>>,
): AgentConfigurationSchemaRegistry {
	return new Map([...registry].map(([agent, schemas]) => [agent, new Map(schemas)]));
}

function recordExactConfigurationSchema(
	registry: AgentConfigurationSchemaRegistry,
	schema: IAgentConfigurationSchema,
	field: string,
): void {
	let schemas = registry.get(schema.agent);
	if (schemas === undefined) {
		schemas = new Map();
		registry.set(schema.agent, schemas);
	}
	const existing = schemas.get(schema.revision);
	if (existing !== undefined && !sameProtocolValue(existing, schema)) {
		throw new Error(`${field} reuses configuration schema revision '${schema.revision}' with different content`);
	}
	schemas.set(schema.revision, schema);
}

function hasExactKeys(
	record: Readonly<Record<string, AgentHostProtocolValue>>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const keys = Object.keys(record);
	const allowed = new Set([...required, ...optional]);
	return required.every(key => Object.hasOwn(record, key)) && keys.every(key => allowed.has(key));
}

const agentHostLocalizedDisplayTextKeys = new Set([
	'agentHost.local.label',
	'agentHost.cometSession.displayName',
	'agentHost.cometSession.description',
	'agentHost.executionPreset.automatic',
]);

function assertDisplayText(value: AgentHostDisplayText, field: string): void {
	if (value.kind === 'literal') {
		if (
			Object.keys(value).length !== 2
			|| typeof value.value !== 'string'
			|| value.value.length === 0
			|| value.value.length > 1_024
		) {
			throw new Error(`Agent Host display text '${field}' is invalid`);
		}
		return;
	}
	if (
		value.kind !== 'localized'
		|| Object.keys(value).length !== 2
		|| !agentHostLocalizedDisplayTextKeys.has(value.key)
	) {
		throw new Error(`Agent Host display text '${field}' is invalid`);
	}
}

/** Owns one authoritative Agent Host catalog, activation registry, and protocol state. */
export class AgentHostAuthority extends Disposable implements IAgentPackageLifecyclePort {
	private readonly agents = new Map<AgentId, IAgent>();
	private readonly agentActionSubscriptions = new Map<AgentId, IDisposable>();
	private readonly sessionTypes = new Map<string, IAgentHostSessionTypeDescriptor>();
	private readonly connections = new Map<AgentHostClientConnectionId, AgentHostConnection>();
	private readonly connectionStates = new Map<AgentHostClientConnectionId, IAgentHostConnectionState>();
	private readonly operations = new AgentHostOperationOutcomeRegistry<AgentHostOperationId, AgentHostMutationOutcome>();
	private readonly operationOwners = new Map<AgentHostOperationId, AgentHostClientConnectionId>();
	private readonly packageOperationOwners = new Map<AgentPackageOperationId, AgentHostClientConnectionId>();
	private readonly preparations = new Map<AgentSubmissionId, IPreparedSubmissionRecord>();
	private readonly pendingSessionConfigurationFinalizations = new Map<AgentHostOperationId, IPendingSessionConfigurationFinalization>();
	private readonly packageMutationGates = new Map<AgentId, AgentPackageOperationId>();
	private readonly lifecycleActivities = new Map<AgentId, number>();
	private readonly quiescenceWaiters = new Set<() => void>();
	private readonly toolTurnBindings = new Map<string, IDisposable>();
	private readonly credentialTurnBindings = new Map<string, IDisposable>();
	private readonly turnContentAnchors = new Map<string, readonly AgentContentLeaseId[]>();
	private readonly replay: AgentHostChannelAction[] = [];
	private sessions = new Map<AgentSessionId, IRuntimeSessionRecord>();
	private agentDefaults = new Map<AgentId, IAgentConfigurationState>();
	private modelConfigurationSchemas: AgentConfigurationSchemaRegistry = new Map();
	private sessionConfigurationSchemas: AgentConfigurationSchemaRegistry = new Map();
	private catalog: IAgentHostPersistedCatalog;
	private catalogTail = Promise.resolve();
	private closing = false;

	private readonly _onDidPublishAction = this._register(new Emitter<AgentHostChannelAction>({
		onListenerError: error => this.options.reportUnexpectedError(error),
	}));
	readonly onDidPublishAction: Event<AgentHostChannelAction> = this._onDidPublishAction.event;
	private readonly _onDidRejectAgentAction = this._register(new Emitter<Error>({
		onListenerError: error => this.options.reportUnexpectedError(error),
	}));
	readonly onDidRejectAgentAction: Event<Error> = this._onDidRejectAgentAction.event;

	private constructor(
		private readonly options: IAgentHostAuthorityOptions,
		catalog: IAgentHostPersistedCatalog,
	) {
		super();
		this._register(toDisposable(() => {
			for (const binding of [...this.credentialTurnBindings.values()]) {
				binding.dispose();
			}
			for (const binding of [...this.toolTurnBindings.values()]) {
				binding.dispose();
			}
		}));
		this.catalog = catalog;
		this.loadCatalog(catalog);
		this.validateComposition();
		this.restoreSessionConfigurationFinalizationLedger();
		for (const agent of this.agents.values()) {
			this.subscribeAgentActions(agent);
		}
		this._register(toDisposable(() => {
			for (const subscription of this.agentActionSubscriptions.values()) {
				subscription.dispose();
			}
			this.agentActionSubscriptions.clear();
		}));
	}

	static async create(options: IAgentHostAuthorityOptions): Promise<AgentHostAuthority> {
		if (!Number.isSafeInteger(options.maximumReplayActions) || options.maximumReplayActions < 1) {
			throw new Error('Agent Host replay limit must be a positive integer');
		}
		let catalog = await options.catalogStore.read();
		if (catalog === undefined) {
			catalog = createEmptyAgentHostCatalog(createInitialAgentDefaults(
				options.packageLifecycle.snapshot().activeRegistrations,
			));
			await options.catalogStore.commit(undefined, catalog);
		}
		assertAgentHostPersistedCatalog(catalog);
		const authority = new AgentHostAuthority(options, catalog);
		try {
			options.packageLifecycle.bindLifecyclePort(authority);
			await authority.restoreCatalogBackings();
			await authority.completeRestoredSessionConfigurationFinalizations();
			await options.packageLifecycle.reconcileHostBackingState(authority.packageBackingState(authority.sessions));
			await options.packageLifecycle.completeRestoredBundledUpdate();
			await authority.reconcilePackageCatalogRevision();
			return authority;
		} catch (error) {
			authority.dispose();
			throw error;
		}
	}

	get authority(): AgentHostAuthorityId {
		return this.options.authority;
	}

	createConnection(connection: AgentHostClientConnectionId): IAgentHostConnection {
		if (this.closing) {
			throw new Error('Agent Host is closing');
		}
		if (this.connections.has(connection)) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host logical connection is already open',
				{ field: 'connection', value: connection },
			);
		}
		const result = new AgentHostConnection(this, connection, this.options.reportUnexpectedError);
		this.connections.set(connection, result);
		this.connectionStates.set(connection, { initialized: false, subscriptions: new Set() });
		this._register(result);
		return result;
	}

	async flushAgentActions(): Promise<void> {
		await this.catalogTail;
	}

	async acquirePackageMutation(
		operationId: AgentPackageOperationId,
		requestDigest: AgentHostPayloadDigest,
		agentIds: readonly AgentId[],
	): Promise<IAgentPackageMutation> {
		const affected = new Set(agentIds);
		if (affected.size !== agentIds.length || affected.size === 0) {
			throw new Error('Package mutation must address a non-empty set of distinct Agent IDs');
		}
		for (const agentId of affected) {
			if (this.packageMutationGates.has(agentId)) {
				throw new Error(`Agent '${agentId}' already has an active package mutation`);
			}
		}
		for (const agentId of affected) {
			this.packageMutationGates.set(agentId, operationId);
		}

		const lifecycleOperation = createAgentHostOperationId(`package-${createHash('sha256').update(operationId).digest('hex')}`);
		let drained = false;
		let settled = false;
		let checkpointed = false;
		let releasedRecords: readonly IAgentPackageBackingRecord[] = Object.freeze([]);
		let stagedActivation: ReadonlyMap<AgentId, IAgent> | undefined;
		const releaseGate = () => {
			for (const agentId of affected) {
				if (this.packageMutationGates.get(agentId) === operationId) {
					this.packageMutationGates.delete(agentId);
				}
			}
			this.notifyQuiescenceChanged();
		};

		return Object.freeze({
			drain: async () => {
				if (settled || drained) {
					throw new Error('Package mutation drain is not in the acquired state');
				}
				await this.catalogTail;
				await this.waitForQuiescence(affected);
				drained = true;
			},
			checkpointAndRelease: async (records: readonly IAgentPackageBackingRecord[]) => {
				if (settled || !drained || checkpointed) {
					throw new Error('Package mutation checkpoint release is not in the drained state');
				}
				const result = await this.checkpointAndReleasePackageBackings(
					affected,
					records,
					lifecycleOperation,
					requestDigest,
				);
				checkpointed = true;
				releasedRecords = result.released;
				return result.checkpoints;
			},
			prepareActivation: async (registrations: readonly IAgentRuntimeRegistration[]) => {
				if (settled || !drained || stagedActivation !== undefined) {
					throw new Error('Package mutation activation is not in the drained state');
				}
				const staged = new Map<AgentId, IAgent>();
				for (const registration of registrations) {
					if (!affected.has(registration.agentId) || staged.has(registration.agentId)) {
						throw new Error(`Staged registration '${registration.agentId}' does not match the package mutation gate`);
					}
					staged.set(
						registration.agentId,
						this.options.agentRuntimes.resolvePreparedActivation(operationId, registration),
					);
				}
				stagedActivation = staged;
			},
			commitBackingDeletion: async (identity: IAgentBackingIdentity) => {
				if (
					settled
					|| !drained
					|| !affected.has(identity.agentId)
				) {
					throw new Error('Package backing deletion is not in the drained state');
				}
				await this.commitHostBackingRemoval(
					Object.freeze([identity]),
					lifecycleOperation,
					requestDigest,
				);
			},
			rollback: async () => {
				if (settled) {
					throw new Error('Package mutation is already settled');
				}
				if (releasedRecords.length !== 0) {
					await this.rematerializePackageBackings(releasedRecords, lifecycleOperation, requestDigest);
				}
				settled = true;
				releaseGate();
			},
			complete: async () => {
				if (settled || !drained) {
					throw new Error('Package mutation cannot complete before it drains');
				}
				const previous = new Map<AgentId, IAgent>();
				const previousAgentDefaults = new Map(this.agentDefaults);
				for (const agentId of affected) {
					const agent = this.agents.get(agentId);
					if (agent !== undefined) {
						previous.set(agentId, agent);
					}
				}
				await this.enqueueCatalogMutation(async () => {
					try {
						if (stagedActivation !== undefined) {
							this.activateAgentRuntimes(affected, stagedActivation!);
						}
						const descriptors = new Map(
							[...this.agents].map(([agentId, agent]) => [agentId, agent.descriptor.get()]),
						);
						const sessionTypes = stagedActivation === undefined
							? this.sessionTypes
							: this.resolveSessionTypeCatalog(descriptors);
						const modelConfigurationSchemas = this.validateRootConfiguration(
							descriptors,
							Object.freeze([...sessionTypes.values()]),
						);
						const reconciled = stagedActivation === undefined
							? Object.freeze({ sessions: this.sessions, actions: Object.freeze([]) })
							: await this.reconcilePackageSessionAvailability(affected, sessionTypes);
						const rootState = this.createRootState(descriptors, sessionTypes);
						await this.commitHostState(
							reconciled.sessions,
							[this.rootAction(rootState), ...reconciled.actions],
							Object.freeze({ kind: 'operation', operation: lifecycleOperation, payloadDigest: requestDigest }),
							stagedActivation === undefined
								? undefined
								: () => {
									this.modelConfigurationSchemas = modelConfigurationSchemas;
									this.replaceSessionTypes(sessionTypes);
								},
						);
					} catch (error) {
						if (stagedActivation !== undefined) {
							try {
								this.activateAgentRuntimes(affected, previous);
								this.agentDefaults = previousAgentDefaults;
							} catch (rollbackError) {
								throw new AggregateError([error, rollbackError], 'Agent runtime activation and rollback both failed');
							}
						}
						throw error;
					}
				});
				settled = true;
				releaseGate();
			},
		});
	}

	async commitHostRecordPurge(
		operationId: AgentPackageOperationId,
		requestDigest: AgentHostPayloadDigest,
		records: readonly IAgentBackingIdentity[],
	): Promise<void> {
		const lifecycleOperation = createAgentHostOperationId(`package-${createHash('sha256').update(operationId).digest('hex')}`);
		await this.commitHostBackingRemoval(
			records,
			lifecycleOperation,
			requestDigest,
		);
	}

	/**
	 * Quiesces the Host, releases every materialized backing, persists package residency,
	 * and only then disposes connections and runtime subscriptions.
	 */
	async close(request: IAgentHostShutdownRequest): Promise<void> {
		if (this.closing) {
			throw new Error('Agent Host close is already running');
		}
		this.closing = true;
		const agentIds = Object.freeze([...this.agents.keys()]);
		const packageOperation = createAgentPackageOperationId(`shutdown-${createHash('sha256').update(request.operation).digest('hex')}`);
		let mutation: IAgentPackageMutation | undefined;
		try {
			mutation = await this.acquirePackageMutation(packageOperation, request.payloadDigest, agentIds);
			await this.cancelTurnsForShutdown(request);
			await mutation.drain();
			const packageSnapshot = this.options.packageLifecycle.snapshot();
			const materializedKeys = new Set(packageSnapshot.materializedBackings.map(identity => this.backingIdentityKey(identity)));
			const records = Object.freeze(packageSnapshot.retainedBackingRecords.filter(record => (
				materializedKeys.has(this.backingIdentityKey(record.identity))
			)));
			await mutation.checkpointAndRelease(records);
			await this.commitHostAndBackingState(
				this.sessions,
				Object.freeze([]),
				Object.freeze({ kind: 'operation', operation: request.operation, payloadDigest: request.payloadDigest }),
			);
			await mutation.complete();
			await this.catalogTail;
			this.dispose();
		} catch (error) {
			if (mutation !== undefined) {
				try {
					await mutation.rollback();
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], 'Agent Host close and backing rollback both failed');
				}
			}
			this.closing = false;
			throw error;
		}
	}

	private async cancelTurnsForShutdown(request: IAgentHostShutdownRequest): Promise<void> {
		for (const session of this.sessions.values()) {
			const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
			if (!agent.descriptor.get().capabilities.supportsCancellation) {
				continue;
			}
			for (const chat of session.chats.values()) {
				for (const turn of chat.state.turns) {
					if (!activeTurnStates.has(turn.state)) {
						continue;
					}
					const cancellation = Object.freeze({
						kind: 'shutdownCancelTurn',
						shutdownOperation: request.operation,
						shutdownDigest: request.payloadDigest,
						session: session.state.id,
						chat: chat.state.id,
						turn: turn.id,
					});
					await agent.chats.cancel({
						operation: createAgentHostOperationId(`shutdown-turn-${createHash('sha256').update(encodeAgentHostProtocolValue(cancellation)).digest('hex')}`),
						payloadDigest: payloadDigest(cancellation),
						session: session.state.id,
						chat: chat.state.id,
						turn: turn.id,
					});
				}
			}
		}
	}

	initialize(connection: AgentHostClientConnectionId, request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		this.assertConnectionIdentity(connection, request.connection);
		const state = this.requireConnectionState(connection);
		if (state.initialized) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host logical connection is already initialized',
				{ field: 'connection', value: connection },
			));
		}
		this.assertDistinctChannels(request.subscriptions);
		const protocolVersion = selectAgentHostProtocolVersion(request.protocolVersions, this.options.supportedProtocolVersions);
		const subscribed = this.createSnapshots(request.subscriptions);
		state.initialized = true;
		this.replaceSubscriptions(state.subscriptions, request.subscriptions, subscribed.missingChannels);
		return Promise.resolve(Object.freeze({
			protocolVersion,
			capabilities: Object.freeze([...this.options.capabilities]),
			implementation: Object.freeze({ ...this.options.implementation }),
			hostSequence: this.catalog.hostSequence,
			snapshots: subscribed.snapshots,
			missingChannels: subscribed.missingChannels,
		}));
	}

	setSubscriptions(
		connection: AgentHostClientConnectionId,
		request: IAgentHostSetSubscriptionsRequest,
	): Promise<IAgentHostSetSubscriptionsResult> {
		const state = this.requireInitializedConnection(connection);
		this.assertDistinctChannels(request.subscriptions);
		const subscribed = this.createSnapshots(request.subscriptions);
		this.replaceSubscriptions(state.subscriptions, request.subscriptions, subscribed.missingChannels);
		return Promise.resolve(Object.freeze({
			hostSequence: this.catalog.hostSequence,
			snapshots: subscribed.snapshots,
			missingChannels: subscribed.missingChannels,
		}));
	}

	async resolveSessionConfiguration(
		connection: AgentHostClientConnectionId,
		request: IAgentHostResolveSessionConfigurationRequest,
	): Promise<IAgentHostResolveSessionConfigurationResult> {
		this.requireInitializedConnection(connection);
		const sessionType = this.requireSessionType(request.sessionType);
		this.validateWorkspace(sessionType, request.workspace);
		const agent = this.requireActiveAgent(sessionType.agentId, sessionType.packageId);
		const configuration = await this.resolveSessionConfigurationState(agent, request.workspace, request.candidate);
		return Object.freeze({
			agent: agent.id,
			runtimeRegistration: agent.registration.revision,
			configuration,
		});
	}

	async completeSessionConfiguration(
		connection: AgentHostClientConnectionId,
		request: IAgentHostSessionConfigurationCompletionsRequest,
	): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		this.requireInitializedConnection(connection);
		if (
			request.query.length > 4_096
			|| !Number.isSafeInteger(request.limit)
			|| request.limit < 1
			|| request.limit > 100
		) {
			throw operationFailure('invalidPayload', 'Session configuration completion request exceeds protocol bounds');
		}
		const sessionType = this.requireSessionType(request.sessionType);
		this.validateWorkspace(sessionType, request.workspace);
		const agent = this.requireActiveAgent(sessionType.agentId, sessionType.packageId);
		const resolved = await this.resolveSessionConfigurationState(agent, request.workspace, request.candidate);
		const requestedSchema = validateAndFreezeAgentConfigurationSchema(request.resolvedSchema, {
			agent: agent.id,
			scope: 'session',
			revision: request.candidate.schema,
		});
		if (!sameProtocolValue(resolved.schema, requestedSchema)) {
			throw operationFailure('conflict', 'Session configuration schema changed before completion');
		}
		const candidate = validateAndFreezeAgentConfigurationCandidate(
			requestedSchema,
			request.candidate,
			'session',
		);
		const completions = validateAndFreezeAgentConfigurationCompletions(
			requestedSchema,
			request.property,
			await agent.configuration.completeSession({
				runtimeRegistration: agent.registration.revision,
				...(request.workspace === undefined ? {} : { workspace: request.workspace }),
				hostDefaults: this.requireAgentDefaults(agent),
				candidate,
				resolvedSchema: requestedSchema,
				property: request.property,
				query: request.query,
				limit: request.limit,
			}),
		);
		return Object.freeze({
			agent: agent.id,
			runtimeRegistration: agent.registration.revision,
			schema: requestedSchema.revision,
			completions,
		});
	}

	updateRootConfiguration(update: IAgentHostRootConfigurationUpdate): Promise<void> {
		return this.enqueueCatalogMutation(async () => {
			if (this.closing) {
				throw new Error('Agent Host is closing');
			}
			const descriptors = new Map([...this.agents].map(([agentId, agent]) => [agentId, agent.descriptor.get()]));
			const updatedAgents = new Set<AgentId>();
			for (const descriptorUpdate of update.agents) {
				const activeAgent = this.agents.get(descriptorUpdate.agent.id);
				if (activeAgent !== descriptorUpdate.agent || updatedAgents.has(descriptorUpdate.agent.id)) {
					throw new Error(`Agent Host root update does not address one exact active Agent '${descriptorUpdate.agent.id}'`);
				}
				updatedAgents.add(descriptorUpdate.agent.id);
				descriptors.set(descriptorUpdate.agent.id, descriptorUpdate.descriptor);
			}
			const sessionTypes = this.resolveSessionTypeCatalog(descriptors);
			const modelConfigurationSchemas = this.validateRootConfiguration(
				descriptors,
				Object.freeze([...sessionTypes.values()]),
			);
			this.validateRetainedSessionTypes(this.sessions, sessionTypes);
			const state = this.createRootState(descriptors, sessionTypes);
			await this.commitHostState(
				this.sessions,
				[this.rootAction(state)],
				Object.freeze({ kind: 'host' }),
				() => {
					this.modelConfigurationSchemas = modelConfigurationSchemas;
					for (const descriptorUpdate of update.agents) {
						descriptorUpdate.commit();
					}
					this.replaceSessionTypes(sessionTypes);
				},
			);
		});
	}

	reconnect(connection: AgentHostClientConnectionId, request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		this.assertConnectionIdentity(connection, request.connection);
		const state = this.requireInitializedConnection(connection);
		this.assertDistinctChannels(request.subscriptions);
		if (!this.sameChannelSet(state.subscriptions, request.subscriptions)) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host reconnect changed the logical subscription set',
				{ field: 'subscriptions', value: request.subscriptions.length },
			));
		}
		if (request.lastHostSequence > this.catalog.hostSequence) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host reconnect sequence exceeds Host state',
				{ field: 'lastHostSequence', value: request.lastHostSequence },
			));
		}
		const oldestSequence = this.replay[0]?.hostSequence;
		if (
			request.lastHostSequence === this.catalog.hostSequence
			|| (oldestSequence !== undefined && request.lastHostSequence >= oldestSequence - 1)
		) {
			const missingChannels = this.findMissingChannels(request.subscriptions);
			const missing = new Set(missingChannels.map(item => item.channel));
			this.replaceSubscriptions(state.subscriptions, request.subscriptions, missingChannels);
			return Promise.resolve(Object.freeze({
				kind: 'replay',
				fromHostSequence: request.lastHostSequence,
				throughHostSequence: this.catalog.hostSequence,
				actions: Object.freeze(this.replay.filter(action => (
					action.hostSequence > request.lastHostSequence
					&& state.subscriptions.has(action.channel)
					&& !missing.has(action.channel)
				))),
				missingChannels,
			}));
		}
		const snapshots = this.createSnapshots(request.subscriptions);
		this.replaceSubscriptions(state.subscriptions, request.subscriptions, snapshots.missingChannels);
		return Promise.resolve(Object.freeze({
			kind: 'snapshots',
			hostSequence: this.catalog.hostSequence,
			snapshots: snapshots.snapshots,
			missingChannels: snapshots.missingChannels,
		}));
	}

	async prepareSubmission(
		connection: AgentHostClientConnectionId,
		request: IAgentHostPrepareSubmissionRequest,
	): Promise<AgentHostPrepareSubmissionResult> {
		this.requireInitializedConnection(connection);
		if (this.closing) {
			return Object.freeze({
				kind: 'rejected',
				failure: Object.freeze({ code: 'agentUnavailable', message: 'Agent Host is closing', reconciliation: 'terminal' }),
			});
		}
		const requestDigest = payloadDigest(request);
		const existing = this.preparations.get(request.submission);
		if (existing !== undefined) {
			if (existing.connection !== connection || existing.requestDigest !== requestDigest) {
				return Object.freeze({
					kind: 'rejected',
					failure: Object.freeze({
						code: 'conflict',
						message: 'Submission ID is already bound to another preparation',
						reconciliation: 'terminal',
					}),
				});
			}
			return existing.result ?? existing.promise;
		}
		let record: IPreparedSubmissionRecord;
		const promise = this.executePreparation(connection, request).then(result => {
			record.result = result;
			return result;
		});
		record = {
			connection,
			requestDigest,
			target: request.target,
			accepted: false,
			promise,
		};
		this.preparations.set(request.submission, record);
		return promise;
	}

	async mutate(connection: AgentHostClientConnectionId, request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		this.requireInitializedConnection(connection);
		if (this.closing) {
			return Object.freeze({
				kind: 'failed',
				failure: Object.freeze({ code: 'agentUnavailable', message: 'Agent Host is closing', reconciliation: 'terminal' }),
			});
		}
		const computedDigest = await computeAgentHostMutationDigest(request.payload);
		if (computedDigest !== request.digest) {
			return Object.freeze({
				kind: 'failed',
				failure: Object.freeze({
					code: 'invalidPayload',
					message: 'Mutation digest does not match its payload',
					reconciliation: 'terminal',
				}),
			});
		}
		const owner = this.operationOwners.get(request.operation);
		if (owner !== undefined && owner !== connection) {
			return Object.freeze({ kind: 'unknown' });
		}
		let start: ReturnType<typeof this.operations.begin>;
		try {
			start = this.operations.begin(request.operation, request.digest);
		} catch (error) {
			if (error instanceof AgentHostError && error.code === AgentHostErrorCode.OperationDigestConflict) {
				return Object.freeze({ kind: 'conflict', recordedDigest: error.data.recordedDigest as AgentHostPayloadDigest });
			}
			throw error;
		}
		if (start.kind === 'pending') {
			return Object.freeze({ kind: 'pending' });
		}
		if (start.kind === 'committed') {
			return start.outcome;
		}
		this.operationOwners.set(request.operation, connection);
		return this.enqueueCatalogMutation(async () => {
			let outcome: AgentHostMutationOutcome;
			let afterCommit: readonly (() => void)[] = [];
			let commitOutcome = true;
			try {
				const execution = await this.executeMutation(connection, request);
				outcome = Object.freeze({ kind: 'succeeded', result: execution.result });
				afterCommit = execution.afterCommit;
			} catch (error) {
				if (error instanceof PendingSessionConfigurationFinalization) {
					outcome = Object.freeze({ kind: 'pending' });
					commitOutcome = false;
				} else {
				outcome = Object.freeze({ kind: 'failed', failure: toOperationFailure(error) });
				}
			}
			if (commitOutcome) {
				this.operations.commit(request.operation, request.digest, outcome);
			}
			for (const startAfterCommit of afterCommit) {
				startAfterCommit();
			}
			return outcome;
		});
	}

	async getOperationOutcome(
		connection: AgentHostClientConnectionId,
		request: IAgentHostOperationOutcomeRequest,
	): Promise<AgentHostMutationOutcome> {
		this.requireInitializedConnection(connection);
		const owner = this.operationOwners.get(request.operation);
		if (owner !== undefined && owner !== connection) {
			return Object.freeze({ kind: 'unknown' });
		}
		const pendingConfiguration = this.pendingSessionConfigurationFinalizations.get(request.operation);
		if (pendingConfiguration !== undefined) {
			if (pendingConfiguration.request.payloadDigest !== request.digest) {
				return Object.freeze({ kind: 'conflict', recordedDigest: pendingConfiguration.request.payloadDigest });
			}
			return this.enqueueCatalogMutation(() => this.reconcileSessionConfigurationFinalization(request.operation, pendingConfiguration));
		}
		try {
			const outcome = this.operations.reconcile(request.operation, request.digest);
			if (outcome.kind === 'committed') {
				return outcome.outcome;
			}
			return Object.freeze({ kind: outcome.kind });
		} catch (error) {
			if (error instanceof AgentHostError && error.code === AgentHostErrorCode.OperationDigestConflict) {
				return Object.freeze({ kind: 'conflict', recordedDigest: error.data.recordedDigest as AgentHostPayloadDigest });
			}
			throw error;
		}
	}

	async executePackageOperation(
		connection: AgentHostClientConnectionId,
		request: IAgentPackageOperationRequest,
	): Promise<AgentPackageOperationOutcome> {
		this.requireInitializedConnection(connection);
		if (this.closing) {
			return this.packageOperationFailure(
				new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Agent Host is closing'),
			);
		}
		const owner = this.packageOperationOwners.get(request.operation);
		if (owner !== undefined && owner !== connection) {
			return Object.freeze({ kind: 'unknown' });
		}
		const computedDigest = await computeAgentPackageOperationDigest(
			request.expectedCatalogRevision,
			request.payload,
		);
		if (computedDigest !== request.digest) {
			return Object.freeze({
				kind: 'failed',
				failure: Object.freeze({
					code: 'invalidPayload',
					message: 'Agent package operation digest does not match its payload',
					reconciliation: 'terminal',
				}),
			});
		}
		this.packageOperationOwners.set(request.operation, connection);
		try {
			const result = await this.options.packageLifecycle.execute(request);
			return Object.freeze({ kind: 'succeeded', result });
		} catch (error) {
			const outcome = this.options.packageLifecycle.getOperationOutcome({
				operation: request.operation,
				digest: request.digest,
			});
			if (outcome.kind !== 'pending') {
				return outcome;
			}
			return outcome;
		}
	}

	getPackageOperationOutcome(
		connection: AgentHostClientConnectionId,
		request: IAgentPackageOperationOutcomeRequest,
	): Promise<AgentPackageOperationOutcome> {
		this.requireInitializedConnection(connection);
		const owner = this.packageOperationOwners.get(request.operation);
		if (owner !== undefined && owner !== connection) {
			return Promise.resolve(Object.freeze({ kind: 'unknown' }));
		}
		return Promise.resolve(this.options.packageLifecycle.getOperationOutcome(request));
	}

	private packageOperationFailure(error: unknown): AgentPackageOperationOutcome {
		const failure = error instanceof Error ? error : new Error(String(error));
		if (failure instanceof AgentPackageError && failure.code === AgentPackageErrorCode.OperationConflict) {
			const recordedDigest = failure.data.expected;
			if (typeof recordedDigest === 'string') {
				return Object.freeze({ kind: 'conflict', recordedDigest: createAgentHostPayloadDigest(recordedDigest) });
			}
		}
		return Object.freeze({
			kind: 'failed',
			failure: Object.freeze({
				code: failure instanceof AgentPackageError ? failure.code : 'internal',
				message: failure.message.slice(0, 2_048),
				...(failure instanceof AgentPackageError ? { data: Object.freeze({ ...failure.data }) } : {}),
				reconciliation: 'terminal',
			}),
		});
	}

	receiveAction(connection: AgentHostClientConnectionId, action: AgentHostChannelAction): void {
		const state = this.connectionStates.get(connection);
		if (state?.initialized && state.subscriptions.has(action.channel)) {
			this.connections.get(connection)?.fireAction(action);
		}
	}

	removeConnection(connection: AgentHostClientConnectionId): void {
		this.connections.delete(connection);
		this.connectionStates.delete(connection);
	}

	private validateComposition(): void {
		if (new Set(this.options.supportedProtocolVersions).size !== this.options.supportedProtocolVersions.length) {
			throw new Error('Agent Host protocol versions contain duplicates');
		}
		assertDisplayText(this.options.label, 'label');
		const active = this.options.packageLifecycle.snapshot().activeRegistrations;
		if (new Set(active.map(registration => registration.agentId)).size !== active.length) {
			throw new Error('Activated Agent registrations contain duplicate Agent IDs');
		}
		for (const registration of active) {
			const agent = this.resolveAgentRuntime(registration);
			this.agents.set(agent.id, agent);
		}
		this.agentDefaults = this.reconcileAgentDefaults(this.agentDefaults);
		const descriptors = new Map(
			[...this.agents].map(([agentId, agent]) => [agentId, agent.descriptor.get()]),
		);
		const sessionTypes = this.resolveSessionTypeCatalog(descriptors);
		this.modelConfigurationSchemas = this.validateRootConfiguration(
			descriptors,
			Object.freeze([...sessionTypes.values()]),
		);
		this.validateRetainedSessionTypes(this.sessions, sessionTypes);
		this.replaceSessionTypes(sessionTypes);
	}

	private resolveSessionTypeCatalog(
		descriptors: ReadonlyMap<AgentId, IAgentDescriptor>,
	): Map<string, IAgentHostSessionTypeDescriptor> {
		const activeAgents = Object.freeze([...this.agents].map(([agentId, agent]) => {
			const descriptor = descriptors.get(agentId);
			if (descriptor === undefined) {
				throw new Error(`Agent Host Session type catalog has no descriptor for active Agent '${agentId}'`);
			}
			return Object.freeze({ registration: agent.registration, descriptor });
		}));
		const resolved = this.options.sessionTypeCatalog.resolve(activeAgents);
		const typeIds = new Set(resolved.map(sessionType => sessionType.id));
		if (typeIds.size !== resolved.length) {
			throw new Error('Agent Host Session type catalog resolved duplicate type IDs');
		}
		return new Map(resolved.map(sessionType => (
			[sessionType.id, sessionType] as const
		)));
	}

	private replaceSessionTypes(sessionTypes: ReadonlyMap<string, IAgentHostSessionTypeDescriptor>): void {
		this.sessionTypes.clear();
		for (const [sessionTypeId, sessionType] of sessionTypes) {
			this.sessionTypes.set(sessionTypeId, sessionType);
		}
	}

	private validateRetainedSessionTypes(
		sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>,
		sessionTypes: ReadonlyMap<string, IAgentHostSessionTypeDescriptor>,
	): void {
		for (const session of sessions.values()) {
			if (session.state.lifecycle === 'unavailable') {
				continue;
			}
			const sessionType = sessionTypes.get(session.state.type);
			if (
				sessionType === undefined
				|| sessionType.packageId !== session.state.packageId
				|| sessionType.agentId !== session.state.agentId
			) {
				throw new Error(`Agent Host root configuration has no exact Session type '${session.state.type}' for retained Session '${session.state.id}'`);
			}
		}
	}

	private validateRootConfiguration(
		descriptors: ReadonlyMap<AgentId, IAgentDescriptor>,
		sessionTypes: readonly IAgentHostSessionTypeDescriptor[],
	): AgentConfigurationSchemaRegistry {
		const modelConfigurationSchemas = cloneConfigurationSchemaRegistry(this.modelConfigurationSchemas);
		if (descriptors.size !== this.agents.size) {
			throw new Error('Agent Host root configuration does not describe every active Agent');
		}
		for (const [agentId, agent] of this.agents) {
			const descriptor = descriptors.get(agentId);
			if (
				descriptor === undefined
				|| descriptor.id !== agent.id
				|| descriptor.packageId !== agent.registration.packageId
				|| descriptor.revision !== agent.registration.descriptorRevision
				|| descriptor.capabilities.revision !== agent.registration.capabilityRevision
			) {
				throw new Error(`Agent Host root descriptor '${agentId}' has invalid ownership`);
			}
			for (const model of descriptor.models) {
				const schema = validateAndFreezeAgentConfigurationSchema(model.configurationSchema, {
					agent: agentId,
					scope: 'model',
					revision: model.configurationSchema.revision,
				});
				recordExactConfigurationSchema(modelConfigurationSchemas, schema, `Agent '${agentId}' model '${model.id}'`);
			}
		}
		const typeIds = new Set<string>();
		for (const sessionType of sessionTypes) {
			if (typeIds.has(sessionType.id)) {
				throw new Error(`Duplicate Agent Host Session type '${sessionType.id}'`);
			}
			typeIds.add(sessionType.id);
			const agent = this.agents.get(sessionType.agentId);
			if (!agent || agent.registration.packageId !== sessionType.packageId) {
				throw new Error(`Agent Host Session type '${sessionType.id}' has no exact Agent registration`);
			}
			assertDisplayText(sessionType.displayName, `sessionTypes.${sessionType.id}.displayName`);
			assertDisplayText(sessionType.description, `sessionTypes.${sessionType.id}.description`);
			if (
				!['required', 'optional', 'unsupported'].includes(sessionType.capabilities.workspace)
				|| (sessionType.capabilities.maximumChatCount !== undefined && (
					!Number.isSafeInteger(sessionType.capabilities.maximumChatCount)
					|| sessionType.capabilities.maximumChatCount < 0
				))
			) {
				throw new Error(`Agent Host Session type '${sessionType.id}' capabilities are invalid`);
			}
			const descriptor = descriptors.get(sessionType.agentId)!;
			const models = new Set(sessionType.models);
			if (
				models.size !== sessionType.models.length
				|| sessionType.models.some(model => !descriptor.models.some(candidate => candidate.id === model))
			) {
				throw new Error(`Agent Host Session type '${sessionType.id}' model catalog is invalid`);
			}
			const presets = new Set<string>();
			for (const preset of sessionType.executionPresets) {
				assertDisplayText(preset.displayName, `sessionTypes.${sessionType.id}.executionPresets.${preset.id}.displayName`);
				if (presets.has(preset.id) || !models.has(preset.model)) {
					throw new Error(`Agent Host Session type '${sessionType.id}' execution preset catalog is invalid`);
				}
				presets.add(preset.id);
			}
			if (sessionType.automaticExecutionPreset !== null && !presets.has(sessionType.automaticExecutionPreset)) {
				throw new Error(`Agent Host Session type '${sessionType.id}' automatic execution preset is invalid`);
			}
		}
		return modelConfigurationSchemas;
	}

	private resolveAgentRuntime(registration: IAgentRuntimeRegistration): IAgent {
		this.validateRuntimeRegistrationConfiguration(registration);
		const agent = this.options.agentRuntimes.resolve(registration);
		if (agent.id !== registration.agentId || !sameProtocolValue(agent.registration, registration)) {
			throw new Error(`Resolved Agent runtime '${registration.agentId}' does not match its exact registration`);
		}
		const descriptor = agent.descriptor.get();
		if (
			descriptor.id !== agent.id
			|| descriptor.packageId !== registration.packageId
			|| descriptor.revision !== registration.descriptorRevision
			|| descriptor.capabilities.revision !== registration.capabilityRevision
		) {
			throw new Error(`Resolved Agent runtime '${registration.agentId}' descriptor ownership is invalid`);
		}
		return agent;
	}

	private validateRuntimeRegistrationConfiguration(registration: IAgentRuntimeRegistration): void {
		validateAndFreezeAgentConfigurationSchema(registration.hostDefaultsSchema, {
			agent: registration.agentId,
			scope: 'hostDefault',
			revision: registration.hostDefaultsSchema.revision,
		});
		createAgentConfigurationSchemaRevision(registration.initialSessionConfigurationSchema);
		for (const revision of registration.supportedSessionConfigurationSchemas) {
			createAgentConfigurationSchemaRevision(revision);
		}
		if (
			registration.supportedSessionConfigurationSchemas.length === 0
			|| new Set(registration.supportedSessionConfigurationSchemas).size !== registration.supportedSessionConfigurationSchemas.length
			|| !registration.supportedSessionConfigurationSchemas.includes(registration.initialSessionConfigurationSchema)
		) {
			throw new Error(`Agent runtime '${registration.agentId}' Session configuration schemas are invalid`);
		}
	}

	private requireAgentDefaults(agent: IAgent): IAgentConfigurationState {
		const state = this.agentDefaults.get(agent.id);
		if (state === undefined) {
			throw new Error(`Agent Host catalog has no Agent-default configuration for '${agent.id}'`);
		}
		const schema = validateAndFreezeAgentConfigurationSchema(agent.registration.hostDefaultsSchema, {
			agent: agent.id,
			scope: 'hostDefault',
		});
		const configuration = validateAndFreezeAgentConfigurationState(state, {
			agent: agent.id,
			scope: 'hostDefault',
			revision: schema.revision,
		});
		if (!sameProtocolValue(configuration.schema, schema)) {
			throw new Error(`Agent Host catalog Agent-default schema for '${agent.id}' does not match its exact runtime registration`);
		}
		return configuration;
	}

	private subscribeAgentActions(agent: IAgent): void {
		if (this.agentActionSubscriptions.has(agent.id)) {
			throw new Error(`Agent runtime '${agent.id}' already has an action subscription`);
		}
		this.agentActionSubscriptions.set(agent.id, agent.onDidEmitAction(action => {
			void this.enqueueCatalogMutation(async () => {
				try {
					await this.applyAgentAction(agent, action);
				} catch (error) {
					const reported = error instanceof Error ? error : new Error(String(error));
					this._onDidRejectAgentAction.fire(reported);
				}
			});
		}));
	}

	private activateAgentRuntimes(affected: ReadonlySet<AgentId>, staged: ReadonlyMap<AgentId, IAgent>): void {
		for (const agentId of affected) {
			this.agentActionSubscriptions.get(agentId)?.dispose();
			this.agentActionSubscriptions.delete(agentId);
			this.agents.delete(agentId);
		}
		for (const [agentId, agent] of staged) {
			if (!affected.has(agentId)) {
				throw new Error(`Staged Agent runtime '${agentId}' is outside the package mutation gate`);
			}
			this.agents.set(agentId, agent);
			this.subscribeAgentActions(agent);
		}
		this.agentDefaults = this.reconcileAgentDefaults(this.agentDefaults);
	}

	private reconcileAgentDefaults(
		current: ReadonlyMap<AgentId, IAgentConfigurationState>,
	): Map<AgentId, IAgentConfigurationState> {
		const reconciled = new Map<AgentId, IAgentConfigurationState>();
		for (const agent of this.agents.values()) {
			const existing = current.get(agent.id);
			if (existing === undefined) {
				const schema = validateAndFreezeAgentConfigurationSchema(agent.registration.hostDefaultsSchema, {
					agent: agent.id,
					scope: 'hostDefault',
				});
				reconciled.set(agent.id, createConfigurationState(schema, Object.freeze({})));
				continue;
			}
			const schema = validateAndFreezeAgentConfigurationSchema(agent.registration.hostDefaultsSchema, {
				agent: agent.id,
				scope: 'hostDefault',
			});
			const configuration = validateAndFreezeAgentConfigurationState(existing, {
				agent: agent.id,
				scope: 'hostDefault',
				revision: schema.revision,
			});
			if (!sameProtocolValue(configuration.schema, schema)) {
				throw new Error(`Agent Host catalog Agent-default schema for '${agent.id}' does not match its exact runtime registration`);
			}
			reconciled.set(agent.id, configuration);
		}
		return reconciled;
	}

	private async reconcilePackageSessionAvailability(
		affected: ReadonlySet<AgentId>,
		sessionTypes: ReadonlyMap<string, IAgentHostSessionTypeDescriptor>,
	): Promise<{
		readonly sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>;
		readonly actions: readonly HostStateAction[];
	}> {
		const sessions = new Map(this.sessions);
		const changed: IRuntimeSessionRecord[] = [];
		for (const [sessionId, session] of this.sessions) {
			if (!affected.has(session.state.agentId)) {
				continue;
			}
			if (session.materialized || [...session.chats.values()].some(chat => chat.materialized)) {
				throw new Error(`Package mutation did not release retained Session '${sessionId}'`);
			}
			const activeAgent = this.agents.get(session.state.agentId);
			const lifecycle = activeAgent?.registration.packageId === session.state.packageId
				? 'released' as const
				: 'unavailable' as const;
			if (lifecycle === 'released') {
				if (activeAgent === undefined) {
					throw new Error(`Activated Agent '${session.state.agentId}' is absent during retained Session reconciliation`);
				}
				const sessionType = sessionTypes.get(session.state.type);
				if (
					sessionType === undefined
					|| sessionType.packageId !== session.state.packageId
					|| sessionType.agentId !== session.state.agentId
				) {
					throw new Error(`Activated Agent '${session.state.agentId}' has no exact retained Session type '${session.state.type}'`);
				}
				await this.requireRuntimeExactSessionConfiguration(
					activeAgent,
					session.state.workspace,
					session.state.configuration,
				);
				for (const chat of session.chats.values()) {
					this.validateChatModel(sessionType, activeAgent, chat.state.model);
				}
			}
			const stateChanged = session.state.lifecycle !== lifecycle
				|| [...session.chats.values()].some(chat => chat.state.lifecycle !== lifecycle);
			if (!stateChanged) {
				continue;
			}
			const now = this.checkedNow();
			const chats = new Map<AgentChatId, IRuntimeChatRecord>();
			for (const [chatId, chat] of session.chats) {
				const chatStateChanged = chat.state.lifecycle !== lifecycle;
				chats.set(chatId, Object.freeze({
					...chat,
					materialized: false,
					state: chatStateChanged
						? freezeChatState({ ...chat.state, lifecycle, modifiedAt: now })
						: chat.state,
				}));
			}
			const state = Object.freeze({
				...session.state,
				lifecycle,
				modifiedAt: now,
				chats: Object.freeze([...chats.values()].map(chat => chatSummary(chat.state))),
			});
			const updated = Object.freeze({ ...session, state, materialized: false, chats });
			sessions.set(sessionId, updated);
			changed.push(updated);
		}
		this.validateRetainedSessionTypes(sessions, sessionTypes);
		if (changed.length === 0) {
			return Object.freeze({ sessions, actions: Object.freeze([]) });
		}
		const actions: HostStateAction[] = [this.sessionsAction(sessions)];
		for (const session of changed) {
			actions.push(this.sessionAction(session.state));
			for (const chat of session.chats.values()) {
				actions.push(this.chatAction(chat.state));
			}
		}
		return Object.freeze({ sessions, actions: Object.freeze(actions) });
	}

	private loadCatalog(catalog: IAgentHostPersistedCatalog): void {
		this.agentDefaults = new Map(catalog.agentDefaults.map(state => [state.schema.agent, state]));
		const sessions = new Map<AgentSessionId, IRuntimeSessionRecord>();
		for (const record of catalog.sessions) {
			const configuration = validateAndFreezeAgentConfigurationState(record.state.configuration, {
				agent: record.state.agentId,
				scope: 'session',
			});
			recordExactConfigurationSchema(
				this.sessionConfigurationSchemas,
				configuration.schema,
				`Persisted Session '${record.state.id}'`,
			);
			sessions.set(record.state.id, {
				state: record.state,
				resume: record.resume,
				materialized: false,
				chats: new Map(record.chats.map(chat => [chat.state.id, { ...chat, materialized: false }])),
			});
		}
		this.sessions = sessions;
	}

	private restoreSessionConfigurationFinalizationLedger(): void {
		for (const record of this.catalog.sessionConfigurationFinalizations) {
			this.operationOwners.set(record.operation, record.connection);
			const started = this.operations.begin(record.operation, record.digest);
			if (started.kind !== 'execute') {
				throw new Error(`Duplicate Agent Host Session configuration operation '${record.operation}'`);
			}
			if (record.status === 'acknowledged') {
				this.operations.commit(record.operation, record.digest, record.outcome);
				continue;
			}
			const session = this.requireSession(record.session);
			const agent = this.requireActiveAgent(record.agentId, record.packageId);
			if (
				session.state.agentId !== record.agentId
				|| session.state.packageId !== record.packageId
				|| agent.registration.revision !== record.runtimeRegistration
			) {
				throw new Error(`Persisted Session configuration operation '${record.operation}' has no exact active runtime`);
			}
			const base = {
				connection: record.connection,
				request: Object.freeze({
					operation: record.operation,
					payloadDigest: record.digest,
					runtimeRegistration: record.runtimeRegistration,
					session: record.session,
					configuration: record.configuration,
				}),
				decision: record.decision,
				outcome: record.outcome,
			} as const;
			let pending: IPendingSessionConfigurationFinalization;
			if (record.status === 'intent') {
				pending = Object.freeze({ ...base, finalize: 'complete' });
			} else if (record.status === 'completed') {
				pending = Object.freeze({ ...base, agent, finalize: 'acknowledge' });
			} else if (record.decision === 'commit') {
				pending = Object.freeze({ ...base, agent, decision: 'commit', finalize: 'commit' });
			} else {
				pending = Object.freeze({ ...base, agent, decision: 'rollback', finalize: 'rollback' });
			}
			this.pendingSessionConfigurationFinalizations.set(record.operation, pending);
		}
	}

	private async completeRestoredSessionConfigurationFinalizations(): Promise<void> {
		for (const [operation, pending] of [...this.pendingSessionConfigurationFinalizations]) {
			const restored = pending.finalize === 'acknowledge'
				? pending
				: Object.freeze({
					connection: pending.connection,
					request: pending.request,
					decision: pending.decision,
					outcome: pending.outcome,
					finalize: 'complete' as const,
				});
			const outcome = await this.reconcileSessionConfigurationFinalization(operation, restored);
			if (outcome.kind === 'pending') {
				throw new Error(`Session configuration operation '${operation}' could not persist cold recovery`);
			}
		}
	}

	private requireConnectionState(connection: AgentHostClientConnectionId): IAgentHostConnectionState {
		const state = this.connectionStates.get(connection);
		if (state === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.ResourceMissing,
				'Agent Host logical connection does not exist',
				{ resource: connection },
			);
		}
		return state;
	}

	private requireInitializedConnection(connection: AgentHostClientConnectionId): IAgentHostConnectionState {
		const state = this.requireConnectionState(connection);
		if (!state.initialized) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host logical connection is not initialized',
				{ field: 'connection', value: connection },
			);
		}
		return state;
	}

	private assertConnectionIdentity(actual: AgentHostClientConnectionId, requested: AgentHostClientConnectionId): void {
		if (actual !== requested) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host request addresses another logical connection',
				{ field: 'connection', value: requested },
			);
		}
	}

	private assertDistinctChannels(channels: readonly AgentHostChannelId[]): void {
		if (new Set(channels).size !== channels.length) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host channel list contains duplicates',
				{ field: 'channels', value: channels.length },
			);
		}
	}

	private sameChannelSet(actual: ReadonlySet<AgentHostChannelId>, requested: readonly AgentHostChannelId[]): boolean {
		return actual.size === requested.length && requested.every(channel => actual.has(channel));
	}

	private replaceSubscriptions(
		active: Set<AgentHostChannelId>,
		requested: readonly AgentHostChannelId[],
		missingChannels: readonly IAgentHostMissingChannel[],
	): void {
		const missing = new Set(missingChannels.map(item => item.channel));
		active.clear();
		for (const channel of requested) {
			if (!missing.has(channel)) {
				active.add(channel);
			}
		}
	}

	private createRootState(
		descriptors: ReadonlyMap<AgentId, IAgentDescriptor> = new Map(
			[...this.agents].map(([agentId, agent]) => [agentId, agent.descriptor.get()]),
		),
		sessionTypes: ReadonlyMap<string, IAgentHostSessionTypeDescriptor> = this.sessionTypes,
		agentDefaults: ReadonlyMap<AgentId, IAgentConfigurationState> = this.agentDefaults,
	): IAgentHostRootState {
		return Object.freeze({
			authority: this.options.authority,
			label: this.options.label,
			capabilities: Object.freeze({
				supportsCreateSession: sessionTypes.size !== 0,
				supportsPackageOperations: true,
				supportsAgentAuthentication: this.options.authentication !== undefined,
			}),
			packages: this.createPackageCatalogState(),
			agents: Object.freeze([...descriptors.values()]),
			agentRegistrations: Object.freeze([...this.agents.values()].map(agent => agent.registration)),
			agentDefaults: Object.freeze([...agentDefaults.values()]),
			sessionTypes: Object.freeze([...sessionTypes.values()]),
		});
	}

	private createPackageCatalogState(): IAgentHostPackageCatalogState {
		const snapshot = this.options.packageLifecycle.snapshot();
		const authentication = this.options.authentication;
		return Object.freeze({
			revision: snapshot.catalogRevision,
			installablePackages: Object.freeze([...snapshot.installablePackages]),
			installedPackages: Object.freeze([...snapshot.installedPackages]),
			activations: Object.freeze(snapshot.activeRegistrations.map(registration => Object.freeze({
				packageId: registration.packageId,
				agentId: registration.agentId,
				registration: registration.revision,
				authentication: authentication === undefined
					? 'unavailable'
					: authentication.getState(registration),
			}))),
			retainedBackingRecords: Object.freeze([...snapshot.retainedBackingRecords]),
			materializedBackings: Object.freeze([...snapshot.materializedBackings]),
		});
	}

	private async reconcilePackageCatalogRevision(): Promise<void> {
		const catalogRevision = this.options.packageLifecycle.snapshot().catalogRevision;
		if (this.catalog.packageCatalogRevision === catalogRevision) {
			return;
		}
		await this.enqueueCatalogMutation(() => this.commitHostState(
			this.sessions,
			Object.freeze([this.rootAction()]),
			Object.freeze({ kind: 'host' }),
		));
	}

	private createSessionCatalog(): IAgentHostSessionCatalogState {
		return Object.freeze({ sessions: Object.freeze([...this.sessions.values()].map(record => this.sessionSummary(record.state))) });
	}

	private sessionSummary(state: IAgentHostSessionState): IAgentHostSessionCatalogState['sessions'][number] {
		return Object.freeze({
			id: state.id,
			packageId: state.packageId,
			agentId: state.agentId,
			type: state.type,
			createdAt: state.createdAt,
			title: state.title,
			archived: state.archived,
			lifecycle: state.lifecycle,
			status: state.status,
			isRead: state.isRead,
			modifiedAt: state.modifiedAt,
		});
	}

	private createSnapshots(channels: readonly AgentHostChannelId[]): {
		readonly snapshots: readonly AgentHostChannelSnapshot[];
		readonly missingChannels: readonly IAgentHostMissingChannel[];
	} {
		const snapshots: AgentHostChannelSnapshot[] = [];
		const missingChannels: IAgentHostMissingChannel[] = [];
		for (const channel of channels) {
			const snapshot = this.createSnapshot(channel);
			if (snapshot === undefined) {
				missingChannels.push(Object.freeze({
					channel,
					reason: Object.hasOwn(this.catalog.channelRevisions, channel) ? 'deleted' : 'notFound',
				}));
			} else {
				snapshots.push(snapshot);
			}
		}
		return Object.freeze({
			snapshots: Object.freeze(snapshots),
			missingChannels: Object.freeze(missingChannels),
		});
	}

	private findMissingChannels(channels: readonly AgentHostChannelId[]): readonly IAgentHostMissingChannel[] {
		return this.createSnapshots(channels).missingChannels;
	}

	private createSnapshot(channel: AgentHostChannelId): AgentHostChannelSnapshot | undefined {
		const revision = this.catalog.channelRevisions[channel] ?? createAgentHostChannelRevision(0);
		if (channel === getAgentHostRootChannelId()) {
			return Object.freeze({ channel, kind: 'root', hostSequence: this.catalog.hostSequence, revision, state: this.createRootState() });
		}
		if (channel === getAgentHostSessionsChannelId()) {
			return Object.freeze({ channel, kind: 'sessions', hostSequence: this.catalog.hostSequence, revision, state: this.createSessionCatalog() });
		}
		for (const record of this.sessions.values()) {
			if (channel === getAgentHostSessionChannelId(record.state.id)) {
				return Object.freeze({ channel, kind: 'session', hostSequence: this.catalog.hostSequence, revision, state: record.state });
			}
			for (const chat of record.chats.values()) {
				if (channel === getAgentHostChatChannelId(record.state.id, chat.state.id)) {
					return Object.freeze({ channel, kind: 'chat', hostSequence: this.catalog.hostSequence, revision, state: chat.state });
				}
			}
		}
		return undefined;
	}

	private requireActiveAgent(agentId: AgentId, packageId?: string): IAgent {
		const agent = this.agents.get(agentId);
		if (agent === undefined || (packageId !== undefined && agent.registration.packageId !== packageId)) {
			throw operationFailure('agentUnavailable', `Agent '${agentId}' is unavailable`);
		}
		const active = this.options.packageLifecycle.snapshot().activeRegistrations.find(registration => (
			registration.agentId === agent.id
			&& registration.packageId === agent.registration.packageId
			&& registration.revision === agent.registration.revision
		));
		if (active === undefined) {
			throw operationFailure('agentUnavailable', `Agent '${agentId}' registration is not active`);
		}
		return agent;
	}

	private runtimeMutationAgent(payload: IAgentHostMutationRequest['payload']): AgentId | undefined {
		switch (payload.kind) {
			case 'renameSession':
			case 'renameChat':
			case 'setSessionArchived':
				return undefined;
			case 'createSession':
				return this.requireSessionType(payload.sessionType).agentId;
			case 'updateAgentDefaults':
				return payload.agent;
			case 'authenticateAgent':
				return payload.agentId;
			default:
				return this.requireSession(payload.session).state.agentId;
		}
	}

	private async runLifecycleActivity<TResult>(agentId: AgentId, execute: () => Promise<TResult>): Promise<TResult> {
		if (this.packageMutationGates.has(agentId)) {
			throw operationFailure('agentUnavailable', `Agent '${agentId}' is quiescing for a package mutation`);
		}
		this.lifecycleActivities.set(agentId, (this.lifecycleActivities.get(agentId) ?? 0) + 1);
		try {
			return await execute();
		} finally {
			const remaining = (this.lifecycleActivities.get(agentId) ?? 1) - 1;
			if (remaining === 0) {
				this.lifecycleActivities.delete(agentId);
			} else {
				this.lifecycleActivities.set(agentId, remaining);
			}
			this.notifyQuiescenceChanged();
		}
	}

	private async waitForQuiescence(agentIds: ReadonlySet<AgentId>): Promise<void> {
		while (!this.isQuiescent(agentIds)) {
			await new Promise<void>(resolve => this.quiescenceWaiters.add(resolve));
		}
	}

	private isQuiescent(agentIds: ReadonlySet<AgentId>): boolean {
		for (const agentId of agentIds) {
			if ((this.lifecycleActivities.get(agentId) ?? 0) !== 0) {
				return false;
			}
		}
		for (const session of this.sessions.values()) {
			if (
			agentIds.has(session.state.agentId)
				&& [...session.chats.values()].some(chat => chat.state.turns.some(turn => activeTurnStates.has(turn.state)))
			) {
				return false;
			}
			if (agentIds.has(session.state.agentId) && this.hasPendingSessionConfigurationFinalization(session.state.id)) {
				return false;
			}
		}
		return true;
	}

	private notifyQuiescenceChanged(): void {
		const waiters = [...this.quiescenceWaiters];
		this.quiescenceWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	}

	private hasPendingSessionConfigurationFinalization(session: AgentSessionId): boolean {
		return [...this.pendingSessionConfigurationFinalizations.values()].some(pending => pending.request.session === session);
	}

	private requireSession(session: AgentSessionId): IRuntimeSessionRecord {
		const record = this.sessions.get(session);
		if (record === undefined) {
			throw operationFailure('missingResource', `Session '${session}' does not exist`);
		}
		return record;
	}

	private requireChat(session: IRuntimeSessionRecord, chat: AgentChatId): IRuntimeChatRecord {
		const record = session.chats.get(chat);
		if (record === undefined) {
			throw operationFailure('missingResource', `Chat '${chat}' does not exist in Session '${session.state.id}'`);
		}
		return record;
	}

	private requireSessionType(id: string): IAgentHostSessionTypeDescriptor {
		const sessionType = this.sessionTypes.get(id);
		if (sessionType === undefined) {
			throw operationFailure('missingResource', `Session type '${id}' does not exist`);
		}
		return sessionType;
	}

	private async resolveSessionConfigurationState(
		agent: IAgent,
		workspace: IAgentWorkspace | undefined,
		candidate: IAgentConfigurationCandidate,
	): Promise<IAgentConfigurationState> {
		if (!agent.registration.supportedSessionConfigurationSchemas.includes(candidate.schema)) {
			throw operationFailure('invalidPayload', `Session configuration schema '${candidate.schema}' is not supported`);
		}
		const resolved = await agent.configuration.resolveSession({
			runtimeRegistration: agent.registration.revision,
			...(workspace === undefined ? {} : { workspace }),
			hostDefaults: this.requireAgentDefaults(agent),
			candidate,
		});
		const schema = validateAndFreezeAgentConfigurationSchema(resolved.schema, {
			agent: agent.id,
			scope: 'session',
		});
		if (
			!agent.registration.supportedSessionConfigurationSchemas.includes(schema.revision)
			|| agent.registration.revision !== this.requireActiveAgent(agent.id).registration.revision
		) {
			throw operationFailure('conflict', 'Resolved Session configuration does not match the active runtime registration');
		}
		recordExactConfigurationSchema(
			this.sessionConfigurationSchemas,
			schema,
			`Agent runtime '${agent.id}'`,
		);
		return createConfigurationState(schema, resolved.values);
	}

	private requireSessionConfiguration(agent: IAgent, state: IAgentConfigurationState): IAgentConfigurationState {
		const configuration = validateAndFreezeAgentConfigurationState(state, {
			agent: agent.id,
			scope: 'session',
		});
		if (!agent.registration.supportedSessionConfigurationSchemas.includes(configuration.schema.revision)) {
			throw operationFailure(
				'conflict',
				`Session configuration schema '${configuration.schema.revision}' is not supported by the active runtime`,
			);
		}
		recordExactConfigurationSchema(
			this.sessionConfigurationSchemas,
			configuration.schema,
			`Persisted Session for Agent '${agent.id}'`,
		);
		return configuration;
	}

	private async requireRuntimeExactSessionConfiguration(
		agent: IAgent,
		workspace: IAgentWorkspace | undefined,
		state: IAgentConfigurationState,
	): Promise<IAgentConfigurationState> {
		const current = this.requireSessionConfiguration(agent, state);
		const resolved = await this.resolveSessionConfigurationState(agent, workspace, Object.freeze({
			schema: current.schema.revision,
			values: current.values,
		}));
		if (!sameProtocolValue(current.schema, resolved.schema) || !sameProtocolValue(current.values, resolved.values)) {
			throw operationFailure('conflict', 'Persisted Session configuration does not match the active runtime resolution');
		}
		return current;
	}

	private async resolvePreparationTarget(target: AgentHostSubmissionTarget): Promise<{
		readonly sessionType: IAgentHostSessionTypeDescriptor;
		readonly agent: IAgent;
		readonly sessionConfiguration: IAgentConfigurationState;
		readonly chat?: IRuntimeChatRecord;
	}> {
		if (target.kind === 'draft') {
			const sessionType = this.requireSessionType(target.sessionType);
			this.validateWorkspace(sessionType, target.workspace);
			const agent = this.requireActiveAgent(sessionType.agentId, sessionType.packageId);
			return {
				sessionType,
				agent,
				sessionConfiguration: await this.resolveSessionConfigurationState(agent, target.workspace, target.configuration),
			};
		}
		const session = this.requireSession(target.session);
		if (this.hasPendingSessionConfigurationFinalization(session.state.id)) {
			throw operationFailure('invalidState', 'Session configuration finalization requires reconciliation');
		}
		const chat = this.requireChat(session, target.chat);
		const sessionType = this.requireSessionType(session.state.type);
		if (chat.state.lifecycle !== 'available' || !chat.state.capabilities.supportsSubmit) {
			throw operationFailure('invalidState', `Chat '${target.chat}' cannot accept a submission`);
		}
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		return {
			sessionType,
			agent,
			sessionConfiguration: await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration),
			chat,
		};
	}

	private async executePreparation(
		connection: AgentHostClientConnectionId,
		request: IAgentHostPrepareSubmissionRequest,
	): Promise<AgentHostPrepareSubmissionResult> {
		try {
			const captureDigest = await computeAgentHostSubmissionCaptureDigest(request.capture);
			if (captureDigest !== request.captureDigest) {
				throw operationFailure('invalidPayload', 'Submission capture digest does not match its content');
			}
			if (request.capture.message.length > 4 * 1024 * 1024) {
				throw operationFailure('invalidPayload', 'Submission message exceeds the protocol limit');
			}
			if (request.capture.message.length === 0 && request.capture.attachments.length === 0) {
				throw operationFailure('invalidPayload', 'Submission must include a message or attachment');
			}
			const target = await this.resolvePreparationTarget(request.target);
			return await this.runLifecycleActivity(target.agent.id, async () => {
			const descriptor = target.agent.descriptor.get();
			const model = this.resolveExecutionModel(target.sessionType, descriptor, request.executionSelection, target.chat);
			this.validateCapture(connection, descriptor, model, request);
			const selection = this.toAgentExecutionSelection(request.executionSelection, model.configurationSchema);
			const selectionDigest = await computeAgentHostPayloadDigest(selection);
			const profile = await target.agent.executionProfiles.resolve({
				submission: request.submission,
				selection,
				selectionDigest,
				runtimeRegistration: target.agent.registration.revision,
				sessionConfiguration: target.sessionConfiguration,
			});
			if (
				profile.agentDescriptor !== descriptor.revision
				|| profile.modelDescriptor !== model.revision
				|| target.agent.registration.revision !== this.requireActiveAgent(target.agent.id).registration.revision
			) {
				throw operationFailure('conflict', 'Execution profile does not match the exact Agent and model descriptors');
			}
			const credentialsByIdentity = new Map<string, IAgentCredentialReference>();
			for (const binding of [
				...collectAgentConfigurationCredentialReferences(
					target.sessionConfiguration.schema,
					target.sessionConfiguration.values,
					'session',
				),
				...collectAgentConfigurationCredentialReferences(
					model.configurationSchema,
					selection.configuration.values,
					'model',
				),
			]) {
				credentialsByIdentity.set(encodeAgentHostProtocolValue(binding.credential), binding.credential);
			}
			const credentials = Object.freeze([...credentialsByIdentity.values()]);
			const toolSet = await this.options.toolSets.prepare({
				submission: request.submission,
				agent: descriptor,
				runtimeRegistration: target.agent.registration,
				model,
				profile,
				targets: request.capture.interactionTargets,
				policy: request.toolPolicy,
			});
			this.validateToolSet(target.agent.registration, descriptor, model, request.toolPolicy, request.capture.interactionTargets, toolSet);
			const policy = this.options.submissionPolicy.resolve(descriptor, profile);
			assertAgentHostProtocolValue(policy.outputConstraints);
			if (!Number.isSafeInteger(policy.requestedDeadline) || policy.requestedDeadline <= this.options.now()) {
				throw operationFailure('invalidState', 'Submission policy returned an invalid deadline');
			}
			const withoutDigest = Object.freeze({
				submission: request.submission,
				message: request.capture.message,
				attachments: Object.freeze([...request.capture.attachments]),
				interactionTargets: Object.freeze([...request.capture.interactionTargets]),
				sessionConfiguration: target.sessionConfiguration,
				modelConfiguration: selection.configuration,
				credentials,
				executionProfile: Object.freeze({ ...profile }),
				runtimeRegistration: target.agent.registration.revision,
				toolSet,
				requestedDeadline: policy.requestedDeadline,
				outputConstraints: policy.outputConstraints,
			});
			const payloadDigest = await computeAgentHostPayloadDigest(withoutDigest);
			const submission: IAgentHostPreparedSubmission = Object.freeze({ ...withoutDigest, payloadDigest });
			return Object.freeze({ kind: 'prepared', submission });
			});
		} catch (error) {
			return Object.freeze({ kind: 'rejected', failure: toOperationFailure(error) });
		}
	}

	private resolveExecutionModel(
		sessionType: IAgentHostSessionTypeDescriptor,
		descriptor: IAgentDescriptor,
		selection: AgentHostExecutionSelection,
		chat: IRuntimeChatRecord | undefined,
	): IAgentDescriptor['models'][number] {
		if (selection.kind === 'model') {
			if (chat !== undefined && chat.state.model !== null && chat.state.model !== selection.model) {
				throw operationFailure('conflict', 'Submission model differs from the addressed Chat model');
			}
			if (!sessionType.models.includes(selection.model)) {
				throw operationFailure('unsupportedCapability', `Model '${selection.model}' is not supported by the Session type`);
			}
			const model = descriptor.models.find(candidate => candidate.id === selection.model);
			if (model === undefined || !model.enabled) {
				throw operationFailure('agentUnavailable', `Model '${selection.model}' is unavailable`);
			}
			return model;
		}
		const preset = sessionType.executionPresets.find(candidate => candidate.id === selection.preset);
		if (preset === undefined || (chat !== undefined && chat.state.model !== null)) {
			throw operationFailure('unsupportedCapability', `Execution preset '${selection.preset}' is not valid for the addressed Chat`);
		}
		const model = descriptor.models.find(candidate => candidate.id === preset.model);
		if (model === undefined || !model.enabled || !sessionType.models.includes(model.id)) {
			throw operationFailure('agentUnavailable', `Execution preset '${selection.preset}' model '${preset.model}' is unavailable`);
		}
		return model;
	}

	private toAgentExecutionSelection(
		selection: AgentHostExecutionSelection,
		modelSchema: IAgentConfigurationSchema,
	): {
		readonly kind: 'user' | 'product';
		readonly value: AgentHostProtocolValue;
		readonly configuration: IAgentConfigurationCandidate;
	} {
		const schema = validateAndFreezeAgentConfigurationSchema(modelSchema, {
			agent: modelSchema.agent,
			scope: 'model',
			revision: modelSchema.revision,
		});
		const configuration = resolveAgentModelConfigurationCandidate(schema, selection.configuration);
		return selection.kind === 'model'
			? Object.freeze({ kind: 'user', value: Object.freeze({ model: selection.model }), configuration })
			: Object.freeze({ kind: 'product', value: Object.freeze({ preset: selection.preset }), configuration });
	}

	private validateCapture(
		connection: AgentHostClientConnectionId,
		descriptor: IAgentDescriptor,
		model: IAgentDescriptor['models'][number],
		request: IAgentHostPrepareSubmissionRequest,
	): void {
		const ids = new Set<string>();
		let totalBytes = 0;
		if (request.capture.attachments.length > model.attachments.maximumCount) {
			throw operationFailure('invalidPayload', 'Submission attachment count exceeds the model limit');
		}
		for (const attachment of request.capture.attachments) {
			assertAgentHostAttachment(attachment);
			if (ids.has(attachment.id)) {
				throw operationFailure('invalidPayload', `Duplicate attachment '${attachment.id}'`);
			}
			ids.add(attachment.id);
			const content = attachment.content;
			const carrier = content?.kind;
			if (carrier !== undefined && !model.attachments.carriers.includes(carrier)) {
				throw operationFailure('unsupportedCapability', `Attachment carrier '${carrier}' is unsupported`);
			}
			if (content?.kind === 'reference') {
				if (!model.attachments.shapes.includes(content.shape)) {
					throw operationFailure('unsupportedCapability', `Attachment shape '${content.shape}' is unsupported`);
				}
				if (content.owner.kind === 'client' && content.owner.connection !== connection) {
					throw operationFailure('invalidPayload', 'Attachment content belongs to another logical client');
				}
				if (content.shape === 'tree' && (
					(content.bounds.treeDepth ?? 0) > model.attachments.maximumTreeDepth
					|| (content.bounds.treeEntryCount ?? 0) > model.attachments.maximumTreeEntries
				)) {
					throw operationFailure('invalidPayload', 'Attachment tree exceeds the model limits');
				}
			}
			const mediaType = content?.mediaType ?? attachment.representation.mediaType;
			if (!model.attachments.mediaTypes.includes(mediaType)) {
				throw operationFailure('unsupportedCapability', `Attachment media type '${mediaType}' is unsupported`);
			}
			const bytes = content?.kind === 'inline' ? content.byteLength : content?.bounds.byteLength ?? 0;
			if (bytes > model.attachments.maximumItemBytes) {
				throw operationFailure('invalidPayload', `Attachment '${attachment.id}' exceeds the item byte limit`);
			}
			totalBytes += bytes;
		}
		if (totalBytes > model.attachments.maximumTotalBytes) {
			throw operationFailure('invalidPayload', 'Submission attachments exceed the total byte limit');
		}
		const targetIds = new Set<string>();
		const now = this.options.now();
		assertSafeTimestamp(now);
		for (const target of request.capture.interactionTargets) {
			assertAgentHostInteractionTarget(target);
			if (targetIds.has(target.id)) {
				throw operationFailure('invalidPayload', `Duplicate interaction target '${target.id}'`);
			}
			targetIds.add(target.id);
			if (target.authority.kind === 'client' && target.authority.connection !== connection) {
				throw operationFailure('invalidPayload', 'Interaction target belongs to another logical client');
			}
			if (target.expiresAt !== undefined && target.expiresAt <= now) {
				throw operationFailure('invalidState', `Interaction target '${target.id}' is expired`);
			}
		}
		if (descriptor.models.every(candidate => candidate.revision !== model.revision)) {
			throw operationFailure('conflict', 'Model descriptor is no longer owned by the Agent descriptor');
		}
	}

	private validateToolSet(
		registration: IAgentRuntimeRegistration,
		descriptor: IAgentDescriptor,
		model: IAgentDescriptor['models'][number],
		policy: AgentHostToolPolicy,
		targets: IAgentHostPrepareSubmissionRequest['capture']['interactionTargets'],
		toolSet: IAgentToolSet,
	): void {
		if (
			toolSet.runtimeRegistration !== registration.revision
			|| toolSet.agentDescriptor !== descriptor.revision
			|| toolSet.modelDescriptor !== model.revision
			|| !registration.supportedToolSchemaProfiles.includes(toolSet.schemaProfile)
			|| !model.toolSchemaProfiles.includes(toolSet.schemaProfile)
		) {
			throw operationFailure('conflict', 'Prepared Tool set does not match the exact Turn descriptors');
		}
		const registrationIds = new Set<string>();
		const toolIds = new Set<string>();
		for (const tool of toolSet.registrations) {
			if (registrationIds.has(tool.id) || toolIds.has(tool.descriptor.id)) {
				throw operationFailure('conflict', 'Prepared Tool set contains duplicate identities');
			}
			registrationIds.add(tool.id);
			toolIds.add(tool.descriptor.id);
			if (tool.descriptor.inputSchema.profile !== toolSet.schemaProfile || tool.descriptor.outputSchema.profile !== toolSet.schemaProfile) {
				throw operationFailure('unsupportedCapability', `Tool '${tool.descriptor.id}' uses another schema profile`);
			}
			if (tool.descriptor.targetTypes.length !== 0
				&& !targets.some(target => agentToolRegistrationAcceptsTarget(tool, target))) {
				throw operationFailure('unsupportedCapability', `Tool '${tool.descriptor.id}' has no compatible bound target`);
			}
			if (tool.executor.kind === 'agent' && (
				tool.executor.agent !== descriptor.id || tool.executor.registration !== registration.revision
			)) {
				throw operationFailure('conflict', `Tool '${tool.descriptor.id}' addresses another Agent runtime`);
			}
		}
		if (policy.kind === 'selected') {
			const requested = new Set(policy.tools);
			if (requested.size !== policy.tools.length || requested.size !== toolIds.size || [...requested].some(tool => !toolIds.has(tool))) {
				throw operationFailure('unsupportedCapability', 'Prepared Tool set differs from the exact selected Tool policy');
			}
		}
	}

	private async executeMutation(
		connection: AgentHostClientConnectionId,
		request: IAgentHostMutationRequest,
	): Promise<IMutationExecution> {
		if (
			'session' in request.payload
			&& request.payload.kind !== 'updateSessionConfiguration'
			&& this.hasPendingSessionConfigurationFinalization(request.payload.session)
		) {
			throw operationFailure('invalidState', 'Session configuration finalization requires reconciliation');
		}
		const execute = () => {
				switch (request.payload.kind) {
				case 'createSession': return this.createSession(connection, request);
				case 'updateAgentDefaults': return this.updateAgentDefaults(request);
				case 'updateSessionConfiguration': return this.updateSessionConfiguration(request);
				case 'createChat': return this.createChat(request);
				case 'forkChat': return this.forkChat(request);
				case 'renameSession': return this.renameSession(request);
				case 'renameChat': return this.renameChat(request);
				case 'setChatModel': return this.setChatModel(request);
				case 'setSessionArchived': return this.setSessionArchived(request);
				case 'materializeSession': return this.materializeSession(request);
				case 'materializeChat': return this.materializeChat(request);
				case 'releaseSession': return this.releaseSession(request);
				case 'releaseChat': return this.releaseChat(request);
				case 'deleteSession': return this.deleteSession(request);
				case 'deleteChat': return this.deleteChat(request);
				case 'submitTurn': return this.submitTurn(connection, request);
				case 'steerTurn': return this.steerTurn(request);
				case 'cancelTurn': return this.cancelTurn(request);
				case 'respondInteraction': return this.respondInteraction(request);
				case 'authenticateAgent': return this.authenticateAgent(request);
			}
		};
		const agentId = this.runtimeMutationAgent(request.payload);
		return agentId === undefined ? execute() : this.runLifecycleActivity(agentId, execute);
	}

	private async reconcileSessionConfigurationFinalization(
		operation: AgentHostOperationId,
		pending: IPendingSessionConfigurationFinalization,
	): Promise<AgentHostMutationOutcome> {
		let current = pending;
		if (current.finalize === 'commit' || current.finalize === 'rollback') {
			try {
				if (current.finalize === 'commit') {
					await current.agent.configuration.commitSessionUpdate(current.request);
				} else {
					await current.agent.configuration.rollbackSessionUpdate(current.request);
				}
			} catch {
				return Object.freeze({ kind: 'pending' });
			}
			const completed: IAgentHostSessionConfigurationFinalization = Object.freeze({
				operation,
				digest: current.request.payloadDigest,
				connection: current.connection,
				status: 'completed',
				packageId: current.agent.registration.packageId,
				agentId: current.agent.id,
				runtimeRegistration: current.request.runtimeRegistration,
				session: current.request.session,
				configuration: current.request.configuration,
				decision: current.decision,
				outcome: current.outcome,
			});
			try {
				await this.commitHostState(
					this.sessions,
					Object.freeze([]),
					Object.freeze({ kind: 'operation', operation, payloadDigest: current.request.payloadDigest }),
					undefined,
					this.catalog.backingRemovalOperations,
					this.agentDefaults,
					this.withSessionConfigurationFinalization(completed),
				);
			} catch {
				return Object.freeze({ kind: 'pending' });
			}
			current = Object.freeze({
				connection: current.connection,
				request: current.request,
				decision: current.decision,
				outcome: current.outcome,
				agent: current.agent,
				finalize: 'acknowledge',
			});
			this.pendingSessionConfigurationFinalizations.set(operation, current);
		}
		if (current.finalize === 'acknowledge') {
			try {
				await current.agent.configuration.acknowledgeSessionUpdate(Object.freeze({
					...current.request,
					decision: current.decision,
				}));
			} catch {
				return Object.freeze({ kind: 'pending' });
			}
		}
		const acknowledged: IAgentHostSessionConfigurationFinalization = Object.freeze({
			operation,
			digest: current.request.payloadDigest,
			connection: current.connection,
			status: 'acknowledged',
			outcome: current.outcome,
		});
		try {
			await this.commitHostState(
				this.sessions,
				Object.freeze([]),
				Object.freeze({ kind: 'operation', operation, payloadDigest: current.request.payloadDigest }),
				undefined,
				this.catalog.backingRemovalOperations,
				this.agentDefaults,
				this.withSessionConfigurationFinalization(acknowledged),
			);
		} catch {
			return Object.freeze({ kind: 'pending' });
		}
		this.pendingSessionConfigurationFinalizations.delete(operation);
		this.notifyQuiescenceChanged();
		this.operations.commit(operation, current.request.payloadDigest, current.outcome);
		return current.outcome;
	}

	private withSessionConfigurationFinalization(
		record: IAgentHostSessionConfigurationFinalization,
	): readonly IAgentHostSessionConfigurationFinalization[] {
		const existing = this.catalog.sessionConfigurationFinalizations.find(candidate => (
			candidate.operation === record.operation
		));
		if (existing !== undefined) {
			if (existing.digest !== record.digest || existing.connection !== record.connection) {
				throw new Error(`Session configuration operation '${record.operation}' changed its durable owner or payload`);
			}
			const acceptsPreparedCommit = (existing.status === 'intent' || existing.status === 'pending')
				&& existing.decision === 'rollback'
				&& record.status === 'pending'
				&& record.decision === 'commit';
			if (!sameProtocolValue(existing.outcome, record.outcome) && !acceptsPreparedCommit) {
				throw new Error(`Session configuration operation '${record.operation}' changed its durable outcome`);
			}
			if (existing.status === 'acknowledged') {
				if (record.status !== 'acknowledged' || !sameProtocolValue(existing, record)) {
					throw new Error(`Acknowledged Session configuration operation '${record.operation}' cannot transition`);
				}
				return this.catalog.sessionConfigurationFinalizations;
			}
			if (record.status !== 'acknowledged') {
				if (
					existing.packageId !== record.packageId
					|| existing.agentId !== record.agentId
					|| existing.runtimeRegistration !== record.runtimeRegistration
					|| existing.session !== record.session
					|| existing.configuration !== record.configuration
					|| (existing.decision !== record.decision && !acceptsPreparedCommit)
					|| record.status === 'intent'
					|| (existing.status === 'completed' && record.status !== 'completed')
				) {
					throw new Error(`Session configuration operation '${record.operation}' has an invalid durable transition`);
				}
				if (existing.status === record.status && !sameProtocolValue(existing, record) && !acceptsPreparedCommit) {
					throw new Error(`Session configuration operation '${record.operation}' changed within one durable state`);
				}
			}
		}
		const retained = this.catalog.sessionConfigurationFinalizations.filter(candidate => candidate.operation !== record.operation);
		if (existing === undefined && retained.length >= maximumRetainedAgentHostSessionConfigurationFinalizations) {
			const oldestAcknowledged = retained.findIndex(candidate => candidate.status === 'acknowledged');
			if (oldestAcknowledged < 0) {
				throw operationFailure('capacityExceeded', 'Session configuration operation ledger is full');
			}
			retained.splice(oldestAcknowledged, 1);
		}
		return Object.freeze([
			...retained,
			record,
		]);
	}

	private async updateAgentDefaults(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'updateAgentDefaults') {
			throw new Error('Mismatched update Agent defaults mutation');
		}
		const agent = this.requireActiveAgent(payload.agent);
		const current = this.requireAgentDefaults(agent);
		if (current.revision !== payload.expectedRevision) {
			throw operationFailure('conflict', 'Agent-default configuration revision changed before update');
		}
		const schema = validateAndFreezeAgentConfigurationSchema(agent.registration.hostDefaultsSchema, {
			agent: agent.id,
			scope: 'hostDefault',
			revision: current.schema.revision,
		});
		const candidate = validateAndFreezeAgentConfigurationCandidate(schema, payload.candidate, 'hostDefault');
		const configuration = createConfigurationState(schema, candidate.values);
		if (sameProtocolValue(current, configuration)) {
			return this.simpleMutationResult(request, {
				hostSequence: this.catalog.hostSequence,
				revisions: Object.freeze([]),
			}, {
				kind: 'updateAgentDefaults',
				agent: agent.id,
				configuration: current.revision,
			});
		}
		const agentDefaults = new Map(this.agentDefaults);
		agentDefaults.set(agent.id, configuration);
		const state = this.createRootState(undefined, undefined, agentDefaults);
		const committed = await this.commitHostState(
			this.sessions,
			[this.rootAction(state)],
			this.operationCause(request),
			undefined,
			this.catalog.backingRemovalOperations,
			agentDefaults,
		);
		return this.simpleMutationResult(request, committed, {
			kind: 'updateAgentDefaults',
			agent: agent.id,
			configuration: configuration.revision,
		});
	}

	private async updateSessionConfiguration(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'updateSessionConfiguration') {
			throw new Error('Mismatched update Session configuration mutation');
		}
		const session = this.requireSession(payload.session);
		if (this.hasPendingSessionConfigurationFinalization(payload.session)) {
			throw operationFailure('invalidState', 'Another Session configuration operation requires reconciliation');
		}
		if (session.state.configuration.revision !== payload.expectedRevision) {
			throw operationFailure('conflict', 'Session configuration revision changed before update');
		}
		if ([...session.chats.values()].some(chat => chat.state.turns.some(turn => activeTurnStates.has(turn.state)))) {
			throw operationFailure('invalidState', 'Session configuration cannot change while a Turn is active');
		}
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		const connection = this.operationOwners.get(request.operation);
		if (connection === undefined) {
			throw new Error(`Session configuration operation '${request.operation}' has no logical connection owner`);
		}
		const current = await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration);
		const candidate = validateAndFreezeAgentConfigurationCandidate(current.schema, payload.candidate, 'session', true);
		for (const property of current.schema.properties) {
			if (property.sessionMutable) {
				continue;
			}
			const currentHasValue = Object.hasOwn(current.values, property.id);
			const candidateHasValue = Object.hasOwn(candidate.values, property.id);
			if (
				currentHasValue !== candidateHasValue
				|| (currentHasValue && encodeAgentHostProtocolValue(current.values[property.id]) !== encodeAgentHostProtocolValue(candidate.values[property.id]))
			) {
				throw operationFailure('invalidPayload', `Session configuration property '${property.id}' is immutable`);
			}
		}
		const configuration = createConfigurationState(current.schema, candidate.values);
		const resultShape = Object.freeze({
			kind: 'updateSessionConfiguration' as const,
			session: payload.session,
			configuration: configuration.revision,
		});
		if (sameProtocolValue(current, configuration)) {
			const execution = this.simpleMutationResult(request, {
				hostSequence: this.catalog.hostSequence,
				revisions: Object.freeze([]),
			}, resultShape);
			const completed: IAgentHostSessionConfigurationFinalization = Object.freeze({
				operation: request.operation,
				digest: request.digest,
				connection,
				status: 'acknowledged',
				outcome: Object.freeze({ kind: 'succeeded', result: execution.result }),
			});
			await this.commitHostState(
				this.sessions,
				Object.freeze([]),
				this.operationCause(request),
				undefined,
				this.catalog.backingRemovalOperations,
				this.agentDefaults,
				this.withSessionConfigurationFinalization(completed),
			);
			return execution;
		}
		const finalizationRequest = Object.freeze({
			operation: request.operation,
			payloadDigest: request.digest,
			runtimeRegistration: agent.registration.revision,
			session: payload.session,
			configuration: configuration.revision,
		});
		const rollbackFailure = Object.freeze({
			code: 'invalidState' as const,
			message: 'Session configuration update did not commit',
			reconciliation: 'terminal' as const,
		});
		const rollbackOutcome = Object.freeze({ kind: 'failed' as const, failure: rollbackFailure });
		const rollbackIntent: IAgentHostSessionConfigurationFinalization = Object.freeze({
			operation: request.operation,
			digest: request.digest,
			connection,
			status: 'intent',
			packageId: session.state.packageId,
			agentId: session.state.agentId,
			runtimeRegistration: agent.registration.revision,
			session: payload.session,
			configuration: configuration.revision,
			decision: 'rollback',
			outcome: rollbackOutcome,
		});
		const pendingRollback: IAgentHostSessionConfigurationFinalization = Object.freeze({
			...rollbackIntent,
			status: 'pending',
		});
		const finalizeRollback = async (): Promise<never> => {
			const pending: IPendingSessionConfigurationFinalization = Object.freeze({
				connection,
				agent,
				request: finalizationRequest,
				decision: 'rollback',
				finalize: 'rollback',
				outcome: rollbackOutcome,
			});
			this.pendingSessionConfigurationFinalizations.set(request.operation, pending);
			const reconciled = await this.reconcileSessionConfigurationFinalization(request.operation, pending);
			if (reconciled.kind === 'pending') {
				throw new PendingSessionConfigurationFinalization();
			}
			throw new HostOperationFailure(rollbackFailure);
		};
		if (session.materialized) {
			await this.commitHostState(
				this.sessions,
				Object.freeze([]),
				this.operationCause(request),
				undefined,
				this.catalog.backingRemovalOperations,
				this.agentDefaults,
				this.withSessionConfigurationFinalization(rollbackIntent),
			);
			try {
				await agent.configuration.prepareSessionUpdate({
					operation: request.operation,
					payloadDigest: request.digest,
					runtimeRegistration: agent.registration.revision,
					session: payload.session,
					current,
					candidate: configuration,
				});
			} catch {
				try {
					await this.commitHostState(
						this.sessions,
						Object.freeze([]),
						this.operationCause(request),
						undefined,
						this.catalog.backingRemovalOperations,
						this.agentDefaults,
						this.withSessionConfigurationFinalization(pendingRollback),
					);
				} catch {
					// The durable intent remains the authoritative rollback decision.
				}
				return finalizeRollback();
			}
			try {
				await this.commitHostState(
					this.sessions,
					Object.freeze([]),
					this.operationCause(request),
					undefined,
					this.catalog.backingRemovalOperations,
					this.agentDefaults,
					this.withSessionConfigurationFinalization(pendingRollback),
				);
			} catch {
				return finalizeRollback();
			}
		}
		const state = Object.freeze({
			...session.state,
			configuration,
			modifiedAt: this.checkedNow(),
		});
		const next = new Map(this.sessions);
		next.set(payload.session, { ...session, state });
		let execution: IMutationExecution | undefined;
		try {
			await this.commitHostState(
				next,
				[this.sessionsAction(next), this.sessionAction(state)],
				this.operationCause(request),
				undefined,
				this.catalog.backingRemovalOperations,
				this.agentDefaults,
				committed => {
					execution = this.simpleMutationResult(request, committed, resultShape);
					const outcome = Object.freeze({ kind: 'succeeded' as const, result: execution.result });
					const finalization: IAgentHostSessionConfigurationFinalization = session.materialized
						? Object.freeze({
							operation: request.operation,
							digest: request.digest,
							connection,
							status: 'pending' as const,
							packageId: session.state.packageId,
							agentId: session.state.agentId,
							runtimeRegistration: agent.registration.revision,
							session: payload.session,
							configuration: configuration.revision,
							decision: 'commit' as const,
							outcome,
						})
						: Object.freeze({
							operation: request.operation,
							digest: request.digest,
							connection,
							status: 'acknowledged' as const,
							outcome,
						});
					return this.withSessionConfigurationFinalization(finalization);
				},
			);
		} catch {
			if (session.materialized) {
				return finalizeRollback();
			}
			throw new HostOperationFailure(rollbackFailure);
		}
		if (execution === undefined) {
			throw new Error('Session configuration commit did not construct a mutation result');
		}
		if (session.materialized) {
			const pending: IPendingSessionConfigurationFinalization = Object.freeze({
				connection,
				agent,
				request: finalizationRequest,
				decision: 'commit',
				finalize: 'commit' as const,
				outcome: Object.freeze({ kind: 'succeeded' as const, result: execution.result }),
			});
			this.pendingSessionConfigurationFinalizations.set(request.operation, pending);
			const reconciled = await this.reconcileSessionConfigurationFinalization(request.operation, pending);
			if (reconciled.kind === 'pending') {
				throw new PendingSessionConfigurationFinalization();
			}
		}
		return execution;
	}

	private async authenticateAgent(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'authenticateAgent') {
			throw new Error('Mismatched authenticate Agent mutation');
		}
		const authentication = this.options.authentication;
		if (authentication === undefined) {
			throw operationFailure('unsupportedCapability', 'Agent Host does not support authentication operations');
		}
		for (const [field, value] of Object.entries(payload.credential)) {
			if (value.length === 0 || value.length > 512) {
				throw operationFailure('invalidPayload', `Agent authentication credential ${field} is invalid`);
			}
		}
		const registration = this.options.packageLifecycle.snapshot().activeRegistrations.find(candidate => (
			candidate.packageId === payload.packageId
			&& candidate.agentId === payload.agentId
			&& candidate.revision === payload.registration
		));
		if (registration === undefined) {
			throw operationFailure('agentUnavailable', 'Agent authentication requires the exact active runtime registration');
		}
		const result = await authentication.authenticate({
			operation: request.operation,
			digest: request.digest,
			packageId: payload.packageId,
			agentId: payload.agentId,
			registration: payload.registration,
			credential: payload.credential,
		});
		if (result !== 'authenticated' || authentication.getState(registration) !== 'authenticated') {
			throw operationFailure('invalidState', 'Agent authentication port did not commit authenticated state');
		}
		const committed = await this.commitHostState(
			this.sessions,
			[this.rootAction()],
			this.operationCause(request),
		);
		return this.simpleMutationResult(request, committed, {
			kind: 'authenticateAgent',
			packageId: payload.packageId,
			agentId: payload.agentId,
			registration: payload.registration,
		});
	}

	private async createSession(connection: AgentHostClientConnectionId, request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'createSession') {
			throw new Error('Mismatched create Session mutation');
		}
		const sessionType = this.requireSessionType(payload.sessionType);
		const agent = this.requireActiveAgent(sessionType.agentId, sessionType.packageId);
		this.validateWorkspace(sessionType, payload.workspace);
		const configuration = await this.resolveSessionConfigurationState(agent, payload.workspace, payload.configuration);
		if (payload.chats.length === 0 && (!sessionType.capabilities.supportsEmptySession || !agent.descriptor.get().capabilities.supportsEmptySession)) {
			throw operationFailure('unsupportedCapability', 'Session type does not support an empty Session');
		}
		const maximumChatCount = this.maximumChatCount(sessionType, agent);
		if (maximumChatCount !== undefined && payload.chats.length > maximumChatCount) {
			throw operationFailure('capacityExceeded', 'Initial Chat count exceeds Session capacity');
		}
		const initialSubmissions = new Set<AgentSubmissionId>();
		const preparationTarget: AgentHostSubmissionTarget = payload.workspace === undefined
			? Object.freeze({ kind: 'draft', sessionType: payload.sessionType, configuration: payload.configuration })
			: Object.freeze({
				kind: 'draft',
				sessionType: payload.sessionType,
				workspace: payload.workspace,
				configuration: payload.configuration,
			});
		for (const chat of payload.chats) {
			this.validateChatModel(sessionType, agent, chat.model);
			if ((chat.title?.length ?? 0) > 1_024) {
				throw operationFailure('invalidPayload', 'Initial Chat title exceeds the protocol limit');
			}
			if (chat.initialSubmission !== undefined) {
				if (!sessionType.capabilities.supportsInitialTurn) {
					throw operationFailure('unsupportedCapability', 'Session type does not support an initial Turn');
				}
				if (initialSubmissions.has(chat.initialSubmission.submission)) {
					throw operationFailure('conflict', `Submission '${chat.initialSubmission.submission}' is assigned to multiple Chats`);
				}
				initialSubmissions.add(chat.initialSubmission.submission);
				this.requirePreparedSubmission(connection, chat.initialSubmission, preparationTarget);
				if (!sameProtocolValue(chat.initialSubmission.sessionConfiguration, configuration)) {
					throw operationFailure('conflict', 'Prepared submission Session configuration changed before Session creation');
				}
			}
		}
		const session = this.options.identityFactory.createSession();
		if (this.sessions.has(session)) {
			throw operationFailure('conflict', `Generated Session identity '${session}' already exists`);
		}
		const chatIds = payload.chats.map(() => this.options.identityFactory.createChat());
		if (new Set(chatIds).size !== chatIds.length) {
			throw operationFailure('conflict', 'Generated Chat identities contain duplicates');
		}
		const now = this.options.now();
		assertSafeTimestamp(now);
		const sessionBacking = await agent.sessions.create({
			operation: request.operation,
			payloadDigest: request.digest,
			session,
			configuration,
			...(payload.workspace === undefined ? {} : { workspace: payload.workspace }),
		});
		if (sessionBacking.session !== session) {
			await this.cleanupAndRethrow(
				operationFailure('conflict', 'Agent created another Session backing identity'),
				agent,
				request,
				session,
				[],
			);
		}
		const createdChats: Array<{ request: IAgentHostCreateSessionChatRequest; id: AgentChatId; backing: Awaited<ReturnType<IAgent['chats']['create']>> }> = [];
		try {
			for (let index = 0; index < payload.chats.length; index += 1) {
				const chatRequest = payload.chats[index];
				const id = chatIds[index];
				const backing = await agent.chats.create({
					operation: request.operation,
					payloadDigest: request.digest,
					session,
					chat: id,
					origin: chatRequest.origin,
				});
				createdChats.push({ request: chatRequest, id, backing });
				if (backing.session !== session || backing.chat !== id) {
					throw operationFailure('conflict', 'Agent created another Chat backing identity');
				}
			}
		} catch (error) {
			return this.cleanupAndRethrow(error, agent, request, session, createdChats.map(chat => chat.id));
		}
		const runtimeChats = new Map<AgentChatId, IRuntimeChatRecord>();
		const starts: IAgentChatRequest[] = [];
		const createdResults: Array<{ chat: AgentChatId; turn?: AgentTurnId; submission?: AgentSubmissionId }> = [];
		for (const created of createdChats) {
			const initial = created.request.initialSubmission;
			const turn = initial === undefined ? undefined : this.options.identityFactory.createTurn();
			const turns = initial === undefined || turn === undefined
				? Object.freeze([])
				: Object.freeze([this.createAcceptedTurn(turn, initial)]);
			const state = this.createChatState(agent, session, created.id, created.request.origin, created.request.title ?? '', created.request.model, now, turns);
			runtimeChats.set(created.id, Object.freeze({ state, resume: created.backing.resume, materialized: true }));
			if (turn !== undefined && initial !== undefined) {
				starts.push(this.createAgentChatRequest(agent, request, session, created.id, turn, initial));
				createdResults.push({ chat: created.id, turn, submission: initial.submission });
			} else {
				createdResults.push({ chat: created.id });
			}
		}
		const state = this.createSessionState(agent, sessionType, session, payload.workspace, configuration, '', now, runtimeChats);
		const next = new Map(this.sessions);
		next.set(session, { state, resume: sessionBacking.resume, materialized: true, chats: runtimeChats });
		const cause = this.operationCause(request);
		const actions: HostStateAction[] = [
			this.sessionsAction(next),
			this.sessionAction(state),
			...([...runtimeChats.values()].map(chat => this.chatAction(chat.state))),
		];
		const turnBindings: IDisposable[] = [];
		const credentialTurnBindings: IDisposable[] = [];
		let committed: ICommittedHostState;
		try {
			for (const start of starts) {
				await this.bindTurnContent(start);
				turnBindings.push(this.bindToolTurn(agent, start));
				const credentialBinding = this.bindCredentialTurn(agent, start);
				if (credentialBinding !== undefined) {
					credentialTurnBindings.push(credentialBinding);
				}
			}
			committed = await this.commitHostAndBackingState(next, actions, cause);
		} catch (error) {
			for (const binding of credentialTurnBindings) {
				binding.dispose();
			}
			for (const binding of turnBindings) {
				binding.dispose();
			}
			const failures: unknown[] = [error];
			for (const start of [...starts].reverse()) {
				try {
					await this.releaseTurnContent(start.session, start.chat, start.turn);
				} catch (releaseError) {
					failures.push(releaseError);
				}
			}
			return this.cleanupAndRethrow(
				failures.length === 1 ? error : new AggregateError(failures, 'Session commit and content-anchor cleanup both failed'),
				agent,
				request,
				session,
				createdChats.map(chat => chat.id),
			);
		}
		for (const created of createdChats) {
			if (created.request.initialSubmission !== undefined) {
				this.markPreparedAccepted(created.request.initialSubmission.submission);
			}
		}
		return {
			result: Object.freeze({
				kind: 'createSession', operation: request.operation, digest: request.digest,
				hostSequence: committed.hostSequence, revisions: committed.revisions,
				session, chats: Object.freeze(createdResults.map(result => Object.freeze(result))),
			}),
			afterCommit: Object.freeze(starts.map(start => () => this.startTurn(agent, start))),
		};
	}

	private async createChat(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'createChat') {
			throw new Error('Mismatched create Chat mutation');
		}
		const session = this.requireSession(payload.session);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		const sessionType = this.requireSessionType(session.state.type);
		this.requireAvailableSession(session);
		this.requireChatCapacity(session);
		if (!session.state.capabilities.supportsCreateChat) {
			throw operationFailure('unsupportedCapability', 'Session does not support creating a peer Chat');
		}
		this.validateChatModel(sessionType, agent, payload.model);
		if ((payload.title?.length ?? 0) > 1_024) {
			throw operationFailure('invalidPayload', 'Chat title exceeds the protocol limit');
		}
		const chat = this.options.identityFactory.createChat();
		if (session.chats.has(chat)) {
			throw operationFailure('conflict', `Generated Chat identity '${chat}' already exists`);
		}
		const backing = await agent.chats.create({
			operation: request.operation, payloadDigest: request.digest, session: payload.session, chat, origin: payload.origin,
		});
		if (backing.session !== payload.session || backing.chat !== chat) {
			await this.cleanupChatAndRethrow(
				operationFailure('conflict', 'Agent created another Chat backing identity'), agent, request, payload.session, chat,
			);
		}
		const now = this.options.now();
		assertSafeTimestamp(now);
		const state = this.createChatState(agent, payload.session, chat, payload.origin, payload.title ?? '', payload.model, now, Object.freeze([]));
		const chats = new Map(session.chats);
		chats.set(chat, Object.freeze({ state, resume: backing.resume, materialized: true }));
		const updated = this.withChats(session, chats, now);
		const next = new Map(this.sessions);
		next.set(payload.session, updated);
		let committed: ICommittedHostState;
		try {
			committed = await this.commitHostAndBackingState(next, [this.sessionsAction(next), this.sessionAction(updated.state), this.chatAction(state)], this.operationCause(request));
		} catch (error) {
			return this.cleanupChatAndRethrow(error, agent, request, payload.session, chat);
		}
		return this.simpleMutationResult(request, committed, {
			kind: 'createChat', session: payload.session, chat,
		});
	}

	private async forkChat(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'forkChat') {
			throw new Error('Mismatched fork Chat mutation');
		}
		const session = this.requireSession(payload.session);
		const source = this.requireChat(session, payload.sourceChat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		this.requireAvailableSession(session);
		this.requireChatCapacity(session);
		if (!session.state.capabilities.supportsFork || !source.state.capabilities.supportsFork) {
			throw operationFailure('unsupportedCapability', 'Addressed Chat cannot be forked');
		}
		if (!source.state.turns.some(turn => turn.id === payload.sourceTurn)) {
			throw operationFailure('missingResource', `Turn '${payload.sourceTurn}' does not exist in the source Chat`);
		}
		const chat = this.options.identityFactory.createChat();
		if (session.chats.has(chat)) {
			throw operationFailure('conflict', `Generated Chat identity '${chat}' already exists`);
		}
		const backing = await agent.chats.fork({
			operation: request.operation, payloadDigest: request.digest, session: payload.session, chat,
			source: { chat: payload.sourceChat, turn: payload.sourceTurn },
		});
		if (backing.session !== payload.session || backing.chat !== chat) {
			await this.cleanupChatAndRethrow(
				operationFailure('conflict', 'Agent forked another Chat backing identity'), agent, request, payload.session, chat,
			);
		}
		const now = this.checkedNow();
		const state = this.createChatState(
			agent, payload.session, chat,
			Object.freeze({ kind: 'fork', parentChat: payload.sourceChat, parentTurn: payload.sourceTurn }),
			source.state.title, source.state.model, now, Object.freeze([]),
		);
		const chats = new Map(session.chats);
		chats.set(chat, Object.freeze({ state, resume: backing.resume, materialized: true }));
		const updated = this.withChats(session, chats, now);
		const next = new Map(this.sessions);
		next.set(payload.session, updated);
		let committed: ICommittedHostState;
		try {
			committed = await this.commitHostAndBackingState(next, [this.sessionsAction(next), this.sessionAction(updated.state), this.chatAction(state)], this.operationCause(request));
		} catch (error) {
			return this.cleanupChatAndRethrow(error, agent, request, payload.session, chat);
		}
		return this.simpleMutationResult(request, committed, { kind: 'forkChat', session: payload.session, chat });
	}

	private async renameSession(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'renameSession') { throw new Error('Mismatched rename Session mutation'); }
		const session = this.requireSession(payload.session);
		if (!session.state.capabilities.supportsRename || payload.title.trim().length === 0) {
			throw operationFailure('unsupportedCapability', 'Session cannot be renamed to the requested title');
		}
		const state = Object.freeze({ ...session.state, title: payload.title.trim(), modifiedAt: this.checkedNow() });
		return this.commitSessionOnly(request, session, state, 'renameSession');
	}

	private async renameChat(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'renameChat') { throw new Error('Mismatched rename Chat mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		if (!chat.state.capabilities.supportsRename || payload.title.trim().length === 0) {
			throw operationFailure('unsupportedCapability', 'Chat cannot be renamed to the requested title');
		}
		return this.commitChatChange(request, session, chat, freezeChatState({ ...chat.state, title: payload.title.trim(), modifiedAt: this.checkedNow() }), 'renameChat');
	}

	private async setChatModel(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'setChatModel') { throw new Error('Mismatched set Chat model mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		if (!chat.state.capabilities.supportsSetModel || chat.state.turns.some(turn => activeTurnStates.has(turn.state))) {
			throw operationFailure('invalidState', 'Chat model cannot change while a Turn is active');
		}
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		this.validateChatModel(this.requireSessionType(session.state.type), agent, payload.model);
		return this.commitChatChange(request, session, chat, freezeChatState({ ...chat.state, model: payload.model, modifiedAt: this.checkedNow() }), 'setChatModel');
	}

	private async setSessionArchived(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'setSessionArchived') { throw new Error('Mismatched archive Session mutation'); }
		const session = this.requireSession(payload.session);
		if (!session.state.capabilities.supportsArchive) {
			throw operationFailure('unsupportedCapability', 'Session does not support archive state');
		}
		const state = Object.freeze({ ...session.state, archived: payload.archived, modifiedAt: this.checkedNow() });
		return this.commitSessionOnly(request, session, state, 'setSessionArchived');
	}

	private async materializeSession(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'materializeSession') { throw new Error('Mismatched materialize Session mutation'); }
		const session = this.requireSession(payload.session);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (session.materialized || session.state.lifecycle === 'available') {
			throw operationFailure('invalidState', `Session '${payload.session}' is already materialized`);
		}
		const materializedChats: IRuntimeChatRecord[] = [];
		let sessionMaterialized = false;
		try {
			const configuration = await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration);
			await agent.sessions.materialize({
				operation: request.operation,
				payloadDigest: request.digest,
				session: payload.session,
				configuration,
				resume: session.resume,
			});
			sessionMaterialized = true;
			for (const chat of session.chats.values()) {
				await agent.chats.materialize({
					operation: request.operation,
					payloadDigest: request.digest,
					session: payload.session,
					chat: chat.state.id,
					resume: chat.resume,
				});
				materializedChats.push(chat);
			}
			const now = this.checkedNow();
			const chats = new Map<AgentChatId, IRuntimeChatRecord>();
			for (const [id, chat] of session.chats) {
				chats.set(id, Object.freeze({
					...chat,
					materialized: true,
					state: freezeChatState({ ...chat.state, lifecycle: 'available', modifiedAt: now }),
				}));
			}
			const state = Object.freeze({
				...session.state,
				lifecycle: 'available' as const,
				modifiedAt: now,
				chats: Object.freeze([...chats.values()].map(chat => chatSummary(chat.state))),
			});
			const updated: IRuntimeSessionRecord = { ...session, state, materialized: true, chats };
			const next = new Map(this.sessions);
			next.set(payload.session, updated);
			const committed = await this.commitHostAndBackingState(
				next,
				[this.sessionsAction(next), this.sessionAction(state), ...[...chats.values()].map(chat => this.chatAction(chat.state))],
				this.operationCause(request),
			);
			return this.simpleMutationResult(request, committed, { kind: 'materializeSession', session: payload.session });
		} catch (error) {
			const rollbackErrors: unknown[] = [error];
			for (const chat of [...materializedChats].reverse()) {
				try {
					await agent.chats.release({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: chat.state.id });
				} catch (releaseError) {
					rollbackErrors.push(releaseError);
				}
			}
			if (sessionMaterialized) {
				try {
					await agent.sessions.release({ operation: request.operation, payloadDigest: request.digest, session: payload.session });
				} catch (releaseError) {
					rollbackErrors.push(releaseError);
				}
			}
			if (rollbackErrors.length === 1) { throw error; }
			throw new AggregateError(rollbackErrors, 'Session materialization and rollback both failed');
		}
	}

	private async materializeChat(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'materializeChat') { throw new Error('Mismatched materialize Chat mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (chat.materialized || chat.state.lifecycle === 'available') {
			throw operationFailure('invalidState', `Chat '${payload.chat}' is already materialized`);
		}
		let sessionMaterialized = false;
		let chatMaterialized = false;
		try {
			if (!session.materialized) {
				const configuration = await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration);
				await agent.sessions.materialize({
					operation: request.operation,
					payloadDigest: request.digest,
					session: payload.session,
					configuration,
					resume: session.resume,
				});
				sessionMaterialized = true;
			}
			await agent.chats.materialize({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: payload.chat, resume: chat.resume });
			chatMaterialized = true;
			const now = this.checkedNow();
			const state = freezeChatState({ ...chat.state, lifecycle: 'available', modifiedAt: now });
			const chats = new Map(session.chats);
			chats.set(payload.chat, Object.freeze({ ...chat, state, materialized: true }));
			const updated = this.withChats({
				...session,
				materialized: true,
				state: Object.freeze({ ...session.state, lifecycle: 'available' as const }),
			}, chats, now);
			const next = new Map(this.sessions);
			next.set(payload.session, updated);
			const committed = await this.commitHostAndBackingState(
				next,
				[this.sessionsAction(next), this.sessionAction(updated.state), this.chatAction(state)],
				this.operationCause(request),
			);
			return this.simpleMutationResult(request, committed, { kind: 'materializeChat', session: payload.session, chat: payload.chat });
		} catch (error) {
			const rollbackErrors: unknown[] = [error];
			if (chatMaterialized) {
				try {
					await agent.chats.release({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: payload.chat });
				} catch (releaseError) {
					rollbackErrors.push(releaseError);
				}
			}
			if (sessionMaterialized) {
				try {
					await agent.sessions.release({ operation: request.operation, payloadDigest: request.digest, session: payload.session });
				} catch (releaseError) {
					rollbackErrors.push(releaseError);
				}
			}
			if (rollbackErrors.length === 1) { throw error; }
			throw new AggregateError(rollbackErrors, 'Chat materialization and rollback both failed');
		}
	}

	private async releaseSession(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'releaseSession') { throw new Error('Mismatched release Session mutation'); }
		const session = this.requireSession(payload.session);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (!agent.descriptor.get().capabilities.supportsReleaseSession || session.state.lifecycle !== 'available') {
			throw operationFailure('unsupportedCapability', 'Session cannot be released');
		}
		if (!session.materialized || [...session.chats.values()].some(chat => !chat.materialized)) {
			throw operationFailure('invalidState', 'Session materialization state is inconsistent');
		}
		await agent.sessions.release({ operation: request.operation, payloadDigest: request.digest, session: payload.session });
		const now = this.checkedNow();
		const chats = new Map<AgentChatId, IRuntimeChatRecord>();
		for (const [id, chat] of session.chats) {
			chats.set(id, Object.freeze({ ...chat, materialized: false, state: freezeChatState({ ...chat.state, lifecycle: 'released', modifiedAt: now }) }));
		}
		const state = Object.freeze({ ...session.state, lifecycle: 'released' as const, modifiedAt: now, chats: Object.freeze([...chats.values()].map(chat => chatSummary(chat.state))) });
		const updated: IRuntimeSessionRecord = { ...session, state, materialized: false, chats };
		const next = new Map(this.sessions);
		next.set(payload.session, updated);
		let committed: ICommittedHostState;
		try {
			committed = await this.commitHostAndBackingState(next, [this.sessionsAction(next), this.sessionAction(state), ...[...chats.values()].map(chat => this.chatAction(chat.state))], this.operationCause(request));
		} catch (error) {
			await this.rematerializeRuntimeSession(agent, session, request.operation, request.digest);
			throw error;
		}
		this.retireSessionToolBindings(payload.session);
		this.retireSessionCredentialBindings(payload.session);
		return this.simpleMutationResult(request, committed, { kind: 'releaseSession', session: payload.session });
	}

	private async releaseChat(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'releaseChat') { throw new Error('Mismatched release Chat mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (!chat.state.capabilities.supportsRelease || chat.state.lifecycle !== 'available') {
			throw operationFailure('unsupportedCapability', 'Chat cannot be released');
		}
		if (!chat.materialized) {
			throw operationFailure('invalidState', 'Chat materialization state is inconsistent');
		}
		await agent.chats.release({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: payload.chat });
		const state = freezeChatState({ ...chat.state, lifecycle: 'released', modifiedAt: this.checkedNow() });
		const chats = new Map(session.chats);
		chats.set(payload.chat, Object.freeze({ ...chat, state, materialized: false }));
		const updated = this.withChats(session, chats, state.modifiedAt);
		const next = new Map(this.sessions);
		next.set(payload.session, updated);
		try {
			const committed = await this.commitHostAndBackingState(next, [this.sessionsAction(next), this.sessionAction(updated.state), this.chatAction(state)], this.operationCause(request));
			this.retireChatToolBindings(payload.session, payload.chat);
			this.retireChatCredentialBindings(payload.session, payload.chat);
			return this.simpleMutationResult(request, committed, { kind: 'releaseChat', session: payload.session, chat: payload.chat });
		} catch (error) {
			await agent.chats.materialize({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: payload.chat, resume: chat.resume });
			throw error;
		}
	}

	private async deleteSession(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'deleteSession') { throw new Error('Mismatched delete Session mutation'); }
		const session = this.requireSession(payload.session);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (!session.state.capabilities.supportsDelete) {
			throw operationFailure('unsupportedCapability', 'Session cannot be deleted');
		}
		for (const chat of session.chats.values()) {
			await agent.chats.delete({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: chat.state.id });
		}
		await agent.sessions.delete({ operation: request.operation, payloadDigest: request.digest, session: payload.session });
		const next = new Map(this.sessions);
		next.delete(payload.session);
		const committed = await this.commitHostAndBackingState(next, [this.sessionsAction(next)], this.operationCause(request));
		this.retireSessionToolBindings(payload.session);
		this.retireSessionCredentialBindings(payload.session);
		return this.simpleMutationResult(request, committed, { kind: 'deleteSession', session: payload.session });
	}

	private async deleteChat(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'deleteChat') { throw new Error('Mismatched delete Chat mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (!chat.state.capabilities.supportsDelete) {
			throw operationFailure('unsupportedCapability', 'Chat cannot be deleted');
		}
		await agent.chats.delete({ operation: request.operation, payloadDigest: request.digest, session: payload.session, chat: payload.chat });
		const chats = new Map(session.chats);
		chats.delete(payload.chat);
		const updated = this.withChats(session, chats, this.checkedNow());
		const next = new Map(this.sessions);
		next.set(payload.session, updated);
		const committed = await this.commitHostAndBackingState(next, [this.sessionsAction(next), this.sessionAction(updated.state)], this.operationCause(request));
		this.retireChatToolBindings(payload.session, payload.chat);
		this.retireChatCredentialBindings(payload.session, payload.chat);
		return this.simpleMutationResult(request, committed, { kind: 'deleteChat', session: payload.session, chat: payload.chat });
	}

	private async submitTurn(connection: AgentHostClientConnectionId, request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'submitTurn') { throw new Error('Mismatched submit Turn mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		this.requirePreparedSubmission(connection, payload.submission, { kind: 'chat', session: payload.session, chat: payload.chat });
		if (!chat.state.capabilities.supportsSubmit || chat.state.lifecycle !== 'available') {
			throw operationFailure('invalidState', 'Chat cannot accept a Turn');
		}
		const hasActive = chat.state.turns.some(turn => activeTurnStates.has(turn.state));
		if (hasActive && !agent.descriptor.get().capabilities.supportsQueue) {
			throw operationFailure('invalidState', 'Chat already has a non-terminal Turn');
		}
		const turn = this.options.identityFactory.createTurn();
		const accepted = this.createAcceptedTurn(turn, payload.submission, hasActive ? 'queued' : 'accepted');
		const state = freezeChatState({
			...chat.state,
			turns: Object.freeze([...chat.state.turns, accepted]),
			status: 'running', isRead: false, modifiedAt: this.checkedNow(),
		});
		const agentRequest = this.createAgentChatRequest(agent, request, payload.session, payload.chat, turn, payload.submission);
		let toolBinding: IDisposable | undefined;
		let credentialBinding: IDisposable | undefined;
		let committed: ICommittedHostState;
		try {
			await this.bindTurnContent(agentRequest);
			toolBinding = this.bindToolTurn(agent, agentRequest);
			credentialBinding = this.bindCredentialTurn(agent, agentRequest);
			committed = await this.commitChatState(request, session, chat, state);
		} catch (error) {
			credentialBinding?.dispose();
			toolBinding?.dispose();
			try {
				await this.releaseTurnContent(agentRequest.session, agentRequest.chat, agentRequest.turn);
			} catch (releaseError) {
				throw new AggregateError([error, releaseError], 'Turn commit and content-anchor cleanup both failed');
			}
			throw error;
		}
		this.markPreparedAccepted(payload.submission.submission);
		return {
			result: Object.freeze({
				kind: 'submitTurn', operation: request.operation, digest: request.digest,
				hostSequence: committed.hostSequence, revisions: committed.revisions,
				session: payload.session, chat: payload.chat, turn, submission: payload.submission.submission,
			}),
			afterCommit: Object.freeze([() => this.startTurn(agent, agentRequest)]),
		};
	}

	private async steerTurn(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'steerTurn') { throw new Error('Mismatched steer Turn mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		if (!agent.descriptor.get().capabilities.supportsSteering) {
			throw operationFailure('unsupportedCapability', 'Agent does not support Turn steering');
		}
		if (chat.state.lifecycle !== 'available') {
			throw operationFailure('invalidState', 'Chat cannot steer a Turn while it is not available');
		}
		if (payload.message.length === 0 || payload.message.length > 4 * 1024 * 1024) {
			throw operationFailure('invalidPayload', 'Turn steering message is empty or exceeds the protocol limit');
		}
		const turn = chat.state.turns.find(candidate => candidate.id === payload.turn);
		if (
			turn === undefined
			|| chat.state.activeTurn !== payload.turn
			|| !['running', 'waitingForPermission', 'waitingForInput'].includes(turn.state)
		) {
			throw operationFailure('invalidState', `Turn '${payload.turn}' is not the exact active steerable Turn`);
		}
		const agentRequest: IAgentSteerRequest = Object.freeze({
			operation: request.operation,
			payloadDigest: request.digest,
			session: payload.session,
			chat: payload.chat,
			turn: payload.turn,
			message: payload.message,
		});
		await agent.chats.steer(agentRequest);
		return this.simpleMutationResult(
			request,
			Object.freeze({ hostSequence: this.catalog.hostSequence, revisions: Object.freeze([]) }),
			{ kind: 'steerTurn', session: payload.session, chat: payload.chat, turn: payload.turn },
		);
	}

	private async cancelTurn(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'cancelTurn') { throw new Error('Mismatched cancel Turn mutation'); }
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		const turnIndex = chat.state.turns.findIndex(turn => turn.id === payload.turn);
		if (turnIndex === -1) {
			throw operationFailure('missingResource', `Turn '${payload.turn}' does not exist`);
		}
		if (!agent.descriptor.get().capabilities.supportsCancellation || terminalTurnStates.has(chat.state.turns[turnIndex].state)) {
			throw operationFailure('unsupportedCapability', 'Turn cannot be cancelled');
		}
		const turns = [...chat.state.turns];
		turns[turnIndex] = Object.freeze({ ...turns[turnIndex], state: 'cancelling' });
		const state = freezeChatState({ ...chat.state, turns: Object.freeze(turns), activeTurn: payload.turn, modifiedAt: this.checkedNow() });
		const committed = await this.commitChatState(request, session, chat, state);
		const cancelRequest: IAgentCancelTurnRequest = {
			operation: request.operation, payloadDigest: request.digest,
			session: payload.session, chat: payload.chat, turn: payload.turn,
		};
		return {
			result: Object.freeze({
				kind: 'cancelTurn', operation: request.operation, digest: request.digest,
				hostSequence: committed.hostSequence, revisions: committed.revisions,
				session: payload.session, chat: payload.chat, turn: payload.turn,
			}),
			afterCommit: Object.freeze([() => this.startCancellation(agent, cancelRequest)]),
		};
	}

	private async respondInteraction(request: IAgentHostMutationRequest): Promise<IMutationExecution> {
		const payload = request.payload;
		if (payload.kind !== 'respondInteraction') {
			throw new Error('Mismatched respond interaction mutation');
		}
		const session = this.requireSession(payload.session);
		const chat = this.requireChat(session, payload.chat);
		const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
		const turnIndex = chat.state.turns.findIndex(turn => turn.id === payload.turn);
		if (turnIndex === -1) {
			throw operationFailure('missingResource', `Turn '${payload.turn}' does not exist`);
		}
		const turn = chat.state.turns[turnIndex];
		if (terminalTurnStates.has(turn.state)) {
			throw operationFailure('invalidState', `Turn '${payload.turn}' is terminal`);
		}
		const interactionIndex = turn.interactions.findIndex(interaction => interaction.request.id === payload.interaction);
		if (interactionIndex === -1) {
			throw operationFailure('missingResource', `Interaction '${payload.interaction}' does not exist`);
		}
		if (turn.interactions[interactionIndex].state !== 'pending') {
			throw operationFailure('invalidState', `Interaction '${payload.interaction}' is terminal`);
		}
		const interactions = [...turn.interactions];
		interactions[interactionIndex] = Object.freeze({
			...interactions[interactionIndex],
			state: payload.response.kind === 'cancelled' ? 'cancelled' : 'resolved',
			response: Object.freeze({ ...payload.response }),
		});
		const turns = [...chat.state.turns];
		turns[turnIndex] = Object.freeze({ ...turn, state: 'running', interactions: Object.freeze(interactions) });
		const state = freezeChatState({
			...chat.state,
			turns: Object.freeze(turns),
			activeTurn: payload.turn,
			status: 'running',
			modifiedAt: this.checkedNow(),
		});
		const agentRequest: IAgentInteractionResponseRequest = Object.freeze({
			operation: request.operation,
			payloadDigest: request.digest,
			session: payload.session,
			chat: payload.chat,
			turn: payload.turn,
			interaction: payload.interaction,
			response: payload.response,
		});
		await agent.interactions.respond(agentRequest);
		const committed = await this.commitChatState(request, session, chat, state);
		return this.simpleMutationResult(request, committed, {
			kind: 'respondInteraction',
			session: payload.session,
			chat: payload.chat,
			turn: payload.turn,
			interaction: payload.interaction,
		});
	}

	private requirePreparedSubmission(
		connection: AgentHostClientConnectionId,
		submission: IAgentHostPreparedSubmission,
		target: AgentHostSubmissionTarget,
	): IPreparedSubmissionRecord {
		const record = this.preparations.get(submission.submission);
		if (
			record === undefined || record.connection !== connection || record.accepted
			|| record.result?.kind !== 'prepared'
			|| !sameProtocolValue(record.result.submission, submission)
			|| !sameProtocolValue(record.target, target)
		) {
			throw operationFailure('conflict', 'Prepared submission is missing, changed, accepted, or bound to another target');
		}
		return record;
	}

	private markPreparedAccepted(submission: AgentSubmissionId): void {
		const record = this.preparations.get(submission);
		if (record === undefined || record.accepted) {
			throw new Error(`Prepared submission '${submission}' cannot be accepted`);
		}
		record.accepted = true;
	}

	private createAcceptedTurn(
		turn: AgentTurnId,
		submission: IAgentHostPreparedSubmission,
		state: 'accepted' | 'queued' = 'accepted',
	): IAgentHostTurn {
		return Object.freeze({
			id: turn,
			submission: submission.submission,
			payloadDigest: submission.payloadDigest,
			state,
			user: Object.freeze({
				text: submission.message,
				attachments: submission.attachments,
				interactionTargets: submission.interactionTargets,
			}),
			behaviors: Object.freeze([]),
			interactions: Object.freeze([]),
		});
	}

	private createAgentChatRequest(
		agent: IAgent,
		request: IAgentHostMutationRequest,
		session: AgentSessionId,
		chat: AgentChatId,
		turn: AgentTurnId,
		submission: IAgentHostPreparedSubmission,
	): IAgentChatRequest {
		return Object.freeze({
			operation: request.operation,
			payloadDigest: request.digest,
			session,
			chat,
			turn,
			submission: submission.submission,
			message: submission.message,
			attachments: submission.attachments,
			interactionTargets: submission.interactionTargets,
			binding: Object.freeze({
				profile: submission.executionProfile,
				modelConfiguration: submission.modelConfiguration,
				credentials: submission.credentials,
				runtimeRegistration: agent.registration.revision,
				toolSet: submission.toolSet,
				deadline: submission.requestedDeadline,
				cancellation: this.options.identityFactory.createCancellation(),
				outputConstraints: submission.outputConstraints,
			}),
		});
	}

	private startTurn(agent: IAgent, request: IAgentChatRequest): void {
		void agent.chats.send(request).catch(error => {
			void this.enqueueCatalogMutation(() => this.applyAgentAction(agent, {
				kind: 'turnTerminal', session: request.session, chat: request.chat, turn: request.turn,
				state: 'failed', data: Object.freeze({ message: error instanceof Error ? error.message : String(error) }),
			})).catch(reportError => this.options.reportUnexpectedError(reportError));
		});
	}

	private async bindTurnContent(request: IAgentChatRequest): Promise<void> {
		const key = turnKey(request.session, request.chat, request.turn);
		if (this.turnContentAnchors.has(key)) {
			throw new Error(`Content resources are already bound to Turn '${request.turn}'`);
		}
		const leases: AgentContentLeaseId[] = [];
		try {
			for (const attachment of request.attachments) {
				if (attachment.content?.kind !== 'reference') {
					continue;
				}
				const opened = await this.options.contentResources.open({
					session: request.session,
					chat: request.chat,
					turn: request.turn,
					attachment: attachment.id,
					content: attachment.content,
				}, CancellationTokenNone);
				leases.push(opened.lease);
			}
			if (leases.length !== 0) {
				this.turnContentAnchors.set(key, Object.freeze([...leases]));
			}
		} catch (error) {
			const failures: unknown[] = [error];
			for (const lease of [...leases].reverse()) {
				try {
					await this.options.contentResources.release(lease, CancellationTokenNone);
				} catch (releaseError) {
					failures.push(releaseError);
				}
			}
			throw failures.length === 1
				? error
				: new AggregateError(failures, 'Content binding and cleanup both failed');
		}
	}

	private async releaseTurnContent(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): Promise<void> {
		const key = turnKey(session, chat, turn);
		const leases = this.turnContentAnchors.get(key);
		if (leases === undefined) {
			return;
		}
		this.turnContentAnchors.delete(key);
		const failures: unknown[] = [];
		for (const lease of [...leases].reverse()) {
			try {
				await this.options.contentResources.release(lease, CancellationTokenNone);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length !== 0) {
			throw new AggregateError(failures, `Content-anchor release failed for Turn '${turn}'`);
		}
	}

	private bindToolTurn(agent: IAgent, request: IAgentChatRequest): IDisposable {
		const key = turnKey(request.session, request.chat, request.turn);
		if (this.toolTurnBindings.has(key)) {
			throw new Error(`Tool authority already has Turn '${request.turn}'`);
		}
		const binding = this.options.toolCallAuthority.bindTurn({
			agent: agent.id,
			runtimeRegistration: request.binding.runtimeRegistration,
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			submission: request.submission,
			toolSet: request.binding.toolSet.revision,
			attachments: request.attachments,
		});
		let tracked: IDisposable;
		tracked = toDisposable(() => {
			if (this.toolTurnBindings.get(key) === tracked) {
				this.toolTurnBindings.delete(key);
			}
			binding.dispose();
		});
		this.toolTurnBindings.set(key, tracked);
		return tracked;
	}

	private bindCredentialTurn(agent: IAgent, request: IAgentChatRequest): IDisposable | undefined {
		if (request.binding.credentials.length === 0) {
			return undefined;
		}
		const authority = this.options.credentials;
		if (authority === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.CapabilityUnsupported,
				'Agent Host does not expose a credential authority',
				{ capability: 'agentCredentials' },
			);
		}
		const installed = this.options.packageLifecycle.snapshot().installedPackages.filter(candidate => (
			candidate.packageId === agent.registration.packageId
		));
		if (installed.length !== 1) {
			throw new Error(`Agent package '${agent.registration.packageId}' is not installed exactly once`);
		}
		const key = turnKey(request.session, request.chat, request.turn);
		if (this.credentialTurnBindings.has(key)) {
			throw new Error(`Credential authority already has Turn '${request.turn}'`);
		}
		const binding = authority.bindTurn({
			packageId: agent.registration.packageId,
			agentId: agent.id,
			runtimeRegistration: request.binding.runtimeRegistration,
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			credentials: request.binding.credentials,
			grantedPrivileges: installed[0].grantedPrivileges,
		});
		let tracked: IDisposable;
		tracked = toDisposable(() => {
			if (this.credentialTurnBindings.get(key) === tracked) {
				this.credentialTurnBindings.delete(key);
			}
			binding.dispose();
		});
		this.credentialTurnBindings.set(key, tracked);
		return tracked;
	}

	private retireTurnToolBinding(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): void {
		this.toolTurnBindings.get(turnKey(session, chat, turn))?.dispose();
	}

	private retireTurnCredentialBinding(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): void {
		this.credentialTurnBindings.get(turnKey(session, chat, turn))?.dispose();
	}

	private retireChatToolBindings(session: AgentSessionId, chat: AgentChatId): void {
		const prefix = `${session}\u0000${chat}\u0000`;
		for (const [key, binding] of [...this.toolTurnBindings]) {
			if (key.startsWith(prefix)) {
				binding.dispose();
			}
		}
	}

	private retireChatCredentialBindings(session: AgentSessionId, chat: AgentChatId): void {
		const prefix = `${session}\u0000${chat}\u0000`;
		for (const [key, binding] of [...this.credentialTurnBindings]) {
			if (key.startsWith(prefix)) {
				binding.dispose();
			}
		}
	}

	private retireSessionToolBindings(session: AgentSessionId): void {
		const prefix = `${session}\u0000`;
		for (const [key, binding] of [...this.toolTurnBindings]) {
			if (key.startsWith(prefix)) {
				binding.dispose();
			}
		}
	}

	private retireSessionCredentialBindings(session: AgentSessionId): void {
		const prefix = `${session}\u0000`;
		for (const [key, binding] of [...this.credentialTurnBindings]) {
			if (key.startsWith(prefix)) {
				binding.dispose();
			}
		}
	}

	private startCancellation(agent: IAgent, request: IAgentCancelTurnRequest): void {
		void agent.chats.cancel(request).catch(error => {
			void this.enqueueCatalogMutation(() => this.applyAgentAction(agent, {
				kind: 'turnTerminal', session: request.session, chat: request.chat, turn: request.turn,
				state: 'failed', data: Object.freeze({ message: error instanceof Error ? error.message : String(error) }),
			})).catch(reportError => this.options.reportUnexpectedError(reportError));
		});
	}

	private async applyAgentAction(agent: IAgent, action: IAgentAction): Promise<void> {
		const session = this.requireSession(action.session);
		if (session.state.agentId !== agent.id || session.state.packageId !== agent.registration.packageId) {
			throw new Error(`Agent '${agent.id}' emitted an action for another Agent backing`);
		}
		this.requireActiveAgent(agent.id, agent.registration.packageId);
		if (action.kind === 'sessionResumeStateChanged') {
			const next = new Map(this.sessions);
			next.set(action.session, { ...session, resume: action.resume });
			await this.commitHostAndBackingState(next, [], this.runtimeCause(agent, action.session));
			return;
		}
		const chat = this.requireChat(session, action.chat);
		if (action.kind === 'chatResumeStateChanged') {
			const chats = new Map(session.chats);
			chats.set(action.chat, Object.freeze({ ...chat, resume: action.resume }));
			const next = new Map(this.sessions);
			next.set(action.session, { ...session, chats });
			await this.commitHostAndBackingState(next, [], this.runtimeCause(agent, action.session, action.chat));
			return;
		}
		const index = chat.state.turns.findIndex(turn => turn.id === action.turn);
		if (index === -1) {
			throw new Error(`Agent '${agent.id}' emitted an action for missing Turn '${action.turn}'`);
		}
		const current = chat.state.turns[index];
		if (terminalTurnStates.has(current.state)) {
			throw new Error(`Agent '${agent.id}' emitted a late action for terminal Turn '${action.turn}'`);
		}
		const turns = [...chat.state.turns];
		let activeTurn = chat.state.activeTurn;
		let status = chat.state.status;
		if (action.kind === 'turnProgress') {
			const progress = this.validateTurnProgress(action.progress);
			if (progress.kind === 'state') {
				turns[index] = Object.freeze({ ...current, state: progress.state });
				activeTurn = ['running', 'waitingForPermission', 'waitingForInput', 'cancelling'].includes(progress.state)
					? action.turn
					: undefined;
				status = progress.state === 'waitingForPermission' || progress.state === 'waitingForInput' ? 'needsInput' : 'running';
			} else {
				turns[index] = Object.freeze({ ...current, behaviors: Object.freeze([...current.behaviors, progress.behavior]) });
			}
		} else if (action.kind === 'interactionRequested') {
			if (current.interactions.some(interaction => interaction.request.id === action.request.id)) {
				throw new Error(`Agent '${agent.id}' emitted duplicate interaction '${action.request.id}'`);
			}
			turns[index] = Object.freeze({
				...current,
				state: action.request.kind === 'input' ? 'waitingForInput' : 'waitingForPermission',
				interactions: Object.freeze([...current.interactions, Object.freeze({
					request: Object.freeze({ ...action.request }),
					state: 'pending' as const,
				})]),
			});
			activeTurn = action.turn;
			status = 'needsInput';
		} else if (action.kind === 'interactionCompleted') {
			const interactionIndex = current.interactions.findIndex(interaction => interaction.request.id === action.interaction);
			if (interactionIndex === -1 || current.interactions[interactionIndex].state !== 'pending') {
				throw new Error(`Agent '${agent.id}' completed a missing or terminal interaction '${action.interaction}'`);
			}
			const interactions = [...current.interactions];
			interactions[interactionIndex] = Object.freeze({
				...interactions[interactionIndex],
				state: action.response.kind === 'cancelled' ? 'cancelled' : 'resolved',
				response: Object.freeze({ ...action.response }),
			});
			turns[index] = Object.freeze({ ...current, state: 'running', interactions: Object.freeze(interactions) });
			activeTurn = action.turn;
			status = 'running';
		} else {
			if (current.interactions.some(interaction => interaction.state === 'pending')) {
				throw new Error(`Agent '${agent.id}' terminated Turn '${action.turn}' with a pending interaction`);
			}
			if (action.state !== 'failed' && action.data !== undefined) {
				throw new Error(`Agent '${agent.id}' emitted unmodeled terminal data for Turn '${action.turn}'`);
			}
			if (action.data !== undefined) {
				assertAgentHostProtocolValue(action.data);
			}
			const { failure: currentFailure, ...turnWithoutFailure } = current;
			void currentFailure;
			turns[index] = action.state === 'failed'
				? Object.freeze({
					...turnWithoutFailure,
					state: action.state,
					failure: Object.freeze({
						code: 'agentUnavailable',
						message: 'Agent execution failed',
						...(action.data === undefined ? {} : { data: action.data }),
						reconciliation: 'terminal',
					}),
				})
				: Object.freeze({ ...turnWithoutFailure, state: action.state });
			if (activeTurn === action.turn) {
				activeTurn = undefined;
			}
			status = action.state === 'failed' ? 'failed' : 'completed';
		}
		const { activeTurn: currentActiveTurn, ...chatWithoutActiveTurn } = chat.state;
		void currentActiveTurn;
		const state = freezeChatState({
			...chatWithoutActiveTurn,
			turns: Object.freeze(turns),
			...(activeTurn === undefined ? {} : { activeTurn }),
			status,
			modifiedAt: this.checkedNow(),
		});
		const chats = new Map(session.chats);
		chats.set(action.chat, Object.freeze({ ...chat, state }));
		const updated = this.withChats(session, chats, state.modifiedAt);
		const next = new Map(this.sessions);
		next.set(action.session, updated);
		await this.commitHostState(next, [this.sessionsAction(next), this.sessionAction(updated.state), this.chatAction(state)], this.runtimeCause(agent, action.session, action.chat, action.turn));
		if (action.kind === 'turnTerminal') {
			this.retireTurnToolBinding(action.session, action.chat, action.turn);
			this.retireTurnCredentialBinding(action.session, action.chat, action.turn);
			try {
				await this.releaseTurnContent(action.session, action.chat, action.turn);
			} finally {
				this.notifyQuiescenceChanged();
			}
			return;
		}
		this.notifyQuiescenceChanged();
	}

	private validateTurnProgress(data: AgentTurnProgress): AgentTurnProgress {
		assertAgentHostProtocolValue(data);
		if (data === null || typeof data !== 'object' || Array.isArray(data)) {
			throw new Error('Agent Turn progress must be a typed protocol object');
		}
		const record = data as Readonly<Record<string, AgentHostProtocolValue>>;
		if (
			record.kind === 'state'
			&& hasExactKeys(record, ['kind', 'state'])
			&& typeof record.state === 'string'
			&& [
			'accepted', 'queued', 'running', 'waitingForPermission', 'waitingForInput', 'cancelling',
			].includes(record.state)
		) {
			return { kind: 'state', state: record.state as Exclude<AgentHostTurnState, 'completed' | 'cancelled' | 'failed'> };
		}
		if (
			record.kind === 'behavior'
			&& hasExactKeys(record, ['kind', 'behavior'])
			&& record.behavior !== null
			&& typeof record.behavior === 'object'
			&& !Array.isArray(record.behavior)
		) {
			return {
				kind: 'behavior',
				behavior: Object.freeze({ ...record.behavior }) as Extract<AgentTurnProgress, { kind: 'behavior' }>['behavior'],
			};
		}
		throw new Error('Agent Turn progress has an unsupported typed value');
	}

	private createChatState(
		agent: IAgent,
		session: AgentSessionId,
		chat: AgentChatId,
		origin: IAgentHostChatState['origin'],
		title: string,
		model: IAgentHostChatState['model'],
		now: number,
		turns: readonly IAgentHostTurn[],
	): IAgentHostChatState {
		const capabilities = agent.descriptor.get().capabilities;
		return freezeChatState({
			id: chat, createdAt: now, title, origin, model,
			lifecycle: 'available', interactivity: 'full',
			status: turns.length === 0 ? 'completed' : 'running', isRead: turns.length === 0,
			capabilities: Object.freeze({
				supportsRename: true,
				supportsSetModel: true,
				supportsFork: capabilities.supportsForkChat,
				supportsRelease: capabilities.supportsReleaseChat,
				supportsDelete: capabilities.supportsDeleteChat,
				supportsSubmit: true,
				supportsCancel: capabilities.supportsCancellation,
			}),
			modifiedAt: now, session, turns,
		});
	}

	private createSessionState(
		agent: IAgent,
		sessionType: IAgentHostSessionTypeDescriptor,
		session: AgentSessionId,
		workspace: IAgentHostSessionState['workspace'],
		configuration: IAgentConfigurationState,
		title: string,
		now: number,
		chats: ReadonlyMap<AgentChatId, IRuntimeChatRecord>,
	): IAgentHostSessionState {
		const capabilities = agent.descriptor.get().capabilities;
		const state: Omit<IAgentHostSessionState, 'workspace'> = {
			id: session, packageId: agent.registration.packageId, agentId: agent.id, type: sessionType.id,
			createdAt: now, title, archived: false, lifecycle: 'available', status: this.aggregateStatus(chats),
			isRead: [...chats.values()].every(chat => chat.state.isRead), modifiedAt: now,
			configuration,
			capabilities: Object.freeze({
				supportsCreateChat: capabilities.supportsCreateChat && sessionType.capabilities.supportsCreateChat,
				maximumChatCount: this.maximumChatCount(sessionType, agent),
				supportsFork: capabilities.supportsForkChat && sessionType.capabilities.supportsForkChat,
				supportsRename: true,
				supportsArchive: true,
				supportsDelete: capabilities.supportsDeleteSession,
				supportsChanges: false,
				supportsModels: agent.descriptor.get().models.length !== 0,
			}),
			changes: Object.freeze([]), chats: Object.freeze([...chats.values()].map(chat => chatSummary(chat.state))),
		};
		return Object.freeze(workspace === undefined ? state : { ...state, workspace });
	}

	private validateWorkspace(
		sessionType: IAgentHostSessionTypeDescriptor,
		workspace: IAgentHostSessionState['workspace'],
	): void {
		if (sessionType.capabilities.workspace === 'required' && workspace === undefined) {
			throw operationFailure('invalidPayload', `Session type '${sessionType.id}' requires a workspace`);
		}
		if (sessionType.capabilities.workspace === 'unsupported' && workspace !== undefined) {
			throw operationFailure('unsupportedCapability', `Session type '${sessionType.id}' does not support a workspace`);
		}
		if (workspace !== undefined) {
			assertAgentHostProtocolValue(workspace);
		}
	}

	private validateChatModel(
		sessionType: IAgentHostSessionTypeDescriptor,
		agent: IAgent,
		model: IAgentHostChatState['model'],
	): void {
		if (model === null) {
			return;
		}
		if (!sessionType.models.includes(model)) {
			throw operationFailure('unsupportedCapability', `Model '${model}' is not supported by Session type '${sessionType.id}'`);
		}
		if (!agent.descriptor.get().models.some(candidate => candidate.id === model && candidate.enabled)) {
			throw operationFailure('agentUnavailable', `Model '${model}' is unavailable`);
		}
	}

	private maximumChatCount(sessionType: IAgentHostSessionTypeDescriptor, agent: IAgent): number | undefined {
		const typeMaximum = sessionType.capabilities.maximumChatCount;
		const agentMaximum = agent.descriptor.get().capabilities.maximumChatCount;
		if (typeMaximum === undefined) {
			return agentMaximum;
		}
		if (agentMaximum === undefined) {
			return typeMaximum;
		}
		return Math.min(typeMaximum, agentMaximum);
	}

	private withChats(
		session: IRuntimeSessionRecord,
		chats: ReadonlyMap<AgentChatId, IRuntimeChatRecord>,
		modifiedAt: number,
	): IRuntimeSessionRecord {
		return {
			...session,
			chats,
			state: Object.freeze({
				...session.state,
				status: this.aggregateStatus(chats),
				isRead: [...chats.values()].every(chat => chat.state.isRead),
				modifiedAt,
				chats: Object.freeze([...chats.values()].map(chat => chatSummary(chat.state))),
			}),
		};
	}

	private aggregateStatus(chats: ReadonlyMap<AgentChatId, IRuntimeChatRecord>): IAgentHostSessionState['status'] {
		const statuses = [...chats.values()].map(chat => chat.state.status);
		if (statuses.includes('running')) { return 'running'; }
		if (statuses.includes('needsInput')) { return 'needsInput'; }
		if (statuses.includes('failed')) { return 'failed'; }
		return 'completed';
	}

	private requireAvailableSession(session: IRuntimeSessionRecord): void {
		if (session.state.lifecycle !== 'available') {
			throw operationFailure('invalidState', `Session '${session.state.id}' is not materialized`);
		}
	}

	private requireChatCapacity(session: IRuntimeSessionRecord): void {
		const maximum = session.state.capabilities.maximumChatCount;
		if (maximum !== undefined && session.chats.size >= maximum) {
			throw operationFailure('capacityExceeded', `Session '${session.state.id}' reached its Chat capacity`);
		}
	}

	private checkedNow(): number {
		const now = this.options.now();
		assertSafeTimestamp(now);
		return now;
	}

	private async commitSessionOnly(
		request: IAgentHostMutationRequest,
		session: IRuntimeSessionRecord,
		state: IAgentHostSessionState,
		kind: 'renameSession' | 'setSessionArchived',
	): Promise<IMutationExecution> {
		const next = new Map(this.sessions);
		next.set(state.id, { ...session, state });
		const committed = await this.commitHostState(next, [this.sessionsAction(next), this.sessionAction(state)], this.operationCause(request));
		return this.simpleMutationResult(request, committed, { kind, session: state.id });
	}

	private async commitChatChange(
		request: IAgentHostMutationRequest,
		session: IRuntimeSessionRecord,
		chat: IRuntimeChatRecord,
		state: IAgentHostChatState,
		kind: 'renameChat' | 'setChatModel' | 'releaseChat',
	): Promise<IMutationExecution> {
		const committed = await this.commitChatState(request, session, chat, state);
		return this.simpleMutationResult(request, committed, { kind, session: session.state.id, chat: state.id });
	}

	private async commitChatState(
		request: IAgentHostMutationRequest,
		session: IRuntimeSessionRecord,
		chat: IRuntimeChatRecord,
		state: IAgentHostChatState,
	): Promise<ICommittedHostState> {
		const chats = new Map(session.chats);
		chats.set(state.id, Object.freeze({ ...chat, state }));
		const updated = this.withChats(session, chats, state.modifiedAt);
		const next = new Map(this.sessions);
		next.set(session.state.id, updated);
		return this.commitHostState(next, [this.sessionsAction(next), this.sessionAction(updated.state), this.chatAction(state)], this.operationCause(request));
	}

	private simpleMutationResult(
		request: IAgentHostMutationRequest,
		committed: ICommittedHostState,
		shape: SimpleMutationResultShape,
	): IMutationExecution {
		return {
			result: Object.freeze({
				...shape, operation: request.operation, digest: request.digest,
				hostSequence: committed.hostSequence, revisions: committed.revisions,
			}) as AgentHostMutationResult,
			afterCommit: Object.freeze([]),
		};
	}

	private async cleanupChatAndRethrow(
		operationError: unknown,
		agent: IAgent,
		request: IAgentHostMutationRequest,
		session: AgentSessionId,
		chat: AgentChatId,
	): Promise<never> {
		try {
			await agent.chats.delete({ operation: request.operation, payloadDigest: request.digest, session, chat });
		} catch (cleanupError) {
			throw new AggregateError([operationError, cleanupError], 'Agent Host operation and provisional Chat cleanup both failed');
		}
		throw operationError;
	}

	private async cleanupAndRethrow(
		operationError: unknown,
		agent: IAgent,
		request: IAgentHostMutationRequest,
		session: AgentSessionId,
		chats: readonly AgentChatId[],
	): Promise<never> {
		try {
			await this.deleteProvisionalBackings(agent, request, session, chats);
		} catch (cleanupError) {
			throw new AggregateError([operationError, cleanupError], 'Agent Host operation and provisional Session cleanup both failed');
		}
		throw operationError;
	}

	private async deleteProvisionalBackings(
		agent: IAgent,
		request: IAgentHostMutationRequest,
		session: AgentSessionId,
		chats: readonly AgentChatId[],
	): Promise<void> {
		const errors: unknown[] = [];
		for (const chat of [...chats].reverse()) {
			try {
				await agent.chats.delete({ operation: request.operation, payloadDigest: request.digest, session, chat });
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			await agent.sessions.delete({ operation: request.operation, payloadDigest: request.digest, session });
		} catch (error) {
			errors.push(error);
		}
		if (errors.length !== 0) {
			throw new AggregateError(errors, 'Failed to delete provisional Agent backing');
		}
	}

	private operationCause(request: IAgentHostMutationRequest): {
		readonly kind: 'operation';
		readonly operation: AgentHostOperationId;
		readonly submission?: AgentSubmissionId;
		readonly payloadDigest: AgentHostPayloadDigest;
	} {
		const submission = request.payload.kind === 'submitTurn'
			? request.payload.submission.submission
			: request.payload.kind === 'createSession'
				? request.payload.chats.find(chat => chat.initialSubmission !== undefined)?.initialSubmission?.submission
				: undefined;
		return Object.freeze({
			kind: 'operation',
			operation: request.operation,
			...(submission === undefined ? {} : { submission }),
			payloadDigest: request.digest,
		});
	}

	private runtimeCause(agent: IAgent, session: AgentSessionId, chat?: AgentChatId, turn?: AgentTurnId): {
		readonly kind: 'runtime';
		readonly registration: AgentRuntimeRegistrationRevision;
		readonly agent: AgentId;
		readonly session: AgentSessionId;
		readonly chat?: AgentChatId;
		readonly turn?: AgentTurnId;
	} {
		return Object.freeze({
			kind: 'runtime',
			registration: agent.registration.revision,
			agent: agent.id,
			session,
			...(chat === undefined ? {} : { chat }),
			...(turn === undefined ? {} : { turn }),
		});
	}

	private sessionsAction(sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>): HostStateAction {
		return {
			channel: getAgentHostSessionsChannelId(), kind: 'sessions',
			action: Object.freeze({ kind: 'sessionCatalogStateChanged', state: Object.freeze({
				sessions: Object.freeze([...sessions.values()].map(record => this.sessionSummary(record.state))),
			}) }),
		};
	}

	private rootAction(state: IAgentHostRootState = this.createRootState()): HostStateAction {
		return {
			channel: getAgentHostRootChannelId(),
			kind: 'root',
			action: Object.freeze({ kind: 'rootStateChanged', state }),
		};
	}

	private sessionAction(state: IAgentHostSessionState): HostStateAction {
		return { channel: getAgentHostSessionChannelId(state.id), kind: 'session', action: Object.freeze({ kind: 'sessionStateChanged', state }) };
	}

	private chatAction(state: IAgentHostChatState): HostStateAction {
		return { channel: getAgentHostChatChannelId(state.session, state.id), kind: 'chat', action: Object.freeze({ kind: 'chatStateChanged', state }) };
	}

	private packageBackingState(
		sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>,
	): {
		readonly retainedBackingRecords: readonly IAgentPackageBackingRecord[];
		readonly materializedBackings: readonly IAgentBackingIdentity[];
	} {
		const retainedBackingRecords: IAgentPackageBackingRecord[] = [];
		const materializedBackings: IAgentBackingIdentity[] = [];
		for (const session of sessions.values()) {
			const sessionIdentity: IAgentBackingIdentity = Object.freeze({
				packageId: session.state.packageId,
				agentId: session.state.agentId,
				sessionId: session.state.id,
			});
			retainedBackingRecords.push(this.packageBackingRecord(sessionIdentity, session.resume));
			if (session.materialized) {
				materializedBackings.push(sessionIdentity);
			}
			for (const chat of session.chats.values()) {
				const chatIdentity: IAgentBackingIdentity = Object.freeze({
					...sessionIdentity,
					chatId: chat.state.id,
				});
				retainedBackingRecords.push(this.packageBackingRecord(chatIdentity, chat.resume));
				if (chat.materialized) {
					materializedBackings.push(chatIdentity);
				}
			}
		}
		return Object.freeze({
			retainedBackingRecords: Object.freeze(retainedBackingRecords),
			materializedBackings: Object.freeze(materializedBackings),
		});
	}

	private packageBackingRecord(
		identity: IAgentBackingIdentity,
		resumeState: IAgentPackageBackingRecord['resumeState'],
	): IAgentPackageBackingRecord {
		return Object.freeze({
			identity,
			...(resumeState === undefined ? {} : {
				resumeState,
				resumeStateDigest: computeAgentResumeStateDigest(resumeState),
			}),
		});
	}

	private async commitHostBackingRemoval(
		records: readonly IAgentBackingIdentity[],
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): Promise<void> {
		if (records.length === 0) {
			throw new AgentPackageError(
				AgentPackageErrorCode.HostRecordPurgeDenied,
				'Host backing removal requires an explicit non-empty record set',
			);
		}
		const selectedKeys = new Set<string>();
		for (const identity of records) {
			const key = this.backingIdentityKey(identity);
			if (selectedKeys.has(key)) {
				throw new AgentPackageError(
					AgentPackageErrorCode.HostRecordPurgeDenied,
					'Host backing removal contains a duplicate record',
					{ record: key },
				);
			}
			selectedKeys.add(key);
		}

		const sorted = [...records].sort((left, right) => (
			Number(right.chatId !== undefined) - Number(left.chatId !== undefined)
		));
		await this.enqueueCatalogMutation(async () => {
			const completed = this.catalog.backingRemovalOperations.find(candidate => candidate.operation === operation);
			if (completed !== undefined && completed.digest !== digest) {
				throw new AgentPackageError(
					AgentPackageErrorCode.OperationConflict,
					'Host backing-removal operation ID was reused with another digest',
					{ operationId: operation, expected: completed.digest, actual: digest },
				);
			}
			const completedKeys = new Set(completed?.records.map(identity => this.backingIdentityKey(identity)) ?? []);
			const alreadyRemoved = records.filter(identity => completedKeys.has(this.backingIdentityKey(identity)));
			if (alreadyRemoved.length === records.length) {
				return;
			}
			if (alreadyRemoved.length !== 0) {
				throw new AgentPackageError(
					AgentPackageErrorCode.StateConflict,
					'Host backing-removal operation has a partial durable record set',
					{ operationId: operation },
				);
			}
			const next = new Map(this.sessions);
			const changedSessions = new Set<AgentSessionId>();
			for (const identity of sorted) {
				const session = next.get(identity.sessionId);
				if (
					session === undefined
					|| session.state.packageId !== identity.packageId
					|| session.state.agentId !== identity.agentId
				) {
					throw new AgentPackageError(
						AgentPackageErrorCode.HostRecordPurgeDenied,
						'Host backing removal does not address the retained owner',
						{ record: this.backingIdentityKey(identity) },
					);
				}
				if (identity.chatId !== undefined) {
					if (!session.chats.has(identity.chatId)) {
						throw new AgentPackageError(
							AgentPackageErrorCode.HostRecordPurgeDenied,
							'Host backing removal does not address a retained Chat',
							{ record: this.backingIdentityKey(identity) },
						);
					}
					const chats = new Map(session.chats);
					chats.delete(identity.chatId);
					next.set(identity.sessionId, this.withChats(session, chats, this.checkedNow()));
					changedSessions.add(identity.sessionId);
					continue;
				}
				if (session.chats.size !== 0) {
					throw new AgentPackageError(
						AgentPackageErrorCode.HostRecordPurgeDenied,
						'Host Session backing removal must include every retained Chat',
						{ record: this.backingIdentityKey(identity) },
					);
				}
				next.delete(identity.sessionId);
				changedSessions.delete(identity.sessionId);
			}
			const actions: HostStateAction[] = [this.sessionsAction(next)];
			for (const sessionId of changedSessions) {
				const session = next.get(sessionId);
				if (session !== undefined) {
					actions.push(this.sessionAction(session.state));
				}
			}
			actions.push(this.rootAction());
			const operationRecord: IAgentHostBackingRemovalOperation = Object.freeze({
				operation,
				digest,
				records: Object.freeze([...(completed?.records ?? []), ...records.map(identity => Object.freeze({ ...identity }))]),
			});
			const backingRemovalOperations = Object.freeze([
				...this.catalog.backingRemovalOperations.filter(candidate => candidate.operation !== operation),
				operationRecord,
			]);
			await this.commitHostState(
				next,
				actions,
				Object.freeze({ kind: 'operation', operation, payloadDigest: digest }),
				undefined,
				backingRemovalOperations,
			);
		});
		for (const identity of records) {
			if (identity.chatId === undefined) {
				this.retireSessionToolBindings(identity.sessionId);
				this.retireSessionCredentialBindings(identity.sessionId);
			} else {
				this.retireChatToolBindings(identity.sessionId, identity.chatId);
				this.retireChatCredentialBindings(identity.sessionId, identity.chatId);
			}
		}
	}

	private async commitHostAndBackingState(
		sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>,
		actions: readonly HostStateAction[],
		cause: AgentHostChannelAction['cause'],
	): Promise<ICommittedHostState> {
		const snapshot = this.options.packageLifecycle.snapshot();
		const backingState = this.packageBackingState(sessions);
		const transaction = await this.options.packageLifecycle.beginHostBackingStateCommit({
			expectedStateRevision: snapshot.revision,
			...backingState,
		});
		try {
			const committed = await this.commitHostState(sessions, [...actions, this.rootAction()], cause);
			transaction.complete();
			return committed;
		} catch (error) {
			try {
				await transaction.rollback();
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], 'Host catalog and package backing rollback both failed');
			}
			throw error;
		}
	}

	private async restoreCatalogBackings(): Promise<void> {
		for (const [sessionId, session] of [...this.sessions]) {
			if (session.state.lifecycle !== 'available') {
				continue;
			}
			const agent = this.requireActiveAgent(session.state.agentId, session.state.packageId);
			const operation = createAgentHostOperationId(`restore-${createHash('sha256').update(`${this.options.authority}\u0000${sessionId}`).digest('hex')}`);
			const digest = payloadDigest({ kind: 'restoreSession', session: sessionId, catalogRevision: this.catalog.revision });
			const materializedChats: AgentChatId[] = [];
			let sessionMaterialized = false;
			try {
				const sessionType = this.sessionTypes.get(session.state.type);
				if (
					sessionType === undefined
					|| sessionType.packageId !== session.state.packageId
					|| sessionType.agentId !== session.state.agentId
				) {
					throw new Error(`Retained Session '${sessionId}' has no exact active Session type`);
				}
				for (const chat of session.chats.values()) {
					this.validateChatModel(sessionType, agent, chat.state.model);
				}
				const configuration = await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration);
				await agent.sessions.materialize({
					operation,
					payloadDigest: digest,
					session: sessionId,
					configuration,
					resume: session.resume,
				});
				sessionMaterialized = true;
				const chats = new Map(session.chats);
				for (const [chatId, chat] of session.chats) {
					if (chat.state.lifecycle !== 'available') {
						continue;
					}
					await agent.chats.materialize({ operation, payloadDigest: digest, session: sessionId, chat: chatId, resume: chat.resume });
					materializedChats.push(chatId);
					chats.set(chatId, Object.freeze({ ...chat, materialized: true }));
				}
				this.sessions.set(sessionId, { ...session, materialized: true, chats });
			} catch (error) {
				const errors: unknown[] = [error];
				for (const chatId of [...materializedChats].reverse()) {
					try {
						await agent.chats.release({ operation, payloadDigest: digest, session: sessionId, chat: chatId });
					} catch (releaseError) {
						errors.push(releaseError);
					}
				}
				if (sessionMaterialized) {
					try {
						await agent.sessions.release({ operation, payloadDigest: digest, session: sessionId });
					} catch (releaseError) {
						errors.push(releaseError);
					}
				}
				throw errors.length === 1 ? error : new AggregateError(errors, 'Catalog backing restoration and cleanup both failed');
			}
		}
	}

	private async checkpointAndReleasePackageBackings(
		affected: ReadonlySet<AgentId>,
		records: readonly IAgentPackageBackingRecord[],
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): Promise<{
		readonly checkpoints: readonly IAgentPackageBackingRecord[];
		readonly released: readonly IAgentPackageBackingRecord[];
	}> {
		const checkpoints = records.map(record => {
			if (!affected.has(record.identity.agentId)) {
				throw new Error(`Package mutation backing '${record.identity.sessionId}' belongs to an unaffected Agent`);
			}
			return this.requireHostBackingRecord(record.identity, true);
		});
		const requestedKeys = new Set(records.map(record => this.backingIdentityKey(record.identity)));
		for (const record of records) {
			if (record.identity.chatId === undefined) {
				const session = this.requireSession(record.identity.sessionId);
				for (const chat of session.chats.values()) {
					if (chat.materialized) {
						const identity: IAgentBackingIdentity = {
							packageId: session.state.packageId,
							agentId: session.state.agentId,
							sessionId: session.state.id,
							chatId: chat.state.id,
						};
						if (!requestedKeys.has(this.backingIdentityKey(identity))) {
							throw new Error(`Package mutation omitted materialized Chat '${chat.state.id}'`);
						}
					}
				}
			}
		}

		const released: IAgentPackageBackingRecord[] = [];
		try {
			for (const checkpoint of checkpoints.filter(record => record.identity.chatId !== undefined)) {
				const identity = checkpoint.identity;
				const agent = this.requireActiveAgent(identity.agentId, identity.packageId);
				await agent.chats.release({ operation, payloadDigest: digest, session: identity.sessionId, chat: identity.chatId! });
				this.setBackingMaterialized(identity, false);
				released.push(checkpoint);
			}
			for (const checkpoint of checkpoints.filter(record => record.identity.chatId === undefined)) {
				const identity = checkpoint.identity;
				const agent = this.requireActiveAgent(identity.agentId, identity.packageId);
				await agent.sessions.release({ operation, payloadDigest: digest, session: identity.sessionId });
				this.setBackingMaterialized(identity, false);
				released.push(checkpoint);
			}
		} catch (error) {
			try {
				await this.rematerializePackageBackings(released, operation, digest);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], 'Package backing release and rollback both failed');
			}
			throw error;
		}
		await this.catalogTail;
		const finalCheckpoints = records.map(record => this.requireHostBackingRecord(record.identity, false));
		const releasedKeys = new Set(released.map(record => this.backingIdentityKey(record.identity)));
		const finalReleased = finalCheckpoints.filter(record => releasedKeys.has(this.backingIdentityKey(record.identity)));
		return Object.freeze({
			checkpoints: Object.freeze(finalCheckpoints),
			released: Object.freeze(finalReleased),
		});
	}

	private async rematerializePackageBackings(
		records: readonly IAgentPackageBackingRecord[],
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): Promise<void> {
		for (const record of records.filter(candidate => candidate.identity.chatId === undefined)) {
			const identity = record.identity;
			const agent = this.requireActiveAgent(identity.agentId, identity.packageId);
			const session = this.requireSession(identity.sessionId);
			const configuration = await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration);
			await agent.sessions.materialize({
				operation,
				payloadDigest: digest,
				session: identity.sessionId,
				configuration,
				resume: record.resumeState,
			});
			this.setBackingMaterialized(identity, true);
		}
		for (const record of records.filter(candidate => candidate.identity.chatId !== undefined)) {
			const identity = record.identity;
			const agent = this.requireActiveAgent(identity.agentId, identity.packageId);
			await agent.chats.materialize({ operation, payloadDigest: digest, session: identity.sessionId, chat: identity.chatId!, resume: record.resumeState });
			this.setBackingMaterialized(identity, true);
		}
	}

	private async rematerializeRuntimeSession(
		agent: IAgent,
		session: IRuntimeSessionRecord,
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): Promise<void> {
		const configuration = await this.requireRuntimeExactSessionConfiguration(agent, session.state.workspace, session.state.configuration);
		await agent.sessions.materialize({
			operation,
			payloadDigest: digest,
			session: session.state.id,
			configuration,
			resume: session.resume,
		});
		for (const chat of session.chats.values()) {
			if (chat.materialized) {
				await agent.chats.materialize({ operation, payloadDigest: digest, session: session.state.id, chat: chat.state.id, resume: chat.resume });
			}
		}
	}

	private requireHostBackingRecord(identity: IAgentBackingIdentity, materialized: boolean): IAgentPackageBackingRecord {
		const session = this.requireSession(identity.sessionId);
		if (session.state.packageId !== identity.packageId || session.state.agentId !== identity.agentId) {
			throw new Error(`Backing '${identity.sessionId}' has different package or Agent ownership`);
		}
		if (identity.chatId === undefined) {
			if (session.materialized !== materialized) {
				throw new Error(`Session backing '${identity.sessionId}' has inconsistent materialization state`);
			}
			return this.packageBackingRecord(Object.freeze({ ...identity }), session.resume);
		}
		const chat = this.requireChat(session, identity.chatId);
		if (chat.materialized !== materialized) {
			throw new Error(`Chat backing '${identity.chatId}' has inconsistent materialization state`);
		}
		return this.packageBackingRecord(Object.freeze({ ...identity }), chat.resume);
	}

	private setBackingMaterialized(identity: IAgentBackingIdentity, materialized: boolean): void {
		const session = this.requireSession(identity.sessionId);
		if (identity.chatId === undefined) {
			const chats = materialized
				? session.chats
				: new Map([...session.chats].map(([chatId, chat]) => [chatId, Object.freeze({ ...chat, materialized: false })]));
			this.sessions.set(identity.sessionId, { ...session, materialized, chats });
			return;
		}
		const chat = this.requireChat(session, identity.chatId);
		const chats = new Map(session.chats);
		chats.set(identity.chatId, Object.freeze({ ...chat, materialized }));
		this.sessions.set(identity.sessionId, { ...session, chats });
	}

	private backingIdentityKey(identity: IAgentBackingIdentity): string {
		return `${identity.packageId}\u0000${identity.agentId}\u0000${identity.sessionId}\u0000${identity.chatId ?? ''}`;
	}

	private async commitHostState(
		sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>,
		actions: readonly HostStateAction[],
		cause: AgentHostChannelAction['cause'],
		commitConfiguration?: () => void,
		backingRemovalOperations: readonly IAgentHostBackingRemovalOperation[] = this.catalog.backingRemovalOperations,
		agentDefaults: ReadonlyMap<AgentId, IAgentConfigurationState> = this.agentDefaults,
		sessionConfigurationFinalizations: SessionConfigurationFinalizationCommit = this.catalog.sessionConfigurationFinalizations,
	): Promise<ICommittedHostState> {
		let hostSequence = this.catalog.hostSequence;
		const channelRevisions: Record<string, AgentHostChannelRevision> = { ...this.catalog.channelRevisions };
		const envelopes: AgentHostChannelAction[] = [];
		const revisions: IAgentHostCommittedChannelRevision[] = [];
		for (const action of actions) {
			hostSequence = createAgentHostSequence(hostSequence + 1);
			const revision = createAgentHostChannelRevision((channelRevisions[action.channel] ?? 0) + 1);
			channelRevisions[action.channel] = revision;
			revisions.push(Object.freeze({ channel: action.channel, revision }));
			envelopes.push(this.createEnvelope(action, hostSequence, revision, cause));
		}
		const committed = Object.freeze({ hostSequence, revisions: Object.freeze(revisions) });
		const committedSessionConfigurationFinalizations = typeof sessionConfigurationFinalizations === 'function'
			? sessionConfigurationFinalizations(committed)
			: sessionConfigurationFinalizations;
		const persisted = this.serializeCatalog(
			sessions,
			hostSequence,
			Object.freeze(channelRevisions),
			backingRemovalOperations,
			agentDefaults,
			committedSessionConfigurationFinalizations,
		);
		const retainedFinalizationOperations = new Set(
			persisted.sessionConfigurationFinalizations.map(record => record.operation),
		);
		const evictedFinalizationOperations = this.catalog.sessionConfigurationFinalizations
			.filter(record => !retainedFinalizationOperations.has(record.operation))
			.map(record => record.operation);
		await this.options.catalogStore.commit(this.catalog.revision, persisted);
		this.catalog = persisted;
		for (const operation of evictedFinalizationOperations) {
			this.operations.delete(operation);
			this.operationOwners.delete(operation);
			this.pendingSessionConfigurationFinalizations.delete(operation);
		}
		this.sessions = new Map(sessions);
		this.agentDefaults = new Map(agentDefaults);
		commitConfiguration?.();
		for (const envelope of envelopes) {
			this.replay.push(envelope);
			if (this.replay.length > this.options.maximumReplayActions) {
				this.replay.shift();
			}
			this._onDidPublishAction.fire(envelope);
		}
		return committed;
	}

	private createEnvelope(
		specification: HostStateAction,
		hostSequence: AgentHostSequence,
		revision: AgentHostChannelRevision,
		cause: AgentHostChannelAction['cause'],
	): AgentHostChannelAction {
		const value = {
			channel: specification.channel, kind: specification.kind, hostSequence, revision, cause, action: specification.action,
		};
		return Object.freeze({ ...value, digest: actionDigest(value) }) as AgentHostChannelAction;
	}

	private serializeCatalog(
		sessions: ReadonlyMap<AgentSessionId, IRuntimeSessionRecord>,
		hostSequence: AgentHostSequence,
		channelRevisions: Readonly<Record<string, AgentHostChannelRevision>>,
		backingRemovalOperations: readonly IAgentHostBackingRemovalOperation[] = this.catalog.backingRemovalOperations,
		agentDefaults: ReadonlyMap<AgentId, IAgentConfigurationState> = this.agentDefaults,
		sessionConfigurationFinalizations: readonly IAgentHostSessionConfigurationFinalization[] = this.catalog.sessionConfigurationFinalizations,
	): IAgentHostPersistedCatalog {
		const records = Object.freeze([...sessions.values()].map(record => {
			const chats = Object.freeze([...record.chats.values()].map(chat => Object.freeze({
				state: chat.state,
				...(chat.resume === undefined ? {} : { resume: chat.resume }),
			})));
			return Object.freeze({
				state: record.state,
				...(record.resume === undefined ? {} : { resume: record.resume }),
				chats,
			});
		}));
		const catalog: IAgentHostPersistedCatalog = Object.freeze({
			schemaVersion: 2,
			revision: this.catalog.revision + 1,
			packageCatalogRevision: this.options.packageLifecycle.snapshot().catalogRevision,
			hostSequence,
			channelRevisions,
			agentDefaults: Object.freeze([...agentDefaults.values()]),
			sessions: records,
			backingRemovalOperations,
			sessionConfigurationFinalizations,
			completedMigrations: this.catalog.completedMigrations,
		});
		assertAgentHostPersistedCatalog(catalog);
		return catalog;
	}

	private enqueueCatalogMutation<TResult>(execute: () => Promise<TResult>): Promise<TResult> {
		const predecessor = this.catalogTail;
		let release: (() => void) | undefined;
		this.catalogTail = new Promise<void>(resolve => { release = resolve; });
		return (async () => {
			await predecessor;
			try {
				return await execute();
			} finally {
				release?.();
			}
		})();
	}
}

class AgentHostConnection extends Disposable implements IAgentHostConnection {
	readonly authority: AgentHostAuthorityId;
	private readonly _onDidReceiveAction: Emitter<AgentHostChannelAction>;
	readonly onDidReceiveAction: Event<AgentHostChannelAction>;

	constructor(
		private readonly host: AgentHostAuthority,
		readonly connection: AgentHostClientConnectionId,
		reportUnexpectedError: (error: unknown) => void,
	) {
		super();
		this.authority = host.authority;
		this._onDidReceiveAction = this._register(new Emitter<AgentHostChannelAction>({ onListenerError: reportUnexpectedError }));
		this.onDidReceiveAction = this._onDidReceiveAction.event;
		this._register(this.host.onDidPublishAction(action => this.host.receiveAction(this.connection, action)));
		this._register(toDisposable(() => this.host.removeConnection(this.connection)));
	}

	initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		return this.host.initialize(this.connection, request);
	}

	reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		return this.host.reconnect(this.connection, request);
	}

	setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		return this.host.setSubscriptions(this.connection, request);
	}

	resolveSessionConfiguration(request: IAgentHostResolveSessionConfigurationRequest): Promise<IAgentHostResolveSessionConfigurationResult> {
		return this.host.resolveSessionConfiguration(this.connection, request);
	}

	completeSessionConfiguration(request: IAgentHostSessionConfigurationCompletionsRequest): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		return this.host.completeSessionConfiguration(this.connection, request);
	}

	prepareSubmission(request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult> {
		return this.host.prepareSubmission(this.connection, request);
	}

	mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		return this.host.mutate(this.connection, request);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		return this.host.getOperationOutcome(this.connection, request);
	}

	executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		return this.host.executePackageOperation(this.connection, request);
	}

	getPackageOperationOutcome(request: IAgentPackageOperationOutcomeRequest): Promise<AgentPackageOperationOutcome> {
		return this.host.getPackageOperationOutcome(this.connection, request);
	}

	fireAction(action: AgentHostChannelAction): void {
		this._onDidReceiveAction.fire(action);
	}
}
