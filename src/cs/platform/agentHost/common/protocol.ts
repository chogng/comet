/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentDescriptor, IAgentExecutionProfile, IAgentRuntimeRegistration, IAgentWorkspace, AgentChatOrigin, AgentInteractionRequest, AgentInteractionResponse, AgentTurnBehavior } from './agent.js';
import { IAgentHostAttachment, IAgentHostInteractionTarget, assertAgentHostAttachment, assertAgentHostInteractionTarget } from './attachments.js';
import { IAgentHostChannelAction, IAgentHostChannelSnapshot } from './channelState.js';
import {
	IAgentConfigurationCandidate,
	IAgentConfigurationCompletion,
	IAgentConfigurationSchema,
	IAgentConfigurationState,
} from './configuration.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	AgentChatId,
	AgentExecutionPresetId,
	AgentHostAuthorityId,
	AgentHostCapabilityId,
	AgentHostCapabilityRevision,
	AgentHostChannelId,
	AgentHostChannelRevision,
	AgentHostClientConnectionId,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentHostProtocolVersion,
	AgentHostSequence,
	AgentId,
	AgentInteractionId,
	AgentConfigurationPropertyId,
	AgentConfigurationSchemaRevision,
	AgentConfigurationStateRevision,
	AgentModelId,
	AgentPackageId,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentSessionTypeId,
	AgentSubmissionId,
	AgentToolId,
	AgentTurnId,
	createAgentHostChannelId,
	createAgentBehaviorActivityId,
	createAgentChatId,
	createAgentHostPayloadDigest,
	createAgentInteractionId,
	createAgentModelId,
	createAgentPlanId,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentTaskId,
	createAgentToolCallId,
	createAgentToolId,
	createAgentTurnId,
} from './identities.js';
import { AgentHostProtocolValue, assertAgentHostProtocolValue, computeAgentHostPayloadDigest } from './protocolValues.js';
import type {
	IAgentHostPackageCatalogState,
} from './packages.js';
import type { IAgentCredentialReference } from './credentials.js';
import { IAgentToolSet } from './tools.js';

export const AgentHostChannelKind = {
	Root: 'root',
	Sessions: 'sessions',
	Session: 'session',
	Chat: 'chat',
} as const;

export type AgentHostChannelKind = typeof AgentHostChannelKind[keyof typeof AgentHostChannelKind];

export function getAgentHostRootChannelId(): AgentHostChannelId {
	return createAgentHostChannelId('root');
}

export function getAgentHostSessionsChannelId(): AgentHostChannelId {
	return createAgentHostChannelId('sessions');
}

export function getAgentHostSessionChannelId(session: AgentSessionId): AgentHostChannelId {
	return createAgentHostChannelId(`session:${session}`);
}

export function getAgentHostChatChannelId(session: AgentSessionId, chat: AgentChatId): AgentHostChannelId {
	return createAgentHostChannelId(`chat:${session}:${chat}`);
}

export interface IAgentHostCapability {
	readonly id: AgentHostCapabilityId;
	readonly revision: AgentHostCapabilityRevision;
}

export interface IAgentHostImplementationIdentity {
	readonly name: string;
	readonly build: string;
}

export interface IAgentHostInitializeRequest {
	readonly connection: AgentHostClientConnectionId;
	readonly protocolVersions: readonly AgentHostProtocolVersion[];
	readonly capabilities: readonly IAgentHostCapability[];
	readonly locale: string;
	readonly implementation: IAgentHostImplementationIdentity;
	readonly subscriptions: readonly AgentHostChannelId[];
}

export interface IAgentHostInitializeResult {
	readonly protocolVersion: AgentHostProtocolVersion;
	readonly capabilities: readonly IAgentHostCapability[];
	readonly implementation: IAgentHostImplementationIdentity;
	readonly hostSequence: AgentHostSequence;
	readonly snapshots: readonly AgentHostChannelSnapshot[];
	readonly missingChannels: readonly IAgentHostMissingChannel[];
}

export interface IAgentHostMissingChannel {
	readonly channel: AgentHostChannelId;
	readonly reason: 'notFound' | 'deleted' | 'unauthorized';
}

export function selectAgentHostProtocolVersion(
	offered: readonly AgentHostProtocolVersion[],
	supportedByPreference: readonly AgentHostProtocolVersion[],
): AgentHostProtocolVersion {
	const offeredVersions = new Set(offered);
	for (const version of supportedByPreference) {
		if (offeredVersions.has(version)) {
			return version;
		}
	}

	throw new AgentHostError(
		AgentHostErrorCode.UnsupportedProtocolVersion,
		'Agent Host protocol versions are incompatible',
		{ offered, supported: supportedByPreference },
	);
}

export interface IAgentHostSessionTypeCapabilities {
	readonly workspace: 'required' | 'optional' | 'unsupported';
	readonly supportsEmptySession: boolean;
	readonly supportsInitialTurn: boolean;
	readonly supportsCreateChat: boolean;
	readonly maximumChatCount: number | undefined;
	readonly supportsForkChat: boolean;
}

export type AgentHostLocalizedDisplayTextKey =
	| 'agentHost.local.label'
	| 'agentHost.cometSession.displayName'
	| 'agentHost.cometSession.description'
	| 'agentHost.executionPreset.automatic';

export type AgentHostDisplayText =
	| {
		readonly kind: 'literal';
		readonly value: string;
	}
	| {
		readonly kind: 'localized';
		readonly key: AgentHostLocalizedDisplayTextKey;
	};

export interface IAgentHostSessionTypeDescriptor {
	readonly id: AgentSessionTypeId;
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly displayName: AgentHostDisplayText;
	readonly description: AgentHostDisplayText;
	readonly capabilities: IAgentHostSessionTypeCapabilities;
	readonly models: readonly AgentModelId[];
	readonly executionPresets: readonly IAgentHostExecutionPreset[];
	readonly automaticExecutionPreset: AgentExecutionPresetId | null;
	readonly toolPolicy: AgentHostToolPolicy;
}

/** Publishes one product-built-in Agent before its runtime SDK has been prepared. */
export interface IAgentHostBuiltInAgentAvailability {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly sessionType: Omit<
		IAgentHostSessionTypeDescriptor,
		'models' | 'executionPresets' | 'automaticExecutionPreset' | 'toolPolicy'
	>;
	readonly state: 'cold' | 'ready';
}

export interface IAgentHostExecutionPreset {
	readonly id: AgentExecutionPresetId;
	readonly displayName: AgentHostDisplayText;
	readonly model: AgentModelId;
}

export interface IAgentHostRootCapabilities {
	readonly supportsCreateSession: boolean;
	readonly supportsPackageOperations: boolean;
	readonly supportsAgentAuthentication: boolean;
}

export interface IAgentHostRootState {
	readonly authority: AgentHostAuthorityId;
	readonly label: AgentHostDisplayText;
	readonly capabilities: IAgentHostRootCapabilities;
	readonly packages: IAgentHostPackageCatalogState;
	readonly agents: readonly IAgentDescriptor[];
	readonly agentRegistrations: readonly IAgentRuntimeRegistration[];
	readonly agentDefaults: readonly IAgentConfigurationState[];
	readonly sessionTypes: readonly IAgentHostSessionTypeDescriptor[];
	readonly builtInAgents: readonly IAgentHostBuiltInAgentAvailability[];
}

export type AgentHostSessionLifecycle = 'available' | 'released' | 'unavailable';
export type AgentHostChatLifecycle = 'available' | 'released' | 'unavailable';
export type AgentHostChatInteractivity = 'full' | 'readOnly' | 'hidden';
export type AgentHostSessionStatus = 'running' | 'needsInput' | 'completed' | 'failed';

export interface IAgentHostSessionCapabilities {
	readonly supportsCreateChat: boolean;
	readonly maximumChatCount: number | undefined;
	readonly supportsFork: boolean;
	readonly supportsRename: boolean;
	readonly supportsArchive: boolean;
	readonly supportsDelete: boolean;
	readonly supportsChanges: boolean;
	readonly supportsModels: boolean;
}

export interface IAgentHostChatCapabilities {
	readonly supportsRename: boolean;
	readonly supportsSetModel: boolean;
	readonly supportsFork: boolean;
	readonly supportsRelease: boolean;
	readonly supportsDelete: boolean;
	readonly supportsSubmit: boolean;
	readonly supportsCancel: boolean;
}

export interface IAgentHostSessionSummary {
	readonly id: AgentSessionId;
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly type: AgentSessionTypeId;
	readonly createdAt: number;
	readonly title: string;
	readonly archived: boolean;
	readonly lifecycle: AgentHostSessionLifecycle;
	readonly status: AgentHostSessionStatus;
	readonly isRead: boolean;
	readonly modifiedAt: number;
}

export interface IAgentHostSessionCatalogState {
	readonly sessions: readonly IAgentHostSessionSummary[];
}

export interface IAgentHostChatSummary {
	readonly id: AgentChatId;
	readonly createdAt: number;
	readonly title: string;
	readonly origin: AgentChatOrigin;
	readonly model: AgentModelId | null;
	readonly lifecycle: AgentHostChatLifecycle;
	readonly interactivity: AgentHostChatInteractivity;
	readonly status: AgentHostSessionStatus;
	readonly isRead: boolean;
	readonly capabilities: IAgentHostChatCapabilities;
	readonly modifiedAt: number;
}

export interface IAgentHostSessionChange {
	readonly resource: string;
	readonly kind: 'created' | 'modified' | 'deleted';
}

export interface IAgentHostSessionState extends IAgentHostSessionSummary {
	readonly workspace?: IAgentWorkspace;
	readonly configuration: IAgentConfigurationState;
	readonly capabilities: IAgentHostSessionCapabilities;
	readonly changes: readonly IAgentHostSessionChange[];
	readonly chats: readonly IAgentHostChatSummary[];
}

export type AgentHostTurnState =
	| 'accepted'
	| 'queued'
	| 'running'
	| 'waitingForPermission'
	| 'waitingForInput'
	| 'cancelling'
	| 'completed'
	| 'cancelled'
	| 'failed';

export interface IAgentHostUserMessage {
	readonly text: string;
	readonly attachments: readonly IAgentHostAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
}

export interface IAgentHostTurn {
	readonly id: AgentTurnId;
	readonly submission: AgentSubmissionId;
	readonly payloadDigest: AgentHostPayloadDigest;
	readonly state: AgentHostTurnState;
	readonly user: IAgentHostUserMessage;
	readonly behaviors: readonly AgentTurnBehavior[];
	readonly interactions: readonly IAgentHostTurnInteraction[];
	readonly failure?: IAgentHostOperationFailure;
}

export interface IAgentHostTurnInteraction {
	readonly request: AgentInteractionRequest;
	readonly state: 'pending' | 'resolved' | 'cancelled';
	readonly response?: AgentInteractionResponse;
}

export interface IAgentHostChatState extends IAgentHostChatSummary {
	readonly session: AgentSessionId;
	readonly turns: readonly IAgentHostTurn[];
	readonly activeTurn?: AgentTurnId;
}

export interface IAgentHostRootStateAction {
	readonly kind: 'rootStateChanged';
	readonly state: IAgentHostRootState;
}

export interface IAgentHostSessionCatalogStateAction {
	readonly kind: 'sessionCatalogStateChanged';
	readonly state: IAgentHostSessionCatalogState;
}

export interface IAgentHostSessionStateAction {
	readonly kind: 'sessionStateChanged';
	readonly state: IAgentHostSessionState;
}

export interface IAgentHostChatStateAction {
	readonly kind: 'chatStateChanged';
	readonly state: IAgentHostChatState;
}

export type AgentHostChannelSnapshot =
	| IAgentHostChannelSnapshot<'root', IAgentHostRootState>
	| IAgentHostChannelSnapshot<'sessions', IAgentHostSessionCatalogState>
	| IAgentHostChannelSnapshot<'session', IAgentHostSessionState>
	| IAgentHostChannelSnapshot<'chat', IAgentHostChatState>;

export type AgentHostChannelAction =
	| IAgentHostChannelAction<'root', IAgentHostRootStateAction>
	| IAgentHostChannelAction<'sessions', IAgentHostSessionCatalogStateAction>
	| IAgentHostChannelAction<'session', IAgentHostSessionStateAction>
	| IAgentHostChannelAction<'chat', IAgentHostChatStateAction>;

export function reduceAgentHostRootState(_state: IAgentHostRootState, action: IAgentHostRootStateAction): IAgentHostRootState {
	return action.state;
}

export function reduceAgentHostSessionCatalogState(
	_state: IAgentHostSessionCatalogState,
	action: IAgentHostSessionCatalogStateAction,
): IAgentHostSessionCatalogState {
	return action.state;
}

export function reduceAgentHostSessionState(_state: IAgentHostSessionState, action: IAgentHostSessionStateAction): IAgentHostSessionState {
	return action.state;
}

export function reduceAgentHostChatState(_state: IAgentHostChatState, action: IAgentHostChatStateAction): IAgentHostChatState {
	return action.state;
}

export interface IAgentHostSetSubscriptionsRequest {
	readonly subscriptions: readonly AgentHostChannelId[];
}

export interface IAgentHostSetSubscriptionsResult {
	readonly hostSequence: AgentHostSequence;
	readonly snapshots: readonly AgentHostChannelSnapshot[];
	readonly missingChannels: readonly IAgentHostMissingChannel[];
}

export function assertAgentHostSetSubscriptionsResult(
	request: IAgentHostSetSubscriptionsRequest,
	result: IAgentHostSetSubscriptionsResult,
): void {
	const subscriptions = new Set(request.subscriptions);
	if (subscriptions.size !== request.subscriptions.length) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Agent Host subscription set contains duplicates',
			{ field: 'subscriptions', value: request.subscriptions.length },
		);
	}

	const recoveredChannels = new Set<AgentHostChannelId>();
	for (const missing of result.missingChannels) {
		if (
			!subscriptions.has(missing.channel)
			|| recoveredChannels.has(missing.channel)
			|| !['notFound', 'deleted', 'unauthorized'].includes(missing.reason)
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host subscription replacement returned an invalid missing channel',
				{ field: 'missingChannels', value: missing.channel },
			);
		}
		recoveredChannels.add(missing.channel);
	}

	for (const snapshot of result.snapshots) {
		if (
			!subscriptions.has(snapshot.channel)
			|| recoveredChannels.has(snapshot.channel)
			|| snapshot.hostSequence !== result.hostSequence
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host subscription replacement snapshot set is invalid',
				{ field: 'snapshots', value: snapshot.channel },
			);
		}
		recoveredChannels.add(snapshot.channel);
	}
	if (recoveredChannels.size !== subscriptions.size) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Agent Host subscription replacement result is incomplete',
			{ field: 'snapshots', value: recoveredChannels.size },
		);
	}
}

export interface IAgentHostReconnectRequest {
	readonly connection: AgentHostClientConnectionId;
	readonly lastHostSequence: AgentHostSequence;
	readonly subscriptions: readonly AgentHostChannelId[];
}

export type AgentHostReconnectResult =
	| {
		readonly kind: 'replay';
		readonly fromHostSequence: AgentHostSequence;
		readonly throughHostSequence: AgentHostSequence;
		readonly actions: readonly AgentHostChannelAction[];
		readonly missingChannels: readonly IAgentHostMissingChannel[];
	}
	| {
		readonly kind: 'snapshots';
		readonly hostSequence: AgentHostSequence;
		readonly snapshots: readonly AgentHostChannelSnapshot[];
		readonly missingChannels: readonly IAgentHostMissingChannel[];
	};

export function assertAgentHostReconnectResult(
	request: IAgentHostReconnectRequest,
	result: AgentHostReconnectResult,
): void {
	const subscriptions = new Set(request.subscriptions);
	if (subscriptions.size !== request.subscriptions.length) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Agent Host reconnect subscriptions contain duplicates',
			{ field: 'subscriptions', value: request.subscriptions.length },
		);
	}

	const missingChannels = new Set<AgentHostChannelId>();
	for (const missing of result.missingChannels) {
		if (
			!subscriptions.has(missing.channel)
			|| missingChannels.has(missing.channel)
			|| !['notFound', 'deleted', 'unauthorized'].includes(missing.reason)
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host reconnect returned an invalid missing channel',
				{ field: 'missingChannels', value: missing.channel },
			);
		}
		missingChannels.add(missing.channel);
	}

	if (result.kind === 'replay') {
		if (result.fromHostSequence !== request.lastHostSequence || result.throughHostSequence < result.fromHostSequence) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host reconnect replay interval is invalid',
				{ field: 'fromHostSequence', value: result.fromHostSequence },
			);
		}

		let previousSequence = result.fromHostSequence;
		for (const action of result.actions) {
			if (
				!subscriptions.has(action.channel)
				|| missingChannels.has(action.channel)
				|| action.hostSequence <= previousSequence
				|| action.hostSequence > result.throughHostSequence
			) {
				throw new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Agent Host reconnect replay is not a complete ordered interval',
					{ field: 'actions.hostSequence', value: action.hostSequence },
				);
			}
			previousSequence = action.hostSequence;
		}
		return;
	}

	const recoveredChannels = new Set<AgentHostChannelId>(missingChannels);
	for (const snapshot of result.snapshots) {
		if (
			!subscriptions.has(snapshot.channel)
			|| recoveredChannels.has(snapshot.channel)
			|| snapshot.hostSequence !== result.hostSequence
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host reconnect snapshot set is invalid',
				{ field: 'snapshots', value: snapshot.channel },
			);
		}
		recoveredChannels.add(snapshot.channel);
	}
	if (recoveredChannels.size !== subscriptions.size) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Agent Host reconnect snapshot set is incomplete',
			{ field: 'snapshots', value: recoveredChannels.size },
		);
	}
}

export interface IAgentHostPreparedSubmission {
	readonly submission: AgentSubmissionId;
	readonly payloadDigest: AgentHostPayloadDigest;
	readonly message: string;
	readonly attachments: readonly IAgentHostAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
	readonly sessionConfiguration: IAgentConfigurationState;
	readonly modelConfiguration: IAgentConfigurationCandidate;
	readonly credentials: readonly IAgentCredentialReference[];
	readonly executionProfile: IAgentExecutionProfile;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly toolSet: IAgentToolSet;
	readonly requestedDeadline: number;
	readonly outputConstraints: AgentHostProtocolValue;
}

export interface IAgentHostSubmissionCapture {
	readonly message: string;
	readonly attachments: readonly IAgentHostAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
}

export type AgentHostToolPolicy =
	| { readonly kind: 'all' }
	| {
		readonly kind: 'selected';
		readonly tools: readonly AgentToolId[];
	};

export type AgentHostExecutionSelection =
	| {
		readonly kind: 'model';
		readonly model: AgentModelId;
		readonly configuration: IAgentConfigurationCandidate;
	}
	| {
		readonly kind: 'preset';
		readonly preset: AgentExecutionPresetId;
		readonly configuration: IAgentConfigurationCandidate;
	};

export type AgentHostSubmissionTarget =
	| {
		readonly kind: 'chat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'draft';
		readonly sessionType: AgentSessionTypeId;
		readonly workspace?: IAgentWorkspace;
		readonly configuration: IAgentConfigurationCandidate;
	};

export interface IAgentHostResolveSessionConfigurationRequest {
	readonly sessionType: AgentSessionTypeId;
	readonly workspace?: IAgentWorkspace;
	readonly candidate: IAgentConfigurationCandidate;
}

export interface IAgentHostResolveSessionConfigurationResult {
	readonly agent: AgentId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly configuration: IAgentConfigurationState;
}

export interface IAgentHostSessionConfigurationCompletionsRequest {
	readonly sessionType: AgentSessionTypeId;
	readonly workspace?: IAgentWorkspace;
	readonly candidate: IAgentConfigurationCandidate;
	readonly resolvedSchema: IAgentConfigurationSchema;
	readonly property: AgentConfigurationPropertyId;
	readonly query: string;
	readonly limit: number;
}

export interface IAgentHostSessionConfigurationCompletionsResult {
	readonly agent: AgentId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly schema: AgentConfigurationSchemaRevision;
	readonly completions: readonly IAgentConfigurationCompletion[];
}

export interface IAgentHostPrepareSubmissionRequest {
	readonly submission: AgentSubmissionId;
	readonly target: AgentHostSubmissionTarget;
	readonly capture: IAgentHostSubmissionCapture;
	readonly captureDigest: AgentHostPayloadDigest;
	readonly executionSelection: AgentHostExecutionSelection;
	readonly toolPolicy: AgentHostToolPolicy;
}

export type AgentHostPrepareSubmissionResult =
	| {
		readonly kind: 'prepared';
		readonly submission: IAgentHostPreparedSubmission;
	}
	| {
		readonly kind: 'rejected';
		readonly failure: IAgentHostOperationFailure;
	};

export interface IAgentHostCreateSessionChatRequest {
	readonly title?: string;
	readonly model: AgentModelId | null;
	readonly origin: AgentChatOrigin;
	readonly initialSubmission?: IAgentHostPreparedSubmission;
}

export type AgentHostMutationPayload =
	| {
		readonly kind: 'prepareBuiltInAgent';
		readonly agent: AgentId;
	}
	| {
		readonly kind: 'createSession';
		readonly sessionType: AgentSessionTypeId;
		readonly workspace?: IAgentWorkspace;
		readonly configuration: IAgentConfigurationCandidate;
		readonly chats: readonly IAgentHostCreateSessionChatRequest[];
	}
	| {
		readonly kind: 'updateAgentDefaults';
		readonly agent: AgentId;
		readonly expectedRevision: AgentConfigurationStateRevision;
		readonly candidate: IAgentConfigurationCandidate;
	}
	| {
		readonly kind: 'updateSessionConfiguration';
		readonly session: AgentSessionId;
		readonly expectedRevision: AgentConfigurationStateRevision;
		readonly candidate: IAgentConfigurationCandidate;
	}
	| {
		readonly kind: 'createChat';
		readonly session: AgentSessionId;
		readonly title?: string;
		readonly model: AgentModelId | null;
		readonly origin: AgentChatOrigin;
	}
	| {
		readonly kind: 'forkChat';
		readonly session: AgentSessionId;
		readonly sourceChat: AgentChatId;
		readonly sourceTurn: AgentTurnId;
	}
	| {
		readonly kind: 'renameSession';
		readonly session: AgentSessionId;
		readonly title: string;
	}
	| {
		readonly kind: 'renameChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly title: string;
	}
	| {
		readonly kind: 'setChatModel';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly model: AgentModelId | null;
	}
	| {
		readonly kind: 'setSessionArchived';
		readonly session: AgentSessionId;
		readonly archived: boolean;
	}
	| {
		readonly kind: 'materializeSession';
		readonly session: AgentSessionId;
	}
	| {
		readonly kind: 'materializeChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'releaseSession';
		readonly session: AgentSessionId;
	}
	| {
		readonly kind: 'releaseChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'deleteSession';
		readonly session: AgentSessionId;
	}
	| {
		readonly kind: 'deleteChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'submitTurn';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly submission: IAgentHostPreparedSubmission;
	}
	| {
		readonly kind: 'steerTurn';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly message: string;
	}
	| {
		readonly kind: 'cancelTurn';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
	}
	| {
		readonly kind: 'respondInteraction';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly interaction: AgentInteractionId;
		readonly response: AgentInteractionResponse;
	}
	| {
		readonly kind: 'authenticateAgent';
		readonly packageId: AgentPackageId;
		readonly agentId: AgentId;
		readonly registration: AgentRuntimeRegistrationRevision;
		readonly credential: IAgentCredentialReference;
	};

export interface IAgentHostMutationRequest {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly payload: AgentHostMutationPayload;
}

export async function computeAgentHostMutationDigest(payload: AgentHostMutationPayload): Promise<AgentHostPayloadDigest> {
	return computeAgentHostPayloadDigest(payload);
}

export async function computeAgentHostSubmissionCaptureDigest(capture: IAgentHostSubmissionCapture): Promise<AgentHostPayloadDigest> {
	return computeAgentHostPayloadDigest(capture);
}

export interface IAgentHostCommittedChannelRevision {
	readonly channel: AgentHostChannelId;
	readonly revision: AgentHostChannelRevision;
}

interface IAgentHostMutationCommit {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly hostSequence: AgentHostSequence;
	readonly revisions: readonly IAgentHostCommittedChannelRevision[];
}

export interface IAgentHostCreatedChatResult {
	readonly chat: AgentChatId;
	readonly turn?: AgentTurnId;
	readonly submission?: AgentSubmissionId;
}

export type AgentHostMutationResult = IAgentHostMutationCommit & (
	| {
		readonly kind: 'prepareBuiltInAgent';
		readonly agent: AgentId;
		readonly registration: AgentRuntimeRegistrationRevision;
	}
	| {
		readonly kind: 'createSession';
		readonly session: AgentSessionId;
		readonly chats: readonly IAgentHostCreatedChatResult[];
	}
	| {
		readonly kind: 'createChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'forkChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'renameSession' | 'setSessionArchived' | 'materializeSession' | 'releaseSession' | 'deleteSession';
		readonly session: AgentSessionId;
	}
	| {
		readonly kind: 'updateAgentDefaults';
		readonly agent: AgentId;
		readonly configuration: AgentConfigurationStateRevision;
	}
	| {
		readonly kind: 'updateSessionConfiguration';
		readonly session: AgentSessionId;
		readonly configuration: AgentConfigurationStateRevision;
	}
	| {
		readonly kind: 'renameChat' | 'setChatModel' | 'materializeChat' | 'releaseChat' | 'deleteChat';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
	}
	| {
		readonly kind: 'submitTurn';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly submission: AgentSubmissionId;
	}
	| {
		readonly kind: 'steerTurn';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
	}
	| {
		readonly kind: 'cancelTurn';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
	}
	| {
		readonly kind: 'respondInteraction';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly interaction: AgentInteractionId;
	}
	| {
		readonly kind: 'authenticateAgent';
		readonly packageId: AgentPackageId;
		readonly agentId: AgentId;
		readonly registration: AgentRuntimeRegistrationRevision;
	}
);

export const AgentHostOperationFailureCode = {
	MissingResource: 'missingResource',
	UnsupportedCapability: 'unsupportedCapability',
	CapacityExceeded: 'capacityExceeded',
	Conflict: 'conflict',
	Disconnected: 'disconnected',
	InvalidState: 'invalidState',
	InvalidPayload: 'invalidPayload',
	AgentUnavailable: 'agentUnavailable',
} as const;

export type AgentHostOperationFailureCode = typeof AgentHostOperationFailureCode[keyof typeof AgentHostOperationFailureCode];

export interface IAgentHostOperationFailure {
	readonly code: AgentHostOperationFailureCode;
	readonly message: string;
	readonly data?: AgentHostProtocolValue;
	readonly reconciliation: 'terminal' | 'sameOperationRequired';
}

export type AgentHostMutationOutcome =
	| { readonly kind: 'pending' }
	| {
		readonly kind: 'succeeded';
		readonly result: AgentHostMutationResult;
	}
	| {
		readonly kind: 'failed';
		readonly failure: IAgentHostOperationFailure;
	}
	| { readonly kind: 'unknown' }
	| {
		readonly kind: 'conflict';
		readonly recordedDigest: AgentHostPayloadDigest;
	};

export interface IAgentHostOperationOutcomeRequest {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
}

function invalidChatState(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Agent Host Chat state',
		{ field, value: diagnostic },
	);
}

function chatStateRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidChatState(field, value);
	}
	return value as Readonly<Record<string, unknown>>;
}

function assertChatStateKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidChatState(`${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidChatState(`${field}.${key}`, 'missing');
		}
	}
}

function assertChatStateString(value: unknown, field: string, maximumLength: number, allowEmpty = false): asserts value is string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximumLength) {
		invalidChatState(field, value);
	}
}

function assertChatStateTimestamp(value: unknown, field: string): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		invalidChatState(field, value);
	}
}

function assertChatOrigin(value: unknown, field: string): void {
	const origin = chatStateRecord(value, field);
	if (origin.kind === 'user') {
		assertChatStateKeys(origin, ['kind'], [], field);
		return;
	}
	if (origin.kind === 'fork') {
		assertChatStateKeys(origin, ['kind', 'parentChat', 'parentTurn'], [], field);
		assertChatStateString(origin.parentChat, `${field}.parentChat`, 128);
		assertChatStateString(origin.parentTurn, `${field}.parentTurn`, 128);
		createAgentChatId(origin.parentChat);
		createAgentTurnId(origin.parentTurn);
		return;
	}
	if (origin.kind === 'tool') {
		assertChatStateKeys(origin, ['kind', 'parentChat', 'parentTurn', 'toolCall'], [], field);
		assertChatStateString(origin.parentChat, `${field}.parentChat`, 128);
		assertChatStateString(origin.parentTurn, `${field}.parentTurn`, 128);
		assertChatStateString(origin.toolCall, `${field}.toolCall`, 128);
		createAgentChatId(origin.parentChat);
		createAgentTurnId(origin.parentTurn);
		createAgentToolCallId(origin.toolCall);
		return;
	}
	invalidChatState(`${field}.kind`, origin.kind);
}

function assertChatCapabilities(value: unknown, field: string): void {
	const capabilities = chatStateRecord(value, field);
	const keys = ['supportsRename', 'supportsSetModel', 'supportsFork', 'supportsRelease', 'supportsDelete', 'supportsSubmit', 'supportsCancel'];
	assertChatStateKeys(capabilities, keys, [], field);
	for (const key of keys) {
		if (typeof capabilities[key] !== 'boolean') {
			invalidChatState(`${field}.${key}`, capabilities[key]);
		}
	}
}

function assertOperationFailure(value: unknown, field: string): void {
	const failure = chatStateRecord(value, field);
	assertChatStateKeys(failure, ['code', 'message', 'reconciliation'], ['data'], field);
	if (!Object.values(AgentHostOperationFailureCode).includes(failure.code as AgentHostOperationFailureCode)) {
		invalidChatState(`${field}.code`, failure.code);
	}
	assertChatStateString(failure.message, `${field}.message`, 2_048, true);
	if (failure.reconciliation !== 'terminal' && failure.reconciliation !== 'sameOperationRequired') {
		invalidChatState(`${field}.reconciliation`, failure.reconciliation);
	}
	if (failure.data !== undefined) {
		assertAgentHostProtocolValue(failure.data);
	}
}

const activityStates = Object.freeze(['pending', 'running', 'completed', 'cancelled', 'failed']);

function assertOptionalProtocolValue(record: Readonly<Record<string, unknown>>, key: string): void {
	if (record[key] !== undefined) {
		assertAgentHostProtocolValue(record[key]);
	}
}

function assertActivityState(value: unknown, field: string): void {
	if (!activityStates.includes(String(value))) {
		invalidChatState(field, value);
	}
}

function assertTurnBehaviors(value: unknown, field: string): void {
	if (!Array.isArray(value)) {
		invalidChatState(field, value);
	}
	const toolCalls = new Set<string>();
	const toolResults = new Set<string>();
	for (const [index, behaviorValue] of value.entries()) {
		const behaviorField = `${field}.${index}`;
		const behavior = chatStateRecord(behaviorValue, behaviorField);
		if (behavior.kind === 'text' || behavior.kind === 'reasoning') {
			assertChatStateKeys(behavior, ['kind', 'text'], [], behaviorField);
			assertChatStateString(behavior.text, `${behaviorField}.text`, 1024 * 1024, true);
			continue;
		}
		if (behavior.kind === 'contributedToolCall') {
			assertChatStateKeys(behavior, ['kind', 'call', 'tool', 'input'], [], behaviorField);
			assertChatStateString(behavior.call, `${behaviorField}.call`, 128);
			assertChatStateString(behavior.tool, `${behaviorField}.tool`, 128);
			createAgentToolCallId(behavior.call);
			createAgentToolId(behavior.tool);
			assertAgentHostProtocolValue(behavior.input);
			if (toolCalls.has(behavior.call)) {
				invalidChatState(`${behaviorField}.call`, behavior.call);
			}
			toolCalls.add(behavior.call);
			continue;
		}
		if (behavior.kind === 'contributedToolResult') {
			assertChatStateKeys(behavior, ['kind', 'call', 'status'], ['output'], behaviorField);
			assertChatStateString(behavior.call, `${behaviorField}.call`, 128);
			createAgentToolCallId(behavior.call);
			if (!toolCalls.has(behavior.call) || toolResults.has(behavior.call)) {
				invalidChatState(`${behaviorField}.call`, behavior.call);
			}
			if (!['completed', 'denied', 'cancelled', 'timedOut', 'failed'].includes(String(behavior.status))) {
				invalidChatState(`${behaviorField}.status`, behavior.status);
			}
			assertOptionalProtocolValue(behavior, 'output');
			toolResults.add(behavior.call);
			continue;
		}
		if (behavior.kind === 'nativeTool') {
			assertChatStateKeys(behavior, ['kind', 'activity', 'name', 'category', 'state'], ['input', 'output', 'parentActivity'], behaviorField);
			assertChatStateString(behavior.activity, `${behaviorField}.activity`, 128);
			assertChatStateString(behavior.name, `${behaviorField}.name`, 1_024);
			createAgentBehaviorActivityId(behavior.activity);
			if (!['command', 'file', 'search', 'mcp', 'other'].includes(String(behavior.category))) {
				invalidChatState(`${behaviorField}.category`, behavior.category);
			}
			assertActivityState(behavior.state, `${behaviorField}.state`);
			assertOptionalProtocolValue(behavior, 'input');
			assertOptionalProtocolValue(behavior, 'output');
			if (behavior.parentActivity !== undefined) {
				assertChatStateString(behavior.parentActivity, `${behaviorField}.parentActivity`, 128);
				createAgentBehaviorActivityId(behavior.parentActivity);
			}
			continue;
		}
		if (behavior.kind === 'plan') {
			assertChatStateKeys(behavior, ['kind', 'plan', 'title', 'state', 'steps'], [], behaviorField);
			assertChatStateString(behavior.plan, `${behaviorField}.plan`, 128);
			assertChatStateString(behavior.title, `${behaviorField}.title`, 1_024, true);
			createAgentPlanId(behavior.plan);
			assertActivityState(behavior.state, `${behaviorField}.state`);
			if (!Array.isArray(behavior.steps)) {
				invalidChatState(`${behaviorField}.steps`, behavior.steps);
			}
			const tasks = new Set<string>();
			for (const [stepIndex, stepValue] of behavior.steps.entries()) {
				const stepField = `${behaviorField}.steps.${stepIndex}`;
				const step = chatStateRecord(stepValue, stepField);
				assertChatStateKeys(step, ['task', 'title', 'state'], [], stepField);
				assertChatStateString(step.task, `${stepField}.task`, 128);
				assertChatStateString(step.title, `${stepField}.title`, 1_024);
				createAgentTaskId(step.task);
				assertActivityState(step.state, `${stepField}.state`);
				if (tasks.has(step.task)) {
					invalidChatState(`${stepField}.task`, step.task);
				}
				tasks.add(step.task);
			}
			continue;
		}
		if (behavior.kind === 'task') {
			assertChatStateKeys(behavior, ['kind', 'task', 'title', 'state'], ['parentTask', 'childChat', 'detail'], behaviorField);
			assertChatStateString(behavior.task, `${behaviorField}.task`, 128);
			assertChatStateString(behavior.title, `${behaviorField}.title`, 1_024);
			createAgentTaskId(behavior.task);
			assertActivityState(behavior.state, `${behaviorField}.state`);
			if (behavior.parentTask !== undefined) {
				assertChatStateString(behavior.parentTask, `${behaviorField}.parentTask`, 128);
				createAgentTaskId(behavior.parentTask);
			}
			if (behavior.childChat !== undefined) {
				assertChatStateString(behavior.childChat, `${behaviorField}.childChat`, 128);
				createAgentChatId(behavior.childChat);
			}
			assertOptionalProtocolValue(behavior, 'detail');
			continue;
		}
		if (behavior.kind === 'background') {
			assertChatStateKeys(behavior, ['kind', 'activity', 'title', 'state'], ['detail'], behaviorField);
			assertChatStateString(behavior.activity, `${behaviorField}.activity`, 128);
			assertChatStateString(behavior.title, `${behaviorField}.title`, 1_024);
			createAgentBehaviorActivityId(behavior.activity);
			assertActivityState(behavior.state, `${behaviorField}.state`);
			assertOptionalProtocolValue(behavior, 'detail');
			continue;
		}
		if (behavior.kind === 'terminal') {
			assertChatStateKeys(behavior, ['kind', 'activity', 'terminal', 'stream', 'text'], [], behaviorField);
			assertChatStateString(behavior.activity, `${behaviorField}.activity`, 128);
			assertChatStateString(behavior.terminal, `${behaviorField}.terminal`, 128);
			assertChatStateString(behavior.text, `${behaviorField}.text`, 1024 * 1024, true);
			createAgentBehaviorActivityId(behavior.activity);
			if (behavior.stream !== 'stdout' && behavior.stream !== 'stderr') {
				invalidChatState(`${behaviorField}.stream`, behavior.stream);
			}
			continue;
		}
		if (behavior.kind === 'fileChange') {
			assertChatStateKeys(behavior, ['kind', 'activity', 'resource', 'operation'], ['data'], behaviorField);
			assertChatStateString(behavior.activity, `${behaviorField}.activity`, 128);
			assertChatStateString(behavior.resource, `${behaviorField}.resource`, 8_192);
			createAgentBehaviorActivityId(behavior.activity);
			if (!['create', 'modify', 'delete', 'rename'].includes(String(behavior.operation))) {
				invalidChatState(`${behaviorField}.operation`, behavior.operation);
			}
			assertOptionalProtocolValue(behavior, 'data');
			continue;
		}
		if (behavior.kind === 'usage') {
			assertChatStateKeys(behavior, ['kind', 'inputTokens', 'outputTokens', 'cachedInputTokens'], ['data'], behaviorField);
			for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens']) {
				assertChatStateTimestamp(behavior[key], `${behaviorField}.${key}`);
			}
			assertOptionalProtocolValue(behavior, 'data');
			continue;
		}
		if (behavior.kind === 'context') {
			assertChatStateKeys(behavior, ['kind', 'usedTokens', 'maximumTokens', 'compaction'], ['data'], behaviorField);
			assertChatStateTimestamp(behavior.usedTokens, `${behaviorField}.usedTokens`);
			assertChatStateTimestamp(behavior.maximumTokens, `${behaviorField}.maximumTokens`);
			if (behavior.usedTokens > behavior.maximumTokens || !['none', 'running', 'completed'].includes(String(behavior.compaction))) {
				invalidChatState(`${behaviorField}.context`, behavior.maximumTokens);
			}
			assertOptionalProtocolValue(behavior, 'data');
			continue;
		}
		if (behavior.kind === 'retry') {
			assertChatStateKeys(behavior, ['kind', 'attempt', 'reason'], ['data'], behaviorField);
			assertChatStateTimestamp(behavior.attempt, `${behaviorField}.attempt`);
			assertChatStateString(behavior.reason, `${behaviorField}.reason`, 4_096);
			assertOptionalProtocolValue(behavior, 'data');
			continue;
		}
		if (behavior.kind === 'status') {
			assertChatStateKeys(behavior, ['kind', 'state', 'message'], ['data'], behaviorField);
			if (!['working', 'waiting', 'paused'].includes(String(behavior.state))) {
				invalidChatState(`${behaviorField}.state`, behavior.state);
			}
			assertChatStateString(behavior.message, `${behaviorField}.message`, 4_096, true);
			assertOptionalProtocolValue(behavior, 'data');
			continue;
		}
		invalidChatState(`${behaviorField}.kind`, behavior.kind);
	}
}

function assertTurnInteractions(value: unknown, field: string): void {
	if (!Array.isArray(value)) {
		invalidChatState(field, value);
	}
	const identities = new Set<string>();
	for (const [index, interactionValue] of value.entries()) {
		const interactionField = `${field}.${index}`;
		const interaction = chatStateRecord(interactionValue, interactionField);
		assertChatStateKeys(interaction, ['request', 'state'], ['response'], interactionField);
		const request = chatStateRecord(interaction.request, `${interactionField}.request`);
		assertChatStateKeys(request, ['id', 'kind', 'title', 'description', 'metadata'], request.kind === 'input' ? ['activity', 'input'] : ['activity', 'options'], `${interactionField}.request`);
		assertChatStateString(request.id, `${interactionField}.request.id`, 128);
		assertChatStateString(request.title, `${interactionField}.request.title`, 1_024);
		assertChatStateString(request.description, `${interactionField}.request.description`, 8_192, true);
		createAgentInteractionId(request.id);
		if (identities.has(request.id)) {
			invalidChatState(`${interactionField}.request.id`, request.id);
		}
		identities.add(request.id);
		if (request.activity !== undefined) {
			assertChatStateString(request.activity, `${interactionField}.request.activity`, 128);
			createAgentBehaviorActivityId(request.activity);
		}
		assertAgentHostProtocolValue(request.metadata);
		if (request.kind === 'permission' || request.kind === 'confirmation') {
			if (!Array.isArray(request.options) || request.options.length === 0) {
				invalidChatState(`${interactionField}.request.options`, request.options);
			}
			const options = new Set<string>();
			for (const [optionIndex, optionValue] of request.options.entries()) {
				const optionField = `${interactionField}.request.options.${optionIndex}`;
				const option = chatStateRecord(optionValue, optionField);
				assertChatStateKeys(option, ['id', 'label'], ['description'], optionField);
				assertChatStateString(option.id, `${optionField}.id`, 128);
				assertChatStateString(option.label, `${optionField}.label`, 1_024);
				if (option.description !== undefined) {
					assertChatStateString(option.description, `${optionField}.description`, 4_096, true);
				}
				if (options.has(option.id)) {
					invalidChatState(`${optionField}.id`, option.id);
				}
				options.add(option.id);
			}
		} else if (request.kind === 'input') {
			const input = chatStateRecord(request.input, `${interactionField}.request.input`);
			assertChatStateKeys(input, ['shape', 'schema'], ['initialValue'], `${interactionField}.request.input`);
			if (!['text', 'choice', 'form'].includes(String(input.shape))) {
				invalidChatState(`${interactionField}.request.input.shape`, input.shape);
			}
			assertAgentHostProtocolValue(input.schema);
			assertOptionalProtocolValue(input, 'initialValue');
		} else {
			invalidChatState(`${interactionField}.request.kind`, request.kind);
		}
		if (!['pending', 'resolved', 'cancelled'].includes(String(interaction.state))) {
			invalidChatState(`${interactionField}.state`, interaction.state);
		}
		if (interaction.state === 'pending') {
			if (interaction.response !== undefined) {
				invalidChatState(`${interactionField}.response`, interaction.response);
			}
			continue;
		}
		const response = chatStateRecord(interaction.response, `${interactionField}.response`);
		if (response.kind === 'selected') {
			assertChatStateKeys(response, ['kind', 'option'], ['data'], `${interactionField}.response`);
			assertChatStateString(response.option, `${interactionField}.response.option`, 128);
			assertOptionalProtocolValue(response, 'data');
			if (
				(request.kind !== 'permission' && request.kind !== 'confirmation')
				|| interaction.state !== 'resolved'
				|| !(request.options as readonly Readonly<Record<string, unknown>>[]).some(option => option.id === response.option)
			) {
				invalidChatState(`${interactionField}.response.kind`, response.kind);
			}
		} else if (response.kind === 'submitted') {
			assertChatStateKeys(response, ['kind', 'value'], [], `${interactionField}.response`);
			assertAgentHostProtocolValue(response.value);
			if (request.kind !== 'input' || interaction.state !== 'resolved') {
				invalidChatState(`${interactionField}.response.kind`, response.kind);
			}
		} else if (response.kind === 'cancelled') {
			assertChatStateKeys(response, ['kind'], [], `${interactionField}.response`);
			if (interaction.state !== 'cancelled') {
				invalidChatState(`${interactionField}.response.kind`, response.kind);
			}
		} else {
			invalidChatState(`${interactionField}.response.kind`, response.kind);
		}
	}
}

function assertTurn(value: unknown, field: string): { readonly id: string; readonly state: AgentHostTurnState } {
	const turn = chatStateRecord(value, field);
	assertChatStateKeys(turn, ['id', 'submission', 'payloadDigest', 'state', 'user', 'behaviors', 'interactions'], ['failure'], field);
	assertChatStateString(turn.id, `${field}.id`, 128);
	assertChatStateString(turn.submission, `${field}.submission`, 128);
	assertChatStateString(turn.payloadDigest, `${field}.payloadDigest`, 71);
	createAgentTurnId(turn.id);
	createAgentSubmissionId(turn.submission);
	createAgentHostPayloadDigest(turn.payloadDigest);
	const states: readonly AgentHostTurnState[] = [
		'accepted', 'queued', 'running', 'waitingForPermission', 'waitingForInput', 'cancelling', 'completed', 'cancelled', 'failed',
	];
	if (!states.includes(turn.state as AgentHostTurnState)) {
		invalidChatState(`${field}.state`, turn.state);
	}

	const user = chatStateRecord(turn.user, `${field}.user`);
	assertChatStateKeys(user, ['text', 'attachments', 'interactionTargets'], [], `${field}.user`);
	assertChatStateString(user.text, `${field}.user.text`, 4 * 1024 * 1024, true);
	if (!Array.isArray(user.attachments) || !Array.isArray(user.interactionTargets)) {
		invalidChatState(`${field}.user`, turn.user);
	}
	for (const attachment of user.attachments) {
		assertAgentHostAttachment(attachment);
	}
	for (const target of user.interactionTargets) {
		assertAgentHostInteractionTarget(target);
	}
	assertTurnBehaviors(turn.behaviors, `${field}.behaviors`);
	assertTurnInteractions(turn.interactions, `${field}.interactions`);
	if (turn.state === 'failed') {
		if (turn.failure === undefined) {
			invalidChatState(`${field}.failure`, 'missing');
		}
		assertOperationFailure(turn.failure, `${field}.failure`);
	} else if (turn.failure !== undefined) {
		invalidChatState(`${field}.failure`, turn.failure);
	}

	return { id: turn.id, state: turn.state as AgentHostTurnState };
}

export function assertAgentHostChatState(value: unknown): asserts value is IAgentHostChatState {
	assertAgentHostProtocolValue(value);
	const chat = chatStateRecord(value, 'chat');
	assertChatStateKeys(
		chat,
		[
			'id', 'createdAt', 'title', 'origin', 'model', 'lifecycle', 'interactivity', 'status', 'isRead', 'capabilities',
			'modifiedAt', 'session', 'turns',
		],
		['activeTurn'],
		'chat',
	);
	assertChatStateString(chat.id, 'chat.id', 128);
	assertChatStateString(chat.session, 'chat.session', 128);
	createAgentChatId(chat.id);
	createAgentSessionId(chat.session);
	assertChatStateTimestamp(chat.createdAt, 'chat.createdAt');
	assertChatStateTimestamp(chat.modifiedAt, 'chat.modifiedAt');
	if (chat.modifiedAt < chat.createdAt) {
		invalidChatState('chat.modifiedAt', chat.modifiedAt);
	}
	assertChatStateString(chat.title, 'chat.title', 1_024, true);
	assertChatOrigin(chat.origin, 'chat.origin');
	if (chat.model !== null) {
		assertChatStateString(chat.model, 'chat.model', 128);
		createAgentModelId(chat.model);
	}
	if (!['available', 'released', 'unavailable'].includes(String(chat.lifecycle))) {
		invalidChatState('chat.lifecycle', chat.lifecycle);
	}
	if (!['full', 'readOnly', 'hidden'].includes(String(chat.interactivity))) {
		invalidChatState('chat.interactivity', chat.interactivity);
	}
	if (!['running', 'needsInput', 'completed', 'failed'].includes(String(chat.status))) {
		invalidChatState('chat.status', chat.status);
	}
	if (typeof chat.isRead !== 'boolean') {
		invalidChatState('chat.isRead', chat.isRead);
	}
	assertChatCapabilities(chat.capabilities, 'chat.capabilities');
	if (!Array.isArray(chat.turns)) {
		invalidChatState('chat.turns', chat.turns);
	}

	const turnIds = new Set<string>();
	const submissionIds = new Set<string>();
	let executingTurn: string | undefined;
	for (const [index, turnValue] of chat.turns.entries()) {
		const turn = assertTurn(turnValue, `chat.turns.${index}`);
		const turnRecord = chatStateRecord(turnValue, `chat.turns.${index}`);
		if (turnIds.has(turn.id) || submissionIds.has(String(turnRecord.submission))) {
			invalidChatState(`chat.turns.${index}.id`, turn.id);
		}
		turnIds.add(turn.id);
		submissionIds.add(String(turnRecord.submission));
		if (['running', 'waitingForPermission', 'waitingForInput', 'cancelling'].includes(turn.state)) {
			if (executingTurn !== undefined) {
				invalidChatState(`chat.turns.${index}.state`, turn.state);
			}
			executingTurn = turn.id;
		}
	}

	if (chat.activeTurn !== undefined) {
		assertChatStateString(chat.activeTurn, 'chat.activeTurn', 128);
		createAgentTurnId(chat.activeTurn);
		if (executingTurn !== chat.activeTurn) {
			invalidChatState('chat.activeTurn', chat.activeTurn);
		}
	} else if (executingTurn !== undefined) {
		invalidChatState('chat.activeTurn', 'missing');
	}
}
