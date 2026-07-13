/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentTurnResponsePart } from 'cs/platform/agentHost/common/agent';
import {
	createAgentChatId,
	createAgentSessionId,
	createAgentToolId,
	createAgentTurnId,
	type AgentChatId,
	type AgentSessionId,
	type AgentToolId,
	type AgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostTurn } from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';

export const ChatHostPresentationSchemaVersion = 1;

declare const chatPresentationTypeIdBrand: unique symbol;

export type ChatPresentationTypeId = string & {
	readonly [chatPresentationTypeIdBrand]: true;
};

/** Validates one stable Feature-owned presentation type ID. */
export function createChatPresentationTypeId(value: string): ChatPresentationTypeId {
	if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(value) || value.length > 128) {
		throw new TypeError(`Chat presentation type '${value}' is invalid.`);
	}
	return value as ChatPresentationTypeId;
}

/** Persistable opaque presentation associated with one exact canonical Host response part. */
export interface IChatHostPresentation {
	readonly schemaVersion: typeof ChatHostPresentationSchemaVersion;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly responsePartIndex: number;
	readonly type: ChatPresentationTypeId;
	readonly value: AgentHostProtocolValue;
}

export interface IChatHostPresentationIdentity {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly responsePartIndex: number;
}

export interface IChatHostPresentationProjectionContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: IAgentHostTurn;
	readonly responsePartIndex: number;
	readonly call: Extract<AgentTurnResponsePart, { readonly kind: 'toolCall' }>;
	readonly result: Extract<AgentTurnResponsePart, { readonly kind: 'toolResult' }> & {
		readonly status: 'completed';
		readonly output: AgentHostProtocolValue;
	};
}

export interface IChatHostPresentationProjection {
	readonly type: ChatPresentationTypeId;
	readonly value: AgentHostProtocolValue;
}

/** Feature-owned projection from one canonical Tool result to an opaque Chat presentation. */
export interface IChatHostPresentationProvider {
	readonly tool: AgentToolId;
	project(
		context: IChatHostPresentationProjectionContext,
		persistedValue: AgentHostProtocolValue | undefined,
	): IChatHostPresentationProjection;
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
	record: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	label: string,
): void {
	if (Object.keys(record).length !== keys.length
		|| Object.keys(record).some(key => !keys.includes(key))) {
		throw new TypeError(`${label} contains unsupported or missing properties.`);
	}
}

function requireString(value: unknown, label: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function cloneProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(cloneProtocolValue));
	}
	return Object.freeze(Object.fromEntries(
		Object.entries(value).map(([key, child]) => [key, cloneProtocolValue(child)]),
	));
}

/** Strictly parses one generic presentation without consulting Feature state. */
export function parseChatHostPresentation(value: unknown): IChatHostPresentation {
	const presentation = requireRecord(value, 'Host presentation');
	requireExactKeys(presentation, [
		'schemaVersion',
		'session',
		'chat',
		'turn',
		'responsePartIndex',
		'type',
		'value',
	], 'Host presentation');
	if (presentation.schemaVersion !== ChatHostPresentationSchemaVersion) {
		throw new TypeError('Host presentation schema version is unsupported.');
	}
	assertAgentHostProtocolValue(presentation.value);
	if (new TextEncoder().encode(encodeAgentHostProtocolValue(presentation.value)).byteLength
		> 64 * 1024 * 1024) {
		throw new RangeError('Host presentation value exceeds its byte limit.');
	}
	return Object.freeze({
		schemaVersion: ChatHostPresentationSchemaVersion,
		session: createAgentSessionId(
			requireString(presentation.session, 'Host presentation Session ID', 128),
		),
		chat: createAgentChatId(requireString(presentation.chat, 'Host presentation Chat ID', 128)),
		turn: createAgentTurnId(requireString(presentation.turn, 'Host presentation Turn ID', 128)),
		responsePartIndex: requireNonNegativeInteger(
			presentation.responsePartIndex,
			'Host presentation response-part index',
		),
		type: createChatPresentationTypeId(
			requireString(presentation.type, 'Host presentation type', 128),
		),
		value: cloneProtocolValue(presentation.value),
	});
}

/** Validates one Feature projection before Chat associates it with Host identity. */
export function parseChatHostPresentationProjection(
	providerTool: AgentToolId,
	value: unknown,
): IChatHostPresentationProjection {
	createAgentToolId(providerTool);
	const projection = requireRecord(value, `Host presentation projection '${providerTool}'`);
	requireExactKeys(projection, ['type', 'value'], `Host presentation projection '${providerTool}'`);
	assertAgentHostProtocolValue(projection.value);
	return Object.freeze({
		type: createChatPresentationTypeId(
			requireString(projection.type, `Host presentation projection '${providerTool}' type`, 128),
		),
		value: cloneProtocolValue(projection.value),
	});
}
