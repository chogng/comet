/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { constObservable } from 'cs/base/common/observable';
import type { IAgent, IAgentAction, IAgentCancelTurnRequest, IAgentChatRequest, IAgentDescriptor, IAgentRuntimeRegistration, IAgentSteerRequest } from 'cs/platform/agentHost/common/agent';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	AgentConfigurationSchemaProfile,
	IAgentConfigurationCandidate,
	IAgentConfigurationSchema,
	IAgentConfigurationState,
	resolveAgentSessionConfigurationValues,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentContentResourceOpenRequest, IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import {
	AgentPackageOperationId,
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentCancellationId,
	createAgentCapabilityRevision,
	createAgentChatId,
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentContentDigest,
	createAgentContentLeaseId,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentDescriptorRevision,
	createAgentExecutionPresetId,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentPackageContentDigest,
	createAgentPackageRevision,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentToolCallId,
	createAgentToolId,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type {
	AgentHostChannelAction,
	AgentHostMutationPayload,
	AgentHostMutationOutcome,
	AgentHostSubmissionTarget,
	IAgentHostPreparedSubmission,
	IAgentHostSessionTypeDescriptor,
} from 'cs/platform/agentHost/common/protocol';
import type {
	AgentPackageOperationPayload,
	IAgentAuthenticationPort,
	IAgentAuthenticationRequest,
	IAgentPackagePersistedState,
	IAgentPackageTarget,
} from 'cs/platform/agentHost/common/packages';
import { computeAgentPackageOperationDigest } from 'cs/platform/agentHost/common/packages';
import {
	computeAgentHostMutationDigest,
	computeAgentHostSubmissionCaptureDigest,
	getAgentHostChatChannelId,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
} from 'cs/platform/agentHost/common/protocol';
import type { IAgentToolSet } from 'cs/platform/agentHost/common/tools';
import { runAgentHostSubscriptionConformanceScenario } from 'cs/platform/agentHost/test/common/agentHostConnectionConformance';
import {
	AgentPackageLifecycle,
	type IAgentPackageArtifactPort,
	type IAgentPackageActivationPort,
	type IAgentPackageStateStore,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import type { IAgentToolTurnAuthorityPort, IAgentToolTurnBinding } from 'cs/platform/agentHost/node/tools/agentToolCallAuthority';
import { COMET_AGENT_RESUME_SCHEMA } from 'cs/platform/agentHost/node/agents/comet/cometResume';
import { AgentHostAuthority, type IAgentHostAuthorityOptions } from 'cs/platform/agentHost/node/host/agentHostAuthority';
import {
	createEmptyAgentHostCatalog,
	maximumRetainedAgentHostSessionConfigurationFinalizations,
	migrateLegacySessionsCatalog,
	type IAgentHostCatalogStore,
	type IAgentHostLegacyCatalogSource,
	type IAgentHostLegacyCatalogMigrationCompanion,
	type IAgentHostPersistedCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog';

const packageId = createAgentPackageId('comet');
const agentId = createAgentId('comet');
const sessionTypeId = createAgentSessionTypeId('comet.session');
const resumeSchema = COMET_AGENT_RESUME_SCHEMA;
const registrationRevision = createAgentRuntimeRegistrationRevision('comet.runtime.v1');
const descriptorRevision = createAgentDescriptorRevision('comet.descriptor.v2');
const capabilityRevision = createAgentCapabilityRevision('comet.capabilities.v1');
const modelId = createAgentModelId('model-a');
const modelRevision = createAgentModelDescriptorRevision('model-a.v1');
const toolSchema = createAgentToolSchemaProfileId('comet.tools.v1');
const presetId = createAgentExecutionPresetId('automatic');
const protocolVersion = createAgentHostProtocolVersion('2');
const authorityId = createAgentHostAuthorityId('local');
const optionalPackageId = createAgentPackageId('optional-agent');
const optionalAgentId = createAgentId('optional-agent');
const optionalDescriptorRevision = createAgentDescriptorRevision('optional.descriptor.v1');
const optionalCapabilityRevision = createAgentCapabilityRevision('optional.capabilities.v1');

function createConfigurationSchema(
	owner: ReturnType<typeof createAgentId>,
	scope: 'hostDefault' | 'session' | 'model',
	revision: string,
	properties: IAgentConfigurationSchema['properties'] = Object.freeze([]),
): IAgentConfigurationSchema {
	return Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent: owner,
		scope,
		revision: createAgentConfigurationSchemaRevision(revision),
		properties,
	});
}

const modeProperty = Object.freeze({
	id: createAgentConfigurationPropertyId('comet.mode'),
	owner: Object.freeze({ kind: 'agent' as const, agent: agentId }),
	scopes: Object.freeze(['hostDefault', 'session'] as const),
	value: Object.freeze({ type: 'string' as const, enum: Object.freeze(['balanced', 'precise']) }),
	required: true,
	default: 'balanced',
	sessionMutable: true,
	dynamicCompletion: true,
	display: Object.freeze({ label: 'Mode' }),
	persistence: 'persisted' as const,
	redaction: 'public' as const,
});
const safetyProperty = Object.freeze({
	id: createAgentConfigurationPropertyId('comet.safety'),
	owner: Object.freeze({ kind: 'agent' as const, agent: agentId }),
	scopes: Object.freeze(['hostDefault', 'session'] as const),
	value: Object.freeze({ type: 'string' as const, enum: Object.freeze(['strict', 'permissive']) }),
	required: true,
	default: 'strict',
	sessionMutable: false,
	dynamicCompletion: false,
	display: Object.freeze({ label: 'Safety' }),
	persistence: 'persisted' as const,
	redaction: 'public' as const,
});
const hostDefaultsSchema = createConfigurationSchema(agentId, 'hostDefault', 'comet.host-defaults.v1', Object.freeze([modeProperty, safetyProperty]));
const initialSessionConfigurationSchema = createConfigurationSchema(agentId, 'session', 'comet.session-config.initial.v1');
const sessionConfigurationSchema = createConfigurationSchema(agentId, 'session', 'comet.session-config.v1', Object.freeze([modeProperty, safetyProperty]));
const modelConfigurationSchema = createConfigurationSchema(agentId, 'model', 'comet.model-config.v1');
const optionalHostDefaultsSchema = createConfigurationSchema(optionalAgentId, 'hostDefault', 'optional.host-defaults.v1');
const optionalSessionConfigurationSchema = createConfigurationSchema(optionalAgentId, 'session', 'optional.session-config.v1');
const optionalModelConfigurationSchema = createConfigurationSchema(optionalAgentId, 'model', 'optional.model-config.v1');
const conflictingHostDefaultsSchema: IAgentConfigurationSchema = Object.freeze({
	...hostDefaultsSchema,
	properties: Object.freeze([
		Object.freeze({ ...modeProperty, display: Object.freeze({ label: 'Conflicting mode' }) }),
		safetyProperty,
	]),
});
const conflictingSessionConfigurationSchema: IAgentConfigurationSchema = Object.freeze({
	...sessionConfigurationSchema,
	properties: Object.freeze([
		Object.freeze({ ...modeProperty, display: Object.freeze({ label: 'Conflicting mode' }) }),
		safetyProperty,
	]),
});
const conflictingModelConfigurationSchema: IAgentConfigurationSchema = Object.freeze({
	...modelConfigurationSchema,
	properties: Object.freeze([Object.freeze({
		...modeProperty,
		scopes: Object.freeze(['model'] as const),
		sessionMutable: false,
		display: Object.freeze({ label: 'Conflicting model mode' }),
	})]),
});
const sessionConfigurationCandidate: IAgentConfigurationCandidate = Object.freeze({
	schema: initialSessionConfigurationSchema.revision,
	values: Object.freeze({}),
});
const modelConfigurationCandidate: IAgentConfigurationCandidate = Object.freeze({
	schema: modelConfigurationSchema.revision,
	values: Object.freeze({}),
});
const migrationAgentDefaults: IAgentConfigurationState = Object.freeze({
	schema: hostDefaultsSchema,
	revision: createAgentConfigurationStateRevision('migration-host-defaults-v1'),
	values: Object.freeze({}),
});
const migrationSessionConfiguration: IAgentConfigurationState = Object.freeze({
	schema: sessionConfigurationSchema,
	revision: createAgentConfigurationStateRevision('migration-session-config-v1'),
	values: Object.freeze({ 'comet.mode': 'balanced', 'comet.safety': 'strict' }),
});
const optionalMigrationAgentDefaults: IAgentConfigurationState = Object.freeze({
	schema: optionalHostDefaultsSchema,
	revision: createAgentConfigurationStateRevision('optional-migration-host-defaults-v1'),
	values: Object.freeze({}),
});

const optionalRegistrationV1: IAgentRuntimeRegistration = Object.freeze({
	packageId: optionalPackageId,
	agentId: optionalAgentId,
	revision: createAgentRuntimeRegistrationRevision('optional.runtime.v1'),
	descriptorRevision: optionalDescriptorRevision,
	capabilityRevision: optionalCapabilityRevision,
	hostDefaultsSchema: optionalHostDefaultsSchema,
	initialSessionConfigurationSchema: optionalSessionConfigurationSchema.revision,
	supportedSessionConfigurationSchemas: Object.freeze([optionalSessionConfigurationSchema.revision]),
	supportedToolSchemaProfiles: Object.freeze([toolSchema]),
	supportedResumeSchemas: Object.freeze([resumeSchema]),
	resumeMigrationEdges: Object.freeze([]),
});
const optionalRegistrationV2: IAgentRuntimeRegistration = Object.freeze({
	...optionalRegistrationV1,
	revision: createAgentRuntimeRegistrationRevision('optional.runtime.v2'),
});

const registration: IAgentRuntimeRegistration = Object.freeze({
	packageId,
	agentId,
	revision: registrationRevision,
	descriptorRevision,
	capabilityRevision,
	hostDefaultsSchema,
	initialSessionConfigurationSchema: initialSessionConfigurationSchema.revision,
	supportedSessionConfigurationSchemas: Object.freeze([initialSessionConfigurationSchema.revision, sessionConfigurationSchema.revision]),
	supportedToolSchemaProfiles: Object.freeze([toolSchema]),
	supportedResumeSchemas: Object.freeze([resumeSchema]),
	resumeMigrationEdges: Object.freeze([]),
});

const updatedRegistration: IAgentRuntimeRegistration = Object.freeze({
	...registration,
	revision: createAgentRuntimeRegistrationRevision('comet.runtime.v2'),
});

const descriptor: IAgentDescriptor = Object.freeze({
	id: agentId,
	packageId,
	revision: descriptorRevision,
	displayName: 'Comet test Agent',
	description: 'Deterministic Host test Agent',
	capabilities: Object.freeze({
		revision: capabilityRevision,
		supportsEmptySession: true,
		supportsCreateChat: true,
		maximumChatCount: 8,
		supportsForkChat: true,
		supportsQueue: false,
		supportsSteering: true,
		supportsCancellation: true,
		supportsReleaseSession: true,
		supportsReleaseChat: true,
		supportsDeleteSession: true,
		supportsDeleteChat: true,
	}),
	models: Object.freeze([Object.freeze({
		id: modelId,
		revision: modelRevision,
		displayName: 'Model A',
		enabled: true,
		configurationSchema: modelConfigurationSchema,
		toolSchemaProfiles: Object.freeze([toolSchema]),
		attachments: Object.freeze({
			carriers: Object.freeze(['inline', 'reference'] as const),
			shapes: Object.freeze(['blob', 'tree'] as const),
			mediaTypes: Object.freeze(['text/plain']),
			maximumCount: 8,
			maximumItemBytes: 1024,
			maximumTotalBytes: 4096,
			maximumTreeDepth: 8,
			maximumTreeEntries: 128,
			supportsClientContentForBackgroundExecution: false,
		}),
	})]),
	requiresAgentAuthentication: false,
});

const optionalDescriptor: IAgentDescriptor = Object.freeze({
	...descriptor,
	id: optionalAgentId,
	packageId: optionalPackageId,
	revision: optionalDescriptorRevision,
	capabilities: Object.freeze({
		...descriptor.capabilities,
		revision: optionalCapabilityRevision,
	}),
	displayName: 'Optional test Agent',
	description: 'Explicitly installed test Agent',
	models: Object.freeze(descriptor.models.map(model => Object.freeze({ ...model, configurationSchema: optionalModelConfigurationSchema }))),
	requiresAgentAuthentication: true,
});

const sessionType: IAgentHostSessionTypeDescriptor = Object.freeze({
	id: sessionTypeId,
	packageId,
	agentId,
	displayName: Object.freeze({ kind: 'literal', value: 'Comet' }),
	description: Object.freeze({ kind: 'literal', value: 'Comet Session' }),
	capabilities: Object.freeze({
		workspace: 'optional',
		supportsEmptySession: true,
		supportsInitialTurn: true,
		supportsCreateChat: true,
		maximumChatCount: 8,
		supportsForkChat: true,
	}),
	models: Object.freeze([modelId]),
	executionPresets: Object.freeze([Object.freeze({
		id: presetId,
		displayName: Object.freeze({ kind: 'literal', value: 'Automatic' }),
		model: modelId,
	})]),
	automaticExecutionPreset: presetId,
	toolPolicy: Object.freeze({ kind: 'all' }),
});

const optionalSessionType: IAgentHostSessionTypeDescriptor = Object.freeze({
	...sessionType,
	id: createAgentSessionTypeId('optional.session'),
	packageId: optionalPackageId,
	agentId: optionalAgentId,
	displayName: Object.freeze({ kind: 'literal', value: 'Optional' }),
	description: Object.freeze({ kind: 'literal', value: 'Optional Session' }),
});

const toolSet: IAgentToolSet = Object.freeze({
	revision: createAgentToolSetRevision('tool-set-1'),
	schemaProfile: toolSchema,
	runtimeRegistration: registrationRevision,
	agentDescriptor: descriptorRevision,
	modelDescriptor: modelRevision,
	registrations: Object.freeze([]),
});

class MemoryCatalogStore implements IAgentHostCatalogStore {
	state: IAgentHostPersistedCatalog | undefined;
	readonly commits: IAgentHostPersistedCatalog[] = [];
	failNextCommit = false;
	failCommitWhen: ((state: IAgentHostPersistedCatalog) => boolean) | undefined;

	async read(): Promise<IAgentHostPersistedCatalog | undefined> {
		return this.state;
	}

	async commit(expectedRevision: number | undefined, state: IAgentHostPersistedCatalog): Promise<void> {
		if (this.failNextCommit || this.failCommitWhen?.(state)) {
			this.failNextCommit = false;
			this.failCommitWhen = undefined;
			throw new Error('injected Host catalog commit failure');
		}
		assert.equal(expectedRevision, this.state?.revision);
		this.state = state;
		this.commits.push(state);
	}
}

function createMigrationCompanion(): IAgentHostLegacyCatalogMigrationCompanion {
	let completed: ReturnType<typeof createAgentHostPayloadDigest> | undefined;
	return {
		prepare: async () => Object.freeze([]),
		commit: async request => {
			if (completed !== undefined && completed !== request.sourceDigest) {
				throw new Error('injected companion digest conflict');
			}
			completed = request.sourceDigest;
		},
		readCompletedMigration: async () => completed,
	};
}

class MemoryPackageStateStore implements IAgentPackageStateStore {
	state: IAgentPackagePersistedState | undefined;
	failNextCommit = false;
	failNextCatalogCommit = false;
	failNextTerminalOperationCommit = false;
	terminalPersistenceFailures = 0;

	async read(): Promise<IAgentPackagePersistedState | undefined> {
		return this.state;
	}

	async commit(expectedRevision: number | undefined, state: IAgentPackagePersistedState): Promise<void> {
		const terminalOperationCommit = state.operations.some(operation => (
			operation.status !== 'pending'
			&& this.state?.operations.find(candidate => candidate.operation === operation.operation)?.status === 'pending'
		));
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
		) || (this.terminalPersistenceFailures > 0 && terminalOperationCommit)) {
		if (this.terminalPersistenceFailures > 0 && terminalOperationCommit) {
			this.terminalPersistenceFailures -= 1;
		}
			this.failNextCommit = false;
			this.failNextCatalogCommit = false;
			this.failNextTerminalOperationCommit = false;
			throw new Error('injected package state commit failure');
		}
		assert.equal(expectedRevision, this.state?.revision);
		this.state = state;
	}
}

const packageTarget: IAgentPackageTarget = Object.freeze({ operatingSystem: 'test-os', architecture: 'test-arch' });

function bundledPackage(revision: string, digestCharacter: string): IVerifiedAgentPackage {
	const packageRevision = createAgentPackageRevision(revision);
	const contentDigest = createAgentPackageContentDigest(`sha256:${digestCharacter.repeat(64)}`);
	const dependencyDigest = createAgentPackageContentDigest(`sha256:${(digestCharacter === 'a' ? 'b' : 'a').repeat(64)}`);
	return Object.freeze({
		offering: Object.freeze({
			packageId,
			revision: packageRevision,
			contentDigest,
			source: `product.comet.${revision}`,
			distribution: 'bundled' as const,
		}),
		manifest: Object.freeze({
			schema: 1 as const,
			packageId,
			revision: packageRevision,
			contentDigest,
			publisher: 'comet',
			target: packageTarget,
			execution: Object.freeze({ kind: 'host' as const }),
			agentIds: Object.freeze([agentId]),
			dependencies: Object.freeze([Object.freeze({
				id: 'runtime',
				source: `product.comet.runtime.${revision}`,
				target: 'product/comet',
				digest: dependencyDigest,
				license: 'MIT',
				executable: false,
			})]),
			privileges: Object.freeze([]),
		}),
		dependencyClosure: Object.freeze([Object.freeze({
			id: 'runtime',
			source: `product.comet.runtime.${revision}`,
			target: 'product/comet',
			digest: dependencyDigest,
			verifiedDigest: dependencyDigest,
			license: 'MIT',
			executable: false,
			immutable: true,
		})]),
		grantedPrivileges: Object.freeze([]),
	});
}

function optionalPackage(revision: string, digestCharacter: string): IVerifiedAgentPackage {
	const packageRevision = createAgentPackageRevision(revision);
	const contentDigest = createAgentPackageContentDigest(`sha256:${digestCharacter.repeat(64)}`);
	const dependencyDigest = createAgentPackageContentDigest(`sha256:${(digestCharacter === 'c' ? 'd' : 'c').repeat(64)}`);
	return Object.freeze({
		offering: Object.freeze({
			packageId: optionalPackageId,
			revision: packageRevision,
			contentDigest,
			source: `catalog.optional-agent.${revision}`,
			distribution: 'user' as const,
		}),
		manifest: Object.freeze({
			schema: 1 as const,
			packageId: optionalPackageId,
			revision: packageRevision,
			contentDigest,
			publisher: 'optional-publisher',
			target: packageTarget,
			execution: Object.freeze({ kind: 'connected' as const, entryPoint: 'bin/optional-agent' }),
			agentIds: Object.freeze([optionalAgentId]),
			dependencies: Object.freeze([Object.freeze({
				id: 'runtime',
				source: `catalog.optional-agent.runtime.${revision}`,
				target: 'bin/optional-agent',
				digest: dependencyDigest,
				license: 'MIT',
				executable: true,
			})]),
			privileges: Object.freeze([]),
		}),
		dependencyClosure: Object.freeze([Object.freeze({
			id: 'runtime',
			source: `catalog.optional-agent.runtime.${revision}`,
			target: 'bin/optional-agent',
			digest: dependencyDigest,
			verifiedDigest: dependencyDigest,
			license: 'MIT',
			executable: true,
			immutable: true,
		})]),
		grantedPrivileges: Object.freeze([]),
	});
}

async function createPackageLifecycle(
	stateStore = new MemoryPackageStateStore(),
	stagedPackage?: IVerifiedAgentPackage,
	stagedRegistration: IAgentRuntimeRegistration = registration,
): Promise<AgentPackageLifecycle> {
	const artifactPort: IAgentPackageArtifactPort = {
		reconcile: async () => undefined,
		stage: async offering => {
			assert.ok(stagedPackage);
			assert.equal(offering.revision, stagedPackage.offering.revision);
			return stagedPackage;
		},
		discard: async () => undefined,
	};
	const activationStates = new Map<AgentPackageOperationId, 'prepared' | 'committed' | 'retired' | 'rolledBack'>();
	const activationPort: IAgentPackageActivationPort = {
		restoreActivationState: async () => undefined,
		prepareActivation: async (installedPackage, _previous, operationId) => {
			activationStates.set(operationId, 'prepared');
			return installedPackage === null ? Object.freeze([]) : Object.freeze([stagedRegistration]);
		},
		commitActivation: async operationId => { activationStates.set(operationId, 'committed'); },
		retirePreviousActivation: async operationId => { activationStates.set(operationId, 'retired'); },
		rollbackActivation: async operationId => { activationStates.set(operationId, 'rolledBack'); },
		acknowledgeActivationOperation: async operationId => { activationStates.delete(operationId); },
		migrateResumeState: async (_registration, request) => request.source,
		deleteBacking: async () => undefined,
	};
	return AgentPackageLifecycle.create({
		hostTarget: packageTarget,
		installablePackages: Object.freeze([]),
		bundledComet: Object.freeze({ verifiedPackage: bundledPackage('1.0.0', 'a'), registrations: Object.freeze([registration]) }),
		stateStore,
		artifactPort,
		activationPort,
	});
}

async function createOptionalPackageLifecycle(
	secondRegistration: IAgentRuntimeRegistration = optionalRegistrationV2,
): Promise<{
	readonly lifecycle: AgentPackageLifecycle;
	readonly first: IVerifiedAgentPackage;
	readonly second: IVerifiedAgentPackage;
	readonly stagedRevisions: readonly string[];
	readonly stateStore: MemoryPackageStateStore;
}> {
	const first = optionalPackage('1.0.0', 'c');
	const second = optionalPackage('2.0.0', 'e');
	const stagedRevisions: string[] = [];
	const activationStates = new Map<AgentPackageOperationId, 'prepared' | 'committed' | 'retired' | 'rolledBack'>();
	const packages = Object.freeze([first, second]);
	const stateStore = new MemoryPackageStateStore();
	const lifecycle = await AgentPackageLifecycle.create({
		hostTarget: packageTarget,
		installablePackages: Object.freeze(packages.map(candidate => candidate.offering)),
		bundledComet: Object.freeze({
			verifiedPackage: bundledPackage('1.0.0', 'a'),
			registrations: Object.freeze([registration]),
		}),
		stateStore,
		artifactPort: {
			reconcile: async () => undefined,
			stage: async offering => {
				const staged = packages.find(candidate => (
					candidate.offering.packageId === offering.packageId
					&& candidate.offering.revision === offering.revision
					&& candidate.offering.contentDigest === offering.contentDigest
					&& candidate.offering.source === offering.source
					&& candidate.offering.distribution === offering.distribution
				));
				assert.ok(staged);
				stagedRevisions.push(staged.offering.revision);
				return staged;
			},
			discard: async () => undefined,
		},
		activationPort: {
			restoreActivationState: async () => undefined,
			prepareActivation: async (installedPackage, _previous, operationId) => {
				activationStates.set(operationId, 'prepared');
				if (installedPackage === null) {
					return Object.freeze([]);
				}
				if (installedPackage.revision === first.offering.revision) {
					return Object.freeze([optionalRegistrationV1]);
				}
				if (installedPackage.revision === second.offering.revision) {
					return Object.freeze([secondRegistration]);
				}
				throw new Error(`Unexpected optional package revision '${installedPackage.revision}'`);
			},
			commitActivation: async operationId => { activationStates.set(operationId, 'committed'); },
			retirePreviousActivation: async operationId => { activationStates.set(operationId, 'retired'); },
			rollbackActivation: async operationId => { activationStates.set(operationId, 'rolledBack'); },
			acknowledgeActivationOperation: async operationId => { activationStates.delete(operationId); },
			migrateResumeState: async (_registration, request) => request.source,
			deleteBacking: async () => undefined,
		},
	});
	return Object.freeze({ lifecycle, first, second, stagedRevisions, stateStore });
}

class TestAgent implements IAgent {
	readonly id;
	readonly descriptor;
	readonly registration;
	private readonly actionEmitter = new Emitter<IAgentAction>();
	readonly onDidEmitAction = this.actionEmitter.event;
	readonly sessionsById = new Map<string, Set<string>>();
	readonly sessionCreates: string[] = [];
	readonly sessionMaterializes: string[] = [];
	readonly sessionCreateRequests: Parameters<IAgent['sessions']['create']>[0][] = [];
	readonly sessionMaterializeRequests: Parameters<IAgent['sessions']['materialize']>[0][] = [];
	readonly sessionReleases: string[] = [];
	readonly sessionDeletes: string[] = [];
	readonly chatCreates: string[] = [];
	readonly chatMaterializes: string[] = [];
	readonly chatReleases: string[] = [];
	readonly chatDeletes: string[] = [];
	readonly sends: IAgentChatRequest[] = [];
	readonly steers: IAgentSteerRequest[] = [];
	readonly cancels: IAgentCancelTurnRequest[] = [];
	readonly configurationPrepares: Parameters<IAgent['configuration']['prepareSessionUpdate']>[0][] = [];
	readonly configurationCommits: Parameters<IAgent['configuration']['commitSessionUpdate']>[0][] = [];
	readonly configurationRollbacks: Parameters<IAgent['configuration']['rollbackSessionUpdate']>[0][] = [];
	readonly configurationAcknowledgements: Parameters<IAgent['configuration']['acknowledgeSessionUpdate']>[0][] = [];
	failNextSend = false;
	failNextConfigurationPrepareAfterAccept = false;
	failNextConfigurationCommit = false;
	failNextConfigurationRollback = false;
	failNextConfigurationAcknowledgementAfterAccept = false;
	onPrepareSessionConfiguration?: (request: Parameters<IAgent['configuration']['prepareSessionUpdate']>[0]) => void;
	resolvedSessionConfigurationSchema: IAgentConfigurationSchema;

	constructor(
		runtimeRegistration: IAgentRuntimeRegistration = registration,
		agentDescriptor: IAgentDescriptor = descriptor,
	) {
		this.id = runtimeRegistration.agentId;
		this.registration = runtimeRegistration;
		this.descriptor = constObservable(agentDescriptor);
		this.resolvedSessionConfigurationSchema = this.id === agentId
			? sessionConfigurationSchema
			: optionalSessionConfigurationSchema;
	}

	readonly configuration: IAgent['configuration'] = {
		resolveSession: async request => {
			const schema = this.resolvedSessionConfigurationSchema;
			if (this.id === agentId) {
				assert.ok(
					request.candidate.schema === initialSessionConfigurationSchema.revision
					|| request.candidate.schema === sessionConfigurationSchema.revision,
				);
			} else {
				assert.equal(request.candidate.schema, schema.revision);
			}
			return Object.freeze({
				schema,
				values: resolveAgentSessionConfigurationValues(schema, request.hostDefaults.values, request.candidate.values),
			});
		},
		completeSession: async request => Object.freeze([Object.freeze({
			label: `${request.query} precise`,
			value: 'precise',
		})]),
		prepareSessionUpdate: async request => {
			this.onPrepareSessionConfiguration?.(request);
			this.configurationPrepares.push(request);
			if (this.failNextConfigurationPrepareAfterAccept) {
				this.failNextConfigurationPrepareAfterAccept = false;
				throw new Error('injected configuration prepare acknowledgement loss');
			}
		},
		commitSessionUpdate: async request => {
			this.configurationCommits.push(request);
			if (this.failNextConfigurationCommit) {
				this.failNextConfigurationCommit = false;
				throw new Error('injected configuration commit acknowledgement loss');
			}
		},
		rollbackSessionUpdate: async request => {
			this.configurationRollbacks.push(request);
			if (this.failNextConfigurationRollback) {
				this.failNextConfigurationRollback = false;
				throw new Error('injected configuration rollback acknowledgement loss');
			}
		},
		acknowledgeSessionUpdate: async request => {
			this.configurationAcknowledgements.push(request);
			if (this.failNextConfigurationAcknowledgementAfterAccept) {
				this.failNextConfigurationAcknowledgementAfterAccept = false;
				throw new Error('injected configuration acknowledgement response loss');
			}
		},
	};

	readonly executionProfiles: IAgent['executionProfiles'] = {
		resolve: async () => Object.freeze({
			revision: createAgentExecutionProfileRevision('profile-1'),
			digest: createAgentExecutionProfileDigest(`sha256:${'1'.repeat(64)}`),
			agentDescriptor: descriptorRevision,
			modelDescriptor: modelRevision,
			data: '{}',
		}),
	};

	readonly sessions: IAgent['sessions'] = {
		create: async request => {
			this.sessionCreateRequests.push(request);
			this.sessionCreates.push(request.session);
			this.sessionsById.set(request.session, new Set());
			return Object.freeze({ session: request.session, resume: Object.freeze({ schema: resumeSchema, data: '{}' }) });
		},
		materialize: async request => {
			this.sessionMaterializeRequests.push(request);
			this.sessionMaterializes.push(request.session);
		},
		release: async request => { this.sessionReleases.push(request.session); },
		delete: async request => {
			this.sessionDeletes.push(request.session);
			this.sessionsById.delete(request.session);
		},
	};

	readonly chats: IAgent['chats'] = {
		create: async request => {
			const chats = this.sessionsById.get(request.session);
			assert.ok(chats);
			chats.add(request.chat);
			this.chatCreates.push(`${request.session}/${request.chat}`);
			return Object.freeze({
				session: request.session,
				chat: request.chat,
				resume: Object.freeze({ schema: resumeSchema, data: '{}' }),
			});
		},
		materialize: async request => { this.chatMaterializes.push(`${request.session}/${request.chat}`); },
		release: async request => { this.chatReleases.push(`${request.session}/${request.chat}`); },
		fork: async request => {
			const chats = this.sessionsById.get(request.session);
			assert.ok(chats);
			chats.add(request.chat);
			return Object.freeze({ session: request.session, chat: request.chat, resume: Object.freeze({ schema: resumeSchema, data: '{}' }) });
		},
		send: async request => {
			this.sends.push(request);
			if (this.failNextSend) {
				this.failNextSend = false;
				throw new Error('injected Agent send failure');
			}
		},
		steer: async request => { this.steers.push(request); },
		cancel: async request => {
			this.cancels.push(request);
			queueMicrotask(() => this.emit({
				kind: 'turnTerminal',
				session: request.session,
				chat: request.chat,
				turn: request.turn,
				state: 'cancelled',
			}));
		},
		delete: async request => {
			this.chatDeletes.push(`${request.session}/${request.chat}`);
			this.sessionsById.get(request.session)?.delete(request.chat);
		},
	};

	readonly resumeStates: IAgent['resumeStates'] = {
		migrate: async request => request.source,
	};

	emit(action: IAgentAction): void {
		this.actionEmitter.fire(action);
	}
}

class TestToolTurnAuthority implements IAgentToolTurnAuthorityPort {
	readonly active = new Map<string, IAgentToolTurnBinding>();
	disposeCount = 0;

	bindTurn(binding: IAgentToolTurnBinding): { dispose(): void } {
		const key = `${binding.session}\u0000${binding.chat}\u0000${binding.turn}`;
		assert.equal(this.active.has(key), false);
		this.active.set(key, binding);
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) { return; }
				disposed = true;
				this.active.delete(key);
				this.disposeCount += 1;
			},
		};
	}
}

class TestTurnContentResources implements Pick<IAgentContentResourcePort, 'open' | 'release'> {
	readonly opens: IAgentContentResourceOpenRequest[] = [];
	readonly releases: ReturnType<typeof createAgentContentLeaseId>[] = [];
	readonly active = new Set<ReturnType<typeof createAgentContentLeaseId>>();
	private nextLease = 0;

	async open(request: IAgentContentResourceOpenRequest) {
		this.opens.push(request);
		const lease = createAgentContentLeaseId(`lease-${++this.nextLease}`);
		this.active.add(lease);
		return Object.freeze({ lease, content: request.content });
	}

	async release(lease: ReturnType<typeof createAgentContentLeaseId>): Promise<void> {
		assert.equal(this.active.delete(lease), true);
		this.releases.push(lease);
	}
}

class TestAuthenticationPort implements IAgentAuthenticationPort {
	state: ReturnType<IAgentAuthenticationPort['getState']> = 'unauthenticated';
	readonly requests: IAgentAuthenticationRequest[] = [];

	getState(runtimeRegistration: IAgentRuntimeRegistration): ReturnType<IAgentAuthenticationPort['getState']> {
		assert.equal(runtimeRegistration.packageId, packageId);
		assert.equal(runtimeRegistration.agentId, agentId);
		assert.equal(runtimeRegistration.revision, registrationRevision);
		return this.state;
	}

	async authenticate(request: IAgentAuthenticationRequest): Promise<'authenticated'> {
		this.requests.push(request);
		this.state = 'authenticated';
		return 'authenticated';
	}
}

function createIdentityFactory(): IAgentHostAuthorityOptions['identityFactory'] {
	let sessions = 0;
	let chats = 0;
	let turns = 0;
	let cancellations = 0;
	return {
		createSession: () => createAgentSessionId(`session-${++sessions}`),
		createChat: () => createAgentChatId(`chat-${++chats}`),
		createTurn: () => createAgentTurnId(`turn-${++turns}`),
		createCancellation: () => createAgentCancellationId(`cancel-${++cancellations}`),
	};
}

function createSessionTypeCatalog(): IAgentHostAuthorityOptions['sessionTypeCatalog'] {
	return {
		resolve: activeAgents => Object.freeze(activeAgents.map(activeAgent => {
			const resolved = activeAgent.registration.agentId === agentId
				? sessionType
				: activeAgent.registration.agentId === optionalAgentId
					? optionalSessionType
					: undefined;
			assert.ok(resolved);
			assert.equal(resolved.packageId, activeAgent.registration.packageId);
			assert.equal(resolved.agentId, activeAgent.descriptor.id);
			return resolved;
		})),
	};
}

async function createAuthority(
	store: MemoryCatalogStore,
	agent: TestAgent,
	replayLimit = 32,
	packageLifecycle?: AgentPackageLifecycle,
	toolTurnAuthority: IAgentToolTurnAuthorityPort = new TestToolTurnAuthority(),
	runtimeAgents: readonly TestAgent[] = Object.freeze([agent]),
	contentResources: Pick<IAgentContentResourcePort, 'open' | 'release'> = new TestTurnContentResources(),
	authentication?: IAgentAuthenticationPort,
	sessionTypeCatalog: IAgentHostAuthorityOptions['sessionTypeCatalog'] = createSessionTypeCatalog(),
): Promise<AgentHostAuthority> {
	const lifecycle = packageLifecycle ?? await createPackageLifecycle();
	return AgentHostAuthority.create({
		authority: authorityId,
		label: Object.freeze({ kind: 'literal', value: 'Local' }),
		supportedProtocolVersions: Object.freeze([protocolVersion]),
		capabilities: Object.freeze([]),
		implementation: Object.freeze({ name: 'test-host', build: '1' }),
		sessionTypeCatalog,
		agentRuntimes: {
			resolve: requested => {
				const resolved = runtimeAgents.find(candidate => candidate.registration.revision === requested.revision);
				assert.ok(resolved);
				assert.deepStrictEqual(resolved.registration, requested);
				return resolved;
			},
			resolvePreparedActivation: (_operationId, requested) => {
				const resolved = runtimeAgents.find(candidate => candidate.registration.revision === requested.revision);
				assert.ok(resolved);
				assert.deepStrictEqual(resolved.registration, requested);
				return resolved;
			},
		},
		packageLifecycle: lifecycle,
		...(authentication === undefined ? {} : { authentication }),
		catalogStore: store,
		identityFactory: createIdentityFactory(),
		submissionPolicy: { resolve: () => Object.freeze({ requestedDeadline: 10_000, outputConstraints: Object.freeze({}) }) },
		toolSets: { prepare: async () => toolSet },
		toolCallAuthority: toolTurnAuthority,
		contentResources,
		now: () => 1_000,
		reportUnexpectedError: error => { throw error; },
		maximumReplayActions: replayLimit,
	});
}

async function initialize(authority: AgentHostAuthority, id: string, subscriptions: readonly ReturnType<typeof getAgentHostRootChannelId>[]): Promise<IAgentHostConnection> {
	const connectionId = createAgentHostClientConnectionId(id);
	const connection = authority.createConnection(connectionId);
	await connection.initialize({
		connection: connectionId,
		protocolVersions: Object.freeze([protocolVersion]),
		capabilities: Object.freeze([]),
		locale: 'en',
		implementation: Object.freeze({ name: 'test-client', build: '1' }),
		subscriptions,
	});
	return connection;
}

async function mutate(
	connection: IAgentHostConnection,
	operation: string,
	payload: AgentHostMutationPayload,
): Promise<{ readonly outcome: AgentHostMutationOutcome; readonly digest: Awaited<ReturnType<typeof computeAgentHostMutationDigest>> }> {
	const digest = await computeAgentHostMutationDigest(payload);
	const outcome = await connection.mutate({ operation: createAgentHostOperationId(operation), digest, payload });
	return { outcome, digest };
}

async function executePackageOperation(
	connection: IAgentHostConnection,
	operation: string,
	expectedCatalogRevision: number,
	payload: AgentPackageOperationPayload,
) {
	const digest = await computeAgentPackageOperationDigest(expectedCatalogRevision, payload);
	const outcome = await connection.executePackageOperation({
		operation: createAgentPackageOperationId(operation),
		digest,
		expectedCatalogRevision,
		payload,
	});
	return { digest, outcome };
}

async function prepare(
	connection: IAgentHostConnection,
	submissionId: string,
	target: AgentHostSubmissionTarget,
	message = 'hello',
	attachments: readonly IAgentHostAttachment[] = Object.freeze([]),
): Promise<IAgentHostPreparedSubmission> {
	const capture = Object.freeze({ message, attachments: Object.freeze([...attachments]), interactionTargets: Object.freeze([]) });
	const result = await connection.prepareSubmission({
		submission: createAgentSubmissionId(submissionId),
		target,
		capture,
		captureDigest: await computeAgentHostSubmissionCaptureDigest(capture),
		executionSelection: Object.freeze({ kind: 'preset', preset: presetId, configuration: modelConfigurationCandidate }),
		toolPolicy: Object.freeze({ kind: 'all' }),
	});
	assert.equal(result.kind, 'prepared');
	if (result.kind !== 'prepared') { throw new Error('Submission preparation failed'); }
	return result.submission;
}

function referenceAttachment(connection: ReturnType<typeof createAgentHostClientConnectionId>): IAgentHostAttachment {
	return Object.freeze({
		envelopeVersion: 1,
		id: createAgentAttachmentId('article-attachment'),
		producerType: createAgentAttachmentProducerTypeId('article.document'),
		display: Object.freeze({ label: 'Article' }),
		representation: Object.freeze({
			schema: createAgentAttachmentRepresentationSchemaId('comet.article.v1'),
			mediaType: 'application/vnd.comet.article+json',
			value: Object.freeze({ uri: 'https://example.test/article' }),
		}),
		content: Object.freeze({
			kind: 'reference',
			reference: createAgentContentReferenceId('article-content'),
			owner: Object.freeze({ kind: 'client', connection }),
			shape: 'blob',
			mediaType: 'text/plain',
			bounds: Object.freeze({ byteLength: 5, maximumReadLength: 5 }),
			version: createAgentContentVersion('article-version-1'),
			digest: createAgentContentDigest(`sha256:${'a'.repeat(64)}`),
		}),
		metadata: Object.freeze([]),
	});
}

suite('AgentHostAuthority', { concurrency: false }, () => {
	test('rejects duplicate Session types resolved by the active Agent catalog', async () => {
		const agent = new TestAgent();
		await assert.rejects(createAuthority(
			new MemoryCatalogStore(),
			agent,
			32,
			undefined,
			new TestToolTurnAuthority(),
			Object.freeze([agent]),
			new TestTurnContentResources(),
			undefined,
			{ resolve: () => Object.freeze([sessionType, sessionType]) },
		), /resolved duplicate type IDs/);
	});

	test('reconciles a lost acknowledgement and returns replay or fresh restart snapshots', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const subscriptions = Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]);
		const connection = await initialize(authority, 'client-1', subscriptions);
		const payload: AgentHostMutationPayload = Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		});
		const first = await mutate(connection, 'operation-create-empty', payload);
		assert.equal(first.outcome.kind, 'succeeded');
		assert.equal(agent.sessionCreates.length, 1);
		const reconciled = await connection.getOperationOutcome({ operation: createAgentHostOperationId('operation-create-empty'), digest: first.digest });
		assert.deepStrictEqual(reconciled, first.outcome);
		const repeated = await mutate(connection, 'operation-create-empty', payload);
		assert.deepStrictEqual(repeated.outcome, first.outcome);
		assert.equal(agent.sessionCreates.length, 1);
		const replay = await connection.reconnect({ connection: connection.connection, lastHostSequence: createAgentHostSequence(0), subscriptions });
		assert.equal(replay.kind, 'replay');
		assert.equal(replay.kind === 'replay' ? replay.actions.length : -1, 2);
		connection.dispose();
		authority.dispose();

		const restarted = await createAuthority(store, agent);
		const restartedConnection = await initialize(restarted, 'client-2', subscriptions);
		const recovered = await restartedConnection.reconnect({ connection: restartedConnection.connection, lastHostSequence: createAgentHostSequence(0), subscriptions });
		assert.equal(recovered.kind, 'snapshots');
		assert.deepStrictEqual(recovered.kind === 'snapshots' ? recovered.snapshots.map(snapshot => snapshot.channel) : [], subscriptions);
		restartedConnection.dispose();
		restarted.dispose();
	});

	test('publishes exact configuration registrations and persists Agent defaults across restart', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-configuration-root', Object.freeze([getAgentHostRootChannelId()]));
		const subscribed = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostRootChannelId()]) });
		const root = subscribed.snapshots[0];
		assert.equal(root.kind, 'root');
		if (root.kind !== 'root') {
			throw new Error('Missing Agent Host root snapshot');
		}
		assert.equal(root.state.agentRegistrations[0].initialSessionConfigurationSchema, initialSessionConfigurationSchema.revision);
		assert.deepStrictEqual(root.state.agentRegistrations[0].supportedSessionConfigurationSchemas, [
			initialSessionConfigurationSchema.revision,
			sessionConfigurationSchema.revision,
		]);
		const initial = await connection.resolveSessionConfiguration({
			sessionType: sessionTypeId,
			candidate: sessionConfigurationCandidate,
		});
		assert.equal(initial.configuration.schema.revision, sessionConfigurationSchema.revision);
		assert.deepStrictEqual(initial.configuration.values, {
			'comet.mode': 'balanced',
			'comet.safety': 'strict',
		});
		const completions = await connection.completeSessionConfiguration({
			sessionType: sessionTypeId,
			candidate: Object.freeze({ schema: sessionConfigurationSchema.revision, values: initial.configuration.values }),
			resolvedSchema: initial.configuration.schema,
			property: modeProperty.id,
			query: 'most',
			limit: 10,
		});
		assert.deepStrictEqual(completions.completions, [Object.freeze({ label: 'most precise', value: 'precise' })]);
		const defaults = root.state.agentDefaults[0];
		const updated = await mutate(connection, 'operation-update-agent-defaults', Object.freeze({
			kind: 'updateAgentDefaults',
			agent: agentId,
			expectedRevision: defaults.revision,
			candidate: Object.freeze({
				schema: hostDefaultsSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'succeeded');
		connection.dispose();
		authority.dispose();

		const restarted = await createAuthority(store, agent);
		const restartedConnection = await initialize(restarted, 'client-configuration-root-restarted', Object.freeze([]));
		const resolved = await restartedConnection.resolveSessionConfiguration({
			sessionType: sessionTypeId,
			candidate: sessionConfigurationCandidate,
		});
		assert.deepStrictEqual(resolved.configuration.values, {
			'comet.mode': 'precise',
			'comet.safety': 'strict',
		});
		restartedConnection.dispose();
		restarted.dispose();
	});

	test('rejects persisted Agent defaults whose schema reuses the registered revision with different content', async () => {
		const store = new MemoryCatalogStore();
		store.state = createEmptyAgentHostCatalog(Object.freeze([Object.freeze({
			schema: conflictingHostDefaultsSchema,
			revision: createAgentConfigurationStateRevision('conflicting-host-defaults-state'),
			values: Object.freeze({}),
		})]));
		await assert.rejects(
			createAuthority(store, new TestAgent()),
			/does not match its exact runtime registration/,
		);
	});

	test('rejects model and resolved Session schemas that reuse a revision with different content', async () => {
		const conflictingDescriptor: IAgentDescriptor = Object.freeze({
			...descriptor,
			models: Object.freeze([
				descriptor.models[0],
				Object.freeze({
					...descriptor.models[0],
					id: createAgentModelId('model-conflict'),
					revision: createAgentModelDescriptorRevision('model-conflict.v1'),
					configurationSchema: conflictingModelConfigurationSchema,
				}),
			]),
		});
		await assert.rejects(
			createAuthority(new MemoryCatalogStore(), new TestAgent(registration, conflictingDescriptor)),
			/reuses configuration schema revision.*different content/,
		);

		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-session-schema-conflict', Object.freeze([]));
		const first = await connection.resolveSessionConfiguration({
			sessionType: sessionTypeId,
			candidate: sessionConfigurationCandidate,
		});
		assert.equal(first.configuration.schema.revision, sessionConfigurationSchema.revision);
		agent.resolvedSessionConfigurationSchema = conflictingSessionConfigurationSchema;
		await assert.rejects(
			connection.resolveSessionConfiguration({
				sessionType: sessionTypeId,
				candidate: sessionConfigurationCandidate,
			}),
			/reuses configuration schema revision.*different content/,
		);
		connection.dispose();
		authority.dispose();
	});

	test('rejects a persisted Session schema that conflicts with runtime resolution under the same revision', async () => {
		const store = new MemoryCatalogStore();
		const authority = await createAuthority(store, new TestAgent());
		const connection = await initialize(authority, 'client-persisted-session-schema-conflict', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-persisted-schema-conflict', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		connection.dispose();
		authority.dispose();

		const catalog = store.state!;
		const record = catalog.sessions[0];
		store.state = Object.freeze({
			...catalog,
			sessions: Object.freeze([Object.freeze({
				...record,
				state: Object.freeze({
					...record.state,
					configuration: Object.freeze({
						...record.state.configuration,
						schema: conflictingSessionConfigurationSchema,
					}),
				}),
			})]),
		});
		await assert.rejects(
			createAuthority(store, new TestAgent()),
			/reuses configuration schema revision.*different content/,
		);
	});

	test('applies a materialized Session configuration transaction after Host persistence', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-session-configuration', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-configured-session', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Configured Session was not created');
		}
		const session = created.outcome.result.session;
		assert.deepStrictEqual(agent.sessionCreateRequests[0].configuration.values, {
			'comet.mode': 'balanced',
			'comet.safety': 'strict',
		});
		const snapshot = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostSessionChannelId(session)]) });
		const before = snapshot.snapshots[0];
		assert.equal(before.kind, 'session');
		if (before.kind !== 'session') {
			throw new Error('Missing configured Session snapshot');
		}
		agent.onPrepareSessionConfiguration = request => {
			const intent = store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === request.operation
			));
			assert.equal(intent?.status, 'intent');
			assert.equal(intent?.status === 'intent' ? intent.decision : undefined, 'rollback');
			assert.equal(intent?.status === 'intent' ? intent.configuration : undefined, request.candidate.revision);
		};
		const updated = await mutate(connection, 'operation-update-session-configuration', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: before.state.configuration.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'succeeded');
		assert.equal(agent.configurationPrepares.length, 1);
		assert.equal(agent.configurationCommits.length, 1);
		assert.equal(agent.configurationRollbacks.length, 0);
		assert.deepStrictEqual(agent.configurationAcknowledgements, [{
			...agent.configurationCommits[0],
			decision: 'commit',
		}]);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === 'operation-update-session-configuration'
			))?.status,
			'acknowledged',
		);
		assert.deepStrictEqual(store.state?.sessions[0].state.configuration.values, {
			'comet.mode': 'precise',
			'comet.safety': 'strict',
		});
		const immutable = await mutate(connection, 'operation-update-immutable-session-configuration', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: store.state!.sessions[0].state.configuration.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'permissive' }),
			}),
		}));
		assert.equal(immutable.outcome.kind, 'failed');
		assert.equal(immutable.outcome.kind === 'failed' ? immutable.outcome.failure.code : undefined, 'invalidPayload');
		connection.dispose();
		authority.dispose();
	});

	test('retries an exact Session configuration acknowledgement after its response is lost', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-session-configuration-acknowledgement-loss', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-configuration-acknowledgement-loss', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Acknowledgement-loss Session was not created');
		}
		const session = created.outcome.result.session;
		const current = store.state!.sessions[0].state.configuration;
		agent.failNextConfigurationAcknowledgementAfterAccept = true;
		const updated = await mutate(connection, 'operation-session-configuration-acknowledgement-loss', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'pending');
		assert.equal(agent.configurationCommits.length, 1);
		assert.equal(agent.configurationAcknowledgements.length, 1);
		const completed = store.state?.sessionConfigurationFinalizations.find(candidate => (
			candidate.operation === 'operation-session-configuration-acknowledgement-loss'
		));
		assert.equal(completed?.status, 'completed');
		if (completed?.status !== 'completed') {
			throw new Error('Runtime terminal configuration decision was not retained for acknowledgement');
		}
		assert.deepStrictEqual(agent.configurationAcknowledgements[0], {
			operation: completed.operation,
			payloadDigest: completed.digest,
			runtimeRegistration: completed.runtimeRegistration,
			session: completed.session,
			configuration: completed.configuration,
			decision: completed.decision,
		});

		const reconciled = await connection.getOperationOutcome({
			operation: completed.operation,
			digest: completed.digest,
		});
		assert.equal(reconciled.kind, 'succeeded');
		assert.equal(agent.configurationCommits.length, 1);
		assert.equal(agent.configurationAcknowledgements.length, 2);
		assert.deepStrictEqual(agent.configurationAcknowledgements[1], agent.configurationAcknowledgements[0]);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => candidate.operation === completed.operation)?.status,
			'acknowledged',
		);
		connection.dispose();
		authority.dispose();
	});

	test('retries a completed Session configuration acknowledgement after Host and runtime restart', async () => {
		const store = new MemoryCatalogStore();
		let agent = new TestAgent();
		let authority = await createAuthority(store, agent);
		let connection = await initialize(authority, 'client-session-configuration-cold-acknowledgement', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-cold-configuration-acknowledgement', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Cold-acknowledgement Session was not created');
		}
		const session = created.outcome.result.session;
		const current = store.state!.sessions[0].state.configuration;
		const operation = createAgentHostOperationId('operation-session-configuration-cold-acknowledgement');
		store.failCommitWhen = state => state.sessionConfigurationFinalizations.some(candidate => (
			candidate.operation === operation && candidate.status === 'acknowledged'
		));
		const updated = await mutate(connection, operation, Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'pending');
		assert.equal(agent.configurationAcknowledgements.length, 1);
		const completed = store.state?.sessionConfigurationFinalizations.find(candidate => candidate.operation === operation);
		assert.equal(completed?.status, 'completed');
		if (completed?.status !== 'completed') {
			throw new Error('Completed configuration update was not retained across restart');
		}
		connection.dispose();
		authority.dispose();

		agent = new TestAgent();
		authority = await createAuthority(store, agent);
		assert.deepStrictEqual(agent.configurationAcknowledgements, [{
			operation: completed.operation,
			payloadDigest: completed.digest,
			runtimeRegistration: completed.runtimeRegistration,
			session: completed.session,
			configuration: completed.configuration,
			decision: completed.decision,
		}]);
		assert.deepStrictEqual(agent.sessionMaterializeRequests.at(-1)?.configuration, store.state?.sessions[0].state.configuration);
		connection = await initialize(authority, 'client-session-configuration-cold-acknowledgement', Object.freeze([]));
		assert.equal((await connection.getOperationOutcome({ operation, digest: completed.digest })).kind, 'succeeded');
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => candidate.operation === operation)?.status,
			'acknowledged',
		);
		connection.dispose();
		authority.dispose();
	});

	test('rolls a prepared Session configuration back when Host persistence fails', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-session-configuration-rollback', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-config-rollback', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Rollback Session was not created');
		}
		const session = created.outcome.result.session;
		const current = store.state!.sessions[0].state.configuration;
		store.failCommitWhen = state => state.sessionConfigurationFinalizations.some(candidate => (
			candidate.operation === 'operation-session-config-persistence-failure'
			&& candidate.status === 'pending'
			&& candidate.decision === 'commit'
		));
		const updated = await mutate(connection, 'operation-session-config-persistence-failure', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'failed');
		assert.equal(agent.configurationPrepares.length, 1);
		assert.equal(agent.configurationCommits.length, 0);
		assert.equal(agent.configurationRollbacks.length, 1);
		assert.deepStrictEqual(agent.configurationAcknowledgements, [{
			...agent.configurationRollbacks[0],
			decision: 'rollback',
		}]);
		assert.deepStrictEqual(store.state?.sessions[0].state.configuration, current);
		connection.dispose();
		authority.dispose();
	});

	test('recovers a durable rollback intent when preparation acknowledgement is lost before candidate commit', async () => {
		const store = new MemoryCatalogStore();
		let agent = new TestAgent();
		let authority = await createAuthority(store, agent);
		let connection = await initialize(authority, 'client-session-configuration-prepare-loss', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-prepare-loss', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Prepare-loss Session was not created');
		}
		const session = created.outcome.result.session;
		const current = store.state!.sessions[0].state.configuration;
		agent.failNextConfigurationPrepareAfterAccept = true;
		agent.failNextConfigurationRollback = true;
		const updated = await mutate(connection, 'operation-session-config-prepare-ack-loss', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'pending');
		assert.equal(agent.configurationPrepares.length, 1);
		assert.equal(agent.configurationRollbacks.length, 1);
		assert.deepStrictEqual(store.state?.sessions[0].state.configuration, current);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === 'operation-session-config-prepare-ack-loss'
			))?.status,
			'pending',
		);
		connection.dispose();
		authority.dispose();

		agent = new TestAgent();
		authority = await createAuthority(store, agent);
		connection = await initialize(authority, 'client-session-configuration-prepare-loss', Object.freeze([]));
		const outcome = await connection.getOperationOutcome({
			operation: createAgentHostOperationId('operation-session-config-prepare-ack-loss'),
			digest: updated.digest,
		});
		assert.equal(outcome.kind, 'failed');
		assert.equal(agent.configurationRollbacks.length, 0);
		assert.deepStrictEqual(agent.sessionMaterializeRequests.at(-1)?.configuration, current);
		connection.dispose();
		authority.dispose();
	});

	test('reconciles lost Session configuration finalization acknowledgements across Host restart', async () => {
		const store = new MemoryCatalogStore();
		let agent = new TestAgent();
		let authority = await createAuthority(store, agent);
		let connection = await initialize(authority, 'client-session-configuration-reconcile', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-config-reconcile', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Reconciliation Session was not created');
		}
		const session = created.outcome.result.session;
		const initial = store.state!.sessions[0].state.configuration;
		agent.failNextConfigurationCommit = true;
		const committed = await mutate(connection, 'operation-session-config-commit-ack-loss', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: initial.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(committed.outcome.kind, 'pending');
		assert.equal(agent.configurationCommits.length, 1);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === 'operation-session-config-commit-ack-loss'
			))?.status,
			'pending',
		);
		connection.dispose();
		authority.dispose();

		agent = new TestAgent();
		authority = await createAuthority(store, agent);
		connection = await initialize(authority, 'client-session-configuration-reconcile', Object.freeze([]));
		assert.deepStrictEqual(
			agent.sessionMaterializeRequests.at(-1)?.configuration,
			store.state?.sessions[0].state.configuration,
		);
		const commitOutcome = await connection.getOperationOutcome({
			operation: createAgentHostOperationId('operation-session-config-commit-ack-loss'),
			digest: committed.digest,
		});
		assert.equal(commitOutcome.kind, 'succeeded');
		assert.equal(agent.configurationCommits.length, 0);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === 'operation-session-config-commit-ack-loss'
			))?.status,
			'acknowledged',
		);
		const repeatedCommit = await connection.mutate({
			operation: createAgentHostOperationId('operation-session-config-commit-ack-loss'),
			digest: committed.digest,
			payload: Object.freeze({
				kind: 'updateSessionConfiguration',
				session,
				expectedRevision: initial.revision,
				candidate: Object.freeze({
					schema: sessionConfigurationSchema.revision,
					values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
				}),
			}),
		});
		assert.deepStrictEqual(repeatedCommit, commitOutcome);
		assert.equal(agent.configurationCommits.length, 0);
		const otherConnection = await initialize(authority, 'client-session-configuration-other-owner', Object.freeze([]));
		assert.deepStrictEqual(
			await otherConnection.getOperationOutcome({
				operation: createAgentHostOperationId('operation-session-config-commit-ack-loss'),
				digest: committed.digest,
			}),
			Object.freeze({ kind: 'unknown' }),
		);
		otherConnection.dispose();
		const forgedPayload = Object.freeze({
			kind: 'updateSessionConfiguration' as const,
			session,
			expectedRevision: initial.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'balanced', 'comet.safety': 'strict' }),
			}),
		});
		const forgedOutcome = await connection.mutate({
			operation: createAgentHostOperationId('operation-session-config-commit-ack-loss'),
			digest: committed.digest,
			payload: forgedPayload,
		});
		assert.equal(forgedOutcome.kind, 'failed');
		assert.equal(forgedOutcome.kind === 'failed' ? forgedOutcome.failure.code : undefined, 'invalidPayload');

		const current = store.state!.sessions[0].state.configuration;
		store.failCommitWhen = state => state.sessionConfigurationFinalizations.some(candidate => (
			candidate.operation === 'operation-session-config-rollback-ack-loss'
			&& candidate.status === 'pending'
			&& candidate.decision === 'commit'
		));
		agent.failNextConfigurationRollback = true;
		const rolledBack = await mutate(connection, 'operation-session-config-rollback-ack-loss', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'balanced', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(rolledBack.outcome.kind, 'pending');
		assert.equal(agent.configurationRollbacks.length, 1);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === 'operation-session-config-rollback-ack-loss'
			))?.status,
			'pending',
		);
		connection.dispose();
		authority.dispose();

		agent = new TestAgent();
		authority = await createAuthority(store, agent);
		connection = await initialize(authority, 'client-session-configuration-reconcile', Object.freeze([]));
		assert.deepStrictEqual(
			agent.sessionMaterializeRequests.at(-1)?.configuration,
			store.state?.sessions[0].state.configuration,
		);
		const rollbackOutcome = await connection.getOperationOutcome({
			operation: createAgentHostOperationId('operation-session-config-rollback-ack-loss'),
			digest: rolledBack.digest,
		});
		assert.equal(rollbackOutcome.kind, 'failed');
		assert.equal(agent.configurationRollbacks.length, 0);
		assert.deepStrictEqual(store.state?.sessions[0].state.configuration, current);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => (
				candidate.operation === 'operation-session-config-rollback-ack-loss'
			))?.status,
			'acknowledged',
		);
		connection.dispose();
		authority.dispose();
	});

	test('evicts the oldest acknowledged Session configuration result from durable and in-memory reconciliation', async () => {
		const store = new MemoryCatalogStore();
		let agent = new TestAgent();
		let authority = await createAuthority(store, agent);
		const ownerId = 'client-session-configuration-retention';
		let connection = await initialize(authority, ownerId, Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-configuration-retention', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Configuration-retention Session was not created');
		}
		const session = created.outcome.result.session;
		connection.dispose();
		authority.dispose();

		const owner = createAgentHostClientConnectionId(ownerId);
		const retained = Object.freeze(Array.from(
			{ length: maximumRetainedAgentHostSessionConfigurationFinalizations },
			(_, index) => Object.freeze({
				operation: createAgentHostOperationId(`retained-session-configuration-${index}`),
				digest: createAgentHostPayloadDigest(`sha256:${index.toString(16).padStart(64, '0')}`),
				connection: owner,
				status: 'acknowledged' as const,
				outcome: Object.freeze({
					kind: 'failed' as const,
					failure: Object.freeze({
						code: 'invalidState' as const,
						message: 'Retained terminal configuration result',
						reconciliation: 'terminal' as const,
					}),
				}),
			}),
		));
		const oldest = retained[0];
		store.state = Object.freeze({
			...store.state!,
			revision: store.state!.revision + 1,
			sessionConfigurationFinalizations: retained,
		});

		agent = new TestAgent();
		authority = await createAuthority(store, agent);
		connection = await initialize(authority, ownerId, Object.freeze([]));
		assert.deepEqual(await connection.getOperationOutcome({
			operation: oldest.operation,
			digest: oldest.digest,
		}), oldest.outcome);

		const current = store.state!.sessions[0].state.configuration;
		const updated = await mutate(connection, 'operation-fill-configuration-retention-ledger', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'succeeded');
		assert.equal(
			store.state?.sessionConfigurationFinalizations.length,
			maximumRetainedAgentHostSessionConfigurationFinalizations,
		);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.some(record => record.operation === oldest.operation),
			false,
		);
		assert.deepEqual(await connection.getOperationOutcome({
			operation: oldest.operation,
			digest: oldest.digest,
		}), Object.freeze({ kind: 'unknown' }));

		const otherConnection = await initialize(authority, 'client-session-configuration-retention-reuse', Object.freeze([]));
		const defaults = store.state!.agentDefaults.find(configuration => configuration.schema.agent === agentId);
		if (defaults === undefined) {
			throw new Error('Comet Agent defaults are missing');
		}
		const reused = await mutate(otherConnection, oldest.operation, Object.freeze({
			kind: 'updateAgentDefaults',
			agent: agentId,
			expectedRevision: defaults.revision,
			candidate: Object.freeze({ schema: defaults.schema.revision, values: defaults.values }),
		}));
		assert.equal(reused.outcome.kind, 'succeeded');
		otherConnection.dispose();
		connection.dispose();
		authority.dispose();
	});

	test('keeps a runtime-finalized Session configuration pending until its terminal ledger commit succeeds', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-session-configuration-terminal-ledger', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-session-for-terminal-ledger', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Terminal-ledger Session was not created');
		}
		const session = created.outcome.result.session;
		const current = store.state!.sessions[0].state.configuration;
		const operation = createAgentHostOperationId('operation-session-config-terminal-ledger');
		store.failCommitWhen = state => state.sessionConfigurationFinalizations.some(candidate => (
			candidate.operation === operation && candidate.status === 'completed'
		));
		const updated = await mutate(connection, operation, Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'pending');
		assert.equal(agent.configurationCommits.length, 1);
		const pendingSequence = store.state!.hostSequence;
		const pendingRevisions = store.state!.channelRevisions;
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => candidate.operation === operation)?.status,
			'pending',
		);
		const packageMutation = await authority.acquirePackageMutation(
			createAgentPackageOperationId('package-operation-waits-for-configuration'),
			createAgentHostPayloadDigest(`sha256:${'9'.repeat(64)}`),
			Object.freeze([agentId]),
		);
		let drained = false;
		const drain = packageMutation.drain().then(() => { drained = true; });
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(drained, false);
		const reconciled = await connection.getOperationOutcome({ operation, digest: updated.digest });
		assert.equal(reconciled.kind, 'succeeded');
		await drain;
		assert.equal(drained, true);
		await packageMutation.rollback();
		assert.equal(agent.configurationCommits.length, 2);
		assert.equal(store.state!.hostSequence, pendingSequence);
		assert.deepStrictEqual(store.state!.channelRevisions, pendingRevisions);
		assert.equal(
			store.state?.sessionConfigurationFinalizations.find(candidate => candidate.operation === operation)?.status,
			'acknowledged',
		);
		connection.dispose();
		authority.dispose();
	});

	test('updates released Session configuration without runtime prepare and materializes the committed state', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-released-session-configuration', Object.freeze([]));
		const created = await mutate(connection, 'operation-create-released-config-session', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Released configuration Session was not created');
		}
		const session = created.outcome.result.session;
		await mutate(connection, 'operation-release-config-session', Object.freeze({ kind: 'releaseSession', session }));
		const current = store.state!.sessions[0].state.configuration;
		const updated = await mutate(connection, 'operation-update-released-session-configuration', Object.freeze({
			kind: 'updateSessionConfiguration',
			session,
			expectedRevision: current.revision,
			candidate: Object.freeze({
				schema: sessionConfigurationSchema.revision,
				values: Object.freeze({ 'comet.mode': 'precise', 'comet.safety': 'strict' }),
			}),
		}));
		assert.equal(updated.outcome.kind, 'succeeded');
		assert.equal(agent.configurationPrepares.length, 0);
		assert.equal(agent.configurationCommits.length, 0);
		await mutate(connection, 'operation-materialize-config-session', Object.freeze({ kind: 'materializeSession', session }));
		assert.deepStrictEqual(agent.sessionMaterializeRequests.at(-1)?.configuration.values, {
			'comet.mode': 'precise',
			'comet.safety': 'strict',
		});
		connection.dispose();
		authority.dispose();
	});

	test('conforms to exact subscription replacement and reconnect filtering', async () => {
		const authority = await createAuthority(new MemoryCatalogStore(), new TestAgent());
		const connection = await initialize(authority, 'client-subscriptions', Object.freeze([
			getAgentHostRootChannelId(),
			getAgentHostSessionsChannelId(),
		]));
		try {
			const created = await mutate(connection, 'operation-create-subscription-session', Object.freeze({
				kind: 'createSession',
				sessionType: sessionTypeId,
				configuration: sessionConfigurationCandidate,
				chats: Object.freeze([
					Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) }),
					Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) }),
				]),
			}));
			assert.equal(created.outcome.kind, 'succeeded');
			if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
				throw new Error('Subscription conformance Session creation failed');
			}
			const session = created.outcome.result.session;
			const [removed, retained] = created.outcome.result.chats.map(chat => chat.chat);
			await runAgentHostSubscriptionConformanceScenario({
				connection,
				removedChannel: getAgentHostChatChannelId(session, removed),
				retainedChannel: getAgentHostChatChannelId(session, retained),
				missingChannel: getAgentHostChatChannelId(session, createAgentChatId('missing-chat')),
				publishRemovedAndRetained: async () => {
					await mutate(connection, 'operation-rename-removed-subscription-chat', Object.freeze({
						kind: 'renameChat', session, chat: removed, title: 'Removed subscription',
					}));
					await mutate(connection, 'operation-rename-retained-subscription-chat', Object.freeze({
						kind: 'renameChat', session, chat: retained, title: 'Retained subscription',
					}));
				},
			});
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('executes and reconciles explicit package lifecycle operations through the Host connection', async () => {
		const store = new MemoryCatalogStore();
		const cometAgent = new TestAgent();
		const optionalV1 = new TestAgent(optionalRegistrationV1, optionalDescriptor);
		const optionalV2 = new TestAgent(optionalRegistrationV2, optionalDescriptor);
		const packages = await createOptionalPackageLifecycle();
		const authority = await createAuthority(
			store,
			cometAgent,
			32,
			packages.lifecycle,
			new TestToolTurnAuthority(),
			Object.freeze([cometAgent, optionalV1, optionalV2]),
		);
		const connectionId = createAgentHostClientConnectionId('client-packages');
		const connection = authority.createConnection(connectionId);
		try {
			const initialized = await connection.initialize({
				connection: connectionId,
				protocolVersions: Object.freeze([protocolVersion]),
				capabilities: Object.freeze([]),
				locale: 'en',
				implementation: Object.freeze({ name: 'test-client', build: '1' }),
				subscriptions: Object.freeze([getAgentHostRootChannelId()]),
			});
			const root = initialized.snapshots[0];
			assert.equal(root?.kind, 'root');
			if (root?.kind !== 'root') { throw new Error('Agent Host root snapshot was not returned'); }
			assert.equal(root.state.capabilities.supportsPackageOperations, true);
			assert.equal(root.state.capabilities.supportsAgentAuthentication, false);
			assert.deepStrictEqual(root.state.packages.installedPackages.map(candidate => candidate.packageId), [packageId]);
			assert.deepStrictEqual(root.state.packages.activations.map(activation => activation.authentication), ['unavailable']);
			assert.deepStrictEqual(root.state.sessionTypes.map(candidate => candidate.id), [sessionType.id]);
			assert.deepStrictEqual(root.state.agentDefaults.map(candidate => candidate.schema.agent), [agentId]);

			const installPayload = Object.freeze({
				kind: 'install' as const,
				packageId: optionalPackageId,
				offering: packages.first.offering,
			});
			const installed = await executePackageOperation(connection, 'package-install', 0, installPayload);
			assert.equal(installed.outcome.kind, 'succeeded');
			if (installed.outcome.kind !== 'succeeded') { throw new Error('Optional package install failed'); }
			assert.equal(installed.outcome.result.stateRevision, 1);
			assert.deepStrictEqual(packages.stagedRevisions, [packages.first.offering.revision]);
			const installedRootResult = await connection.setSubscriptions({
				subscriptions: Object.freeze([getAgentHostRootChannelId()]),
			});
			const installedRoot = installedRootResult.snapshots[0];
			assert.equal(installedRoot?.kind, 'root');
			if (installedRoot?.kind !== 'root') { throw new Error('Installed root snapshot was not returned'); }
			assert.deepStrictEqual(
				installedRoot.state.sessionTypes.map(candidate => candidate.id),
				[sessionType.id, optionalSessionType.id],
			);
			assert.deepStrictEqual(
				installedRoot.state.agentDefaults.map(candidate => candidate.schema.agent),
				[agentId, optionalAgentId],
			);
			assert.deepStrictEqual(
				await connection.getPackageOperationOutcome({
					operation: createAgentPackageOperationId('package-install'),
					digest: installed.digest,
				}),
				installed.outcome,
			);
			assert.deepStrictEqual(
				(await executePackageOperation(connection, 'package-install', 0, installPayload)).outcome,
				installed.outcome,
			);
			assert.deepStrictEqual(packages.stagedRevisions, [packages.first.offering.revision]);

			const conflictingPayload = Object.freeze({
				kind: 'update' as const,
				packageId: optionalPackageId,
				offering: packages.second.offering,
			});
			const conflict = await executePackageOperation(connection, 'package-install', 1, conflictingPayload);
			assert.deepStrictEqual(conflict.outcome, { kind: 'conflict', recordedDigest: installed.digest });

			const updated = await executePackageOperation(connection, 'package-update', 1, conflictingPayload);
			assert.equal(updated.outcome.kind, 'succeeded');
			if (updated.outcome.kind !== 'succeeded') { throw new Error('Optional package update failed'); }
			assert.equal(updated.outcome.result.stateRevision, 2);
			assert.deepStrictEqual(packages.stagedRevisions, [
				packages.first.offering.revision,
				packages.second.offering.revision,
			]);

			const deleted = await executePackageOperation(
				connection,
				'package-delete-data',
				2,
				Object.freeze({ kind: 'deleteAgentData', packageId: optionalPackageId }),
			);
			assert.equal(deleted.outcome.kind, 'succeeded');
			if (deleted.outcome.kind !== 'succeeded') { throw new Error('Optional package data deletion failed'); }
			assert.equal(deleted.outcome.result.affectedRecords, 0);

			const uninstalled = await executePackageOperation(
				connection,
				'package-uninstall',
				2,
				Object.freeze({ kind: 'uninstall', packageId: optionalPackageId }),
			);
			assert.equal(uninstalled.outcome.kind, 'succeeded');
			if (uninstalled.outcome.kind !== 'succeeded') { throw new Error('Optional package uninstall failed'); }
			assert.equal(uninstalled.outcome.result.stateRevision, 3);
			const uninstalledRootResult = await connection.setSubscriptions({
				subscriptions: Object.freeze([getAgentHostRootChannelId()]),
			});
			const uninstalledRoot = uninstalledRootResult.snapshots[0];
			assert.equal(uninstalledRoot?.kind, 'root');
			if (uninstalledRoot?.kind !== 'root') { throw new Error('Uninstalled root snapshot was not returned'); }
			assert.deepStrictEqual(uninstalledRoot.state.sessionTypes.map(candidate => candidate.id), [sessionType.id]);
			assert.deepStrictEqual(uninstalledRoot.state.agentDefaults.map(candidate => candidate.schema.agent), [agentId]);

			const purge = await executePackageOperation(
				connection,
				'package-purge',
				3,
				Object.freeze({ kind: 'purgeHostRecords', packageId: optionalPackageId, records: Object.freeze([]) }),
			);
			assert.equal(purge.outcome.kind, 'failed');
			if (purge.outcome.kind !== 'failed') { throw new Error('Empty Host-record purge did not fail'); }
			assert.equal(purge.outcome.failure.code, 'hostRecordPurgeDenied');
			assert.deepStrictEqual(
				await connection.getPackageOperationOutcome({
					operation: createAgentPackageOperationId('package-purge'),
					digest: purge.digest,
				}),
				purge.outcome,
			);

			const stale = await executePackageOperation(connection, 'package-stale-install', 2, installPayload);
			assert.equal(stale.outcome.kind, 'failed');
			if (stale.outcome.kind !== 'failed') { throw new Error('Stale package catalog precondition did not fail'); }
			assert.equal(stale.outcome.failure.code, 'stateConflict');
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('publishes retained Session availability and active Session types in one package catalog commit', async () => {
		const store = new MemoryCatalogStore();
		const cometAgent = new TestAgent();
		const optionalAgent = new TestAgent(optionalRegistrationV1, optionalDescriptor);
		const packages = await createOptionalPackageLifecycle();
		const authority = await createAuthority(
			store,
			cometAgent,
			32,
			packages.lifecycle,
			new TestToolTurnAuthority(),
			Object.freeze([cometAgent, optionalAgent]),
		);
		const connection = await initialize(
			authority,
			'client-package-session-availability',
			Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
		);
		try {
			const installed = await executePackageOperation(
				connection,
				'package-session-install',
				0,
				Object.freeze({ kind: 'install', packageId: optionalPackageId, offering: packages.first.offering }),
			);
			assert.equal(installed.outcome.kind, 'succeeded');
			const created = await mutate(connection, 'package-session-create', Object.freeze({
				kind: 'createSession',
				sessionType: optionalSessionType.id,
				configuration: Object.freeze({
					schema: optionalSessionConfigurationSchema.revision,
					values: Object.freeze({}),
				}),
				chats: Object.freeze([Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) })]),
			}));
			assert.equal(created.outcome.kind, 'succeeded');
			if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
				throw new Error('Optional Session creation failed');
			}
			const session = created.outcome.result.session;
			const chat = created.outcome.result.chats[0].chat;
			await connection.setSubscriptions({ subscriptions: Object.freeze([
				getAgentHostRootChannelId(),
				getAgentHostSessionsChannelId(),
				getAgentHostSessionChannelId(session),
				getAgentHostChatChannelId(session, chat),
			]) });
			const uninstalledActions: AgentHostChannelAction['kind'][] = [];
			const uninstallSubscription = connection.onDidReceiveAction(action => uninstalledActions.push(action.kind));
			const uninstalled = await executePackageOperation(
				connection,
				'package-session-uninstall',
				2,
				Object.freeze({ kind: 'uninstall', packageId: optionalPackageId }),
			);
			uninstallSubscription.dispose();
			assert.equal(uninstalled.outcome.kind, 'succeeded');
			assert.deepStrictEqual(uninstalledActions, ['root', 'sessions', 'session', 'chat']);

			let snapshots = await connection.setSubscriptions({ subscriptions: Object.freeze([
				getAgentHostRootChannelId(),
				getAgentHostSessionsChannelId(),
				getAgentHostSessionChannelId(session),
				getAgentHostChatChannelId(session, chat),
			]) });
			const unavailableRoot = snapshots.snapshots.find(snapshot => snapshot.kind === 'root');
			const unavailableSession = snapshots.snapshots.find(snapshot => snapshot.kind === 'session');
			const unavailableChat = snapshots.snapshots.find(snapshot => snapshot.kind === 'chat');
			assert.ok(unavailableRoot?.kind === 'root');
			assert.ok(unavailableSession?.kind === 'session');
			assert.ok(unavailableChat?.kind === 'chat');
			assert.deepStrictEqual(unavailableRoot.state.sessionTypes.map(candidate => candidate.id), [sessionType.id]);
			assert.deepStrictEqual(unavailableRoot.state.agentDefaults.map(candidate => candidate.schema.agent), [agentId]);
			assert.equal(unavailableSession.state.lifecycle, 'unavailable');
			assert.equal(unavailableChat.state.lifecycle, 'unavailable');

			const reinstalledActions: AgentHostChannelAction['kind'][] = [];
			const reinstallSubscription = connection.onDidReceiveAction(action => reinstalledActions.push(action.kind));
			const reinstalled = await executePackageOperation(
				connection,
				'package-session-reinstall',
				3,
				Object.freeze({ kind: 'install', packageId: optionalPackageId, offering: packages.first.offering }),
			);
			reinstallSubscription.dispose();
			assert.equal(reinstalled.outcome.kind, 'succeeded');
			assert.deepStrictEqual(reinstalledActions, ['root', 'sessions', 'session', 'chat']);

			snapshots = await connection.setSubscriptions({ subscriptions: Object.freeze([
				getAgentHostRootChannelId(),
				getAgentHostSessionChannelId(session),
				getAgentHostChatChannelId(session, chat),
			]) });
			const releasedRoot = snapshots.snapshots.find(snapshot => snapshot.kind === 'root');
			const releasedSession = snapshots.snapshots.find(snapshot => snapshot.kind === 'session');
			const releasedChat = snapshots.snapshots.find(snapshot => snapshot.kind === 'chat');
			assert.ok(releasedRoot?.kind === 'root');
			assert.ok(releasedSession?.kind === 'session');
			assert.ok(releasedChat?.kind === 'chat');
			assert.deepStrictEqual(
				releasedRoot.state.sessionTypes.map(candidate => candidate.id),
				[sessionType.id, optionalSessionType.id],
			);
			assert.equal(releasedSession.state.lifecycle, 'released');
			assert.equal(releasedChat.state.lifecycle, 'released');
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('rejects package activation incompatible with retained Session configuration or models', async () => {
		const replacementSessionSchema = createConfigurationSchema(
			optionalAgentId,
			'session',
			'optional.session-config.v2',
		);
		const replacementDescriptorRevision = createAgentDescriptorRevision('optional.descriptor.v2');
		const scenarios = Object.freeze([
			Object.freeze({
				name: 'configuration',
				registration: Object.freeze({
					...optionalRegistrationV2,
					initialSessionConfigurationSchema: replacementSessionSchema.revision,
					supportedSessionConfigurationSchemas: Object.freeze([replacementSessionSchema.revision]),
				}),
				descriptor: optionalDescriptor,
			}),
			Object.freeze({
				name: 'model',
				registration: Object.freeze({
					...optionalRegistrationV2,
					descriptorRevision: replacementDescriptorRevision,
				}),
				descriptor: Object.freeze({
					...optionalDescriptor,
					revision: replacementDescriptorRevision,
					models: Object.freeze(optionalDescriptor.models.map(model => Object.freeze({ ...model, enabled: false }))),
				}),
			}),
		]);

		for (const scenario of scenarios) {
			const store = new MemoryCatalogStore();
			const cometAgent = new TestAgent();
			const optionalAgent = new TestAgent(optionalRegistrationV1, optionalDescriptor);
			const replacementAgent = new TestAgent(scenario.registration, scenario.descriptor);
			const packages = await createOptionalPackageLifecycle(scenario.registration);
			const authority = await createAuthority(
				store,
				cometAgent,
				32,
				packages.lifecycle,
				new TestToolTurnAuthority(),
				Object.freeze([cometAgent, optionalAgent, replacementAgent]),
			);
			const connection = await initialize(
				authority,
				`client-package-retained-${scenario.name}`,
				Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
			);
			try {
				const installed = await executePackageOperation(
					connection,
					`package-retained-${scenario.name}-install`,
					0,
					Object.freeze({ kind: 'install', packageId: optionalPackageId, offering: packages.first.offering }),
				);
				assert.equal(installed.outcome.kind, 'succeeded');
				const created = await mutate(connection, `package-retained-${scenario.name}-create`, Object.freeze({
					kind: 'createSession',
					sessionType: optionalSessionType.id,
					configuration: Object.freeze({
						schema: optionalSessionConfigurationSchema.revision,
						values: Object.freeze({}),
					}),
					chats: Object.freeze([Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) })]),
				}));
				assert.equal(created.outcome.kind, 'succeeded');
				if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
					throw new Error('Retained Session creation failed');
				}

				const updated = await executePackageOperation(
					connection,
					`package-retained-${scenario.name}-update`,
					1,
					Object.freeze({ kind: 'update', packageId: optionalPackageId, offering: packages.second.offering }),
				);
				assert.equal(updated.outcome.kind, 'failed');
				assert.deepStrictEqual(
					packages.lifecycle.snapshot().activeRegistrations.map(candidate => candidate.revision),
					[registrationRevision, optionalRegistrationV1.revision],
				);
				const snapshots = await connection.setSubscriptions({ subscriptions: Object.freeze([
					getAgentHostSessionChannelId(created.outcome.result.session),
					getAgentHostChatChannelId(created.outcome.result.session, created.outcome.result.chats[0].chat),
				]) });
				const sessionSnapshot = snapshots.snapshots.find(snapshot => snapshot.kind === 'session');
				const chatSnapshot = snapshots.snapshots.find(snapshot => snapshot.kind === 'chat');
				assert.equal(sessionSnapshot?.kind === 'session' && sessionSnapshot.state.lifecycle, 'available');
				assert.equal(chatSnapshot?.kind === 'chat' && chatSnapshot.state.lifecycle, 'available');
			} finally {
				connection.dispose();
				authority.dispose();
			}
		}
	});

	test('restores the active Agent catalog when package Host publication fails', async () => {
		const store = new MemoryCatalogStore();
		const cometAgent = new TestAgent();
		const optionalAgent = new TestAgent(optionalRegistrationV1, optionalDescriptor);
		const packages = await createOptionalPackageLifecycle();
		const authority = await createAuthority(
			store,
			cometAgent,
			32,
			packages.lifecycle,
			new TestToolTurnAuthority(),
			Object.freeze([cometAgent, optionalAgent]),
		);
		const connection = await initialize(authority, 'client-package-publication-failure', Object.freeze([
			getAgentHostRootChannelId(),
		]));
		try {
			const published: AgentHostChannelAction[] = [];
			const subscription = connection.onDidReceiveAction(action => published.push(action));
			store.failNextCommit = true;
			const installed = await executePackageOperation(
				connection,
				'package-publication-failure',
				0,
				Object.freeze({ kind: 'install', packageId: optionalPackageId, offering: packages.first.offering }),
			);
			subscription.dispose();
			assert.equal(installed.outcome.kind, 'failed');
			assert.deepStrictEqual(published, []);
			assert.deepStrictEqual(
				packages.lifecycle.snapshot().activeRegistrations.map(candidate => candidate.agentId),
				[agentId],
			);
			const result = await connection.setSubscriptions({
				subscriptions: Object.freeze([getAgentHostRootChannelId()]),
			});
			const root = result.snapshots[0];
			assert.ok(root?.kind === 'root');
			assert.deepStrictEqual(root.state.agents.map(candidate => candidate.id), [agentId]);
			assert.deepStrictEqual(root.state.agentDefaults.map(candidate => candidate.schema.agent), [agentId]);
			assert.deepStrictEqual(root.state.sessionTypes.map(candidate => candidate.id), [sessionType.id]);
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('reconciles a Host-record purge from the durable Host effect after terminal package persistence fails', async () => {
		const store = new MemoryCatalogStore();
		const cometAgent = new TestAgent();
		const optionalAgent = new TestAgent(optionalRegistrationV1, optionalDescriptor);
		const packages = await createOptionalPackageLifecycle();
		const authority = await createAuthority(
			store,
			cometAgent,
			32,
			packages.lifecycle,
			new TestToolTurnAuthority(),
			Object.freeze([cometAgent, optionalAgent]),
		);
		const connection = await initialize(
			authority,
			'client-package-purge-recovery',
			Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
		);
		try {
			const installPayload = Object.freeze({
				kind: 'install' as const,
				packageId: optionalPackageId,
				offering: packages.first.offering,
			});
			const installed = await executePackageOperation(connection, 'purge-recovery-install', 0, installPayload);
			assert.equal(installed.outcome.kind, 'succeeded');
			const created = await mutate(connection, 'purge-recovery-create', Object.freeze({
				kind: 'createSession',
				sessionType: optionalSessionType.id,
				configuration: Object.freeze({ schema: optionalSessionConfigurationSchema.revision, values: Object.freeze({}) }),
				chats: Object.freeze([]),
			}));
			assert.equal(created.outcome.kind, 'succeeded');
			if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
				throw new Error('Optional Session creation failed');
			}
			const session = created.outcome.result.session;
			const uninstallRevision = packages.lifecycle.snapshot().catalogRevision;
			const uninstalled = await executePackageOperation(
				connection,
				'purge-recovery-uninstall',
				uninstallRevision,
				Object.freeze({ kind: 'uninstall', packageId: optionalPackageId }),
			);
			assert.equal(uninstalled.outcome.kind, 'succeeded');

			const purgeRevision = packages.lifecycle.snapshot().catalogRevision;
			const purgePayload = Object.freeze({
				kind: 'purgeHostRecords' as const,
				packageId: optionalPackageId,
				records: Object.freeze([Object.freeze({
					packageId: optionalPackageId,
					agentId: optionalAgentId,
					sessionId: session,
				})]),
			});
			packages.stateStore.failNextTerminalOperationCommit = true;
			const uncertain = await executePackageOperation(
				connection,
				'purge-recovery-operation',
				purgeRevision,
				purgePayload,
			);
			assert.equal(uncertain.outcome.kind, 'failed');
			if (uncertain.outcome.kind !== 'failed') { throw new Error('Purge uncertainty was not recorded'); }
			assert.equal(uncertain.outcome.failure.reconciliation, 'sameOperationRequired');
			assert.equal(store.state?.sessions.length, 0);
			assert.equal(store.state?.backingRemovalOperations.length, 1);

			const reconciled = await executePackageOperation(
				connection,
				'purge-recovery-operation',
				purgeRevision,
				purgePayload,
			);
			assert.equal(reconciled.outcome.kind, 'succeeded');
			assert.equal(store.state?.backingRemovalOperations.length, 1);
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('does not report a terminal failure when terminal package outcome persistence remains uncertain', async () => {
		const store = new MemoryCatalogStore();
		const packageState = new MemoryPackageStateStore();
		const cometAgent = new TestAgent();
		const lifecycle = await createPackageLifecycle(packageState);
		const authority = await createAuthority(store, cometAgent, 32, lifecycle);
		const connection = await initialize(
			authority,
			'client-package-pending-outcome',
			Object.freeze([getAgentHostRootChannelId()]),
		);
		try {
			packageState.terminalPersistenceFailures = 1;
			const attempted = await executePackageOperation(
				connection,
				'package-pending-outcome',
				0,
				Object.freeze({
					kind: 'uninstall',
					packageId: createAgentPackageId('not-installed'),
				}),
			);
			assert.equal(attempted.outcome.kind, 'failed');
			if (attempted.outcome.kind !== 'failed') { throw new Error('Uncertain package outcome was not reported'); }
			assert.equal(attempted.outcome.failure.reconciliation, 'sameOperationRequired');
			const reconciled = await connection.getPackageOperationOutcome({
				operation: createAgentPackageOperationId('package-pending-outcome'),
				digest: attempted.digest,
			});
			assert.equal(reconciled.kind, 'failed');
			if (reconciled.kind !== 'failed') { throw new Error('Uncertain package outcome was not durable'); }
			assert.equal(reconciled.failure.reconciliation, 'sameOperationRequired');
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('publishes explicit authentication state and reconciles one credential operation', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authentication = new TestAuthenticationPort();
		const authority = await createAuthority(
			store,
			agent,
			32,
			undefined,
			new TestToolTurnAuthority(),
			Object.freeze([agent]),
			new TestTurnContentResources(),
			authentication,
		);
		const connectionId = createAgentHostClientConnectionId('client-authentication');
		const connection = authority.createConnection(connectionId);
		try {
			const initialized = await connection.initialize({
				connection: connectionId,
				protocolVersions: Object.freeze([protocolVersion]),
				capabilities: Object.freeze([]),
				locale: 'en',
				implementation: Object.freeze({ name: 'test-client', build: '1' }),
				subscriptions: Object.freeze([getAgentHostRootChannelId()]),
			});
			const root = initialized.snapshots[0];
			assert.equal(root?.kind, 'root');
			if (root?.kind !== 'root') { throw new Error('Agent Host root snapshot was not returned'); }
			assert.equal(root.state.capabilities.supportsAgentAuthentication, true);
			assert.equal(root.state.packages.activations[0].authentication, 'unauthenticated');

			const payload = Object.freeze({
				kind: 'authenticateAgent' as const,
				packageId,
				agentId,
				registration: registrationRevision,
				credential: Object.freeze({
					provider: 'openai',
					scope: 'local-user',
					reference: 'credential-1',
				}),
			});
			const authenticated = await mutate(connection, 'authenticate-comet', payload);
			assert.equal(authenticated.outcome.kind, 'succeeded');
			assert.deepStrictEqual(authentication.requests, [{
				operation: createAgentHostOperationId('authenticate-comet'),
				digest: authenticated.digest,
				packageId,
				agentId,
				registration: registrationRevision,
				credential: payload.credential,
			}]);
			assert.deepStrictEqual(
				(await mutate(connection, 'authenticate-comet', payload)).outcome,
				authenticated.outcome,
			);
			assert.equal(authentication.requests.length, 1);

			const replay = await connection.reconnect({
				connection: connectionId,
				lastHostSequence: createAgentHostSequence(0),
				subscriptions: Object.freeze([getAgentHostRootChannelId()]),
			});
			assert.equal(replay.kind, 'replay');
			if (replay.kind !== 'replay') { throw new Error('Authentication root action was not replayed'); }
			const rootAction = replay.actions.at(-1);
			assert.equal(rootAction?.kind, 'root');
			if (rootAction?.kind !== 'root') { throw new Error('Authentication root action was not returned'); }
			assert.equal(rootAction.action.state.packages.activations[0].authentication, 'authenticated');
		} finally {
			connection.dispose();
			authority.dispose();
		}
	});

	test('prepares and atomically accepts a draft, routes exact steering, and reduces terminal actions', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-draft', Object.freeze([getAgentHostSessionsChannelId()]));
		const target = Object.freeze({ kind: 'draft', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate }) satisfies AgentHostSubmissionTarget;
		const prepared = await prepare(connection, 'submission-1', target);
		const created = await mutate(connection, 'operation-draft', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({ model: null, origin: Object.freeze({ kind: 'user' }), initialSubmission: prepared })]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') { throw new Error('Draft was not accepted'); }
		const session = created.outcome.result.session;
		const chat = created.outcome.result.chats[0].chat;
		const turn = created.outcome.result.chats[0].turn;
		assert.ok(turn);
		assert.equal(agent.sends.length, 1);
		agent.emit({ kind: 'turnProgress', session, chat, turn, progress: Object.freeze({ kind: 'state', state: 'running' }) });
		await authority.flushAgentActions();
		const steered = await mutate(connection, 'operation-steer', Object.freeze({ kind: 'steerTurn', session, chat, turn, message: 'focus on tests' }));
		assert.equal(steered.outcome.kind, 'succeeded');
		assert.deepStrictEqual(agent.steers.map(request => [request.session, request.chat, request.turn, request.message]), [[session, chat, turn, 'focus on tests']]);
		agent.emit({ kind: 'turnProgress', session, chat, turn, progress: Object.freeze({ kind: 'response', part: Object.freeze({ kind: 'toolCall', call: createAgentToolCallId('call-1'), tool: createAgentToolId('test.tool'), input: Object.freeze({}) }) }) });
		agent.emit({ kind: 'turnProgress', session, chat, turn, progress: Object.freeze({ kind: 'response', part: Object.freeze({ kind: 'toolResult', call: createAgentToolCallId('call-1'), status: 'completed', output: Object.freeze({ ok: true }) }) }) });
		agent.emit({ kind: 'turnProgress', session, chat, turn, progress: Object.freeze({ kind: 'response', part: Object.freeze({ kind: 'text', text: 'done' }) }) });
		agent.emit({ kind: 'turnTerminal', session, chat, turn, state: 'completed' });
		await authority.flushAgentActions();
		const subscribed = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostChatChannelId(session, chat)]) });
		assert.equal(subscribed.snapshots.length, 1);
		const snapshot = subscribed.snapshots[0];
		assert.equal(snapshot.kind, 'chat');
		if (snapshot.kind !== 'chat') { throw new Error('Missing Chat snapshot'); }
		assert.equal(snapshot.state.turns[0].state, 'completed');
		assert.deepStrictEqual(snapshot.state.turns[0].response.map(part => part.kind), ['toolCall', 'toolResult', 'text']);
		const reused = await mutate(connection, 'operation-reuse-submission', Object.freeze({
			kind: 'createSession', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({ model: null, origin: Object.freeze({ kind: 'user' }), initialSubmission: prepared })]),
		}));
		assert.equal(reused.outcome.kind, 'failed');
		connection.dispose();
		authority.dispose();
	});

	test('binds initial Turn content to reserved identities before commit and releases rollback anchors', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const contentResources = new TestTurnContentResources();
		const authority = await createAuthority(
			store,
			agent,
			32,
			undefined,
			new TestToolTurnAuthority(),
			Object.freeze([agent]),
			contentResources,
		);
		const connection = await initialize(authority, 'client-content-draft', Object.freeze([getAgentHostSessionsChannelId()]));
		const target = Object.freeze({ kind: 'draft', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate }) satisfies AgentHostSubmissionTarget;
		const prepared = await prepare(
			connection,
			'submission-content-draft',
			target,
			'question',
			Object.freeze([referenceAttachment(connection.connection)]),
		);
		const payload = Object.freeze({
			kind: 'createSession' as const,
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({
				model: modelId,
				origin: Object.freeze({ kind: 'user' as const }),
				initialSubmission: prepared,
			})]),
		});

		store.failNextCommit = true;
		const failed = await mutate(connection, 'operation-content-draft-fails', payload);
		assert.equal(failed.outcome.kind, 'failed');
		assert.deepStrictEqual(contentResources.opens.map(open => [open.session, open.chat, open.turn, open.attachment]), [
			['session-1', 'chat-1', 'turn-1', 'article-attachment'],
		]);
		assert.deepStrictEqual(contentResources.releases, ['lease-1']);
		assert.equal(contentResources.active.size, 0);

		const accepted = await mutate(connection, 'operation-content-draft-retry', payload);
		assert.equal(accepted.outcome.kind, 'succeeded');
		if (accepted.outcome.kind !== 'succeeded' || accepted.outcome.result.kind !== 'createSession') {
			throw new Error('Draft retry was not accepted');
		}
		const acceptedChat = accepted.outcome.result.chats[0];
		assert.ok(acceptedChat.turn);
		assert.deepStrictEqual(contentResources.opens.map(open => [open.session, open.chat, open.turn, open.attachment]), [
			['session-1', 'chat-1', 'turn-1', 'article-attachment'],
			[accepted.outcome.result.session, acceptedChat.chat, acceptedChat.turn, 'article-attachment'],
		]);
		assert.equal(contentResources.active.size, 1);
		assert.equal(agent.sends.length, 1);

		agent.emit({
			kind: 'turnTerminal',
			session: accepted.outcome.result.session,
			chat: acceptedChat.chat,
			turn: acceptedChat.turn,
			state: 'completed',
		});
		await authority.flushAgentActions();
		assert.deepStrictEqual(contentResources.releases, ['lease-1', 'lease-2']);
		assert.equal(contentResources.active.size, 0);
		connection.dispose();
		authority.dispose();
	});

	test('holds submitted Turn content through Agent execution and releases it at terminal state', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const contentResources = new TestTurnContentResources();
		const authority = await createAuthority(
			store,
			agent,
			32,
			undefined,
			new TestToolTurnAuthority(),
			Object.freeze([agent]),
			contentResources,
		);
		const connection = await initialize(authority, 'client-content-submit', Object.freeze([getAgentHostSessionsChannelId()]));
		const created = await mutate(connection, 'operation-content-session', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({ model: null, origin: Object.freeze({ kind: 'user' }) })]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Session was not created');
		}
		const session = created.outcome.result.session;
		const chat = created.outcome.result.chats[0].chat;
		const prepared = await prepare(
			connection,
			'submission-content-turn',
			Object.freeze({ kind: 'chat', session, chat }),
			'question',
			Object.freeze([referenceAttachment(connection.connection)]),
		);
		const submitted = await mutate(connection, 'operation-content-turn', Object.freeze({
			kind: 'submitTurn', session, chat, submission: prepared,
		}));
		assert.equal(submitted.outcome.kind, 'succeeded');
		if (submitted.outcome.kind !== 'succeeded' || submitted.outcome.result.kind !== 'submitTurn') {
			throw new Error('Turn was not submitted');
		}
		assert.deepStrictEqual(contentResources.opens.map(open => [open.session, open.chat, open.turn, open.attachment]), [
			[session, chat, submitted.outcome.result.turn, 'article-attachment'],
		]);
		assert.equal(contentResources.active.size, 1);
		assert.deepStrictEqual(contentResources.releases, []);

		agent.emit({ kind: 'turnTerminal', session, chat, turn: submitted.outcome.result.turn, state: 'completed' });
		await authority.flushAgentActions();
		assert.deepStrictEqual(contentResources.releases, ['lease-1']);
		assert.equal(contentResources.active.size, 0);
		connection.dispose();
		authority.dispose();
	});

	test('persists the committed Turn as failed when Agent send rejects after acceptance', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const authority = await createAuthority(store, agent);
		const connection = await initialize(authority, 'client-send-failure', Object.freeze([]));
		const created = await mutate(connection, 'operation-send-failure-session', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({ model: null, origin: Object.freeze({ kind: 'user' }) })]),
		}));
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') {
			throw new Error('Send-failure Session was not created');
		}
		const session = created.outcome.result.session;
		const chat = created.outcome.result.chats[0].chat;
		const prepared = await prepare(
			connection,
			'submission-send-failure',
			Object.freeze({ kind: 'chat', session, chat }),
		);
		agent.failNextSend = true;
		const submitted = await mutate(connection, 'operation-send-failure-turn', Object.freeze({
			kind: 'submitTurn', session, chat, submission: prepared,
		}));
		assert.equal(submitted.outcome.kind, 'succeeded');
		if (submitted.outcome.kind !== 'succeeded' || submitted.outcome.result.kind !== 'submitTurn') {
			throw new Error('Send-failure Turn was not committed');
		}
		const committedTurn = submitted.outcome.result.turn;
		assert.equal(agent.sends.length, 1);
		assert.equal(agent.sends[0].turn, committedTurn);

		await authority.flushAgentActions();
		const snapshot = await connection.setSubscriptions({
			subscriptions: Object.freeze([getAgentHostChatChannelId(session, chat)]),
		});
		const chatSnapshot = snapshot.snapshots[0];
		assert.equal(chatSnapshot.kind, 'chat');
		if (chatSnapshot.kind !== 'chat') {
			throw new Error('Send-failure Chat snapshot is missing');
		}
		assert.equal(chatSnapshot.state.turns.length, 1);
		assert.equal(chatSnapshot.state.turns[0].id, committedTurn);
		assert.equal(chatSnapshot.state.turns[0].state, 'failed');
		assert.equal(chatSnapshot.state.turns[0].failure?.code, 'agentUnavailable');
		assert.equal(chatSnapshot.state.activeTurn, undefined);
		assert.equal(chatSnapshot.state.status, 'failed');
		const persistedTurn = store.state?.sessions[0].chats[0].state.turns[0];
		assert.equal(persistedTurn?.id, committedTurn);
		assert.equal(persistedTurn?.state, 'failed');
		assert.equal(persistedTurn?.failure?.code, 'agentUnavailable');

		connection.dispose();
		authority.dispose();
	});

	test('keeps release distinct from exact Chat and Session deletion for a multi-Chat catalog', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const packageLifecycle = await createPackageLifecycle();
		const authority = await createAuthority(store, agent, 32, packageLifecycle);
		const connection = await initialize(authority, 'client-delete', Object.freeze([getAgentHostSessionsChannelId()]));
		const created = await mutate(connection, 'operation-create-two', Object.freeze({
			kind: 'createSession', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate,
			chats: Object.freeze([
				Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) }),
				Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) }),
			]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') { throw new Error('Session creation failed'); }
		const session = created.outcome.result.session;
		const [first, second] = created.outcome.result.chats.map(result => result.chat);
		await mutate(connection, 'operation-release-chat', Object.freeze({ kind: 'releaseChat', session, chat: first }));
		assert.deepStrictEqual(
			packageLifecycle.snapshot().materializedBackings.map(identity => identity.chatId ?? identity.sessionId),
			[session, second],
		);
		let chatSnapshot = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostChatChannelId(session, first)]) });
		assert.equal(chatSnapshot.snapshots[0].kind === 'chat' ? chatSnapshot.snapshots[0].state.lifecycle : undefined, 'released');
		await mutate(connection, 'operation-delete-chat', Object.freeze({ kind: 'deleteChat', session, chat: first }));
		chatSnapshot = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostChatChannelId(session, first)]) });
		assert.deepStrictEqual(chatSnapshot.missingChannels, [{ channel: getAgentHostChatChannelId(session, first), reason: 'deleted' }]);
		await mutate(connection, 'operation-release-session', Object.freeze({ kind: 'releaseSession', session }));
		assert.deepStrictEqual(packageLifecycle.snapshot().materializedBackings, []);
		const sessionSnapshot = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostSessionChannelId(session)]) });
		assert.equal(sessionSnapshot.snapshots[0].kind === 'session' ? sessionSnapshot.snapshots[0].state.lifecycle : undefined, 'released');
		assert.equal(sessionSnapshot.snapshots[0].kind === 'session' ? sessionSnapshot.snapshots[0].state.chats[0].id : undefined, second);
		await mutate(connection, 'operation-delete-session', Object.freeze({ kind: 'deleteSession', session }));
		const deleted = await connection.setSubscriptions({ subscriptions: Object.freeze([getAgentHostSessionChannelId(session)]) });
		assert.deepStrictEqual(deleted.missingChannels, [{ channel: getAgentHostSessionChannelId(session), reason: 'deleted' }]);
		assert.deepStrictEqual(agent.chatReleases, [`${session}/${first}`]);
		assert.deepStrictEqual(agent.sessionReleases, [session]);
		assert.deepStrictEqual(agent.chatDeletes, [`${session}/${first}`, `${session}/${second}`]);
		assert.deepStrictEqual(agent.sessionDeletes, [session]);
		assert.deepStrictEqual(packageLifecycle.snapshot().retainedBackingRecords, []);
		connection.dispose();
		authority.dispose();
	});

	test('rolls package backing state and provisional Agent backing back when Host catalog commit fails', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const packageLifecycle = await createPackageLifecycle();
		const authority = await createAuthority(store, agent, 32, packageLifecycle);
		const connection = await initialize(authority, 'client-backing-failure', Object.freeze([getAgentHostSessionsChannelId()]));
		store.failNextCommit = true;
		const created = await mutate(connection, 'operation-create-fails', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));
		assert.equal(created.outcome.kind, 'failed');
		assert.deepStrictEqual(packageLifecycle.snapshot().retainedBackingRecords, []);
		assert.deepStrictEqual(packageLifecycle.snapshot().materializedBackings, []);
		assert.deepStrictEqual(agent.sessionDeletes, ['session-1']);
		connection.dispose();
		authority.dispose();
	});

	test('gates an update until its accepted Turn drains and releases every materialized backing', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const packageState = new MemoryPackageStateStore();
		const staged = bundledPackage('2.0.0', 'c');
		const packageLifecycle = await createPackageLifecycle(packageState, staged);
		const authority = await createAuthority(store, agent, 32, packageLifecycle);
		const connection = await initialize(authority, 'client-update-drain', Object.freeze([getAgentHostSessionsChannelId()]));
		const prepared = await prepare(connection, 'submission-update-drain', Object.freeze({
			kind: 'draft',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
		}));
		const created = await mutate(connection, 'operation-update-session', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }), initialSubmission: prepared })]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') { throw new Error('Session creation failed'); }
		const session = created.outcome.result.session;
		const chat = created.outcome.result.chats[0].chat;
		const turn = created.outcome.result.chats[0].turn!;
		let settled = false;
		const update = packageLifecycle.update({
			operationId: createAgentPackageOperationId('product-update-drain'),
			requestDigest: createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`),
			packageId,
			offering: staged.offering,
			authority: 'product',
		}).finally(() => { settled = true; });
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(settled, false);
		agent.emit({ kind: 'turnTerminal', session, chat, turn, state: 'completed' });
		await authority.flushAgentActions();
		await update;
		assert.deepStrictEqual(packageLifecycle.snapshot().materializedBackings, []);
		assert.deepStrictEqual(agent.chatReleases, [`${session}/${chat}`]);
		assert.deepStrictEqual(agent.sessionReleases, [session]);
		connection.dispose();
		authority.dispose();
	});

	test('activates the exact staged runtime registration before admitting new work', async () => {
		const store = new MemoryCatalogStore();
		const previousAgent = new TestAgent();
		const stagedAgent = new TestAgent(updatedRegistration);
		const packageState = new MemoryPackageStateStore();
		const staged = bundledPackage('2.0.0', '4');
		const packageLifecycle = await createPackageLifecycle(packageState, staged, updatedRegistration);
		const authority = await createAuthority(
			store,
			previousAgent,
			32,
			packageLifecycle,
			new TestToolTurnAuthority(),
			Object.freeze([previousAgent, stagedAgent]),
		);
		const connection = await initialize(authority, 'client-update-runtime', Object.freeze([getAgentHostSessionsChannelId()]));

		await packageLifecycle.update({
			operationId: createAgentPackageOperationId('product-update-runtime'),
			requestDigest: createAgentHostPayloadDigest(`sha256:${'4'.repeat(64)}`),
			packageId,
			offering: staged.offering,
			authority: 'product',
		});
		const created = await mutate(connection, 'operation-create-after-runtime-update', Object.freeze({
			kind: 'createSession',
			sessionType: sessionTypeId,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		}));

		assert.equal(created.outcome.kind, 'succeeded');
		assert.deepStrictEqual(previousAgent.sessionCreates, []);
		assert.deepStrictEqual(stagedAgent.sessionCreates, ['session-1']);
		connection.dispose();
		authority.dispose();
	});

	test('rematerializes released backing when a package update state commit fails', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const packageState = new MemoryPackageStateStore();
		const staged = bundledPackage('2.0.0', 'e');
		const packageLifecycle = await createPackageLifecycle(packageState, staged);
		const authority = await createAuthority(store, agent, 32, packageLifecycle);
		const connection = await initialize(authority, 'client-update-rollback', Object.freeze([getAgentHostSessionsChannelId()]));
		const created = await mutate(connection, 'operation-update-rollback-session', Object.freeze({
			kind: 'createSession', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate,
			chats: Object.freeze([Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }) })]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		if (created.outcome.kind !== 'succeeded' || created.outcome.result.kind !== 'createSession') { throw new Error('Session creation failed'); }
		const session = created.outcome.result.session;
		const chat = created.outcome.result.chats[0].chat;
		packageState.failNextCatalogCommit = true;
		await assert.rejects(packageLifecycle.update({
			operationId: createAgentPackageOperationId('product-update-rollback'),
			requestDigest: createAgentHostPayloadDigest(`sha256:${'f'.repeat(64)}`),
			packageId,
			offering: staged.offering,
			authority: 'product',
		}), /injected package state commit failure/);
		assert.deepStrictEqual(
			packageLifecycle.snapshot().materializedBackings.map(identity => identity.chatId ?? identity.sessionId),
			[session, chat],
		);
		assert.deepStrictEqual(agent.sessionMaterializes, [session]);
		assert.deepStrictEqual(agent.chatMaterializes, [`${session}/${chat}`]);
		connection.dispose();
		authority.dispose();
	});

	test('closes by cancelling distinct Turns, draining Tool authority, and persisting released residency', async () => {
		const store = new MemoryCatalogStore();
		const agent = new TestAgent();
		const packageLifecycle = await createPackageLifecycle();
		const toolAuthority = new TestToolTurnAuthority();
		const authority = await createAuthority(store, agent, 32, packageLifecycle, toolAuthority);
		const connection = await initialize(authority, 'client-close', Object.freeze([getAgentHostSessionsChannelId()]));
		const target = Object.freeze({ kind: 'draft', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate }) satisfies AgentHostSubmissionTarget;
		const firstSubmission = await prepare(connection, 'submission-close-1', target);
		const secondSubmission = await prepare(connection, 'submission-close-2', target);
		const created = await mutate(connection, 'operation-close-session', Object.freeze({
			kind: 'createSession', sessionType: sessionTypeId, configuration: sessionConfigurationCandidate,
			chats: Object.freeze([
				Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }), initialSubmission: firstSubmission }),
				Object.freeze({ model: modelId, origin: Object.freeze({ kind: 'user' }), initialSubmission: secondSubmission }),
			]),
		}));
		assert.equal(created.outcome.kind, 'succeeded');
		assert.equal(toolAuthority.active.size, 2);
		await authority.close({
			operation: createAgentHostOperationId('shutdown-host'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`),
		});
		assert.equal(agent.cancels.length, 2);
		assert.equal(new Set(agent.cancels.map(request => request.operation)).size, 2);
		assert.equal(new Set(agent.cancels.map(request => request.payloadDigest)).size, 2);
		assert.equal(toolAuthority.active.size, 0);
		assert.equal(toolAuthority.disposeCount, 2);
		assert.deepStrictEqual(packageLifecycle.snapshot().materializedBackings, []);
	});

	test('imports the one legacy key atomically before deletion with history and image ownership preserved', async () => {
		const store = new MemoryCatalogStore();
		store.state = createEmptyAgentHostCatalog(Object.freeze([optionalMigrationAgentDefaults]));
		const serialized = JSON.stringify({
			version: 3,
			sessions: [{
				conversationId: 'legacy-1',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:01:00.000Z',
				sessionTitle: 'Imported',
				chatTitle: 'Imported Chat',
				status: 'completed',
				workspace: { kind: 'workspace-less' },
				modelId: null,
				chatState: {
					input: 'unsent',
					errorMessage: null,
					messages: [
						{ id: 'legacy-turn-1', role: 'user', content: 'question', imageAttachments: [{ id: 'legacy-image-1', name: 'image.png', mimeType: 'image/png', data: 'aA==' }], includeInAgentHistory: true },
						{ id: 'legacy-answer-1', role: 'assistant', content: 'answer', imageAttachments: [], includeInAgentHistory: true, articleList: null, result: null, patchProposal: null },
					],
				},
			}],
		});
		let sourceValue: string | undefined = serialized;
		let deletedAfterCommit = false;
		const source: IAgentHostLegacyCatalogSource = {
			read: async key => {
				assert.equal(key, 'sessions.providers.default');
				return sourceValue;
			},
			delete: async key => {
				assert.equal(key, 'sessions.providers.default');
				assert.ok(store.state?.completedMigrations.length);
				deletedAfterCommit = true;
				sourceValue = undefined;
			},
		};
		await migrateLegacySessionsCatalog({
			source,
			store,
			companion: createMigrationCompanion(),
			packageId,
			agentId,
			sessionType: sessionTypeId,
			resumeSchema,
			agentDefaults: Object.freeze([migrationAgentDefaults]),
			sessionConfiguration: migrationSessionConfiguration,
		});
		assert.equal(deletedAfterCommit, true);
		const record = store.state?.sessions[0];
		assert.equal(record?.state.id, createAgentSessionId('legacy-1'));
		assert.equal(record?.state.packageId, packageId);
		assert.equal(record?.state.agentId, agentId);
		assert.deepStrictEqual(record?.chats[0].state.origin, { kind: 'user' });
		assert.equal(record?.chats[0].state.turns[0].user.attachments[0].content?.kind, 'inline');
		assert.equal(record?.chats[0].state.turns[0].response[0].kind, 'text');
		assert.equal(record?.resume?.schema, resumeSchema);
		assert.deepStrictEqual(
			store.state?.agentDefaults.map(state => state.schema.agent),
			[optionalAgentId, agentId],
		);
		assert.deepStrictEqual(store.state?.agentDefaults[0], optionalMigrationAgentDefaults);
		assert.deepStrictEqual(JSON.parse(record?.resume?.data ?? ''), {
			kind: 'session',
			version: 1,
			session: createAgentSessionId('legacy-1'),
			workspace: null,
		});
		assert.deepStrictEqual(JSON.parse(record?.chats[0].resume?.data ?? ''), {
			baseMessageLength: 0,
			chat: createAgentChatId('legacy-1'),
			checkpoint: { present: false },
			kind: 'chat',
			messages: [
				{ role: 'user', text: 'question', turn: createAgentTurnId('legacy-turn-1') },
				{
					parts: [{ kind: 'text', text: 'answer' }],
					role: 'assistant',
					turn: createAgentTurnId('legacy-turn-1'),
				},
			],
			origin: { kind: 'user' },
			session: createAgentSessionId('legacy-1'),
			turns: [{
				checkpoint: { present: false },
				messageLength: 2,
				turn: createAgentTurnId('legacy-turn-1'),
			}],
			usage: [],
			version: 1,
		});
	});

	test('retains the legacy source after a companion crash and resumes from the committed Host digest', async () => {
		const store = new MemoryCatalogStore();
		let sourceValue: string | undefined = JSON.stringify({ version: 3, sessions: [] });
		let prepareCount = 0;
		let commitCount = 0;
		let completed: ReturnType<typeof createAgentHostPayloadDigest> | undefined;
		const companion: IAgentHostLegacyCatalogMigrationCompanion = {
			prepare: async () => {
				prepareCount += 1;
				return Object.freeze([]);
			},
			commit: async request => {
				commitCount += 1;
				if (commitCount === 1) {
					throw new Error('injected companion crash');
				}
				completed = request.sourceDigest;
			},
			readCompletedMigration: async () => completed,
		};
		const source: IAgentHostLegacyCatalogSource = {
			read: async () => sourceValue,
			delete: async () => { sourceValue = undefined; },
		};
		const options = {
			source,
			store,
			companion,
			packageId,
			agentId,
			sessionType: sessionTypeId,
			resumeSchema,
			agentDefaults: Object.freeze([migrationAgentDefaults]),
			sessionConfiguration: migrationSessionConfiguration,
		};
		await assert.rejects(migrateLegacySessionsCatalog(options), /injected companion crash/);
		assert.ok(sourceValue);
		assert.equal(store.commits.length, 1);
		assert.equal(store.state?.completedMigrations.length, 1);
		assert.equal(completed, undefined);

		await migrateLegacySessionsCatalog(options);
		assert.equal(sourceValue, undefined);
		assert.equal(store.commits.length, 1);
		assert.equal(prepareCount, 1);
		assert.equal(commitCount, 2);
		assert.equal(completed, store.state?.completedMigrations[0]?.sourceDigest);
	});

	test('retries source deletion only after both exact migration digests are durable', async () => {
		const store = new MemoryCatalogStore();
		let sourceValue: string | undefined = JSON.stringify({ version: 3, sessions: [] });
		let completed: ReturnType<typeof createAgentHostPayloadDigest> | undefined;
		let deleteCount = 0;
		const source: IAgentHostLegacyCatalogSource = {
			read: async () => sourceValue,
			delete: async () => {
				deleteCount += 1;
				if (deleteCount === 1) {
					throw new Error('injected source deletion crash');
				}
				sourceValue = undefined;
			},
		};
		const companion: IAgentHostLegacyCatalogMigrationCompanion = {
			prepare: async () => Object.freeze([]),
			commit: async request => { completed = request.sourceDigest; },
			readCompletedMigration: async () => completed,
		};
		const options = {
			source,
			store,
			companion,
			packageId,
			agentId,
			sessionType: sessionTypeId,
			resumeSchema,
			agentDefaults: Object.freeze([migrationAgentDefaults]),
			sessionConfiguration: migrationSessionConfiguration,
		};
		await assert.rejects(migrateLegacySessionsCatalog(options), /source deletion crash/);
		assert.ok(sourceValue);
		assert.equal(completed, store.state?.completedMigrations[0]?.sourceDigest);
		await migrateLegacySessionsCatalog(options);
		assert.equal(sourceValue, undefined);
		assert.equal(deleteCount, 2);
		assert.equal(store.commits.length, 1);
	});

	test('rejects Host and companion digest conflicts without deleting the legacy source', async () => {
		const serialized = JSON.stringify({ version: 3, sessions: [] });
		let hostSourceDeleted = false;
		const hostStore = new MemoryCatalogStore();
		hostStore.state = Object.freeze({
			...createEmptyAgentHostCatalog(Object.freeze([migrationAgentDefaults])),
			completedMigrations: Object.freeze([Object.freeze({
				id: 'legacy-sessions-v3',
				sourceDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
			})]),
		});
		await assert.rejects(migrateLegacySessionsCatalog({
			source: {
				read: async () => serialized,
				delete: async () => { hostSourceDeleted = true; },
			},
			store: hostStore,
			companion: createMigrationCompanion(),
			packageId,
			agentId,
			sessionType: sessionTypeId,
			resumeSchema,
			agentDefaults: Object.freeze([migrationAgentDefaults]),
			sessionConfiguration: migrationSessionConfiguration,
		}), /Agent Host catalog conflicts/);
		assert.equal(hostSourceDeleted, false);

		let companionSourceDeleted = false;
		const companionStore = new MemoryCatalogStore();
		await assert.rejects(migrateLegacySessionsCatalog({
			source: {
				read: async () => serialized,
				delete: async () => { companionSourceDeleted = true; },
			},
			store: companionStore,
			companion: {
				prepare: async () => Object.freeze([]),
				commit: async () => {},
				readCompletedMigration: async () => createAgentHostPayloadDigest(
					`sha256:${'b'.repeat(64)}`,
				),
			},
			packageId,
			agentId,
			sessionType: sessionTypeId,
			resumeSchema,
			agentDefaults: Object.freeze([migrationAgentDefaults]),
			sessionConfiguration: migrationSessionConfiguration,
		}), /Chat presentation storage conflicts/);
		assert.equal(companionSourceDeleted, false);
		assert.equal(companionStore.state, undefined);
	});
});
