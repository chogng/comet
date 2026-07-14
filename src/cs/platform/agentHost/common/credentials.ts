/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type {
	AgentChatId,
	AgentId,
	AgentPackageId,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentTurnId,
} from './identities.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';

const maximumCredentialMetadataLength = 512;

/** A durable, non-secret reference to credential material owned by one credential provider. */
export interface IAgentCredentialReference {
	readonly provider: string;
	readonly scope: string;
	readonly reference: string;
}

export function validateAndFreezeAgentCredentialReference(value: unknown): IAgentCredentialReference {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
		|| Object.keys(value).length !== 3
	) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Invalid Agent credential reference',
			{ field: 'credential', value: 'invalid' },
		);
	}
	const credential = value as Readonly<Record<string, unknown>>;
	if (
		typeof credential.provider !== 'string'
		|| credential.provider.length === 0
		|| credential.provider.length > maximumCredentialMetadataLength
		|| typeof credential.scope !== 'string'
		|| credential.scope.length === 0
		|| credential.scope.length > maximumCredentialMetadataLength
		|| typeof credential.reference !== 'string'
		|| credential.reference.length === 0
		|| credential.reference.length > maximumCredentialMetadataLength
	) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Invalid Agent credential reference',
			{ field: 'credential', value: 'invalid' },
		);
	}
	return Object.freeze({
		provider: credential.provider,
		scope: credential.scope,
		reference: credential.reference,
	});
}

/** Resolves one exact credential for an already accepted and authorized Turn. */
export interface IAgentCredentialResolutionRequest {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly credential: IAgentCredentialReference;
}

/** Runtime-facing credential boundary. Resolved values are short-lived and must not be persisted. */
export interface IAgentCredentialResolver {
	resolve(request: IAgentCredentialResolutionRequest, token: CancellationToken): Promise<string>;
}
