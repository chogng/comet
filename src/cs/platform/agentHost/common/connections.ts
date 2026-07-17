/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { IDisposable } from 'cs/base/common/lifecycle';
import { AgentHostError, AgentHostErrorCode, type AgentHostErrorCode as AgentHostErrorCodeValue } from './errors.js';
import {
	IAgentAction,
	IAgentCancelTurnRequest,
	IAgentChatBacking,
	IAgentChatRequest,
	IAgentCreateChatOptions,
	IAgentCreateSessionOptions,
	IAgentDeleteChatRequest,
	IAgentDeleteSessionRequest,
	IAgentDescriptor,
	IAgentAcknowledgeSessionConfigurationUpdateRequest,
	IAgentExecutionProfile,
	IAgentExecutionProfileRequest,
	IAgentFinalizeSessionConfigurationUpdateRequest,
	IAgentForkChatRequest,
	IAgentInteractionResponseRequest,
	IAgentMaterializeChatRequest,
	IAgentMaterializeSessionRequest,
	IAgentPrepareSessionConfigurationUpdateRequest,
	IAgentReleaseChatRequest,
	IAgentReleaseSessionRequest,
	IAgentResolvedSessionConfiguration,
	IAgentResolveSessionConfigurationRequest,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentRuntimeRegistration,
	IAgentSessionConfigurationCompletionRequest,
	IAgentSessionBacking,
	IAgentSteerRequest,
} from './agent.js';
import type { IAgentConfigurationCompletion } from './configuration.js';
import type { IAgentCredentialReference } from './credentials.js';
import {
	AgentHostAuthorityId,
	AgentHostClientConnectionId,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentId,
	AgentContentLeaseId,
	AgentContentMaterializationId,
	AgentPackageId,
	AgentPackageRevision,
	AgentRuntimeActionSequence,
	AgentRuntimeCallId,
	AgentRuntimeConnectionId,
	AgentRuntimeConnectionGeneration,
	AgentRuntimeHostOperationId,
	AgentRuntimeProtocolVersion,
	AgentRuntimeRegistrationRevision,
} from './identities.js';
import {
	AgentHostChannelAction,
	AgentHostMutationOutcome,
	AgentHostReconnectResult,
	AgentHostPrepareSubmissionResult,
	IAgentHostInitializeRequest,
	IAgentHostInitializeResult,
	IAgentHostMutationRequest,
	IAgentHostOperationOutcomeRequest,
	IAgentHostPrepareSubmissionRequest,
	IAgentHostReconnectRequest,
	IAgentHostResolveSessionConfigurationRequest,
	IAgentHostResolveSessionConfigurationResult,
	IAgentHostSessionConfigurationCompletionsRequest,
	IAgentHostSessionConfigurationCompletionsResult,
	IAgentHostSetSubscriptionsRequest,
	IAgentHostSetSubscriptionsResult,
} from './protocol.js';
import type {
	AgentPackageOperationOutcome,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
} from './packages.js';
import { AgentHostProtocolValue } from './protocolValues.js';
import type {
	IAgentContentBlobReadRequest,
	IAgentContentBlobReadResult,
	IAgentContentMaterialization,
	IAgentContentMaterializeRequest,
	IAgentContentResourceLease,
	IAgentContentResourceOpenRequest,
	IAgentContentTreeEntryReadRequest,
	IAgentContentTreePage,
	IAgentContentTreePageRequest,
} from './contentResources.js';
import type {
	AgentToolEndpointReconciliation,
	AgentToolResult,
	IAgentToolCall,
	IAgentToolProgress,
} from './tools.js';

export interface IAgentHostConnection extends IDisposable {
	readonly authority: AgentHostAuthorityId;
	readonly connection: AgentHostClientConnectionId;
	readonly onDidReceiveAction: Event<AgentHostChannelAction>;
	initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult>;
	reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult>;
	setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult>;
	resolveSessionConfiguration(request: IAgentHostResolveSessionConfigurationRequest): Promise<IAgentHostResolveSessionConfigurationResult>;
	completeSessionConfiguration(request: IAgentHostSessionConfigurationCompletionsRequest): Promise<IAgentHostSessionConfigurationCompletionsResult>;
	prepareSubmission(request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult>;
	mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome>;
	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome>;
	executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome>;
	getPackageOperationOutcome(request: IAgentPackageOperationOutcomeRequest): Promise<AgentPackageOperationOutcome>;
}

export interface IAgentRuntimeInitializeRequest {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly call: AgentRuntimeCallId;
	readonly protocolVersions: readonly AgentRuntimeProtocolVersion[];
	readonly transportLimits: IAgentRuntimeTransportLimits;
	readonly packageId: AgentPackageId;
	readonly packageRevision: AgentPackageRevision;
	readonly authorizedAgents: readonly AgentId[];
	readonly implementation: {
		readonly name: string;
		readonly build: string;
	};
}

export interface IAgentRuntimeTransportLimits {
	readonly maximumRequestBytes: number;
	readonly maximumResponseBytes: number;
	readonly maximumActionBytes: number;
	readonly maximumConcurrentCalls: number;
}

export interface IAgentRuntimeAgentRegistration {
	readonly registration: IAgentRuntimeRegistration;
	readonly descriptor: IAgentDescriptor;
}

export interface IAgentRuntimeInitializeResult {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly call: AgentRuntimeCallId;
	readonly protocolVersion: AgentRuntimeProtocolVersion;
	readonly transportLimits: IAgentRuntimeTransportLimits;
	readonly registrations: readonly IAgentRuntimeAgentRegistration[];
}

export function selectAgentRuntimeProtocolVersion(
	offered: readonly AgentRuntimeProtocolVersion[],
	supportedByPreference: readonly AgentRuntimeProtocolVersion[],
): AgentRuntimeProtocolVersion {
	const offeredVersions = new Set(offered);
	for (const version of supportedByPreference) {
		if (offeredVersions.has(version)) {
			return version;
		}
	}

	throw new AgentHostError(
		AgentHostErrorCode.UnsupportedProtocolVersion,
		'Agent Runtime protocol versions are incompatible',
		{ offered, supported: supportedByPreference },
	);
}

export interface IAgentRuntimeAction {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly sequence: AgentRuntimeActionSequence;
	readonly call: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: AgentId;
	readonly action: IAgentAction;
}

export interface IAgentRuntimeCall<TRequest> {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly call: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: AgentId;
	readonly request: TRequest;
}

export interface IAgentRuntimeResponse<TValue> {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly call: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: AgentId;
	readonly value: TValue;
}

export type AgentRuntimeOperationOutcome =
	| { readonly kind: 'unknown' }
	| { readonly kind: 'pending' }
	| {
		readonly kind: 'completed';
		readonly value: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'conflict';
		readonly recordedDigest: AgentHostPayloadDigest;
	};

export interface IAgentRuntimeOperationOutcomeRequest {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
}

export type AgentRuntimeHostOperation =
	| { readonly kind: 'tool.execute'; readonly call: IAgentToolCall }
	| { readonly kind: 'tool.cancel'; readonly call: IAgentToolCall }
	| { readonly kind: 'tool.reconcile'; readonly call: IAgentToolCall }
	| { readonly kind: 'credential.resolve'; readonly credential: IAgentCredentialReference }
	| { readonly kind: 'content.open'; readonly request: IAgentContentResourceOpenRequest }
	| { readonly kind: 'content.readBlob'; readonly request: IAgentContentBlobReadRequest }
	| { readonly kind: 'content.readTreePage'; readonly request: IAgentContentTreePageRequest }
	| { readonly kind: 'content.readTreeEntry'; readonly request: IAgentContentTreeEntryReadRequest }
	| { readonly kind: 'content.release'; readonly lease: AgentContentLeaseId }
	| { readonly kind: 'content.materialize'; readonly request: IAgentContentMaterializeRequest }
	| { readonly kind: 'content.releaseMaterialization'; readonly materialization: AgentContentMaterializationId }
	| { readonly kind: 'content.cancel'; readonly target: AgentRuntimeHostOperationId };

export interface IAgentRuntimeHostOperationRequest {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly operation: AgentRuntimeHostOperationId;
	readonly parentCall: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: AgentId;
	readonly request: AgentRuntimeHostOperation;
}

export interface IAgentRuntimeHostOperationProgress {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly operation: AgentRuntimeHostOperationId;
	readonly parentCall: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: AgentId;
	readonly progress: IAgentToolProgress;
}

export type AgentRuntimeHostOperationValue =
	| AgentToolResult
	| AgentToolEndpointReconciliation
	| string
	| IAgentContentResourceLease
	| IAgentContentBlobReadResult
	| IAgentContentTreePage
	| IAgentContentMaterialization
	| null;

export type AgentRuntimeHostOperationOutcome =
	| { readonly kind: 'completed'; readonly value: AgentRuntimeHostOperationValue }
	| { readonly kind: 'cancelled' }
	| {
		readonly kind: 'failed';
		readonly code: AgentHostErrorCodeValue;
		readonly message: string;
		readonly data: AgentHostProtocolValue;
	};

export interface IAgentRuntimeHostOperationResponse {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly operation: AgentRuntimeHostOperationId;
	readonly parentCall: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: AgentId;
	readonly outcome: AgentRuntimeHostOperationOutcome;
}

export type AgentRuntimeDisconnectReason =
	| 'transportClosed'
	| 'processExited'
	| 'protocolViolation'
	| 'disposed';

export type AgentRuntimeConnectionState =
	| {
		readonly kind: 'connected';
		readonly connection: AgentRuntimeConnectionId;
		readonly generation: AgentRuntimeConnectionGeneration;
	}
	| {
		readonly kind: 'disconnected';
		readonly connection: AgentRuntimeConnectionId;
		readonly generation: AgentRuntimeConnectionGeneration;
		readonly reason: AgentRuntimeDisconnectReason;
	};

/** Announces one negotiated replacement generation for the same logical Runtime connection. */
export interface IAgentRuntimeReconnectEvent {
	readonly connection: AgentRuntimeConnectionId;
	readonly previousGeneration: AgentRuntimeConnectionGeneration;
	readonly generation: AgentRuntimeConnectionGeneration;
}

export interface IAgentRuntimeConnection extends IDisposable {
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly state: AgentRuntimeConnectionState;
	readonly onDidDisconnect: Event<Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>>;
	readonly onDidReconnect: Event<IAgentRuntimeReconnectEvent>;
	readonly onDidEmitAction: Event<IAgentRuntimeAction>;
	readonly onDidRequestHostOperation: Event<IAgentRuntimeHostOperationRequest>;
	initialize(request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult>;
	resolveSessionConfiguration(request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>): Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>>;
	completeSessionConfiguration(request: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>): Promise<IAgentRuntimeResponse<readonly IAgentConfigurationCompletion[]>>;
	prepareSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>>;
	commitSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>>;
	rollbackSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>>;
	acknowledgeSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>>;
	resolveExecutionProfile(request: IAgentRuntimeCall<IAgentExecutionProfileRequest>): Promise<IAgentRuntimeResponse<IAgentExecutionProfile>>;
	migrateResumeState(request: IAgentRuntimeCall<IAgentResumeMigrationRequest>): Promise<IAgentRuntimeResponse<IAgentResumeState>>;
	createSession(request: IAgentRuntimeCall<IAgentCreateSessionOptions>): Promise<IAgentRuntimeResponse<IAgentSessionBacking>>;
	materializeSession(request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>): Promise<IAgentRuntimeResponse<null>>;
	releaseSession(request: IAgentRuntimeCall<IAgentReleaseSessionRequest>): Promise<IAgentRuntimeResponse<null>>;
	deleteSession(request: IAgentRuntimeCall<IAgentDeleteSessionRequest>): Promise<IAgentRuntimeResponse<null>>;
	createChat(request: IAgentRuntimeCall<IAgentCreateChatOptions>): Promise<IAgentRuntimeResponse<IAgentChatBacking>>;
	materializeChat(request: IAgentRuntimeCall<IAgentMaterializeChatRequest>): Promise<IAgentRuntimeResponse<null>>;
	releaseChat(request: IAgentRuntimeCall<IAgentReleaseChatRequest>): Promise<IAgentRuntimeResponse<null>>;
	forkChat(request: IAgentRuntimeCall<IAgentForkChatRequest>): Promise<IAgentRuntimeResponse<IAgentChatBacking>>;
	send(request: IAgentRuntimeCall<IAgentChatRequest>): Promise<IAgentRuntimeResponse<null>>;
	steer(request: IAgentRuntimeCall<IAgentSteerRequest>): Promise<IAgentRuntimeResponse<null>>;
	cancel(request: IAgentRuntimeCall<IAgentCancelTurnRequest>): Promise<IAgentRuntimeResponse<null>>;
	respondInteraction(request: IAgentRuntimeCall<IAgentInteractionResponseRequest>): Promise<IAgentRuntimeResponse<null>>;
	deleteChat(request: IAgentRuntimeCall<IAgentDeleteChatRequest>): Promise<IAgentRuntimeResponse<null>>;
	getOperationOutcome(request: IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>): Promise<IAgentRuntimeResponse<AgentRuntimeOperationOutcome>>;
	reportHostOperationProgress(progress: IAgentRuntimeHostOperationProgress): Promise<void>;
	completeHostOperation(response: IAgentRuntimeHostOperationResponse): Promise<void>;
}
