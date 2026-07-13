/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	AgentHostActionDigest,
	AgentHostChannelId,
	AgentHostChannelRevision,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentHostSequence,
	AgentChatId,
	AgentId,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentSubmissionId,
	AgentTurnId,
} from './identities.js';

export type AgentHostActionCause =
	| {
		readonly kind: 'operation';
		readonly operation: AgentHostOperationId;
		readonly submission?: AgentSubmissionId;
		readonly payloadDigest: AgentHostPayloadDigest;
	}
	| {
		readonly kind: 'runtime';
		readonly registration: AgentRuntimeRegistrationRevision;
		readonly agent: AgentId;
		readonly session?: AgentSessionId;
		readonly chat?: AgentChatId;
		readonly turn?: AgentTurnId;
	}
	| { readonly kind: 'host' };

export interface IAgentHostChannelSnapshot<TKind extends string, TState> {
	readonly channel: AgentHostChannelId;
	readonly kind: TKind;
	readonly hostSequence: AgentHostSequence;
	readonly revision: AgentHostChannelRevision;
	readonly state: TState;
}

export interface IAgentHostChannelAction<TKind extends string, TAction> {
	readonly channel: AgentHostChannelId;
	readonly kind: TKind;
	readonly hostSequence: AgentHostSequence;
	readonly revision: AgentHostChannelRevision;
	readonly digest: AgentHostActionDigest;
	readonly cause: AgentHostActionCause;
	readonly action: TAction;
}

export type AgentHostChannelSnapshotApplication<TState> = {
	readonly kind: 'applied';
	readonly state: TState;
	readonly hostSequence: AgentHostSequence;
	readonly revision: AgentHostChannelRevision;
};

export type AgentHostChannelActionApplication<TState> =
	| {
		readonly kind: 'applied';
		readonly state: TState;
		readonly hostSequence: AgentHostSequence;
		readonly revision: AgentHostChannelRevision;
	}
	| {
		readonly kind: 'duplicate';
		readonly state: TState;
		readonly hostSequence: AgentHostSequence;
		readonly revision: AgentHostChannelRevision;
	}
	| {
		readonly kind: 'snapshotRequired';
		readonly reason: 'missingSnapshot' | 'gap' | 'conflict';
		readonly error: AgentHostError;
	};

interface IAppliedActionIdentity {
	readonly hostSequence: AgentHostSequence;
	readonly revision: AgentHostChannelRevision;
	readonly digest: AgentHostActionDigest;
}

interface ISnapshotRequirement {
	readonly reason: 'missingSnapshot' | 'gap' | 'conflict';
	readonly error: AgentHostError;
}

const maximumRememberedActionIdentities = 4_096;

export class AgentHostChannelStateReducer<TKind extends string, TState, TAction> {
	private currentState: TState | undefined;
	private currentHostSequence: AgentHostSequence | undefined;
	private currentRevision: AgentHostChannelRevision | undefined;
	private snapshotHostSequence: AgentHostSequence | undefined;
	private snapshotRevision: AgentHostChannelRevision | undefined;
	private readonly appliedActions = new Map<number, IAppliedActionIdentity>();
	private readonly appliedActionOrder: number[] = [];
	private snapshotRequirement: ISnapshotRequirement | undefined;

	constructor(
		readonly channel: AgentHostChannelId,
		readonly kind: TKind,
		private readonly reducer: (state: TState, action: TAction) => TState,
	) { }

	get state(): TState | undefined {
		return this.currentState;
	}

	get hostSequence(): AgentHostSequence | undefined {
		return this.currentHostSequence;
	}

	get revision(): AgentHostChannelRevision | undefined {
		return this.currentRevision;
	}

	get requiresFreshSnapshot(): boolean {
		return this.snapshotRequirement !== undefined;
	}

	applySnapshot(snapshot: IAgentHostChannelSnapshot<TKind, TState>): AgentHostChannelSnapshotApplication<TState> {
		this.assertChannel(snapshot.channel, snapshot.kind);

		if (this.currentHostSequence !== undefined && snapshot.hostSequence < this.currentHostSequence) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host channel snapshot precedes applied state',
				{ field: 'hostSequence', value: snapshot.hostSequence },
			);
		}

		if (this.currentRevision !== undefined && snapshot.revision < this.currentRevision) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host channel snapshot revision precedes applied state',
				{ field: 'revision', value: snapshot.revision },
			);
		}

		this.currentState = snapshot.state;
		this.currentHostSequence = snapshot.hostSequence;
		this.currentRevision = snapshot.revision;
		this.snapshotHostSequence = snapshot.hostSequence;
		this.snapshotRevision = snapshot.revision;
		this.appliedActions.clear();
		this.appliedActionOrder.length = 0;
		this.snapshotRequirement = undefined;

		return {
			kind: 'applied',
			state: snapshot.state,
			hostSequence: snapshot.hostSequence,
			revision: snapshot.revision,
		};
	}

	applyAction(envelope: IAgentHostChannelAction<TKind, TAction>): AgentHostChannelActionApplication<TState> {
		if (this.snapshotRequirement !== undefined) {
			return {
				kind: 'snapshotRequired',
				reason: this.snapshotRequirement.reason,
				error: this.snapshotRequirement.error,
			};
		}

		if (this.currentState === undefined || this.currentHostSequence === undefined || this.currentRevision === undefined) {
			this.snapshotRequirement = {
				reason: 'missingSnapshot',
				error: new AgentHostError(
					AgentHostErrorCode.ChannelSnapshotRequired,
					'Agent Host channel requires a fresh snapshot',
					{ channel: this.channel },
				),
			};
			return { kind: 'snapshotRequired', ...this.snapshotRequirement };
		}

		if (envelope.channel !== this.channel || envelope.kind !== this.kind) {
			return this.requireConflictSnapshot(envelope.revision);
		}

		if (
			this.snapshotHostSequence !== undefined
			&& this.snapshotRevision !== undefined
			&& envelope.hostSequence <= this.snapshotHostSequence
			&& envelope.revision <= this.snapshotRevision
		) {
			return {
				kind: 'duplicate',
				state: this.currentState,
				hostSequence: this.currentHostSequence,
				revision: this.currentRevision,
			};
		}

		const expectedRevision = this.currentRevision + 1;
		if (envelope.revision === expectedRevision) {
			if (envelope.hostSequence <= this.currentHostSequence) {
				return this.requireConflictSnapshot(envelope.revision);
			}

			const nextState = this.reducer(this.currentState, envelope.action);
			this.currentState = nextState;
			this.currentHostSequence = envelope.hostSequence;
			this.currentRevision = envelope.revision;
			this.appliedActions.set(envelope.revision, envelope);
			this.appliedActionOrder.push(envelope.revision);
			if (this.appliedActionOrder.length > maximumRememberedActionIdentities) {
				const oldestRevision = this.appliedActionOrder.shift();
				if (oldestRevision !== undefined) {
					this.appliedActions.delete(oldestRevision);
				}
			}

			return {
				kind: 'applied',
				state: nextState,
				hostSequence: envelope.hostSequence,
				revision: envelope.revision,
			};
		}

		if (
			this.appliedActions.get(envelope.revision)?.hostSequence === envelope.hostSequence
			&& this.appliedActions.get(envelope.revision)?.digest === envelope.digest
		) {
			return {
				kind: 'duplicate',
				state: this.currentState,
				hostSequence: this.currentHostSequence,
				revision: this.currentRevision,
			};
		}

		if (envelope.revision > expectedRevision) {
			this.snapshotRequirement = {
				reason: 'gap',
				error: new AgentHostError(
					AgentHostErrorCode.ChannelRevisionGap,
					'Agent Host channel action has a revision gap',
					{
						channel: this.channel,
						expectedRevision,
						receivedRevision: envelope.revision,
					},
				),
			};
			return { kind: 'snapshotRequired', ...this.snapshotRequirement };
		}

		return this.requireConflictSnapshot(envelope.revision);
	}

	private assertChannel(channel: AgentHostChannelId, kind: TKind): void {
		if (channel !== this.channel) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host snapshot addresses another channel',
				{ field: 'channel', value: channel },
			);
		}

		if (kind !== this.kind) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Agent Host snapshot has another channel kind',
				{ field: 'kind', value: kind },
			);
		}
	}

	private requireConflictSnapshot(revision: AgentHostChannelRevision): AgentHostChannelActionApplication<TState> {
		this.snapshotRequirement = {
			reason: 'conflict',
			error: new AgentHostError(
				AgentHostErrorCode.ChannelRevisionConflict,
				'Agent Host channel action conflicts with applied state',
				{ channel: this.channel, revision },
			),
		};
		return { kind: 'snapshotRequired', ...this.snapshotRequirement };
	}
}
