/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationToken, CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import { isCancellationError, onUnexpectedError } from 'cs/base/common/errors';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { IObservable, observableValue } from 'cs/base/common/observable';
import type {
	AgentChatOrigin,
	AgentTurnProgress,
	AgentTurnResponsePart,
	IAgent,
	IAgentAction,
	IAgentCancelTurnRequest,
	IAgentChatBacking,
	IAgentChatRequest,
	IAgentChats,
	IAgentCreateChatOptions,
	IAgentCreateSessionOptions,
	IAgentDeleteChatRequest,
	IAgentDeleteSessionRequest,
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentExecutionProfileRequest,
	IAgentExecutionProfiles,
	IAgentForkChatRequest,
	IAgentMaterializeChatRequest,
	IAgentMaterializeSessionRequest,
	IAgentModelDescriptor,
	IAgentReleaseChatRequest,
	IAgentReleaseSessionRequest,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentResumeStates,
	IAgentRuntimeRegistration,
	IAgentSessionBacking,
	IAgentSessions,
	IAgentSteerRequest,
} from 'cs/platform/agentHost/common/agent';
import { assertAgentHostAttachment, assertAgentHostInteractionTarget, type IAgentHostContentReference } from 'cs/platform/agentHost/common/attachments';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import {
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResult,
	assertAgentContentBlobReadResultShape,
	assertAgentContentMaterialization,
	assertAgentContentMaterializeRequest,
	assertAgentContentResourceLease,
	assertAgentContentResourceOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources';
import type {
	AgentRuntimeHostOperationValue,
	AgentRuntimeConnectionState,
	IAgentRuntimeAgentRegistration,
	IAgentRuntimeAction,
	IAgentRuntimeCall,
	IAgentRuntimeConnection,
	IAgentRuntimeHostOperationProgress,
	IAgentRuntimeHostOperationRequest,
	IAgentRuntimeHostOperationResponse,
	IAgentRuntimeInitializeRequest,
	IAgentRuntimeResponse,
	IAgentRuntimeTransportLimits,
} from 'cs/platform/agentHost/common/connections';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentChatId,
	AgentContentLeaseId,
	AgentContentMaterializationId,
	AgentHostOperationId,
	AgentId,
	AgentPackageId,
	AgentPackageRevision,
	AgentRuntimeCallId,
	AgentToolCallId,
	AgentRuntimeHostOperationId,
	AgentRuntimeProtocolVersion,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentTurnId,
	createAgentCapabilityRevision,
	createAgentCancellationId,
	createAgentChatId,
	createAgentContentLeaseId,
	createAgentContentMaterializationId,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentPackageRevision,
	createAgentResumeSchemaId,
	createAgentResumeStateDigest,
	createAgentRuntimeActionSequence,
	createAgentRuntimeCallId,
	createAgentRuntimeHostOperationId,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeProtocolVersion,
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
import { assertAgentHostProtocolValue, encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentToolCall, IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import {
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from 'cs/platform/agentHost/common/tools';

const maximumConnectedAgentCount = 256;
const maximumDescriptorModelCount = 256;
const maximumRetainedHostOperationCount = 4_096;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** Options authorized by one installed package or bundled composition. */
export interface IConnectedAgentRuntimeOptions {
	readonly connection: IAgentRuntimeConnection;
	readonly toolExecution: IAgentToolExecutionPort;
	readonly contentResources: IAgentContentResourcePort;
	readonly protocolVersions: readonly AgentRuntimeProtocolVersion[];
	readonly transportLimits: IAgentRuntimeTransportLimits;
	readonly packageId: AgentPackageId;
	readonly packageRevision: AgentPackageRevision;
	readonly authorizedAgents: readonly AgentId[];
	readonly implementation: {
		readonly name: string;
		readonly build: string;
	};
}

type ConnectedAgentCallKind =
	| 'executionProfile.resolve'
	| 'resumeState.migrate'
	| 'session.create'
	| 'session.materialize'
	| 'session.release'
	| 'session.delete'
	| 'chat.create'
	| 'chat.materialize'
	| 'chat.release'
	| 'chat.fork'
	| 'chat.send'
	| 'chat.steer'
	| 'chat.cancel'
	| 'chat.delete';

interface IConnectedAgentCallContext {
	readonly kind: ConnectedAgentCallKind;
	readonly operation?: string;
	readonly session?: AgentSessionId;
	readonly chat?: AgentChatId;
	readonly turn?: AgentTurnId;
	readonly allowsSessionActions: boolean;
	readonly allowsChatActions: boolean;
	readonly allowsTurnActions: boolean;
	readonly turnRequest?: IAgentChatRequest;
}

interface IPendingConnectedAgentCall extends IConnectedAgentCallContext {
	readonly call: AgentRuntimeCallId;
	readonly agent: AgentId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly disconnected: DeferredPromise<never>;
	hostOperationsOpen: boolean;
	exactTurnTerminalAccepted: boolean;
}

interface IConnectedAgentContentOwner {
	readonly parentCall: AgentRuntimeCallId;
	readonly agent: AgentId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
}

interface IConnectedAgentContentLease {
	readonly owner: IConnectedAgentContentOwner;
	readonly content: IAgentHostContentReference;
}

interface IConnectedAgentHostOperationRecord {
	readonly canonicalRequest: string;
	readonly request: IAgentRuntimeHostOperationRequest;
	readonly owner: IConnectedAgentContentOwner;
	readonly cancellation: CancellationTokenSource;
	readonly executionTerminal: DeferredPromise<void>;
	executionState: 'pending' | 'terminal';
	responseDeliveryState: 'notStarted' | 'pending' | 'delivered' | 'failed';
	progressDelivery: Promise<void>;
	pipelineCompletion?: Promise<void>;
	pipelineFailure?: Error;
	retired: boolean;
	response?: IAgentRuntimeHostOperationResponse;
}

interface IConnectedAgentToolCallRecord {
	readonly canonicalCall: string;
	readonly owner: IConnectedAgentContentOwner;
	readonly executionTerminal: DeferredPromise<void>;
	executionState: 'notStarted' | 'pending' | 'terminal';
	cancellation?: Promise<void>;
}

interface IConnectedAgentRegistration {
	readonly registration: IAgentRuntimeRegistration;
	readonly descriptor: IAgentDescriptor;
}

function invalidRuntimeValue(field: string, value: unknown): AgentHostError {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	return new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid connected Agent Runtime protocol value',
		{ field, value: diagnostic },
	);
}

function throwInvalidRuntimeValue(field: string, value: unknown): never {
	throw invalidRuntimeValue(field, value);
}

function runtimeUnavailable(connection: IAgentRuntimeConnection): AgentHostError {
	return new AgentHostError(
		AgentHostErrorCode.ResourceMissing,
		'Connected Agent Runtime is unavailable',
		{ resource: `agentRuntime:${connection.connection}:${connection.generation}` },
	);
}

function assertBoundedString(value: unknown, field: string, maximumLength: number): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
		throwInvalidRuntimeValue(field, value);
	}
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throwInvalidRuntimeValue(field, value);
	}
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
	assertNonNegativeInteger(value, field);
	if (value === 0) {
		throwInvalidRuntimeValue(field, value);
	}
}

function assertExactKeys(
	value: object,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const keys = Object.keys(value);
	const allowed = new Set([...required, ...optional]);
	if (
		required.some(key => !Object.prototype.hasOwnProperty.call(value, key))
		|| keys.some(key => !allowed.has(key))
	) {
		throwInvalidRuntimeValue(`${field}.keys`, keys.join(','));
	}
}

function assertTurnResponsePart(part: AgentTurnResponsePart, field: string): void {
	if (part.kind === 'text' || part.kind === 'reasoning') {
		assertExactKeys(part, ['kind', 'text'], [], field);
		if (typeof part.text !== 'string') {
			throwInvalidRuntimeValue(`${field}.text`, part.text);
		}
		return;
	}
	if (part.kind === 'toolCall') {
		assertExactKeys(part, ['kind', 'call', 'tool', 'input'], [], field);
		createAgentToolCallId(part.call);
		createAgentToolId(part.tool);
		assertAgentHostProtocolValue(part.input);
		return;
	}
	if (part.kind === 'toolResult') {
		assertExactKeys(part, ['kind', 'call', 'status'], ['output'], field);
		createAgentToolCallId(part.call);
		if (!['completed', 'denied', 'cancelled', 'timedOut', 'failed'].includes(part.status)) {
			throwInvalidRuntimeValue(`${field}.status`, part.status);
		}
		if (part.output !== undefined) {
			assertAgentHostProtocolValue(part.output);
		}
		return;
	}
	throwInvalidRuntimeValue(`${field}.kind`, (part as { readonly kind?: unknown }).kind);
}

function assertTurnProgress(progress: AgentTurnProgress, field: string): void {
	if (progress.kind === 'state') {
		assertExactKeys(progress, ['kind', 'state'], [], field);
		if (![
			'accepted',
			'queued',
			'running',
			'waitingForPermission',
			'waitingForInput',
			'cancelling',
		].includes(progress.state)) {
			throwInvalidRuntimeValue(`${field}.state`, progress.state);
		}
		return;
	}
	if (progress.kind === 'response') {
		assertExactKeys(progress, ['kind', 'part'], [], field);
		assertTurnResponsePart(progress.part, `${field}.part`);
		return;
	}
	throwInvalidRuntimeValue(`${field}.kind`, (progress as { readonly kind?: unknown }).kind);
}

function transportByteLength(value: unknown, field: string): number {
	let encoded: string | undefined;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throwInvalidRuntimeValue(field, 'not-serializable');
	}
	if (encoded === undefined) {
		return throwInvalidRuntimeValue(field, 'not-serializable');
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(encoded);
	} catch {
		return throwInvalidRuntimeValue(field, 'not-json');
	}
	assertAgentHostProtocolValue(decoded);
	return new TextEncoder().encode(encoded).byteLength;
}

function assertTransportBound(value: unknown, field: string, maximumBytes: number): void {
	const byteLength = transportByteLength(value, field);
	if (byteLength > maximumBytes) {
		throwInvalidRuntimeValue(`${field}.byteLength`, byteLength);
	}
}

function validateTransportLimits(
	value: IAgentRuntimeTransportLimits,
	field: string,
	ceiling?: IAgentRuntimeTransportLimits,
): IAgentRuntimeTransportLimits {
	const entries = [
		['maximumRequestBytes', value.maximumRequestBytes],
		['maximumResponseBytes', value.maximumResponseBytes],
		['maximumActionBytes', value.maximumActionBytes],
		['maximumConcurrentCalls', value.maximumConcurrentCalls],
	] as const;
	for (const [name, limit] of entries) {
		assertPositiveInteger(limit, `${field}.${name}`);
		if (ceiling !== undefined && limit > ceiling[name]) {
			throwInvalidRuntimeValue(`${field}.${name}`, limit);
		}
	}
	return Object.freeze({
		maximumRequestBytes: value.maximumRequestBytes,
		maximumResponseBytes: value.maximumResponseBytes,
		maximumActionBytes: value.maximumActionBytes,
		maximumConcurrentCalls: value.maximumConcurrentCalls,
	});
}

function assertUniqueStrings(
	values: readonly string[],
	field: string,
	validate: (value: string) => void,
): readonly string[] {
	if (!Array.isArray(values)) {
		return throwInvalidRuntimeValue(field, values);
	}
	const seen = new Set<string>();
	for (const [index, value] of values.entries()) {
		validate(value);
		if (seen.has(value)) {
			throwInvalidRuntimeValue(`${field}.${index}`, value);
		}
		seen.add(value);
	}
	return Object.freeze([...values]);
}

function validateAndFreezeModelDescriptor(
	model: IAgentModelDescriptor,
	field: string,
): IAgentModelDescriptor {
	createAgentModelId(model.id);
	createAgentModelDescriptorRevision(model.revision);
	assertBoundedString(model.displayName, `${field}.displayName`, 512);
	if (typeof model.enabled !== 'boolean') {
		throwInvalidRuntimeValue(`${field}.enabled`, model.enabled);
	}
	const toolSchemaProfiles = assertUniqueStrings(
		model.toolSchemaProfiles,
		`${field}.toolSchemaProfiles`,
		createAgentToolSchemaProfileId,
	);
	const carriers = assertUniqueStrings(model.attachments.carriers, `${field}.attachments.carriers`, carrier => {
		if (carrier !== 'inline' && carrier !== 'reference') {
			throwInvalidRuntimeValue(`${field}.attachments.carriers`, carrier);
		}
	});
	const shapes = assertUniqueStrings(model.attachments.shapes, `${field}.attachments.shapes`, shape => {
		if (shape !== 'blob' && shape !== 'tree') {
			throwInvalidRuntimeValue(`${field}.attachments.shapes`, shape);
		}
	});
	const mediaTypes = assertUniqueStrings(model.attachments.mediaTypes, `${field}.attachments.mediaTypes`, mediaType => {
		if (!mediaTypePattern.test(mediaType)) {
			throwInvalidRuntimeValue(`${field}.attachments.mediaTypes`, mediaType);
		}
	});
	for (const [name, limit] of [
		['maximumCount', model.attachments.maximumCount],
		['maximumItemBytes', model.attachments.maximumItemBytes],
		['maximumTotalBytes', model.attachments.maximumTotalBytes],
		['maximumTreeDepth', model.attachments.maximumTreeDepth],
		['maximumTreeEntries', model.attachments.maximumTreeEntries],
	] as const) {
		assertNonNegativeInteger(limit, `${field}.attachments.${name}`);
	}
	if (typeof model.attachments.supportsClientContentForBackgroundExecution !== 'boolean') {
		throwInvalidRuntimeValue(
			`${field}.attachments.supportsClientContentForBackgroundExecution`,
			model.attachments.supportsClientContentForBackgroundExecution,
		);
	}
	return Object.freeze({
		id: model.id,
		revision: model.revision,
		displayName: model.displayName,
		enabled: model.enabled,
		toolSchemaProfiles: toolSchemaProfiles as IAgentModelDescriptor['toolSchemaProfiles'],
		attachments: Object.freeze({
			carriers: carriers as IAgentModelDescriptor['attachments']['carriers'],
			shapes: shapes as IAgentModelDescriptor['attachments']['shapes'],
			mediaTypes,
			maximumCount: model.attachments.maximumCount,
			maximumItemBytes: model.attachments.maximumItemBytes,
			maximumTotalBytes: model.attachments.maximumTotalBytes,
			maximumTreeDepth: model.attachments.maximumTreeDepth,
			maximumTreeEntries: model.attachments.maximumTreeEntries,
			supportsClientContentForBackgroundExecution: model.attachments.supportsClientContentForBackgroundExecution,
		}),
	});
}

function validateAndFreezeDescriptor(descriptor: IAgentDescriptor, field: string): IAgentDescriptor {
	createAgentId(descriptor.id);
	createAgentPackageId(descriptor.packageId);
	createAgentDescriptorRevision(descriptor.revision);
	assertBoundedString(descriptor.displayName, `${field}.displayName`, 512);
	assertBoundedString(descriptor.description, `${field}.description`, 2_048);
	if (typeof descriptor.authenticationRequired !== 'boolean') {
		throwInvalidRuntimeValue(`${field}.authenticationRequired`, descriptor.authenticationRequired);
	}
	createAgentCapabilityRevision(descriptor.capabilities.revision);
	for (const [name, capability] of [
		['supportsEmptySession', descriptor.capabilities.supportsEmptySession],
		['supportsCreateChat', descriptor.capabilities.supportsCreateChat],
		['supportsForkChat', descriptor.capabilities.supportsForkChat],
		['supportsQueue', descriptor.capabilities.supportsQueue],
		['supportsSteering', descriptor.capabilities.supportsSteering],
		['supportsCancellation', descriptor.capabilities.supportsCancellation],
		['supportsReleaseSession', descriptor.capabilities.supportsReleaseSession],
		['supportsReleaseChat', descriptor.capabilities.supportsReleaseChat],
		['supportsDeleteSession', descriptor.capabilities.supportsDeleteSession],
		['supportsDeleteChat', descriptor.capabilities.supportsDeleteChat],
	] as const) {
		if (typeof capability !== 'boolean') {
			throwInvalidRuntimeValue(`${field}.capabilities.${name}`, capability);
		}
	}
	if (descriptor.capabilities.maximumChatCount !== undefined) {
		assertNonNegativeInteger(descriptor.capabilities.maximumChatCount, `${field}.capabilities.maximumChatCount`);
	}
	if (!Array.isArray(descriptor.models) || descriptor.models.length > maximumDescriptorModelCount) {
		throwInvalidRuntimeValue(`${field}.models`, descriptor.models);
	}
	const modelIds = new Set<string>();
	const modelRevisions = new Set<string>();
	const models = descriptor.models.map((model, index) => {
		const validated = validateAndFreezeModelDescriptor(model, `${field}.models.${index}`);
		if (modelIds.has(validated.id) || modelRevisions.has(validated.revision)) {
			throwInvalidRuntimeValue(`${field}.models.${index}`, validated.id);
		}
		modelIds.add(validated.id);
		modelRevisions.add(validated.revision);
		return validated;
	});
	return Object.freeze({
		id: descriptor.id,
		packageId: descriptor.packageId,
		revision: descriptor.revision,
		displayName: descriptor.displayName,
		description: descriptor.description,
		capabilities: Object.freeze({ ...descriptor.capabilities }),
		models: Object.freeze(models),
		authenticationRequired: descriptor.authenticationRequired,
	});
}

function validateAndFreezeRegistration(
	pair: IAgentRuntimeAgentRegistration,
	packageId: AgentPackageId,
	authorizedAgents: ReadonlySet<AgentId>,
	field: string,
): IConnectedAgentRegistration {
	const descriptor = validateAndFreezeDescriptor(pair.descriptor, `${field}.descriptor`);
	const registration = pair.registration;
	createAgentPackageId(registration.packageId);
	createAgentId(registration.agentId);
	createAgentRuntimeRegistrationRevision(registration.revision);
	createAgentDescriptorRevision(registration.descriptorRevision);
	createAgentCapabilityRevision(registration.capabilityRevision);
	if (
		registration.packageId !== packageId
		|| !authorizedAgents.has(registration.agentId)
		|| descriptor.id !== registration.agentId
		|| descriptor.packageId !== registration.packageId
		|| descriptor.revision !== registration.descriptorRevision
		|| descriptor.capabilities.revision !== registration.capabilityRevision
	) {
		throwInvalidRuntimeValue(field, registration.agentId);
	}
	const supportedToolSchemaProfiles = assertUniqueStrings(
		registration.supportedToolSchemaProfiles,
		`${field}.registration.supportedToolSchemaProfiles`,
		createAgentToolSchemaProfileId,
	);
	const descriptorProfiles = Array.from(new Set(
		descriptor.models.flatMap(model => model.toolSchemaProfiles),
	)).sort();
	if (
		[...supportedToolSchemaProfiles].sort().length !== descriptorProfiles.length
		|| [...supportedToolSchemaProfiles].sort().some((profile, index) => profile !== descriptorProfiles[index])
	) {
		throwInvalidRuntimeValue(`${field}.registration.supportedToolSchemaProfiles`, registration.agentId);
	}
	const supportedResumeSchemas = assertUniqueStrings(
		registration.supportedResumeSchemas,
		`${field}.registration.supportedResumeSchemas`,
		createAgentResumeSchemaId,
	);
	if (!Array.isArray(registration.resumeMigrationEdges)) {
		throwInvalidRuntimeValue(`${field}.registration.resumeMigrationEdges`, registration.resumeMigrationEdges);
	}
	const edgeKeys = new Set<string>();
	const resumeMigrationEdges = registration.resumeMigrationEdges.map((edge, index) => {
		createAgentResumeSchemaId(edge.sourceSchema);
		createAgentResumeSchemaId(edge.targetSchema);
		const key = `${edge.sourceSchema}\u0000${edge.targetSchema}`;
		if (
			edge.sourceSchema === edge.targetSchema
			|| edgeKeys.has(key)
			|| !supportedResumeSchemas.includes(edge.targetSchema)
		) {
			throwInvalidRuntimeValue(`${field}.registration.resumeMigrationEdges.${index}`, key);
		}
		edgeKeys.add(key);
		return Object.freeze({ ...edge });
	});
	return {
		descriptor,
		registration: Object.freeze({
			packageId: registration.packageId,
			agentId: registration.agentId,
			revision: registration.revision,
			descriptorRevision: registration.descriptorRevision,
			capabilityRevision: registration.capabilityRevision,
			supportedToolSchemaProfiles: supportedToolSchemaProfiles as IAgentRuntimeRegistration['supportedToolSchemaProfiles'],
			supportedResumeSchemas: supportedResumeSchemas as IAgentRuntimeRegistration['supportedResumeSchemas'],
			resumeMigrationEdges: Object.freeze(resumeMigrationEdges),
		}),
	};
}

function validateOrigin(origin: AgentChatOrigin): void {
	if (origin.kind === 'user') {
		return;
	}
	createAgentChatId(origin.parentChat);
	createAgentTurnId(origin.parentTurn);
	if (origin.kind === 'tool') {
		createAgentToolCallId(origin.toolCall);
	} else if (origin.kind !== 'fork') {
		throwInvalidRuntimeValue('chat.origin.kind', (origin as { readonly kind?: unknown }).kind);
	}
}

function validateResumeState(
	resume: IAgentResumeState | undefined,
	registration: IAgentRuntimeRegistration,
	field: string,
): void {
	if (resume === undefined) {
		return;
	}
	assertExactKeys(resume, ['schema', 'data'], [], field);
	createAgentResumeSchemaId(resume.schema);
	if (!registration.supportedResumeSchemas.includes(resume.schema)) {
		throwInvalidRuntimeValue(`${field}.schema`, resume.schema);
	}
	if (typeof resume.data !== 'string') {
		throwInvalidRuntimeValue(`${field}.data`, resume.data);
	}
}

function sessionContext(
	kind: ConnectedAgentCallKind,
	operation: AgentHostOperationId,
	session: AgentSessionId,
	allowsActions: boolean,
): IConnectedAgentCallContext {
	return {
		kind,
		operation,
		session,
		allowsSessionActions: allowsActions,
		allowsChatActions: false,
		allowsTurnActions: false,
	};
}

function chatContext(
	kind: ConnectedAgentCallKind,
	operation: AgentHostOperationId,
	session: AgentSessionId,
	chat: AgentChatId,
	allowsActions: boolean,
): IConnectedAgentCallContext {
	return {
		kind,
		operation,
		session,
		chat,
		allowsSessionActions: allowsActions,
		allowsChatActions: allowsActions,
		allowsTurnActions: false,
	};
}

function turnContext(
	kind: ConnectedAgentCallKind,
	operation: AgentHostOperationId,
	session: AgentSessionId,
	chat: AgentChatId,
	turn: AgentTurnId,
	turnRequest?: IAgentChatRequest,
): IConnectedAgentCallContext {
	return {
		kind,
		operation,
		session,
		chat,
		turn,
		allowsSessionActions: true,
		allowsChatActions: true,
		allowsTurnActions: true,
		...(turnRequest === undefined ? {} : { turnRequest }),
	};
}

/** Owns one negotiated connection generation and its Host-side Agent projections. */
export interface IConnectedAgentRuntime {
	readonly connection: IAgentRuntimeConnection;
	readonly protocolVersion: AgentRuntimeProtocolVersion;
	readonly transportLimits: IAgentRuntimeTransportLimits;
	readonly agents: readonly IAgent[];
	dispose(): void;
}

class ConnectedAgentRuntime extends Disposable implements IConnectedAgentRuntime {
	private readonly initializationOptions: Omit<IConnectedAgentRuntimeOptions, 'connection' | 'toolExecution' | 'contentResources'>;
	private readonly pendingCalls = new Map<AgentRuntimeCallId, IPendingConnectedAgentCall>();
	private readonly hostOperations = new Map<AgentRuntimeHostOperationId, IConnectedAgentHostOperationRecord>();
	private readonly contentLeases = new Map<AgentContentLeaseId, IConnectedAgentContentLease>();
	private readonly contentMaterializations = new Map<AgentContentMaterializationId, IConnectedAgentContentOwner>();
	private readonly contentLeaseReleases = new Map<AgentContentLeaseId, Promise<void>>();
	private readonly contentMaterializationReleases = new Map<AgentContentMaterializationId, Promise<void>>();
	private readonly toolCalls = new Map<AgentToolCallId, IConnectedAgentToolCallRecord>();
	private readonly agentsById = new Map<AgentId, ConnectedAgent>();
	private status: 'initializing' | 'active' | 'invalid' | 'disposed' = 'initializing';
	private failure: Error | undefined;
	private initializationDisconnect: DeferredPromise<never> | undefined;
	private nextCallNumber = 0;
	private expectedActionSequence = 1;
	private connectionDisposed = false;
	private contentCleanupStarted = false;
	private protocolVersionValue: AgentRuntimeProtocolVersion | undefined;
	private transportLimitsValue: IAgentRuntimeTransportLimits | undefined;
	private agentsValue: readonly IAgent[] = Object.freeze([]);

	readonly connection: IAgentRuntimeConnection;
	private readonly toolExecution: IAgentToolExecutionPort;
	private readonly contentResources: IAgentContentResourcePort;

	private constructor(options: IConnectedAgentRuntimeOptions) {
		super();
		this.connection = options.connection;
		this.toolExecution = options.toolExecution;
		this.contentResources = options.contentResources;
		this.initializationOptions = {
			protocolVersions: options.protocolVersions,
			transportLimits: options.transportLimits,
			packageId: options.packageId,
			packageRevision: options.packageRevision,
			authorizedAgents: options.authorizedAgents,
			implementation: options.implementation,
		};
		this._register(this.connection.onDidDisconnect(event => this.handleDisconnect(event)));
		this._register(this.connection.onDidEmitAction(action => this.handleAction(action)));
		this._register(this.connection.onDidRequestHostOperation(request => this.acceptHostOperation(request)));
	}

	static async connect(options: IConnectedAgentRuntimeOptions): Promise<ConnectedAgentRuntime> {
		const runtime = new ConnectedAgentRuntime(options);
		try {
			await runtime.initialize();
			return runtime;
		} catch (error) {
			runtime.dispose();
			throw error;
		}
	}

	get protocolVersion(): AgentRuntimeProtocolVersion {
		return this.protocolVersionValue ?? throwInvalidRuntimeValue('runtime.protocolVersion', 'uninitialized');
	}

	get transportLimits(): IAgentRuntimeTransportLimits {
		return this.transportLimitsValue ?? throwInvalidRuntimeValue('runtime.transportLimits', 'uninitialized');
	}

	get agents(): readonly IAgent[] {
		return this.agentsValue;
	}

	private async initialize(): Promise<void> {
		createAgentRuntimeConnectionId(this.connection.connection);
		createAgentRuntimeConnectionGeneration(this.connection.generation);
		if (this.connection.generation === 0) {
			throwInvalidRuntimeValue('runtime.connection.generation', this.connection.generation);
		}
		this.assertConnectedState(this.connection.state, 'runtime.connection.state');
		createAgentPackageId(this.initializationOptions.packageId);
		createAgentPackageRevision(this.initializationOptions.packageRevision);
		assertBoundedString(this.initializationOptions.implementation.name, 'runtime.implementation.name', 256);
		assertBoundedString(this.initializationOptions.implementation.build, 'runtime.implementation.build', 256);
		const protocolVersions = assertUniqueStrings(
			this.initializationOptions.protocolVersions,
			'runtime.protocolVersions',
			createAgentRuntimeProtocolVersion,
		) as readonly AgentRuntimeProtocolVersion[];
		if (protocolVersions.length === 0) {
			throwInvalidRuntimeValue('runtime.protocolVersions', 'empty');
		}
		const authorizedAgents = assertUniqueStrings(
			this.initializationOptions.authorizedAgents,
			'runtime.authorizedAgents',
			createAgentId,
		) as readonly AgentId[];
		if (authorizedAgents.length === 0 || authorizedAgents.length > maximumConnectedAgentCount) {
			throwInvalidRuntimeValue('runtime.authorizedAgents.length', authorizedAgents.length);
		}
		const offeredLimits = validateTransportLimits(this.initializationOptions.transportLimits, 'runtime.transportLimits');
		const call = this.nextCallId();
		const request: IAgentRuntimeInitializeRequest = {
			connection: this.connection.connection,
			generation: this.connection.generation,
			call,
			protocolVersions,
			transportLimits: offeredLimits,
			packageId: this.initializationOptions.packageId,
			packageRevision: this.initializationOptions.packageRevision,
			authorizedAgents,
			implementation: Object.freeze({ ...this.initializationOptions.implementation }),
		};
		assertTransportBound(request, 'runtime.initialize.request', offeredLimits.maximumRequestBytes);

		const disconnected = new DeferredPromise<never>();
		this.initializationDisconnect = disconnected;
		let result;
		try {
			result = await Promise.race([
				this.connection.initialize(request),
				disconnected.p,
			]);
		} finally {
			this.initializationDisconnect = undefined;
		}
		assertTransportBound(result, 'runtime.initialize.response', offeredLimits.maximumResponseBytes);
		if (
			result.connection !== request.connection
			|| result.generation !== request.generation
			|| result.call !== request.call
		) {
			return this.invalidateProtocol('runtime.initialize.response.correlation', result.call);
		}
		createAgentRuntimeProtocolVersion(result.protocolVersion);
		if (!protocolVersions.includes(result.protocolVersion)) {
			return this.invalidateProtocol('runtime.initialize.response.protocolVersion', result.protocolVersion);
		}
		const negotiatedLimits = validateTransportLimits(
			result.transportLimits,
			'runtime.initialize.response.transportLimits',
			offeredLimits,
		);
		if (!Array.isArray(result.registrations) || result.registrations.length !== authorizedAgents.length) {
			return this.invalidateProtocol('runtime.initialize.response.registrations', result.registrations);
		}
		const authorizedAgentSet = new Set(authorizedAgents);
		const registrations = new Map<AgentId, IConnectedAgentRegistration>();
		for (const [index, pair] of result.registrations.entries()) {
			const validated = validateAndFreezeRegistration(
				pair,
				request.packageId,
				authorizedAgentSet,
				`runtime.initialize.response.registrations.${index}`,
			);
			if (registrations.has(validated.registration.agentId)) {
				return this.invalidateProtocol(
					`runtime.initialize.response.registrations.${index}.agentId`,
					validated.registration.agentId,
				);
			}
			registrations.set(validated.registration.agentId, validated);
		}
		for (const agent of authorizedAgents) {
			if (!registrations.has(agent)) {
				return this.invalidateProtocol('runtime.initialize.response.registrations.agentId', agent);
			}
		}

		this.protocolVersionValue = result.protocolVersion;
		this.transportLimitsValue = negotiatedLimits;
		const agents: ConnectedAgent[] = [];
		for (const agent of authorizedAgents) {
			const connectedAgent = this._register(new ConnectedAgent(this, registrations.get(agent)!));
			this.agentsById.set(agent, connectedAgent);
			agents.push(connectedAgent);
		}
		this.agentsValue = Object.freeze(agents);
		this.status = 'active';
	}

	async invoke<TRequest, TValue, TResult>(
		agent: IConnectedAgentRegistration,
		request: TRequest,
		context: IConnectedAgentCallContext,
		dispatch: (call: IAgentRuntimeCall<TRequest>) => Promise<IAgentRuntimeResponse<TValue>>,
		validate: (value: TValue) => TResult,
	): Promise<TResult> {
		this.assertActive();
		if (this.pendingCalls.size >= this.transportLimits.maximumConcurrentCalls) {
			throw invalidRuntimeValue('runtime.pendingCalls', this.pendingCalls.size);
		}
		const callId = this.nextCallId();
		const call: IAgentRuntimeCall<TRequest> = {
			connection: this.connection.connection,
			generation: this.connection.generation,
			call: callId,
			registration: agent.registration.revision,
			agent: agent.registration.agentId,
			request,
		};
		assertTransportBound(call, 'runtime.call.request', this.transportLimits.maximumRequestBytes);
		const pending: IPendingConnectedAgentCall = {
			...context,
			call: callId,
			agent: agent.registration.agentId,
			registration: agent.registration.revision,
			disconnected: new DeferredPromise<never>(),
			hostOperationsOpen: context.kind === 'chat.send',
			exactTurnTerminalAccepted: false,
		};
		this.pendingCalls.set(callId, pending);
		let result: TResult | undefined;
		let operationFailed = false;
		let operationFailure: unknown;
		try {
			let response: IAgentRuntimeResponse<TValue>;
			try {
				response = await Promise.race([dispatch(call), pending.disconnected.p]);
			} catch (error) {
				if (this.connection.state.kind === 'disconnected' && this.status === 'active') {
					this.handleDisconnect(this.connection.state);
					throw this.failure ?? runtimeUnavailable(this.connection);
				}
				throw error;
			}
			pending.hostOperationsOpen = false;
			try {
				assertTransportBound(response, 'runtime.call.response', this.transportLimits.maximumResponseBytes);
				if (
					response.connection !== call.connection
					|| response.generation !== call.generation
					|| response.call !== call.call
					|| response.registration !== call.registration
					|| response.agent !== call.agent
				) {
					throw invalidRuntimeValue('runtime.call.response.correlation', response.call);
				}
				const activeHostOperations = this.pendingHostOperations(pending);
				if (activeHostOperations.length !== 0) {
					const error = invalidRuntimeValue(
						'runtime.call.response.pendingHostOperations',
						activeHostOperations.length,
					);
					this.markInvalid(error, true);
					await this.cancelPendingHostOperations(activeHostOperations);
					throw error;
				}
				result = validate(response.value);
				if (pending.kind === 'chat.send' && !pending.exactTurnTerminalAccepted) {
					throw invalidRuntimeValue('runtime.call.response.turnTerminal', pending.turn ?? 'missing');
				}
			} catch (error) {
				const protocolError = error instanceof AgentHostError
					? error
					: invalidRuntimeValue('runtime.call.response.value', error instanceof Error ? error.message : error);
				this.fail(protocolError, true);
			}
		} catch (error) {
			operationFailed = true;
			operationFailure = error;
		}

		pending.hostOperationsOpen = false;
		let cleanupFailed = false;
		let cleanupFailure: unknown;
		try {
			await this.cancelPendingHostOperations(this.pendingHostOperations(pending));
			await this.retireHostOperationState(pending);
		} catch (error) {
			cleanupFailed = true;
			cleanupFailure = error;
		} finally {
			this.pendingCalls.delete(callId);
		}
		if (operationFailed && cleanupFailed && operationFailure !== cleanupFailure) {
			throw new AggregateError(
				[operationFailure, cleanupFailure],
				'Connected Agent Runtime call and cleanup both failed',
			);
		}
		if (operationFailed) {
			throw operationFailure;
		}
		if (cleanupFailed) {
			throw cleanupFailure;
		}
		return result!;
	}

	private nextCallId(): AgentRuntimeCallId {
		this.nextCallNumber += 1;
		if (!Number.isSafeInteger(this.nextCallNumber)) {
			return throwInvalidRuntimeValue('runtime.call.sequence', this.nextCallNumber);
		}
		return createAgentRuntimeCallId(`runtime-call-${this.nextCallNumber}`);
	}

	private assertActive(): void {
		if (this.status !== 'active') {
			throw this.failure ?? runtimeUnavailable(this.connection);
		}
		if (this.connection.state.kind === 'disconnected') {
			this.handleDisconnect(this.connection.state);
			throw this.failure ?? runtimeUnavailable(this.connection);
		}
		this.assertConnectedState(this.connection.state, 'runtime.connection.state');
	}

	private acceptHostOperation(request: IAgentRuntimeHostOperationRequest): void {
		try {
			this.assertActive();
			assertTransportBound(request, 'runtime.hostOperation.request', this.transportLimits.maximumRequestBytes);
			const owner = this.validateHostOperationRequest(request);
			const canonicalRequest = encodeAgentHostProtocolValue(request);
			const existing = this.hostOperations.get(request.operation);
			if (existing !== undefined) {
				if (existing.canonicalRequest !== canonicalRequest) {
					throw invalidRuntimeValue('runtime.hostOperation.operation', request.operation);
				}
				if (existing.response !== undefined && existing.responseDeliveryState === 'delivered') {
					this.trackHostOperationPipeline(
						existing,
						this.deliverHostOperationResponse(existing, existing.response),
					);
				}
				return;
			}
			if (this.hostOperations.size >= maximumRetainedHostOperationCount) {
				throw invalidRuntimeValue('runtime.hostOperation.records', this.hostOperations.size);
			}
			let activeCount = 0;
			for (const record of this.hostOperations.values()) {
				if (record.responseDeliveryState !== 'delivered') {
					activeCount += 1;
				}
			}
			if (activeCount >= this.transportLimits.maximumConcurrentCalls) {
				throw invalidRuntimeValue('runtime.hostOperation.pending', activeCount);
			}
			const record: IConnectedAgentHostOperationRecord = {
				canonicalRequest,
				request,
				owner,
				cancellation: new CancellationTokenSource(),
				executionTerminal: new DeferredPromise<void>(),
				executionState: 'pending',
				responseDeliveryState: 'notStarted',
				progressDelivery: Promise.resolve(),
				retired: false,
			};
			this.hostOperations.set(request.operation, record);
			this.trackHostOperationPipeline(record, this.runHostOperation(record));
		} catch (error) {
			this.markInvalid(
				error instanceof AgentHostError
					? error
					: invalidRuntimeValue('runtime.hostOperation.request', error instanceof Error ? error.message : error),
				true,
			);
		}
	}

	private validateHostOperationRequest(request: IAgentRuntimeHostOperationRequest): IConnectedAgentContentOwner {
		assertExactKeys(
			request,
			['connection', 'generation', 'operation', 'parentCall', 'registration', 'agent', 'request'],
			[],
			'runtime.hostOperation',
		);
		createAgentRuntimeConnectionId(request.connection);
		createAgentRuntimeConnectionGeneration(request.generation);
		createAgentRuntimeHostOperationId(request.operation);
		createAgentRuntimeCallId(request.parentCall);
		createAgentRuntimeRegistrationRevision(request.registration);
		createAgentId(request.agent);
		if (request.connection !== this.connection.connection || request.generation !== this.connection.generation) {
			throw invalidRuntimeValue('runtime.hostOperation.correlation', request.operation);
		}
		const parent = this.pendingCalls.get(request.parentCall);
		if (
			parent === undefined
			|| parent.kind !== 'chat.send'
			|| !parent.hostOperationsOpen
			|| parent.turnRequest === undefined
			|| parent.agent !== request.agent
			|| parent.registration !== request.registration
			|| parent.session === undefined
			|| parent.chat === undefined
			|| parent.turn === undefined
		) {
			throw invalidRuntimeValue('runtime.hostOperation.parentCall', request.parentCall);
		}
		const owner: IConnectedAgentContentOwner = {
			parentCall: request.parentCall,
			agent: request.agent,
			registration: request.registration,
			session: parent.session,
			chat: parent.chat,
			turn: parent.turn,
		};
		this.validateHostOperationValue(request, parent.turnRequest, owner);
		return owner;
	}

	private validateHostOperationValue(
		envelope: IAgentRuntimeHostOperationRequest,
		turn: IAgentChatRequest,
		owner: IConnectedAgentContentOwner,
	): void {
		const request = envelope.request;
		switch (request.kind) {
			case 'tool.execute':
			case 'tool.cancel':
			case 'tool.reconcile':
				assertExactKeys(request, ['kind', 'call'], [], 'runtime.hostOperation.request');
				this.validateHostToolCall(request.call, turn, owner, request.kind);
				return;
			case 'content.open': {
				assertExactKeys(request, ['kind', 'request'], [], 'runtime.hostOperation.request');
				assertAgentContentResourceOpenRequest(request.request);
				this.assertContentContext(request.request, owner);
				const attachment = turn.attachments.find(candidate => candidate.id === request.request.attachment);
				if (
					attachment?.content?.kind !== 'reference'
					|| encodeAgentHostProtocolValue(attachment.content) !== encodeAgentHostProtocolValue(request.request.content)
				) {
					throw invalidRuntimeValue('runtime.hostOperation.content.open', request.request.attachment);
				}
				return;
			}
			case 'content.readBlob':
				assertExactKeys(request, ['kind', 'request'], [], 'runtime.hostOperation.request');
				assertAgentContentBlobReadRequest(request.request);
				this.requireContentLease(request.request.lease, owner);
				return;
			case 'content.readTreePage':
				assertExactKeys(request, ['kind', 'request'], [], 'runtime.hostOperation.request');
				assertAgentContentTreePageRequest(request.request);
				this.requireContentLease(request.request.lease, owner);
				return;
			case 'content.readTreeEntry':
				assertExactKeys(request, ['kind', 'request'], [], 'runtime.hostOperation.request');
				assertAgentContentTreeEntryReadRequest(request.request);
				this.requireContentLease(request.request.lease, owner);
				return;
			case 'content.release':
				assertExactKeys(request, ['kind', 'lease'], [], 'runtime.hostOperation.request');
				createAgentContentLeaseId(request.lease);
				this.requireContentLease(request.lease, owner);
				return;
			case 'content.materialize':
				assertExactKeys(request, ['kind', 'request'], [], 'runtime.hostOperation.request');
				assertAgentContentMaterializeRequest(request.request);
				this.requireContentLease(request.request.lease, owner);
				return;
			case 'content.releaseMaterialization':
				assertExactKeys(request, ['kind', 'materialization'], [], 'runtime.hostOperation.request');
				createAgentContentMaterializationId(request.materialization);
				this.requireContentMaterialization(request.materialization, owner);
				return;
			case 'content.cancel': {
				assertExactKeys(request, ['kind', 'target'], [], 'runtime.hostOperation.request');
				createAgentRuntimeHostOperationId(request.target);
				const target = this.hostOperations.get(request.target);
				if (
					target === undefined
					|| target.executionState !== 'pending'
					|| target.request.request.kind === 'tool.execute'
					|| target.request.request.kind === 'tool.cancel'
					|| target.request.request.kind === 'tool.reconcile'
					|| !this.sameContentOwner(target.owner, owner)
				) {
					throw invalidRuntimeValue('runtime.hostOperation.content.cancel', request.target);
				}
				return;
			}
			default:
				throw invalidRuntimeValue(
					'runtime.hostOperation.request.kind',
					(request as { readonly kind?: unknown }).kind,
				);
		}
	}

	private validateHostToolCall(
		call: IAgentToolCall,
		turn: IAgentChatRequest,
		owner: IConnectedAgentContentOwner,
		kind: 'tool.execute' | 'tool.cancel' | 'tool.reconcile',
	): void {
		assertAgentToolCall(call);
		if (
			call.agent !== owner.agent
			|| call.registration !== owner.registration
			|| call.session !== owner.session
			|| call.chat !== owner.chat
			|| call.turn !== owner.turn
			|| call.toolSet !== turn.binding.toolSet.revision
			|| call.deadline > turn.binding.deadline
		) {
			throw invalidRuntimeValue('runtime.hostOperation.tool.call', call.id);
		}
		const registration = turn.binding.toolSet.registrations.find(candidate => candidate.id === call.registrationId);
		if (
			registration === undefined
			|| registration.revision !== call.registrationRevision
			|| registration.descriptor.id !== call.tool
			|| registration.descriptor.revision !== call.descriptor
		) {
			throw invalidRuntimeValue('runtime.hostOperation.tool.registration', call.registrationId);
		}
		const canonicalCall = encodeAgentHostProtocolValue(call);
		const existing = this.toolCalls.get(call.id);
		if (existing !== undefined && (
			existing.canonicalCall !== canonicalCall || !this.sameContentOwner(existing.owner, owner)
		)) {
			throw invalidRuntimeValue('runtime.hostOperation.tool.identity', call.id);
		}
		if (kind === 'tool.cancel' && existing === undefined) {
			throw invalidRuntimeValue('runtime.hostOperation.tool.cancel', call.id);
		}
		if (kind !== 'tool.cancel' && existing === undefined) {
			this.toolCalls.set(call.id, {
				canonicalCall,
				owner,
				executionTerminal: new DeferredPromise<void>(),
				executionState: 'notStarted',
			});
		}
	}

	private assertContentContext(
		context: { readonly session: AgentSessionId; readonly chat: AgentChatId; readonly turn: AgentTurnId },
		owner: IConnectedAgentContentOwner,
	): void {
		if (context.session !== owner.session || context.chat !== owner.chat || context.turn !== owner.turn) {
			throw invalidRuntimeValue('runtime.hostOperation.content.context', context.turn);
		}
	}

	private requireContentLease(lease: AgentContentLeaseId, owner: IConnectedAgentContentOwner): IConnectedAgentContentLease {
		const record = this.contentLeases.get(lease);
		if (record === undefined || !this.sameContentOwner(record.owner, owner)) {
			throw invalidRuntimeValue('runtime.hostOperation.content.lease', lease);
		}
		return record;
	}

	private requireContentMaterialization(
		materialization: AgentContentMaterializationId,
		owner: IConnectedAgentContentOwner,
	): void {
		const recordedOwner = this.contentMaterializations.get(materialization);
		if (recordedOwner === undefined || !this.sameContentOwner(recordedOwner, owner)) {
			throw invalidRuntimeValue('runtime.hostOperation.content.materialization', materialization);
		}
	}

	private sameContentOwner(left: IConnectedAgentContentOwner, right: IConnectedAgentContentOwner): boolean {
		return left.parentCall === right.parentCall
			&& left.agent === right.agent
			&& left.registration === right.registration
			&& left.session === right.session
			&& left.chat === right.chat
			&& left.turn === right.turn;
	}

	private pendingHostOperations(parent: IPendingConnectedAgentCall): IConnectedAgentHostOperationRecord[] {
		if (parent.kind !== 'chat.send') {
			return [];
		}
		return [...this.hostOperations.values()].filter(operation =>
			operation.owner.parentCall === parent.call && operation.responseDeliveryState !== 'delivered',
		);
	}

	private async cancelPendingHostOperations(operations: readonly IConnectedAgentHostOperationRecord[]): Promise<void> {
		if (operations.length === 0) {
			return;
		}
		const toolCalls = new Set<AgentToolCallId>();
		for (const operation of operations) {
			const request = operation.request.request;
			if (request.kind === 'tool.execute' || request.kind === 'tool.cancel' || request.kind === 'tool.reconcile') {
				const tool = this.toolCalls.get(request.call.id);
				if (tool?.executionState === 'pending') {
					toolCalls.add(request.call.id);
				}
			} else if (operation.executionState === 'pending') {
				operation.cancellation.cancel();
			}
		}
		for (const call of toolCalls) {
			const cancellation = this.cancelToolCall(call);
			void cancellation.catch(onUnexpectedError);
		}
		await this.waitForHostOperationExecutions(operations);
	}

	private async waitForHostOperationExecutions(
		operations: readonly IConnectedAgentHostOperationRecord[],
	): Promise<void> {
		const completions: Promise<void>[] = [];
		const toolCalls = new Set<AgentToolCallId>();
		for (const operation of operations) {
			const request = operation.request.request;
			if (request.kind === 'tool.execute') {
				toolCalls.add(request.call.id);
			} else if (request.kind !== 'tool.cancel') {
				completions.push(operation.executionTerminal.p);
			}
		}
		for (const call of toolCalls) {
			const tool = this.toolCalls.get(call);
			if (tool?.executionState === 'pending') {
				completions.push(tool.executionTerminal.p);
			}
		}
		await Promise.all(completions);
	}

	private cancelToolCall(call: AgentToolCallId): Promise<void> {
		const record = this.toolCalls.get(call);
		if (record === undefined) {
			return Promise.resolve();
		}
		if (record.cancellation !== undefined) {
			return record.cancellation;
		}
		try {
			record.cancellation = this.toolExecution.cancel(call);
		} catch (error) {
			record.cancellation = Promise.reject(error);
		}
		return record.cancellation;
	}

	private async retireHostOperationState(parent: IPendingConnectedAgentCall): Promise<void> {
		if (parent.kind !== 'chat.send') {
			return;
		}
		const operations = [...this.hostOperations.values()]
			.filter(operation => operation.owner.parentCall === parent.call);
		await this.waitForHostOperationExecutions(operations);
		for (const operation of operations) {
			operation.retired = true;
			this.hostOperations.delete(operation.request.operation);
		}

		const materializations = [...this.contentMaterializations.entries()]
			.filter(([, owner]) => owner.parentCall === parent.call)
			.map(([materialization]) => materialization);
		const leases = [...this.contentLeases.entries()]
			.filter(([, lease]) => lease.owner.parentCall === parent.call)
			.map(([lease]) => lease);
		const failures: unknown[] = [];
		try {
			await this.releaseContentResources(materializations, leases);
		} catch (error) {
			failures.push(error);
		}

		for (const operation of operations) {
			if (operation.pipelineFailure !== undefined) {
				failures.push(operation.pipelineFailure);
			}
		}
		for (const [call, tool] of this.toolCalls) {
			if (tool.owner.parentCall === parent.call) {
				try {
					this.toolExecution.release(createAgentToolCallId(call));
				} catch (error) {
					failures.push(error);
				} finally {
					this.toolCalls.delete(call);
				}
			}
		}
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Connected Agent Runtime retirement failed');
		}
	}

	private async releaseContentResources(
		materializations: readonly AgentContentMaterializationId[],
		leases: readonly AgentContentLeaseId[],
	): Promise<void> {
		const materializationResults = await Promise.allSettled(materializations.map(materialization =>
			this.releaseContentMaterialization(materialization, CancellationTokenNone),
		));
		const releaseFailures: unknown[] = [];
		for (const [index, result] of materializationResults.entries()) {
			if (result.status === 'fulfilled') {
				this.contentMaterializations.delete(materializations[index]);
				this.contentMaterializationReleases.delete(materializations[index]);
			} else {
				releaseFailures.push(result.reason);
			}
		}
		const leaseResults = await Promise.allSettled(leases.map(lease =>
			this.releaseContentLease(lease, CancellationTokenNone),
		));
		for (const [index, result] of leaseResults.entries()) {
			if (result.status === 'fulfilled') {
				this.contentLeases.delete(leases[index]);
				this.contentLeaseReleases.delete(leases[index]);
			} else {
				releaseFailures.push(result.reason);
			}
		}
		if (releaseFailures.length !== 0) {
			const error = new AggregateError(
				releaseFailures,
				'Connected Agent Runtime content release failed',
			);
			this.markInvalid(error, true);
			throw error;
		}
	}

	private releaseContentLease(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		const existing = this.contentLeaseReleases.get(lease);
		if (existing !== undefined) {
			return existing;
		}
		let completion: Promise<void>;
		try {
			completion = this.contentResources.release(lease, token);
		} catch (error) {
			completion = Promise.reject(error);
		}
		this.contentLeaseReleases.set(lease, completion);
		return completion;
	}

	private releaseContentMaterialization(
		materialization: AgentContentMaterializationId,
		token: CancellationToken,
	): Promise<void> {
		const existing = this.contentMaterializationReleases.get(materialization);
		if (existing !== undefined) {
			return existing;
		}
		let completion: Promise<void>;
		try {
			completion = this.contentResources.releaseMaterialization(materialization, token);
		} catch (error) {
			completion = Promise.reject(error);
		}
		this.contentMaterializationReleases.set(materialization, completion);
		return completion;
	}

	private async runHostOperation(record: IConnectedAgentHostOperationRecord): Promise<void> {
		let outcome: IAgentRuntimeHostOperationResponse['outcome'];
		try {
			outcome = Object.freeze({
				kind: 'completed',
				value: await this.executeHostOperation(record),
			});
		} catch (error) {
			outcome = this.hostOperationFailure(error);
		} finally {
			this.markHostOperationExecutionTerminal(record);
			record.cancellation.dispose();
		}
		await record.progressDelivery;
		if (record.retired) {
			return;
		}
		const request = record.request;
		const response: IAgentRuntimeHostOperationResponse = Object.freeze({
			connection: request.connection,
			generation: request.generation,
			operation: request.operation,
			parentCall: request.parentCall,
			registration: request.registration,
			agent: request.agent,
			outcome,
		});
		assertTransportBound(response, 'runtime.hostOperation.response', this.transportLimits.maximumResponseBytes);
		record.response = response;
		await this.deliverHostOperationResponse(record, response);
	}

	private markHostOperationExecutionTerminal(record: IConnectedAgentHostOperationRecord): void {
		if (record.executionState === 'terminal') {
			return;
		}
		record.executionState = 'terminal';
		record.executionTerminal.complete(undefined);
	}

	private async executeHostOperation(record: IConnectedAgentHostOperationRecord): Promise<AgentRuntimeHostOperationValue> {
		const request = record.request.request;
		switch (request.kind) {
			case 'tool.execute': {
				let progressTransportFailed = false;
				const failProgressTransport = (error: unknown): void => {
					if (progressTransportFailed) {
						return;
					}
					progressTransportFailed = true;
					const cancellation = this.cancelToolCall(request.call.id);
					void cancellation.catch(onUnexpectedError);
					this.markInvalid(
						error instanceof AgentHostError
							? error
							: invalidRuntimeValue(
								'runtime.hostOperation.tool.progress.transport',
								error instanceof Error ? error.message : error,
							),
						true,
					);
				};
				const tool = this.toolCalls.get(request.call.id)!;
				tool.executionState = 'pending';
				const markToolExecutionTerminal = (): void => {
					if (tool.executionState !== 'terminal') {
						tool.executionState = 'terminal';
						tool.executionTerminal.complete(undefined);
					}
				};
				let execution: Promise<AgentToolResult>;
				try {
					execution = this.toolExecution.execute(request.call, value => {
						let envelope: IAgentRuntimeHostOperationProgress;
						try {
							assertAgentToolProgress(value);
							if (value.call !== request.call.id) {
								throw invalidRuntimeValue('runtime.hostOperation.tool.progress.call', value.call);
							}
							envelope = Object.freeze({
								connection: record.request.connection,
								generation: record.request.generation,
								operation: record.request.operation,
								parentCall: record.request.parentCall,
								registration: record.request.registration,
								agent: record.request.agent,
								progress: value,
							});
							assertTransportBound(
								envelope,
								'runtime.hostOperation.tool.progress',
								this.transportLimits.maximumActionBytes,
							);
						} catch (error) {
							failProgressTransport(error);
							throw error;
						}
						const delivery = record.progressDelivery.then(() => this.connection.reportHostOperationProgress(envelope));
						void delivery.catch(failProgressTransport);
						record.progressDelivery = delivery;
					});
				} catch (error) {
					markToolExecutionTerminal();
					throw error;
				}
				const result = await execution.finally(markToolExecutionTerminal);
				assertAgentToolResult(result);
				if (result.call !== request.call.id) {
					throw invalidRuntimeValue('runtime.hostOperation.tool.result.call', result.call);
				}
				return result;
			}
			case 'tool.cancel':
				await this.cancelToolCall(request.call.id);
				return null;
			case 'tool.reconcile': {
				const reconciliation = await this.toolExecution.reconcile(request.call);
				assertAgentToolEndpointReconciliation(reconciliation);
				if (reconciliation.kind === 'terminal' && reconciliation.result.call !== request.call.id) {
					throw invalidRuntimeValue(
						'runtime.hostOperation.tool.reconciliation.result.call',
						reconciliation.result.call,
					);
				}
				return reconciliation;
			}
			case 'content.open': {
				const lease = await this.contentResources.open(request.request, record.cancellation.token);
				assertAgentContentResourceLease(lease, request.request);
				const existing = this.contentLeases.get(lease.lease);
				if (existing !== undefined && (
					!this.sameContentOwner(existing.owner, record.owner)
					|| encodeAgentHostProtocolValue(existing.content) !== encodeAgentHostProtocolValue(lease.content)
				)) {
					throw invalidRuntimeValue('runtime.hostOperation.content.lease', lease.lease);
				}
				this.contentLeases.set(lease.lease, { owner: record.owner, content: lease.content });
				return lease;
			}
			case 'content.readBlob': {
				const lease = this.requireContentLease(request.request.lease, record.owner);
				const result = await this.contentResources.readBlob(request.request, record.cancellation.token);
				if (lease.content.shape !== 'blob') {
					throw invalidRuntimeValue('runtime.hostOperation.content.readBlob.shape', lease.content.shape);
				}
				assertAgentContentBlobReadResult(result, request.request, lease.content.bounds.byteLength);
				return result;
			}
			case 'content.readTreePage': {
				const lease = this.requireContentLease(request.request.lease, record.owner);
				if (lease.content.shape !== 'tree') {
					throw invalidRuntimeValue('runtime.hostOperation.content.readTreePage.shape', lease.content.shape);
				}
				const result = await this.contentResources.readTreePage(request.request, record.cancellation.token);
				assertAgentContentTreePage(result, request.request);
				return result;
			}
			case 'content.readTreeEntry': {
				const lease = this.requireContentLease(request.request.lease, record.owner);
				if (lease.content.shape !== 'tree') {
					throw invalidRuntimeValue('runtime.hostOperation.content.readTreeEntry.shape', lease.content.shape);
				}
				const result = await this.contentResources.readTreeEntry(request.request, record.cancellation.token);
				assertAgentContentBlobReadResultShape(result, request.request);
				return result;
			}
			case 'content.release':
				await this.releaseContentLease(request.lease, record.cancellation.token);
				this.contentLeases.delete(request.lease);
				this.contentLeaseReleases.delete(request.lease);
				return null;
			case 'content.materialize': {
				const materialization = await this.contentResources.materialize(request.request, record.cancellation.token);
				assertAgentContentMaterialization(materialization);
				const existing = this.contentMaterializations.get(materialization.id);
				if (existing !== undefined && !this.sameContentOwner(existing, record.owner)) {
					throw invalidRuntimeValue('runtime.hostOperation.content.materialization', materialization.id);
				}
				this.contentMaterializations.set(materialization.id, record.owner);
				return materialization;
			}
			case 'content.releaseMaterialization':
				await this.releaseContentMaterialization(request.materialization, record.cancellation.token);
				this.contentMaterializations.delete(request.materialization);
				this.contentMaterializationReleases.delete(request.materialization);
				return null;
			case 'content.cancel':
				this.hostOperations.get(request.target)!.cancellation.cancel();
				return null;
		}
	}

	private hostOperationFailure(error: unknown): IAgentRuntimeHostOperationResponse['outcome'] {
		if (isCancellationError(error)) {
			return Object.freeze({ kind: 'cancelled' });
		}
		if (error instanceof AgentHostError) {
			assertAgentHostProtocolValue(error.data);
			return Object.freeze({
				kind: 'failed',
				code: error.code,
				message: error.message.slice(0, 8_192),
				data: error.data,
			});
		}
		return Object.freeze({
			kind: 'failed',
			code: AgentHostErrorCode.ResourceMissing,
			message: 'Agent Host operation failed',
			data: Object.freeze({ resource: 'agentRuntimeHostOperation' }),
		});
	}

	private trackHostOperationPipeline(
		record: IConnectedAgentHostOperationRecord,
		completion: Promise<void>,
	): void {
		record.pipelineCompletion = completion;
		void completion.catch(error => {
			const candidate = error instanceof Error
				? error
				: invalidRuntimeValue('runtime.hostOperation', error);
			record.responseDeliveryState = 'failed';
			this.markInvalid(candidate, true);
			record.pipelineFailure = this.failure ?? candidate;
		});
	}

	private async deliverHostOperationResponse(
		record: IConnectedAgentHostOperationRecord,
		response: IAgentRuntimeHostOperationResponse,
	): Promise<void> {
		record.responseDeliveryState = 'pending';
		try {
			await this.sendHostOperationResponse(response);
			record.responseDeliveryState = 'delivered';
		} catch (error) {
			record.responseDeliveryState = 'failed';
			throw error;
		}
	}

	private async sendHostOperationResponse(response: IAgentRuntimeHostOperationResponse): Promise<void> {
		try {
			await this.connection.completeHostOperation(response);
		} catch (error) {
			if (this.connection.state.kind === 'disconnected' && this.status === 'active') {
				this.handleDisconnect(this.connection.state);
				throw this.failure ?? runtimeUnavailable(this.connection);
			}
			const failure = invalidRuntimeValue(
				'runtime.hostOperation.response',
				error instanceof Error ? error.message : error,
			);
			this.markInvalid(failure, true);
			throw this.failure ?? failure;
		}
	}

	private assertConnectedState(state: AgentRuntimeConnectionState, field: string): void {
		if (
			state.kind !== 'connected'
			|| state.connection !== this.connection.connection
			|| state.generation !== this.connection.generation
		) {
			throwInvalidRuntimeValue(field, state.kind);
		}
	}

	private handleDisconnect(
		event: Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>,
	): void {
		if (this.status === 'disposed' || this.status === 'invalid') {
			return;
		}
		const current = this.connection.state;
		if (
			event.connection !== this.connection.connection
			|| event.generation !== this.connection.generation
			|| current.kind !== 'disconnected'
			|| current.connection !== event.connection
			|| current.generation !== event.generation
			|| current.reason !== event.reason
		) {
			this.markInvalid(invalidRuntimeValue('runtime.disconnect.correlation', event.generation), true);
			return;
		}
		this.markInvalid(runtimeUnavailable(this.connection), false);
	}

	private handleAction(envelope: IAgentRuntimeAction): void {
		if (this.status !== 'active') {
			if (this.status === 'initializing') {
				this.markInvalid(invalidRuntimeValue('runtime.action.state', this.status), true);
			}
			return;
		}
		try {
			assertTransportBound(envelope, 'runtime.action', this.transportLimits.maximumActionBytes);
			createAgentRuntimeConnectionId(envelope.connection);
			createAgentRuntimeConnectionGeneration(envelope.generation);
			createAgentRuntimeActionSequence(envelope.sequence);
			createAgentRuntimeCallId(envelope.call);
			createAgentRuntimeRegistrationRevision(envelope.registration);
			createAgentId(envelope.agent);
			if (
				envelope.connection !== this.connection.connection
				|| envelope.generation !== this.connection.generation
				|| envelope.sequence !== this.expectedActionSequence
			) {
				throw invalidRuntimeValue('runtime.action.correlation', envelope.sequence);
			}
			const pending = this.pendingCalls.get(envelope.call);
			const agent = this.agentsById.get(envelope.agent);
			if (
				pending === undefined
				|| agent === undefined
				|| pending.agent !== envelope.agent
				|| pending.registration !== envelope.registration
				|| agent.registration.revision !== envelope.registration
			) {
				throw invalidRuntimeValue('runtime.action.call', envelope.call);
			}
			this.validateAction(envelope.action, pending, agent.registration);
			this.expectedActionSequence += 1;
			if (!Number.isSafeInteger(this.expectedActionSequence)) {
				throw invalidRuntimeValue('runtime.action.sequence', this.expectedActionSequence);
			}
			agent.acceptAction(envelope.action);
		} catch (error) {
			this.markInvalid(
				error instanceof AgentHostError
					? error
					: invalidRuntimeValue('runtime.action', error instanceof Error ? error.message : error),
				true,
			);
		}
	}

	private validateAction(
		action: IAgentAction,
		pending: IPendingConnectedAgentCall,
		registration: IAgentRuntimeRegistration,
	): void {
		createAgentSessionId(action.session);
		if (pending.session !== action.session) {
			throw invalidRuntimeValue('runtime.action.session', action.session);
		}
		if (action.kind === 'sessionResumeStateChanged') {
			assertExactKeys(action, ['kind', 'session', 'resume'], [], 'runtime.action');
			if (!pending.allowsSessionActions) {
				throw invalidRuntimeValue('runtime.action.kind', action.kind);
			}
			validateResumeState(action.resume, registration, 'runtime.action.resume');
			return;
		}
		createAgentChatId(action.chat);
		if (pending.chat !== action.chat) {
			throw invalidRuntimeValue('runtime.action.chat', action.chat);
		}
		if (action.kind === 'chatResumeStateChanged') {
			assertExactKeys(action, ['kind', 'session', 'chat', 'resume'], [], 'runtime.action');
			if (!pending.allowsChatActions) {
				throw invalidRuntimeValue('runtime.action.kind', action.kind);
			}
			validateResumeState(action.resume, registration, 'runtime.action.resume');
			return;
		}
		if (!pending.allowsTurnActions) {
			throw invalidRuntimeValue('runtime.action.kind', action.kind);
		}
		createAgentTurnId(action.turn);
		if (pending.turn !== action.turn) {
			throw invalidRuntimeValue('runtime.action.turn', action.turn);
		}
		const send = [...this.pendingCalls.values()].find(candidate =>
			candidate.kind === 'chat.send'
			&& candidate.agent === pending.agent
			&& candidate.session === action.session
			&& candidate.chat === action.chat
			&& candidate.turn === action.turn,
		);
		if (send === undefined) {
			throw invalidRuntimeValue('runtime.action.turn.parentSend', action.turn);
		}
		if (send.exactTurnTerminalAccepted) {
			throw invalidRuntimeValue('runtime.action.turn', 'terminal');
		}
		if (action.kind === 'turnProgress') {
			assertExactKeys(action, ['kind', 'session', 'chat', 'turn', 'progress'], [], 'runtime.action');
			assertTurnProgress(action.progress, 'runtime.action.progress');
			return;
		}
		if (action.kind !== 'turnTerminal') {
			throw invalidRuntimeValue('runtime.action.kind', (action as { readonly kind?: unknown }).kind);
		}
		assertExactKeys(action, ['kind', 'session', 'chat', 'turn', 'state'], ['data'], 'runtime.action');
		if (action.state !== 'completed' && action.state !== 'cancelled' && action.state !== 'failed') {
			throw invalidRuntimeValue('runtime.action.state', action.state);
		}
		if (action.data !== undefined) {
			assertAgentHostProtocolValue(action.data);
		}
		send.exactTurnTerminalAccepted = true;
		send.hostOperationsOpen = false;
	}

	private invalidateProtocol(field: string, value: unknown): never {
		return this.fail(invalidRuntimeValue(field, value), true);
	}

	private markInvalid(error: Error, disposeConnection: boolean): void {
		if (this.status !== 'invalid' && this.status !== 'disposed') {
			this.status = 'invalid';
			this.failure = error;
			if (this.initializationDisconnect !== undefined && !this.initializationDisconnect.isSettled) {
				this.initializationDisconnect.error(error);
			}
			for (const pending of this.pendingCalls.values()) {
				if (!pending.disconnected.isSettled) {
					pending.disconnected.error(error);
				}
			}
			for (const operation of this.hostOperations.values()) {
				if (operation.executionState === 'pending') {
					operation.cancellation.cancel();
				}
			}
			if (disposeConnection) {
				this.disposeConnection();
			}
		}
	}

	private disposeConnection(): void {
		if (!this.connectionDisposed) {
			this.connectionDisposed = true;
			this.connection.dispose();
		}
	}

	private cleanupContentResources(): void {
		if (this.contentCleanupStarted) {
			return;
		}
		this.contentCleanupStarted = true;
		const operations = [...this.hostOperations.values()];
		void this.waitForHostOperationExecutions(operations).then(async () => {
			const materializations = [...this.contentMaterializations.keys()];
			const leases = [...this.contentLeases.keys()];
			await this.releaseContentResources(materializations, leases);
		}).catch(error => {
			if (this.failure === undefined) {
				onUnexpectedError(error);
			}
		});
	}

	private fail(error: Error, disposeConnection: boolean): never {
		this.markInvalid(error, disposeConnection);
		throw this.failure ?? error;
	}

	override dispose(): void {
		if (this.status === 'disposed') {
			return;
		}
		this.status = 'disposed';
		const error = this.failure ?? runtimeUnavailable(this.connection);
		if (this.initializationDisconnect !== undefined && !this.initializationDisconnect.isSettled) {
			this.initializationDisconnect.error(error);
		}
		for (const pending of this.pendingCalls.values()) {
			if (!pending.disconnected.isSettled) {
				pending.disconnected.error(error);
			}
		}
		for (const operation of this.hostOperations.values()) {
			if (operation.executionState === 'pending') {
				operation.cancellation.cancel();
			}
		}
		this.cleanupContentResources();
		super.dispose();
		this.disposeConnection();
	}
}

/** Negotiates one exact connected runtime generation and returns its Agent projections. */
export async function connectAgentRuntime(options: IConnectedAgentRuntimeOptions): Promise<IConnectedAgentRuntime> {
	return ConnectedAgentRuntime.connect(options);
}

function validateOperationContext(operation: AgentHostOperationId, payloadDigest: string): void {
	createAgentHostOperationId(operation);
	createAgentHostPayloadDigest(payloadDigest);
}

function validateExecutionProfile(
	profile: IAgentExecutionProfile,
	connected: IConnectedAgentRegistration,
): IAgentExecutionProfile {
	createAgentExecutionProfileRevision(profile.revision);
	createAgentExecutionProfileDigest(profile.digest);
	createAgentDescriptorRevision(profile.agentDescriptor);
	createAgentModelDescriptorRevision(profile.modelDescriptor);
	if (
		profile.agentDescriptor !== connected.registration.descriptorRevision
		|| !connected.descriptor.models.some(model => model.revision === profile.modelDescriptor)
		|| typeof profile.data !== 'string'
	) {
		throwInvalidRuntimeValue('runtime.executionProfile', profile.revision);
	}
	return Object.freeze({ ...profile });
}

function validateSessionBacking(
	backing: IAgentSessionBacking,
	session: AgentSessionId,
	connected: IConnectedAgentRegistration,
): IAgentSessionBacking {
	createAgentSessionId(backing.session);
	if (backing.session !== session) {
		throwInvalidRuntimeValue('runtime.sessionBacking.session', backing.session);
	}
	validateResumeState(backing.resume, connected.registration, 'runtime.sessionBacking.resume');
	return Object.freeze({
		session: backing.session,
		...(backing.resume === undefined ? {} : { resume: Object.freeze({ ...backing.resume }) }),
	});
}

function validateChatBacking(
	backing: IAgentChatBacking,
	session: AgentSessionId,
	chat: AgentChatId,
	connected: IConnectedAgentRegistration,
): IAgentChatBacking {
	createAgentSessionId(backing.session);
	createAgentChatId(backing.chat);
	if (backing.session !== session || backing.chat !== chat) {
		throwInvalidRuntimeValue('runtime.chatBacking', `${backing.session}:${backing.chat}`);
	}
	validateResumeState(backing.resume, connected.registration, 'runtime.chatBacking.resume');
	return Object.freeze({
		session: backing.session,
		chat: backing.chat,
		...(backing.resume === undefined ? {} : { resume: Object.freeze({ ...backing.resume }) }),
	});
}

function validateNullResponse(value: null): void {
	if (value !== null) {
		throwInvalidRuntimeValue('runtime.response.value', value);
	}
}

class ConnectedAgent extends Disposable implements IAgent {
	readonly id: AgentId;
	readonly descriptor: IObservable<IAgentDescriptor>;
	readonly registration: IAgentRuntimeRegistration;

	private readonly actionEmitter = this._register(new Emitter<IAgentAction>());
	readonly onDidEmitAction: Event<IAgentAction> = this.actionEmitter.event;

	readonly executionProfiles: IAgentExecutionProfiles;
	readonly sessions: IAgentSessions;
	readonly chats: IAgentChats;
	readonly resumeStates: IAgentResumeStates;

	constructor(
		private readonly runtime: ConnectedAgentRuntime,
		readonly connected: IConnectedAgentRegistration,
	) {
		super();
		this.id = connected.registration.agentId;
		this.registration = connected.registration;
		this.descriptor = observableValue(`ConnectedAgent.${this.id}.descriptor`, connected.descriptor);
		this.executionProfiles = {
			resolve: request => this.resolveExecutionProfile(request),
		};
		this.sessions = {
			create: request => this.createSession(request),
			materialize: request => this.materializeSession(request),
			release: request => this.releaseSession(request),
			delete: request => this.deleteSession(request),
		};
		this.chats = {
			create: request => this.createChat(request),
			materialize: request => this.materializeChat(request),
			release: request => this.releaseChat(request),
			fork: request => this.forkChat(request),
			send: request => this.send(request),
			steer: request => this.steer(request),
			cancel: request => this.cancel(request),
			delete: request => this.deleteChat(request),
		};
		this.resumeStates = {
			migrate: request => this.migrateResumeState(request),
		};
	}

	acceptAction(action: IAgentAction): void {
		this.actionEmitter.fire(action);
	}

	private async resolveExecutionProfile(request: IAgentExecutionProfileRequest): Promise<IAgentExecutionProfile> {
		createAgentSubmissionId(request.submission);
		createAgentHostPayloadDigest(request.selectionDigest);
		createAgentRuntimeRegistrationRevision(request.runtimeRegistration);
		assertAgentHostProtocolValue(request.selection);
		if (request.runtimeRegistration !== this.registration.revision) {
			throwInvalidRuntimeValue('runtime.executionProfile.runtimeRegistration', request.runtimeRegistration);
		}
		return this.runtime.invoke(
			this.connected,
			request,
			{
				kind: 'executionProfile.resolve',
				allowsSessionActions: false,
				allowsChatActions: false,
				allowsTurnActions: false,
			},
			call => this.runtime.connection.resolveExecutionProfile(call),
			value => validateExecutionProfile(value, this.connected),
		);
	}

	private async migrateResumeState(request: IAgentResumeMigrationRequest): Promise<IAgentResumeState> {
		createAgentPackageOperationId(request.operation);
		createAgentPackageId(request.backing.packageId);
		createAgentId(request.backing.agentId);
		createAgentSessionId(request.backing.sessionId);
		if (request.backing.chatId !== undefined) {
			createAgentChatId(request.backing.chatId);
		}
		createAgentResumeSchemaId(request.source.schema);
		createAgentResumeStateDigest(request.sourceDigest);
		createAgentResumeSchemaId(request.targetSchema);
		if (
			request.backing.packageId !== this.registration.packageId
			|| request.backing.agentId !== this.id
			|| !this.registration.resumeMigrationEdges.some(edge => (
				edge.sourceSchema === request.source.schema && edge.targetSchema === request.targetSchema
			))
		) {
			throwInvalidRuntimeValue('runtime.resumeMigration', request.targetSchema);
		}
		return this.runtime.invoke(
			this.connected,
			request,
			{
				kind: 'resumeState.migrate',
				operation: request.operation,
				session: request.backing.sessionId,
				chat: request.backing.chatId,
				allowsSessionActions: false,
				allowsChatActions: false,
				allowsTurnActions: false,
			},
			call => this.runtime.connection.migrateResumeState(call),
			value => {
				validateResumeState(value, this.registration, 'runtime.resumeMigration.response');
				if (value.schema !== request.targetSchema) {
					throwInvalidRuntimeValue('runtime.resumeMigration.response.schema', value.schema);
				}
				return Object.freeze({ ...value });
			},
		);
	}

	private async createSession(request: IAgentCreateSessionOptions): Promise<IAgentSessionBacking> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		return this.runtime.invoke(
			this.connected,
			request,
			sessionContext('session.create', request.operation, request.session, true),
			call => this.runtime.connection.createSession(call),
			value => validateSessionBacking(value, request.session, this.connected),
		);
	}

	private async materializeSession(request: IAgentMaterializeSessionRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		validateResumeState(request.resume, this.registration, 'runtime.materializeSession.resume');
		await this.runtime.invoke(
			this.connected,
			request,
			sessionContext('session.materialize', request.operation, request.session, true),
			call => this.runtime.connection.materializeSession(call),
			validateNullResponse,
		);
	}

	private async releaseSession(request: IAgentReleaseSessionRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		await this.runtime.invoke(
			this.connected,
			request,
			sessionContext('session.release', request.operation, request.session, true),
			call => this.runtime.connection.releaseSession(call),
			validateNullResponse,
		);
	}

	private async deleteSession(request: IAgentDeleteSessionRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		await this.runtime.invoke(
			this.connected,
			request,
			sessionContext('session.delete', request.operation, request.session, false),
			call => this.runtime.connection.deleteSession(call),
			validateNullResponse,
		);
	}

	private async createChat(request: IAgentCreateChatOptions): Promise<IAgentChatBacking> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		validateOrigin(request.origin);
		return this.runtime.invoke(
			this.connected,
			request,
			chatContext('chat.create', request.operation, request.session, request.chat, true),
			call => this.runtime.connection.createChat(call),
			value => validateChatBacking(value, request.session, request.chat, this.connected),
		);
	}

	private async materializeChat(request: IAgentMaterializeChatRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		validateResumeState(request.resume, this.registration, 'runtime.materializeChat.resume');
		await this.runtime.invoke(
			this.connected,
			request,
			chatContext('chat.materialize', request.operation, request.session, request.chat, true),
			call => this.runtime.connection.materializeChat(call),
			validateNullResponse,
		);
	}

	private async releaseChat(request: IAgentReleaseChatRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		await this.runtime.invoke(
			this.connected,
			request,
			chatContext('chat.release', request.operation, request.session, request.chat, true),
			call => this.runtime.connection.releaseChat(call),
			validateNullResponse,
		);
	}

	private async forkChat(request: IAgentForkChatRequest): Promise<IAgentChatBacking> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		createAgentChatId(request.source.chat);
		createAgentTurnId(request.source.turn);
		return this.runtime.invoke(
			this.connected,
			request,
			chatContext('chat.fork', request.operation, request.session, request.chat, true),
			call => this.runtime.connection.forkChat(call),
			value => validateChatBacking(value, request.session, request.chat, this.connected),
		);
	}

	private async send(request: IAgentChatRequest): Promise<void> {
		this.validateTurnRequest(request);
		await this.runtime.invoke(
			this.connected,
			request,
			turnContext('chat.send', request.operation, request.session, request.chat, request.turn, request),
			call => this.runtime.connection.send(call),
			validateNullResponse,
		);
	}

	private async steer(request: IAgentSteerRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		createAgentTurnId(request.turn);
		if (typeof request.message !== 'string') {
			throwInvalidRuntimeValue('runtime.steer.message', request.message);
		}
		await this.runtime.invoke(
			this.connected,
			request,
			turnContext('chat.steer', request.operation, request.session, request.chat, request.turn),
			call => this.runtime.connection.steer(call),
			validateNullResponse,
		);
	}

	private async cancel(request: IAgentCancelTurnRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		createAgentTurnId(request.turn);
		await this.runtime.invoke(
			this.connected,
			request,
			turnContext('chat.cancel', request.operation, request.session, request.chat, request.turn),
			call => this.runtime.connection.cancel(call),
			validateNullResponse,
		);
	}

	private async deleteChat(request: IAgentDeleteChatRequest): Promise<void> {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		await this.runtime.invoke(
			this.connected,
			request,
			chatContext('chat.delete', request.operation, request.session, request.chat, false),
			call => this.runtime.connection.deleteChat(call),
			validateNullResponse,
		);
	}

	private validateTurnRequest(request: IAgentChatRequest): void {
		validateOperationContext(request.operation, request.payloadDigest);
		createAgentSessionId(request.session);
		createAgentChatId(request.chat);
		createAgentTurnId(request.turn);
		createAgentSubmissionId(request.submission);
		if (typeof request.message !== 'string') {
			throwInvalidRuntimeValue('runtime.send.message', request.message);
		}
		for (const attachment of request.attachments) {
			assertAgentHostAttachment(attachment);
		}
		for (const target of request.interactionTargets) {
			assertAgentHostInteractionTarget(target);
		}
		createAgentRuntimeRegistrationRevision(request.binding.runtimeRegistration);
		createAgentCancellationId(request.binding.cancellation);
		if (
			request.binding.runtimeRegistration !== this.registration.revision
			|| !Number.isFinite(request.binding.deadline)
			|| request.binding.deadline <= 0
		) {
			throwInvalidRuntimeValue('runtime.send.binding', request.binding.runtimeRegistration);
		}
		assertAgentHostProtocolValue(request.binding.outputConstraints);
		validateResumeState(request.binding.resume, this.registration, 'runtime.send.binding.resume');
		const profile = validateExecutionProfile(request.binding.profile, this.connected);
		const toolSet = request.binding.toolSet;
		createAgentToolSetRevision(toolSet.revision);
		createAgentToolSchemaProfileId(toolSet.schemaProfile);
		createAgentRuntimeRegistrationRevision(toolSet.runtimeRegistration);
		createAgentDescriptorRevision(toolSet.agentDescriptor);
		createAgentModelDescriptorRevision(toolSet.modelDescriptor);
		const model = this.connected.descriptor.models.find(candidate => candidate.revision === profile.modelDescriptor);
		if (
			toolSet.runtimeRegistration !== this.registration.revision
			|| toolSet.agentDescriptor !== this.registration.descriptorRevision
			|| toolSet.modelDescriptor !== profile.modelDescriptor
			|| model === undefined
			|| !model.toolSchemaProfiles.includes(toolSet.schemaProfile)
		) {
			throwInvalidRuntimeValue('runtime.send.binding.toolSet', toolSet.revision);
		}
		const registrationIds = new Set<string>();
		for (const [index, registration] of toolSet.registrations.entries()) {
			createAgentToolRegistrationId(registration.id);
			createAgentToolRegistrationRevision(registration.revision);
			createAgentToolId(registration.descriptor.id);
			createAgentToolDescriptorRevision(registration.descriptor.revision);
			if (
				registrationIds.has(registration.id)
				|| registration.descriptor.inputSchema.profile !== toolSet.schemaProfile
				|| registration.descriptor.outputSchema.profile !== toolSet.schemaProfile
			) {
				throwInvalidRuntimeValue(`runtime.send.binding.toolSet.registrations.${index}`, registration.id);
			}
			assertAgentHostProtocolValue(registration.descriptor.inputSchema.value);
			assertAgentHostProtocolValue(registration.descriptor.outputSchema.value);
			registrationIds.add(registration.id);
		}
	}
}
