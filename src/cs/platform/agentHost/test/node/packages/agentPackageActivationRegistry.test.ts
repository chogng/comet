/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { afterEach, suite, test } from 'node:test';

import { Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { observableValue } from 'cs/base/common/observable';
import type { IAgent, IAgentDescriptor, IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import { AgentConfigurationSchemaProfile } from 'cs/platform/agentHost/common/configuration';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import type {
	AgentRuntimeConnectionState,
	IAgentRuntimeConnection,
	IAgentRuntimeTransportLimits,
} from 'cs/platform/agentHost/common/connections';
import type { IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import {
	AgentPackageOperationId,
	createAgentCapabilityRevision,
	createAgentConfigurationSchemaRevision,
	createAgentDescriptorRevision,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentPackageRevision,
	createAgentResumeSchemaId,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeProtocolVersion,
	createAgentRuntimeRegistrationRevision,
	createAgentToolSchemaProfileId,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	AgentPackagePersistedOperation,
	IAgentPackageOffering,
	IAgentPackagePersistedState,
	IAgentPackageActivationTransition,
	IAgentPackageActivationTransitionSide,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import type { IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import {
	AgentPackageActivationRegistry,
	type AgentRuntimeConnectionLaunchContext,
	type IAgentRuntimeConnectionFactory,
	type IBundledAgentPackageActivation,
	type IHostAgentPackageFactory,
} from 'cs/platform/agentHost/node/packages/agentPackageActivationRegistry';

const protocolVersion = createAgentRuntimeProtocolVersion('2');
const schemaProfile = createAgentToolSchemaProfileId('comet.tool.v1');
const transportLimits: IAgentRuntimeTransportLimits = Object.freeze({
	maximumRequestBytes: 32 * 1_024,
	maximumResponseBytes: 32 * 1_024,
	maximumActionBytes: 16 * 1_024,
	maximumConcurrentCalls: 4,
});

interface IAgentDefinition {
	readonly installedPackage: IInstalledAgentPackage;
	readonly registration: IAgentRuntimeRegistration;
	readonly descriptor: IAgentDescriptor;
	readonly failInitialize?: boolean;
}

function createAgentDefinition(options: {
	readonly packageId: string;
	readonly agentId: string;
	readonly revision: string;
	readonly digestCharacter: string;
	readonly execution: 'host' | 'connected';
	readonly distribution: 'bundled' | 'user';
	readonly failInitialize?: boolean;
}): IAgentDefinition {
	const packageId = createAgentPackageId(options.packageId);
	const agentId = createAgentId(options.agentId);
	const packageRevision = createAgentPackageRevision(options.revision);
	const contentDigest = createAgentPackageContentDigest(
		`sha256:${options.digestCharacter.repeat(64)}`,
	);
	const dependencyDigest = createAgentPackageContentDigest(
		`sha256:${options.digestCharacter === 'f' ? 'e'.repeat(64) : 'f'.repeat(64)}`,
	);
	const hostDefaultsSchema = Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent: agentId,
		scope: 'hostDefault' as const,
		revision: createAgentConfigurationSchemaRevision(`host.${options.revision}.${agentId}`),
		properties: Object.freeze([]),
	});
	const sessionConfigurationSchema = Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent: agentId,
		scope: 'session' as const,
		revision: createAgentConfigurationSchemaRevision(`session.${options.revision}.${agentId}`),
		properties: Object.freeze([]),
	});
	const modelConfigurationSchema = Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent: agentId,
		scope: 'model' as const,
		revision: createAgentConfigurationSchemaRevision(`model.${options.revision}.${agentId}`),
		properties: Object.freeze([]),
	});
	const descriptorRevision = createAgentDescriptorRevision(
		`descriptor.${options.revision}.${agentId}`,
	);
	const capabilityRevision = createAgentCapabilityRevision(
		`capabilities.${options.revision}.${agentId}`,
	);
	const descriptor: IAgentDescriptor = Object.freeze({
		id: agentId,
		packageId,
		revision: descriptorRevision,
		displayName: `${options.agentId} ${options.revision}`,
		description: 'Activation registry test Agent',
		capabilities: Object.freeze({
			revision: capabilityRevision,
			supportsEmptySession: true,
			supportsCreateChat: true,
			maximumChatCount: 4,
			supportsForkChat: true,
			supportsQueue: true,
			supportsSteering: true,
			supportsCancellation: true,
			supportsReleaseSession: true,
			supportsReleaseChat: true,
			supportsDeleteSession: true,
			supportsDeleteChat: true,
		}),
		models: Object.freeze([Object.freeze({
			id: createAgentModelId(`${options.agentId}.model`),
			revision: createAgentModelDescriptorRevision(`model.${options.revision}.${agentId}`),
			displayName: 'Test model',
			enabled: true,
			configurationSchema: modelConfigurationSchema,
			toolSchemaProfiles: Object.freeze([schemaProfile]),
			attachments: Object.freeze({
				carriers: Object.freeze(['inline', 'reference'] as const),
				shapes: Object.freeze(['blob', 'tree'] as const),
				mediaTypes: Object.freeze(['text/plain']),
				maximumCount: 4,
				maximumItemBytes: 4_096,
				maximumTotalBytes: 16_384,
				maximumTreeDepth: 4,
				maximumTreeEntries: 64,
				supportsClientContentForBackgroundExecution: false,
			}),
		})]),
		requiresAgentAuthentication: false,
	});
	const registration: IAgentRuntimeRegistration = Object.freeze({
		packageId,
		agentId,
		revision: createAgentRuntimeRegistrationRevision(
			`registration.${options.revision}.${agentId}`,
		),
		descriptorRevision,
		capabilityRevision,
		hostDefaultsSchema,
		initialSessionConfigurationSchema: sessionConfigurationSchema.revision,
		supportedSessionConfigurationSchemas: Object.freeze([sessionConfigurationSchema.revision]),
		supportedToolSchemaProfiles: Object.freeze([schemaProfile]),
		supportedResumeSchemas: Object.freeze([createAgentResumeSchemaId(`resume.${options.revision}`)]),
		resumeMigrationEdges: Object.freeze([]),
	});
	const dependency = Object.freeze({
		id: 'runtime',
		source: `artifact.${options.packageId}.${options.revision}`,
		target: `bin/${options.packageId}`,
		digest: dependencyDigest,
		license: 'MIT',
		executable: options.execution === 'connected',
	});
	const installedPackage: IInstalledAgentPackage = Object.freeze({
		packageId,
		revision: packageRevision,
		contentDigest,
		source: `catalog.${options.packageId}.${options.revision}`,
		distribution: options.distribution,
		manifest: Object.freeze({
			schema: 1,
			packageId,
			revision: packageRevision,
			contentDigest,
			publisher: 'Comet test',
			target: Object.freeze({ operatingSystem: 'test-os', architecture: 'test-arch' }),
			execution: options.execution === 'host'
				? Object.freeze({ kind: 'host' as const })
				: Object.freeze({ kind: 'connected' as const, entryPoint: dependency.target }),
			agentIds: Object.freeze([agentId]),
			dependencies: Object.freeze([dependency]),
			privileges: Object.freeze([]),
		}),
		dependencyClosure: Object.freeze([Object.freeze({
			...dependency,
			verifiedDigest: dependencyDigest,
			immutable: true as const,
		})]),
		grantedPrivileges: Object.freeze([]),
	});
	return Object.freeze({
		installedPackage,
		registration,
		descriptor,
		...(options.failInitialize ? { failInitialize: true } : {}),
	});
}

function activationSide(definition: IAgentDefinition): IAgentPackageActivationTransitionSide {
	return Object.freeze({
		installedPackage: definition.installedPackage,
		registrations: Object.freeze([definition.registration]),
	});
}

function packageOffering(definition: IAgentDefinition): IAgentPackageOffering {
	return Object.freeze({
		packageId: definition.installedPackage.packageId,
		revision: definition.installedPackage.revision,
		contentDigest: definition.installedPackage.contentDigest,
		source: definition.installedPackage.source,
		distribution: definition.installedPackage.distribution,
	});
}

function persistedState(
	definition: IAgentDefinition,
	operations: readonly AgentPackagePersistedOperation[] = Object.freeze([]),
): IAgentPackagePersistedState {
	return Object.freeze({
		revision: operations.length,
		catalogRevision: operations.some(operation => (
			operation.status !== 'succeeded' && operation.phase === 'catalogCommitted'
		)) ? 1 : 0,
		operations,
		installedPackages: Object.freeze([definition.installedPackage]),
		activeRegistrations: Object.freeze([definition.registration]),
		retainedBackingRecords: Object.freeze([]),
		materializedBackings: Object.freeze([]),
	});
}

function interruptedOperation(
	operation: AgentPackageOperationId,
	phase: 'activationPrepared' | 'activationCommitted' | 'catalogCommitted',
	transition: IAgentPackageActivationTransition,
): AgentPackagePersistedOperation {
	return Object.freeze({
		operation,
		digest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
		kind: 'update',
		packageId: transition.next!.installedPackage.packageId,
		affectedRecords: 0,
		status: 'pending',
		phase,
		activationTransition: transition,
	});
}

class TestRuntimeConnection extends Disposable implements IAgentRuntimeConnection {
	readonly connection;
	readonly generation = createAgentRuntimeConnectionGeneration(1);
	readonly onDidDisconnect = Event.None as IAgentRuntimeConnection['onDidDisconnect'];
	readonly onDidReconnect = Event.None as IAgentRuntimeConnection['onDidReconnect'];
	readonly onDidEmitAction = Event.None as IAgentRuntimeConnection['onDidEmitAction'];
	readonly onDidRequestHostOperation = Event.None as IAgentRuntimeConnection['onDidRequestHostOperation'];
	private disposedValue = false;
	disposeCount = 0;

	constructor(
		private readonly definition: IAgentDefinition,
		sequence: number,
	) {
		super();
		this.connection = createAgentRuntimeConnectionId(`runtime-${sequence}`);
	}

	get state(): AgentRuntimeConnectionState {
		return this.disposedValue
			? { kind: 'disconnected', connection: this.connection, generation: this.generation, reason: 'disposed' }
			: { kind: 'connected', connection: this.connection, generation: this.generation };
	}

	initialize(request: Parameters<IAgentRuntimeConnection['initialize']>[0]): ReturnType<IAgentRuntimeConnection['initialize']> {
		if (this.definition.failInitialize) {
			return Promise.reject(new Error('injected runtime initialization failure'));
		}
		return Promise.resolve({
			connection: request.connection,
			generation: request.generation,
			call: request.call,
			protocolVersion,
			transportLimits: request.transportLimits,
			registrations: Object.freeze([Object.freeze({
				registration: this.definition.registration,
				descriptor: this.definition.descriptor,
			})]),
		});
	}

	resolveSessionConfiguration(_request: Parameters<IAgentRuntimeConnection['resolveSessionConfiguration']>[0]): ReturnType<IAgentRuntimeConnection['resolveSessionConfiguration']> { return this.unexpected('resolveSessionConfiguration'); }
	completeSessionConfiguration(_request: Parameters<IAgentRuntimeConnection['completeSessionConfiguration']>[0]): ReturnType<IAgentRuntimeConnection['completeSessionConfiguration']> { return this.unexpected('completeSessionConfiguration'); }
	prepareSessionConfigurationUpdate(_request: Parameters<IAgentRuntimeConnection['prepareSessionConfigurationUpdate']>[0]): ReturnType<IAgentRuntimeConnection['prepareSessionConfigurationUpdate']> { return this.unexpected('prepareSessionConfigurationUpdate'); }
	commitSessionConfigurationUpdate(_request: Parameters<IAgentRuntimeConnection['commitSessionConfigurationUpdate']>[0]): ReturnType<IAgentRuntimeConnection['commitSessionConfigurationUpdate']> { return this.unexpected('commitSessionConfigurationUpdate'); }
	rollbackSessionConfigurationUpdate(_request: Parameters<IAgentRuntimeConnection['rollbackSessionConfigurationUpdate']>[0]): ReturnType<IAgentRuntimeConnection['rollbackSessionConfigurationUpdate']> { return this.unexpected('rollbackSessionConfigurationUpdate'); }
	acknowledgeSessionConfigurationUpdate(_request: Parameters<IAgentRuntimeConnection['acknowledgeSessionConfigurationUpdate']>[0]): ReturnType<IAgentRuntimeConnection['acknowledgeSessionConfigurationUpdate']> { return this.unexpected('acknowledgeSessionConfigurationUpdate'); }
	resolveExecutionProfile(_request: Parameters<IAgentRuntimeConnection['resolveExecutionProfile']>[0]): ReturnType<IAgentRuntimeConnection['resolveExecutionProfile']> { return this.unexpected('resolveExecutionProfile'); }
	migrateResumeState(_request: Parameters<IAgentRuntimeConnection['migrateResumeState']>[0]): ReturnType<IAgentRuntimeConnection['migrateResumeState']> { return this.unexpected('migrateResumeState'); }
	createSession(_request: Parameters<IAgentRuntimeConnection['createSession']>[0]): ReturnType<IAgentRuntimeConnection['createSession']> { return this.unexpected('createSession'); }
	materializeSession(_request: Parameters<IAgentRuntimeConnection['materializeSession']>[0]): ReturnType<IAgentRuntimeConnection['materializeSession']> { return this.unexpected('materializeSession'); }
	releaseSession(_request: Parameters<IAgentRuntimeConnection['releaseSession']>[0]): ReturnType<IAgentRuntimeConnection['releaseSession']> { return this.unexpected('releaseSession'); }
	deleteSession(_request: Parameters<IAgentRuntimeConnection['deleteSession']>[0]): ReturnType<IAgentRuntimeConnection['deleteSession']> { return this.unexpected('deleteSession'); }
	createChat(_request: Parameters<IAgentRuntimeConnection['createChat']>[0]): ReturnType<IAgentRuntimeConnection['createChat']> { return this.unexpected('createChat'); }
	materializeChat(_request: Parameters<IAgentRuntimeConnection['materializeChat']>[0]): ReturnType<IAgentRuntimeConnection['materializeChat']> { return this.unexpected('materializeChat'); }
	releaseChat(_request: Parameters<IAgentRuntimeConnection['releaseChat']>[0]): ReturnType<IAgentRuntimeConnection['releaseChat']> { return this.unexpected('releaseChat'); }
	forkChat(_request: Parameters<IAgentRuntimeConnection['forkChat']>[0]): ReturnType<IAgentRuntimeConnection['forkChat']> { return this.unexpected('forkChat'); }
	send(_request: Parameters<IAgentRuntimeConnection['send']>[0]): ReturnType<IAgentRuntimeConnection['send']> { return this.unexpected('send'); }
	steer(_request: Parameters<IAgentRuntimeConnection['steer']>[0]): ReturnType<IAgentRuntimeConnection['steer']> { return this.unexpected('steer'); }
	cancel(_request: Parameters<IAgentRuntimeConnection['cancel']>[0]): ReturnType<IAgentRuntimeConnection['cancel']> { return this.unexpected('cancel'); }
	deleteChat(_request: Parameters<IAgentRuntimeConnection['deleteChat']>[0]): ReturnType<IAgentRuntimeConnection['deleteChat']> { return this.unexpected('deleteChat'); }
	getOperationOutcome(_request: Parameters<IAgentRuntimeConnection['getOperationOutcome']>[0]): ReturnType<IAgentRuntimeConnection['getOperationOutcome']> { return this.unexpected('getOperationOutcome'); }
	reportHostOperationProgress(_progress: Parameters<IAgentRuntimeConnection['reportHostOperationProgress']>[0]): ReturnType<IAgentRuntimeConnection['reportHostOperationProgress']> { return this.unexpected('reportHostOperationProgress'); }
	completeHostOperation(_response: Parameters<IAgentRuntimeConnection['completeHostOperation']>[0]): ReturnType<IAgentRuntimeConnection['completeHostOperation']> { return this.unexpected('completeHostOperation'); }

	override dispose(): void {
		if (this.disposedValue) {
			return;
		}
		this.disposedValue = true;
		this.disposeCount += 1;
		super.dispose();
	}

	private unexpected(method: string): Promise<never> {
		return Promise.reject(new Error(`Unexpected runtime call: ${method}`));
	}
}

interface IConnectionRecord {
	readonly definition: IAgentDefinition;
	readonly context: AgentRuntimeConnectionLaunchContext;
	readonly connection: TestRuntimeConnection;
}

class TestRuntimeConnectionFactory implements IAgentRuntimeConnectionFactory {
	private readonly definitions = new Map<string, IAgentDefinition>();
	readonly records: IConnectionRecord[] = [];

	constructor(definitions: readonly IAgentDefinition[]) {
		for (const definition of definitions) {
			this.definitions.set(this.key(definition.installedPackage), definition);
		}
	}

	async create(
		installedPackage: IInstalledAgentPackage,
		context: AgentRuntimeConnectionLaunchContext,
	): Promise<IAgentRuntimeConnection> {
		const definition = this.definitions.get(this.key(installedPackage));
		assert.ok(definition);
		const connection = new TestRuntimeConnection(definition, this.records.length + 1);
		this.records.push({ definition, context, connection });
		return connection;
	}

	private key(installedPackage: IInstalledAgentPackage): string {
		return `${installedPackage.packageId}\u0000${installedPackage.revision}`;
	}
}

class TestHostAgent extends Disposable implements IAgent {
	readonly id;
	readonly descriptor;
	readonly registration;
	readonly onDidEmitAction = Event.None as IAgent['onDidEmitAction'];
	readonly configuration: IAgent['configuration'];
	readonly executionProfiles: IAgent['executionProfiles'];
	readonly sessions: IAgent['sessions'];
	readonly chats: IAgent['chats'];
	readonly resumeStates: IAgent['resumeStates'];
	private disposedValue = false;
	disposeCount = 0;

	constructor(definition: IAgentDefinition) {
		super();
		this.id = definition.registration.agentId;
		this.registration = definition.registration;
		this.descriptor = observableValue(`TestHostAgent.${this.id}`, definition.descriptor);
		this.configuration = {
			resolveSession: () => this.unexpected('resolveSession'),
			completeSession: () => this.unexpected('completeSession'),
			prepareSessionUpdate: () => this.unexpected('prepareSessionUpdate'),
			commitSessionUpdate: () => this.unexpected('commitSessionUpdate'),
			rollbackSessionUpdate: () => this.unexpected('rollbackSessionUpdate'),
			acknowledgeSessionUpdate: () => this.unexpected('acknowledgeSessionUpdate'),
		};
		this.executionProfiles = { resolve: () => this.unexpected('resolveExecutionProfile') };
		this.sessions = {
			create: () => this.unexpected('createSession'),
			materialize: () => this.unexpected('materializeSession'),
			release: () => this.unexpected('releaseSession'),
			delete: () => this.unexpected('deleteSession'),
		};
		this.chats = {
			create: () => this.unexpected('createChat'),
			materialize: () => this.unexpected('materializeChat'),
			release: () => this.unexpected('releaseChat'),
			fork: () => this.unexpected('forkChat'),
			send: () => this.unexpected('send'),
			steer: () => this.unexpected('steer'),
			cancel: () => this.unexpected('cancel'),
			delete: () => this.unexpected('deleteChat'),
		};
		this.resumeStates = { migrate: () => this.unexpected('migrateResumeState') };
	}

	override dispose(): void {
		if (this.disposedValue) {
			return;
		}
		this.disposedValue = true;
		this.disposeCount += 1;
		super.dispose();
	}

	private unexpected(method: string): Promise<never> {
		return Promise.reject(new Error(`Unexpected Host Agent call: ${method}`));
	}
}

const toolExecution: IAgentToolExecutionPort = {
	execute: () => Promise.reject(new Error('Unexpected Tool execution')),
	cancel: () => Promise.reject(new Error('Unexpected Tool cancellation')),
	reconcile: () => Promise.reject(new Error('Unexpected Tool reconciliation')),
	release: () => { throw new Error('Unexpected Tool release'); },
};

const contentResources: IAgentContentResourcePort = {
	open: () => Promise.reject(new Error('Unexpected content open')),
	readBlob: () => Promise.reject(new Error('Unexpected content read')),
	readTreePage: () => Promise.reject(new Error('Unexpected tree page read')),
	readTreeEntry: () => Promise.reject(new Error('Unexpected tree entry read')),
	release: () => Promise.reject(new Error('Unexpected content release')),
	materialize: () => Promise.reject(new Error('Unexpected content materialization')),
	releaseMaterialization: () => Promise.reject(new Error('Unexpected materialization release')),
};

const credentialResolver: IAgentCredentialResolver = {
	resolve: () => Promise.reject(new Error('Unexpected credential resolution')),
};

function createRegistry(
	factory: IAgentRuntimeConnectionFactory,
	bundledAgents: readonly IBundledAgentPackageActivation[] = Object.freeze([]),
	hostAgentFactories: readonly IHostAgentPackageFactory[] = Object.freeze([]),
): AgentPackageActivationRegistry {
	return new AgentPackageActivationRegistry({
		bundledAgents,
		hostAgentFactories,
		connectionFactory: factory,
		toolExecution,
		contentResources,
		credentialResolver,
		protocolVersions: Object.freeze([protocolVersion]),
		transportLimits,
		implementation: Object.freeze({ name: 'Comet test Host', build: 'test' }),
	});
}

function assertPackageError(code: AgentPackageErrorCode): (error: unknown) => boolean {
	return error => {
		assert.ok(error instanceof AgentPackageError);
		assert.equal(error.code, code);
		return true;
	};
}

suite('AgentPackageActivationRegistry', { concurrency: false }, () => {
	const ownedRegistries: AgentPackageActivationRegistry[] = [];
	afterEach(() => {
		for (const registry of ownedRegistries.splice(0).reverse()) {
			registry.dispose();
		}
	});
	const own = (registry: AgentPackageActivationRegistry): AgentPackageActivationRegistry => {
		ownedRegistries.push(registry);
		return registry;
	};

	test('restores and resolves one exact product-authorized bundled Agent', async () => {
		const definition = createAgentDefinition({
			packageId: 'comet',
			agentId: 'comet',
			revision: '1.0.0',
			digestCharacter: '1',
			execution: 'host',
			distribution: 'bundled',
		});
		const agent = new TestHostAgent(definition);
		const registry = own(createRegistry(
			new TestRuntimeConnectionFactory([]),
			[{
				offerings: [packageOffering(definition)],
				agents: [agent],
				lifetime: agent,
			}],
		));

		await registry.restoreActivationState(persistedState(definition));
		assert.equal(registry.resolve(definition.registration), agent);
		registry.dispose();
		assert.equal(agent.disposeCount, 1);
	});

	test('activates one product-authorized user Host Agent without a runtime connection', async () => {
		const definition = createAgentDefinition({
			packageId: 'claude',
			agentId: 'claude',
			revision: '1.0.0',
			digestCharacter: '2',
			execution: 'host',
			distribution: 'user',
		});
		const agent = new TestHostAgent(definition);
		const connectionFactory = new TestRuntimeConnectionFactory([]);
		const hostFactory: IHostAgentPackageFactory = {
			offerings: Object.freeze([packageOffering(definition)]),
			create: async (installedPackage, services) => {
				assert.equal(installedPackage, definition.installedPackage);
				assert.equal(services.toolExecution, toolExecution);
				assert.equal(services.credentialResolver, credentialResolver);
				return Object.freeze({ agents: Object.freeze([agent]), lifetime: agent });
			},
		};
		const registry = own(createRegistry(
			connectionFactory,
			Object.freeze([]),
			Object.freeze([hostFactory]),
		));

		await registry.restoreActivationState(persistedState(definition));
		assert.equal(registry.resolve(definition.registration), agent);
		assert.deepEqual(connectionFactory.records, []);
		registry.dispose();
		assert.equal(agent.disposeCount, 1);
	});

	test('switches one exact bundled Agent across authorized bundled offerings', async () => {
		const previous = createAgentDefinition({
			packageId: 'comet',
			agentId: 'comet',
			revision: '1.0.0',
			digestCharacter: 'a',
			execution: 'host',
			distribution: 'bundled',
		});
		const nextArtifact = createAgentDefinition({
			packageId: 'comet',
			agentId: 'comet',
			revision: '2.0.0',
			digestCharacter: 'b',
			execution: 'host',
			distribution: 'bundled',
		});
		const next: IAgentDefinition = Object.freeze({
			installedPackage: nextArtifact.installedPackage,
			registration: previous.registration,
			descriptor: previous.descriptor,
		});
		const agent = new TestHostAgent(previous);
		const registry = own(createRegistry(
			new TestRuntimeConnectionFactory([]),
			[{
				offerings: [packageOffering(previous), packageOffering(next)],
				agents: [agent],
				lifetime: agent,
			}],
		));
		await registry.restoreActivationState(persistedState(previous));

		const rollbackOperation = createAgentPackageOperationId('update-comet-rollback');
		const rollbackRegistrations = await registry.prepareActivation(
			next.installedPackage,
			activationSide(previous),
			rollbackOperation,
		);
		const rollbackTransition: IAgentPackageActivationTransition = Object.freeze({
			previous: activationSide(previous),
			next: Object.freeze({ installedPackage: next.installedPackage, registrations: rollbackRegistrations }),
		});
		await registry.commitActivation(rollbackOperation, rollbackTransition);
		assert.equal(registry.resolve(previous.registration), agent);
		await registry.rollbackActivation(rollbackOperation, rollbackTransition);
		assert.equal(registry.resolve(previous.registration), agent);

		const retireOperation = createAgentPackageOperationId('update-comet-retire');
		const retireRegistrations = await registry.prepareActivation(
			next.installedPackage,
			activationSide(previous),
			retireOperation,
		);
		const retireTransition: IAgentPackageActivationTransition = Object.freeze({
			previous: activationSide(previous),
			next: Object.freeze({ installedPackage: next.installedPackage, registrations: retireRegistrations }),
		});
		await registry.commitActivation(retireOperation, retireTransition);
		await registry.retirePreviousActivation(retireOperation, retireTransition);
		assert.equal(registry.resolve(previous.registration), agent);

		registry.dispose();
		assert.equal(agent.disposeCount, 1);
	});

	test('prepares, commits, retires, and rolls back exact connected activations', async () => {
		const first = createAgentDefinition({ packageId: 'claude', agentId: 'claude', revision: '1.0.0', digestCharacter: '2', execution: 'connected', distribution: 'user' });
		const second = createAgentDefinition({ packageId: 'claude', agentId: 'claude', revision: '2.0.0', digestCharacter: '3', execution: 'connected', distribution: 'user' });
		const third = createAgentDefinition({ packageId: 'claude', agentId: 'claude', revision: '3.0.0', digestCharacter: '4', execution: 'connected', distribution: 'user' });
		const factory = new TestRuntimeConnectionFactory([first, second, third]);
		const registry = own(createRegistry(factory));
		await registry.restoreActivationState(persistedState(first));

		const firstOperation = createAgentPackageOperationId('update-claude-v2');
		const firstRegistrations = await registry.prepareActivation(
			second.installedPackage,
			activationSide(first),
			firstOperation,
		);
		const firstTransition: IAgentPackageActivationTransition = Object.freeze({
			previous: activationSide(first),
			next: Object.freeze({ installedPackage: second.installedPackage, registrations: firstRegistrations }),
		});
		assert.equal(
			registry.resolvePreparedActivation(firstOperation, second.registration).id,
			second.registration.agentId,
		);
		assert.throws(() => registry.resolve(second.registration), assertPackageError(AgentPackageErrorCode.RegistrationInvalid));
		assert.equal(registry.resolve(first.registration).id, first.registration.agentId);
		await registry.commitActivation(firstOperation, firstTransition);
		assert.throws(() => registry.resolve(first.registration), assertPackageError(AgentPackageErrorCode.RegistrationInvalid));
		assert.equal(registry.resolve(second.registration).id, second.registration.agentId);
		await registry.retirePreviousActivation(firstOperation, firstTransition);
		assert.equal(factory.records[0].connection.disposeCount, 1);
		assert.equal(factory.records[1].connection.disposeCount, 0);
		assert.throws(() => registry.resolve(first.registration), assertPackageError(AgentPackageErrorCode.RegistrationInvalid));
		await registry.acknowledgeActivationOperation(firstOperation, firstTransition);

		const secondOperation = firstOperation;
		const secondRegistrations = await registry.prepareActivation(
			third.installedPackage,
			activationSide(second),
			secondOperation,
		);
		const secondTransition: IAgentPackageActivationTransition = Object.freeze({
			previous: activationSide(second),
			next: Object.freeze({ installedPackage: third.installedPackage, registrations: secondRegistrations }),
		});
		await registry.commitActivation(secondOperation, secondTransition);
		await registry.rollbackActivation(secondOperation, secondTransition);
		assert.equal(factory.records[2].connection.disposeCount, 1);
		assert.equal(registry.resolve(second.registration).id, second.registration.agentId);
		assert.throws(() => registry.resolve(third.registration), assertPackageError(AgentPackageErrorCode.RegistrationInvalid));

		registry.dispose();
		assert.deepStrictEqual(factory.records.map(record => record.connection.disposeCount), [1, 1, 1]);
	});

	test('replaces a connected package artifact without inventing a runtime registration revision', async () => {
		const previous = createAgentDefinition({ packageId: 'claude', agentId: 'claude', revision: '1.0.0', digestCharacter: 'a', execution: 'connected', distribution: 'user' });
		const nextArtifact = createAgentDefinition({ packageId: 'claude', agentId: 'claude', revision: '2.0.0', digestCharacter: 'b', execution: 'connected', distribution: 'user' });
		const next: IAgentDefinition = Object.freeze({
			installedPackage: nextArtifact.installedPackage,
			registration: previous.registration,
			descriptor: previous.descriptor,
		});
		const factory = new TestRuntimeConnectionFactory([previous, next]);
		const registry = own(createRegistry(factory));
		await registry.restoreActivationState(persistedState(previous));
		const previousAgent = registry.resolve(previous.registration);

		const rollbackOperation = createAgentPackageOperationId('update-claude-same-registration-rollback');
		const rollbackRegistrations = await registry.prepareActivation(
			next.installedPackage,
			activationSide(previous),
			rollbackOperation,
		);
		const rollbackTransition: IAgentPackageActivationTransition = Object.freeze({
			previous: activationSide(previous),
			next: Object.freeze({ installedPackage: next.installedPackage, registrations: rollbackRegistrations }),
		});
		const stagedAgent = registry.resolvePreparedActivation(
			rollbackOperation,
			previous.registration,
		);
		assert.notEqual(stagedAgent, previousAgent);
		assert.equal(registry.resolve(previous.registration), previousAgent);
		await registry.commitActivation(rollbackOperation, rollbackTransition);
		assert.equal(registry.resolve(previous.registration), stagedAgent);
		await registry.rollbackActivation(rollbackOperation, rollbackTransition);
		assert.equal(registry.resolve(previous.registration), previousAgent);

		const retireOperation = createAgentPackageOperationId('update-claude-same-registration-retire');
		const retireRegistrations = await registry.prepareActivation(
			next.installedPackage,
			activationSide(previous),
			retireOperation,
		);
		const retireTransition: IAgentPackageActivationTransition = Object.freeze({
			previous: activationSide(previous),
			next: Object.freeze({ installedPackage: next.installedPackage, registrations: retireRegistrations }),
		});
		const replacementAgent = registry.resolvePreparedActivation(
			retireOperation,
			previous.registration,
		);
		assert.notEqual(replacementAgent, previousAgent);
		assert.equal(registry.resolve(previous.registration), previousAgent);
		await registry.commitActivation(retireOperation, retireTransition);
		await registry.retirePreviousActivation(retireOperation, retireTransition);
		assert.equal(registry.resolve(previous.registration), replacementAgent);
		assert.deepStrictEqual(factory.records.map(record => record.connection.disposeCount), [1, 1, 0]);
	});

	test('cold-restores a activationPrepared activation as staged only', async () => {
		const first = createAgentDefinition({ packageId: 'codex', agentId: 'codex', revision: '1.0.0', digestCharacter: '5', execution: 'connected', distribution: 'user' });
		const second = createAgentDefinition({ packageId: 'codex', agentId: 'codex', revision: '2.0.0', digestCharacter: '6', execution: 'connected', distribution: 'user' });
		const operation = createAgentPackageOperationId('update-codex-v2');
		const transition = Object.freeze({ previous: activationSide(first), next: activationSide(second) });
		const factory = new TestRuntimeConnectionFactory([first, second]);
		const registry = own(createRegistry(factory));
		await registry.restoreActivationState(persistedState(first, [
			interruptedOperation(operation, 'activationPrepared', transition),
		]));

		assert.deepStrictEqual(factory.records.map(record => record.context), [
			{ kind: 'restore' },
			{ kind: 'activation', operationId: operation },
		]);
		assert.equal(
			registry.resolvePreparedActivation(operation, second.registration).id,
			second.registration.agentId,
		);
		assert.throws(() => registry.resolve(second.registration), assertPackageError(AgentPackageErrorCode.RegistrationInvalid));
		assert.equal(registry.resolve(first.registration).id, first.registration.agentId);
		await registry.commitActivation(operation, transition);
		assert.equal(registry.resolve(second.registration).id, second.registration.agentId);
		await registry.rollbackActivation(operation, transition);
		assert.equal(factory.records[1].connection.disposeCount, 1);
		assert.equal(factory.records[0].connection.disposeCount, 0);
	});

	test('cold-restores activationCommitted and catalogCommitted activation phases exactly', async () => {
		const first = createAgentDefinition({ packageId: 'copilot', agentId: 'copilot', revision: '1.0.0', digestCharacter: '7', execution: 'connected', distribution: 'user' });
		const second = createAgentDefinition({ packageId: 'copilot', agentId: 'copilot', revision: '2.0.0', digestCharacter: '8', execution: 'connected', distribution: 'user' });
		const transition = Object.freeze({ previous: activationSide(first), next: activationSide(second) });
		const committedOperation = createAgentPackageOperationId('update-copilot-runtime-committed');
		const committedFactory = new TestRuntimeConnectionFactory([first, second]);
		const committedRegistry = own(createRegistry(committedFactory));
		await committedRegistry.restoreActivationState(persistedState(first, [
			interruptedOperation(committedOperation, 'activationCommitted', transition),
		]));
		assert.throws(() => committedRegistry.resolve(first.registration), assertPackageError(AgentPackageErrorCode.RegistrationInvalid));
		assert.equal(committedRegistry.resolve(second.registration).id, second.registration.agentId);
		await committedRegistry.rollbackActivation(committedOperation, transition);
		assert.equal(committedFactory.records[1].connection.disposeCount, 1);
		assert.equal(committedRegistry.resolve(first.registration).id, first.registration.agentId);

		const catalogOperation = createAgentPackageOperationId('update-copilot-catalog-committed');
		const catalogFactory = new TestRuntimeConnectionFactory([first, second]);
		const catalogRegistry = own(createRegistry(catalogFactory));
		await catalogRegistry.restoreActivationState(persistedState(second, [
			interruptedOperation(catalogOperation, 'catalogCommitted', transition),
		]));
		assert.deepStrictEqual(catalogFactory.records.map(record => record.definition.installedPackage.revision), [
			second.installedPackage.revision,
		]);
		await catalogRegistry.retirePreviousActivation(catalogOperation, transition);
		assert.equal(catalogRegistry.resolve(second.registration).id, second.registration.agentId);
		assert.equal(catalogFactory.records[0].connection.disposeCount, 0);
	});

	test('disposes a factory connection when connected-runtime negotiation fails', async () => {
		const definition = createAgentDefinition({
			packageId: 'broken',
			agentId: 'broken',
			revision: '1.0.0',
			digestCharacter: '9',
			execution: 'connected',
			distribution: 'user',
			failInitialize: true,
		});
		const factory = new TestRuntimeConnectionFactory([definition]);
		const registry = own(createRegistry(factory));

		await assert.rejects(
			registry.restoreActivationState(persistedState(definition)),
			/injected runtime initialization failure/,
		);
		assert.equal(factory.records[0].connection.disposeCount, 1);
	});
});
