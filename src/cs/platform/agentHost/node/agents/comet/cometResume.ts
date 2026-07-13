/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AgentChatOrigin,
	IAgentResumeState,
	IAgentWorkspace,
} from 'cs/platform/agentHost/common/agent';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentChatId,
	AgentSessionId,
	AgentTurnId,
	createAgentChatId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentInteractionTargetId,
	createAgentResumeSchemaId,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolRegistrationId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { AgentToolResult } from 'cs/platform/agentHost/common/tools';
import type {
	CometModelMessage,
	CometModelOutputPart,
	CometModelToolCall,
} from './cometModel.js';

export const COMET_AGENT_RESUME_SCHEMA = createAgentResumeSchemaId('comet.v1');

const maximumResumeBytes = 1024 * 1024;
const maximumTurns = 10_000;
const maximumMessages = 100_000;
const maximumPartsPerMessage = 256;
const maximumTextBytes = 4 * 1024 * 1024;
const maximumToolFailureMessageLength = 8_192;

/** Supplies one terminal Turn boundary stored in a Comet Chat resume. */
export interface ICometChatResumeTurnV1 {
	readonly turn: AgentTurnId;
	readonly messageLength: number;
	readonly checkpoint?: AgentHostProtocolValue;
}

/** Supplies the complete durable Comet Chat state encoded by resume schema v1. */
export interface ICometChatResumeV1 {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly origin: AgentChatOrigin;
	readonly baseMessageLength: number;
	readonly messages: readonly CometModelMessage[];
	readonly checkpoint?: AgentHostProtocolValue;
	readonly usage: readonly AgentHostProtocolValue[];
	readonly turns: readonly ICometChatResumeTurnV1[];
}

function invalidResume(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Comet resume value',
		{ field, value: diagnostic },
	);
}

function validateText(value: string, field: string): void {
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > maximumTextBytes) {
		invalidResume(field, value);
	}
}

function workspaceToProtocolValue(workspace: IAgentWorkspace | undefined): AgentHostProtocolValue {
	if (workspace === undefined) {
		return null;
	}
	if (workspace.folders.length > 128) {
		invalidResume('workspace.folders', workspace.folders.length);
	}
	return {
		resource: workspace.resource,
		label: workspace.label,
		folders: workspace.folders.map(folder => ({
			resource: folder.resource,
			workingDirectory: folder.workingDirectory,
			name: folder.name,
			...(folder.repository === undefined ? {} : {
				repository: {
					root: folder.repository.root,
					...(folder.repository.branch === undefined ? {} : { branch: folder.repository.branch }),
					...(folder.repository.baseBranch === undefined ? {} : { baseBranch: folder.repository.baseBranch }),
				},
			}),
		})),
	};
}

function originToProtocolValue(origin: AgentChatOrigin): AgentHostProtocolValue {
	if (origin.kind === 'user') {
		return { kind: 'user' };
	}
	createAgentChatId(origin.parentChat);
	createAgentTurnId(origin.parentTurn);
	if (origin.kind === 'fork') {
		return { kind: 'fork', parentChat: origin.parentChat, parentTurn: origin.parentTurn };
	}
	createAgentToolCallId(origin.toolCall);
	return {
		kind: 'tool',
		parentChat: origin.parentChat,
		parentTurn: origin.parentTurn,
		toolCall: origin.toolCall,
	};
}

function optionalProtocolValue(value: AgentHostProtocolValue | undefined): AgentHostProtocolValue {
	if (value === undefined) {
		return { present: false };
	}
	assertAgentHostProtocolValue(value);
	return { present: true, value };
}

function modelToolCallToProtocolValue(call: CometModelToolCall): AgentHostProtocolValue {
	createAgentToolCallId(call.id);
	createAgentToolRegistrationId(call.registrationId);
	assertAgentHostProtocolValue(call.input);
	if (call.target !== undefined) {
		createAgentInteractionTargetId(call.target);
	}
	const effect: AgentHostProtocolValue = call.effect.kind === 'read'
		? { kind: 'read' }
		: {
			kind: 'mutation',
			operation: createAgentHostOperationId(call.effect.operation),
			payloadDigest: createAgentHostPayloadDigest(call.effect.payloadDigest),
		};
	return {
		id: call.id,
		registrationId: call.registrationId,
		input: call.input,
		...(call.target === undefined ? {} : { target: call.target }),
		effect,
	};
}

function modelOutputPartToProtocolValue(part: CometModelOutputPart): AgentHostProtocolValue {
	if (part.kind === 'reasoning' || part.kind === 'text') {
		validateText(part.text, `message.parts.${part.kind}.text`);
		return { kind: part.kind, text: part.text };
	}
	return { kind: 'toolCall', call: modelToolCallToProtocolValue(part.call) };
}

function toolResultToProtocolValue(result: AgentToolResult): AgentHostProtocolValue {
	createAgentToolCallId(result.call);
	if (result.status === 'completed') {
		assertAgentHostProtocolValue(result.output);
		return { call: result.call, status: 'completed', output: result.output };
	}
	if (
		result.failure.message.length === 0
		|| result.failure.message.length > maximumToolFailureMessageLength
		|| (result.status !== 'failed' && result.failure.code !== result.status)
		|| (result.status === 'failed' && ['denied', 'cancelled', 'timedOut'].includes(result.failure.code))
		|| !['denied', 'cancelled', 'timedOut', 'unavailable', 'invalidInput', 'invalidOutput', 'failed'].includes(result.failure.code)
		|| (result.failure.reconciliation !== 'terminal' && result.failure.reconciliation !== 'sameOperationRequired')
	) {
		invalidResume('message.result.failure', result.failure.code);
	}
	if (result.failure.data !== undefined) {
		assertAgentHostProtocolValue(result.failure.data);
	}
	return {
		call: result.call,
		status: result.status,
		failure: {
			code: result.failure.code,
			message: result.failure.message,
			reconciliation: result.failure.reconciliation,
			...(result.failure.data === undefined ? {} : { data: result.failure.data }),
		},
	};
}

function modelMessageToProtocolValue(message: CometModelMessage): AgentHostProtocolValue {
	createAgentTurnId(message.turn);
	if (message.role === 'user') {
		validateText(message.text, 'message.text');
		return { role: 'user', turn: message.turn, text: message.text };
	}
	if (message.role === 'assistant') {
		if (message.parts.length > maximumPartsPerMessage) {
			invalidResume('message.parts.length', message.parts.length);
		}
		return {
			role: 'assistant',
			turn: message.turn,
			parts: message.parts.map(modelOutputPartToProtocolValue),
		};
	}
	return { role: 'tool', turn: message.turn, result: toolResultToProtocolValue(message.result) };
}

function validateMessageBoundaries(value: ICometChatResumeV1): void {
	if (
		!Number.isSafeInteger(value.baseMessageLength)
		|| value.baseMessageLength < 0
		|| value.baseMessageLength > value.messages.length
		|| (value.origin.kind !== 'fork' && value.baseMessageLength !== 0)
	) {
		invalidResume('baseMessageLength', value.baseMessageLength);
	}
	let previousMessageLength = value.baseMessageLength;
	const turnIds = new Set<AgentTurnId>();
	for (const [index, checkpoint] of value.turns.entries()) {
		createAgentTurnId(checkpoint.turn);
		if (
			turnIds.has(checkpoint.turn)
			|| !Number.isSafeInteger(checkpoint.messageLength)
			|| checkpoint.messageLength <= previousMessageLength
			|| checkpoint.messageLength > value.messages.length
			|| value.messages.slice(0, value.baseMessageLength).some(message => message.turn === checkpoint.turn)
		) {
			invalidResume(`turns.${index}.messageLength`, checkpoint.messageLength);
		}
		const turnMessages = value.messages.slice(previousMessageLength, checkpoint.messageLength);
		if (
			turnMessages[0]?.role !== 'user'
			|| turnMessages.some(message => message.turn !== checkpoint.turn)
			|| turnMessages.filter(message => message.role === 'user').length !== 1
		) {
			invalidResume(`turns.${index}.messages`, turnMessages.length);
		}
		turnIds.add(checkpoint.turn);
		previousMessageLength = checkpoint.messageLength;
	}
	if (previousMessageLength !== value.messages.length) {
		invalidResume('messages.length', value.messages.length);
	}
}

function encodeResumeState(value: AgentHostProtocolValue): IAgentResumeState {
	const data = encodeAgentHostProtocolValue(value);
	if (new TextEncoder().encode(data).byteLength > maximumResumeBytes) {
		invalidResume('byteLength', data.length);
	}
	return Object.freeze({ schema: COMET_AGENT_RESUME_SCHEMA, data });
}

/** Encodes one exact Comet Session resume using schema v1. */
export function encodeCometSessionResumeV1(session: AgentSessionId, workspace: IAgentWorkspace | undefined): IAgentResumeState {
	createAgentSessionId(session);
	return encodeResumeState({
		kind: 'session',
		version: 1,
		session,
		workspace: workspaceToProtocolValue(workspace),
	});
}

/** Encodes one exact Comet Chat resume using schema v1. */
export function encodeCometChatResumeV1(value: ICometChatResumeV1): IAgentResumeState {
	createAgentSessionId(value.session);
	createAgentChatId(value.chat);
	if (value.messages.length > maximumMessages || value.turns.length > maximumTurns || value.usage.length > maximumTurns) {
		invalidResume('collection.length', Math.max(value.messages.length, value.turns.length, value.usage.length));
	}
	validateMessageBoundaries(value);
	const messages = value.messages.map(modelMessageToProtocolValue);
	const usage = value.usage.map((entry, index) => {
		try {
			assertAgentHostProtocolValue(entry);
		} catch {
			return invalidResume(`usage.${index}`, entry);
		}
		return entry;
	});
	return encodeResumeState({
		kind: 'chat',
		version: 1,
		session: value.session,
		chat: value.chat,
		origin: originToProtocolValue(value.origin),
		baseMessageLength: value.baseMessageLength,
		messages,
		checkpoint: optionalProtocolValue(value.checkpoint),
		usage,
		turns: value.turns.map(turn => ({
			turn: turn.turn,
			messageLength: turn.messageLength,
			checkpoint: optionalProtocolValue(turn.checkpoint),
		})),
	});
}
