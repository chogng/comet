/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationToken, CancellationTokenSource, isCancellationError } from 'cs/base/common/cancellation';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { IObservable, ISettableObservable, observableValue } from 'cs/base/common/observable';
import { localize } from 'cs/nls';
import {
	AgentChatOrigin,
	IAgent,
	IAgentAction,
	IAgentAcknowledgeSessionConfigurationUpdateRequest,
	AgentTurnProgress,
	IAgentCancelTurnRequest,
	IAgentCapabilities,
	IAgentChatBacking,
	IAgentChatRequest,
	IAgentChats,
	IAgentConfiguration,
	IAgentCreateChatOptions,
	IAgentCreateSessionOptions,
	IAgentDeleteChatRequest,
	IAgentDeleteSessionRequest,
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentExecutionProfileRequest,
	IAgentExecutionProfiles,
	IAgentForkChatRequest,
	IAgentInteractions,
	IAgentMaterializeChatRequest,
	IAgentMaterializeSessionRequest,
	IAgentModelDescriptor,
	IAgentReleaseChatRequest,
	IAgentReleaseSessionRequest,
	IAgentResolveSessionConfigurationRequest,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentResumeStates,
	IAgentRuntimeRegistration,
	IAgentSessionBacking,
	IAgentSessions,
	IAgentSessionConfigurationCompletionRequest,
	IAgentPrepareSessionConfigurationUpdateRequest,
	IAgentFinalizeSessionConfigurationUpdateRequest,
	IAgentSteerRequest,
	IAgentWorkspace,
} from 'cs/platform/agentHost/common/agent';
import {
	IAgentConfigurationCompletion,
	IAgentConfigurationState,
	collectAgentConfigurationCredentialReferences,
	resolveAgentModelConfigurationCandidate,
	resolveAgentSessionConfigurationValues,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import { validateAndFreezeAgentCredentialReference } from 'cs/platform/agentHost/common/credentials';
import {
	IAgentHostInteractionTarget,
	assertAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentChatId,
	AgentConfigurationStateRevision,
	AgentExecutionProfileDigest,
	AgentExecutionProfileRevision,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentModelDescriptorRevision,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentSubmissionId,
	AgentToolCallId,
	AgentTurnId,
	createAgentCapabilityRevision,
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentInteractionTargetId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolDescriptorRevision,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	computeAgentHostPayloadDigest,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	AgentToolResult,
	IAgentToolCall,
	IAgentToolExecutionPort,
	IAgentToolRegistration,
	IAgentToolSet,
	computeAgentToolMutationPayloadDigest,
} from 'cs/platform/agentHost/common/tools';
import { CometPreparedAttachments, prepareCometModelAttachments } from './cometAttachments.js';
import {
	CometModelError,
	CometModelMessage,
	CometModelOutputPart,
	CometModelToolCall,
	ICometExecutionProfileResolution,
	ICometExecutionProfileResolver,
	ICometModelRuntime,
	ICometModelStepResult,
} from './cometModel.js';
import {
	COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
	COMET_SESSION_CONFIGURATION_SCHEMA,
	COMET_SESSION_CONFIGURATION_SCHEMA_REVISION,
} from './cometConfiguration.js';
import {
	COMET_AGENT_RESUME_SCHEMA,
	encodeCometChatResumeV1,
	encodeCometSessionResumeV1,
} from './cometResume.js';

export const COMET_AGENT_ID = createAgentId('comet');
export const COMET_AGENT_PACKAGE_ID = createAgentPackageId('comet');
export const COMET_AGENT_DESCRIPTOR_REVISION = createAgentDescriptorRevision('comet.descriptor.v2');
export const COMET_AGENT_CAPABILITY_REVISION = createAgentCapabilityRevision('comet.capabilities.v1');
export const COMET_AGENT_INSTRUCTION_PROFILE = 'comet.instructions.v1';

const maximumCometChatCount = 64;
const maximumCometProfileBytes = 256 * 1024;
const maximumCometResumeBytes = 1024 * 1024;
const maximumCometSteps = 64;
const maximumCometResponseBytes = 4 * 1024 * 1024;
const maximumCometTurnsInResume = 10_000;
const maximumCometMessagesInResume = 100_000;
const maximumCometModelPartsPerMessage = 256;
const maximumCometToolFailureMessageLength = 8_192;
const maximumRetainedCometOperations = 16_384;
const cometModelRuntimePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const cometSystemPrompt = [
	'You are the Comet Studio assistant.',
	'Use only the exact normalized context and canonical Tools supplied for this Turn.',
	'Do not claim an external effect unless its canonical Tool result confirms it.',
].join(' ');

export interface ICometAgentConfiguration {
	readonly requiresAgentAuthentication: boolean;
	readonly models: readonly ICometModelRuntime[];
	readonly executionProfileResolver: ICometExecutionProfileResolver;
}

export interface ICometAgentOptions extends ICometAgentConfiguration {
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly toolExecution: IAgentToolExecutionPort;
	readonly contentResources: IAgentContentResourcePort;
}

interface ICometExecutionProfileData {
	readonly version: 1;
	readonly modelRuntime: string;
	readonly instructionProfile: string;
	readonly settings: AgentHostProtocolValue;
	readonly maximumSteps: number;
}

interface ICometProfileResolutionRecord {
	readonly selectionDigest: AgentHostPayloadDigest;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly profile: Promise<IAgentExecutionProfile>;
}

interface ICometRegisteredModelRuntime {
	readonly runtime: ICometModelRuntime;
	readonly descriptor: IAgentModelDescriptor;
}

interface ICometActiveModelCatalog {
	readonly executionProfileResolver: ICometExecutionProfileResolver;
	readonly modelRuntimesById: ReadonlyMap<string, ICometRegisteredModelRuntime>;
}

interface ICometConfigurationCandidate {
	readonly descriptor: IAgentDescriptor;
	readonly activeModelCatalog: ICometActiveModelCatalog;
	readonly historicalModelRuntimes: readonly ICometRegisteredModelRuntime[];
}

interface ICometTurnCheckpoint {
	readonly messageLength: number;
	readonly checkpoint?: AgentHostProtocolValue;
}

interface ICometActiveTurn {
	readonly turn: AgentTurnId;
	readonly cancellation: CancellationTokenSource;
	readonly completion: DeferredPromise<void>;
	readonly toolCalls: Set<AgentToolCallId>;
	currentToolCall?: AgentToolCallId;
}

interface ICometChatRecord {
	readonly id: AgentChatId;
	readonly origin: AgentChatOrigin;
	materialized: boolean;
	readonly messages: CometModelMessage[];
	readonly baseMessageLength: number;
	checkpoint?: AgentHostProtocolValue;
	readonly usage: AgentHostProtocolValue[];
	readonly turns: Map<AgentTurnId, ICometTurnCheckpoint>;
	activeTurn?: ICometActiveTurn;
}

interface ICometSessionRecord {
	readonly id: AgentSessionId;
	readonly workspace?: IAgentWorkspace;
	configuration: IAgentConfigurationState;
	materialized: boolean;
	readonly chats: Map<AgentChatId, ICometChatRecord>;
}

interface ICometPreparedSessionConfigurationTransaction {
	readonly status: 'prepared';
	readonly digest: AgentHostPayloadDigest;
	readonly session: AgentSessionId;
	readonly previous: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationState;
}

interface ICometTerminalSessionConfigurationTransaction {
	readonly status: 'committed' | 'rolledBack';
	readonly digest: AgentHostPayloadDigest;
	readonly session: AgentSessionId;
	readonly configuration: AgentConfigurationStateRevision;
	readonly decision: 'commit' | 'rollback';
}

type ICometSessionConfigurationTransaction =
	| ICometPreparedSessionConfigurationTransaction
	| ICometTerminalSessionConfigurationTransaction;

type CometOperationOutcome =
	| {
		readonly kind: 'sessionBacking';
		readonly backing: IAgentSessionBacking;
	}
	| {
		readonly kind: 'chatBacking';
		readonly backing: IAgentChatBacking;
	}
	| { readonly kind: 'void' };

interface ICometOperationRecord {
	readonly digest: AgentHostPayloadDigest;
	readonly effects: Map<string, Promise<CometOperationOutcome>>;
	pendingEffects: number;
	pinned: boolean;
}

class CometOperationRegistry {
	private readonly records = new Map<AgentHostOperationId, ICometOperationRecord>();
	private readonly settledRecords = new Map<AgentHostOperationId, true>();

	run(
		kind: string,
		subject: string,
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
		execute: () => Promise<CometOperationOutcome>,
	): Promise<CometOperationOutcome> {
		createAgentHostOperationId(operation);
		createAgentHostPayloadDigest(digest);
		let record = this.records.get(operation);
		if (record !== undefined) {
			if (record.digest !== digest) {
				throw new AgentHostError(
					AgentHostErrorCode.OperationDigestConflict,
					'Comet operation ID is already bound to another payload',
					{ operation, recordedDigest: record.digest, receivedDigest: digest },
				);
			}
		} else {
			record = { digest, effects: new Map(), pendingEffects: 0, pinned: false };
			this.records.set(operation, record);
		}

		const effect = `${kind}\u0000${subject}`;
		const existing = record.effects.get(effect);
		if (existing !== undefined) {
			return existing;
		}
		const outcome = execute();
		record.pendingEffects += 1;
		this.settledRecords.delete(operation);
		record.effects.set(effect, outcome);
		void outcome.then(
			() => this.completeEffect(operation, record),
			() => this.completeEffect(operation, record),
		);
		this.pruneSettledRecords();
		return outcome;
	}

	pin(operation: AgentHostOperationId, digest: AgentHostPayloadDigest): void {
		const record = this.requireRecord(operation, digest);
		record.pinned = true;
		this.settledRecords.delete(operation);
	}

	unpin(operation: AgentHostOperationId, digest: AgentHostPayloadDigest): void {
		const record = this.requireRecord(operation, digest);
		record.pinned = false;
		if (record.pendingEffects === 0) {
			this.settledRecords.delete(operation);
			this.settledRecords.set(operation, true);
		}
		this.pruneSettledRecords();
	}

	private requireRecord(operation: AgentHostOperationId, digest: AgentHostPayloadDigest): ICometOperationRecord {
		createAgentHostOperationId(operation);
		createAgentHostPayloadDigest(digest);
		const record = this.records.get(operation);
		if (record === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Comet operation is not retained',
				{ operation },
			);
		}
		if (record.digest !== digest) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationDigestConflict,
				'Comet operation ID is already bound to another payload',
				{ operation, recordedDigest: record.digest, receivedDigest: digest },
			);
		}
		return record;
	}

	private completeEffect(operation: AgentHostOperationId, record: ICometOperationRecord): void {
		record.pendingEffects -= 1;
		if (record.pendingEffects === 0 && !record.pinned && this.records.get(operation) === record) {
			this.settledRecords.delete(operation);
			this.settledRecords.set(operation, true);
		}
		this.pruneSettledRecords();
	}

	private pruneSettledRecords(): void {
		while (this.records.size > maximumRetainedCometOperations) {
			const settled = this.settledRecords.keys().next();
			if (settled.done) {
				return;
			}
			this.settledRecords.delete(settled.value);
			this.records.delete(settled.value);
		}
	}
}

class CometTurnError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly data?: AgentHostProtocolValue,
	) {
		super(message);
		this.name = 'CometTurnError';
	}
}

function invalidValue(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Comet runtime value',
		{ field, value: diagnostic },
	);
}

function asRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidValue(field, value);
	}
	return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidValue(`${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidValue(`${field}.${key}`, 'missing');
		}
	}
}

function asString(value: unknown, field: string, maximumLength = 4_096): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
		return invalidValue(field, value);
	}
	return value;
}

function asPositiveInteger(value: unknown, field: string, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		return invalidValue(field, value);
	}
	return value;
}

function asNonNegativeInteger(value: unknown, field: string, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
		return invalidValue(field, value);
	}
	return value;
}

function asBoundedText(value: unknown, field: string, maximumBytes: number): string {
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > maximumBytes) {
		return invalidValue(field, value);
	}
	return value;
}

function resourceMissing(kind: string, id: string): never {
	throw new AgentHostError(
		AgentHostErrorCode.ResourceMissing,
		`Comet ${kind} backing is missing`,
		{ resource: `${kind}:${id}` },
	);
}

function unsupportedCapability(capability: string): never {
	throw new AgentHostError(
		AgentHostErrorCode.CapabilityUnsupported,
		'Comet capability is not supported',
		{ capability },
	);
}

function workspaceToProtocolValue(workspace: IAgentWorkspace | undefined): AgentHostProtocolValue {
	if (workspace === undefined) {
		return null;
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

function parseWorkspace(value: unknown): IAgentWorkspace | undefined {
	if (value === null) {
		return undefined;
	}
	const workspace = asRecord(value, 'resume.workspace');
	assertExactKeys(workspace, ['resource', 'label', 'folders'], [], 'resume.workspace');
	if (!Array.isArray(workspace.folders) || workspace.folders.length > 128) {
		return invalidValue('resume.workspace.folders', workspace.folders);
	}
	return {
		resource: asString(workspace.resource, 'resume.workspace.resource'),
		label: asString(workspace.label, 'resume.workspace.label', 512),
		folders: workspace.folders.map((folderValue, index) => {
			const folder = asRecord(folderValue, `resume.workspace.folders.${index}`);
			assertExactKeys(folder, ['resource', 'workingDirectory', 'name'], ['repository'], `resume.workspace.folders.${index}`);
			let repository: IAgentWorkspace['folders'][number]['repository'];
			if (folder.repository !== undefined) {
				const repositoryValue = asRecord(folder.repository, `resume.workspace.folders.${index}.repository`);
				assertExactKeys(repositoryValue, ['root'], ['branch', 'baseBranch'], `resume.workspace.folders.${index}.repository`);
				repository = {
					root: asString(repositoryValue.root, `resume.workspace.folders.${index}.repository.root`),
					...(repositoryValue.branch === undefined ? {} : {
						branch: asString(repositoryValue.branch, `resume.workspace.folders.${index}.repository.branch`, 512),
					}),
					...(repositoryValue.baseBranch === undefined ? {} : {
						baseBranch: asString(repositoryValue.baseBranch, `resume.workspace.folders.${index}.repository.baseBranch`, 512),
					}),
				};
			}
			return {
				resource: asString(folder.resource, `resume.workspace.folders.${index}.resource`),
				workingDirectory: asString(folder.workingDirectory, `resume.workspace.folders.${index}.workingDirectory`),
				name: asString(folder.name, `resume.workspace.folders.${index}.name`, 512),
				...(repository === undefined ? {} : { repository }),
			};
		}),
	};
}

function originToProtocolValue(origin: AgentChatOrigin): AgentHostProtocolValue {
	if (origin.kind === 'user') {
		return { kind: 'user' };
	}
	if (origin.kind === 'fork') {
		return {
			kind: 'fork',
			parentChat: origin.parentChat,
			parentTurn: origin.parentTurn,
		};
	}
	return {
		kind: 'tool',
		parentChat: origin.parentChat,
		parentTurn: origin.parentTurn,
		toolCall: origin.toolCall,
	};
}

function parseOrigin(value: unknown): AgentChatOrigin {
	const origin = asRecord(value, 'resume.origin');
	if (origin.kind === 'user') {
		assertExactKeys(origin, ['kind'], [], 'resume.origin');
		return { kind: 'user' };
	}
	if (origin.kind === 'fork') {
		assertExactKeys(origin, ['kind', 'parentChat', 'parentTurn'], [], 'resume.origin');
		return {
			kind: 'fork',
			parentChat: createAgentChatId(asString(origin.parentChat, 'resume.origin.parentChat', 128)),
			parentTurn: createAgentTurnId(asString(origin.parentTurn, 'resume.origin.parentTurn', 128)),
		};
	}
	if (origin.kind === 'tool') {
		assertExactKeys(origin, ['kind', 'parentChat', 'parentTurn', 'toolCall'], [], 'resume.origin');
		return {
			kind: 'tool',
			parentChat: createAgentChatId(asString(origin.parentChat, 'resume.origin.parentChat', 128)),
			parentTurn: createAgentTurnId(asString(origin.parentTurn, 'resume.origin.parentTurn', 128)),
			toolCall: createAgentToolCallId(asString(origin.toolCall, 'resume.origin.toolCall', 128)),
		};
	}
	return invalidValue('resume.origin.kind', origin.kind);
}

function parseOptionalProtocolValue(value: unknown, field: string): AgentHostProtocolValue | undefined {
	const optional = asRecord(value, field);
	if (optional.present === false) {
		assertExactKeys(optional, ['present'], [], field);
		return undefined;
	}
	if (optional.present === true) {
		assertExactKeys(optional, ['present', 'value'], [], field);
		assertAgentHostProtocolValue(optional.value);
		return optional.value;
	}
	return invalidValue(`${field}.present`, optional.present);
}

function parseModelToolCall(value: unknown, field: string): CometModelToolCall {
	const call = asRecord(value, field);
	assertExactKeys(call, ['id', 'registrationId', 'input', 'effect'], ['target'], field);
	const id = createAgentToolCallId(asString(call.id, `${field}.id`, 128));
	const registrationId = createAgentToolRegistrationId(asString(call.registrationId, `${field}.registrationId`, 128));
	assertAgentHostProtocolValue(call.input);
	const target = call.target === undefined
		? undefined
		: createAgentInteractionTargetId(asString(call.target, `${field}.target`, 128));
	const effect = asRecord(call.effect, `${field}.effect`);
	if (effect.kind === 'read') {
		assertExactKeys(effect, ['kind'], [], `${field}.effect`);
		return {
			id,
			registrationId,
			input: call.input,
			...(target === undefined ? {} : { target }),
			effect: { kind: 'read' },
		};
	}
	if (effect.kind === 'mutation') {
		assertExactKeys(effect, ['kind', 'operation', 'payloadDigest'], [], `${field}.effect`);
		return {
			id,
			registrationId,
			input: call.input,
			...(target === undefined ? {} : { target }),
			effect: {
				kind: 'mutation',
				operation: createAgentHostOperationId(asString(effect.operation, `${field}.effect.operation`, 128)),
				payloadDigest: createAgentHostPayloadDigest(asString(effect.payloadDigest, `${field}.effect.payloadDigest`, 128)),
			},
		};
	}
	return invalidValue(`${field}.effect.kind`, effect.kind);
}

function parseModelOutputPart(value: unknown, field: string): CometModelOutputPart {
	const part = asRecord(value, field);
	if (part.kind === 'reasoning' || part.kind === 'text') {
		assertExactKeys(part, ['kind', 'text'], [], field);
		return {
			kind: part.kind,
			text: asBoundedText(part.text, `${field}.text`, maximumCometResponseBytes),
		};
	}
	if (part.kind === 'toolCall') {
		assertExactKeys(part, ['kind', 'call'], [], field);
		return { kind: 'toolCall', call: parseModelToolCall(part.call, `${field}.call`) };
	}
	return invalidValue(`${field}.kind`, part.kind);
}

function parseToolResult(value: unknown, field: string): AgentToolResult {
	const result = asRecord(value, field);
	if (result.status === 'completed') {
		assertExactKeys(result, ['call', 'status', 'output'], [], field);
		const call = createAgentToolCallId(asString(result.call, `${field}.call`, 128));
		assertAgentHostProtocolValue(result.output);
		return { call, status: 'completed', output: result.output };
	}
	if (
		result.status !== 'denied'
		&& result.status !== 'cancelled'
		&& result.status !== 'timedOut'
		&& result.status !== 'failed'
	) {
		return invalidValue(`${field}.status`, result.status);
	}
	assertExactKeys(result, ['call', 'status', 'failure'], [], field);
	const call = createAgentToolCallId(asString(result.call, `${field}.call`, 128));
	const failure = asRecord(result.failure, `${field}.failure`);
	assertExactKeys(failure, ['code', 'message', 'reconciliation'], ['data'], `${field}.failure`);
	const code = asString(failure.code, `${field}.failure.code`, 64);
	const expectedCode = result.status === 'failed' ? undefined : result.status;
	if (
		!['denied', 'cancelled', 'timedOut', 'unavailable', 'invalidInput', 'invalidOutput', 'failed'].includes(code)
		|| (expectedCode !== undefined && code !== expectedCode)
		|| (expectedCode === undefined && ['denied', 'cancelled', 'timedOut'].includes(code))
	) {
		invalidValue(`${field}.failure.code`, code);
	}
	const message = asString(failure.message, `${field}.failure.message`, maximumCometToolFailureMessageLength);
	if (failure.reconciliation !== 'terminal' && failure.reconciliation !== 'sameOperationRequired') {
		invalidValue(`${field}.failure.reconciliation`, failure.reconciliation);
	}
	let data: AgentHostProtocolValue | undefined;
	if (Object.hasOwn(failure, 'data')) {
		assertAgentHostProtocolValue(failure.data);
		data = failure.data;
	}
	return {
		call,
		status: result.status,
		failure: {
			code: code as 'denied' | 'cancelled' | 'timedOut' | 'unavailable' | 'invalidInput' | 'invalidOutput' | 'failed',
			message,
			reconciliation: failure.reconciliation,
			...(data === undefined ? {} : { data }),
		},
	};
}

function parseModelMessages(value: unknown): CometModelMessage[] {
	if (!Array.isArray(value) || value.length > maximumCometMessagesInResume) {
		return invalidValue('resume.data.messages', value);
	}
	const messages = value.map((messageValue, index): CometModelMessage => {
		const field = `resume.data.messages.${index}`;
		const message = asRecord(messageValue, field);
		const turn = createAgentTurnId(asString(message.turn, `${field}.turn`, 128));
		if (message.role === 'user') {
			assertExactKeys(message, ['role', 'turn', 'text'], [], field);
			return {
				role: 'user',
				turn,
				text: asBoundedText(message.text, `${field}.text`, maximumCometResponseBytes),
			};
		}
		if (message.role === 'assistant') {
			assertExactKeys(message, ['role', 'turn', 'parts'], [], field);
			if (!Array.isArray(message.parts) || message.parts.length > maximumCometModelPartsPerMessage) {
				return invalidValue(`${field}.parts`, message.parts);
			}
			return {
				role: 'assistant',
				turn,
				parts: message.parts.map((part, partIndex) => parseModelOutputPart(part, `${field}.parts.${partIndex}`)),
			};
		}
		if (message.role === 'tool') {
			assertExactKeys(message, ['role', 'turn', 'result'], [], field);
			return { role: 'tool', turn, result: parseToolResult(message.result, `${field}.result`) };
		}
		return invalidValue(`${field}.role`, message.role);
	});

	const calls = new Map<AgentToolCallId, { readonly turn: AgentTurnId; readonly call: CometModelToolCall }>();
	const completedCalls = new Set<AgentToolCallId>();
	for (const [messageIndex, message] of messages.entries()) {
		if (message.role === 'assistant') {
			for (const [partIndex, part] of message.parts.entries()) {
				if (part.kind !== 'toolCall') {
					continue;
				}
				if (calls.has(part.call.id)) {
					invalidValue(`resume.data.messages.${messageIndex}.parts.${partIndex}.call.id`, part.call.id);
				}
				calls.set(part.call.id, { turn: message.turn, call: part.call });
			}
		} else if (message.role === 'tool') {
			const source = calls.get(message.result.call);
			if (source === undefined || source.turn !== message.turn || completedCalls.has(message.result.call)) {
				invalidValue(`resume.data.messages.${messageIndex}.result.call`, message.result.call);
			}
			if (
				message.result.status !== 'completed'
				&& source.call.effect.kind === 'read'
				&& message.result.failure.reconciliation !== 'terminal'
			) {
				invalidValue(
					`resume.data.messages.${messageIndex}.result.failure.reconciliation`,
					message.result.failure.reconciliation,
				);
			}
			completedCalls.add(message.result.call);
		}
	}
	return messages;
}

function validateResumeMessageBoundaries(
	origin: AgentChatOrigin,
	baseMessageLength: number,
	messages: readonly CometModelMessage[],
	turns: ReadonlyMap<AgentTurnId, ICometTurnCheckpoint>,
): void {
	if (baseMessageLength > messages.length || (origin.kind !== 'fork' && baseMessageLength !== 0)) {
		invalidValue('resume.data.baseMessageLength', baseMessageLength);
	}
	let previousMessageLength = baseMessageLength;
	for (const [turn, checkpoint] of turns) {
		if (
			checkpoint.messageLength <= previousMessageLength
			|| checkpoint.messageLength > messages.length
			|| messages.slice(0, baseMessageLength).some(message => message.turn === turn)
		) {
			invalidValue(`resume.data.turns.${turn}.messageLength`, checkpoint.messageLength);
		}
		const turnMessages = messages.slice(previousMessageLength, checkpoint.messageLength);
		if (
			turnMessages[0]?.role !== 'user'
			|| turnMessages.some(message => message.turn !== turn)
			|| turnMessages.filter(message => message.role === 'user').length !== 1
		) {
			invalidValue(`resume.data.turns.${turn}.messages`, turnMessages.length);
		}
		previousMessageLength = checkpoint.messageLength;
	}
	if (previousMessageLength !== messages.length) {
		invalidValue('resume.data.messages.length', messages.length);
	}
}

function parseResumeData(resume: IAgentResumeState, kind: 'session' | 'chat'): Readonly<Record<string, unknown>> {
	if (resume.schema !== COMET_AGENT_RESUME_SCHEMA) {
		invalidValue('resume.schema', resume.schema);
	}
	if (new TextEncoder().encode(resume.data).byteLength > maximumCometResumeBytes) {
		invalidValue('resume.byteLength', resume.data.length);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(resume.data);
	} catch {
		return invalidValue('resume.data', 'invalid-json');
	}
	assertAgentHostProtocolValue(parsed);
	const data = asRecord(parsed, 'resume.data');
	if (data.kind !== kind || data.version !== 1) {
		invalidValue('resume.data.kind', data.kind);
	}
	return data;
}

function createSessionResume(record: ICometSessionRecord): IAgentResumeState {
	return encodeCometSessionResumeV1(record.id, record.workspace);
}

function parseSessionResume(
	resume: IAgentResumeState,
	session: AgentSessionId,
	configuration: IAgentConfigurationState,
): ICometSessionRecord {
	const data = parseResumeData(resume, 'session');
	assertExactKeys(data, ['kind', 'version', 'session', 'workspace'], [], 'resume.data');
	const resumeSession = createAgentSessionId(asString(data.session, 'resume.data.session', 128));
	if (resumeSession !== session) {
		invalidValue('resume.data.session', resumeSession);
	}
	return {
		id: session,
		workspace: parseWorkspace(data.workspace),
		configuration,
		materialized: true,
		chats: new Map(),
	};
}

function createChatResume(session: AgentSessionId, record: ICometChatRecord): IAgentResumeState {
	return encodeCometChatResumeV1({
		session,
		chat: record.id,
		origin: record.origin,
		baseMessageLength: record.baseMessageLength,
		messages: record.messages,
		checkpoint: record.checkpoint,
		usage: record.usage,
		turns: Array.from(record.turns, ([turn, turnCheckpoint]) => ({ turn, ...turnCheckpoint })),
	});
}

function parseChatResume(
	resume: IAgentResumeState,
	session: AgentSessionId,
	chat: AgentChatId,
): ICometChatRecord {
	const data = parseResumeData(resume, 'chat');
	assertExactKeys(
		data,
		[
			'kind',
			'version',
			'session',
			'chat',
			'origin',
			'baseMessageLength',
			'messages',
			'checkpoint',
			'usage',
			'turns',
		],
		[],
		'resume.data',
	);
	const resumeSession = createAgentSessionId(asString(data.session, 'resume.data.session', 128));
	const resumeChat = createAgentChatId(asString(data.chat, 'resume.data.chat', 128));
	if (resumeSession !== session || resumeChat !== chat) {
		invalidValue('resume.data.backing', `${resumeSession}:${resumeChat}`);
	}
	if (!Array.isArray(data.turns) || data.turns.length > maximumCometTurnsInResume) {
		return invalidValue('resume.data.turns', data.turns);
	}
	if (!Array.isArray(data.usage) || data.usage.length > maximumCometTurnsInResume) {
		return invalidValue('resume.data.usage', data.usage);
	}
	const origin = parseOrigin(data.origin);
	const messages = parseModelMessages(data.messages);
	const baseMessageLength = asNonNegativeInteger(
		data.baseMessageLength,
		'resume.data.baseMessageLength',
		maximumCometMessagesInResume,
	);
	const usage = data.usage.map(value => {
		assertAgentHostProtocolValue(value);
		return value;
	});
	const turns = new Map<AgentTurnId, ICometTurnCheckpoint>();
	for (const [index, turnValue] of data.turns.entries()) {
		const turnRecord = asRecord(turnValue, `resume.data.turns.${index}`);
		assertExactKeys(turnRecord, ['turn', 'messageLength', 'checkpoint'], [], `resume.data.turns.${index}`);
		const turn = createAgentTurnId(asString(turnRecord.turn, `resume.data.turns.${index}.turn`, 128));
		if (turns.has(turn)) {
			invalidValue(`resume.data.turns.${index}.turn`, turn);
		}
		turns.set(turn, {
			messageLength: asPositiveInteger(
				turnRecord.messageLength,
				`resume.data.turns.${index}.messageLength`,
				maximumCometMessagesInResume,
			),
			checkpoint: parseOptionalProtocolValue(turnRecord.checkpoint, `resume.data.turns.${index}.checkpoint`),
		});
	}
	validateResumeMessageBoundaries(origin, baseMessageLength, messages, turns);
	return {
		id: chat,
		origin,
		materialized: true,
		messages,
		baseMessageLength,
		checkpoint: parseOptionalProtocolValue(data.checkpoint, 'resume.data.checkpoint'),
		usage,
		turns,
	};
}

function cloneModelDescriptor(descriptor: IAgentModelDescriptor): IAgentModelDescriptor {
	createAgentModelId(descriptor.id);
	createAgentModelDescriptorRevision(descriptor.revision);
	if (descriptor.displayName.length === 0 || descriptor.displayName.length > 512) {
		invalidValue('model.displayName', descriptor.displayName);
	}
	const attachmentNumbers = [
		descriptor.attachments.maximumCount,
		descriptor.attachments.maximumItemBytes,
		descriptor.attachments.maximumTotalBytes,
		descriptor.attachments.maximumTreeDepth,
		descriptor.attachments.maximumTreeEntries,
	];
	if (attachmentNumbers.some(value => !Number.isSafeInteger(value) || value < 0)) {
		invalidValue('model.attachments', attachmentNumbers.join(','));
	}
	for (const profile of descriptor.toolSchemaProfiles) {
		createAgentToolSchemaProfileId(profile);
	}
	const configurationSchema = validateAndFreezeAgentConfigurationSchema(descriptor.configurationSchema, {
		agent: COMET_AGENT_ID,
		scope: 'model',
	});
	return Object.freeze({
		id: descriptor.id,
		revision: descriptor.revision,
		displayName: descriptor.displayName,
		enabled: descriptor.enabled,
		configurationSchema,
		toolSchemaProfiles: Object.freeze([...descriptor.toolSchemaProfiles]),
		attachments: Object.freeze({
			carriers: Object.freeze([...descriptor.attachments.carriers]),
			shapes: Object.freeze([...descriptor.attachments.shapes]),
			mediaTypes: Object.freeze([...descriptor.attachments.mediaTypes]),
			maximumCount: descriptor.attachments.maximumCount,
			maximumItemBytes: descriptor.attachments.maximumItemBytes,
			maximumTotalBytes: descriptor.attachments.maximumTotalBytes,
			maximumTreeDepth: descriptor.attachments.maximumTreeDepth,
			maximumTreeEntries: descriptor.attachments.maximumTreeEntries,
			supportsClientContentForBackgroundExecution: descriptor.attachments.supportsClientContentForBackgroundExecution,
		}),
	});
}

function parseExecutionProfileData(data: string): ICometExecutionProfileData {
	if (new TextEncoder().encode(data).byteLength > maximumCometProfileBytes) {
		invalidValue('profile.data.byteLength', data.length);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return invalidValue('profile.data', 'invalid-json');
	}
	assertAgentHostProtocolValue(parsed);
	const profile = asRecord(parsed, 'profile.data');
	assertExactKeys(
		profile,
		['version', 'modelRuntime', 'instructionProfile', 'settings', 'maximumSteps'],
		[],
		'profile.data',
	);
	if (profile.version !== 1 || profile.instructionProfile !== COMET_AGENT_INSTRUCTION_PROFILE) {
		invalidValue('profile.data.version', profile.version);
	}
	const modelRuntime = asString(profile.modelRuntime, 'profile.data.modelRuntime', 128);
	if (!cometModelRuntimePattern.test(modelRuntime)) {
		invalidValue('profile.data.modelRuntime', modelRuntime);
	}
	assertAgentHostProtocolValue(profile.settings);
	return {
		version: 1,
		modelRuntime,
		instructionProfile: COMET_AGENT_INSTRUCTION_PROFILE,
		settings: profile.settings,
		maximumSteps: asPositiveInteger(profile.maximumSteps, 'profile.data.maximumSteps', maximumCometSteps),
	};
}

async function createExecutionProfile(
	resolution: ICometExecutionProfileResolution,
	model: ICometRegisteredModelRuntime,
	runtimeRegistration: AgentRuntimeRegistrationRevision,
): Promise<IAgentExecutionProfile> {
	if (!cometModelRuntimePattern.test(resolution.modelRuntime)) {
		invalidValue('executionProfile.modelRuntime', resolution.modelRuntime);
	}
	assertAgentHostProtocolValue(resolution.settings);
	const dataValue: ICometExecutionProfileData = {
		version: 1,
		modelRuntime: resolution.modelRuntime,
		instructionProfile: COMET_AGENT_INSTRUCTION_PROFILE,
		settings: resolution.settings,
		maximumSteps: asPositiveInteger(resolution.maximumSteps, 'executionProfile.maximumSteps', maximumCometSteps),
	};
	const data = encodeAgentHostProtocolValue(dataValue);
	if (new TextEncoder().encode(data).byteLength > maximumCometProfileBytes) {
		invalidValue('executionProfile.data.byteLength', data.length);
	}
	const payloadDigest = await computeAgentHostPayloadDigest({
		agentDescriptor: COMET_AGENT_DESCRIPTOR_REVISION,
		modelDescriptor: model.descriptor.revision,
		runtimeRegistration,
		data,
	});
	const digest = createAgentExecutionProfileDigest(payloadDigest);
	const revision = createAgentExecutionProfileRevision(`comet-profile-${payloadDigest.slice('sha256:'.length)}`);
	return {
		revision,
		digest,
		agentDescriptor: COMET_AGENT_DESCRIPTOR_REVISION,
		modelDescriptor: model.descriptor.revision,
		data,
	};
}

async function computeExecutionProfileDigest(
	data: string,
	modelDescriptor: AgentModelDescriptorRevision,
	runtimeRegistration: AgentRuntimeRegistrationRevision,
): Promise<AgentExecutionProfileDigest> {
	const digest = await computeAgentHostPayloadDigest({
		agentDescriptor: COMET_AGENT_DESCRIPTOR_REVISION,
		modelDescriptor,
		runtimeRegistration,
		data,
	});
	return createAgentExecutionProfileDigest(digest);
}

function expectedExecutionProfileRevision(digest: AgentExecutionProfileDigest): AgentExecutionProfileRevision {
	return createAgentExecutionProfileRevision(`comet-profile-${digest.slice('sha256:'.length)}`);
}

function failureData(error: unknown): AgentHostProtocolValue {
	if (error instanceof CometTurnError) {
		return {
			code: error.code,
			message: error.message.slice(0, 2_048),
			...(error.data === undefined ? {} : { data: error.data }),
		};
	}
	if (error instanceof CometModelError) {
		return {
			code: error.code,
			message: error.message.slice(0, 2_048),
			...(error.data === undefined ? {} : { data: error.data }),
		};
	}
	if (error instanceof AgentHostError) {
		return {
			code: error.code,
			message: error.message.slice(0, 2_048),
		};
	}
	return {
		code: 'executionFailed',
		message: error instanceof Error ? error.message.slice(0, 2_048) : String(error).slice(0, 2_048),
	};
}

function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CometTurnError('cancelled', 'Comet turn was cancelled');
	}
}

function validateModelStepResult(result: ICometModelStepResult): void {
	if (result.stopReason !== 'completed' && result.stopReason !== 'toolCalls') {
		invalidValue('modelResult.stopReason', result.stopReason);
	}
	if (!Array.isArray(result.parts) || result.parts.length > 256) {
		invalidValue('modelResult.parts', result.parts);
	}
	if (result.usage !== undefined) {
		assertAgentHostProtocolValue(result.usage);
	}
	if (result.checkpoint !== undefined) {
		assertAgentHostProtocolValue(result.checkpoint);
	}
}

export class CometAgent extends Disposable implements IAgent {
	readonly id = COMET_AGENT_ID;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly registration: IAgentRuntimeRegistration;

	private readonly actionEmitter = this._register(new Emitter<IAgentAction>());
	readonly onDidEmitAction: Event<IAgentAction> = this.actionEmitter.event;

	readonly executionProfiles: IAgentExecutionProfiles = {
		resolve: request => this.resolveExecutionProfile(request),
	};

	readonly configuration: IAgentConfiguration = {
		resolveSession: request => this.resolveSessionConfiguration(request),
		completeSession: request => this.completeSessionConfiguration(request),
		prepareSessionUpdate: request => this.prepareSessionConfigurationUpdate(request),
		commitSessionUpdate: request => this.commitSessionConfigurationUpdate(request),
		rollbackSessionUpdate: request => this.rollbackSessionConfigurationUpdate(request),
		acknowledgeSessionUpdate: request => this.acknowledgeSessionConfigurationUpdate(request),
	};

	readonly sessions: IAgentSessions = {
		create: options => this.createSession(options),
		materialize: request => this.materializeSession(request),
		release: request => this.releaseSession(request),
		delete: request => this.deleteSession(request),
	};

	readonly chats: IAgentChats = {
		create: options => this.createChat(options),
		materialize: request => this.materializeChat(request),
		release: request => this.releaseChat(request),
		fork: request => this.forkChat(request),
		send: request => this.sendChatRequest(request),
		steer: request => this.steerChat(request),
		cancel: request => this.cancelChatTurn(request),
		delete: request => this.deleteChat(request),
	};

	readonly interactions: IAgentInteractions = {
		respond: request => this.respondInteraction(request.interaction),
	};

	readonly resumeStates: IAgentResumeStates = {
		migrate: request => this.migrateResumeState(request),
	};

	private async respondInteraction(interaction: string): Promise<void> {
		throw new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			`Comet interaction '${interaction}' is not active`,
			{ capability: 'interaction.respond' },
		);
	}

	private readonly operations = new CometOperationRegistry();
	private readonly profileResolutions = new Map<AgentSubmissionId, ICometProfileResolutionRecord>();
	private readonly historicalModelRuntimes = new Map<string, ICometRegisteredModelRuntime>();
	private readonly sessionRecords = new Map<AgentSessionId, ICometSessionRecord>();
	private readonly sessionConfigurationTransactions = new Map<AgentHostOperationId, ICometSessionConfigurationTransaction>();
	private readonly descriptorState: ISettableObservable<IAgentDescriptor>;
	private activeModelCatalog: ICometActiveModelCatalog;
	private readonly toolExecution: IAgentToolExecutionPort;
	private readonly contentResources: IAgentContentResourcePort;

	constructor(options: ICometAgentOptions) {
		super();
		createAgentRuntimeRegistrationRevision(options.runtimeRegistration);
		this.toolExecution = options.toolExecution;
		this.contentResources = options.contentResources;
		const initialConfiguration = this.createConfigurationCandidate(options);

		const supportedToolSchemaProfiles = Array.from(new Set(
			initialConfiguration.descriptor.models.flatMap(model => model.toolSchemaProfiles),
		)).sort();
		this.registration = Object.freeze({
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			revision: options.runtimeRegistration,
			descriptorRevision: COMET_AGENT_DESCRIPTOR_REVISION,
			capabilityRevision: COMET_AGENT_CAPABILITY_REVISION,
			hostDefaultsSchema: COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
			initialSessionConfigurationSchema: COMET_SESSION_CONFIGURATION_SCHEMA_REVISION,
			supportedSessionConfigurationSchemas: Object.freeze([COMET_SESSION_CONFIGURATION_SCHEMA_REVISION]),
			supportedToolSchemaProfiles: Object.freeze(supportedToolSchemaProfiles),
			supportedResumeSchemas: Object.freeze([COMET_AGENT_RESUME_SCHEMA]),
			resumeMigrationEdges: Object.freeze([]),
		});
		for (const model of initialConfiguration.descriptor.models) {
			for (const profile of model.toolSchemaProfiles) {
				if (!this.registration.supportedToolSchemaProfiles.includes(profile)) {
					invalidValue('models.toolSchemaProfiles', profile);
				}
			}
		}
		for (const runtime of initialConfiguration.historicalModelRuntimes) {
			this.historicalModelRuntimes.set(this.modelRuntimeKey(runtime.runtime.id, runtime.descriptor.revision), runtime);
		}
		this.activeModelCatalog = initialConfiguration.activeModelCatalog;
		this.descriptorState = observableValue('CometAgent.descriptor', initialConfiguration.descriptor);
		this.descriptor = this.descriptorState;
	}

	private createConfigurationCandidate(configuration: ICometAgentConfiguration): ICometConfigurationCandidate {
		const models: IAgentModelDescriptor[] = [];
		const modelRuntimesById = new Map<string, ICometRegisteredModelRuntime>();
		const historicalModelRuntimes: ICometRegisteredModelRuntime[] = [];
		const descriptorRevisions = new Set<AgentModelDescriptorRevision>();
		for (const runtime of configuration.models) {
			if (!cometModelRuntimePattern.test(runtime.id)) {
				invalidValue('models.runtime.id', runtime.id);
			}
			const descriptor = cloneModelDescriptor(runtime.descriptor);
			if (
				modelRuntimesById.has(runtime.id)
				|| descriptorRevisions.has(descriptor.revision)
				|| models.some(model => model.id === descriptor.id)
			) {
				invalidValue('models', runtime.id);
			}
			const key = this.modelRuntimeKey(runtime.id, descriptor.revision);
			const historical = this.historicalModelRuntimes.get(key);
			if (
				historical !== undefined
				&& encodeAgentHostProtocolValue(historical.descriptor) !== encodeAgentHostProtocolValue(descriptor)
			) {
				invalidValue('models.descriptor', descriptor.revision);
			}
			const registered = historical ?? Object.freeze({ runtime, descriptor });
			modelRuntimesById.set(runtime.id, registered);
			descriptorRevisions.add(descriptor.revision);
			models.push(registered.descriptor);
			historicalModelRuntimes.push(registered);
		}

		const capabilities: IAgentCapabilities = Object.freeze({
			revision: COMET_AGENT_CAPABILITY_REVISION,
			supportsEmptySession: true,
			supportsCreateChat: true,
			maximumChatCount: maximumCometChatCount,
			supportsForkChat: true,
			supportsQueue: false,
			supportsSteering: false,
			supportsCancellation: true,
			supportsReleaseSession: true,
			supportsReleaseChat: true,
			supportsDeleteSession: true,
			supportsDeleteChat: true,
		});
		const descriptor: IAgentDescriptor = Object.freeze({
			id: COMET_AGENT_ID,
			packageId: COMET_AGENT_PACKAGE_ID,
			revision: COMET_AGENT_DESCRIPTOR_REVISION,
			displayName: localize('cometAgent.displayName', 'Comet'),
			description: localize('cometAgent.description', 'Comet\'s built-in general agent'),
			capabilities,
			models: Object.freeze(models),
			requiresAgentAuthentication: configuration.requiresAgentAuthentication,
		});
		return Object.freeze({
			descriptor,
			activeModelCatalog: Object.freeze({
				executionProfileResolver: configuration.executionProfileResolver,
				modelRuntimesById,
			}),
			historicalModelRuntimes: Object.freeze(historicalModelRuntimes),
		});
	}

	private modelRuntimeKey(runtime: string, descriptor: AgentModelDescriptorRevision): string {
		return `${runtime}\u0000${descriptor}`;
	}

	private assertRuntimeRegistration(runtimeRegistration: AgentRuntimeRegistrationRevision): void {
		createAgentRuntimeRegistrationRevision(runtimeRegistration);
		if (runtimeRegistration !== this.registration.revision) {
			invalidValue('configuration.runtimeRegistration', runtimeRegistration);
		}
	}

	private validateSessionConfigurationState(state: IAgentConfigurationState): IAgentConfigurationState {
		const validated = validateAndFreezeAgentConfigurationState(state, {
			agent: COMET_AGENT_ID,
			scope: 'session',
			revision: COMET_SESSION_CONFIGURATION_SCHEMA_REVISION,
		});
		if (encodeAgentHostProtocolValue(validated.schema) !== encodeAgentHostProtocolValue(
			COMET_SESSION_CONFIGURATION_SCHEMA,
		)) {
			invalidValue('configuration.schema', validated.schema.revision);
		}
		return validated;
	}

	private sameSessionConfiguration(
		left: IAgentConfigurationState,
		right: IAgentConfigurationState,
	): boolean {
		return left.revision === right.revision
			&& left.schema.revision === right.schema.revision
			&& encodeAgentHostProtocolValue(left.values) === encodeAgentHostProtocolValue(right.values);
	}

	private async resolveSessionConfiguration(
		request: IAgentResolveSessionConfigurationRequest,
	): Promise<Awaited<ReturnType<IAgentConfiguration['resolveSession']>>> {
		this.assertRuntimeRegistration(request.runtimeRegistration);
		if (request.workspace !== undefined) {
			parseWorkspace(workspaceToProtocolValue(request.workspace));
		}
		const hostDefaults = validateAndFreezeAgentConfigurationState(request.hostDefaults, {
			agent: COMET_AGENT_ID,
			scope: 'hostDefault',
			revision: COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA.revision,
		});
		if (encodeAgentHostProtocolValue(hostDefaults.schema) !== encodeAgentHostProtocolValue(
			COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
		)) {
			invalidValue('configuration.hostDefaults.schema', hostDefaults.schema.revision);
		}
		const candidate = validateAndFreezeAgentConfigurationCandidate(
			COMET_SESSION_CONFIGURATION_SCHEMA,
			request.candidate,
			'session',
		);
		return Object.freeze({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			values: resolveAgentSessionConfigurationValues(
				COMET_SESSION_CONFIGURATION_SCHEMA,
				hostDefaults.values,
				candidate.values,
			),
		});
	}

	private async completeSessionConfiguration(
		request: IAgentSessionConfigurationCompletionRequest,
	): Promise<readonly IAgentConfigurationCompletion[]> {
		await this.resolveSessionConfiguration(request);
		validateAndFreezeAgentConfigurationSchema(request.resolvedSchema, {
			agent: COMET_AGENT_ID,
			scope: 'session',
			revision: COMET_SESSION_CONFIGURATION_SCHEMA_REVISION,
		});
		if (
			typeof request.query !== 'string'
			|| request.query.length > 4_096
			|| !Number.isSafeInteger(request.limit)
			|| request.limit < 1
			|| request.limit > 100
		) {
			invalidValue('configuration.completion', 'invalidRequest');
		}
		return validateAndFreezeAgentConfigurationCompletions(
			COMET_SESSION_CONFIGURATION_SCHEMA,
			request.property,
			Object.freeze([]),
		);
	}

	private async prepareSessionConfigurationUpdate(
		request: IAgentPrepareSessionConfigurationUpdateRequest,
	): Promise<void> {
		const outcome = await this.operations.run(
			'session.configuration.prepare',
			request.session,
			request.operation,
			request.payloadDigest,
			async () => {
				this.assertRuntimeRegistration(request.runtimeRegistration);
				const session = this.requireMaterializedSession(request.session);
				const current = this.validateSessionConfigurationState(request.current);
				const candidate = this.validateSessionConfigurationState(request.candidate);
				const recorded = this.sessionConfigurationTransactions.get(request.operation);
				if (recorded !== undefined) {
					this.assertSessionConfigurationTransaction(
						request.operation,
						request.payloadDigest,
						request.session,
						candidate.revision,
						recorded,
					);
					if (
						recorded.status === 'prepared'
						&& (
							!this.sameSessionConfiguration(recorded.previous, current)
							|| !this.sameSessionConfiguration(recorded.candidate, candidate)
						)
					) {
						invalidValue('configuration.transaction', request.operation);
					}
					return { kind: 'void' };
				}
				if (!this.sameSessionConfiguration(session.configuration, current)) {
					invalidValue('configuration.current', current.revision);
				}
				for (const property of COMET_SESSION_CONFIGURATION_SCHEMA.properties) {
					if (
						encodeAgentHostProtocolValue(current.values[property.id] ?? null)
						!== encodeAgentHostProtocolValue(candidate.values[property.id] ?? null)
						&& !property.sessionMutable
					) {
						invalidValue('configuration.property', property.id);
					}
				}
				this.sessionConfigurationTransactions.set(request.operation, {
					status: 'prepared',
					digest: request.payloadDigest,
					session: request.session,
					previous: current,
					candidate,
				});
				this.operations.pin(request.operation, request.payloadDigest);
				return { kind: 'void' };
			},
		);
		if (outcome.kind !== 'void') {
			invalidValue('configuration.prepare.outcome', outcome.kind);
		}
	}

	private async commitSessionConfigurationUpdate(
		request: IAgentFinalizeSessionConfigurationUpdateRequest,
	): Promise<void> {
		const outcome = await this.operations.run(
			'session.configuration.commit',
			request.session,
			request.operation,
			request.payloadDigest,
			async () => {
				this.assertRuntimeRegistration(request.runtimeRegistration);
				const transaction = this.requireSessionConfigurationTransaction(request);
				if (transaction.status === 'rolledBack') {
					throw new AgentHostError(
						AgentHostErrorCode.OperationNotPending,
						'Comet Session configuration transaction was rolled back',
						{ operation: request.operation },
					);
				}
				if (transaction.status === 'prepared') {
					const session = this.requireSession(request.session);
					if (!this.sameSessionConfiguration(session.configuration, transaction.previous)) {
						invalidValue('configuration.current', session.configuration.revision);
					}
					session.configuration = transaction.candidate;
				}
				this.retainTerminalSessionConfigurationTransaction(request.operation, {
					status: 'committed',
					digest: request.payloadDigest,
					session: request.session,
					configuration: request.configuration,
					decision: 'commit',
				});
				return { kind: 'void' };
			},
		);
		if (outcome.kind !== 'void') {
			invalidValue('configuration.commit.outcome', outcome.kind);
		}
	}

	private async rollbackSessionConfigurationUpdate(
		request: IAgentFinalizeSessionConfigurationUpdateRequest,
	): Promise<void> {
		const outcome = await this.operations.run(
			'session.configuration.rollback',
			request.session,
			request.operation,
			request.payloadDigest,
			async () => {
				this.assertRuntimeRegistration(request.runtimeRegistration);
				createAgentConfigurationStateRevision(request.configuration);
				const recorded = this.sessionConfigurationTransactions.get(request.operation);
				if (recorded === undefined) {
					const session = this.requireSession(request.session);
					if (session.configuration.revision === request.configuration) {
						throw new AgentHostError(
							AgentHostErrorCode.OperationNotPending,
							'Comet Session configuration rollback addresses the active configuration',
							{ operation: request.operation },
						);
					}
					this.retainTerminalSessionConfigurationTransaction(request.operation, {
						status: 'rolledBack',
						digest: request.payloadDigest,
						session: request.session,
						configuration: request.configuration,
						decision: 'rollback',
					});
					this.operations.pin(request.operation, request.payloadDigest);
					return { kind: 'void' };
				}
				const transaction = this.requireSessionConfigurationTransaction(request);
				if (transaction.status === 'committed') {
					throw new AgentHostError(
						AgentHostErrorCode.OperationNotPending,
						'Comet Session configuration transaction was committed',
						{ operation: request.operation },
					);
				}
				if (transaction.status === 'prepared') {
					const session = this.requireSession(request.session);
					if (!this.sameSessionConfiguration(session.configuration, transaction.previous)) {
						invalidValue('configuration.current', session.configuration.revision);
					}
					session.configuration = transaction.previous;
				}
				this.retainTerminalSessionConfigurationTransaction(request.operation, {
					status: 'rolledBack',
					digest: request.payloadDigest,
					session: request.session,
					configuration: request.configuration,
					decision: 'rollback',
				});
				return { kind: 'void' };
			},
		);
		if (outcome.kind !== 'void') {
			invalidValue('configuration.rollback.outcome', outcome.kind);
		}
	}

	private async acknowledgeSessionConfigurationUpdate(
		request: IAgentAcknowledgeSessionConfigurationUpdateRequest,
	): Promise<void> {
		const outcome = await this.operations.run(
			'session.configuration.acknowledge',
			request.session,
			request.operation,
			request.payloadDigest,
			async () => {
				this.assertRuntimeRegistration(request.runtimeRegistration);
				createAgentConfigurationStateRevision(request.configuration);
				if (request.decision !== 'commit' && request.decision !== 'rollback') {
					invalidValue('configuration.acknowledge.decision', request.decision);
				}
				this.requireSession(request.session);
				const transaction = this.sessionConfigurationTransactions.get(request.operation);
				if (transaction === undefined) {
					return { kind: 'void' };
				}
				this.assertSessionConfigurationTransaction(
					request.operation,
					request.payloadDigest,
					request.session,
					request.configuration,
					transaction,
				);
				const terminalStatus = request.decision === 'commit' ? 'committed' : 'rolledBack';
				if (transaction.status !== terminalStatus) {
					throw new AgentHostError(
						AgentHostErrorCode.OperationNotPending,
						'Comet Session configuration acknowledgement does not match the terminal decision',
						{ operation: request.operation },
					);
				}
				this.sessionConfigurationTransactions.delete(request.operation);
				this.operations.unpin(request.operation, request.payloadDigest);
				return { kind: 'void' };
			},
		);
		if (outcome.kind !== 'void') {
			invalidValue('configuration.acknowledge.outcome', outcome.kind);
		}
	}

	private requireSessionConfigurationTransaction(
		request: IAgentFinalizeSessionConfigurationUpdateRequest,
	): ICometSessionConfigurationTransaction {
		createAgentConfigurationStateRevision(request.configuration);
		const transaction = this.sessionConfigurationTransactions.get(request.operation);
		if (transaction === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Comet Session configuration transaction is not pending',
				{ operation: request.operation },
			);
		}
		this.assertSessionConfigurationTransaction(
			request.operation,
			request.payloadDigest,
			request.session,
			request.configuration,
			transaction,
		);
		return transaction;
	}

	private assertSessionConfigurationTransaction(
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
		session: AgentSessionId,
		configuration: AgentConfigurationStateRevision,
		transaction: ICometSessionConfigurationTransaction,
	): void {
		if (transaction.digest !== digest) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationDigestConflict,
				'Comet Session configuration operation is already bound to another payload',
				{ operation, recordedDigest: transaction.digest, receivedDigest: digest },
			);
		}
		const recordedConfiguration = transaction.status === 'prepared'
			? transaction.candidate.revision
			: transaction.configuration;
		if (transaction.session !== session || recordedConfiguration !== configuration) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Comet Session configuration transaction is not pending',
				{ operation },
			);
		}
	}

	private retainTerminalSessionConfigurationTransaction(
		operation: AgentHostOperationId,
		transaction: ICometTerminalSessionConfigurationTransaction,
	): void {
		this.sessionConfigurationTransactions.delete(operation);
		this.sessionConfigurationTransactions.set(operation, transaction);
	}

	private async resolveExecutionProfile(request: IAgentExecutionProfileRequest): Promise<IAgentExecutionProfile> {
		createAgentSubmissionId(request.submission);
		createAgentHostPayloadDigest(request.selectionDigest);
		createAgentRuntimeRegistrationRevision(request.runtimeRegistration);
		if (request.runtimeRegistration !== this.registration.revision) {
			invalidValue('executionProfile.runtimeRegistration', request.runtimeRegistration);
		}
		assertAgentHostProtocolValue(request.selection);
		const actualSelectionDigest = await computeAgentHostPayloadDigest(request.selection);
		if (actualSelectionDigest !== request.selectionDigest) {
			invalidValue('executionProfile.selectionDigest', request.selectionDigest);
		}

		const existing = this.profileResolutions.get(request.submission);
		if (existing !== undefined) {
			if (
				existing.selectionDigest !== request.selectionDigest
				|| existing.runtimeRegistration !== request.runtimeRegistration
			) {
				throw new AgentHostError(
					AgentHostErrorCode.OperationDigestConflict,
					'Comet submission is already bound to another execution selection',
					{
						operation: request.submission,
						recordedDigest: existing.selectionDigest,
						receivedDigest: request.selectionDigest,
					},
				);
			}
			return existing.profile;
		}

		const profile = this.resolveNewExecutionProfile(request);
		this.profileResolutions.set(request.submission, {
			selectionDigest: request.selectionDigest,
			runtimeRegistration: request.runtimeRegistration,
			profile,
		});
		return profile;
	}

	private async resolveNewExecutionProfile(request: IAgentExecutionProfileRequest): Promise<IAgentExecutionProfile> {
		this.validateSessionConfigurationState(request.sessionConfiguration);
		const catalog = this.activeModelCatalog;
		const resolution = await catalog.executionProfileResolver.resolve(request);
		const model = catalog.modelRuntimesById.get(resolution.modelRuntime);
		if (model === undefined) {
			return resourceMissing('modelRuntime', resolution.modelRuntime);
		}
		if (!model.descriptor.enabled) {
			return unsupportedCapability(`model:${model.descriptor.id}`);
		}
		validateAndFreezeAgentConfigurationCandidate(
			model.descriptor.configurationSchema,
			request.selection.configuration,
			'model',
			true,
		);
		return createExecutionProfile(resolution, model, this.registration.revision);
	}

	private async validateExecutionProfile(
		profile: IAgentExecutionProfile,
	): Promise<{ readonly data: ICometExecutionProfileData; readonly model: ICometRegisteredModelRuntime }> {
		createAgentExecutionProfileRevision(profile.revision);
		createAgentExecutionProfileDigest(profile.digest);
		createAgentDescriptorRevision(profile.agentDescriptor);
		createAgentModelDescriptorRevision(profile.modelDescriptor);
		if (profile.agentDescriptor !== COMET_AGENT_DESCRIPTOR_REVISION) {
			invalidValue('profile.agentDescriptor', profile.agentDescriptor);
		}
		const data = parseExecutionProfileData(profile.data);
		const model = this.historicalModelRuntimes.get(this.modelRuntimeKey(data.modelRuntime, profile.modelDescriptor));
		if (model === undefined) {
			return resourceMissing('modelRuntime', data.modelRuntime);
		}
		const digest = await computeExecutionProfileDigest(
			profile.data,
			profile.modelDescriptor,
			this.registration.revision,
		);
		if (digest !== profile.digest || expectedExecutionProfileRevision(digest) !== profile.revision) {
			invalidValue('profile.digest', profile.digest);
		}
		return { data, model };
	}

	private async createSession(options: IAgentCreateSessionOptions): Promise<IAgentSessionBacking> {
		const outcome = await this.operations.run('session.create', options.session, options.operation, options.payloadDigest, async () => {
			createAgentSessionId(options.session);
			if (this.sessionRecords.has(options.session)) {
				invalidValue('session.create.session', options.session);
			}
			const record: ICometSessionRecord = {
				id: options.session,
				workspace: parseWorkspace(workspaceToProtocolValue(options.workspace)),
				configuration: this.validateSessionConfigurationState(options.configuration),
				materialized: true,
				chats: new Map(),
			};
			this.sessionRecords.set(options.session, record);
			return {
				kind: 'sessionBacking',
				backing: { session: options.session, resume: createSessionResume(record) },
			};
		});
		if (outcome.kind !== 'sessionBacking') {
			return invalidValue('session.create.outcome', outcome.kind);
		}
		return outcome.backing;
	}

	private async materializeSession(request: IAgentMaterializeSessionRequest): Promise<void> {
		const outcome = await this.operations.run('session.materialize', request.session, request.operation, request.payloadDigest, async () => {
			const configuration = this.validateSessionConfigurationState(request.configuration);
			const existing = this.sessionRecords.get(request.session);
			if (existing !== undefined) {
				if (existing.materialized) {
					invalidValue('session.materialize.state', 'materialized');
				}
				if (request.resume === undefined) {
					return resourceMissing('sessionResume', request.session);
				}
				parseSessionResume(request.resume, request.session, configuration);
				if (createSessionResume(existing).data !== request.resume.data) {
					invalidValue('session.materialize.resume', 'conflict');
				}
				existing.configuration = configuration;
				existing.materialized = true;
				return { kind: 'void' };
			}
			if (request.resume === undefined) {
				return resourceMissing('sessionResume', request.session);
			}
			this.sessionRecords.set(
				request.session,
				parseSessionResume(request.resume, request.session, configuration),
			);
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('session.materialize.outcome', outcome.kind);
		}
	}

	private async releaseSession(request: IAgentReleaseSessionRequest): Promise<void> {
		const outcome = await this.operations.run('session.release', request.session, request.operation, request.payloadDigest, async () => {
			const session = this.requireMaterializedSession(request.session);
			for (const chat of session.chats.values()) {
				if (chat.activeTurn !== undefined) {
					throw new AgentHostError(
						AgentHostErrorCode.OperationNotPending,
						'Comet Session has an active Turn',
						{ operation: request.operation },
					);
				}
			}
			for (const chat of session.chats.values()) {
				chat.materialized = false;
			}
			session.materialized = false;
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('session.release.outcome', outcome.kind);
		}
	}

	private async deleteSession(request: IAgentDeleteSessionRequest): Promise<void> {
		const outcome = await this.operations.run('session.delete', request.session, request.operation, request.payloadDigest, async () => {
			const session = this.requireSession(request.session);
			for (const chat of session.chats.values()) {
				if (chat.activeTurn !== undefined) {
					throw new AgentHostError(
						AgentHostErrorCode.OperationNotPending,
						'Comet Session has an active Turn',
						{ operation: request.operation },
					);
				}
			}
			this.sessionRecords.delete(session.id);
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('session.delete.outcome', outcome.kind);
		}
	}

	private async createChat(options: IAgentCreateChatOptions): Promise<IAgentChatBacking> {
		const outcome = await this.operations.run('chat.create', `${options.session}\u0000${options.chat}`, options.operation, options.payloadDigest, async () => {
			const session = this.requireMaterializedSession(options.session);
			const chat = this.createChatRecord(session, options.chat, options.origin);
			return {
				kind: 'chatBacking',
				backing: { session: options.session, chat: options.chat, resume: createChatResume(options.session, chat) },
			};
		});
		if (outcome.kind !== 'chatBacking') {
			return invalidValue('chat.create.outcome', outcome.kind);
		}
		return outcome.backing;
	}

	private createChatRecord(
		session: ICometSessionRecord,
		chatId: AgentChatId,
		origin: AgentChatOrigin,
	): ICometChatRecord {
		createAgentChatId(chatId);
		parseOrigin(originToProtocolValue(origin));
		if (session.chats.has(chatId) || session.chats.size >= maximumCometChatCount) {
			invalidValue('chat.create.chat', chatId);
		}
		let messages: CometModelMessage[] = [];
		let checkpoint: AgentHostProtocolValue | undefined;
		if (origin.kind === 'fork') {
			const source = this.requireMaterializedChat(session, origin.parentChat);
			const sourceTurn = source.turns.get(origin.parentTurn);
			if (sourceTurn === undefined) {
				return resourceMissing('turn', origin.parentTurn);
			}
			messages = source.messages.slice(0, sourceTurn.messageLength);
			checkpoint = sourceTurn.checkpoint;
		} else if (origin.kind === 'tool') {
			const parent = this.requireMaterializedChat(session, origin.parentChat);
			if (!parent.turns.has(origin.parentTurn)) {
				return resourceMissing('turn', origin.parentTurn);
			}
		}
		const record: ICometChatRecord = {
			id: chatId,
			origin,
			materialized: true,
			messages,
			baseMessageLength: messages.length,
			checkpoint,
			usage: [],
			turns: new Map(),
		};
		session.chats.set(chatId, record);
		return record;
	}

	private async materializeChat(request: IAgentMaterializeChatRequest): Promise<void> {
		const outcome = await this.operations.run('chat.materialize', `${request.session}\u0000${request.chat}`, request.operation, request.payloadDigest, async () => {
			const session = this.requireMaterializedSession(request.session);
			const existing = session.chats.get(request.chat);
			if (existing !== undefined) {
				if (existing.materialized) {
					invalidValue('chat.materialize.state', 'materialized');
				}
				if (request.resume === undefined) {
					return resourceMissing('chatResume', request.chat);
				}
				parseChatResume(request.resume, request.session, request.chat);
				if (createChatResume(request.session, existing).data !== request.resume.data) {
					invalidValue('chat.materialize.resume', 'conflict');
				}
				existing.materialized = true;
				return { kind: 'void' };
			}
			if (request.resume === undefined) {
				return resourceMissing('chatResume', request.chat);
			}
			session.chats.set(request.chat, parseChatResume(request.resume, request.session, request.chat));
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('chat.materialize.outcome', outcome.kind);
		}
	}

	private async releaseChat(request: IAgentReleaseChatRequest): Promise<void> {
		const outcome = await this.operations.run('chat.release', `${request.session}\u0000${request.chat}`, request.operation, request.payloadDigest, async () => {
			const session = this.requireMaterializedSession(request.session);
			const chat = this.requireMaterializedChat(session, request.chat);
			if (chat.activeTurn !== undefined) {
				throw new AgentHostError(
					AgentHostErrorCode.OperationNotPending,
					'Comet Chat has an active Turn',
					{ operation: request.operation },
				);
			}
			chat.materialized = false;
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('chat.release.outcome', outcome.kind);
		}
	}

	private async forkChat(request: IAgentForkChatRequest): Promise<IAgentChatBacking> {
		const outcome = await this.operations.run('chat.fork', `${request.session}\u0000${request.chat}`, request.operation, request.payloadDigest, async () => {
			const session = this.requireMaterializedSession(request.session);
			const chat = this.createChatRecord(session, request.chat, {
				kind: 'fork',
				parentChat: request.source.chat,
				parentTurn: request.source.turn,
			});
			return {
				kind: 'chatBacking',
				backing: { session: request.session, chat: request.chat, resume: createChatResume(request.session, chat) },
			};
		});
		if (outcome.kind !== 'chatBacking') {
			return invalidValue('chat.fork.outcome', outcome.kind);
		}
		return outcome.backing;
	}

	private async deleteChat(request: IAgentDeleteChatRequest): Promise<void> {
		const outcome = await this.operations.run('chat.delete', `${request.session}\u0000${request.chat}`, request.operation, request.payloadDigest, async () => {
			const session = this.requireSession(request.session);
			const chat = this.requireChat(session, request.chat);
			if (chat.activeTurn !== undefined) {
				throw new AgentHostError(
					AgentHostErrorCode.OperationNotPending,
					'Comet Chat has an active Turn',
					{ operation: request.operation },
				);
			}
			session.chats.delete(request.chat);
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('chat.delete.outcome', outcome.kind);
		}
	}

	private async sendChatRequest(request: IAgentChatRequest): Promise<void> {
		const outcome = await this.operations.run('chat.send', `${request.session}\u0000${request.chat}\u0000${request.turn}`, request.operation, request.payloadDigest, async () => {
			createAgentTurnId(request.turn);
			createAgentSubmissionId(request.submission);
			if (typeof request.message !== 'string' || new TextEncoder().encode(request.message).byteLength > maximumCometResponseBytes) {
				invalidValue('chat.send.message', request.message);
			}
			const session = this.requireMaterializedSession(request.session);
			const chat = this.requireMaterializedChat(session, request.chat);
			if (chat.activeTurn !== undefined) {
				throw new AgentHostError(
					AgentHostErrorCode.OperationNotPending,
					'Comet Chat already has an active Turn',
					{ operation: request.operation },
				);
			}
			if (chat.turns.has(request.turn)) {
				invalidValue('chat.send.turn', request.turn);
			}

			const cancellation = new CancellationTokenSource();
			const completion = new DeferredPromise<void>();
			const activeTurn: ICometActiveTurn = {
				turn: request.turn,
				cancellation,
				completion,
				toolCalls: new Set(),
			};
			chat.activeTurn = activeTurn;
			try {
				await this.runTurn(session, chat, activeTurn, request);
			} finally {
				if (chat.activeTurn === activeTurn) {
					chat.activeTurn = undefined;
				}
				cancellation.dispose();
				completion.complete();
			}
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('chat.send.outcome', outcome.kind);
		}
	}

	private async runTurn(
		session: ICometSessionRecord,
		chat: ICometChatRecord,
		activeTurn: ICometActiveTurn,
		request: IAgentChatRequest,
	): Promise<void> {
		this.emitTurnProgress(request, { kind: 'state', state: 'running' });
		let terminalState: Extract<IAgentAction, { kind: 'turnTerminal' }>['state'] = 'failed';
		let terminalData: AgentHostProtocolValue | undefined;
		let preparedAttachments: CometPreparedAttachments | undefined;
		let userMessageAdded = false;
		try {
			const validated = await this.validateTurnBinding(request, session.configuration);
			if (request.binding.resume !== undefined) {
				const restored = parseChatResume(request.binding.resume, request.session, request.chat);
				if (createChatResume(request.session, chat).data !== request.binding.resume.data) {
					invalidValue('turn.binding.resume', 'conflict');
				}
				chat.checkpoint = restored.checkpoint;
			}
			chat.messages.push({ role: 'user', turn: request.turn, text: request.message });
			userMessageAdded = true;
			preparedAttachments = await prepareCometModelAttachments(
				request.attachments,
				validated.model.descriptor.attachments,
				{ session: request.session, chat: request.chat, turn: request.turn },
				this.contentResources,
				activeTurn.cancellation.token,
			);
			await this.executeTurn(
				session,
				chat,
				activeTurn,
				request,
				validated.data,
				validated.model,
				preparedAttachments,
			);
			terminalState = 'completed';
		} catch (error) {
			if (activeTurn.cancellation.token.isCancellationRequested || isCancellationError(error) || (error instanceof CometTurnError && error.code === 'cancelled')) {
				terminalState = 'cancelled';
				terminalData = { code: 'cancelled' };
			} else {
				terminalState = 'failed';
				terminalData = failureData(error);
			}
		}
		if (!userMessageAdded) {
			chat.messages.push({ role: 'user', turn: request.turn, text: request.message });
		}

		if (preparedAttachments !== undefined) {
			try {
				await preparedAttachments.release();
			} catch (error) {
				if (terminalState === 'cancelled') {
					terminalData = { code: 'cancelled', cleanupFailure: failureData(error) };
				} else {
					terminalState = 'failed';
					terminalData = { code: 'contentCleanupFailed', failure: failureData(error) };
				}
			}
		}

		chat.turns.set(request.turn, {
			messageLength: chat.messages.length,
			checkpoint: chat.checkpoint,
		});
		try {
			this.actionEmitter.fire({
				kind: 'chatResumeStateChanged',
				session: request.session,
				chat: request.chat,
				resume: createChatResume(request.session, chat),
			});
		} catch (error) {
			terminalState = 'failed';
			terminalData = { code: 'resumeStateFailed', failure: failureData(error) };
		}
		try {
			this.actionEmitter.fire({
				kind: 'turnTerminal',
				session: request.session,
				chat: request.chat,
				turn: request.turn,
				state: terminalState,
				...(terminalData === undefined ? {} : { data: terminalData }),
			});
		} finally {
			for (const call of activeTurn.toolCalls) {
				this.toolExecution.release(call);
			}
			activeTurn.toolCalls.clear();
		}
	}

	private async validateTurnBinding(
		request: IAgentChatRequest,
		sessionConfiguration: IAgentConfigurationState,
	): Promise<{ readonly data: ICometExecutionProfileData; readonly model: ICometRegisteredModelRuntime }> {
		createAgentCancellationId(request.binding.cancellation);
		if (request.binding.runtimeRegistration !== this.registration.revision) {
			invalidValue('turn.binding.runtimeRegistration', request.binding.runtimeRegistration);
		}
		if (!Number.isFinite(request.binding.deadline) || request.binding.deadline <= 0) {
			invalidValue('turn.binding.deadline', request.binding.deadline);
		}
		assertAgentHostProtocolValue(request.binding.outputConstraints);
		const validated = await this.validateExecutionProfile(request.binding.profile);
		const resolvedProfile = this.profileResolutions.get(request.submission);
		if (resolvedProfile !== undefined) {
			const exactProfile = await resolvedProfile.profile;
			if (
				exactProfile.revision !== request.binding.profile.revision
				|| exactProfile.digest !== request.binding.profile.digest
				|| exactProfile.agentDescriptor !== request.binding.profile.agentDescriptor
				|| exactProfile.modelDescriptor !== request.binding.profile.modelDescriptor
				|| exactProfile.data !== request.binding.profile.data
			) {
				invalidValue('turn.binding.profile', request.binding.profile.revision);
			}
		}
		const modelConfiguration = resolveAgentModelConfigurationCandidate(
			validated.model.descriptor.configurationSchema,
			request.binding.modelConfiguration,
		);
		if (encodeAgentHostProtocolValue(modelConfiguration) !== encodeAgentHostProtocolValue(
			request.binding.modelConfiguration,
		)) {
			invalidValue('turn.binding.modelConfiguration', modelConfiguration.schema);
		}
		if (!Array.isArray(request.binding.credentials)) {
			invalidValue('turn.binding.credentials', request.binding.credentials);
		}
		const expectedCredentials = new Set([
			...collectAgentConfigurationCredentialReferences(
				sessionConfiguration.schema,
				sessionConfiguration.values,
				'session',
			),
			...collectAgentConfigurationCredentialReferences(
				validated.model.descriptor.configurationSchema,
				modelConfiguration.values,
				'model',
			),
		].map(binding => encodeAgentHostProtocolValue(binding.credential)));
		const receivedCredentials = new Set<string>();
		for (const credential of request.binding.credentials) {
			const encoded = encodeAgentHostProtocolValue(validateAndFreezeAgentCredentialReference(credential));
			if (receivedCredentials.has(encoded)) {
				invalidValue('turn.binding.credentials', 'duplicate');
			}
			receivedCredentials.add(encoded);
		}
		if (
			receivedCredentials.size !== expectedCredentials.size
			|| [...receivedCredentials].some(credential => !expectedCredentials.has(credential))
		) {
			invalidValue('turn.binding.credentials', 'mismatch');
		}
		this.validateToolSet(request.binding.toolSet, validated.model.descriptor);
		this.validateInteractionTargets(request.interactionTargets);
		return validated;
	}

	private validateToolSet(toolSet: IAgentToolSet, model: IAgentModelDescriptor): void {
		createAgentToolSetRevision(toolSet.revision);
		createAgentToolSchemaProfileId(toolSet.schemaProfile);
		createAgentRuntimeRegistrationRevision(toolSet.runtimeRegistration);
		createAgentDescriptorRevision(toolSet.agentDescriptor);
		createAgentModelDescriptorRevision(toolSet.modelDescriptor);
		if (
			toolSet.runtimeRegistration !== this.registration.revision
			|| toolSet.agentDescriptor !== COMET_AGENT_DESCRIPTOR_REVISION
			|| toolSet.modelDescriptor !== model.revision
			|| !model.toolSchemaProfiles.includes(toolSet.schemaProfile)
		) {
			invalidValue('turn.binding.toolSet', toolSet.revision);
		}
		const registrationIds = new Set<string>();
		const toolIds = new Set<string>();
		const functionNames = new Set<string>();
		for (const [index, registration] of toolSet.registrations.entries()) {
			createAgentToolRegistrationId(registration.id);
			createAgentToolRegistrationRevision(registration.revision);
			createAgentToolId(registration.descriptor.id);
			createAgentToolDescriptorRevision(registration.descriptor.revision);
			if (
				registrationIds.has(registration.id)
				|| toolIds.has(registration.descriptor.id)
				|| functionNames.has(registration.descriptor.functionName)
				|| registration.descriptor.inputSchema.profile !== toolSet.schemaProfile
				|| registration.descriptor.outputSchema.profile !== toolSet.schemaProfile
			) {
				invalidValue(`turn.binding.toolSet.registrations.${index}`, registration.id);
			}
			assertAgentHostProtocolValue(registration.descriptor.inputSchema.value);
			assertAgentHostProtocolValue(registration.descriptor.outputSchema.value);
			registrationIds.add(registration.id);
			toolIds.add(registration.descriptor.id);
			functionNames.add(registration.descriptor.functionName);
		}
	}

	private validateInteractionTargets(targets: readonly IAgentHostInteractionTarget[]): void {
		const ids = new Set<string>();
		for (const [index, target] of targets.entries()) {
			assertAgentHostInteractionTarget(target);
			if (ids.has(target.id)) {
				invalidValue(`turn.interactionTargets.${index}.id`, target.id);
			}
			ids.add(target.id);
		}
	}

	private async executeTurn(
		session: ICometSessionRecord,
		chat: ICometChatRecord,
		activeTurn: ICometActiveTurn,
		request: IAgentChatRequest,
		profileData: ICometExecutionProfileData,
		model: ICometRegisteredModelRuntime,
		preparedAttachments: CometPreparedAttachments,
	): Promise<void> {
		let responseBytes = 0;
		for (let step = 0; step < profileData.maximumSteps; step += 1) {
			throwIfCancelled(activeTurn.cancellation.token);
			const result = await model.runtime.executeStep({
				profile: request.binding.profile,
				modelConfiguration: request.binding.modelConfiguration,
				credentials: request.binding.credentials,
				runtimeRegistration: request.binding.runtimeRegistration,
				settings: profileData.settings,
				systemPrompt: cometSystemPrompt,
				session: request.session,
				chat: request.chat,
				turn: request.turn,
				workspace: session.workspace,
				step,
				messages: chat.messages,
				attachments: preparedAttachments.attachments,
				interactionTargets: request.interactionTargets,
				toolSet: request.binding.toolSet,
				deadline: request.binding.deadline,
				outputConstraints: request.binding.outputConstraints,
				checkpoint: chat.checkpoint,
			}, activeTurn.cancellation.token);
			throwIfCancelled(activeTurn.cancellation.token);
			validateModelStepResult(result);

			const calls: CometModelToolCall[] = [];
			for (const [partIndex, part] of result.parts.entries()) {
				if (part.kind === 'reasoning' || part.kind === 'text') {
					if (typeof part.text !== 'string') {
						invalidValue(`modelResult.parts.${partIndex}.text`, part.text);
					}
					responseBytes += new TextEncoder().encode(part.text).byteLength;
					if (responseBytes > maximumCometResponseBytes) {
						throw new CometTurnError('responseLimitExceeded', 'Comet response exceeded its byte limit');
					}
					this.emitTurnProgress(request, {
						kind: 'behavior',
						behavior: { kind: part.kind, text: part.text },
					});
				} else if (part.kind === 'toolCall') {
					calls.push(part.call);
				} else {
					invalidValue(`modelResult.parts.${partIndex}.kind`, (part as { readonly kind?: unknown }).kind);
				}
			}

			if (
				(result.stopReason === 'completed' && calls.length !== 0)
				|| (result.stopReason === 'toolCalls' && calls.length === 0)
			) {
				invalidValue('modelResult.stopReason', result.stopReason);
			}
			chat.messages.push({ role: 'assistant', turn: request.turn, parts: result.parts });
			if (result.checkpoint !== undefined) {
				chat.checkpoint = result.checkpoint;
			}
			if (result.usage !== undefined) {
				if (chat.usage.length >= maximumCometTurnsInResume) {
					throw new CometTurnError('usageLimitExceeded', 'Comet usage history exceeded its entry limit');
				}
				chat.usage.push(result.usage);
			}
			if (result.stopReason === 'completed') {
				return;
			}

			for (const call of calls) {
				throwIfCancelled(activeTurn.cancellation.token);
				createAgentToolCallId(call.id);
				if (activeTurn.toolCalls.has(call.id)) {
					invalidValue('modelResult.toolCall.id', call.id);
				}
				activeTurn.toolCalls.add(call.id);
				const toolResult = await this.executeToolCall(request, activeTurn, call);
				chat.messages.push({ role: 'tool', turn: request.turn, result: toolResult });
			}
		}
		throw new CometTurnError('stepBudgetExhausted', 'Comet exhausted the exact model-step budget');
	}

	private async executeToolCall(
		request: IAgentChatRequest,
		activeTurn: ICometActiveTurn,
		modelCall: CometModelToolCall,
	): Promise<AgentToolResult> {
		assertAgentHostProtocolValue(modelCall.input);
		const registration = request.binding.toolSet.registrations.find(candidate => candidate.id === modelCall.registrationId);
		if (registration === undefined) {
			return resourceMissing('toolRegistration', modelCall.registrationId);
		}
		this.validateModelToolCall(request, modelCall, registration);

		const callPayload = {
			id: modelCall.id,
			agent: COMET_AGENT_ID,
			registration: this.registration.revision,
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			toolSet: request.binding.toolSet.revision,
			tool: registration.descriptor.id,
			descriptor: registration.descriptor.revision,
			registrationId: registration.id,
			registrationRevision: registration.revision,
			input: modelCall.input,
			...(modelCall.target === undefined ? {} : { target: modelCall.target }),
			deadline: request.binding.deadline,
		};
		const call: IAgentToolCall = modelCall.effect.kind === 'read'
			? Object.freeze({ ...callPayload, effect: Object.freeze({ kind: 'read' as const }) })
			: Object.freeze({
				...callPayload,
				effect: Object.freeze({
					kind: 'mutation' as const,
					operation: modelCall.effect.operation,
					payloadDigest: await computeAgentToolMutationPayloadDigest({
						...callPayload,
						effect: Object.freeze({ kind: 'mutation' as const, operation: modelCall.effect.operation }),
					}),
				}),
			});
		this.emitTurnProgress(request, {
			kind: 'behavior',
			behavior: {
				kind: 'contributedToolCall',
				call: call.id,
				tool: call.tool,
				input: call.input,
			},
		});

		activeTurn.currentToolCall = call.id;
		let acceptingProgress = true;
		let progressSequence = 0;
		try {
			const result = await this.toolExecution.execute(call, progress => {
				if (!acceptingProgress || progress.call !== call.id || progress.sequence !== progressSequence + 1) {
					invalidValue('tool.progress', progress.sequence);
				}
				assertAgentHostProtocolValue(progress.data);
				progressSequence = progress.sequence;
			});
			acceptingProgress = false;
			if (result.call !== call.id) {
				invalidValue('tool.result.call', result.call);
			}
			if (result.status === 'completed') {
				assertAgentHostProtocolValue(result.output);
				this.emitTurnProgress(request, {
					kind: 'behavior',
					behavior: {
						kind: 'contributedToolResult',
						call: result.call,
						status: 'completed',
						output: result.output,
					},
				});
			} else {
				if (result.failure.data !== undefined) {
					assertAgentHostProtocolValue(result.failure.data);
				}
				this.emitTurnProgress(request, {
					kind: 'behavior',
					behavior: {
						kind: 'contributedToolResult',
						call: result.call,
						status: result.status,
						output: {
							code: result.failure.code,
							message: result.failure.message.slice(0, 2_048),
							...(result.failure.data === undefined ? {} : { data: result.failure.data }),
						},
					},
				});
			}
			return result;
		} finally {
			acceptingProgress = false;
			if (activeTurn.currentToolCall === call.id) {
				activeTurn.currentToolCall = undefined;
			}
		}
	}

	private validateModelToolCall(
		request: IAgentChatRequest,
		call: CometModelToolCall,
		registration: IAgentToolRegistration,
	): void {
		createAgentToolRegistrationId(call.registrationId);
		if (call.target !== undefined) {
			createAgentInteractionTargetId(call.target);
		}
		if (registration.descriptor.safety === 'read') {
			if (call.effect.kind !== 'read') {
				invalidValue('tool.call.effect', call.effect.kind);
			}
		} else if (call.effect.kind !== 'mutation') {
			invalidValue('tool.call.effect', call.effect.kind);
		} else {
			createAgentHostOperationId(call.effect.operation);
			createAgentHostPayloadDigest(call.effect.payloadDigest);
		}

		if (registration.descriptor.targetTypes.length === 0) {
			if (call.target !== undefined) {
				invalidValue('tool.call.target', call.target);
			}
			return;
		}
		if (call.target === undefined) {
			invalidValue('tool.call.target', 'missing');
		}
		const target = request.interactionTargets.find(candidate => candidate.id === call.target);
		if (target === undefined || !registration.descriptor.targetTypes.includes(target.type)) {
			invalidValue('tool.call.target', call.target);
		}
	}

	private emitTurnProgress(request: IAgentChatRequest, progress: AgentTurnProgress): void {
		assertAgentHostProtocolValue(progress);
		this.actionEmitter.fire({
			kind: 'turnProgress',
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			progress,
		});
	}

	private async steerChat(request: IAgentSteerRequest): Promise<void> {
		const outcome = await this.operations.run('chat.steer', `${request.session}\u0000${request.chat}\u0000${request.turn}`, request.operation, request.payloadDigest, async () => {
			unsupportedCapability('steering');
		});
		if (outcome.kind !== 'void') {
			invalidValue('chat.steer.outcome', outcome.kind);
		}
	}

	private async cancelChatTurn(request: IAgentCancelTurnRequest): Promise<void> {
		const outcome = await this.operations.run('chat.cancel', `${request.session}\u0000${request.chat}\u0000${request.turn}`, request.operation, request.payloadDigest, async () => {
			createAgentTurnId(request.turn);
			const session = this.requireMaterializedSession(request.session);
			const chat = this.requireMaterializedChat(session, request.chat);
			const activeTurn = chat.activeTurn;
			if (activeTurn === undefined || activeTurn.turn !== request.turn) {
				throw new AgentHostError(
					AgentHostErrorCode.OperationNotPending,
					'The addressed Comet Turn is not active',
					{ operation: request.operation },
				);
			}
			this.actionEmitter.fire({
				kind: 'turnProgress',
				session: request.session,
				chat: request.chat,
				turn: request.turn,
					progress: { kind: 'state', state: 'cancelling' },
			});
			activeTurn.cancellation.cancel();
			if (activeTurn.currentToolCall !== undefined) {
				await this.toolExecution.cancel(activeTurn.currentToolCall);
			}
			await activeTurn.completion.p;
			return { kind: 'void' };
		});
		if (outcome.kind !== 'void') {
			invalidValue('chat.cancel.outcome', outcome.kind);
		}
	}

	private async migrateResumeState(_request: IAgentResumeMigrationRequest): Promise<IAgentResumeState> {
		return unsupportedCapability('resumeStateMigration');
	}

	private requireSession(sessionId: AgentSessionId): ICometSessionRecord {
		createAgentSessionId(sessionId);
		return this.sessionRecords.get(sessionId) ?? resourceMissing('session', sessionId);
	}

	private requireMaterializedSession(sessionId: AgentSessionId): ICometSessionRecord {
		const session = this.requireSession(sessionId);
		if (!session.materialized) {
			return resourceMissing('materializedSession', sessionId);
		}
		return session;
	}

	private requireChat(session: ICometSessionRecord, chatId: AgentChatId): ICometChatRecord {
		createAgentChatId(chatId);
		return session.chats.get(chatId) ?? resourceMissing('chat', chatId);
	}

	private requireMaterializedChat(session: ICometSessionRecord, chatId: AgentChatId): ICometChatRecord {
		const chat = this.requireChat(session, chatId);
		if (!chat.materialized) {
			return resourceMissing('materializedChat', chatId);
		}
		return chat;
	}

	override dispose(): void {
		for (const session of this.sessionRecords.values()) {
			for (const chat of session.chats.values()) {
				chat.activeTurn?.cancellation.cancel();
				chat.activeTurn?.cancellation.dispose();
			}
		}
		super.dispose();
	}
}
