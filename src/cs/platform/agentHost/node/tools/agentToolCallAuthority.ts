/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';
import { assertAgentHostAttachment, type IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	AgentChatId,
	AgentHostAuthorityId,
	AgentId,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentSubmissionId,
	AgentToolSetRevision,
	AgentTurnId,
	createAgentChatId,
	createAgentHostAuthorityId,
	createAgentId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentToolCall, IAgentToolRegistration } from 'cs/platform/agentHost/common/tools';
import type {
	AgentToolCallAuthorization,
	IAgentToolCallAuthorityPort,
} from './agentToolExecution.js';
import type {
	IAgentToolSetResolver,
	IPreparedAgentToolSet,
} from './agentToolSetPreparation.js';

export interface IAgentToolTurnBinding {
	readonly agent: AgentId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly submission: AgentSubmissionId;
	readonly toolSet: AgentToolSetRevision;
	readonly attachments: readonly IAgentHostAttachment[];
}

/** Owns accepted-Turn authorization lifetime for canonical Tool calls. */
export interface IAgentToolTurnAuthorityPort {
	bindTurn(binding: IAgentToolTurnBinding): IDisposable;
}

export interface IAgentToolTurnContext {
	readonly attachments: readonly IAgentHostAttachment[];
}

/** Resolves only the immutable accepted-Turn context addressed by one exact canonical Tool call. */
export interface IAgentToolTurnContextPort {
	resolveTurnContext(call: IAgentToolCall): IAgentToolTurnContext | undefined;
}

/** Resolves the dedicated per-call permission operation after exact Turn authorization. */
export interface IAgentToolPermissionPort {
	authorize(
		call: IAgentToolCall,
		prepared: IPreparedAgentToolSet,
		registration: IAgentToolRegistration,
	): Promise<AgentToolCallAuthorization>;
}

interface IBoundAgentToolTurn {
	readonly binding: Readonly<IAgentToolTurnBinding>;
	readonly prepared: IPreparedAgentToolSet;
}

const inactiveTurnDenial: AgentToolCallAuthorization = Object.freeze({
	kind: 'denied',
	message: 'Tool call does not address an active accepted Turn',
});

function turnKey(session: AgentSessionId, chat: AgentChatId, turn: AgentTurnId): string {
	return `${session}\u0000${chat}\u0000${turn}`;
}

function immutableBinding(binding: IAgentToolTurnBinding): Readonly<IAgentToolTurnBinding> {
	createAgentId(binding.agent);
	createAgentRuntimeRegistrationRevision(binding.runtimeRegistration);
	createAgentSessionId(binding.session);
	createAgentChatId(binding.chat);
	createAgentTurnId(binding.turn);
	createAgentSubmissionId(binding.submission);
	createAgentToolSetRevision(binding.toolSet);
	for (const attachment of binding.attachments) {
		assertAgentHostAttachment(attachment);
	}
	return Object.freeze({
		...binding,
		attachments: Object.freeze([...binding.attachments]),
	});
}

/**
 * Owns the exact accepted-Turn bindings consulted by the Host Tool Execution Port.
 * A prepared Tool set alone never authorizes execution.
 */
export class AgentToolCallAuthority implements IAgentToolCallAuthorityPort, IAgentToolTurnAuthorityPort, IAgentToolTurnContextPort {
	private readonly turns = new Map<string, IBoundAgentToolTurn>();
	private readonly toolSets = new Map<AgentToolSetRevision, IBoundAgentToolTurn>();

	constructor(
		private readonly authority: AgentHostAuthorityId,
		private readonly preparedToolSets: IAgentToolSetResolver,
		private readonly permissions: IAgentToolPermissionPort,
		private readonly maximumBoundTurns: number,
	) {
		createAgentHostAuthorityId(authority);
		if (!Number.isSafeInteger(maximumBoundTurns) || maximumBoundTurns < 1) {
			throw new Error('Tool Turn binding capacity must be a positive integer');
		}
	}

	bindTurn(binding: IAgentToolTurnBinding): IDisposable {
		const frozen = immutableBinding(binding);
		const prepared = this.preparedToolSets.resolve(frozen.toolSet);
		if (
			prepared === undefined
			|| prepared.authority !== this.authority
			|| prepared.submission !== frozen.submission
			|| prepared.agent.id !== frozen.agent
			|| prepared.runtimeRegistration.revision !== frozen.runtimeRegistration
			|| prepared.toolSet.revision !== frozen.toolSet
		) {
			throw new Error('Tool Turn binding does not match one exact prepared Tool set');
		}
		const key = turnKey(frozen.session, frozen.chat, frozen.turn);
		if (this.turns.has(key)) {
			throw new Error(`Tool authority already contains Turn '${frozen.turn}'`);
		}
		if (this.toolSets.has(frozen.toolSet)) {
			throw new Error(`Prepared Tool set '${frozen.toolSet}' is already bound to a Turn`);
		}
		if (this.turns.size >= this.maximumBoundTurns) {
			throw new Error('Tool Turn binding capacity is exhausted');
		}
		const record: IBoundAgentToolTurn = Object.freeze({ binding: frozen, prepared });
		this.turns.set(key, record);
		this.toolSets.set(frozen.toolSet, record);
		return toDisposable(() => {
			if (this.turns.get(key) === record) {
				this.turns.delete(key);
			}
			if (this.toolSets.get(frozen.toolSet) === record) {
				this.toolSets.delete(frozen.toolSet);
			}
		});
	}

	async authorize(
		call: IAgentToolCall,
		prepared: IPreparedAgentToolSet,
		registration: IAgentToolRegistration,
	): Promise<AgentToolCallAuthorization> {
		const key = turnKey(call.session, call.chat, call.turn);
		const record = this.turns.get(key);
		if (!this.matches(record, call, prepared, registration)) {
			return inactiveTurnDenial;
		}
		const result = await this.permissions.authorize(call, prepared, registration);
		if (
			this.turns.get(key) !== record
			|| this.toolSets.get(call.toolSet) !== record
			|| !this.matches(record, call, prepared, registration)
		) {
			return inactiveTurnDenial;
		}
		return result;
	}

	resolveTurnContext(call: IAgentToolCall): IAgentToolTurnContext | undefined {
		const record = this.turns.get(turnKey(call.session, call.chat, call.turn));
		if (record === undefined) {
			return undefined;
		}
		const binding = record.binding;
		if (
			binding.agent !== call.agent
			|| binding.runtimeRegistration !== call.registration
			|| binding.session !== call.session
			|| binding.chat !== call.chat
			|| binding.turn !== call.turn
			|| binding.toolSet !== call.toolSet
		) {
			return undefined;
		}
		return Object.freeze({ attachments: binding.attachments });
	}

	private matches(
		record: IBoundAgentToolTurn | undefined,
		call: IAgentToolCall,
		prepared: IPreparedAgentToolSet,
		registration: IAgentToolRegistration,
	): record is IBoundAgentToolTurn {
		if (record === undefined) {
			return false;
		}
		const binding = record.binding;
		return record.prepared === prepared
			&& binding.agent === call.agent
			&& binding.runtimeRegistration === call.registration
			&& binding.session === call.session
			&& binding.chat === call.chat
			&& binding.turn === call.turn
			&& binding.submission === prepared.submission
			&& binding.toolSet === call.toolSet
			&& prepared.authority === this.authority
			&& prepared.toolSet.revision === call.toolSet
			&& prepared.toolSet.registrations.some(candidate => (
				candidate.id === registration.id
				&& candidate.revision === registration.revision
				&& candidate.descriptor.id === call.tool
				&& candidate.descriptor.revision === call.descriptor
			));
	}
}
