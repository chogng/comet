/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type {
	IAgentExecutionProfile,
	IAgentExecutionProfileRequest,
	IAgentModelDescriptor,
	IAgentWorkspace,
} from 'cs/platform/agentHost/common/agent';
import type {
	IAgentHostAttachment,
	IAgentHostContentReference,
	IAgentHostInteractionTarget,
	IAgentHostInlineContent,
} from 'cs/platform/agentHost/common/attachments';
import type { AgentContentTreeEntry } from 'cs/platform/agentHost/common/contentResources';
import type {
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentChatId,
	AgentInteractionTargetId,
	AgentSessionId,
	AgentToolCallId,
	AgentToolRegistrationId,
	AgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type {
	AgentToolResult,
	IAgentToolSet,
} from 'cs/platform/agentHost/common/tools';

export type CometModelErrorCode =
	| 'invalidConfiguration'
	| 'invalidExecutionSelection'
	| 'invalidExecutionSettings'
	| 'authenticationRequired'
	| 'executionConnectionChanged'
	| 'connectionResolutionFailed'
	| 'invalidCanonicalMessage'
	| 'unsupportedAttachment'
	| 'invalidCanonicalTool'
	| 'invalidProviderResponse'
	| 'providerRequestFailed'
	| 'deadlineExceeded';

export class CometModelError extends Error {
	constructor(
		readonly code: CometModelErrorCode,
		message: string,
		readonly data?: AgentHostProtocolValue,
	) {
		super(message);
		this.name = 'CometModelError';
	}
}

export interface ICometExecutionProfileResolution {
	readonly modelRuntime: string;
	readonly settings: AgentHostProtocolValue;
	readonly maximumSteps: number;
}

export interface ICometExecutionProfileResolver {
	resolve(request: IAgentExecutionProfileRequest): Promise<ICometExecutionProfileResolution>;
}

export interface CometModelToolCall {
	readonly id: AgentToolCallId;
	readonly registrationId: AgentToolRegistrationId;
	readonly input: AgentHostProtocolValue;
	readonly target?: AgentInteractionTargetId;
	readonly effect:
		| { readonly kind: 'read' }
		| {
			readonly kind: 'mutation';
			readonly operation: AgentHostOperationId;
			readonly payloadDigest: AgentHostPayloadDigest;
		};
}

export type CometModelOutputPart =
	| {
		readonly kind: 'reasoning';
		readonly text: string;
	}
	| {
		readonly kind: 'text';
		readonly text: string;
	}
	| {
		readonly kind: 'toolCall';
		readonly call: CometModelToolCall;
	};

export type CometModelMessage =
	| {
		readonly role: 'user';
		readonly turn: AgentTurnId;
		readonly text: string;
	}
	| {
		readonly role: 'assistant';
		readonly turn: AgentTurnId;
		readonly parts: readonly CometModelOutputPart[];
	}
	| {
		readonly role: 'tool';
		readonly turn: AgentTurnId;
		readonly result: AgentToolResult;
	};

export type CometModelAttachmentContent =
	| {
		readonly kind: 'inline';
		readonly content: IAgentHostInlineContent;
	}
	| {
		readonly kind: 'materialized';
		readonly content: IAgentHostContentReference;
		readonly resource: string;
		readonly treeEntries: readonly AgentContentTreeEntry[] | null;
	};

export interface ICometModelAttachment {
	readonly attachment: IAgentHostAttachment;
	readonly content?: CometModelAttachmentContent;
}

export interface ICometModelStepRequest {
	readonly profile: IAgentExecutionProfile;
	readonly settings: AgentHostProtocolValue;
	readonly systemPrompt: string;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly workspace?: IAgentWorkspace;
	readonly step: number;
	readonly messages: readonly CometModelMessage[];
	readonly attachments: readonly ICometModelAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
	readonly toolSet: IAgentToolSet;
	readonly deadline: number;
	readonly outputConstraints: AgentHostProtocolValue;
	readonly checkpoint?: AgentHostProtocolValue;
}

export interface ICometModelStepResult {
	readonly stopReason: 'completed' | 'toolCalls';
	readonly parts: readonly CometModelOutputPart[];
	readonly usage?: AgentHostProtocolValue;
	readonly checkpoint?: AgentHostProtocolValue;
}

export interface ICometModelRuntime {
	readonly id: string;
	readonly descriptor: IAgentModelDescriptor;
	executeStep(request: ICometModelStepRequest, token: CancellationToken): Promise<ICometModelStepResult>;
}
