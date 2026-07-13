/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode } from './errors.js';
import { AgentHostOperationId, AgentHostPayloadDigest } from './identities.js';

export interface IAgentHostOperationRequest<TPayload> {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly payload: TPayload;
}

export type AgentHostOperationReconciliation<TResult> =
	| { readonly kind: 'unknown' }
	| { readonly kind: 'pending' }
	| {
		readonly kind: 'committed';
		readonly outcome: TResult;
	};

export type AgentHostOperationStart<TResult> =
	| { readonly kind: 'execute' }
	| { readonly kind: 'pending' }
	| {
		readonly kind: 'committed';
		readonly outcome: TResult;
	};

interface IPendingAgentHostOperation {
	readonly status: 'pending';
	readonly digest: AgentHostPayloadDigest;
}

interface ICommittedAgentHostOperation<TResult> {
	readonly status: 'committed';
	readonly digest: AgentHostPayloadDigest;
	readonly outcome: TResult;
}

type AgentHostOperationRecord<TResult> = IPendingAgentHostOperation | ICommittedAgentHostOperation<TResult>;

export class AgentHostOperationOutcomeRegistry<
	TOperation extends string = AgentHostOperationId,
	TResult = never,
> {
	private readonly records = new Map<TOperation, AgentHostOperationRecord<TResult>>();

	get size(): number {
		return this.records.size;
	}

	begin(operation: TOperation, digest: AgentHostPayloadDigest): AgentHostOperationStart<TResult> {
		const record = this.records.get(operation);
		if (record === undefined) {
			this.records.set(operation, { status: 'pending', digest });
			return { kind: 'execute' };
		}

		this.assertDigest(operation, digest, record.digest);
		if (record.status === 'pending') {
			return { kind: 'pending' };
		}

		return { kind: 'committed', outcome: record.outcome };
	}

	commit(operation: TOperation, digest: AgentHostPayloadDigest, outcome: TResult): TResult {
		const record = this.records.get(operation);
		if (record === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotFound,
				'Agent Host operation has not begun',
				{ operation },
			);
		}

		this.assertDigest(operation, digest, record.digest);
		if (record.status === 'committed') {
			return record.outcome;
		}

		this.records.set(operation, { status: 'committed', digest, outcome });
		return outcome;
	}

	reconcile(operation: TOperation, digest: AgentHostPayloadDigest): AgentHostOperationReconciliation<TResult> {
		const record = this.records.get(operation);
		if (record === undefined) {
			return { kind: 'unknown' };
		}

		this.assertDigest(operation, digest, record.digest);
		if (record.status === 'pending') {
			return { kind: 'pending' };
		}

		return { kind: 'committed', outcome: record.outcome };
	}

	private assertDigest(operation: TOperation, received: AgentHostPayloadDigest, recorded: AgentHostPayloadDigest): void {
		if (received !== recorded) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationDigestConflict,
				'Agent Host operation ID is already bound to another payload',
				{
					operation,
					recordedDigest: recorded,
					receivedDigest: received,
				},
			);
		}
	}
}
