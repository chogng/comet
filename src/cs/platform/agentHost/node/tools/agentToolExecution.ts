/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	AgentToolCallId,
	type AgentHostClientConnectionId,
	createAgentChatId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentInteractionTargetId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolDescriptorRevision,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	AgentToolExecutorReference,
	AgentToolEndpointReconciliation,
	AgentToolResult,
	IAgentToolCall,
	IAgentToolExecutionPort,
	IAgentToolExecutorEndpoint,
	IAgentToolFailure,
	IAgentToolProgress,
	IAgentToolRegistration,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolExecutorReference,
	assertAgentToolProgress,
	assertAgentToolResult,
	computeAgentToolMutationPayloadDigest,
	parseCometToolSchema,
	validateCometToolValue,
} from 'cs/platform/agentHost/common/tools';
import { agentToolExecutorKey } from './agentToolRegistry.js';
import {
	IAgentToolAvailabilityPort,
	IAgentToolSetResolver,
	IPreparedAgentToolSet,
} from './agentToolSetPreparation.js';

const maximumFailureMessageLength = 8_192;

/** Signals that the exact logical executor disconnected or is otherwise unavailable. */
export class AgentToolEndpointUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AgentToolEndpointUnavailableError';
	}
}

/** Publishes endpoint availability without changing the canonical Tool registration catalog. */
export class AgentToolEndpointRegistry implements IAgentToolAvailabilityPort {
	private readonly endpoints = new Map<string, IAgentToolExecutorEndpoint>();
	private readonly clientEndpoints = new Map<AgentHostClientConnectionId, ReadonlySet<string>>();

	publish(reference: AgentToolExecutorReference, endpoint: IAgentToolExecutorEndpoint): IDisposable {
		assertAgentToolExecutorReference(reference);
		if (typeof endpoint.execute !== 'function'
			|| typeof endpoint.cancel !== 'function'
			|| typeof endpoint.reconcile !== 'function') {
			throw new Error('Invalid Tool executor endpoint');
		}
		const key = agentToolExecutorKey(reference);
		if (this.endpoints.has(key)) {
			throw new Error(`Duplicate Tool executor endpoint '${key}'`);
		}
		this.endpoints.set(key, endpoint);
		let published = true;
		return toDisposable(() => {
			if (!published) {
				return;
			}
			published = false;
			this.endpoints.delete(key);
		});
	}

	isAvailable(reference: AgentToolExecutorReference): boolean {
		return this.endpoints.has(agentToolExecutorKey(reference));
	}

	resolve(reference: AgentToolExecutorReference): IAgentToolExecutorEndpoint | undefined {
		return this.endpoints.get(agentToolExecutorKey(reference));
	}

	assertClientReplacement(
		connection: AgentHostClientConnectionId,
		references: readonly AgentToolExecutorReference[],
		endpoint: IAgentToolExecutorEndpoint,
	): void {
		if (typeof endpoint.execute !== 'function'
			|| typeof endpoint.cancel !== 'function'
			|| typeof endpoint.reconcile !== 'function') {
			throw new Error('Invalid client Tool executor endpoint');
		}
		const currentKeys = this.clientEndpoints.get(connection);
		const keys = new Set<string>();
		for (const reference of references) {
			assertAgentToolExecutorReference(reference);
			if (reference.kind !== 'client' || reference.connection !== connection) {
				throw new Error(`Tool endpoint does not belong to client '${connection}'`);
			}
			const key = agentToolExecutorKey(reference);
			if (keys.has(key)) {
				throw new Error(`Duplicate Tool executor endpoint '${key}'`);
			}
			if (this.endpoints.has(key) && !currentKeys?.has(key)) {
				throw new Error(`Duplicate Tool executor endpoint '${key}'`);
			}
			keys.add(key);
		}
	}

	replaceClient(
		connection: AgentHostClientConnectionId,
		references: readonly AgentToolExecutorReference[],
		endpoint: IAgentToolExecutorEndpoint,
	): void {
		this.assertClientReplacement(connection, references, endpoint);
		const currentKeys = this.clientEndpoints.get(connection);
		if (currentKeys !== undefined) {
			for (const key of currentKeys) {
				this.endpoints.delete(key);
			}
		}
		const keys = new Set<string>();
		for (const reference of references) {
			const key = agentToolExecutorKey(reference);
			this.endpoints.set(key, endpoint);
			keys.add(key);
		}
		if (keys.size === 0) {
			this.clientEndpoints.delete(connection);
		} else {
			this.clientEndpoints.set(connection, keys);
		}
	}

	removeClient(connection: AgentHostClientConnectionId): void {
		const keys = this.clientEndpoints.get(connection);
		if (keys === undefined) {
			return;
		}
		for (const key of keys) {
			this.endpoints.delete(key);
		}
		this.clientEndpoints.delete(connection);
	}
}

export type AgentToolCallAuthorization =
	| { readonly kind: 'authorized' }
	| {
		readonly kind: 'denied';
		readonly message: string;
		readonly data?: AgentHostProtocolValue;
	};

/** Verifies the exact active Turn and its current per-call permission state. */
export interface IAgentToolCallAuthorityPort {
	authorize(
		call: IAgentToolCall,
		prepared: IPreparedAgentToolSet,
		registration: IAgentToolRegistration,
	): Promise<AgentToolCallAuthorization>;
}

export interface IAgentToolTimerPort {
	schedule(delayMilliseconds: number, callback: () => void): IDisposable;
}

export interface IAgentToolExecutionOptions {
	readonly toolSets: IAgentToolSetResolver;
	readonly endpoints: AgentToolEndpointRegistry;
	readonly authority: IAgentToolCallAuthorityPort;
	readonly timers: IAgentToolTimerPort;
	readonly now: () => number;
	readonly reportUnexpectedError: (error: unknown) => void;
	readonly maximumCallRecords: number;
}

interface IValidatedAgentToolCall {
	readonly call: IAgentToolCall;
	readonly prepared: IPreparedAgentToolSet;
	readonly registration: IAgentToolRegistration;
	readonly endpoint: IAgentToolExecutorEndpoint;
	readonly target: IAgentHostInteractionTarget | undefined;
}

type AgentToolInterruption = 'cancelled' | 'timedOut';

interface IActiveAgentToolCall {
	readonly call: IAgentToolCall;
	readonly registration: IAgentToolRegistration;
	readonly endpoint: IAgentToolExecutorEndpoint;
	readonly cancellation: CancellationTokenSource;
	readonly timer: IDisposable;
	readonly interruption: Promise<AgentToolInterruption>;
	interrupt(kind: AgentToolInterruption): boolean;
	interruptionKind?: AgentToolInterruption;
	invocationStarted: boolean;
	terminal: boolean;
	lastProgressSequence: number;
	progressBytes: number;
	progressFailure?: Error;
}

interface IAgentToolCallRecord {
	readonly canonicalCall: string;
	readonly operation?: string;
	readonly payloadDigest?: string;
	promise?: Promise<AgentToolResult>;
	result?: AgentToolResult;
	active?: IActiveAgentToolCall;
	cancelRequested: boolean;
}

interface IAgentToolOperationRecord {
	readonly call: AgentToolCallId;
	readonly payloadDigest: string;
	readonly canonicalCall: string;
}

class AgentToolUnavailableError extends Error {}

function assertExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Expected an exact canonical object');
	}
	const allowed = new Set([...required, ...optional]);
	const keys = Object.keys(value);
	if (keys.some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(value, key))) {
		throw new Error('Canonical object fields are not exact');
	}
}

function assertAuthorizationShape(authorization: AgentToolCallAuthorization): void {
	if (authorization.kind === 'authorized') {
		assertExactKeys(authorization, ['kind']);
	} else if (authorization.kind === 'denied') {
		assertExactKeys(authorization, ['kind', 'message'], ['data']);
	} else {
		throw new Error('Unknown Tool authorization result');
	}
}

function protocolBytes(value: AgentHostProtocolValue): number {
	return new TextEncoder().encode(encodeAgentHostProtocolValue(value)).byteLength;
}

function immutableProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(immutableProtocolValue));
	}
	const result: Record<string, AgentHostProtocolValue> = {};
	for (const [key, item] of Object.entries(value)) {
		Object.defineProperty(result, key, {
			value: immutableProtocolValue(item),
			enumerable: true,
			configurable: false,
			writable: false,
		});
	}
	return Object.freeze(result);
}

function terminalFailure(
	call: AgentToolCallId,
	status: 'denied' | 'cancelled' | 'timedOut' | 'failed',
	code: IAgentToolFailure['code'],
	message: string,
	reconciliation: 'terminal' | 'sameOperationRequired',
	data?: AgentHostProtocolValue,
): AgentToolResult {
	return Object.freeze({
		call,
		status,
		failure: Object.freeze({
			code,
			message,
			reconciliation,
			...(data === undefined ? {} : { data }),
		}),
	});
}

function mutationReconciliation(call: IAgentToolCall): 'terminal' | 'sameOperationRequired' {
	return call.effect !== null
		&& typeof call.effect === 'object'
		&& call.effect.kind === 'mutation'
		? 'sameOperationRequired'
		: 'terminal';
}

/** Canonical Host-owned Tool call state machine and the only executor routing boundary. */
export class AgentToolExecutionService implements IAgentToolExecutionPort {
	private readonly calls = new Map<AgentToolCallId, IAgentToolCallRecord>();
	private readonly operations = new Map<string, IAgentToolOperationRecord>();
	private readonly concurrency = new Map<string, number>();

	constructor(private readonly options: IAgentToolExecutionOptions) {
		if (!Number.isSafeInteger(options.maximumCallRecords) || options.maximumCallRecords < 1) {
			throw new Error('Tool call record capacity must be a positive integer');
		}
	}

	execute(call: IAgentToolCall, reportProgress: (progress: IAgentToolProgress) => void): Promise<AgentToolResult> {
		let canonicalCall: string;
		try {
			assertAgentToolCall(call);
			canonicalCall = encodeAgentHostProtocolValue(call);
		} catch {
			return Promise.resolve(terminalFailure(
				call.id,
				'failed',
				'invalidInput',
				'Invalid canonical Tool call',
				'terminal',
			));
		}

		const existing = this.calls.get(call.id);
		if (existing !== undefined) {
			if (existing.canonicalCall !== canonicalCall || existing.promise === undefined) {
				return Promise.resolve(terminalFailure(
					call.id,
					'failed',
					'invalidInput',
					`Tool call identity '${call.id}' is already bound to different content`,
					mutationReconciliation(call),
				));
			}
			return existing.promise;
		}

		if (this.calls.size >= this.options.maximumCallRecords) {
			return Promise.resolve(terminalFailure(
				call.id,
				'failed',
				'unavailable',
				'Tool call record capacity is exhausted',
				'terminal',
			));
		}

		let operation: string | undefined;
		let payloadDigest: string | undefined;
		if (call.effect.kind === 'mutation') {
			operation = call.effect.operation;
			payloadDigest = call.effect.payloadDigest;
			const recorded = this.operations.get(operation);
			if (recorded !== undefined && (
				recorded.call !== call.id
				|| recorded.payloadDigest !== payloadDigest
				|| recorded.canonicalCall !== canonicalCall
			)) {
				return Promise.resolve(terminalFailure(
					call.id,
					'failed',
					'invalidInput',
					`Mutation operation '${operation}' is already bound to another exact Tool call`,
					'sameOperationRequired',
				));
			}
		}

		const record: IAgentToolCallRecord = {
			canonicalCall,
			...(operation === undefined ? {} : { operation }),
			...(payloadDigest === undefined ? {} : { payloadDigest }),
			cancelRequested: false,
		};
		this.calls.set(call.id, record);
		if (operation !== undefined && payloadDigest !== undefined) {
			this.operations.set(operation, { call: call.id, payloadDigest, canonicalCall });
		}
		record.promise = this.run(record, call, reportProgress).then(result => {
			record.result = result;
			return result;
		});
		return record.promise;
	}

	async cancel(call: AgentToolCallId): Promise<void> {
		createAgentToolCallId(call);
		const record = this.calls.get(call);
		if (record === undefined) {
			return;
		}
		record.cancelRequested = true;
		const active = record.active;
		if (active === undefined || active.terminal) {
			return;
		}
		if (!active.interrupt('cancelled')) {
			return;
		}
		active.cancellation.cancel();
		if (!active.invocationStarted) {
			return;
		}
		try {
			await active.endpoint.cancel(active.call);
		} catch (error) {
			this.options.reportUnexpectedError(error);
		}
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		assertAgentToolCall(call);
		const record = this.calls.get(call.id);
		if (record === undefined) {
			return Object.freeze({ kind: 'unknown' });
		}
		if (record.canonicalCall !== encodeAgentHostProtocolValue(call)) {
			throw new Error(`Tool call identity '${call.id}' is bound to different canonical content`);
		}
		if (record.result !== undefined) {
			return Object.freeze({ kind: 'terminal', result: record.result });
		}
		return Object.freeze({ kind: 'pending' });
	}

	/** Releases terminal reconciliation state when its owning Turn is durably retired. */
	release(call: AgentToolCallId): void {
		const record = this.calls.get(call);
		if (record === undefined) {
			return;
		}
		if (record.active !== undefined && !record.active.terminal) {
			throw new Error(`Cannot release active Tool call '${call}'`);
		}
		this.calls.delete(call);
		if (record.operation !== undefined) {
			this.operations.delete(record.operation);
		}
	}

	private async run(
		record: IAgentToolCallRecord,
		call: IAgentToolCall,
		reportProgress: (progress: IAgentToolProgress) => void,
	): Promise<AgentToolResult> {
		let validated: IValidatedAgentToolCall;
		try {
			validated = await this.validateCall(call);
		} catch (error) {
			if (error instanceof AgentToolUnavailableError) {
				return terminalFailure(
					call.id,
					'failed',
					'unavailable',
					error.message,
					'terminal',
				);
			}
			return terminalFailure(
				call.id,
				'failed',
				'invalidInput',
				'Canonical Tool call validation failed',
				'terminal',
			);
		}
		if (record.cancelRequested) {
			return terminalFailure(call.id, 'cancelled', 'cancelled', 'Tool call was cancelled', 'terminal');
		}

		const descriptor = validated.registration.descriptor;
		const now = this.options.now();
		if (!Number.isSafeInteger(now) || call.deadline <= now) {
			return terminalFailure(call.id, 'timedOut', 'timedOut', 'Tool call deadline has elapsed', 'terminal');
		}
		const timeoutDeadline = Math.min(call.deadline, now + descriptor.limits.timeoutMilliseconds);
		let interrupt!: (kind: AgentToolInterruption) => void;
		const interruption = new Promise<AgentToolInterruption>(resolve => { interrupt = resolve; });
		const cancellation = new CancellationTokenSource();
		const active: IActiveAgentToolCall = {
			call: validated.call,
			registration: validated.registration,
			endpoint: validated.endpoint,
			cancellation,
			timer: this.options.timers.schedule(timeoutDeadline - now, () => {
				if (!active.interrupt('timedOut')) {
					return;
				}
				active.cancellation.cancel();
				if (active.invocationStarted) {
					void Promise.resolve()
						.then(() => active.endpoint.cancel(active.call))
						.catch(this.options.reportUnexpectedError);
				}
			}),
			interruption,
			interrupt(kind: AgentToolInterruption): boolean {
				if (this.terminal || this.interruptionKind !== undefined) {
					return false;
				}
				this.interruptionKind = kind;
				interrupt(kind);
				return true;
			},
			invocationStarted: false,
			terminal: false,
			lastProgressSequence: 0,
			progressBytes: 0,
		};
		record.active = active;

		let concurrencyHeld = false;
		try {
			if (record.cancelRequested) {
				active.interrupt('cancelled');
			}
			const authorization = await Promise.race([
				this.options.authority.authorize(validated.call, validated.prepared, validated.registration)
					.then(result => {
						assertAuthorizationShape(result);
						return { kind: 'authorization' as const, result };
					}),
				active.interruption.then(kind => ({ kind: 'interruption' as const, result: kind })),
			]);
			if (authorization.kind === 'interruption') {
				return this.interruptedResult(call, authorization.result, false);
			}
			if (authorization.result.kind === 'denied') {
				return this.deniedResult(validated.call, descriptor.limits.maximumContentBytes, authorization.result);
			}
			if (active.interruptionKind !== undefined) {
				return this.interruptedResult(call, active.interruptionKind, false);
			}

			const concurrencyKey = `${validated.registration.id}\u0000${validated.registration.revision}`;
			const count = this.concurrency.get(concurrencyKey) ?? 0;
			if (count >= descriptor.limits.maximumConcurrency) {
				return terminalFailure(
					call.id,
					'failed',
					'unavailable',
					`Tool '${call.tool}' concurrency limit is exhausted`,
					'terminal',
				);
			}
			this.concurrency.set(concurrencyKey, count + 1);
			concurrencyHeld = true;
			active.invocationStarted = true;

			const invocation = Promise.resolve()
				.then(() => validated.endpoint.execute(
					validated.call,
					validated.target,
					progress => this.acceptProgress(active, progress, reportProgress),
					cancellation.token,
				))
				.then(
					result => ({ kind: 'result' as const, result }),
					error => ({ kind: 'error' as const, error }),
				);
			const outcome = await Promise.race([
				invocation,
				active.interruption.then(kind => ({ kind: 'interruption' as const, result: kind })),
			]);
			if (outcome.kind === 'interruption') {
				return this.interruptedResult(call, outcome.result, true);
			}
			if (outcome.kind === 'error') {
				return this.reconcileExecutionFailure(validated, outcome.error);
			}
			if (active.progressFailure !== undefined) {
				return terminalFailure(
					call.id,
					'failed',
					'failed',
					active.progressFailure.message,
					mutationReconciliation(call),
				);
			}
			try {
				return this.validateResult(validated.call, validated.registration, outcome.result);
			} catch {
				return terminalFailure(
					call.id,
					'failed',
					'invalidOutput',
					'Tool executor returned an invalid canonical result',
					mutationReconciliation(call),
				);
			}
		} catch {
			return terminalFailure(
				call.id,
				'failed',
				'failed',
				'Tool execution failed',
				active.invocationStarted ? mutationReconciliation(call) : 'terminal',
			);
		} finally {
			active.terminal = true;
			active.timer.dispose();
			active.cancellation.dispose();
			if (concurrencyHeld) {
				const concurrencyKey = `${validated.registration.id}\u0000${validated.registration.revision}`;
				const count = this.concurrency.get(concurrencyKey);
				if (count === 1) {
					this.concurrency.delete(concurrencyKey);
				} else if (count !== undefined) {
					this.concurrency.set(concurrencyKey, count - 1);
				}
			}
		}
	}

	private async validateCall(call: IAgentToolCall): Promise<IValidatedAgentToolCall> {
		createAgentToolCallId(call.id);
		createAgentId(call.agent);
		createAgentRuntimeRegistrationRevision(call.registration);
		createAgentSessionId(call.session);
		createAgentChatId(call.chat);
		createAgentTurnId(call.turn);
		createAgentToolSetRevision(call.toolSet);
		createAgentToolId(call.tool);
		createAgentToolDescriptorRevision(call.descriptor);
		createAgentToolRegistrationId(call.registrationId);
		createAgentToolRegistrationRevision(call.registrationRevision);
		if (!Number.isSafeInteger(call.deadline) || call.deadline <= 0) {
			throw new Error('Invalid Tool deadline');
		}
		const prepared = this.options.toolSets.resolve(call.toolSet);
		if (prepared === undefined
			|| prepared.agent.id !== call.agent
			|| prepared.runtimeRegistration.revision !== call.registration
			|| prepared.toolSet.runtimeRegistration !== call.registration
			|| prepared.toolSet.agentDescriptor !== prepared.agent.revision
			|| prepared.toolSet.modelDescriptor !== prepared.model.revision) {
			throw new Error('Tool call does not address one exact prepared Tool set');
		}
		const matches = prepared.toolSet.registrations.filter(candidate => candidate.id === call.registrationId);
		if (matches.length !== 1) {
			throw new Error('Tool registration does not resolve exactly');
		}
		const registration = matches[0];
		if (registration.revision !== call.registrationRevision
			|| registration.descriptor.id !== call.tool
			|| registration.descriptor.revision !== call.descriptor
			|| registration.descriptor.inputSchema.profile !== prepared.toolSet.schemaProfile
			|| registration.descriptor.outputSchema.profile !== prepared.toolSet.schemaProfile) {
			throw new Error('Tool call descriptor binding is not exact');
		}
		const input = validateCometToolValue(parseCometToolSchema(registration.descriptor.inputSchema), call.input, 'call.input');
		if (protocolBytes(input) > registration.descriptor.limits.maximumInputBytes) {
			throw new Error('Tool input exceeds its byte limit');
		}
		const target = this.validateTarget(call, prepared, registration);
		if (registration.descriptor.safety === 'read') {
			if (call.effect.kind !== 'read') {
				throw new Error('Read Tool call declares a mutating effect');
			}
		} else {
			if (call.effect.kind !== 'mutation') {
				throw new Error('Mutating Tool call has no operation identity');
			}
			createAgentHostOperationId(call.effect.operation);
			createAgentHostPayloadDigest(call.effect.payloadDigest);
			const expectedDigest = await computeAgentToolMutationPayloadDigest({
				...call,
				input,
				...(target === undefined ? {} : { target: target.id }),
				effect: { kind: 'mutation', operation: call.effect.operation },
			});
			if (expectedDigest !== call.effect.payloadDigest) {
				throw new Error('Tool mutation payload digest does not match the exact call');
			}
		}
		const canonicalCall: IAgentToolCall = Object.freeze({
			...call,
			input,
			...(target === undefined ? {} : { target: target.id }),
			effect: Object.freeze({ ...call.effect }),
		});
		const endpoint = this.options.endpoints.resolve(registration.executor);
		if (endpoint === undefined) {
			throw new AgentToolUnavailableError(`Tool executor '${agentToolExecutorKey(registration.executor)}' is unavailable`);
		}
		return { call: canonicalCall, prepared, registration, endpoint, target };
	}

	private validateTarget(
		call: IAgentToolCall,
		prepared: IPreparedAgentToolSet,
		registration: IAgentToolRegistration,
	): IAgentHostInteractionTarget | undefined {
		const targetTypes = registration.descriptor.targetTypes;
		if (targetTypes.length === 0) {
			if (call.target !== undefined) {
				throw new Error('Target-free Tool call unexpectedly names a target');
			}
			return undefined;
		}
		if (call.target === undefined) {
			throw new Error('Targeted Tool call is missing its exact target');
		}
		createAgentInteractionTargetId(call.target);
		const matches = prepared.targets.filter(target => target.id === call.target);
		if (matches.length !== 1) {
			throw new Error('Tool call target does not resolve exactly');
		}
		const target = matches[0];
		assertAgentHostInteractionTarget(target);
		if (!targetTypes.includes(target.type)
			|| (target.expiresAt !== undefined && target.expiresAt <= this.options.now())) {
			throw new Error('Tool call target is unavailable or incompatible');
		}
		return target;
	}

	private acceptProgress(
		active: IActiveAgentToolCall,
		progress: IAgentToolProgress,
		reportProgress: (progress: IAgentToolProgress) => void,
	): void {
		if (active.terminal) {
			return;
		}
		try {
			assertAgentToolProgress(progress);
			if (progress.call !== active.call.id
				|| !Number.isSafeInteger(progress.sequence)
				|| progress.sequence !== active.lastProgressSequence + 1) {
				throw new Error('Tool progress identity or sequence is not exact');
			}
			const data = immutableProtocolValue(progress.data);
			const bytes = protocolBytes(data);
			if (active.progressBytes + bytes > active.registration.descriptor.limits.maximumContentBytes) {
				throw new Error('Tool progress exceeds its cumulative content byte limit');
			}
			active.lastProgressSequence = progress.sequence;
			active.progressBytes += bytes;
			try {
				reportProgress(Object.freeze({ call: progress.call, sequence: progress.sequence, data }));
			} catch (error) {
				this.options.reportUnexpectedError(error);
			}
		} catch (error) {
			const failure = error instanceof Error ? error : new Error('Invalid Tool progress');
			active.progressFailure = failure;
			throw failure;
		}
	}

	private validateResult(
		call: IAgentToolCall,
		registration: IAgentToolRegistration,
		result: AgentToolResult,
	): AgentToolResult {
		assertAgentToolResult(result);
		if (result.status === 'completed') {
			assertExactKeys(result, ['call', 'status', 'output']);
		} else if (['denied', 'cancelled', 'timedOut', 'failed'].includes(result.status)) {
			assertExactKeys(result, ['call', 'status', 'failure']);
			assertExactKeys(result.failure, ['code', 'message', 'reconciliation'], ['data']);
		} else {
			throw new Error('Unknown canonical Tool result status');
		}
		assertAgentHostProtocolValue(result as unknown);
		if (result.call !== call.id) {
			throw new Error('Tool result call identity does not match');
		}
		if (result.status === 'completed') {
			const output = validateCometToolValue(parseCometToolSchema(registration.descriptor.outputSchema), result.output, 'result.output');
			if (protocolBytes(output) > registration.descriptor.limits.maximumOutputBytes) {
				throw new Error('Tool output exceeds its byte limit');
			}
			return Object.freeze({ call: call.id, status: 'completed', output });
		}
		const expectedCode = result.status === 'denied'
			? 'denied'
			: result.status === 'cancelled'
				? 'cancelled'
				: result.status === 'timedOut'
					? 'timedOut'
					: undefined;
		if ((expectedCode !== undefined && result.failure.code !== expectedCode)
			|| (expectedCode === undefined && ['denied', 'cancelled', 'timedOut'].includes(result.failure.code))
			|| !['denied', 'cancelled', 'timedOut', 'unavailable', 'invalidInput', 'invalidOutput', 'failed'].includes(result.failure.code)
			|| result.failure.message.length === 0
			|| result.failure.message.length > maximumFailureMessageLength
			|| !['terminal', 'sameOperationRequired'].includes(result.failure.reconciliation)
			|| (call.effect.kind === 'read' && result.failure.reconciliation !== 'terminal')) {
			throw new Error('Invalid canonical Tool failure');
		}
		let data: AgentHostProtocolValue | undefined;
		if (result.failure.data !== undefined) {
			assertAgentHostProtocolValue(result.failure.data);
			if (protocolBytes(result.failure.data) > registration.descriptor.limits.maximumContentBytes) {
				throw new Error('Tool failure data exceeds its byte limit');
			}
			data = immutableProtocolValue(result.failure.data);
		}
		return terminalFailure(
			call.id,
			result.status,
			result.failure.code,
			result.failure.message,
			result.failure.reconciliation,
			data,
		);
	}

	private deniedResult(
		call: IAgentToolCall,
		maximumContentBytes: number,
		denial: Extract<AgentToolCallAuthorization, { kind: 'denied' }>,
	): AgentToolResult {
		if (denial.message.length === 0 || denial.message.length > maximumFailureMessageLength) {
			throw new Error('Invalid Tool authorization denial');
		}
		if (denial.data !== undefined) {
			assertAgentHostProtocolValue(denial.data);
			if (protocolBytes(denial.data) > maximumContentBytes) {
				throw new Error('Tool authorization denial data exceeds its byte limit');
			}
		}
		return terminalFailure(
			call.id,
			'denied',
			'denied',
			denial.message,
			'terminal',
			denial.data === undefined ? undefined : immutableProtocolValue(denial.data),
		);
	}

	private interruptedResult(
		call: IAgentToolCall,
		interruption: AgentToolInterruption,
		invocationStarted: boolean,
	): AgentToolResult {
		const reconciliation = invocationStarted ? mutationReconciliation(call) : 'terminal';
		return interruption === 'cancelled'
			? terminalFailure(call.id, 'cancelled', 'cancelled', 'Tool call was cancelled', reconciliation)
			: terminalFailure(call.id, 'timedOut', 'timedOut', 'Tool call timed out', reconciliation);
	}

	private async reconcileExecutionFailure(validated: IValidatedAgentToolCall, error: unknown): Promise<AgentToolResult> {
		if (validated.call.effect.kind !== 'mutation') {
			return error instanceof AgentToolEndpointUnavailableError
				? terminalFailure(validated.call.id, 'failed', 'unavailable', error.message, 'terminal')
				: terminalFailure(validated.call.id, 'failed', 'failed', 'Tool executor failed', 'terminal');
		}
		const endpoint = this.options.endpoints.resolve(validated.registration.executor);
		if (endpoint === undefined) {
			return terminalFailure(
				validated.call.id,
				'failed',
				'unavailable',
				'Tool executor disconnected before mutation reconciliation',
				'sameOperationRequired',
			);
		}
		try {
			const reconciliation = await endpoint.reconcile(validated.call);
			assertAgentToolEndpointReconciliation(reconciliation);
			if (reconciliation.kind !== 'terminal') {
				return terminalFailure(
					validated.call.id,
					'failed',
					'unavailable',
					'Mutation outcome remains uncertain for the same operation',
					'sameOperationRequired',
				);
			}
			return this.validateResult(validated.call, validated.registration, reconciliation.result);
		} catch {
			return terminalFailure(
				validated.call.id,
				'failed',
				'unavailable',
				'Mutation reconciliation is unavailable for the same operation',
				'sameOperationRequired',
			);
		}
	}
}
