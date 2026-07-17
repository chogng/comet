/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, CancellationTokenSource } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import { ClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import {
	type IAgentConfigurationCandidate,
	type IAgentConfigurationState,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	AgentHostError,
	AgentHostErrorCode,
	type IAgentHostErrorDataByCode,
} from 'cs/platform/agentHost/common/errors';
import {
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostProtocolVersion,
	createAgentId,
	createAgentRuntimeRegistrationRevision,
	type AgentHostAuthorityId,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostReconnectResult,
	assertAgentHostOperationProgress,
	assertAgentHostSetSubscriptionsResult,
	type AgentHostChannelAction,
	type AgentHostMutationOutcome,
	type AgentHostPrepareSubmissionResult,
	type AgentHostReconnectResult,
	type IAgentHostInitializeRequest,
	type IAgentHostInitializeResult,
	type IAgentHostMutationRequest,
	type IAgentHostOperationProgress,
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostReconnectRequest,
	type IAgentHostResolveSessionConfigurationRequest,
	type IAgentHostResolveSessionConfigurationResult,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
	type IAgentHostSessionConfigurationCompletionsRequest,
	type IAgentHostSessionConfigurationCompletionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentPackageOperationOutcome,
	assertAgentPackageOperationOutcomeRequest,
	assertAgentPackageOperationRequest,
	type AgentPackageOperationOutcome,
	type IAgentPackageOperationOutcomeRequest,
	type IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentClientToolPublicationSnapshot } from 'cs/platform/agentHost/common/tools';

const localAgentHostErrorCode = 'AGENT_HOST_ERROR';
const localAgentHostCancellationErrorCode = 'AGENT_HOST_CANCELLED';
const localAgentHostProtocolVersion = createAgentHostProtocolVersion('5');

type ErrorRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): ErrorRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as ErrorRecord
		: undefined;
}

function invalidProtocol(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid local Agent Host connection value',
		{ field, value: diagnostic },
	);
}

function requireRecord(value: unknown, field: string): ErrorRecord {
	assertAgentHostProtocolValue(value);
	return asRecord(value) ?? invalidProtocol(field, value);
}

function requireExactKeys(
	record: ErrorRecord,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidProtocol(`${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidProtocol(`${field}.${key}`, 'missing');
		}
	}
}

function requireString(value: unknown, field: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		return invalidProtocol(field, value);
	}
	return value;
}

function validateConfigurationCandidateShape(value: unknown, field: string): IAgentConfigurationCandidate {
	const candidate = requireRecord(value, field);
	requireExactKeys(candidate, ['schema', 'values'], [], field);
	const schema = createAgentConfigurationSchemaRevision(requireString(candidate.schema, `${field}.schema`));
	const values = requireRecord(candidate.values, `${field}.values`) as Readonly<Record<string, AgentHostProtocolValue>>;
	return Object.freeze({ schema, values: Object.freeze({ ...values }) });
}

function validateSessionConfigurationState(
	value: unknown,
	field: string,
	agent?: ReturnType<typeof createAgentId>,
): IAgentConfigurationState {
	const state = requireRecord(value, field);
	const schema = validateAndFreezeAgentConfigurationSchema(state.schema);
	return validateAndFreezeAgentConfigurationState(value as IAgentConfigurationState, {
		agent: agent ?? schema.agent,
		scope: 'session',
	});
}

function validateResolveRequest(
	request: IAgentHostResolveSessionConfigurationRequest,
): IAgentHostResolveSessionConfigurationRequest {
	const record = requireRecord(request, 'resolveSessionConfiguration');
	requireExactKeys(record, ['sessionType', 'candidate'], ['workspace'], 'resolveSessionConfiguration');
	validateConfigurationCandidateShape(record.candidate, 'resolveSessionConfiguration.candidate');
	return request;
}

function validateResolveResult(value: unknown): IAgentHostResolveSessionConfigurationResult {
	const result = requireRecord(value, 'resolveSessionConfiguration.result');
	requireExactKeys(
		result,
		['agent', 'runtimeRegistration', 'configuration'],
		[],
		'resolveSessionConfiguration.result',
	);
	const agent = createAgentId(requireString(result.agent, 'resolveSessionConfiguration.result.agent'));
	const runtimeRegistration = createAgentRuntimeRegistrationRevision(requireString(
		result.runtimeRegistration,
		'resolveSessionConfiguration.result.runtimeRegistration',
	));
	const configuration = validateSessionConfigurationState(
		result.configuration,
		'resolveSessionConfiguration.result.configuration',
		agent,
	);
	return Object.freeze({ agent, runtimeRegistration, configuration });
}

function validateCompletionRequest(
	request: IAgentHostSessionConfigurationCompletionsRequest,
): IAgentHostSessionConfigurationCompletionsRequest {
	const record = requireRecord(request, 'completeSessionConfiguration');
	requireExactKeys(record, [
		'sessionType',
		'candidate',
		'resolvedSchema',
		'property',
		'query',
		'limit',
	], ['workspace'], 'completeSessionConfiguration');
	const schema = validateAndFreezeAgentConfigurationSchema(record.resolvedSchema);
	if (schema.scope !== 'session') {
		invalidProtocol('completeSessionConfiguration.resolvedSchema.scope', schema.scope);
	}
	validateAndFreezeAgentConfigurationCandidate(
		schema,
		validateConfigurationCandidateShape(record.candidate, 'completeSessionConfiguration.candidate'),
		'session',
	);
	createAgentConfigurationPropertyId(requireString(record.property, 'completeSessionConfiguration.property'));
	const query = requireString(record.query, 'completeSessionConfiguration.query', true);
	if (query.length > 4_096) {
		invalidProtocol('completeSessionConfiguration.query', query.length);
	}
	if (typeof record.limit !== 'number' || !Number.isSafeInteger(record.limit) || record.limit < 1 || record.limit > 100) {
		invalidProtocol('completeSessionConfiguration.limit', record.limit);
	}
	return request;
}

function validateCompletionResult(
	request: IAgentHostSessionConfigurationCompletionsRequest,
	value: unknown,
): IAgentHostSessionConfigurationCompletionsResult {
	const result = requireRecord(value, 'completeSessionConfiguration.result');
	requireExactKeys(
		result,
		['agent', 'runtimeRegistration', 'schema', 'completions'],
		[],
		'completeSessionConfiguration.result',
	);
	const agent = createAgentId(requireString(result.agent, 'completeSessionConfiguration.result.agent'));
	if (agent !== request.resolvedSchema.agent) {
		invalidProtocol('completeSessionConfiguration.result.agent', agent);
	}
	const runtimeRegistration = createAgentRuntimeRegistrationRevision(requireString(
		result.runtimeRegistration,
		'completeSessionConfiguration.result.runtimeRegistration',
	));
	const schema = createAgentConfigurationSchemaRevision(requireString(
		result.schema,
		'completeSessionConfiguration.result.schema',
	));
	if (schema !== request.resolvedSchema.revision) {
		invalidProtocol('completeSessionConfiguration.result.schema', schema);
	}
	if (!Array.isArray(result.completions)) {
		invalidProtocol('completeSessionConfiguration.result.completions', result.completions);
	}
	const completions = validateAndFreezeAgentConfigurationCompletions(
		request.resolvedSchema,
		request.property,
		result.completions,
	);
	return Object.freeze({ agent, runtimeRegistration, schema, completions });
}

function validatePrepareResult(value: unknown): AgentHostPrepareSubmissionResult {
	const result = requireRecord(value, 'prepareSubmission.result');
	const kind = requireString(result.kind, 'prepareSubmission.result.kind');
	if (kind === 'rejected') {
		requireExactKeys(result, ['kind', 'failure'], [], 'prepareSubmission.result');
		const failure = requireRecord(result.failure, 'prepareSubmission.result.failure');
		requireExactKeys(
			failure,
			['code', 'message', 'reconciliation'],
			['data'],
			'prepareSubmission.result.failure',
		);
		requireString(failure.code, 'prepareSubmission.result.failure.code');
		requireString(failure.message, 'prepareSubmission.result.failure.message', true);
		requireString(failure.reconciliation, 'prepareSubmission.result.failure.reconciliation');
		return value as AgentHostPrepareSubmissionResult;
	}
	if (kind !== 'prepared') {
		invalidProtocol('prepareSubmission.result.kind', kind);
	}
	requireExactKeys(result, ['kind', 'submission'], [], 'prepareSubmission.result');
	const submission = requireRecord(result.submission, 'prepareSubmission.result.submission');
	if (!Object.hasOwn(submission, 'sessionConfiguration')) {
		invalidProtocol('prepareSubmission.result.submission.sessionConfiguration', 'missing');
	}
	validateSessionConfigurationState(
		submission.sessionConfiguration,
		'prepareSubmission.result.submission.sessionConfiguration',
	);
	return value as AgentHostPrepareSubmissionResult;
}

function requireIdentity(value: unknown): {
	readonly authority: AgentHostAuthorityId;
	readonly connection: AgentHostClientConnectionId;
} {
	assertAgentHostProtocolValue(value);
	const identity = asRecord(value);
	if (
		identity === undefined
		|| Object.keys(identity).length !== 2
		|| typeof identity.authority !== 'string'
		|| typeof identity.connection !== 'string'
	) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Invalid local Agent Host connection identity',
			{ field: 'identity', value: typeof value },
		);
	}
	return Object.freeze({
		authority: createAgentHostAuthorityId(identity.authority),
		connection: createAgentHostClientConnectionId(identity.connection),
	});
}

function isAgentHostErrorCode(value: string): value is AgentHostErrorCode {
	return Object.values(AgentHostErrorCode).some(code => code === value);
}

function reviveConnectionError(error: unknown): unknown {
	const transportError = asRecord(error);
	if (transportError?.code === localAgentHostCancellationErrorCode) {
		return new CancellationError();
	}
	if (transportError?.code !== localAgentHostErrorCode) {
		return error;
	}

	const details = asRecord(transportError.details);
	if (
		details === undefined
		|| typeof details.code !== 'string'
		|| !isAgentHostErrorCode(details.code)
		|| typeof details.message !== 'string'
	) {
		return error;
	}
	assertAgentHostProtocolValue(details.data);
	return new AgentHostError<AgentHostErrorCode>(
		details.code,
		details.message,
		details.data as IAgentHostErrorDataByCode[AgentHostErrorCode],
	);
}

function assertConnectionRequest(
	requestConnection: AgentHostClientConnectionId,
	actualConnection: AgentHostClientConnectionId,
	field: string,
): void {
	if (requestConnection !== actualConnection) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Local Agent Host request addresses another logical connection',
			{ field, value: requestConnection },
		);
	}
}

/** Implements the common Agent Host connection over the desktop main-process channel. */
export class LocalAgentHostConnection extends Disposable implements IAgentHostConnection {
	private readonly lifetimeCancellation = this._register(new CancellationTokenSource());
	private readonly actionEmitter = this._register(new Emitter<AgentHostChannelAction>({ onListenerError: onUnexpectedError }));
	readonly onDidReceiveAction: Event<AgentHostChannelAction> = this.actionEmitter.event;
	private readonly progressEmitter = this._register(new Emitter<IAgentHostOperationProgress>({ onListenerError: onUnexpectedError }));
	readonly onDidProgress: Event<IAgentHostOperationProgress> = this.progressEmitter.event;
	readonly clientTools: ClientAgentToolService;

	private constructor(
		private readonly channel: IChannel,
		readonly authority: AgentHostAuthorityId,
		readonly connection: AgentHostClientConnectionId,
		maximumClientToolCallRecords: number,
	) {
		super();
		this.clientTools = this._register(new ClientAgentToolService(connection, {
			maximumCallRecords: maximumClientToolCallRecords,
			synchronize: snapshot => this.synchronizeClientTools(snapshot),
		}));
		this._register(this.channel.listen<unknown>('onDidReceiveAction')(action => {
			try {
				assertAgentHostProtocolValue(action);
				this.actionEmitter.fire(action as unknown as AgentHostChannelAction);
			} catch (error) {
				onUnexpectedError(error);
			}
		}));
		this._register(this.channel.listen<unknown>('onDidProgress')(progress => {
			try {
				assertAgentHostOperationProgress(progress);
				this.progressEmitter.fire(progress);
			} catch (error) {
				onUnexpectedError(error);
			}
		}));
	}

	static async create(channel: IChannel, maximumClientToolCallRecords: number): Promise<LocalAgentHostConnection> {
		let identity: unknown;
		try {
			identity = await channel.call<unknown>('identity');
		} catch (error) {
			throw reviveConnectionError(error);
		}
		const parsed = requireIdentity(identity);
		return new LocalAgentHostConnection(
			channel,
			parsed.authority,
			parsed.connection,
			maximumClientToolCallRecords,
		);
	}

	async initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		assertConnectionRequest(request.connection, this.connection, 'initialize.connection');
		if (request.protocolVersions.length !== 1 || request.protocolVersions[0] !== localAgentHostProtocolVersion) {
			invalidProtocol('initialize.protocolVersions', request.protocolVersions.length);
		}
		const result = await this.call<IAgentHostInitializeResult>('initialize', request);
		if (result.protocolVersion !== localAgentHostProtocolVersion) {
			invalidProtocol('initialize.result.protocolVersion', result.protocolVersion);
		}
		return result;
	}

	async reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		assertConnectionRequest(request.connection, this.connection, 'reconnect.connection');
		const result = await this.call<AgentHostReconnectResult>('reconnect', request);
		assertAgentHostReconnectResult(request, result);
		return result;
	}

	async setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		const result = await this.call<IAgentHostSetSubscriptionsResult>('setSubscriptions', request);
		assertAgentHostSetSubscriptionsResult(request, result);
		return result;
	}

	async resolveSessionConfiguration(
		request: IAgentHostResolveSessionConfigurationRequest,
	): Promise<IAgentHostResolveSessionConfigurationResult> {
		const exactRequest = validateResolveRequest(request);
		return validateResolveResult(await this.call('resolveSessionConfiguration', exactRequest));
	}

	async completeSessionConfiguration(
		request: IAgentHostSessionConfigurationCompletionsRequest,
	): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		const exactRequest = validateCompletionRequest(request);
		return validateCompletionResult(exactRequest, await this.call('completeSessionConfiguration', exactRequest));
	}

	async prepareSubmission(request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult> {
		await this.clientTools.synchronize();
		return validatePrepareResult(await this.call('prepareSubmission', request));
	}

	mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		return this.call('mutate', request);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		return this.call('getOperationOutcome', request);
	}

	async executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		assertAgentPackageOperationRequest(request);
		const outcome = await this.call<unknown>('executePackageOperation', request);
		assertAgentPackageOperationOutcome(request, outcome);
		return outcome;
	}

	async getPackageOperationOutcome(
		request: IAgentPackageOperationOutcomeRequest,
	): Promise<AgentPackageOperationOutcome> {
		assertAgentPackageOperationOutcomeRequest(request);
		const outcome = await this.call<unknown>('getPackageOperationOutcome', request);
		assertAgentPackageOperationOutcome(request, outcome);
		return outcome;
	}

	override dispose(): void {
		this.lifetimeCancellation.cancel();
		super.dispose();
	}

	private async call<TResult>(command: string, arg: object): Promise<TResult> {
		if (this._store.isDisposed) {
			throw new CancellationError();
		}
		assertAgentHostProtocolValue(arg);
		try {
			const result = await this.channel.call<unknown>(command, arg, this.lifetimeCancellation.token);
			assertAgentHostProtocolValue(result);
			return result as TResult;
		} catch (error) {
			throw reviveConnectionError(error);
		}
	}

	private async synchronizeClientTools(snapshot: IAgentClientToolPublicationSnapshot): Promise<void> {
		const result = await this.call<unknown>('synchronizeClientTools', snapshot);
		if (result !== null) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Local Agent Host client Tool synchronization returned a non-null result',
				{ field: 'synchronizeClientTools.result', value: typeof result },
			);
		}
	}
}
