/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import type {
	IAgentBackingIdentity,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentRuntimeRegistration,
} from 'cs/platform/agentHost/common/agent';
import {
	AgentHostPayloadDigest,
	AgentId,
	AgentPackageId,
	AgentPackageOperationId,
	AgentResumeStateDigest,
	createAgentCapabilityRevision,
	createAgentChatId,
	createAgentDescriptorRevision,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentResumeSchemaId,
	createAgentResumeStateDigest,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolSchemaProfileId,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	AgentPackageOperationOutcome,
	AgentPackageOperationKind,
	AgentPackagePersistedOperation,
	IDeleteAgentPackageDataRequest,
	IInstallAgentPackageRequest,
	IAgentPackageBackingRecord,
	IAgentPackageLifecycleSnapshot,
	IAgentPackageOffering,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
	IAgentPackageOperationFailure,
	IAgentPackageOperationResult,
	IAgentPackagePersistedState,
	IAgentPackageRuntimeTransition,
	IAgentPackageTarget,
	IInstalledAgentPackage,
	IPurgeAgentPackageHostRecordsRequest,
	IUninstallAgentPackageRequest,
	IUpdateAgentPackageRequest,
} from 'cs/platform/agentHost/common/packages';
import { assertAgentPackageOperationOutcome } from 'cs/platform/agentHost/common/packages';
import type { IVerifiedAgentPackage } from './agentPackageTypes.js';
import {
	validateAndFreezeAgentPackage,
	validateAndFreezeInstalledAgentPackage,
} from './agentPackageValidation.js';

const MAXIMUM_RESUME_STATE_BYTES = 1_048_576;
const MAXIMUM_PERSISTED_PACKAGE_OPERATIONS = 4_096;

/** Persists one complete authoritative package state with revision preconditioning. */
export interface IAgentPackageStateStore {
	read(): Promise<IAgentPackagePersistedState | undefined>;
	commit(
		expectedRevision: number | undefined,
		state: IAgentPackagePersistedState,
	): Promise<void>;
}

/** Stages and verifies one complete package revision without activating it. */
export interface IAgentPackageArtifactPort {
	stage(
		offering: IAgentPackageOffering,
		operationId: AgentPackageOperationId,
	): Promise<IVerifiedAgentPackage>;
	discard(
		verifiedPackage: IVerifiedAgentPackage,
		operationId: AgentPackageOperationId,
	): Promise<void>;
}

/** Negotiates staged runtimes and owns Agent-backed lifecycle operations. */
export interface IAgentPackageRuntimePort {
	prepareActivation(
		installedPackage: IInstalledAgentPackage | null,
		previous: IAgentPackageRuntimeTransition['previous'],
		operationId: AgentPackageOperationId,
	): Promise<readonly IAgentRuntimeRegistration[]>;
	commitActivation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void>;
	retirePreviousActivation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void>;
	rollbackActivation(
		operationId: AgentPackageOperationId,
		transition: IAgentPackageRuntimeTransition,
	): Promise<void>;
	migrateResumeState(
		registration: IAgentRuntimeRegistration,
		request: IAgentResumeMigrationRequest,
	): Promise<IAgentResumeState>;
	deleteBacking(
		registration: IAgentRuntimeRegistration,
		identity: IAgentBackingIdentity,
		operationId: AgentPackageOperationId,
	): Promise<void>;
}

/** Owns a package-wide gate until the caller completes or rolls back the mutation. */
export interface IAgentPackageMutation {
	drain(): Promise<void>;
	checkpointAndRelease(
		records: readonly IAgentPackageBackingRecord[],
	): Promise<readonly IAgentPackageBackingRecord[]>;
	prepareActivation(registrations: readonly IAgentRuntimeRegistration[]): Promise<void>;
	commitBackingDeletion(identity: IAgentBackingIdentity): Promise<void>;
	rollback(): Promise<void>;
	complete(): Promise<void>;
}

/** Acquires one mutation gate over the exact affected Agent IDs. */
export interface IAgentPackageLifecyclePort {
	acquirePackageMutation(
		operationId: AgentPackageOperationId,
		requestDigest: AgentHostPayloadDigest,
		agentIds: readonly AgentId[],
	): Promise<IAgentPackageMutation>;
	commitHostRecordPurge(
		operationId: AgentPackageOperationId,
		requestDigest: AgentHostPayloadDigest,
		records: readonly IAgentBackingIdentity[],
	): Promise<void>;
}

export interface IAgentPackageHostBackingState {
	readonly retainedBackingRecords: readonly IAgentPackageBackingRecord[];
	readonly materializedBackings: readonly IAgentBackingIdentity[];
}

export interface IAgentPackageHostBackingStateRequest extends IAgentPackageHostBackingState {
	readonly expectedStateRevision: number;
}

/** Holds the package-state side of one Host catalog backing commit until it completes or rolls back. */
export interface IAgentPackageHostBackingTransaction {
	complete(): void;
	rollback(): Promise<void>;
}

export interface IBundledCometPackage {
	readonly verifiedPackage: IVerifiedAgentPackage;
	readonly registrations: readonly IAgentRuntimeRegistration[];
}

export interface IAgentPackageLifecycleOptions {
	readonly hostTarget: IAgentPackageTarget;
	readonly installablePackages: readonly IAgentPackageOffering[];
	readonly bundledComet: IBundledCometPackage;
	readonly stateStore: IAgentPackageStateStore;
	readonly artifactPort: IAgentPackageArtifactPort;
	readonly runtimePort: IAgentPackageRuntimePort;
}

interface IAgentPackageOperationExecutionRequest {
	readonly operationId: AgentPackageOperationId;
	readonly requestDigest: AgentHostPayloadDigest;
	readonly packageId: AgentPackageId;
}

interface IRecordedPackageOperation {
	persisted: AgentPackagePersistedOperation;
	pending?: Promise<IAgentPackageOperationResult>;
	retryRequired: boolean;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function offeringKey(offering: IAgentPackageOffering): string {
	return [
		offering.packageId,
		offering.revision,
		offering.contentDigest,
		offering.source,
		offering.distribution,
	].join('\u0000');
}

function backingKey(identity: IAgentBackingIdentity): string {
	return [
		identity.packageId,
		identity.agentId,
		identity.sessionId,
		identity.chatId ?? '',
	].join('\u0000');
}

function backingLogicalKey(identity: IAgentBackingIdentity): string {
	return [identity.sessionId, identity.chatId ?? ''].join('\u0000');
}

function packageAgentKey(packageId: AgentPackageId, agentId: AgentId): string {
	return `${packageId}\u0000${agentId}`;
}

function assertSafeRevision(revision: number): void {
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Invalid package state revision',
			{ actual: revision },
		);
	}
}

function freezeIdentity(identity: IAgentBackingIdentity): IAgentBackingIdentity {
	return Object.freeze({ ...identity });
}

function freezeResumeState(state: IAgentResumeState): IAgentResumeState {
	return Object.freeze({ ...state });
}

function freezeBackingRecord(record: IAgentPackageBackingRecord): IAgentPackageBackingRecord {
	return Object.freeze({
		identity: freezeIdentity(record.identity),
		resumeState: record.resumeState ? freezeResumeState(record.resumeState) : undefined,
		resumeStateDigest: record.resumeStateDigest,
	});
}

function freezeRegistration(
	registration: IAgentRuntimeRegistration,
): IAgentRuntimeRegistration {
	return Object.freeze({
		...registration,
		supportedToolSchemaProfiles: Object.freeze([...registration.supportedToolSchemaProfiles]),
		supportedResumeSchemas: Object.freeze([...registration.supportedResumeSchemas]),
		resumeMigrationEdges: Object.freeze(
			registration.resumeMigrationEdges.map(edge => Object.freeze({ ...edge })),
		),
	});
}

function freezeOffering(offering: IAgentPackageOffering): IAgentPackageOffering {
	return Object.freeze({ ...offering });
}

function freezePersistedState(
	state: IAgentPackagePersistedState,
): IAgentPackagePersistedState {
	return Object.freeze({
		revision: state.revision,
		catalogRevision: state.catalogRevision,
		operations: Object.freeze([...state.operations]),
		installedPackages: Object.freeze([...state.installedPackages]),
		activeRegistrations: Object.freeze(state.activeRegistrations.map(freezeRegistration)),
		retainedBackingRecords: Object.freeze(state.retainedBackingRecords.map(freezeBackingRecord)),
		materializedBackings: Object.freeze(state.materializedBackings.map(freezeIdentity)),
	});
}

function sameBackingState(
	left: Pick<IAgentPackagePersistedState, 'retainedBackingRecords' | 'materializedBackings'>,
	right: Pick<IAgentPackagePersistedState, 'retainedBackingRecords' | 'materializedBackings'>,
): boolean {
	if (
		left.retainedBackingRecords.length !== right.retainedBackingRecords.length
		|| left.materializedBackings.length !== right.materializedBackings.length
	) {
		return false;
	}
	const rightRecords = new Map(right.retainedBackingRecords.map(record => [backingKey(record.identity), record]));
	for (const record of left.retainedBackingRecords) {
		const other = rightRecords.get(backingKey(record.identity));
		if (
			other === undefined
			|| record.resumeStateDigest !== other.resumeStateDigest
			|| record.resumeState?.schema !== other.resumeState?.schema
			|| record.resumeState?.data !== other.resumeState?.data
		) {
			return false;
		}
	}
	const materializedKeys = new Set(right.materializedBackings.map(backingKey));
	return left.materializedBackings.every(identity => materializedKeys.has(backingKey(identity)));
}

export function computeAgentResumeStateDigest(state: IAgentResumeState): AgentResumeStateDigest {
	const digest = createHash('sha256')
		.update(JSON.stringify([state.schema, state.data]))
		.digest('hex');
	return createAgentResumeStateDigest(`sha256:${digest}`);
}

function assertResumeState(record: IAgentPackageBackingRecord): void {
	if (!record.resumeState) {
		if (record.resumeStateDigest) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Resume state digest exists without resume state',
				{ record: backingKey(record.identity) },
			);
		}
		return;
	}

	if (
		Buffer.byteLength(record.resumeState.data, 'utf8') > MAXIMUM_RESUME_STATE_BYTES
		|| record.resumeStateDigest !== computeAgentResumeStateDigest(record.resumeState)
	) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Invalid retained Agent resume state',
			{ record: backingKey(record.identity) },
		);
	}
}

function assertRegistrationSet(
	installedPackage: IInstalledAgentPackage,
	registrations: readonly IAgentRuntimeRegistration[],
): readonly IAgentRuntimeRegistration[] {
	const declaredAgents = new Set(installedPackage.manifest.agentIds);
	const registeredAgents = new Set<AgentId>();
	for (const registration of registrations) {
		const fields = [
			'packageId', 'agentId', 'revision', 'descriptorRevision', 'capabilityRevision',
			'supportedToolSchemaProfiles', 'supportedResumeSchemas', 'resumeMigrationEdges',
		];
		if (
			registration === null
			|| typeof registration !== 'object'
			|| Array.isArray(registration)
			|| Object.keys(registration).length !== fields.length
			|| fields.some(field => !Object.hasOwn(registration, field))
			|| !Array.isArray(registration.supportedToolSchemaProfiles)
			|| !Array.isArray(registration.supportedResumeSchemas)
			|| !Array.isArray(registration.resumeMigrationEdges)
		) {
			throw new AgentPackageError(AgentPackageErrorCode.RegistrationInvalid, 'Invalid runtime registration fields');
		}
		createAgentPackageId(registration.packageId);
		createAgentId(registration.agentId);
		createAgentRuntimeRegistrationRevision(registration.revision);
		createAgentDescriptorRevision(registration.descriptorRevision);
		createAgentCapabilityRevision(registration.capabilityRevision);
		for (const profile of registration.supportedToolSchemaProfiles) {
			createAgentToolSchemaProfileId(profile);
		}
		for (const schema of registration.supportedResumeSchemas) {
			createAgentResumeSchemaId(schema);
		}
		for (const edge of registration.resumeMigrationEdges) {
			if (
				edge === null
				|| typeof edge !== 'object'
				|| Array.isArray(edge)
				|| Object.keys(edge).length !== 2
				|| !Object.hasOwn(edge, 'sourceSchema')
				|| !Object.hasOwn(edge, 'targetSchema')
			) {
				throw new AgentPackageError(AgentPackageErrorCode.RegistrationInvalid, 'Invalid runtime resume migration edge');
			}
			createAgentResumeSchemaId(edge.sourceSchema);
			createAgentResumeSchemaId(edge.targetSchema);
		}
		if (
			registration.packageId !== installedPackage.packageId
			|| registration.revision.length === 0
			|| !declaredAgents.has(registration.agentId)
			|| registeredAgents.has(registration.agentId)
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Runtime registration does not match the verified Agent package',
				{ packageId: installedPackage.packageId, agentId: registration.agentId },
			);
		}

		const resumeSchemas = new Set(registration.supportedResumeSchemas);
		if (resumeSchemas.size !== registration.supportedResumeSchemas.length) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Runtime registration declares duplicate resume schemas',
				{ packageId: installedPackage.packageId, agentId: registration.agentId },
			);
		}

		const migrationEdges = new Set<string>();
		for (const edge of registration.resumeMigrationEdges) {
			const edgeKey = `${edge.sourceSchema}\u0000${edge.targetSchema}`;
			if (
				edge.sourceSchema === edge.targetSchema
				|| !resumeSchemas.has(edge.targetSchema)
				|| migrationEdges.has(edgeKey)
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.RegistrationInvalid,
					'Runtime registration declares an invalid resume migration edge',
					{ packageId: installedPackage.packageId, agentId: registration.agentId },
				);
			}
			migrationEdges.add(edgeKey);
		}

		registeredAgents.add(registration.agentId);
	}

	if (registeredAgents.size !== declaredAgents.size) {
		throw new AgentPackageError(
			AgentPackageErrorCode.RegistrationInvalid,
			'Runtime registration is partial for the verified Agent package',
			{ packageId: installedPackage.packageId },
		);
	}

	return Object.freeze(registrations.map(freezeRegistration));
}

function assertNoCrossPackageAgentClaims(
	registrations: readonly IAgentRuntimeRegistration[],
	records: readonly IAgentPackageBackingRecord[],
): void {
	const owningPackageByAgent = new Map<AgentId, AgentPackageId>();
	for (const registration of registrations) {
		const owner = owningPackageByAgent.get(registration.agentId);
		if (owner && owner !== registration.packageId) {
			throw new AgentPackageError(
				AgentPackageErrorCode.AgentIdConflict,
				'Agent ID already has an active runtime registration',
				{ packageId: registration.packageId, agentId: registration.agentId },
			);
		}
		owningPackageByAgent.set(registration.agentId, registration.packageId);
	}

	for (const record of records) {
		const owner = owningPackageByAgent.get(record.identity.agentId);
		if (owner && owner !== record.identity.packageId) {
			throw new AgentPackageError(
				AgentPackageErrorCode.CrossPackageAgentClaim,
				'Another package cannot claim retained Agent backing',
				{
					packageId: owner,
					agentId: record.identity.agentId,
					record: backingKey(record.identity),
				},
			);
		}
		owningPackageByAgent.set(record.identity.agentId, record.identity.packageId);
	}
}

function validatePersistedState(
	state: IAgentPackagePersistedState,
	hostTarget: IAgentPackageTarget,
): IAgentPackagePersistedState {
	const stateFields = [
		'revision', 'catalogRevision', 'operations', 'installedPackages', 'activeRegistrations',
		'retainedBackingRecords', 'materializedBackings',
	];
	if (
		state === null
		|| typeof state !== 'object'
		|| Array.isArray(state)
		|| Object.keys(state).length !== stateFields.length
		|| stateFields.some(field => !Object.hasOwn(state, field))
		|| !Array.isArray(state.operations)
		|| !Array.isArray(state.installedPackages)
		|| !Array.isArray(state.activeRegistrations)
		|| !Array.isArray(state.retainedBackingRecords)
		|| !Array.isArray(state.materializedBackings)
	) {
		throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent package persisted state fields');
	}
	assertSafeRevision(state.revision);
	assertSafeRevision(state.catalogRevision);
	if (state.catalogRevision > state.revision) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Agent package catalog revision exceeds its storage revision',
			{ catalogRevision: state.catalogRevision, revision: state.revision },
		);
	}
	const operations = validatePersistedOperations(state.operations, hostTarget);

	const packagesById = new Map<AgentPackageId, IInstalledAgentPackage>();
	const installedPackages: IInstalledAgentPackage[] = [];
	let bundledPackageCount = 0;
	for (const installedPackage of state.installedPackages) {
		if (packagesById.has(installedPackage.packageId)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Duplicate installed Agent package',
				{ packageId: installedPackage.packageId },
			);
		}

		const validatedPackage = validateAndFreezeInstalledAgentPackage(installedPackage, hostTarget);
		if (validatedPackage.distribution === 'bundled') {
			bundledPackageCount += 1;
		}
		packagesById.set(validatedPackage.packageId, validatedPackage);
		installedPackages.push(validatedPackage);
	}

	if (bundledPackageCount !== 1 || !packagesById.has('comet' as AgentPackageId)) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Installed state must contain exactly one bundled Comet package',
		);
	}

	const registrationsByPackage = new Map<AgentPackageId, IAgentRuntimeRegistration[]>();
	for (const registration of state.activeRegistrations) {
		const registrations = registrationsByPackage.get(registration.packageId) ?? [];
		registrations.push(registration);
		registrationsByPackage.set(registration.packageId, registrations);
	}

	const activeRegistrations: IAgentRuntimeRegistration[] = [];
	for (const installedPackage of installedPackages) {
		const registrations = assertRegistrationSet(
			installedPackage,
			registrationsByPackage.get(installedPackage.packageId) ?? [],
		);
		activeRegistrations.push(...registrations);
		registrationsByPackage.delete(installedPackage.packageId);
	}
	if (registrationsByPackage.size !== 0) {
		throw new AgentPackageError(
			AgentPackageErrorCode.RegistrationInvalid,
			'Active runtime registration has no installed Agent package',
		);
	}

	const retainedRecords: IAgentPackageBackingRecord[] = [];
	const recordKeys = new Set<string>();
	const logicalRecordKeys = new Set<string>();
	for (const record of state.retainedBackingRecords) {
		const fields = record.resumeState === undefined
			? ['identity']
			: ['identity', 'resumeState', 'resumeStateDigest'];
		if (
			record === null
			|| typeof record !== 'object'
			|| Array.isArray(record)
			|| Object.keys(record).length !== fields.length
			|| fields.some(field => !Object.hasOwn(record, field))
		) {
			throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid retained Agent backing record fields');
		}
		assertBackingIdentityShape(record.identity);
		if (record.resumeState !== undefined) {
			if (
				record.resumeState === null
				|| typeof record.resumeState !== 'object'
				|| Array.isArray(record.resumeState)
				|| Object.keys(record.resumeState).length !== 2
				|| !Object.hasOwn(record.resumeState, 'schema')
				|| !Object.hasOwn(record.resumeState, 'data')
			) {
				throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid retained Agent resume state fields');
			}
			createAgentResumeSchemaId(record.resumeState.schema);
			if (typeof record.resumeState.data !== 'string') {
				throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid retained Agent resume state data');
			}
			createAgentResumeStateDigest(record.resumeStateDigest!);
		}
		assertResumeState(record);
		const key = backingKey(record.identity);
		const logicalKey = backingLogicalKey(record.identity);
		if (recordKeys.has(key) || logicalRecordKeys.has(logicalKey)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Duplicate retained Agent backing identity',
				{ record: key },
			);
		}
		recordKeys.add(key);
		logicalRecordKeys.add(logicalKey);
		retainedRecords.push(freezeBackingRecord(record));
	}

	assertNoCrossPackageAgentClaims(activeRegistrations, retainedRecords);

	const activeAgentKeys = new Set(
		activeRegistrations.map(registration => packageAgentKey(registration.packageId, registration.agentId)),
	);
	const materializedKeys = new Set<string>();
	const materializedBackings: IAgentBackingIdentity[] = [];
	for (const identity of state.materializedBackings) {
		assertBackingIdentityShape(identity);
		const key = backingKey(identity);
		if (
			materializedKeys.has(key)
			|| !recordKeys.has(key)
			|| !activeAgentKeys.has(packageAgentKey(identity.packageId, identity.agentId))
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Invalid materialized Agent backing identity',
				{ record: key },
			);
		}
		materializedKeys.add(key);
		materializedBackings.push(freezeIdentity(identity));
	}

	return freezePersistedState({
		revision: state.revision,
		catalogRevision: state.catalogRevision,
		operations,
		installedPackages,
		activeRegistrations,
		retainedBackingRecords: retainedRecords,
		materializedBackings,
	});
}

function assertBackingIdentityShape(identity: IAgentBackingIdentity): void {
	const fields = identity.chatId === undefined
		? ['packageId', 'agentId', 'sessionId']
		: ['packageId', 'agentId', 'sessionId', 'chatId'];
	if (
		identity === null
		|| typeof identity !== 'object'
		|| Array.isArray(identity)
		|| Object.keys(identity).length !== fields.length
		|| fields.some(field => !Object.hasOwn(identity, field))
	) {
		throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent backing identity fields');
	}
	createAgentPackageId(identity.packageId);
	createAgentId(identity.agentId);
	createAgentSessionId(identity.sessionId);
	if (identity.chatId !== undefined) {
		createAgentChatId(identity.chatId);
	}
}

function invalidOperationLedger(message: string): never {
	throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, message);
}

function validatePersistedOperations(
	value: unknown,
	hostTarget: IAgentPackageTarget,
): readonly AgentPackagePersistedOperation[] {
	if (
		!Array.isArray(value)
		|| value.length > MAXIMUM_PERSISTED_PACKAGE_OPERATIONS
	) {
		return invalidOperationLedger('Invalid Agent package operation ledger');
	}

	const operations: AgentPackagePersistedOperation[] = [];
	const operationIds = new Set<AgentPackageOperationId>();
	for (const [index, candidate] of value.entries()) {
		if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
			return invalidOperationLedger(`Invalid Agent package operation ledger record '${index}'`);
		}
		const required = candidate.status === 'pending'
			? candidate.phase === 'recorded'
				? ['operation', 'digest', 'kind', 'packageId', 'affectedRecords', 'status', 'phase']
				: ['runtimePrepared', 'runtimeCommitted', 'catalogCommitted'].includes(candidate.phase)
					? ['operation', 'digest', 'kind', 'packageId', 'affectedRecords', 'status', 'phase', 'runtimeTransition']
					: invalidOperationLedger(`Invalid Agent package operation phase '${index}'`)
			: candidate.status === 'succeeded'
				? ['operation', 'digest', 'kind', 'packageId', 'affectedRecords', 'status', 'result']
				: candidate.status === 'failed'
					? candidate.phase === 'recorded'
						? ['operation', 'digest', 'kind', 'packageId', 'affectedRecords', 'status', 'phase', 'failure']
						: ['runtimePrepared', 'runtimeCommitted', 'catalogCommitted'].includes(candidate.phase)
							? ['operation', 'digest', 'kind', 'packageId', 'affectedRecords', 'status', 'phase', 'runtimeTransition', 'failure']
							: invalidOperationLedger(`Invalid Agent package operation failure phase '${index}'`)
					: invalidOperationLedger(`Invalid Agent package operation ledger status '${index}'`);
		if (Object.keys(candidate).length !== required.length || Object.keys(candidate).some(key => !required.includes(key))) {
			return invalidOperationLedger(`Invalid Agent package operation ledger fields '${index}'`);
		}
		const operation = createAgentPackageOperationId(candidate.operation);
		const digest = createAgentHostPayloadDigest(candidate.digest);
		const packageId = createAgentPackageId(candidate.packageId);
		if (operationIds.has(operation)) {
			return invalidOperationLedger(`Duplicate Agent package operation '${operation}'`);
		}
		operationIds.add(operation);
		if (
			!['install', 'update', 'uninstall', 'deleteAgentData', 'purgeHostRecords'].includes(candidate.kind)
			|| (candidate.affectedRecords !== null && (
				typeof candidate.affectedRecords !== 'number'
				|| !Number.isSafeInteger(candidate.affectedRecords)
				|| candidate.affectedRecords < 0
			))
		) {
			return invalidOperationLedger(`Invalid Agent package operation metadata '${operation}'`);
		}

		const common = {
			operation,
			digest,
			kind: candidate.kind,
			packageId,
			affectedRecords: candidate.affectedRecords,
		};
		if (candidate.status === 'pending') {
			if (candidate.phase === 'recorded') {
				operations.push(Object.freeze({ ...common, status: 'pending', phase: 'recorded' }));
				continue;
			}
			const runtimeTransition = validateRuntimeTransition(
				candidate.runtimeTransition,
				packageId,
				candidate.kind,
				hostTarget,
			);
			operations.push(Object.freeze({
				...common,
				status: 'pending',
				phase: candidate.phase,
				runtimeTransition,
			}));
			continue;
		}
		const outcome = candidate.status === 'succeeded'
			? Object.freeze({ kind: 'succeeded' as const, result: candidate.result })
			: Object.freeze({ kind: 'failed' as const, failure: candidate.failure });
		assertAgentPackageOperationOutcome({ operation, digest }, outcome);
		if (candidate.status === 'succeeded') {
			if (candidate.result.kind !== candidate.kind || candidate.result.packageId !== packageId) {
				return invalidOperationLedger(`Mismatched Agent package operation result '${operation}'`);
			}
			operations.push(Object.freeze({
				...common,
				status: 'succeeded',
				result: Object.freeze({ ...candidate.result }),
			}));
		} else if (candidate.phase === 'recorded') {
			operations.push(Object.freeze({
				...common,
				status: 'failed',
				phase: 'recorded',
				failure: Object.freeze({ ...candidate.failure }),
			}));
		} else {
			operations.push(Object.freeze({
				...common,
				status: 'failed',
				phase: candidate.phase,
				runtimeTransition: validateRuntimeTransition(
					candidate.runtimeTransition,
					packageId,
					candidate.kind,
					hostTarget,
				),
				failure: Object.freeze({ ...candidate.failure }),
			}));
		}
	}

	return Object.freeze(operations);
}

function validateRuntimeTransition(
	value: unknown,
	packageId: AgentPackageId,
	kind: AgentPackageOperationKind,
	hostTarget: IAgentPackageTarget,
): IAgentPackageRuntimeTransition {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidOperationLedger('Invalid Agent package runtime transition');
	}
	const candidate = value as Readonly<Record<string, unknown>>;
	if (
		Object.keys(candidate).length !== 2
		|| !Object.hasOwn(candidate, 'previous')
		|| !Object.hasOwn(candidate, 'next')
	) {
		return invalidOperationLedger('Invalid Agent package runtime transition fields');
	}
	const validateSide = (side: unknown): IAgentPackageRuntimeTransition['previous'] => {
		if (side === null) {
			return null;
		}
		if (typeof side !== 'object' || Array.isArray(side)) {
			return invalidOperationLedger('Invalid Agent package runtime transition side');
		}
		const record = side as Readonly<Record<string, unknown>>;
		if (
			Object.keys(record).length !== 2
			|| !Object.hasOwn(record, 'installedPackage')
			|| !Object.hasOwn(record, 'registrations')
			|| !Array.isArray(record.registrations)
		) {
			return invalidOperationLedger('Invalid Agent package runtime transition side fields');
		}
		const installedPackage = validateAndFreezeInstalledAgentPackage(record.installedPackage, hostTarget);
		if (installedPackage.packageId !== packageId) {
			return invalidOperationLedger('Agent package runtime transition addresses another package');
		}
		return Object.freeze({
			installedPackage,
			registrations: assertRegistrationSet(
				installedPackage,
				record.registrations as readonly IAgentRuntimeRegistration[],
			),
		});
	};
	const previous = validateSide(candidate.previous);
	const next = validateSide(candidate.next);
	if (
		(kind === 'install' && (previous !== null || next === null))
		|| (kind === 'update' && (previous === null || next === null))
		|| (kind === 'uninstall' && (previous === null || next !== null))
		|| ((kind === 'deleteAgentData' || kind === 'purgeHostRecords') && (previous !== null || next !== null))
	) {
		return invalidOperationLedger('Agent package runtime transition does not match its operation');
	}
	return Object.freeze({ previous, next });
}

function assertExactOffering(
	actual: IAgentPackageOffering,
	expected: IAgentPackageOffering,
): void {
	if (offeringKey(actual) !== offeringKey(expected)) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Staged Agent package does not match the addressed offering',
			{ packageId: expected.packageId },
		);
	}
}

async function throwWithRollback(
	error: Error,
	rollbacks: readonly (() => Promise<void>)[],
): Promise<never> {
	const errors: Error[] = [error];
	for (const rollback of rollbacks) {
		try {
			await rollback();
		} catch (rollbackError) {
			errors.push(toError(rollbackError));
		}
	}

	if (errors.length === 1) {
		throw error;
	}
	throw new AggregateError(errors, 'Agent package operation and rollback failed');
}

async function throwWithConfirmedRollback(
	error: Error,
	rollbacks: readonly (() => Promise<void>)[],
	onConfirmed: () => void,
): Promise<never> {
	const errors: Error[] = [error];
	for (const rollback of rollbacks) {
		try {
			await rollback();
		} catch (rollbackError) {
			errors.push(toError(rollbackError));
		}
	}
	if (errors.length === 1) {
		onConfirmed();
		throw error;
	}
	throw new AggregateError(errors, 'Agent package activation and rollback failed');
}

/** Owns installed package, active registration, retained backing, and operation state. */
export class AgentPackageLifecycle {
	private readonly installableByKey: ReadonlyMap<string, IAgentPackageOffering>;
	private readonly operations = new Map<AgentPackageOperationId, IRecordedPackageOperation>();
	private operationTail = Promise.resolve();
	private stateTail = Promise.resolve();
	private lifecyclePort: IAgentPackageLifecyclePort | undefined;

	private constructor(
		private state: IAgentPackagePersistedState,
		private readonly hostTarget: IAgentPackageTarget,
		installablePackages: readonly IAgentPackageOffering[],
		private readonly stateStore: IAgentPackageStateStore,
		private readonly artifactPort: IAgentPackageArtifactPort,
		private readonly runtimePort: IAgentPackageRuntimePort,
	) {
		this.installableByKey = new Map(
			installablePackages.map(offering => [offeringKey(offering), freezeOffering(offering)]),
		);
		for (const persisted of state.operations) {
			this.operations.set(persisted.operation, {
				persisted,
				retryRequired: persisted.status === 'pending'
					|| (persisted.status === 'failed' && persisted.failure.reconciliation === 'sameOperationRequired'),
			});
		}
	}

	static async create(options: IAgentPackageLifecycleOptions): Promise<AgentPackageLifecycle> {
		const installableKeys = new Set<string>();
		for (const offering of options.installablePackages) {
			if (offering.distribution !== 'user' || installableKeys.has(offeringKey(offering))) {
				throw new AgentPackageError(
					AgentPackageErrorCode.InvalidPackage,
					'Installable catalog contains an invalid offering',
					{ packageId: offering.packageId },
				);
			}
			installableKeys.add(offeringKey(offering));
		}

		const persistedState = await options.stateStore.read();
		let state: IAgentPackagePersistedState;
		if (persistedState) {
			state = validatePersistedState(persistedState, options.hostTarget);
		} else {
			const bundledPackage = validateAndFreezeAgentPackage(
				options.bundledComet.verifiedPackage,
				options.hostTarget,
			);
			if (bundledPackage.distribution !== 'bundled') {
				throw new AgentPackageError(
					AgentPackageErrorCode.InvalidPackage,
					'Initial Comet package must be product-bundled',
					{ packageId: bundledPackage.packageId },
				);
			}
			const registrations = assertRegistrationSet(
				bundledPackage,
				options.bundledComet.registrations,
			);
			state = freezePersistedState({
				revision: 0,
				catalogRevision: 0,
				operations: [],
				installedPackages: [bundledPackage],
				activeRegistrations: registrations,
				retainedBackingRecords: [],
				materializedBackings: [],
			});
			await options.stateStore.commit(undefined, state);
		}
		return new AgentPackageLifecycle(
			state,
			options.hostTarget,
			options.installablePackages,
			options.stateStore,
			options.artifactPort,
			options.runtimePort,
		);
	}

	/** Binds the one authoritative Host lifecycle coordinator before package mutations can run. */
	bindLifecyclePort(lifecyclePort: IAgentPackageLifecyclePort): void {
		if (this.lifecyclePort !== undefined) {
			throw new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Agent package lifecycle already has a Host lifecycle coordinator',
			);
		}
		this.lifecyclePort = lifecyclePort;
	}

	snapshot(): IAgentPackageLifecycleSnapshot {
		return Object.freeze({
			...this.state,
			installablePackages: Object.freeze([...this.installableByKey.values()]),
		});
	}

	execute(request: IAgentPackageOperationRequest): Promise<IAgentPackageOperationResult> {
		const common = {
			operationId: request.operation,
			requestDigest: request.digest,
			packageId: request.payload.packageId,
		};
		switch (request.payload.kind) {
			case 'install': {
				const operation = { ...common, offering: request.payload.offering };
				return this.runOperation(
					'install',
					operation,
					() => this.executeInstall(operation),
					request.expectedCatalogRevision,
				);
			}
			case 'update': {
				const operation = { ...common, offering: request.payload.offering, authority: 'user' as const };
				return this.runOperation(
					'update',
					operation,
					() => this.executeUpdate(operation),
					request.expectedCatalogRevision,
				);
			}
			case 'uninstall':
				return this.runOperation(
					'uninstall',
					common,
					() => this.executeUninstall(common),
					request.expectedCatalogRevision,
				);
			case 'deleteAgentData':
				return this.runOperation(
					'deleteAgentData',
					common,
					() => this.executeDeleteAgentData(common),
					request.expectedCatalogRevision,
				);
			case 'purgeHostRecords': {
				const operation = { ...common, records: request.payload.records };
				return this.runOperation(
					'purgeHostRecords',
					operation,
					() => this.executePurgeRetainedHostRecords(operation),
					request.expectedCatalogRevision,
				);
			}
		}
	}

	install(request: IInstallAgentPackageRequest): Promise<IAgentPackageOperationResult> {
		return this.runOperation('install', request, () => this.executeInstall(request));
	}

	update(request: IUpdateAgentPackageRequest): Promise<IAgentPackageOperationResult> {
		return this.runOperation('update', request, () => this.executeUpdate(request));
	}

	uninstall(request: IUninstallAgentPackageRequest): Promise<IAgentPackageOperationResult> {
		return this.runOperation('uninstall', request, () => this.executeUninstall(request));
	}

	deleteAgentData(
		request: IDeleteAgentPackageDataRequest,
	): Promise<IAgentPackageOperationResult> {
		return this.runOperation(
			'deleteAgentData',
			request,
			() => this.executeDeleteAgentData(request),
		);
	}

	purgeRetainedHostRecords(
		request: IPurgeAgentPackageHostRecordsRequest,
	): Promise<IAgentPackageOperationResult> {
		return this.runOperation(
			'purgeHostRecords',
			request,
			() => this.executePurgeRetainedHostRecords(request),
		);
	}

	getOperationOutcome(request: IAgentPackageOperationOutcomeRequest): AgentPackageOperationOutcome {
		const recorded = this.operations.get(request.operation);
		if (!recorded) {
			return Object.freeze({ kind: 'unknown' });
		}
		if (recorded.persisted.digest !== request.digest) {
			return Object.freeze({ kind: 'conflict', recordedDigest: recorded.persisted.digest });
		}
		if (recorded.pending) {
			return Object.freeze({ kind: 'pending' });
		}
		if (recorded.persisted.status === 'succeeded') {
			return Object.freeze({ kind: 'succeeded', result: recorded.persisted.result });
		}
		if (recorded.persisted.status === 'failed') {
			return Object.freeze({ kind: 'failed', failure: recorded.persisted.failure });
		}
		return Object.freeze({
			kind: 'failed',
			failure: Object.freeze({
				code: AgentPackageErrorCode.StateConflict,
				message: 'Agent package operation was interrupted before its terminal outcome',
				reconciliation: 'sameOperationRequired',
			}),
		});
	}

	/**
	 * Stages the complete Host-owned backing catalog under the package-state revision.
	 * The state lock remains held until the Host catalog commit completes or rolls back.
	 */
	async beginHostBackingStateCommit(
		request: IAgentPackageHostBackingStateRequest,
	): Promise<IAgentPackageHostBackingTransaction> {
		const release = await this.acquireStateLock();
		const previous = this.state;
		try {
			if (request.expectedStateRevision !== previous.revision) {
				throw new AgentPackageError(
					AgentPackageErrorCode.StateConflict,
					'Agent package state revision changed before the Host backing commit',
					{ expected: request.expectedStateRevision, actual: previous.revision },
				);
			}
			const next = validatePersistedState({
				...previous,
				revision: previous.revision + 1,
				catalogRevision: previous.catalogRevision + 1,
				retainedBackingRecords: request.retainedBackingRecords,
				materializedBackings: request.materializedBackings,
			}, this.hostTarget);
			await this.stateStore.commit(previous.revision, next);
			this.acceptState(next);

			let settled = false;
			return Object.freeze({
				complete: () => {
					if (settled) {
						throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Host backing transaction is already settled');
					}
					settled = true;
					release();
				},
				rollback: async () => {
					if (settled) {
						throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Host backing transaction is already settled');
					}
					const restored = validatePersistedState({
						...previous,
						revision: this.state.revision + 1,
						catalogRevision: previous.catalogRevision,
					}, this.hostTarget);
					await this.stateStore.commit(this.state.revision, restored);
					this.acceptState(restored);
					settled = true;
					release();
				},
			});
		} catch (error) {
			release();
			throw error;
		}
	}

	/** Repairs package backing state from the authoritative Host catalog during startup. */
	async reconcileHostBackingState(state: IAgentPackageHostBackingState): Promise<void> {
		const release = await this.acquireStateLock();
		try {
			const next = validatePersistedState({
				...this.state,
				revision: this.state.revision + 1,
				catalogRevision: this.state.catalogRevision + 1,
				retainedBackingRecords: state.retainedBackingRecords,
				materializedBackings: state.materializedBackings,
			}, this.hostTarget);
			if (sameBackingState(this.state, next)) {
				return;
			}
			await this.stateStore.commit(this.state.revision, next);
			this.acceptState(next);
		} finally {
			release();
		}
	}

	private runOperation(
		kind: AgentPackageOperationKind,
		request: IAgentPackageOperationExecutionRequest,
		execute: () => Promise<IAgentPackageOperationResult>,
		expectedCatalogRevision?: number,
	): Promise<IAgentPackageOperationResult> {
		const existing = this.operations.get(request.operationId);
		if (existing) {
			if (
				existing.persisted.digest !== request.requestDigest
				|| existing.persisted.kind !== kind
				|| existing.persisted.packageId !== request.packageId
			) {
				return Promise.reject(this.createOperationConflict(
					request.operationId,
					request.requestDigest,
					existing,
				));
			}
			if (existing.pending) {
				return existing.pending;
			}
			if (existing.persisted.status === 'succeeded') {
				return Promise.resolve(existing.persisted.result);
			}
			if (existing.persisted.status === 'failed' && existing.persisted.failure.reconciliation === 'terminal') {
				return Promise.reject(this.operationFailureError(existing.persisted.failure));
			}
		} else {
			const unresolved = [...this.operations.values()].find(record => (
				record.pending === undefined
				&& (record.persisted.status === 'pending' || (
					record.persisted.status === 'failed'
					&& record.persisted.failure.reconciliation === 'sameOperationRequired'
				))
			));
			if (unresolved !== undefined) {
				return Promise.reject(new AgentPackageError(
					AgentPackageErrorCode.StateConflict,
					'An interrupted Agent package operation must reconcile before another operation begins',
					{ operationId: unresolved.persisted.operation },
				));
			}
		}

		const recorded: IRecordedPackageOperation = existing ?? {
			persisted: Object.freeze({
				operation: request.operationId,
				digest: request.requestDigest,
				kind,
				packageId: request.packageId,
				affectedRecords: null,
				status: 'pending',
				phase: 'recorded',
			}),
			retryRequired: false,
		};
		const pending = this.enqueueOperation(async () => {
			try {
				if (existing === undefined || existing.persisted.status === 'failed') {
					const retryRecord = existing?.persisted;
					if (retryRecord !== undefined && retryRecord.status !== 'failed') {
						throw new Error('Only a failed Agent package operation can enter retry recovery');
					}
					const pendingRecord: AgentPackagePersistedOperation = retryRecord === undefined || retryRecord.phase === 'recorded'
						? Object.freeze({
						operation: request.operationId,
						digest: request.requestDigest,
						kind,
						packageId: request.packageId,
						affectedRecords: existing?.persisted.affectedRecords ?? null,
						status: 'pending',
						phase: 'recorded',
						})
						: Object.freeze({
							operation: request.operationId,
							digest: request.requestDigest,
							kind,
							packageId: request.packageId,
							affectedRecords: retryRecord.affectedRecords,
							status: 'pending',
							phase: retryRecord.phase,
							runtimeTransition: retryRecord.runtimeTransition,
						});
					await this.commitOperationRecord(
						recorded,
						pendingRecord,
						existing === undefined ? expectedCatalogRevision : undefined,
					);
				}
				await execute();
				if (recorded.persisted.status !== 'succeeded') {
					throw new Error('Agent package operation did not atomically commit its successful terminal record');
				}
				return recorded.persisted.result;
			} catch (error) {
				if (recorded.persisted.status === 'succeeded') {
					return recorded.persisted.result;
				}
				if (recorded.persisted.status === 'pending') {
					const failure = this.operationFailure(error, recorded.retryRequired);
					try {
						await this.commitOperationRecord(recorded, Object.freeze({
							...recorded.persisted,
							status: 'failed',
							failure,
						}));
					} catch (persistenceError) {
						throw new AggregateError([error, persistenceError], 'Agent package operation and outcome persistence both failed');
					}
				}
				throw error;
			}
		});
		recorded.pending = pending;
		this.operations.set(request.operationId, recorded);
		void pending.then(
			() => { recorded.pending = undefined; },
			() => { recorded.pending = undefined; },
		);
		return pending;
	}

	private createOperationConflict(
		operationId: AgentPackageOperationId,
		requestDigest: AgentHostPayloadDigest,
		recorded: IRecordedPackageOperation,
	): AgentPackageError {
		return new AgentPackageError(
			AgentPackageErrorCode.OperationConflict,
			'Agent package operation ID was reused with different content',
			{
				operationId,
				expected: recorded.persisted.digest,
				actual: requestDigest,
			},
		);
	}

	private operationFailure(error: unknown, retryRequired: boolean): IAgentPackageOperationFailure {
		const failure = toError(error);
		return Object.freeze({
			code: failure instanceof AgentPackageError ? failure.code : 'internal',
			message: failure.message.slice(0, 2_048),
			...(failure instanceof AgentPackageError ? { data: Object.freeze({ ...failure.data }) } : {}),
			reconciliation: retryRequired ? 'sameOperationRequired' : 'terminal',
		});
	}

	private operationFailureError(failure: IAgentPackageOperationFailure): Error {
		if (Object.values(AgentPackageErrorCode).includes(failure.code as AgentPackageErrorCode)) {
			return new AgentPackageError(
				failure.code as AgentPackageErrorCode,
				failure.message,
				failure.data as Readonly<Record<string, string | number>>,
			);
		}
		return new Error(failure.message);
	}

	private async commitOperationRecord(
		recorded: IRecordedPackageOperation,
		nextRecord: AgentPackagePersistedOperation,
		expectedCatalogRevision: number | undefined = undefined,
	): Promise<void> {
		const release = await this.acquireStateLock();
		try {
			const previous = this.state;
			if (
				expectedCatalogRevision !== undefined
				&& previous.catalogRevision !== expectedCatalogRevision
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.StateConflict,
					'Agent package catalog revision does not match the operation precondition',
					{ expected: expectedCatalogRevision, actual: previous.catalogRevision },
				);
			}
			const operations = [...previous.operations];
			const index = operations.findIndex(candidate => candidate.operation === nextRecord.operation);
			if (index === -1) {
				operations.push(nextRecord);
			} else {
				operations[index] = nextRecord;
			}
			const next = validatePersistedState({
				...previous,
				revision: previous.revision + 1,
				operations,
			}, this.hostTarget);
			await this.stateStore.commit(previous.revision, next);
			this.acceptState(next);
			recorded.persisted = this.operations.get(nextRecord.operation)!.persisted;
		} finally {
			release();
		}
	}

	private replaceOperation(
		operations: readonly AgentPackagePersistedOperation[],
		record: AgentPackagePersistedOperation,
	): readonly AgentPackagePersistedOperation[] {
		const next = [...operations];
		const index = next.findIndex(candidate => candidate.operation === record.operation);
		if (index === -1) {
			next.push(record);
		} else {
			next[index] = record;
		}
		return Object.freeze(next);
	}

	private requireRecordedOperation(
		request: IAgentPackageOperationExecutionRequest,
	): IRecordedPackageOperation {
		const recorded = this.operations.get(request.operationId);
		if (recorded === undefined || recorded.persisted.digest !== request.requestDigest) {
			throw new AgentPackageError(
				AgentPackageErrorCode.OperationNotFound,
				'Agent package operation has no exact durable record',
				{ operationId: request.operationId },
			);
		}
		return recorded;
	}

	private createOperationResult(
		kind: AgentPackageOperationKind,
		request: IAgentPackageOperationExecutionRequest,
		affectedRecords: number,
		catalogRevision: number,
	): IAgentPackageOperationResult {
		return Object.freeze({
			operationId: request.operationId,
			requestDigest: request.requestDigest,
			kind,
			packageId: request.packageId,
			stateRevision: catalogRevision,
			affectedRecords,
		});
	}

	private async commitSuccessfulOperation(
		recorded: IRecordedPackageOperation,
		result: IAgentPackageOperationResult,
	): Promise<void> {
		await this.commitOperationRecord(recorded, Object.freeze({
			operation: recorded.persisted.operation,
			digest: recorded.persisted.digest,
			kind: recorded.persisted.kind,
			packageId: recorded.persisted.packageId,
			affectedRecords: result.affectedRecords,
			status: 'succeeded',
			result,
		}));
	}

	private acceptState(state: IAgentPackagePersistedState): void {
		this.state = state;
		for (const persisted of state.operations) {
			const recorded = this.operations.get(persisted.operation);
			if (recorded === undefined) {
				this.operations.set(persisted.operation, {
					persisted,
					retryRequired: persisted.status === 'pending'
						|| (persisted.status === 'failed' && persisted.failure.reconciliation === 'sameOperationRequired'),
				});
			} else {
				recorded.persisted = persisted;
			}
		}
	}

	private enqueueOperation<TResult>(execute: () => Promise<TResult>): Promise<TResult> {
		const predecessor = this.operationTail;
		let release: (() => void) | undefined;
		this.operationTail = new Promise<void>(resolve => {
			release = resolve;
		});
		return (async () => {
			await predecessor;
			try {
				return await execute();
			} finally {
				release?.();
			}
		})();
	}

	private async acquireStateLock(): Promise<() => void> {
		const predecessor = this.stateTail;
		let release: (() => void) | undefined;
		this.stateTail = new Promise<void>(resolve => {
			release = resolve;
		});
		await predecessor;
		return () => release?.();
	}

	private async executeInstall(
		request: IInstallAgentPackageRequest,
	): Promise<IAgentPackageOperationResult> {
		const recorded = this.requireRecordedOperation(request);
		if (recorded.persisted.status === 'pending' && recorded.persisted.phase !== 'recorded') {
			const nextPackage = recorded.persisted.runtimeTransition.next?.installedPackage;
			if (nextPackage === undefined) {
				throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Install recovery has no staged package');
			}
			assertExactOffering({
				packageId: nextPackage.packageId,
				revision: nextPackage.revision,
				contentDigest: nextPackage.contentDigest,
				source: nextPackage.source,
				distribution: nextPackage.distribution,
			}, request.offering);
			return this.activateOffering('install', request, request.offering, undefined);
		}
		if (request.offering.packageId !== request.packageId || request.offering.distribution !== 'user') {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstallable,
				'Install operation must address an optional user package offering',
				{ packageId: request.packageId },
			);
		}
		if (!this.installableByKey.has(offeringKey(request.offering))) {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstallable,
				'Agent package offering is not installable',
				{ packageId: request.packageId },
			);
		}
		if (this.findInstalledPackage(request.packageId)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageAlreadyInstalled,
				'Agent package is already installed',
				{ packageId: request.packageId },
			);
		}
		return this.activateOffering('install', request, request.offering, undefined);
	}

	private async executeUpdate(
		request: IUpdateAgentPackageRequest,
	): Promise<IAgentPackageOperationResult> {
		const recorded = this.requireRecordedOperation(request);
		if (recorded.persisted.status === 'pending' && recorded.persisted.phase !== 'recorded') {
			const transition = recorded.persisted.runtimeTransition;
			const nextPackage = transition.next?.installedPackage;
			if (nextPackage === undefined || transition.previous === null) {
				throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Update recovery has no exact runtime transition');
			}
			assertExactOffering({
				packageId: nextPackage.packageId,
				revision: nextPackage.revision,
				contentDigest: nextPackage.contentDigest,
				source: nextPackage.source,
				distribution: nextPackage.distribution,
			}, request.offering);
			return this.activateOffering(
				'update', request, request.offering, transition.previous.installedPackage,
			);
		}
		const installedPackage = this.requireInstalledPackage(request.packageId);
		if (request.offering.packageId !== request.packageId) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Update offering addresses a different Agent package',
				{ packageId: request.packageId },
			);
		}
		if (
			request.offering.revision === installedPackage.revision
			&& request.offering.contentDigest === installedPackage.contentDigest
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Update must address a different Agent package revision',
				{ packageId: request.packageId },
			);
		}
		if (installedPackage.distribution === 'bundled') {
			if (request.authority !== 'product' || request.offering.distribution !== 'bundled') {
				throw new AgentPackageError(
					AgentPackageErrorCode.BundledPackageMutationDenied,
					'Bundled Comet package update requires product authority',
					{ packageId: request.packageId },
				);
			}
		} else if (
			request.authority !== 'user'
			|| request.offering.distribution !== 'user'
			|| !this.installableByKey.has(offeringKey(request.offering))
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstallable,
				'Agent package update offering is not installable',
				{ packageId: request.packageId },
			);
		}
		return this.activateOffering('update', request, request.offering, installedPackage);
	}

	private async activateOffering(
		kind: 'install' | 'update',
		request: IAgentPackageOperationExecutionRequest,
		offering: IAgentPackageOffering,
		previousPackage: IInstalledAgentPackage | undefined,
	): Promise<IAgentPackageOperationResult> {
		const recorded = this.requireRecordedOperation(request);
		if (recorded.persisted.status !== 'pending') {
			throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Agent package activation is not pending');
		}
		if (recorded.persisted.phase === 'catalogCommitted') {
			recorded.retryRequired = true;
			await this.runtimePort.retirePreviousActivation(
				request.operationId,
				recorded.persisted.runtimeTransition,
			);
			const result = this.createOperationResult(kind, request, 0, this.state.catalogRevision);
			await this.commitSuccessfulOperation(recorded, result);
			return result;
		}

		let verifiedPackage: IVerifiedAgentPackage | undefined;
		let transition: IAgentPackageRuntimeTransition;
		let mutation: IAgentPackageMutation | undefined;
		let stateCommitted = false;
		try {
			if (recorded.persisted.phase === 'recorded') {
				verifiedPackage = await this.artifactPort.stage(offering, request.operationId);
				assertExactOffering(verifiedPackage.offering, offering);
				const installedPackage = validateAndFreezeAgentPackage(verifiedPackage, this.hostTarget);
				const previous = previousPackage === undefined
					? null
					: Object.freeze({
						installedPackage: previousPackage,
						registrations: Object.freeze(this.state.activeRegistrations.filter(candidate => (
							candidate.packageId === previousPackage.packageId
						))),
					});
				const registrations = assertRegistrationSet(
					installedPackage,
					await this.runtimePort.prepareActivation(installedPackage, previous, request.operationId),
				);
				transition = Object.freeze({
					previous,
					next: Object.freeze({ installedPackage, registrations }),
				});
				await this.commitOperationRecord(recorded, Object.freeze({
					...recorded.persisted,
					status: 'pending',
					phase: 'runtimePrepared',
					runtimeTransition: transition,
				}));
			} else {
				transition = recorded.persisted.runtimeTransition;
			}
			const installedPackage = transition.next?.installedPackage;
			const registrations = transition.next?.registrations;
			if (installedPackage === undefined || registrations === undefined) {
				throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Agent package activation has no staged runtime');
			}
			assertExactOffering({
				packageId: installedPackage.packageId,
				revision: installedPackage.revision,
				contentDigest: installedPackage.contentDigest,
				source: installedPackage.source,
				distribution: installedPackage.distribution,
			}, offering);

			const affectedAgentIds = new Set<AgentId>(installedPackage.manifest.agentIds);
			if (previousPackage) {
				for (const agentId of previousPackage.manifest.agentIds) {
					affectedAgentIds.add(agentId);
				}
			}
			this.assertCandidateClaims(installedPackage.packageId, registrations);
			mutation = await this.requireLifecyclePort().acquirePackageMutation(
				request.operationId,
				request.requestDigest,
				Object.freeze([...affectedAgentIds]),
			);
			await mutation.drain();

			let retainedBackingRecords: readonly IAgentPackageBackingRecord[] = [
				...this.state.retainedBackingRecords,
			];
			if (previousPackage) {
				const materializedRecords = this.getMaterializedRecords(previousPackage.packageId);
				const checkpoints = await mutation.checkpointAndRelease(materializedRecords);
				retainedBackingRecords = this.mergeCheckpoints(
					retainedBackingRecords,
					materializedRecords,
					checkpoints,
				);
			}
			retainedBackingRecords = await this.migrateRetainedRecords(
				installedPackage,
				registrations,
				retainedBackingRecords,
				request.operationId,
			);
			await mutation.prepareActivation(registrations);
			if (recorded.persisted.phase === 'runtimePrepared') {
				recorded.retryRequired = true;
				await this.runtimePort.commitActivation(request.operationId, transition);
				await this.commitOperationRecord(recorded, Object.freeze({
					...recorded.persisted,
					status: 'pending',
					phase: 'runtimeCommitted',
					runtimeTransition: transition,
				}));
			}

			const releaseState = await this.acquireStateLock();
			try {
				const previousState = this.state;
				const catalogRecord = Object.freeze({
					...recorded.persisted,
					status: 'pending' as const,
					phase: 'catalogCommitted' as const,
					runtimeTransition: transition,
				});
				const nextState = validatePersistedState({
					revision: previousState.revision + 1,
					catalogRevision: previousState.catalogRevision + 1,
					operations: this.replaceOperation(previousState.operations, catalogRecord),
					installedPackages: [
						...previousState.installedPackages.filter(candidate => (
							candidate.packageId !== installedPackage?.packageId
						)),
						installedPackage,
					],
					activeRegistrations: [
						...previousState.activeRegistrations.filter(candidate => (
							candidate.packageId !== installedPackage?.packageId
						)),
						...registrations,
					],
					retainedBackingRecords: [
						...previousState.retainedBackingRecords.filter(record => record.identity.packageId !== installedPackage?.packageId),
						...retainedBackingRecords.filter(record => record.identity.packageId === installedPackage?.packageId),
					],
					materializedBackings: previousState.materializedBackings.filter(identity => (
						identity.packageId !== installedPackage?.packageId
					)),
				}, this.hostTarget);
				await this.stateStore.commit(previousState.revision, nextState);
				this.acceptState(nextState);
				stateCommitted = true;
				try {
					await mutation.complete();
				} catch (activationError) {
					const restored = validatePersistedState({
						...previousState,
						revision: nextState.revision + 1,
						catalogRevision: previousState.catalogRevision,
					}, this.hostTarget);
					try {
						await this.stateStore.commit(nextState.revision, restored);
						this.acceptState(restored);
						stateCommitted = false;
					} catch (restoreError) {
						throw new AggregateError([activationError, restoreError], 'Package activation and state rollback both failed');
					}
					throw activationError;
				}
			} finally {
				releaseState();
			}

			await this.runtimePort.retirePreviousActivation(request.operationId, transition);
			const result = this.createOperationResult(kind, request, 0, this.state.catalogRevision);
			await this.commitSuccessfulOperation(recorded, result);
			return result;
		} catch (error) {
			if (stateCommitted) {
				throw error;
			}
			const rollbacks: Array<() => Promise<void>> = [];
			if (mutation) {
				const mutationToRollback = mutation;
				rollbacks.push(() => mutationToRollback.rollback());
			}
			if (recorded.persisted.phase !== 'recorded') {
				const transition = recorded.persisted.runtimeTransition;
				rollbacks.push(() => this.runtimePort.rollbackActivation(request.operationId, transition));
			}
			if (verifiedPackage) {
				const packageToDiscard = verifiedPackage;
				rollbacks.push(() => this.artifactPort.discard(packageToDiscard, request.operationId));
			}
			return throwWithConfirmedRollback(toError(error), rollbacks, () => {
				recorded.retryRequired = false;
			});
		}
	}

	private async executeUninstall(
		request: IUninstallAgentPackageRequest,
	): Promise<IAgentPackageOperationResult> {
		const recorded = this.requireRecordedOperation(request);
		if (recorded.persisted.status !== 'pending') {
			throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Agent package uninstall is not pending');
		}
		if (recorded.persisted.phase === 'catalogCommitted') {
			recorded.retryRequired = true;
			await this.runtimePort.retirePreviousActivation(
				request.operationId,
				recorded.persisted.runtimeTransition,
			);
			const result = this.createOperationResult('uninstall', request, 0, this.state.catalogRevision);
			await this.commitSuccessfulOperation(recorded, result);
			return result;
		}
		let installedPackage = this.requireInstalledPackage(request.packageId);
		if (installedPackage.distribution === 'bundled') {
			throw new AgentPackageError(
				AgentPackageErrorCode.BundledPackageMutationDenied,
				'Bundled Comet package cannot be uninstalled',
				{ packageId: request.packageId },
			);
		}

		let mutation: IAgentPackageMutation | undefined;
		let stateCommitted = false;
		try {
			let transition: IAgentPackageRuntimeTransition;
			if (recorded.persisted.phase === 'recorded') {
				const registrations = Object.freeze(this.state.activeRegistrations.filter(candidate => (
					candidate.packageId === installedPackage.packageId
				)));
				const previous = Object.freeze({ installedPackage, registrations });
				const nextRegistrations = await this.runtimePort.prepareActivation(
					null,
					previous,
					request.operationId,
				);
				if (nextRegistrations.length !== 0) {
					throw new AgentPackageError(AgentPackageErrorCode.RegistrationInvalid, 'Uninstall runtime activation must be empty');
				}
				transition = Object.freeze({ previous, next: null });
				await this.commitOperationRecord(recorded, Object.freeze({
					...recorded.persisted,
					status: 'pending',
					phase: 'runtimePrepared',
					runtimeTransition: transition,
				}));
			} else {
				transition = recorded.persisted.runtimeTransition;
				installedPackage = transition.previous!.installedPackage;
			}
			mutation = await this.requireLifecyclePort().acquirePackageMutation(
				request.operationId,
				request.requestDigest,
				installedPackage.manifest.agentIds,
			);
			await mutation.drain();
			const materializedRecords = this.getMaterializedRecords(request.packageId);
			const retainedBackingRecords = this.mergeCheckpoints(
				this.state.retainedBackingRecords,
				materializedRecords,
				await mutation.checkpointAndRelease(materializedRecords),
			);
			await mutation.prepareActivation(Object.freeze([]));
			if (recorded.persisted.phase === 'runtimePrepared') {
				recorded.retryRequired = true;
				await this.runtimePort.commitActivation(request.operationId, transition);
				await this.commitOperationRecord(recorded, Object.freeze({
					...recorded.persisted,
					status: 'pending',
					phase: 'runtimeCommitted',
					runtimeTransition: transition,
				}));
			}
			const releaseState = await this.acquireStateLock();
			try {
				const previousState = this.state;
				const catalogRecord = Object.freeze({
					...recorded.persisted,
					status: 'pending' as const,
					phase: 'catalogCommitted' as const,
					runtimeTransition: transition,
				});
				const nextState = validatePersistedState({
					revision: previousState.revision + 1,
					catalogRevision: previousState.catalogRevision + 1,
					operations: this.replaceOperation(previousState.operations, catalogRecord),
					installedPackages: previousState.installedPackages.filter(candidate => (
						candidate.packageId !== request.packageId
					)),
					activeRegistrations: previousState.activeRegistrations.filter(registration => (
						registration.packageId !== request.packageId
					)),
					retainedBackingRecords: [
						...previousState.retainedBackingRecords.filter(record => record.identity.packageId !== request.packageId),
						...retainedBackingRecords.filter(record => record.identity.packageId === request.packageId),
					],
					materializedBackings: previousState.materializedBackings.filter(identity => (
						identity.packageId !== request.packageId
					)),
				}, this.hostTarget);
				await this.stateStore.commit(previousState.revision, nextState);
				this.acceptState(nextState);
				stateCommitted = true;
				try {
					await mutation.complete();
				} catch (activationError) {
					const restored = validatePersistedState({
						...previousState,
						revision: nextState.revision + 1,
						catalogRevision: previousState.catalogRevision,
					}, this.hostTarget);
					try {
						await this.stateStore.commit(nextState.revision, restored);
						this.acceptState(restored);
						stateCommitted = false;
					} catch (restoreError) {
						throw new AggregateError([activationError, restoreError], 'Package uninstall activation and state rollback both failed');
					}
					throw activationError;
				}
			} finally {
				releaseState();
			}
			await this.runtimePort.retirePreviousActivation(request.operationId, transition);
			const result = this.createOperationResult('uninstall', request, 0, this.state.catalogRevision);
			await this.commitSuccessfulOperation(recorded, result);
			return result;
		} catch (error) {
			if (stateCommitted) {
				throw error;
			}
			if (!mutation) {
				const rollbacks: Array<() => Promise<void>> = [];
				if (recorded.persisted.phase === 'runtimePrepared') {
					const rollbackTransition = recorded.persisted.runtimeTransition;
					rollbacks.push(() => this.runtimePort.rollbackActivation(
						request.operationId,
						rollbackTransition,
					));
				}
				return throwWithConfirmedRollback(toError(error), rollbacks, () => {
					recorded.retryRequired = false;
				});
			}
			const mutationToRollback = mutation;
			const rollbacks: Array<() => Promise<void>> = [() => mutationToRollback.rollback()];
			if (recorded.persisted.phase !== 'recorded') {
				const transition = recorded.persisted.runtimeTransition;
				rollbacks.push(() => this.runtimePort.rollbackActivation(request.operationId, transition));
			}
			return throwWithConfirmedRollback(
				toError(error),
				rollbacks,
				() => { recorded.retryRequired = false; },
			);
		}
	}

	private async executeDeleteAgentData(
		request: IDeleteAgentPackageDataRequest,
	): Promise<IAgentPackageOperationResult> {
		const recorded = this.requireRecordedOperation(request);
		if (recorded.persisted.status !== 'pending' || recorded.persisted.phase !== 'recorded') {
			throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Agent data deletion has invalid durable operation state');
		}
		const installedPackage = this.requireInstalledPackage(request.packageId);
		const registrations = this.state.activeRegistrations.filter(registration => (
			registration.packageId === request.packageId
		));
		if (registrations.length !== installedPackage.manifest.agentIds.length) {
			throw new AgentPackageError(
				AgentPackageErrorCode.AgentDataDeletionDenied,
				'Agent-backed deletion requires the exact activated package runtime',
				{ packageId: request.packageId },
			);
		}

		const mutation = await this.requireLifecyclePort().acquirePackageMutation(
			request.operationId,
			request.requestDigest,
			installedPackage.manifest.agentIds,
		);
		let deletionStarted = false;
		try {
			await mutation.drain();
			const records = this.state.retainedBackingRecords.filter(record => (
				record.identity.packageId === request.packageId
			)).sort((left, right) => Number(right.identity.chatId !== undefined) - Number(left.identity.chatId !== undefined));
			const affectedRecords = recorded.persisted.affectedRecords ?? records.length;
			if (records.length > affectedRecords) {
				throw new AgentPackageError(
					AgentPackageErrorCode.StateConflict,
					'Agent data deletion durable impact is smaller than the remaining record set',
					{ affectedRecords, remainingRecords: records.length },
				);
			}
			if (recorded.persisted.affectedRecords === null) {
				await this.commitOperationRecord(recorded, Object.freeze({
					...recorded.persisted,
					affectedRecords,
				}));
			}
			for (const record of records) {
				const registration = registrations.find(candidate => (
					candidate.agentId === record.identity.agentId
				));
				if (!registration) {
					throw new AgentPackageError(
						AgentPackageErrorCode.AgentDataDeletionDenied,
						'Retained backing has no exact activated Agent registration',
						{
							packageId: request.packageId,
							agentId: record.identity.agentId,
							record: backingKey(record.identity),
						},
					);
				}
				recorded.retryRequired = true;
				deletionStarted = true;
				await this.runtimePort.deleteBacking(
					registration,
					record.identity,
					request.operationId,
				);
				await this.commitBackingRecordRemoval(
					record.identity,
					() => mutation.commitBackingDeletion(record.identity),
				);
			}
			await mutation.complete();
			const result = this.createOperationResult(
				'deleteAgentData', request, affectedRecords, this.state.catalogRevision,
			);
			await this.commitSuccessfulOperation(recorded, result);
			return result;
		} catch (error) {
			if (deletionStarted) {
				await mutation.complete();
				throw error;
			}
			return throwWithRollback(toError(error), [() => mutation.rollback()]);
		}
	}

	private async executePurgeRetainedHostRecords(
		request: IPurgeAgentPackageHostRecordsRequest,
	): Promise<IAgentPackageOperationResult> {
		const recorded = this.requireRecordedOperation(request);
		if (recorded.persisted.status !== 'pending' || recorded.persisted.phase !== 'recorded') {
			throw new AgentPackageError(AgentPackageErrorCode.StateConflict, 'Host-record purge has invalid durable operation state');
		}
		if (
			this.findInstalledPackage(request.packageId)
			|| this.state.activeRegistrations.some(registration => registration.packageId === request.packageId)
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.HostRecordPurgeDenied,
				'Retained Host records can be purged only while package state and registrations are absent',
				{ packageId: request.packageId },
			);
		}
		if (request.records.length === 0) {
			throw new AgentPackageError(
				AgentPackageErrorCode.HostRecordPurgeDenied,
				'Host-record purge requires an explicit non-empty record set',
				{ packageId: request.packageId },
			);
		}

		const selectedKeys = new Set<string>();
		let presentRecords = 0;
		for (const identity of request.records) {
			const key = backingKey(identity);
			if (
				identity.packageId !== request.packageId
				|| selectedKeys.has(key)
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.HostRecordPurgeDenied,
					'Host-record purge contains an invalid retained record',
					{ packageId: request.packageId, record: key },
				);
			}
			selectedKeys.add(key);
			if (this.state.retainedBackingRecords.some(record => backingKey(record.identity) === key)) {
				presentRecords += 1;
			}
		}
		if (recorded.persisted.affectedRecords === null) {
			if (presentRecords !== selectedKeys.size) {
				throw new AgentPackageError(
					AgentPackageErrorCode.HostRecordPurgeDenied,
					'New Host-record purge must address an exact retained record set',
					{ expected: selectedKeys.size, actual: presentRecords },
				);
			}
			await this.commitOperationRecord(recorded, Object.freeze({
				...recorded.persisted,
				affectedRecords: selectedKeys.size,
			}));
		} else if (recorded.persisted.affectedRecords !== selectedKeys.size) {
			throw new AgentPackageError(
				AgentPackageErrorCode.OperationConflict,
				'Host-record purge retry changed its durable impact',
				{ expected: recorded.persisted.affectedRecords, actual: selectedKeys.size },
			);
		}
		if (presentRecords !== 0 && presentRecords !== selectedKeys.size) {
			throw new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Host-record purge package state contains a partial durable record set',
				{ expected: selectedKeys.size, actual: presentRecords },
			);
		}

		recorded.retryRequired = true;
		const commitHost = () => this.requireLifecyclePort().commitHostRecordPurge(
				request.operationId,
				request.requestDigest,
				request.records,
			);
		if (presentRecords === 0) {
			await commitHost();
		} else {
			await this.commitBackingRecordSetRemoval(selectedKeys, commitHost);
		}
		const result = this.createOperationResult(
			'purgeHostRecords', request, selectedKeys.size, this.state.catalogRevision,
		);
		await this.commitSuccessfulOperation(recorded, result);
		return result;
	}

	private commitBackingRecordRemoval(
		identity: IAgentBackingIdentity,
		commitHost: () => Promise<void>,
	): Promise<void> {
		return this.commitBackingRecordSetRemoval(new Set([backingKey(identity)]), commitHost);
	}

	private async commitBackingRecordSetRemoval(
		selectedKeys: ReadonlySet<string>,
		commitHost: () => Promise<void>,
	): Promise<void> {
		const release = await this.acquireStateLock();
		const previous = this.state;
		try {
			const next = validatePersistedState({
				...previous,
				revision: previous.revision + 1,
				catalogRevision: previous.catalogRevision + 1,
				retainedBackingRecords: previous.retainedBackingRecords.filter(record => (
					!selectedKeys.has(backingKey(record.identity))
				)),
				materializedBackings: previous.materializedBackings.filter(identity => (
					!selectedKeys.has(backingKey(identity))
				)),
			}, this.hostTarget);
			await this.stateStore.commit(previous.revision, next);
			this.acceptState(next);
			try {
				await commitHost();
			} catch (error) {
				const restored = validatePersistedState({
					...previous,
					revision: next.revision + 1,
					catalogRevision: previous.catalogRevision,
				}, this.hostTarget);
				try {
					await this.stateStore.commit(next.revision, restored);
					this.acceptState(restored);
				} catch (restoreError) {
					throw new AggregateError([error, restoreError], 'Package and Host backing rollback both failed');
				}
				throw error;
			}
		} finally {
			release();
		}
	}

	private assertCandidateClaims(
		packageId: AgentPackageId,
		registrations: readonly IAgentRuntimeRegistration[],
	): void {
		const candidateAgentIds = new Set(registrations.map(registration => registration.agentId));
		const activeConflict = this.state.activeRegistrations.find(registration => (
			registration.packageId !== packageId
			&& candidateAgentIds.has(registration.agentId)
		));
		if (activeConflict) {
			throw new AgentPackageError(
				AgentPackageErrorCode.AgentIdConflict,
				'Agent ID already has an active runtime registration',
				{ packageId, agentId: activeConflict.agentId },
			);
		}

		const retainedConflict = this.state.retainedBackingRecords.find(record => (
			record.identity.packageId !== packageId
			&& candidateAgentIds.has(record.identity.agentId)
		));
		if (retainedConflict) {
			throw new AgentPackageError(
				AgentPackageErrorCode.CrossPackageAgentClaim,
				'Agent ID remains attributed to another package',
				{
					packageId,
					agentId: retainedConflict.identity.agentId,
					record: backingKey(retainedConflict.identity),
				},
			);
		}
	}

	private async migrateRetainedRecords(
		installedPackage: IInstalledAgentPackage,
		registrations: readonly IAgentRuntimeRegistration[],
		records: readonly IAgentPackageBackingRecord[],
		operationId: AgentPackageOperationId,
	): Promise<readonly IAgentPackageBackingRecord[]> {
		const migrated: IAgentPackageBackingRecord[] = [];
		for (const record of records) {
			if (record.identity.packageId !== installedPackage.packageId) {
				migrated.push(record);
				continue;
			}
			const registration = registrations.find(candidate => (
				candidate.agentId === record.identity.agentId
			));
			if (!registration) {
				throw new AgentPackageError(
					AgentPackageErrorCode.ResumeSchemaIncompatible,
					'Retained backing Agent is not declared by the staged package',
					{
						packageId: installedPackage.packageId,
						agentId: record.identity.agentId,
						record: backingKey(record.identity),
					},
				);
			}
			if (!record.resumeState) {
				migrated.push(record);
				continue;
			}
			if (registration.supportedResumeSchemas.includes(record.resumeState.schema)) {
				migrated.push(record);
				continue;
			}

			const edges = registration.resumeMigrationEdges.filter(edge => (
				edge.sourceSchema === record.resumeState?.schema
				&& registration.supportedResumeSchemas.includes(edge.targetSchema)
			));
			if (edges.length !== 1 || !record.resumeStateDigest) {
				throw new AgentPackageError(
					AgentPackageErrorCode.ResumeSchemaIncompatible,
					'Retained backing has no unambiguous supported resume migration',
					{
						packageId: installedPackage.packageId,
						agentId: record.identity.agentId,
						record: backingKey(record.identity),
					},
				);
			}

			const request: IAgentResumeMigrationRequest = {
				operation: operationId,
				backing: record.identity,
				source: record.resumeState,
				sourceDigest: record.resumeStateDigest,
				targetSchema: edges[0].targetSchema,
			};
			const resumeState = await this.runtimePort.migrateResumeState(registration, request);
			if (
				resumeState.schema !== request.targetSchema
				|| Buffer.byteLength(resumeState.data, 'utf8') > MAXIMUM_RESUME_STATE_BYTES
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.ResumeSchemaIncompatible,
					'Runtime returned an invalid migrated resume state',
					{
						packageId: installedPackage.packageId,
						agentId: record.identity.agentId,
						record: backingKey(record.identity),
					},
				);
			}
			migrated.push(freezeBackingRecord({
				identity: record.identity,
				resumeState,
				resumeStateDigest: computeAgentResumeStateDigest(resumeState),
			}));
		}
		return Object.freeze(migrated);
	}

	private getMaterializedRecords(packageId: AgentPackageId): readonly IAgentPackageBackingRecord[] {
		const materializedKeys = new Set(
			this.state.materializedBackings
				.filter(identity => identity.packageId === packageId)
				.map(backingKey),
		);
		return Object.freeze(this.state.retainedBackingRecords.filter(record => (
			materializedKeys.has(backingKey(record.identity))
		)));
	}

	private mergeCheckpoints(
		records: readonly IAgentPackageBackingRecord[],
		requestedRecords: readonly IAgentPackageBackingRecord[],
		checkpoints: readonly IAgentPackageBackingRecord[],
	): IAgentPackageBackingRecord[] {
		const requestedKeys = new Set(requestedRecords.map(record => backingKey(record.identity)));
		const checkpointByKey = new Map<string, IAgentPackageBackingRecord>();
		for (const checkpoint of checkpoints) {
			assertResumeState(checkpoint);
			const key = backingKey(checkpoint.identity);
			if (!requestedKeys.has(key) || checkpointByKey.has(key)) {
				throw new AgentPackageError(
					AgentPackageErrorCode.InvalidPackage,
					'Checkpoint release returned an unexpected backing identity',
					{ record: key },
				);
			}
			checkpointByKey.set(key, freezeBackingRecord(checkpoint));
		}
		if (checkpointByKey.size !== requestedKeys.size) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Checkpoint release omitted a materialized backing identity',
			);
		}

		return records.map(record => checkpointByKey.get(backingKey(record.identity)) ?? record);
	}

	private findInstalledPackage(packageId: AgentPackageId): IInstalledAgentPackage | undefined {
		return this.state.installedPackages.find(candidate => candidate.packageId === packageId);
	}

	private requireInstalledPackage(packageId: AgentPackageId): IInstalledAgentPackage {
		const installedPackage = this.findInstalledPackage(packageId);
		if (!installedPackage) {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstalled,
				'Agent package is not installed',
				{ packageId },
			);
		}
		return installedPackage;
	}

	private requireLifecyclePort(): IAgentPackageLifecyclePort {
		if (this.lifecyclePort === undefined) {
			throw new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Agent package lifecycle has no bound Host lifecycle coordinator',
			);
		}
		return this.lifecyclePort;
	}

}
