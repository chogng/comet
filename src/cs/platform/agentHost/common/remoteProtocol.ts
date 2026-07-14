/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode, type IAgentHostErrorDataByCode } from './errors.js';
import type { AgentHostChannelAction } from './protocol.js';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from './protocolValues.js';
import { createRemoteCapabilityId } from 'cs/platform/remote/common/remoteAuthority';

/** Exact command set carried by every remote Agent Host route. */
export const RemoteAgentHostProtocolCommand = {
	Identity: 'identity',
	Initialize: 'initialize',
	Reconnect: 'reconnect',
	SetSubscriptions: 'setSubscriptions',
	ResolveSessionConfiguration: 'resolveSessionConfiguration',
	CompleteSessionConfiguration: 'completeSessionConfiguration',
	PrepareSubmission: 'prepareSubmission',
	Mutate: 'mutate',
	GetOperationOutcome: 'getOperationOutcome',
	ExecutePackageOperation: 'executePackageOperation',
	GetPackageOperationOutcome: 'getPackageOperationOutcome',
	SynchronizeClientTools: 'synchronizeClientTools',
} as const;

export type RemoteAgentHostProtocolCommand = typeof RemoteAgentHostProtocolCommand[keyof typeof RemoteAgentHostProtocolCommand];

export const remoteAgentHostProtocolActionEvent = 'onDidReceiveAction';
export const remoteServerAgentHostChannelName = 'agentHost';
export const remoteServerAgentHostCapability = createRemoteCapabilityId('agentHost');
export const remoteAgentHostClientContentResourceChannelName = 'agentHost.contentResources';
export const remoteAgentHostClientToolChannelName = 'agentHost.clientTools';

const agentHostErrorCodes = new Set<string>(Object.values(AgentHostErrorCode));

function decodePayload(payload: string, field: string): AgentHostProtocolValue {
	let value: unknown;
	try {
		value = JSON.parse(payload);
	} catch {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Remote Agent Host payload is not valid JSON',
			{ field, value: payload.length },
		);
	}
	assertAgentHostProtocolValue(value);
	return value;
}

function requireRecord(value: AgentHostProtocolValue, field: string): Readonly<Record<string, AgentHostProtocolValue>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Remote Agent Host payload is not an object',
			{ field, value: typeof value },
		);
	}
	return value as Readonly<Record<string, AgentHostProtocolValue>>;
}

/** Decodes one bounded Agent Host protocol value from a lower transport frame. */
export function decodeRemoteAgentHostProtocolPayload(payload: string): AgentHostProtocolValue {
	return decodePayload(payload, 'payload');
}

/** Encodes one bounded Agent Host protocol value for a lower transport frame. */
export function encodeRemoteAgentHostProtocolPayload(value: AgentHostProtocolValue | object): string {
	return encodeAgentHostProtocolValue(value);
}

/** Encodes one successful remote command result. */
export function encodeRemoteAgentHostProtocolSuccess(value: AgentHostProtocolValue | object): string {
	assertAgentHostProtocolValue(value);
	return encodeAgentHostProtocolValue(Object.freeze({ kind: 'success', value }));
}

/** Encodes one typed Agent Host failure without converting it into transport failure. */
export function encodeRemoteAgentHostProtocolError(error: AgentHostError): string {
	assertAgentHostProtocolValue(error.data);
	return encodeAgentHostProtocolValue(Object.freeze({
		kind: 'agentHostError',
		code: error.code,
		message: error.message.slice(0, 4_096),
		data: error.data,
	}));
}

/** Decodes one remote command result and restores typed Agent Host failures. */
export function decodeRemoteAgentHostProtocolResponse(payload: string): AgentHostProtocolValue {
	const record = requireRecord(decodePayload(payload, 'response'), 'response');
	if (record.kind === 'success') {
		if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'value')) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Remote Agent Host success response has an invalid shape',
				{ field: 'response', value: Object.keys(record).length },
			);
		}
		return record.value;
	}
	if (
		record.kind !== 'agentHostError'
		|| Object.keys(record).length !== 4
		|| typeof record.code !== 'string'
		|| !agentHostErrorCodes.has(record.code)
		|| typeof record.message !== 'string'
		|| record.message.length > 4_096
		|| !Object.hasOwn(record, 'data')
	) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Remote Agent Host response has an invalid shape',
			{ field: 'response.kind', value: typeof record.kind === 'string' ? record.kind : typeof record.kind },
		);
	}
	const code = record.code as AgentHostErrorCode;
	throw new AgentHostError(
		code,
		record.message,
		record.data as IAgentHostErrorDataByCode[AgentHostErrorCode],
	);
}

/** Decodes one ordered action from a remote Agent Host route. */
export function decodeRemoteAgentHostAction(payload: string): AgentHostChannelAction {
	return decodeRemoteAgentHostProtocolPayload(payload) as unknown as AgentHostChannelAction;
}

/** Encodes one ordered action for a remote Agent Host route. */
export function encodeRemoteAgentHostAction(action: AgentHostChannelAction): string {
	return encodeRemoteAgentHostProtocolPayload(action);
}
