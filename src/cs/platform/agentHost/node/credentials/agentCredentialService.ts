/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellationError } from 'cs/base/common/async';
import { CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError, isCancellationError } from 'cs/base/common/errors';
import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	validateAndFreezeAgentCredentialReference,
	type IAgentCredentialReference,
	type IAgentCredentialResolutionRequest,
	type IAgentCredentialResolver,
} from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentChatId,
	createAgentId,
	createAgentPackageId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentTurnId,
	type AgentChatId,
	type AgentId,
	type AgentPackageId,
	type AgentRuntimeRegistrationRevision,
	type AgentSessionId,
	type AgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentPackagePrivilege } from 'cs/platform/agentHost/common/packages';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';

const maximumCredentialMetadataLength = 512;
const maximumCredentialBytes = 64 * 1024;

export interface IAgentCredentialSecretSource {
	requiredPrivilege(credential: IAgentCredentialReference): string;
	resolve(credential: IAgentCredentialReference, token: CancellationToken): Promise<string | undefined>;
}

export interface IAgentCredentialTurnAuthorization {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly credentials: readonly IAgentCredentialReference[];
	readonly grantedPrivileges: readonly IAgentPackagePrivilege[];
}

export interface IAgentCredentialAuthority extends IAgentCredentialResolver {
	bindTurn(authorization: IAgentCredentialTurnAuthorization): IDisposable;
}

interface IAgentCredentialTurnRecord {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly credentials: ReadonlyMap<string, IAgentCredentialReference>;
	readonly cancellation: CancellationTokenSource;
}

function credentialKey(credential: IAgentCredentialReference): string {
	return encodeAgentHostProtocolValue(credential);
}

function turnKey(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): string {
	return `${session}\u0000${chat}\u0000${turn}`;
}

function unauthorized(credential: IAgentCredentialReference): never {
	throw new AgentHostError(
		AgentHostErrorCode.CredentialUnauthorized,
		'Agent credential is not authorized for the addressed Turn',
		{ provider: credential.provider, scope: credential.scope },
	);
}

/** Owns exact Turn-scoped credential authorization and short-lived secret resolution. */
export class AgentCredentialService implements IAgentCredentialAuthority {
	private readonly turns = new Map<string, IAgentCredentialTurnRecord>();

	constructor(private readonly source: IAgentCredentialSecretSource) {}

	bindTurn(authorization: IAgentCredentialTurnAuthorization): IDisposable {
		createAgentPackageId(authorization.packageId);
		createAgentId(authorization.agentId);
		createAgentRuntimeRegistrationRevision(authorization.runtimeRegistration);
		createAgentSessionId(authorization.session);
		createAgentChatId(authorization.chat);
		createAgentTurnId(authorization.turn);
		const key = turnKey(authorization.session, authorization.chat, authorization.turn);
		if (this.turns.has(key)) {
			throw new Error(`Agent credentials are already bound to Turn '${authorization.turn}'`);
		}

		const grantedSecrets = new Set(
			authorization.grantedPrivileges
				.filter(privilege => privilege.kind === 'secret')
				.map(privilege => privilege.value),
		);
		const credentials = new Map<string, IAgentCredentialReference>();
		for (const candidate of authorization.credentials) {
			const credential = validateAndFreezeAgentCredentialReference(candidate);
			const key = credentialKey(credential);
			if (credentials.has(key)) {
				throw new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Agent credential authorization contains a duplicate reference',
					{ field: 'credentials', value: 'duplicate' },
				);
			}
			const requiredPrivilege = this.source.requiredPrivilege(credential);
			if (
				typeof requiredPrivilege !== 'string'
				|| requiredPrivilege.length === 0
				|| requiredPrivilege.length > maximumCredentialMetadataLength
				|| !grantedSecrets.has(requiredPrivilege)
			) {
				unauthorized(credential);
			}
			credentials.set(key, credential);
		}

		const record: IAgentCredentialTurnRecord = Object.freeze({
			packageId: authorization.packageId,
			agentId: authorization.agentId,
			runtimeRegistration: authorization.runtimeRegistration,
			session: authorization.session,
			chat: authorization.chat,
			turn: authorization.turn,
			credentials,
			cancellation: new CancellationTokenSource(),
		});
		this.turns.set(key, record);
		return toDisposable(() => {
			if (this.turns.get(key) === record) {
				this.turns.delete(key);
			}
			record.cancellation.cancel();
			record.cancellation.dispose();
		});
	}

	async resolve(request: IAgentCredentialResolutionRequest, token: CancellationToken): Promise<string> {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		createAgentPackageId(request.packageId);
		createAgentId(request.agentId);
		createAgentRuntimeRegistrationRevision(request.runtimeRegistration);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		createAgentTurnId(request.turn);
		const credential = validateAndFreezeAgentCredentialReference(request.credential);
		const key = turnKey(request.session, request.chat, request.turn);
		const record = this.turns.get(key);
		if (
			record === undefined
			|| record.packageId !== request.packageId
			|| record.agentId !== request.agentId
			|| record.runtimeRegistration !== request.runtimeRegistration
			|| record.session !== request.session
			|| record.chat !== request.chat
			|| record.turn !== request.turn
			|| !record.credentials.has(credentialKey(credential))
		) {
			unauthorized(credential);
		}

		const cancellation = new CancellationTokenSource();
		const requestCancellation = token.onCancellationRequested(() => cancellation.cancel());
		const bindingCancellation = record.cancellation.token.onCancellationRequested(() => cancellation.cancel());
		let value: string | undefined;
		try {
			value = await raceCancellationError(this.source.resolve(credential, cancellation.token), cancellation.token);
		} catch (error) {
			if (
				isCancellationError(error)
				|| token.isCancellationRequested
				|| record.cancellation.token.isCancellationRequested
			) {
				throw new CancellationError();
			}
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnavailable,
				'Agent credential is unavailable',
				{ provider: credential.provider, scope: credential.scope },
			);
		} finally {
			bindingCancellation.dispose();
			requestCancellation.dispose();
			cancellation.dispose();
		}
		if (
			token.isCancellationRequested
			|| record.cancellation.token.isCancellationRequested
			|| this.turns.get(key) !== record
		) {
			throw new CancellationError();
		}
		if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).byteLength > maximumCredentialBytes) {
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnavailable,
				'Agent credential is unavailable',
				{ provider: credential.provider, scope: credential.scope },
			);
		}
		return value;
	}
}
