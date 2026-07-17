/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { IObservable } from 'cs/base/common/observable';
import { IAgentHostAttachment, IAgentHostInteractionTarget } from './attachments.js';
import {
	IAgentConfigurationCandidate,
	IAgentConfigurationCompletion,
	IAgentConfigurationSchema,
	IAgentConfigurationState,
} from './configuration.js';
import {
	AgentCapabilityRevision,
	AgentBehaviorActivityId,
	AgentCancellationId,
	AgentChatId,
	AgentConfigurationPropertyId,
	AgentConfigurationSchemaRevision,
	AgentConfigurationStateRevision,
	AgentDescriptorRevision,
	AgentExecutionProfileDigest,
	AgentExecutionProfileRevision,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentId,
	AgentInteractionId,
	AgentModelDescriptorRevision,
	AgentModelId,
	AgentPackageId,
	AgentPackageOperationId,
	AgentPlanId,
	AgentResumeSchemaId,
	AgentResumeStateDigest,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentSubmissionId,
	AgentTaskId,
	AgentToolCallId,
	AgentToolId,
	AgentToolSchemaProfileId,
	AgentTurnId,
} from './identities.js';
import { AgentHostProtocolValue } from './protocolValues.js';
import { IAgentToolSet } from './tools.js';
import type { IAgentCredentialReference } from './credentials.js';

export interface IAgentResumeMigrationEdge {
	readonly sourceSchema: AgentResumeSchemaId;
	readonly targetSchema: AgentResumeSchemaId;
}

export interface IAgentRuntimeRegistration {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly revision: AgentRuntimeRegistrationRevision;
	readonly descriptorRevision: AgentDescriptorRevision;
	readonly capabilityRevision: AgentCapabilityRevision;
	readonly hostDefaultsSchema: IAgentConfigurationSchema;
	readonly initialSessionConfigurationSchema: AgentConfigurationSchemaRevision;
	readonly supportedSessionConfigurationSchemas: readonly AgentConfigurationSchemaRevision[];
	readonly supportedToolSchemaProfiles: readonly AgentToolSchemaProfileId[];
	readonly supportedResumeSchemas: readonly AgentResumeSchemaId[];
	readonly resumeMigrationEdges: readonly IAgentResumeMigrationEdge[];
}

export interface IAgentAttachmentCapabilities {
	readonly carriers: readonly ('inline' | 'reference')[];
	readonly shapes: readonly ('blob' | 'tree')[];
	readonly mediaTypes: readonly string[];
	readonly maximumCount: number;
	readonly maximumItemBytes: number;
	readonly maximumTotalBytes: number;
	readonly maximumTreeDepth: number;
	readonly maximumTreeEntries: number;
	readonly supportsClientContentForBackgroundExecution: boolean;
}

export interface IAgentModelDescriptor {
	readonly id: AgentModelId;
	readonly revision: AgentModelDescriptorRevision;
	readonly displayName: string;
	readonly enabled: boolean;
	readonly configurationSchema: IAgentConfigurationSchema;
	readonly toolSchemaProfiles: readonly AgentToolSchemaProfileId[];
	readonly attachments: IAgentAttachmentCapabilities;
}

export interface IAgentCapabilities {
	readonly revision: AgentCapabilityRevision;
	readonly supportsEmptySession: boolean;
	readonly supportsCreateChat: boolean;
	readonly maximumChatCount: number | undefined;
	readonly supportsForkChat: boolean;
	readonly supportsQueue: boolean;
	readonly supportsSteering: boolean;
	readonly supportsCancellation: boolean;
	readonly supportsReleaseSession: boolean;
	readonly supportsReleaseChat: boolean;
	readonly supportsDeleteSession: boolean;
	readonly supportsDeleteChat: boolean;
}

export interface IAgentDescriptor {
	readonly id: AgentId;
	readonly packageId: AgentPackageId;
	readonly revision: AgentDescriptorRevision;
	readonly displayName: string;
	readonly description: string;
	readonly capabilities: IAgentCapabilities;
	readonly models: readonly IAgentModelDescriptor[];
	readonly requiresAgentAuthentication: boolean;
}

export interface IAgentExecutionProfileSelection {
	readonly kind: 'user' | 'product';
	readonly value: AgentHostProtocolValue;
	readonly configuration: IAgentConfigurationCandidate;
}

export interface IAgentExecutionProfileRequest {
	readonly submission: AgentSubmissionId;
	readonly selection: IAgentExecutionProfileSelection;
	readonly selectionDigest: AgentHostPayloadDigest;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly sessionConfiguration: IAgentConfigurationState;
}

export interface IAgentExecutionProfile {
	readonly revision: AgentExecutionProfileRevision;
	readonly digest: AgentExecutionProfileDigest;
	readonly agentDescriptor: AgentDescriptorRevision;
	readonly modelDescriptor: AgentModelDescriptorRevision;
	readonly data: string;
}

export interface IAgentExecutionProfiles {
	resolve(request: IAgentExecutionProfileRequest): Promise<IAgentExecutionProfile>;
}

export interface IAgentResumeState {
	readonly schema: AgentResumeSchemaId;
	readonly data: string;
}

export interface IAgentBackingIdentity {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly sessionId: AgentSessionId;
	readonly chatId?: AgentChatId;
}

export interface IAgentResumeMigrationRequest {
	readonly operation: AgentPackageOperationId;
	readonly backing: IAgentBackingIdentity;
	readonly source: IAgentResumeState;
	readonly sourceDigest: AgentResumeStateDigest;
	readonly targetSchema: AgentResumeSchemaId;
}

export interface IAgentResumeStates {
	migrate(request: IAgentResumeMigrationRequest): Promise<IAgentResumeState>;
}

export interface IAgentOperationContext {
	readonly operation: AgentHostOperationId;
	readonly payloadDigest: AgentHostPayloadDigest;
}

export interface IAgentResolveSessionConfigurationRequest {
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly workspace?: IAgentWorkspace;
	readonly hostDefaults: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationCandidate;
}

export interface IAgentResolvedSessionConfiguration {
	readonly schema: IAgentConfigurationSchema;
	readonly values: IAgentConfigurationState['values'];
}

export interface IAgentSessionConfigurationCompletionRequest {
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly workspace?: IAgentWorkspace;
	readonly hostDefaults: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationCandidate;
	readonly resolvedSchema: IAgentConfigurationSchema;
	readonly property: AgentConfigurationPropertyId;
	readonly query: string;
	readonly limit: number;
}

export interface IAgentPrepareSessionConfigurationUpdateRequest extends IAgentOperationContext {
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly current: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationState;
}

export interface IAgentFinalizeSessionConfigurationUpdateRequest extends IAgentOperationContext {
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly configuration: AgentConfigurationStateRevision;
}

export type AgentSessionConfigurationUpdateDecision = 'commit' | 'rollback';

export interface IAgentAcknowledgeSessionConfigurationUpdateRequest extends IAgentFinalizeSessionConfigurationUpdateRequest {
	readonly decision: AgentSessionConfigurationUpdateDecision;
}

export interface IAgentConfiguration {
	resolveSession(request: IAgentResolveSessionConfigurationRequest): Promise<IAgentResolvedSessionConfiguration>;
	completeSession(request: IAgentSessionConfigurationCompletionRequest): Promise<readonly IAgentConfigurationCompletion[]>;
	prepareSessionUpdate(request: IAgentPrepareSessionConfigurationUpdateRequest): Promise<void>;
	commitSessionUpdate(request: IAgentFinalizeSessionConfigurationUpdateRequest): Promise<void>;
	/** Idempotently finalizes an unapplied rollback intent as well as a prepared rollback. */
	rollbackSessionUpdate(request: IAgentFinalizeSessionConfigurationUpdateRequest): Promise<void>;
	/** Releases only matching terminal transaction state; an absent terminal record is already clean. */
	acknowledgeSessionUpdate(request: IAgentAcknowledgeSessionConfigurationUpdateRequest): Promise<void>;
}

export interface IAgentWorkspaceRepository {
	readonly root: string;
	readonly branch?: string;
	readonly baseBranch?: string;
}

export interface IAgentWorkspaceFolder {
	readonly resource: string;
	readonly workingDirectory: string;
	readonly name: string;
	readonly repository?: IAgentWorkspaceRepository;
}

export interface IAgentWorkspace {
	readonly resource: string;
	readonly label: string;
	readonly folders: readonly IAgentWorkspaceFolder[];
}

export interface IAgentCreateSessionOptions extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly configuration: IAgentConfigurationState;
	readonly workspace?: IAgentWorkspace;
}

export interface IAgentMaterializeSessionRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly configuration: IAgentConfigurationState;
	readonly resume?: IAgentResumeState;
}

export interface IAgentReleaseSessionRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
}

export interface IAgentDeleteSessionRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
}

export interface IAgentSessionBacking {
	readonly session: AgentSessionId;
	readonly resume?: IAgentResumeState;
}

export interface IAgentSessions {
	create(options: IAgentCreateSessionOptions): Promise<IAgentSessionBacking>;
	materialize(request: IAgentMaterializeSessionRequest): Promise<void>;
	release(request: IAgentReleaseSessionRequest): Promise<void>;
	delete(request: IAgentDeleteSessionRequest): Promise<void>;
}

export type AgentChatOrigin =
	| { readonly kind: 'user' }
	| {
		readonly kind: 'fork';
		readonly parentChat: AgentChatId;
		readonly parentTurn: AgentTurnId;
	}
	| {
		readonly kind: 'tool';
		readonly parentChat: AgentChatId;
		readonly parentTurn: AgentTurnId;
		readonly toolCall: AgentToolCallId;
	};

export interface IAgentCreateChatOptions extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly origin: AgentChatOrigin;
}

export interface IAgentMaterializeChatRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly resume?: IAgentResumeState;
}

export interface IAgentReleaseChatRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
}

export interface IAgentChatForkSource {
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
}

export interface IAgentForkChatRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly source: IAgentChatForkSource;
}

export interface IAgentDeleteChatRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
}

export interface IAgentChatBacking {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly resume?: IAgentResumeState;
}

export interface IAgentTurnExecutionBinding {
	readonly profile: IAgentExecutionProfile;
	readonly modelConfiguration: IAgentConfigurationCandidate;
	readonly credentials: readonly IAgentCredentialReference[];
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly toolSet: IAgentToolSet;
	readonly deadline: number;
	readonly cancellation: AgentCancellationId;
	readonly outputConstraints: AgentHostProtocolValue;
	readonly resume?: IAgentResumeState;
}

export interface IAgentChatRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly submission: AgentSubmissionId;
	readonly message: string;
	readonly attachments: readonly IAgentHostAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
	readonly binding: IAgentTurnExecutionBinding;
}

export interface IAgentSteerRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly message: string;
}

export interface IAgentCancelTurnRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
}

export interface IAgentInteractionOption {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
}

interface IAgentInteractionRequestBase {
	readonly id: AgentInteractionId;
	readonly title: string;
	readonly description: string;
	readonly activity?: AgentBehaviorActivityId;
	readonly metadata: AgentHostProtocolValue;
}

export type AgentInteractionRequest =
	| IAgentInteractionRequestBase & {
		readonly kind: 'permission' | 'confirmation';
		readonly options: readonly IAgentInteractionOption[];
	}
	| IAgentInteractionRequestBase & {
		readonly kind: 'input';
		readonly input: {
			readonly shape: 'text' | 'choice' | 'form';
			readonly schema: AgentHostProtocolValue;
			readonly initialValue?: AgentHostProtocolValue;
		};
	};

export type AgentInteractionResponse =
	| {
		readonly kind: 'selected';
		readonly option: string;
		readonly data?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'submitted';
		readonly value: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'cancelled';
	};

export interface IAgentInteractionResponseRequest extends IAgentOperationContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly interaction: AgentInteractionId;
	readonly response: AgentInteractionResponse;
}

export interface IAgentInteractions {
	respond(request: IAgentInteractionResponseRequest): Promise<void>;
}

export interface IAgentChats {
	create(options: IAgentCreateChatOptions): Promise<IAgentChatBacking>;
	materialize(request: IAgentMaterializeChatRequest): Promise<void>;
	release(request: IAgentReleaseChatRequest): Promise<void>;
	fork(request: IAgentForkChatRequest): Promise<IAgentChatBacking>;
	send(request: IAgentChatRequest): Promise<void>;
	steer(request: IAgentSteerRequest): Promise<void>;
	cancel(request: IAgentCancelTurnRequest): Promise<void>;
	delete(request: IAgentDeleteChatRequest): Promise<void>;
}

export type AgentTurnProgressState =
	| 'accepted'
	| 'queued'
	| 'running'
	| 'waitingForPermission'
	| 'waitingForInput'
	| 'cancelling';

export type AgentTurnBehavior =
	| {
		readonly kind: 'text';
		readonly text: string;
	}
	| {
		readonly kind: 'reasoning';
		readonly text: string;
	}
	| {
		readonly kind: 'contributedToolCall';
		readonly call: AgentToolCallId;
		readonly tool: AgentToolId;
		readonly input: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'contributedToolResult';
		readonly call: AgentToolCallId;
		readonly status: 'completed' | 'denied' | 'cancelled' | 'timedOut' | 'failed';
		readonly output?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'nativeTool';
		readonly activity: AgentBehaviorActivityId;
		readonly name: string;
		readonly category: 'command' | 'file' | 'search' | 'mcp' | 'other';
		readonly state: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
		readonly input?: AgentHostProtocolValue;
		readonly output?: AgentHostProtocolValue;
		readonly parentActivity?: AgentBehaviorActivityId;
	}
	| {
		readonly kind: 'plan';
		readonly plan: AgentPlanId;
		readonly title: string;
		readonly state: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
		readonly steps: readonly {
			readonly task: AgentTaskId;
			readonly title: string;
			readonly state: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
		}[];
	}
	| {
		readonly kind: 'task';
		readonly task: AgentTaskId;
		readonly title: string;
		readonly state: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
		readonly parentTask?: AgentTaskId;
		readonly childChat?: AgentChatId;
		readonly detail?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'background';
		readonly activity: AgentBehaviorActivityId;
		readonly title: string;
		readonly state: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
		readonly detail?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'terminal';
		readonly activity: AgentBehaviorActivityId;
		readonly terminal: string;
		readonly stream: 'stdout' | 'stderr';
		readonly text: string;
	}
	| {
		readonly kind: 'fileChange';
		readonly activity: AgentBehaviorActivityId;
		readonly resource: string;
		readonly operation: 'create' | 'modify' | 'delete' | 'rename';
		readonly data?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'usage';
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly cachedInputTokens: number;
		readonly data?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'context';
		readonly usedTokens: number;
		readonly maximumTokens: number;
		readonly compaction: 'none' | 'running' | 'completed';
		readonly data?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'retry';
		readonly attempt: number;
		readonly reason: string;
		readonly data?: AgentHostProtocolValue;
	}
	| {
		readonly kind: 'status';
		readonly state: 'working' | 'waiting' | 'paused';
		readonly message: string;
		readonly data?: AgentHostProtocolValue;
	};

export type AgentTurnProgress =
	| {
		readonly kind: 'state';
		readonly state: AgentTurnProgressState;
	}
	| {
		readonly kind: 'behavior';
		readonly behavior: AgentTurnBehavior;
	};

export type IAgentAction =
	| {
		readonly kind: 'sessionResumeStateChanged';
		readonly session: AgentSessionId;
		readonly resume: IAgentResumeState;
	}
	| {
		readonly kind: 'chatResumeStateChanged';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly resume: IAgentResumeState;
	}
	| {
		readonly kind: 'turnProgress';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly progress: AgentTurnProgress;
	}
	| {
		readonly kind: 'interactionRequested';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly request: AgentInteractionRequest;
	}
	| {
		readonly kind: 'interactionCompleted';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly interaction: AgentInteractionId;
		readonly response: AgentInteractionResponse;
	}
	| {
		readonly kind: 'turnTerminal';
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
		readonly state: 'completed' | 'cancelled' | 'failed';
		readonly data?: AgentHostProtocolValue;
	};

export interface IAgent {
	readonly id: AgentId;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly registration: IAgentRuntimeRegistration;
	readonly onDidEmitAction: Event<IAgentAction>;
	readonly configuration: IAgentConfiguration;
	readonly executionProfiles: IAgentExecutionProfiles;
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
	readonly interactions: IAgentInteractions;
	readonly resumeStates: IAgentResumeStates;
}
