/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type {
	IAgentBackingIdentity,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentRuntimeRegistration,
} from 'cs/platform/agentHost/common/agent';
import {
	AgentId,
	AgentPackageContentDigest,
	AgentPackageId,
	AgentPackageOperationId,
	AgentResumeSchemaId,
	createAgentCapabilityRevision,
	createAgentDescriptorRevision,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentPackageRevision,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolSchemaProfileId,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	AgentPackageDistribution,
	AgentPackageRuntimeForm,
	IAgentPackageBackingRecord,
	IAgentPackageOffering,
	IAgentPackageOperationResult,
	IAgentPackagePersistedState,
	IAgentPackageTarget,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import {
	AgentPackageLifecycle,
	IAgentPackageArtifactPort,
	IAgentPackageLifecyclePort,
	IAgentPackageMutation,
	IAgentPackageRuntimePort,
	IAgentPackageStateStore,
	computeAgentResumeStateDigest,
} from '../agentPackageLifecycle.js';
import type { IVerifiedAgentPackage } from '../agentPackageTypes.js';

const hostTarget: IAgentPackageTarget = {
	operatingSystem: 'test-os',
	architecture: 'test-arch',
};

function packageDigest(character: string): AgentPackageContentDigest {
	return createAgentPackageContentDigest(`sha256:${character.repeat(64)}`);
}

function requestDigest(character: string) {
	return createAgentHostPayloadDigest(`sha256:${character.repeat(64)}`);
}

function createVerifiedPackage(options: {
	readonly packageId: string;
	readonly agentId?: string;
	readonly revision: string;
	readonly digestCharacter: string;
	readonly distribution?: AgentPackageDistribution;
	readonly runtimeForm?: AgentPackageRuntimeForm;
	readonly closure?: 'complete' | 'missing' | 'digestMismatch';
}): IVerifiedAgentPackage {
	const packageId = createAgentPackageId(options.packageId);
	const agentId = createAgentId(options.agentId ?? options.packageId);
	const revision = createAgentPackageRevision(options.revision);
	const contentDigest = packageDigest(options.digestCharacter);
	const hexadecimalCharacters = '0123456789abcdef';
	const dependencyDigest = packageDigest(hexadecimalCharacters[
		(hexadecimalCharacters.indexOf(options.digestCharacter) + 1) % hexadecimalCharacters.length
	]);
	const offering: IAgentPackageOffering = {
		packageId,
		revision,
		contentDigest,
		source: `catalog.${options.packageId}.${options.revision}`,
		distribution: options.distribution ?? 'user',
	};
	return {
		offering,
		manifest: {
			schema: 1,
			packageId,
			revision,
			contentDigest,
			publisher: `publisher.${options.packageId}`,
			target: hostTarget,
			runtimeForm: options.runtimeForm ?? 'connected',
			runtimeEntryPoint: `bin/${options.packageId}`,
			agentIds: [agentId],
			dependencies: [{
				id: 'runtime',
				source: `artifact.${options.packageId}`,
				target: `bin/${options.packageId}`,
				digest: dependencyDigest,
				license: 'MIT',
			}],
			privileges: [{ kind: 'network', value: 'api.example.test' }],
		},
		dependencyClosure: options.closure === 'missing' ? [] : [{
			id: 'runtime',
			source: `artifact.${options.packageId}`,
			target: `bin/${options.packageId}`,
			digest: dependencyDigest,
			verifiedDigest: options.closure === 'digestMismatch'
				? packageDigest('0')
				: dependencyDigest,
			license: 'MIT',
			immutable: true,
		}],
		grantedPrivileges: [{ kind: 'network', value: 'api.example.test' }],
	};
}

function createRegistration(
	verifiedPackage: IVerifiedAgentPackage,
	options: {
		readonly agentId?: AgentId;
		readonly schemas?: readonly AgentResumeSchemaId[];
		readonly migrationEdges?: readonly {
			readonly sourceSchema: AgentResumeSchemaId;
			readonly targetSchema: AgentResumeSchemaId;
		}[];
	} = {},
): IAgentRuntimeRegistration {
	const agentId = options.agentId ?? verifiedPackage.manifest.agentIds[0];
	return {
		packageId: verifiedPackage.manifest.packageId,
		agentId,
		revision: createAgentRuntimeRegistrationRevision(
			`${verifiedPackage.manifest.revision}.${agentId}`,
		),
		descriptorRevision: createAgentDescriptorRevision(
			`descriptor.${verifiedPackage.manifest.revision}.${agentId}`,
		),
		capabilityRevision: createAgentCapabilityRevision(
			`capability.${verifiedPackage.manifest.revision}.${agentId}`,
		),
		supportedToolSchemaProfiles: [createAgentToolSchemaProfileId('comet.tool.v1')],
		supportedResumeSchemas: options.schemas ?? [createAgentResumeSchemaId('resume.v1')],
		resumeMigrationEdges: options.migrationEdges ?? [],
	};
}

function createBackingRecord(options: {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly sessionId: string;
	readonly schema?: AgentResumeSchemaId;
	readonly data?: string;
}): IAgentPackageBackingRecord {
	const identity: IAgentBackingIdentity = {
		packageId: options.packageId,
		agentId: options.agentId,
		sessionId: createAgentSessionId(options.sessionId),
	};
	if (!options.schema) {
		return { identity };
	}
	const resumeState: IAgentResumeState = {
		schema: options.schema,
		data: options.data ?? `state.${options.sessionId}`,
	};
	return {
		identity,
		resumeState,
		resumeStateDigest: computeAgentResumeStateDigest(resumeState),
	};
}

class MemoryStateStore implements IAgentPackageStateStore {
	state: IAgentPackagePersistedState | undefined;
	readonly trace: string[];
	failNextCommit = false;
	failNextCatalogCommit = false;
	failNextTerminalOperationCommit = false;

	constructor(trace: string[], initialState?: IAgentPackagePersistedState) {
		this.trace = trace;
		this.state = initialState;
	}

	async read(): Promise<IAgentPackagePersistedState | undefined> {
		return this.state;
	}

	async commit(
		expectedRevision: number | undefined,
		state: IAgentPackagePersistedState,
	): Promise<void> {
		this.trace.push('store.commit');
		if (this.failNextCommit || (
			this.failNextCatalogCommit
			&& this.state !== undefined
			&& state.catalogRevision !== this.state.catalogRevision
		) || (
			this.failNextTerminalOperationCommit
			&& state.operations.some(operation => (
				operation.status === 'succeeded'
				&& this.state?.operations.find(candidate => candidate.operation === operation.operation)?.status !== 'succeeded'
			))
		)) {
			this.failNextCommit = false;
			this.failNextCatalogCommit = false;
			this.failNextTerminalOperationCommit = false;
			throw new Error('injected state commit failure');
		}
		assert.equal(this.state?.revision, expectedRevision);
		this.state = state;
	}
}

class ArtifactPort implements IAgentPackageArtifactPort {
	readonly packages = new Map<string, IVerifiedAgentPackage>();
	readonly staged: IAgentPackageOffering[] = [];
	readonly discarded: IVerifiedAgentPackage[] = [];

	constructor(private readonly trace: string[]) { }

	add(verifiedPackage: IVerifiedAgentPackage): void {
		this.packages.set(this.key(verifiedPackage.offering), verifiedPackage);
	}

	async stage(
		offering: IAgentPackageOffering,
		_operationId: AgentPackageOperationId,
	): Promise<IVerifiedAgentPackage> {
		this.trace.push('artifact.stage');
		this.staged.push(offering);
		const verifiedPackage = this.packages.get(this.key(offering));
		assert.ok(verifiedPackage);
		return verifiedPackage;
	}

	async discard(
		verifiedPackage: IVerifiedAgentPackage,
		_operationId: AgentPackageOperationId,
	): Promise<void> {
		this.trace.push('artifact.discard');
		this.discarded.push(verifiedPackage);
	}

	private key(offering: IAgentPackageOffering): string {
		return [offering.packageId, offering.revision, offering.contentDigest, offering.source].join(':');
	}
}

class RuntimePort implements IAgentPackageRuntimePort {
	readonly registrations = new Map<string, readonly IAgentRuntimeRegistration[]>();
	readonly activationStates = new Map<AgentPackageOperationId, 'prepared' | 'committed' | 'retired' | 'rolledBack'>();
	readonly deleteCalls: IAgentBackingIdentity[] = [];
	readonly migrationCalls: IAgentResumeMigrationRequest[] = [];
	migrationResult: IAgentResumeState | undefined;
	migrationError: Error | undefined;
	deleteFailureKey: string | undefined;
	failCommitOperation: AgentPackageOperationId | undefined;
	failRetireOperation: AgentPackageOperationId | undefined;
	failRollbackOperation: AgentPackageOperationId | undefined;

	constructor(private readonly trace: string[]) { }

	setRegistrations(
		verifiedPackage: IVerifiedAgentPackage,
		registrations: readonly IAgentRuntimeRegistration[],
	): void {
		this.registrations.set(this.key(
			verifiedPackage.manifest.packageId,
			verifiedPackage.manifest.revision,
		), registrations);
	}

	async prepareActivation(
		installedPackage: IInstalledAgentPackage | null,
		_previous: Parameters<IAgentPackageRuntimePort['prepareActivation']>[1],
		operationId: AgentPackageOperationId,
	): Promise<readonly IAgentRuntimeRegistration[]> {
		this.trace.push('runtime.prepareActivation');
		this.activationStates.set(operationId, 'prepared');
		if (installedPackage === null) {
			return Object.freeze([]);
		}
		const registrations = this.registrations.get(this.key(
			installedPackage.packageId,
			installedPackage.revision,
		));
		assert.ok(registrations);
		return registrations;
	}

	async commitActivation(
		operationId: AgentPackageOperationId,
		_transition: Parameters<IAgentPackageRuntimePort['commitActivation']>[1],
	): Promise<void> {
		this.trace.push('runtime.commitActivation');
		assert.ok(this.activationStates.get(operationId) === undefined || ['prepared', 'committed'].includes(this.activationStates.get(operationId)!));
		if (this.failCommitOperation === operationId) {
			this.failCommitOperation = undefined;
			throw new Error('injected runtime activation commit failure');
		}
		this.activationStates.set(operationId, 'committed');
	}

	async retirePreviousActivation(
		operationId: AgentPackageOperationId,
		_transition: Parameters<IAgentPackageRuntimePort['retirePreviousActivation']>[1],
	): Promise<void> {
		this.trace.push('runtime.retirePreviousActivation');
		assert.ok(this.activationStates.get(operationId) === undefined || ['committed', 'retired'].includes(this.activationStates.get(operationId)!));
		if (this.failRetireOperation === operationId) {
			this.failRetireOperation = undefined;
			throw new Error('injected previous runtime retirement failure');
		}
		this.activationStates.set(operationId, 'retired');
	}

	async rollbackActivation(
		operationId: AgentPackageOperationId,
		_transition: Parameters<IAgentPackageRuntimePort['rollbackActivation']>[1],
	): Promise<void> {
		this.trace.push('runtime.rollbackActivation');
		assert.ok(this.activationStates.get(operationId) === undefined || ['prepared', 'committed', 'rolledBack'].includes(this.activationStates.get(operationId)!));
		if (this.failRollbackOperation === operationId) {
			this.failRollbackOperation = undefined;
			throw new Error('injected runtime activation rollback failure');
		}
		this.activationStates.set(operationId, 'rolledBack');
	}

	async migrateResumeState(
		_registration: IAgentRuntimeRegistration,
		request: IAgentResumeMigrationRequest,
	): Promise<IAgentResumeState> {
		this.trace.push('runtime.migrate');
		this.migrationCalls.push(request);
		if (this.migrationError) {
			throw this.migrationError;
		}
		assert.ok(this.migrationResult);
		return this.migrationResult;
	}

	async deleteBacking(
		_registration: IAgentRuntimeRegistration,
		identity: IAgentBackingIdentity,
		_operationId: AgentPackageOperationId,
	): Promise<void> {
		this.trace.push(`runtime.delete.${identity.sessionId}`);
		this.deleteCalls.push(identity);
		const key = `${identity.packageId}:${identity.sessionId}`;
		if (this.deleteFailureKey === key) {
			this.deleteFailureKey = undefined;
			throw new Error('injected backing deletion failure');
		}
	}

	private key(packageId: AgentPackageId, revision: string): string {
		return `${packageId}:${revision}`;
	}
}

class PackageMutation implements IAgentPackageMutation {
	rollbackCount = 0;
	completeCount = 0;

	constructor(private readonly trace: string[]) { }

	async drain(): Promise<void> {
		this.trace.push('lifecycle.drain');
	}

	async checkpointAndRelease(
		records: readonly IAgentPackageBackingRecord[],
	): Promise<readonly IAgentPackageBackingRecord[]> {
		this.trace.push('lifecycle.checkpointAndRelease');
		return records;
	}

	async prepareActivation(_registrations: readonly IAgentRuntimeRegistration[]): Promise<void> {
		this.trace.push('lifecycle.prepareActivation');
	}

	async commitBackingDeletion(identity: IAgentBackingIdentity): Promise<void> {
		this.trace.push(`lifecycle.commitBackingDeletion.${identity.sessionId}${identity.chatId === undefined ? '' : `.${identity.chatId}`}`);
	}

	async rollback(): Promise<void> {
		this.trace.push('lifecycle.rollback');
		this.rollbackCount += 1;
	}

	async complete(): Promise<void> {
		this.trace.push('lifecycle.complete');
		this.completeCount += 1;
	}
}

class LifecyclePort implements IAgentPackageLifecyclePort {
	readonly mutations: PackageMutation[] = [];
	readonly acquiredAgentIds: readonly AgentId[][] = [];

	constructor(private readonly trace: string[]) { }

	async acquirePackageMutation(
		_operationId: AgentPackageOperationId,
		_requestDigest: ReturnType<typeof requestDigest>,
		agentIds: readonly AgentId[],
	): Promise<IAgentPackageMutation> {
		this.trace.push('lifecycle.acquire');
		(this.acquiredAgentIds as AgentId[][]).push([...agentIds]);
		const mutation = new PackageMutation(this.trace);
		this.mutations.push(mutation);
		return mutation;
	}

	async commitHostRecordPurge(
		_operationId: AgentPackageOperationId,
		_requestDigest: ReturnType<typeof requestDigest>,
		_records: readonly IAgentBackingIdentity[],
	): Promise<void> {
		this.trace.push('lifecycle.commitHostRecordPurge');
	}
}

interface IHarness {
	readonly lifecycle: AgentPackageLifecycle;
	readonly trace: string[];
	readonly stateStore: MemoryStateStore;
	readonly artifactPort: ArtifactPort;
	readonly runtimePort: RuntimePort;
	readonly lifecyclePort: LifecyclePort;
}

async function createHarness(
	packages: readonly IVerifiedAgentPackage[],
): Promise<IHarness> {
	const trace: string[] = [];
	const comet = createVerifiedPackage({
		packageId: 'comet',
		revision: '1.0.0',
		digestCharacter: 'a',
		distribution: 'bundled',
		runtimeForm: 'embedded',
	});
	const stateStore = new MemoryStateStore(trace);
	const artifactPort = new ArtifactPort(trace);
	const runtimePort = new RuntimePort(trace);
	const lifecyclePort = new LifecyclePort(trace);
	for (const verifiedPackage of packages) {
		artifactPort.add(verifiedPackage);
		runtimePort.setRegistrations(verifiedPackage, [createRegistration(verifiedPackage)]);
	}
	const lifecycle = await AgentPackageLifecycle.create({
		hostTarget,
		installablePackages: packages.map(verifiedPackage => verifiedPackage.offering),
		bundledComet: {
			verifiedPackage: comet,
			registrations: [createRegistration(comet)],
		},
		stateStore,
		artifactPort,
		runtimePort,
	});
	lifecycle.bindLifecyclePort(lifecyclePort);
	trace.length = 0;
	return { lifecycle, trace, stateStore, artifactPort, runtimePort, lifecyclePort };
}

async function restartLifecycle(
	harness: IHarness,
	packages: readonly IVerifiedAgentPackage[],
	runtimePort: RuntimePort = harness.runtimePort,
): Promise<AgentPackageLifecycle> {
	const comet = createVerifiedPackage({
		packageId: 'comet',
		revision: '1.0.0',
		digestCharacter: 'a',
		distribution: 'bundled',
		runtimeForm: 'embedded',
	});
	const lifecycle = await AgentPackageLifecycle.create({
		hostTarget,
		installablePackages: packages.map(verifiedPackage => verifiedPackage.offering),
		bundledComet: {
			verifiedPackage: comet,
			registrations: [createRegistration(comet)],
		},
		stateStore: harness.stateStore,
		artifactPort: harness.artifactPort,
		runtimePort,
	});
	lifecycle.bindLifecyclePort(harness.lifecyclePort);
	return lifecycle;
}

async function assertPackageFailure(
	promise: Promise<IAgentPackageOperationResult>,
	code: AgentPackageErrorCode,
): Promise<void> {
	await assert.rejects(promise, error => {
		assert.ok(error instanceof AgentPackageError);
		assert.equal(error.code, code);
		return true;
	});
}

async function installPackage(
	harness: IHarness,
	verifiedPackage: IVerifiedAgentPackage,
	operation: string,
	digestCharacter: string,
): Promise<void> {
	await harness.lifecycle.install({
		operationId: createAgentPackageOperationId(operation),
		requestDigest: requestDigest(digestCharacter),
		packageId: verifiedPackage.manifest.packageId,
		offering: verifiedPackage.offering,
	});
}

async function commitBackingRecord(
	lifecycle: AgentPackageLifecycle,
	record: IAgentPackageBackingRecord,
	materialized: boolean,
): Promise<void> {
	const snapshot = lifecycle.snapshot();
	const key = (identity: IAgentBackingIdentity) => `${identity.packageId}\u0000${identity.agentId}\u0000${identity.sessionId}\u0000${identity.chatId ?? ''}`;
	const recordKey = key(record.identity);
	const transaction = await lifecycle.beginHostBackingStateCommit({
		expectedStateRevision: snapshot.revision,
		retainedBackingRecords: Object.freeze([
			...snapshot.retainedBackingRecords.filter(candidate => key(candidate.identity) !== recordKey),
			record,
		]),
		materializedBackings: Object.freeze([
			...snapshot.materializedBackings.filter(identity => key(identity) !== recordKey),
			...(materialized ? [record.identity] : []),
		]),
	});
	transaction.complete();
}

suite('AgentPackageLifecycle', { concurrency: false }, () => {
	test('keeps installable, installed, active, and materialized catalogs distinct', async () => {
		const optionalPackage = createVerifiedPackage({
			packageId: 'claude',
			revision: '1.0.0',
			digestCharacter: 'b',
		});
		const harness = await createHarness([optionalPackage]);
		const initial = harness.lifecycle.snapshot();

		assert.deepStrictEqual(initial.installablePackages.map(item => item.packageId), ['claude']);
		assert.deepStrictEqual(initial.installedPackages.map(item => item.packageId), ['comet']);
		assert.deepStrictEqual(initial.activeRegistrations.map(item => item.agentId), ['comet']);
		assert.deepStrictEqual(initial.materializedBackings, []);
		assert.deepStrictEqual(harness.artifactPort.staged, []);

		await installPackage(harness, optionalPackage, 'install-claude', '1');
		const installed = harness.lifecycle.snapshot();
		assert.deepStrictEqual(installed.installedPackages.map(item => item.packageId), ['comet', 'claude']);
		assert.deepStrictEqual(installed.activeRegistrations.map(item => item.agentId), ['comet', 'claude']);
		const dependency = installed.installedPackages[1].dependencyClosure[0];
		assert.equal(Object.isFrozen(dependency), true);
		assert.throws(() => Object.assign(dependency, { target: 'changed' }), TypeError);
	});

	test('rejects embedded user packages and incomplete dependency closures without activation', async () => {
		const embedded = createVerifiedPackage({
			packageId: 'embedded-user',
			revision: '1.0.0',
			digestCharacter: 'c',
			runtimeForm: 'embedded',
		});
		const incomplete = createVerifiedPackage({
			packageId: 'incomplete',
			revision: '1.0.0',
			digestCharacter: 'd',
			closure: 'missing',
		});
		const harness = await createHarness([embedded, incomplete]);

		await assertPackageFailure(harness.lifecycle.install({
			operationId: createAgentPackageOperationId('install-embedded'),
			requestDigest: requestDigest('2'),
			packageId: embedded.manifest.packageId,
			offering: embedded.offering,
		}), AgentPackageErrorCode.RuntimeFormDenied);
		await assertPackageFailure(harness.lifecycle.install({
			operationId: createAgentPackageOperationId('install-incomplete'),
			requestDigest: requestDigest('3'),
			packageId: incomplete.manifest.packageId,
			offering: incomplete.offering,
		}), AgentPackageErrorCode.IncompleteDependencyClosure);

		assert.deepStrictEqual(harness.lifecycle.snapshot().installedPackages.map(item => item.packageId), ['comet']);
		assert.equal(harness.artifactPort.discarded.length, 2);
		assert.equal(harness.runtimePort.activationStates.size, 0);
	});

	test('reconciles the same operation and digest while rejecting a conflicting digest', async () => {
		const optionalPackage = createVerifiedPackage({
			packageId: 'codex',
			revision: '1.0.0',
			digestCharacter: 'e',
		});
		const harness = await createHarness([optionalPackage]);
		const operationId = createAgentPackageOperationId('install-codex');
		const digest = requestDigest('4');
		const request = {
			operationId,
			requestDigest: digest,
			packageId: optionalPackage.manifest.packageId,
			offering: optionalPackage.offering,
		};
		const first = harness.lifecycle.install(request);
		const duplicate = harness.lifecycle.install(request);
		await assertPackageFailure(harness.lifecycle.install({
			...request,
			requestDigest: requestDigest('5'),
		}), AgentPackageErrorCode.OperationConflict);
		const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

		assert.deepStrictEqual(duplicateResult, firstResult);
		assert.equal(harness.artifactPort.staged.length, 1);
		assert.deepStrictEqual(harness.lifecycle.getOperationOutcome({ operation: operationId, digest }), {
			kind: 'succeeded',
			result: firstResult,
		});
	});

	test('rejects active and retained cross-package Agent ID claims', async () => {
		const firstPackage = createVerifiedPackage({
			packageId: 'first-package',
			agentId: 'shared-agent',
			revision: '1.0.0',
			digestCharacter: 'f',
		});
		const secondPackage = createVerifiedPackage({
			packageId: 'second-package',
			agentId: 'shared-agent',
			revision: '1.0.0',
			digestCharacter: '1',
		});
		const harness = await createHarness([firstPackage, secondPackage]);
		await installPackage(harness, firstPackage, 'install-first', '6');

		await assertPackageFailure(harness.lifecycle.install({
			operationId: createAgentPackageOperationId('install-second-active'),
			requestDigest: requestDigest('7'),
			packageId: secondPackage.manifest.packageId,
			offering: secondPackage.offering,
		}), AgentPackageErrorCode.AgentIdConflict);

		const record = createBackingRecord({
			packageId: firstPackage.manifest.packageId,
			agentId: firstPackage.manifest.agentIds[0],
			sessionId: 'retained-session',
			schema: createAgentResumeSchemaId('resume.v1'),
		});
		await commitBackingRecord(harness.lifecycle, record, false);
		await harness.lifecycle.uninstall({
			operationId: createAgentPackageOperationId('uninstall-first'),
			requestDigest: requestDigest('8'),
			packageId: firstPackage.manifest.packageId,
		});
		await assertPackageFailure(harness.lifecycle.install({
			operationId: createAgentPackageOperationId('install-second-retained'),
			requestDigest: requestDigest('9'),
			packageId: secondPackage.manifest.packageId,
			offering: secondPackage.offering,
		}), AgentPackageErrorCode.CrossPackageAgentClaim);
	});

	test('updates through one package gate and atomically commits migrated resume state', async () => {
		const oldSchema = createAgentResumeSchemaId('resume.old');
		const newSchema = createAgentResumeSchemaId('resume.new');
		const firstRevision = createVerifiedPackage({
			packageId: 'worker',
			revision: '1.0.0',
			digestCharacter: '2',
		});
		const secondRevision = createVerifiedPackage({
			packageId: 'worker',
			revision: '2.0.0',
			digestCharacter: '3',
		});
		const harness = await createHarness([firstRevision, secondRevision]);
		harness.runtimePort.setRegistrations(firstRevision, [createRegistration(firstRevision, {
			schemas: [oldSchema],
		})]);
		harness.runtimePort.setRegistrations(secondRevision, [createRegistration(secondRevision, {
			schemas: [newSchema],
			migrationEdges: [{ sourceSchema: oldSchema, targetSchema: newSchema }],
		})]);
		await installPackage(harness, firstRevision, 'install-worker-v1', 'a');
		const record = createBackingRecord({
			packageId: firstRevision.manifest.packageId,
			agentId: firstRevision.manifest.agentIds[0],
			sessionId: 'worker-session',
			schema: oldSchema,
			data: 'old-resume-state',
		});
		await commitBackingRecord(harness.lifecycle, record, true);
		harness.runtimePort.migrationResult = { schema: newSchema, data: 'new-resume-state' };
		harness.trace.length = 0;

		await harness.lifecycle.update({
			operationId: createAgentPackageOperationId('update-worker-v2'),
			requestDigest: requestDigest('b'),
			packageId: firstRevision.manifest.packageId,
			offering: secondRevision.offering,
			authority: 'user',
		});

		assert.deepStrictEqual(harness.trace, [
			'store.commit',
			'artifact.stage',
			'runtime.prepareActivation',
			'store.commit',
			'lifecycle.acquire',
			'lifecycle.drain',
			'lifecycle.checkpointAndRelease',
			'runtime.migrate',
			'lifecycle.prepareActivation',
			'runtime.commitActivation',
			'store.commit',
			'store.commit',
			'lifecycle.complete',
			'runtime.retirePreviousActivation',
			'store.commit',
		]);
		const snapshot = harness.lifecycle.snapshot();
		assert.equal(
			snapshot.installedPackages.find(item => item.packageId === firstRevision.manifest.packageId)?.revision,
			secondRevision.manifest.revision,
		);
		assert.deepStrictEqual(snapshot.materializedBackings, []);
		assert.deepStrictEqual(snapshot.retainedBackingRecords[0].resumeState, {
			schema: newSchema,
			data: 'new-resume-state',
		});
		assert.deepStrictEqual(harness.lifecyclePort.acquiredAgentIds.at(-1), ['worker']);
	});

	test('rolls an update back completely when resume migration or state commit fails', async () => {
		const oldSchema = createAgentResumeSchemaId('resume.old');
		const newSchema = createAgentResumeSchemaId('resume.new');
		const firstRevision = createVerifiedPackage({
			packageId: 'rollback-agent',
			revision: '1.0.0',
			digestCharacter: '4',
		});
		const secondRevision = createVerifiedPackage({
			packageId: 'rollback-agent',
			revision: '2.0.0',
			digestCharacter: '5',
		});
		const harness = await createHarness([firstRevision, secondRevision]);
		harness.runtimePort.setRegistrations(firstRevision, [createRegistration(firstRevision, {
			schemas: [oldSchema],
		})]);
		harness.runtimePort.setRegistrations(secondRevision, [createRegistration(secondRevision, {
			schemas: [newSchema],
			migrationEdges: [{ sourceSchema: oldSchema, targetSchema: newSchema }],
		})]);
		await installPackage(harness, firstRevision, 'install-rollback-v1', 'c');
		const record = createBackingRecord({
			packageId: firstRevision.manifest.packageId,
			agentId: firstRevision.manifest.agentIds[0],
			sessionId: 'rollback-session',
			schema: oldSchema,
		});
		await commitBackingRecord(harness.lifecycle, record, true);
		const beforeMigrationFailure = harness.lifecycle.snapshot();
		harness.runtimePort.migrationError = new Error('injected migration failure');

		await assert.rejects(harness.lifecycle.update({
			operationId: createAgentPackageOperationId('update-rollback-migration'),
			requestDigest: requestDigest('d'),
			packageId: firstRevision.manifest.packageId,
			offering: secondRevision.offering,
			authority: 'user',
		}), /injected migration failure/);
		const afterMigrationFailure = harness.lifecycle.snapshot();
		assert.equal(afterMigrationFailure.catalogRevision, beforeMigrationFailure.catalogRevision);
		assert.deepStrictEqual(afterMigrationFailure.installedPackages, beforeMigrationFailure.installedPackages);
		assert.deepStrictEqual(afterMigrationFailure.activeRegistrations, beforeMigrationFailure.activeRegistrations);
		assert.deepStrictEqual(afterMigrationFailure.retainedBackingRecords, beforeMigrationFailure.retainedBackingRecords);
		assert.deepStrictEqual(afterMigrationFailure.materializedBackings, beforeMigrationFailure.materializedBackings);
		assert.equal(harness.lifecyclePort.mutations.at(-1)?.rollbackCount, 1);
		assert.equal(
			harness.runtimePort.activationStates.get(createAgentPackageOperationId('update-rollback-migration')),
			'rolledBack',
		);
		assert.equal(harness.artifactPort.discarded.at(-1)?.manifest.revision, secondRevision.manifest.revision);

		harness.runtimePort.migrationError = undefined;
		harness.runtimePort.migrationResult = { schema: newSchema, data: 'migrated' };
		harness.stateStore.failNextCatalogCommit = true;
		const beforeCommitFailure = harness.lifecycle.snapshot();
		await assert.rejects(harness.lifecycle.update({
			operationId: createAgentPackageOperationId('update-rollback-commit'),
			requestDigest: requestDigest('e'),
			packageId: firstRevision.manifest.packageId,
			offering: secondRevision.offering,
			authority: 'user',
		}), /injected state commit failure/);
		const afterCommitFailure = harness.lifecycle.snapshot();
		assert.equal(afterCommitFailure.catalogRevision, beforeCommitFailure.catalogRevision);
		assert.deepStrictEqual(afterCommitFailure.installedPackages, beforeCommitFailure.installedPackages);
		assert.deepStrictEqual(afterCommitFailure.activeRegistrations, beforeCommitFailure.activeRegistrations);
		assert.deepStrictEqual(afterCommitFailure.retainedBackingRecords, beforeCommitFailure.retainedBackingRecords);
		assert.deepStrictEqual(afterCommitFailure.materializedBackings, beforeCommitFailure.materializedBackings);
		assert.equal(harness.lifecyclePort.mutations.at(-1)?.rollbackCount, 1);
	});

	test('keeps uninstall, Agent-backed deletion, and Host-record purge separate', async () => {
		const optionalPackage = createVerifiedPackage({
			packageId: 'retained-agent',
			revision: '1.0.0',
			digestCharacter: '6',
		});
		const harness = await createHarness([optionalPackage]);
		await installPackage(harness, optionalPackage, 'install-retained', 'f');
		const firstRecord = createBackingRecord({
			packageId: optionalPackage.manifest.packageId,
			agentId: optionalPackage.manifest.agentIds[0],
			sessionId: 'retained-one',
			schema: createAgentResumeSchemaId('resume.v1'),
		});
		const secondRecord = createBackingRecord({
			packageId: optionalPackage.manifest.packageId,
			agentId: optionalPackage.manifest.agentIds[0],
			sessionId: 'retained-two',
			schema: createAgentResumeSchemaId('resume.v1'),
		});
		for (const record of [firstRecord, secondRecord]) {
			await commitBackingRecord(harness.lifecycle, record, record === firstRecord);
		}
		await assertPackageFailure(harness.lifecycle.purgeRetainedHostRecords({
			operationId: createAgentPackageOperationId('purge-while-installed'),
			requestDigest: requestDigest('0'),
			packageId: optionalPackage.manifest.packageId,
			records: [firstRecord.identity],
		}), AgentPackageErrorCode.HostRecordPurgeDenied);

		await harness.lifecycle.uninstall({
			operationId: createAgentPackageOperationId('uninstall-retained'),
			requestDigest: requestDigest('1'),
			packageId: optionalPackage.manifest.packageId,
		});
		let snapshot = harness.lifecycle.snapshot();
		assert.equal(snapshot.installedPackages.some(item => item.packageId === optionalPackage.manifest.packageId), false);
		assert.equal(snapshot.activeRegistrations.some(item => item.packageId === optionalPackage.manifest.packageId), false);
		assert.equal(snapshot.retainedBackingRecords.length, 2);
		assert.deepStrictEqual(snapshot.materializedBackings, []);
		const deleteAfterUninstallOperation = createAgentPackageOperationId('delete-after-uninstall');
		const deleteAfterUninstallDigest = requestDigest('2');
		await assertPackageFailure(harness.lifecycle.deleteAgentData({
			operationId: deleteAfterUninstallOperation,
			requestDigest: deleteAfterUninstallDigest,
			packageId: optionalPackage.manifest.packageId,
		}), AgentPackageErrorCode.PackageNotInstalled);
		const deleteAfterUninstallOutcome = harness.lifecycle.getOperationOutcome({
			operation: deleteAfterUninstallOperation,
			digest: deleteAfterUninstallDigest,
		});
		assert.equal(deleteAfterUninstallOutcome.kind, 'failed');
		if (deleteAfterUninstallOutcome.kind !== 'failed') {
			throw new Error('Delete-after-uninstall failure was not recorded');
		}
		assert.equal(deleteAfterUninstallOutcome.failure.reconciliation, 'terminal');

		await harness.lifecycle.purgeRetainedHostRecords({
			operationId: createAgentPackageOperationId('purge-retained-one'),
			requestDigest: requestDigest('3'),
			packageId: optionalPackage.manifest.packageId,
			records: [firstRecord.identity],
		});
		snapshot = harness.lifecycle.snapshot();
		assert.deepStrictEqual(snapshot.retainedBackingRecords.map(record => record.identity.sessionId), ['retained-two']);
		assert.deepStrictEqual(harness.runtimePort.deleteCalls, []);
	});

	test('resumes an Agent-backed deletion batch with the same operation identity', async () => {
		const optionalPackage = createVerifiedPackage({
			packageId: 'deletion-agent',
			revision: '1.0.0',
			digestCharacter: '7',
		});
		const harness = await createHarness([optionalPackage]);
		await installPackage(harness, optionalPackage, 'install-deletion', '4');
		const records = ['delete-one', 'delete-two'].map(sessionId => createBackingRecord({
			packageId: optionalPackage.manifest.packageId,
			agentId: optionalPackage.manifest.agentIds[0],
			sessionId,
			schema: createAgentResumeSchemaId('resume.v1'),
		}));
		for (const record of records) {
			await commitBackingRecord(harness.lifecycle, record, false);
		}
		harness.runtimePort.deleteFailureKey = `${optionalPackage.manifest.packageId}:delete-two`;
		const operationId = createAgentPackageOperationId('delete-agent-data');
		const digest = requestDigest('5');
		const request = {
			operationId,
			requestDigest: digest,
			packageId: optionalPackage.manifest.packageId,
		};

		await assert.rejects(harness.lifecycle.deleteAgentData(request), /injected backing deletion failure/);
		assert.deepStrictEqual(harness.lifecycle.getOperationOutcome({
			operation: operationId,
			digest,
		}), {
			kind: 'failed',
			failure: {
				code: 'internal',
				message: 'injected backing deletion failure',
				reconciliation: 'sameOperationRequired',
			},
		});
		assert.deepStrictEqual(
			harness.lifecycle.snapshot().retainedBackingRecords.map(record => record.identity.sessionId),
			['delete-two'],
		);
		const result = await harness.lifecycle.deleteAgentData(request);
		assert.equal(result.affectedRecords, 2);
		assert.deepStrictEqual(harness.lifecycle.snapshot().retainedBackingRecords, []);
		assert.deepStrictEqual(
			harness.runtimePort.deleteCalls.map(identity => identity.sessionId),
			['delete-one', 'delete-two', 'delete-two'],
		);
	});

	test('reinstalls only when every retained resume state is supported or migrated', async () => {
		const oldSchema = createAgentResumeSchemaId('resume.old');
		const newSchema = createAgentResumeSchemaId('resume.new');
		const firstRevision = createVerifiedPackage({
			packageId: 'reinstall-agent',
			revision: '1.0.0',
			digestCharacter: '8',
		});
		const secondRevision = createVerifiedPackage({
			packageId: 'reinstall-agent',
			revision: '2.0.0',
			digestCharacter: '9',
		});
		const harness = await createHarness([firstRevision, secondRevision]);
		harness.runtimePort.setRegistrations(firstRevision, [createRegistration(firstRevision, {
			schemas: [oldSchema],
		})]);
		harness.runtimePort.setRegistrations(secondRevision, [createRegistration(secondRevision, {
			schemas: [newSchema],
		})]);
		await installPackage(harness, firstRevision, 'install-reinstall-v1', '6');
		const record = createBackingRecord({
			packageId: firstRevision.manifest.packageId,
			agentId: firstRevision.manifest.agentIds[0],
			sessionId: 'reinstall-session',
			schema: oldSchema,
		});
		await commitBackingRecord(harness.lifecycle, record, false);
		await harness.lifecycle.uninstall({
			operationId: createAgentPackageOperationId('uninstall-reinstall-v1'),
			requestDigest: requestDigest('7'),
			packageId: firstRevision.manifest.packageId,
		});

		await assertPackageFailure(harness.lifecycle.install({
			operationId: createAgentPackageOperationId('reinstall-incompatible'),
			requestDigest: requestDigest('8'),
			packageId: secondRevision.manifest.packageId,
			offering: secondRevision.offering,
		}), AgentPackageErrorCode.ResumeSchemaIncompatible);
		assert.equal(
			harness.lifecycle.snapshot().installedPackages.some(item => item.packageId === secondRevision.manifest.packageId),
			false,
		);

		harness.runtimePort.setRegistrations(secondRevision, [createRegistration(secondRevision, {
			schemas: [newSchema],
			migrationEdges: [{ sourceSchema: oldSchema, targetSchema: newSchema }],
		})]);
		harness.runtimePort.migrationResult = { schema: newSchema, data: 'reinstalled-state' };
		await harness.lifecycle.install({
			operationId: createAgentPackageOperationId('reinstall-compatible'),
			requestDigest: requestDigest('9'),
			packageId: secondRevision.manifest.packageId,
			offering: secondRevision.offering,
		});
		assert.deepStrictEqual(harness.lifecycle.snapshot().retainedBackingRecords[0].resumeState, {
			schema: newSchema,
			data: 'reinstalled-state',
		});
	});

	test('checks queued operation preconditions against the catalog revision after predecessors commit', async () => {
		const firstPackage = createVerifiedPackage({
			packageId: 'queued-first', revision: '1.0.0', digestCharacter: 'a',
		});
		const secondPackage = createVerifiedPackage({
			packageId: 'queued-second', revision: '1.0.0', digestCharacter: 'b',
		});
		const harness = await createHarness([firstPackage, secondPackage]);
		const first = harness.lifecycle.execute({
			operation: createAgentPackageOperationId('queued-install-first'),
			digest: requestDigest('a'),
			expectedCatalogRevision: 0,
			payload: Object.freeze({
				kind: 'install', packageId: firstPackage.manifest.packageId, offering: firstPackage.offering,
			}),
		});
		const secondOperation = createAgentPackageOperationId('queued-install-second');
		const secondDigest = requestDigest('b');
		const second = harness.lifecycle.execute({
			operation: secondOperation,
			digest: secondDigest,
			expectedCatalogRevision: 0,
			payload: Object.freeze({
				kind: 'install', packageId: secondPackage.manifest.packageId, offering: secondPackage.offering,
			}),
		});

		const firstResult = await first;
		await assertPackageFailure(second, AgentPackageErrorCode.StateConflict);
		assert.equal(firstResult.stateRevision, 1);
		assert.equal(harness.lifecycle.snapshot().catalogRevision, 1);
		assert.equal(
			harness.lifecycle.snapshot().installedPackages.some(candidate => candidate.packageId === secondPackage.manifest.packageId),
			false,
		);
		assert.equal(harness.lifecycle.getOperationOutcome({ operation: secondOperation, digest: secondDigest }).kind, 'failed');
	});

	test('restarts install, update, and uninstall from an exact catalogCommitted transition', async () => {
		const firstPackage = createVerifiedPackage({
			packageId: 'restart-agent', revision: '1.0.0', digestCharacter: 'c',
		});
		const secondPackage = createVerifiedPackage({
			packageId: 'restart-agent', revision: '2.0.0', digestCharacter: 'd',
		});
		const packages = [firstPackage, secondPackage];
		const harness = await createHarness(packages);
		const createRestartRuntime = (): RuntimePort => {
			const runtime = new RuntimePort(harness.trace);
			for (const candidate of packages) {
				runtime.setRegistrations(candidate, [createRegistration(candidate)]);
			}
			return runtime;
		};
		let runtime = harness.runtimePort;

		const installOperation = createAgentPackageOperationId('restart-install');
		const installRequest = {
			operationId: installOperation,
			requestDigest: requestDigest('c'),
			packageId: firstPackage.manifest.packageId,
			offering: firstPackage.offering,
		};
		runtime.failRetireOperation = installOperation;
		await assert.rejects(harness.lifecycle.install(installRequest), /retirement failure/);
		assert.equal(harness.stateStore.state?.operations.at(-1)?.status, 'failed');
		runtime = createRestartRuntime();
		let lifecycle = await restartLifecycle(harness, packages, runtime);
		await lifecycle.install(installRequest);

		const updateOperation = createAgentPackageOperationId('restart-update');
		const updateRequest = {
			operationId: updateOperation,
			requestDigest: requestDigest('d'),
			packageId: firstPackage.manifest.packageId,
			offering: secondPackage.offering,
			authority: 'user' as const,
		};
		runtime.failRetireOperation = updateOperation;
		await assert.rejects(lifecycle.update(updateRequest), /retirement failure/);
		runtime = createRestartRuntime();
		lifecycle = await restartLifecycle(harness, packages, runtime);
		await lifecycle.update(updateRequest);

		const uninstallOperation = createAgentPackageOperationId('restart-uninstall');
		const uninstallRequest = {
			operationId: uninstallOperation,
			requestDigest: requestDigest('e'),
			packageId: firstPackage.manifest.packageId,
		};
		runtime.failRetireOperation = uninstallOperation;
		await assert.rejects(lifecycle.uninstall(uninstallRequest), /retirement failure/);
		assert.equal(
			lifecycle.snapshot().installedPackages.some(candidate => candidate.packageId === firstPackage.manifest.packageId),
			false,
		);
		runtime = createRestartRuntime();
		lifecycle = await restartLifecycle(harness, packages, runtime);
		await lifecycle.uninstall(uninstallRequest);
		assert.equal(runtime.activationStates.get(uninstallOperation), 'retired');
	});

	test('recovers runtimeCommitted after uncertain rollback and terminally rolls back a pre-commit activation', async () => {
		const firstPackage = createVerifiedPackage({
			packageId: 'runtime-phase-agent', revision: '1.0.0', digestCharacter: 'e',
		});
		const secondPackage = createVerifiedPackage({
			packageId: 'runtime-phase-agent', revision: '2.0.0', digestCharacter: 'f',
		});
		const packages = [firstPackage, secondPackage];
		const harness = await createHarness(packages);
		await installPackage(harness, firstPackage, 'runtime-phase-install', 'e');

		const commitFailureOperation = createAgentPackageOperationId('runtime-commit-failure');
		harness.runtimePort.failCommitOperation = commitFailureOperation;
		await assert.rejects(harness.lifecycle.update({
			operationId: commitFailureOperation,
			requestDigest: requestDigest('1'),
			packageId: firstPackage.manifest.packageId,
			offering: secondPackage.offering,
			authority: 'user',
		}), /activation commit failure/);
		assert.equal(harness.runtimePort.activationStates.get(commitFailureOperation), 'rolledBack');

		const uncertainOperation = createAgentPackageOperationId('runtime-commit-uncertain');
		const uncertainRequest = {
			operationId: uncertainOperation,
			requestDigest: requestDigest('2'),
			packageId: firstPackage.manifest.packageId,
			offering: secondPackage.offering,
			authority: 'user' as const,
		};
		harness.stateStore.failNextCatalogCommit = true;
		harness.runtimePort.failRollbackOperation = uncertainOperation;
		await assert.rejects(harness.lifecycle.update(uncertainRequest), AggregateError);
		const persisted = harness.stateStore.state?.operations.find(candidate => candidate.operation === uncertainOperation);
		assert.equal(persisted?.status, 'failed');
		assert.equal(persisted?.phase, 'runtimeCommitted');
		const restartedRuntime = new RuntimePort(harness.trace);
		for (const candidate of packages) {
			restartedRuntime.setRegistrations(candidate, [createRegistration(candidate)]);
		}
		let lifecycle = await restartLifecycle(harness, packages, restartedRuntime);
		await lifecycle.update(uncertainRequest);
		assert.equal(
			lifecycle.snapshot().installedPackages.find(candidate => candidate.packageId === firstPackage.manifest.packageId)?.revision,
			secondPackage.manifest.revision,
		);
	});

	test('rejects unknown fields in a persisted runtime transition', async () => {
		const optionalPackage = createVerifiedPackage({
			packageId: 'strict-transition', revision: '1.0.0', digestCharacter: '3',
		});
		const harness = await createHarness([optionalPackage]);
		const operation = createAgentPackageOperationId('strict-transition-install');
		harness.runtimePort.failRetireOperation = operation;
		await assert.rejects(harness.lifecycle.install({
			operationId: operation,
			requestDigest: requestDigest('3'),
			packageId: optionalPackage.manifest.packageId,
			offering: optionalPackage.offering,
		}), /retirement failure/);
		const durable = structuredClone(harness.stateStore.state!);
		const corrupt = structuredClone(durable);
		const persisted = corrupt.operations.find(candidate => candidate.operation === operation)!;
		assert.ok(persisted.status === 'failed' && persisted.phase === 'catalogCommitted');
		Object.assign(persisted.runtimeTransition.next!.installedPackage.manifest, { unknown: true });
		harness.stateStore.state = corrupt;
		await assert.rejects(restartLifecycle(harness, [optionalPackage]), /Invalid Agent package manifest fields/);

		const nullInstalledPackage = structuredClone(durable);
		const nullRecord = nullInstalledPackage.operations.find(candidate => candidate.operation === operation)!;
		assert.ok(nullRecord.status === 'failed' && nullRecord.phase === 'catalogCommitted');
		(nullRecord.runtimeTransition.next as { installedPackage: unknown }).installedPackage = null;
		harness.stateStore.state = nullInstalledPackage;
		await assert.rejects(restartLifecycle(harness, [optionalPackage]), error => (
			error instanceof AgentPackageError
			&& error.code === AgentPackageErrorCode.InvalidPackage
			&& /installed Agent package fields/.test(error.message)
		));
	});

	test('reconciles an all-missing purge after the Host effect commits before its terminal ledger record', async () => {
		const optionalPackage = createVerifiedPackage({
			packageId: 'purge-restart', revision: '1.0.0', digestCharacter: '4',
		});
		const harness = await createHarness([optionalPackage]);
		await installPackage(harness, optionalPackage, 'purge-restart-install', '4');
		const record = createBackingRecord({
			packageId: optionalPackage.manifest.packageId,
			agentId: optionalPackage.manifest.agentIds[0],
			sessionId: 'purge-restart-session',
			schema: createAgentResumeSchemaId('resume.v1'),
		});
		await commitBackingRecord(harness.lifecycle, record, false);
		await harness.lifecycle.uninstall({
			operationId: createAgentPackageOperationId('purge-restart-uninstall'),
			requestDigest: requestDigest('5'),
			packageId: optionalPackage.manifest.packageId,
		});
		const request = {
			operationId: createAgentPackageOperationId('purge-restart-operation'),
			requestDigest: requestDigest('6'),
			packageId: optionalPackage.manifest.packageId,
			records: Object.freeze([record.identity]),
		};
		harness.stateStore.failNextTerminalOperationCommit = true;
		await assert.rejects(harness.lifecycle.purgeRetainedHostRecords(request), /injected state commit failure/);
		assert.deepStrictEqual(harness.lifecycle.snapshot().retainedBackingRecords, []);
		const lifecycle = await restartLifecycle(harness, [optionalPackage], new RuntimePort(harness.trace));
		const result = await lifecycle.purgeRetainedHostRecords(request);
		assert.equal(result.affectedRecords, 1);
		assert.equal(
			harness.trace.filter(entry => entry === 'lifecycle.commitHostRecordPurge').length,
			2,
		);
	});
});
