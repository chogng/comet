/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IAgentBackingIdentity,
	IAgentResumeState,
	IAgentRuntimeRegistration,
} from './agent.js';
import {
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentId,
	AgentPackageContentDigest,
	AgentPackageId,
	AgentPackageOperationId,
	AgentPackageRevision,
	AgentResumeStateDigest,
	AgentRuntimeRegistrationRevision,
	createAgentChatId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentPackageRevision,
	createAgentSessionId,
} from './identities.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import { AgentPackageErrorCode } from './packageErrors.js';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	computeAgentHostPayloadDigest,
} from './protocolValues.js';
import type { IAgentCredentialReference } from './credentials.js';

export type AgentPackageDistribution = 'bundled' | 'user';
export type AgentPackageRuntimeForm = 'embedded' | 'connected';

export interface IAgentPackageTarget {
	readonly operatingSystem: string;
	readonly architecture: string;
}

export interface IAgentPackagePrivilege {
	readonly kind: 'process' | 'filesystem' | 'network' | 'secret' | 'toolExecutor';
	readonly value: string;
}

export interface IAgentPackageDependency {
	readonly id: string;
	readonly source: string;
	readonly target: string;
	readonly digest: AgentPackageContentDigest;
	readonly license: string;
}

export interface IVerifiedAgentPackageDependency extends IAgentPackageDependency {
	readonly verifiedDigest: AgentPackageContentDigest;
	readonly immutable: true;
}

export interface IAgentPackageManifest {
	readonly schema: number;
	readonly packageId: AgentPackageId;
	readonly revision: AgentPackageRevision;
	readonly contentDigest: AgentPackageContentDigest;
	readonly publisher: string;
	readonly target: IAgentPackageTarget;
	readonly runtimeForm: AgentPackageRuntimeForm;
	readonly runtimeEntryPoint: string;
	readonly agentIds: readonly AgentId[];
	readonly dependencies: readonly IAgentPackageDependency[];
	readonly privileges: readonly IAgentPackagePrivilege[];
}

export interface IAgentPackageOffering {
	readonly packageId: AgentPackageId;
	readonly revision: AgentPackageRevision;
	readonly contentDigest: AgentPackageContentDigest;
	readonly source: string;
	readonly distribution: AgentPackageDistribution;
}

export interface IInstalledAgentPackage {
	readonly packageId: AgentPackageId;
	readonly revision: AgentPackageRevision;
	readonly contentDigest: AgentPackageContentDigest;
	readonly source: string;
	readonly distribution: AgentPackageDistribution;
	readonly manifest: IAgentPackageManifest;
	readonly dependencyClosure: readonly IVerifiedAgentPackageDependency[];
	readonly grantedPrivileges: readonly IAgentPackagePrivilege[];
}

export interface IAgentPackageBackingRecord {
	readonly identity: IAgentBackingIdentity;
	readonly resumeState?: IAgentResumeState;
	readonly resumeStateDigest?: AgentResumeStateDigest;
}

export interface IAgentPackagePersistedState {
	/** Storage compare-and-swap revision. Ledger-only writes advance this value. */
	readonly revision: number;
	/** Public package catalog revision. Only authoritative catalog changes advance this value. */
	readonly catalogRevision: number;
	readonly operations: readonly AgentPackagePersistedOperation[];
	readonly installedPackages: readonly IInstalledAgentPackage[];
	readonly activeRegistrations: readonly IAgentRuntimeRegistration[];
	readonly retainedBackingRecords: readonly IAgentPackageBackingRecord[];
	readonly materializedBackings: readonly IAgentBackingIdentity[];
}

export interface IAgentPackageLifecycleSnapshot extends IAgentPackagePersistedState {
	readonly installablePackages: readonly IAgentPackageOffering[];
}

export type AgentPackageAuthenticationStatus =
	| 'unavailable'
	| 'unauthenticated'
	| 'authenticated';

export interface IAgentPackageActivationState {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly authentication: AgentPackageAuthenticationStatus;
}

export interface IAgentHostPackageCatalogState {
	readonly revision: number;
	readonly installablePackages: readonly IAgentPackageOffering[];
	readonly installedPackages: readonly IInstalledAgentPackage[];
	readonly activations: readonly IAgentPackageActivationState[];
	readonly retainedBackingRecords: readonly IAgentPackageBackingRecord[];
	readonly materializedBackings: readonly IAgentBackingIdentity[];
}

export interface IAgentAuthenticationRequest {
	readonly operation: AgentHostOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly credential: IAgentCredentialReference;
}

export interface IAgentAuthenticationPort {
	getState(registration: IAgentRuntimeRegistration): Exclude<AgentPackageAuthenticationStatus, 'unavailable'>;
	authenticate(request: IAgentAuthenticationRequest): Promise<'authenticated'>;
}

export type AgentPackageOperationKind =
	| 'install'
	| 'update'
	| 'uninstall'
	| 'deleteAgentData'
	| 'purgeHostRecords';

interface IAgentPackageLifecycleOperationRequest {
	readonly operationId: AgentPackageOperationId;
	readonly requestDigest: AgentHostPayloadDigest;
	readonly packageId: AgentPackageId;
}

export interface IInstallAgentPackageRequest extends IAgentPackageLifecycleOperationRequest {
	readonly offering: IAgentPackageOffering;
}

export interface IUpdateAgentPackageRequest extends IAgentPackageLifecycleOperationRequest {
	readonly offering: IAgentPackageOffering;
	readonly authority: 'user' | 'product';
}

export interface IUninstallAgentPackageRequest extends IAgentPackageLifecycleOperationRequest { }

export interface IDeleteAgentPackageDataRequest extends IAgentPackageLifecycleOperationRequest { }

export interface IPurgeAgentPackageHostRecordsRequest extends IAgentPackageLifecycleOperationRequest {
	readonly records: readonly IAgentBackingIdentity[];
}

export type AgentPackageOperationPayload =
	| {
		readonly kind: 'install';
		readonly packageId: AgentPackageId;
		readonly offering: IAgentPackageOffering;
	}
	| {
		readonly kind: 'update';
		readonly packageId: AgentPackageId;
		readonly offering: IAgentPackageOffering;
	}
	| {
		readonly kind: 'uninstall' | 'deleteAgentData';
		readonly packageId: AgentPackageId;
	}
	| {
		readonly kind: 'purgeHostRecords';
		readonly packageId: AgentPackageId;
		readonly records: readonly IAgentBackingIdentity[];
	};

export interface IAgentPackageOperationRequest {
	readonly operation: AgentPackageOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly expectedCatalogRevision: number;
	readonly payload: AgentPackageOperationPayload;
}

export interface IAgentPackageOperationOutcomeRequest {
	readonly operation: AgentPackageOperationId;
	readonly digest: AgentHostPayloadDigest;
}

export interface IAgentPackageOperationResult {
	readonly operationId: AgentPackageOperationId;
	readonly requestDigest: AgentHostPayloadDigest;
	readonly kind: AgentPackageOperationKind;
	readonly packageId: AgentPackageId;
	readonly stateRevision: number;
	readonly affectedRecords: number;
}

export interface IAgentPackageOperationFailure {
	readonly code: AgentPackageErrorCode | 'invalidPayload' | 'internal';
	readonly message: string;
	readonly data?: AgentHostProtocolValue;
	readonly reconciliation: 'terminal' | 'sameOperationRequired';
}

export type AgentPackageOperationOutcome =
	| { readonly kind: 'pending' }
	| {
		readonly kind: 'succeeded';
		readonly result: IAgentPackageOperationResult;
	}
	| {
		readonly kind: 'failed';
		readonly failure: IAgentPackageOperationFailure;
	}
	| { readonly kind: 'unknown' }
	| {
		readonly kind: 'conflict';
		readonly recordedDigest: AgentHostPayloadDigest;
	};

interface IAgentPackagePersistedOperationBase {
	readonly operation: AgentPackageOperationId;
	readonly digest: AgentHostPayloadDigest;
	readonly kind: AgentPackageOperationKind;
	readonly packageId: AgentPackageId;
	readonly affectedRecords: number | null;
}

export interface IAgentPackageRuntimeTransitionSide {
	readonly installedPackage: IInstalledAgentPackage;
	readonly registrations: readonly IAgentRuntimeRegistration[];
}

export interface IAgentPackageRuntimeTransition {
	readonly previous: IAgentPackageRuntimeTransitionSide | null;
	readonly next: IAgentPackageRuntimeTransitionSide | null;
}

export type AgentPackageRuntimeTransitionPhase =
	| 'runtimePrepared'
	| 'runtimeCommitted'
	| 'catalogCommitted';

export type AgentPackagePersistedOperation =
	| (IAgentPackagePersistedOperationBase & {
		readonly status: 'pending';
		readonly phase: 'recorded';
		readonly runtimeTransition?: never;
	})
	| (IAgentPackagePersistedOperationBase & {
		readonly status: 'pending';
		readonly phase: AgentPackageRuntimeTransitionPhase;
		readonly runtimeTransition: IAgentPackageRuntimeTransition;
	})
	| (IAgentPackagePersistedOperationBase & {
		readonly status: 'succeeded';
		readonly result: IAgentPackageOperationResult;
	})
	| (IAgentPackagePersistedOperationBase & {
		readonly status: 'failed';
		readonly phase: 'recorded';
		readonly runtimeTransition?: never;
		readonly failure: IAgentPackageOperationFailure;
	})
	| (IAgentPackagePersistedOperationBase & {
		readonly status: 'failed';
		readonly phase: AgentPackageRuntimeTransitionPhase;
		readonly runtimeTransition: IAgentPackageRuntimeTransition;
		readonly failure: IAgentPackageOperationFailure;
	});

export function computeAgentPackageOperationDigest(
	expectedCatalogRevision: number,
	payload: AgentPackageOperationPayload,
): Promise<AgentHostPayloadDigest> {
	return computeAgentHostPayloadDigest(Object.freeze({ expectedCatalogRevision, payload }));
}

type PackageProtocolRecord = Readonly<Record<string, unknown>>;

function invalidPackageProtocol(field: string, value: unknown): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Agent package protocol value',
		{
			field,
			value: typeof value === 'string' ? value.slice(0, 256) : typeof value,
		},
	);
}

function packageProtocolRecord(value: unknown, field: string): PackageProtocolRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidPackageProtocol(field, value);
	}
	return value as PackageProtocolRecord;
}

function assertPackageProtocolKeys(
	record: PackageProtocolRecord,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidPackageProtocol(`${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidPackageProtocol(`${field}.${key}`, 'missing');
		}
	}
}

function packageProtocolString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		return invalidPackageProtocol(field, value);
	}
	return value;
}

function assertPackageProtocolCounter(value: unknown, field: string): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		invalidPackageProtocol(field, value);
	}
}

function assertPackageOffering(value: unknown, field: string, packageId: AgentPackageId): void {
	const offering = packageProtocolRecord(value, field);
	assertPackageProtocolKeys(
		offering,
		['packageId', 'revision', 'contentDigest', 'source', 'distribution'],
		[],
		field,
	);
	if (createAgentPackageId(packageProtocolString(offering.packageId, `${field}.packageId`)) !== packageId) {
		invalidPackageProtocol(`${field}.packageId`, offering.packageId);
	}
	createAgentPackageRevision(packageProtocolString(offering.revision, `${field}.revision`));
	createAgentPackageContentDigest(packageProtocolString(offering.contentDigest, `${field}.contentDigest`));
	packageProtocolString(offering.source, `${field}.source`);
	if (offering.distribution !== 'bundled' && offering.distribution !== 'user') {
		invalidPackageProtocol(`${field}.distribution`, offering.distribution);
	}
}

function assertPackageBackingIdentity(value: unknown, field: string, packageId: AgentPackageId): string {
	const identity = packageProtocolRecord(value, field);
	assertPackageProtocolKeys(identity, ['packageId', 'agentId', 'sessionId'], ['chatId'], field);
	if (createAgentPackageId(packageProtocolString(identity.packageId, `${field}.packageId`)) !== packageId) {
		invalidPackageProtocol(`${field}.packageId`, identity.packageId);
	}
	const agentId = createAgentId(packageProtocolString(identity.agentId, `${field}.agentId`));
	const sessionId = createAgentSessionId(packageProtocolString(identity.sessionId, `${field}.sessionId`));
	const chatId = identity.chatId === undefined
		? ''
		: createAgentChatId(packageProtocolString(identity.chatId, `${field}.chatId`));
	return `${packageId}\u0000${agentId}\u0000${sessionId}\u0000${chatId}`;
}

export function assertAgentPackageOperationRequest(value: unknown): asserts value is IAgentPackageOperationRequest {
	assertAgentHostProtocolValue(value);
	const request = packageProtocolRecord(value, 'packageOperation');
	assertPackageProtocolKeys(
		request,
		['operation', 'digest', 'expectedCatalogRevision', 'payload'],
		[],
		'packageOperation',
	);
	createAgentPackageOperationId(packageProtocolString(request.operation, 'packageOperation.operation'));
	createAgentHostPayloadDigest(packageProtocolString(request.digest, 'packageOperation.digest'));
	assertPackageProtocolCounter(request.expectedCatalogRevision, 'packageOperation.expectedCatalogRevision');

	const payload = packageProtocolRecord(request.payload, 'packageOperation.payload');
	const kind = packageProtocolString(payload.kind, 'packageOperation.payload.kind');
	const packageId = createAgentPackageId(packageProtocolString(payload.packageId, 'packageOperation.payload.packageId'));
	switch (kind) {
		case 'install':
		case 'update':
			assertPackageProtocolKeys(payload, ['kind', 'packageId', 'offering'], [], 'packageOperation.payload');
			assertPackageOffering(payload.offering, 'packageOperation.payload.offering', packageId);
			return;
		case 'uninstall':
		case 'deleteAgentData':
			assertPackageProtocolKeys(payload, ['kind', 'packageId'], [], 'packageOperation.payload');
			return;
		case 'purgeHostRecords': {
			assertPackageProtocolKeys(payload, ['kind', 'packageId', 'records'], [], 'packageOperation.payload');
			if (!Array.isArray(payload.records)) {
				invalidPackageProtocol('packageOperation.payload.records', payload.records);
			}
			const keys = payload.records.map((record, index) => (
				assertPackageBackingIdentity(record, `packageOperation.payload.records.${index}`, packageId)
			));
			if (new Set(keys).size !== keys.length) {
				invalidPackageProtocol('packageOperation.payload.records', 'duplicate');
			}
			return;
		}
	}
	invalidPackageProtocol('packageOperation.payload.kind', kind);
}

export function assertAgentPackageOperationOutcomeRequest(
	value: unknown,
): asserts value is IAgentPackageOperationOutcomeRequest {
	assertAgentHostProtocolValue(value);
	const request = packageProtocolRecord(value, 'packageOperationOutcome');
	assertPackageProtocolKeys(request, ['operation', 'digest'], [], 'packageOperationOutcome');
	createAgentPackageOperationId(packageProtocolString(request.operation, 'packageOperationOutcome.operation'));
	createAgentHostPayloadDigest(packageProtocolString(request.digest, 'packageOperationOutcome.digest'));
}

export function assertAgentPackageOperationOutcome(
	request: IAgentPackageOperationOutcomeRequest,
	value: unknown,
): asserts value is AgentPackageOperationOutcome {
	assertAgentHostProtocolValue(value);
	const outcome = packageProtocolRecord(value, 'packageOperationOutcome.result');
	const kind = packageProtocolString(outcome.kind, 'packageOperationOutcome.result.kind');
	switch (kind) {
		case 'pending':
		case 'unknown':
			assertPackageProtocolKeys(outcome, ['kind'], [], 'packageOperationOutcome.result');
			return;
		case 'conflict':
			assertPackageProtocolKeys(outcome, ['kind', 'recordedDigest'], [], 'packageOperationOutcome.result');
			createAgentHostPayloadDigest(packageProtocolString(
				outcome.recordedDigest,
				'packageOperationOutcome.result.recordedDigest',
			));
			return;
		case 'succeeded': {
			assertPackageProtocolKeys(outcome, ['kind', 'result'], [], 'packageOperationOutcome.result');
			const result = packageProtocolRecord(outcome.result, 'packageOperationOutcome.result.result');
			assertPackageProtocolKeys(
				result,
				['operationId', 'requestDigest', 'kind', 'packageId', 'stateRevision', 'affectedRecords'],
				[],
				'packageOperationOutcome.result.result',
			);
			if (createAgentPackageOperationId(packageProtocolString(result.operationId, 'packageOperationOutcome.result.result.operationId')) !== request.operation) {
				invalidPackageProtocol('packageOperationOutcome.result.result.operationId', result.operationId);
			}
			if (createAgentHostPayloadDigest(packageProtocolString(result.requestDigest, 'packageOperationOutcome.result.result.requestDigest')) !== request.digest) {
				invalidPackageProtocol('packageOperationOutcome.result.result.requestDigest', result.requestDigest);
			}
			if (!['install', 'update', 'uninstall', 'deleteAgentData', 'purgeHostRecords'].includes(String(result.kind))) {
				invalidPackageProtocol('packageOperationOutcome.result.result.kind', result.kind);
			}
			createAgentPackageId(packageProtocolString(result.packageId, 'packageOperationOutcome.result.result.packageId'));
			assertPackageProtocolCounter(result.stateRevision, 'packageOperationOutcome.result.result.stateRevision');
			assertPackageProtocolCounter(result.affectedRecords, 'packageOperationOutcome.result.result.affectedRecords');
			return;
		}
		case 'failed': {
			assertPackageProtocolKeys(outcome, ['kind', 'failure'], [], 'packageOperationOutcome.result');
			const failure = packageProtocolRecord(outcome.failure, 'packageOperationOutcome.result.failure');
			assertPackageProtocolKeys(
				failure,
				['code', 'message', 'reconciliation'],
				['data'],
				'packageOperationOutcome.result.failure',
			);
			const code = packageProtocolString(failure.code, 'packageOperationOutcome.result.failure.code');
			if (
				code !== 'invalidPayload'
				&& code !== 'internal'
				&& !Object.values(AgentPackageErrorCode).includes(code as AgentPackageErrorCode)
			) {
				invalidPackageProtocol('packageOperationOutcome.result.failure.code', code);
			}
			packageProtocolString(failure.message, 'packageOperationOutcome.result.failure.message');
			if (failure.reconciliation !== 'terminal' && failure.reconciliation !== 'sameOperationRequired') {
				invalidPackageProtocol('packageOperationOutcome.result.failure.reconciliation', failure.reconciliation);
			}
			return;
		}
	}
	invalidPackageProtocol('packageOperationOutcome.result.kind', kind);
}
