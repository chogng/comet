/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { IpcMainInvokeEvent } from 'electron';

import { Sequencer } from 'cs/base/common/async';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { ElectronMainChannelServer } from 'cs/base/parts/ipc/electron-main/ipcMain';
import type { IStorage } from 'cs/base/parts/storage/common/storage';
import type { LlmSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { localAgentHostContentResourceLimits } from 'cs/code/common/agentHostConfiguration';
import { localAgentHostConnectionChannelName } from 'cs/platform/agentHost/common/connectionChannel';
import type {
	IAgentBackingIdentity,
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentRuntimeRegistration,
} from 'cs/platform/agentHost/common/agent';
import {
	createAgentCancellationId,
	createAgentChatId,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentPackageContentDigest,
	createAgentPackageOperationId,
	createAgentPackageRevision,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentTurnId,
	type AgentHostOperationId,
	type AgentHostPayloadDigest,
	type AgentPackageOperationId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import type {
	AgentToolCallAuthorization,
	IAgentToolTimerPort,
} from 'cs/platform/agentHost/node/tools/agentToolExecution';
import type { IAgentToolCall, IAgentToolRegistration } from 'cs/platform/agentHost/common/tools';
import type { IPreparedAgentToolSet } from 'cs/platform/agentHost/node/tools/agentToolSetPreparation';
import {
	COMET_AGENT_ID,
	COMET_AGENT_PACKAGE_ID,
	CometAgent,
} from 'cs/platform/agentHost/node/agents/comet/cometAgent';
import { COMET_AGENT_RESUME_SCHEMA } from 'cs/platform/agentHost/node/agents/comet/cometResume';
import {
	AgentContentResourceService,
	createAgentContentResourceScheduler,
} from 'cs/platform/agentHost/node/content/agentContentResourceService';
import { AgentHostConnectionChannelFactory } from 'cs/platform/agentHost/electron-main/agentHostConnectionChannel';
import {
	AgentHostAuthority,
	type IAgentHostIdentityFactory,
	type IAgentHostRuntimeResolver,
	type IAgentHostSubmissionPolicy,
} from 'cs/platform/agentHost/node/host/agentHostAuthority';
import {
	migrateLegacySessionsCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog';
import {
	AgentPackageLifecycle,
	type IAgentPackageArtifactPort,
	type IAgentPackageRuntimePort,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	IAgentPackageOffering,
	IAgentPackageTarget,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import type {
	IVerifiedAgentPackage,
} from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import {
	ApplicationStorageAgentHostCatalogStore,
	ApplicationStorageAgentPackageStateStore,
	ApplicationStorageLegacyAgentHostCatalogSource,
} from 'cs/platform/agentHost/node/storage/agentHostStateStores';
import { AgentToolCallAuthority, type IAgentToolPermissionPort } from 'cs/platform/agentHost/node/tools/agentToolCallAuthority';
import {
	AgentToolEndpointRegistry,
	AgentToolExecutionService,
} from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import { AgentToolSetPreparationService } from 'cs/platform/agentHost/node/tools/agentToolSetPreparation';
import { localize } from 'cs/nls';
import {
	COMET_AUTOMATIC_EXECUTION_PRESET,
	createProductionCometModelCatalog,
	type IProductionCometModelCatalog,
} from './cometModelCatalog.js';
import { LegacyChatMigrationCompanion } from './legacyChatMigration.js';

const localAgentHostAuthority = createAgentHostAuthorityId('local');
const localAgentHostProtocolVersion = createAgentHostProtocolVersion('1');
const cometSessionType = createAgentSessionTypeId('comet');
const maximumPreparedToolSets = 4_096;
const maximumBoundToolTurns = 1_024;
const maximumToolCallRecords = 16_384;
const maximumReplayActions = 16_384;
const maximumTurnMilliseconds = 5 * 60 * 1_000;

interface ILocalAgentHostChannelServer {
	registerChannel(
		channelName: string,
		channel: IServerChannel<IpcMainInvokeEvent>,
	): void;
	getRendererChannel: Pick<ElectronMainChannelServer, 'getRendererChannel'>['getRendererChannel'];
}

/** Dependencies required to create the production desktop Agent Host. */
export interface ILocalAgentHostMainOptions {
	readonly storage: IStorage;
	readonly settings: LlmSettings;
	readonly loadSettings: (signal: AbortSignal) => Promise<LlmSettings>;
	readonly contentMaterializationRoot: string;
	readonly bundledArtifactPath: string;
	readonly channelServer: ILocalAgentHostChannelServer;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
}

interface ICurrentBundledCometPackage {
	readonly target: IAgentPackageTarget;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

function sha256(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function operationIdentity(
	kind: string,
	operation: AgentPackageOperationId,
	backing: IAgentBackingIdentity,
): { readonly operation: AgentHostOperationId; readonly payloadDigest: AgentHostPayloadDigest } {
	const value = JSON.stringify({ kind, operation, backing });
	const digest = sha256(value);
	return Object.freeze({
		operation: createAgentHostOperationId(`package:${digest}`),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${digest}`),
	});
}

function exactRegistration(
	actual: IAgentRuntimeRegistration,
	expected: IAgentRuntimeRegistration,
): boolean {
	return actual.packageId === expected.packageId
		&& actual.agentId === expected.agentId
		&& actual.revision === expected.revision
		&& actual.descriptorRevision === expected.descriptorRevision
		&& actual.capabilityRevision === expected.capabilityRevision
		&& actual.supportedToolSchemaProfiles.length === expected.supportedToolSchemaProfiles.length
		&& actual.supportedToolSchemaProfiles.every((profile, index) => profile === expected.supportedToolSchemaProfiles[index])
		&& actual.supportedResumeSchemas.length === expected.supportedResumeSchemas.length
		&& actual.supportedResumeSchemas.every((schema, index) => schema === expected.supportedResumeSchemas[index])
		&& actual.resumeMigrationEdges.length === expected.resumeMigrationEdges.length
		&& actual.resumeMigrationEdges.every((edge, index) => {
			const expectedEdge = expected.resumeMigrationEdges[index];
			return edge.sourceSchema === expectedEdge.sourceSchema && edge.targetSchema === expectedEdge.targetSchema;
		});
}

function exactOffering(actual: IAgentPackageOffering, expected: IAgentPackageOffering): boolean {
	return actual.packageId === expected.packageId
		&& actual.revision === expected.revision
		&& actual.contentDigest === expected.contentDigest
		&& actual.source === expected.source
		&& actual.distribution === expected.distribution;
}

async function createCurrentBundledCometPackage(
	artifactPath: string,
): Promise<ICurrentBundledCometPackage> {
	const artifactMetadata = await lstat(artifactPath);
	if (!artifactMetadata.isFile() || artifactMetadata.isSymbolicLink()) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Bundled Comet artifact must be a regular file',
			{ packageId: COMET_AGENT_PACKAGE_ID },
		);
	}
	const artifact = await realpath(artifactPath);
	const bytes = await readFile(artifact);
	if (bytes.byteLength === 0) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Bundled Comet artifact is empty',
			{ packageId: COMET_AGENT_PACKAGE_ID },
		);
	}
	const artifactDigest = createAgentPackageContentDigest(`sha256:${sha256(bytes)}`);
	const revision = createAgentPackageRevision(`embedded:${artifactDigest.slice('sha256:'.length)}`);
	const source = pathToFileURL(artifact).toString();
	const target = Object.freeze({ operatingSystem: process.platform, architecture: process.arch });
	const dependency = Object.freeze({
		id: 'comet.embedded-runtime',
		source,
		target: 'comet/embedded-runtime.js',
		digest: artifactDigest,
		license: 'MIT',
	});
	const privileges = Object.freeze([
		Object.freeze({ kind: 'filesystem' as const, value: 'host.content.materializations:read' }),
		Object.freeze({ kind: 'network' as const, value: 'configured.model.endpoint' }),
		Object.freeze({ kind: 'secret' as const, value: 'configured.model.api-key' }),
		Object.freeze({ kind: 'toolExecutor' as const, value: 'agentHost.canonical' }),
	]);
	const offering = Object.freeze({
		packageId: COMET_AGENT_PACKAGE_ID,
		revision,
		contentDigest: artifactDigest,
		source,
		distribution: 'bundled' as const,
	});
	const manifest = Object.freeze({
		schema: 1,
		packageId: COMET_AGENT_PACKAGE_ID,
		revision,
		contentDigest: artifactDigest,
		publisher: 'Comet',
		target,
		runtimeForm: 'embedded' as const,
		runtimeEntryPoint: dependency.target,
		agentIds: Object.freeze([COMET_AGENT_ID]),
		dependencies: Object.freeze([dependency]),
		privileges,
	});
	return Object.freeze({
		target,
		verifiedPackage: Object.freeze({
			offering,
			manifest,
			dependencyClosure: Object.freeze([Object.freeze({
				...dependency,
				verifiedDigest: artifactDigest,
				immutable: true as const,
			})]),
			grantedPrivileges: privileges,
		}),
	});
}

class BundledCometArtifactPort implements IAgentPackageArtifactPort {
	constructor(private readonly bundledPackage: IVerifiedAgentPackage) { }

	stage(
		offering: IAgentPackageOffering,
		_operationId: AgentPackageOperationId,
	): Promise<IVerifiedAgentPackage> {
		if (!exactOffering(offering, this.bundledPackage.offering)) {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstallable,
				'Agent package offering is not the current product-bundled Comet artifact',
				{ packageId: offering.packageId },
			));
		}
		return Promise.resolve(this.bundledPackage);
	}

	discard(
		verifiedPackage: IVerifiedAgentPackage,
		_operationId: AgentPackageOperationId,
	): Promise<void> {
		if (!exactOffering(verifiedPackage.offering, this.bundledPackage.offering)) {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Cannot discard an unrelated Agent package artifact',
				{ packageId: verifiedPackage.offering.packageId },
			));
		}
		return Promise.resolve();
	}
}

class EmbeddedCometPackageRuntimePort implements IAgentPackageRuntimePort {
	private readonly activations = new Map<AgentPackageOperationId, 'prepared' | 'committed' | 'retired' | 'rolledBack'>();

	constructor(
		private readonly agent: CometAgent,
		private readonly bundledPackage: IVerifiedAgentPackage,
	) { }

	prepareActivation(
		installedPackage: IInstalledAgentPackage | null,
		previous: Parameters<IAgentPackageRuntimePort['prepareActivation']>[1],
		operationId: AgentPackageOperationId,
	): Promise<readonly IAgentRuntimeRegistration[]> {
		if (
			installedPackage === null
			|| installedPackage.packageId !== this.bundledPackage.offering.packageId
			|| installedPackage.revision !== this.bundledPackage.offering.revision
			|| installedPackage.contentDigest !== this.bundledPackage.offering.contentDigest
			|| installedPackage.source !== this.bundledPackage.offering.source
		) {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Embedded Comet runtime does not belong to the addressed package revision',
				{ packageId: installedPackage?.packageId ?? this.bundledPackage.offering.packageId },
			));
		}
		if (
			previous !== null
			&& (
				previous.installedPackage.packageId !== this.bundledPackage.offering.packageId
				|| previous.registrations.length !== 1
				|| !exactRegistration(previous.registrations[0], this.agent.registration)
			)
		) {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Embedded Comet activation does not address the retained endpoint',
				{ packageId: previous.installedPackage.packageId },
			));
		}
		const state = this.activations.get(operationId);
		if (state !== undefined && state !== 'prepared') {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Embedded Comet activation operation is no longer staged',
				{ operationId },
			));
		}
		this.activations.set(operationId, 'prepared');
		return Promise.resolve(Object.freeze([this.agent.registration]));
	}

	commitActivation(
		operationId: AgentPackageOperationId,
		transition: Parameters<IAgentPackageRuntimePort['commitActivation']>[1],
	): Promise<void> {
		this.assertTransition(transition);
		const state = this.activations.get(operationId);
		if (state !== undefined && state !== 'prepared' && state !== 'committed') {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Embedded Comet activation was not prepared',
				{ operationId },
			));
		}
		this.activations.set(operationId, 'committed');
		return Promise.resolve();
	}

	retirePreviousActivation(
		operationId: AgentPackageOperationId,
		transition: Parameters<IAgentPackageRuntimePort['retirePreviousActivation']>[1],
	): Promise<void> {
		this.assertTransition(transition);
		const state = this.activations.get(operationId);
		if (state !== undefined && state !== 'committed' && state !== 'retired') {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Embedded Comet activation was not committed',
				{ operationId },
			));
		}
		this.activations.set(operationId, 'retired');
		return Promise.resolve();
	}

	rollbackActivation(
		operationId: AgentPackageOperationId,
		transition: Parameters<IAgentPackageRuntimePort['rollbackActivation']>[1],
	): Promise<void> {
		this.assertTransition(transition);
		const state = this.activations.get(operationId);
		if (state !== undefined && state !== 'prepared' && state !== 'committed' && state !== 'rolledBack') {
			return Promise.reject(new AgentPackageError(
				AgentPackageErrorCode.StateConflict,
				'Embedded Comet activation cannot roll back from its current phase',
				{ operationId },
			));
		}
		this.activations.set(operationId, 'rolledBack');
		return Promise.resolve();
	}

	private assertTransition(transition: Parameters<IAgentPackageRuntimePort['commitActivation']>[1]): void {
		for (const side of [transition.previous, transition.next]) {
			if (side === null) {
				continue;
			}
			if (
				side.installedPackage.packageId !== this.bundledPackage.offering.packageId
				|| side.registrations.length !== 1
				|| !exactRegistration(side.registrations[0], this.agent.registration)
			) {
				throw new AgentPackageError(
					AgentPackageErrorCode.RegistrationInvalid,
					'Embedded Comet runtime transition does not address the composed endpoint',
					{ packageId: side.installedPackage.packageId },
				);
			}
		}
	}

	migrateResumeState(
		registration: IAgentRuntimeRegistration,
		request: IAgentResumeMigrationRequest,
	): Promise<IAgentResumeState> {
		this.assertRegistration(registration);
		return this.agent.resumeStates.migrate(request);
	}

	deleteBacking(
		registration: IAgentRuntimeRegistration,
		identity: IAgentBackingIdentity,
		operationId: AgentPackageOperationId,
	): Promise<void> {
		this.assertRegistration(registration);
		const operation = operationIdentity('deleteBacking', operationId, identity);
		if (identity.chatId !== undefined) {
			return this.agent.chats.delete({
				...operation,
				session: identity.sessionId,
				chat: identity.chatId,
			});
		}
		return this.agent.sessions.delete({ ...operation, session: identity.sessionId });
	}

	private assertRegistration(registration: IAgentRuntimeRegistration): void {
		if (!exactRegistration(registration, this.agent.registration)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'Package operation addresses another Agent runtime registration',
				{ packageId: registration.packageId, agentId: registration.agentId },
			);
		}
	}
}

class EmbeddedCometRuntimeResolver implements IAgentHostRuntimeResolver {
	constructor(private readonly agent: CometAgent) { }

	resolve(registration: IAgentRuntimeRegistration) {
		if (!exactRegistration(registration, this.agent.registration)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.RegistrationInvalid,
				'No retained embedded runtime matches the exact Agent registration',
				{ packageId: registration.packageId, agentId: registration.agentId },
			);
		}
		return this.agent;
	}
}

class LocalAgentHostIdentityFactory implements IAgentHostIdentityFactory {
	createSession() {
		return createAgentSessionId(`session:${randomIdentity()}`);
	}

	createChat() {
		return createAgentChatId(`chat:${randomIdentity()}`);
	}

	createTurn() {
		return createAgentTurnId(`turn:${randomIdentity()}`);
	}

	createCancellation() {
		return createAgentCancellationId(`cancellation:${randomIdentity()}`);
	}
}

class LocalAgentHostSubmissionPolicy implements IAgentHostSubmissionPolicy {
	constructor(private readonly now: () => number) { }

	resolve(_agent: IAgentDescriptor, _profile: IAgentExecutionProfile) {
		const requestedDeadline = this.now() + maximumTurnMilliseconds;
		if (!Number.isSafeInteger(requestedDeadline)) {
			throw new Error('Local Agent Host deadline is outside the protocol range');
		}
		return Object.freeze({
			requestedDeadline,
			outputConstraints: Object.freeze({ format: 'text' as const }),
		});
	}
}

class LocalAgentToolPermissionPolicy implements IAgentToolPermissionPort {
	authorize(
		_call: IAgentToolCall,
		_prepared: IPreparedAgentToolSet,
		registration: IAgentToolRegistration,
	): Promise<AgentToolCallAuthorization> {
		const descriptor = registration.descriptor;
		const requiresConfirmation = descriptor.confirmation === 'always'
			|| (descriptor.confirmation === 'writeOrExternal' && descriptor.safety !== 'read');
		if (requiresConfirmation) {
			return Promise.resolve(Object.freeze({
				kind: 'denied' as const,
				message: localize(
					'agentHost.toolConfirmationUnavailable',
					'This Tool call requires confirmation, but no confirmation request was completed.',
				),
			}));
		}
		return Promise.resolve(Object.freeze({ kind: 'authorized' as const }));
	}
}

class LocalAgentToolTimers implements IAgentToolTimerPort {
	schedule(delayMilliseconds: number, callback: () => void): IDisposable {
		if (!Number.isSafeInteger(delayMilliseconds) || delayMilliseconds < 0) {
			throw new Error('Tool timer delay must be a non-negative integer');
		}
		const handle = setTimeout(callback, delayMilliseconds);
		return toDisposable(() => clearTimeout(handle));
	}
}

function randomIdentity(): string {
	return randomUUID().replaceAll('-', '');
}

function packageUpdateDigest(
	installedPackage: IInstalledAgentPackage,
	offering: IAgentPackageOffering,
): AgentHostPayloadDigest {
	return createAgentHostPayloadDigest(`sha256:${sha256(JSON.stringify({
		kind: 'productBundledUpdate',
		from: {
			revision: installedPackage.revision,
			contentDigest: installedPackage.contentDigest,
		},
		to: offering,
	}))}`);
}

function packageUpdateOperation(offering: IAgentPackageOffering): AgentPackageOperationId {
	const digest = sha256(JSON.stringify(offering));
	return createAgentPackageOperationId(`product-comet:${digest}`);
}

function requiresBundledUpdate(
	installedPackage: IInstalledAgentPackage,
	currentPackage: IVerifiedAgentPackage,
): boolean {
	return installedPackage.revision !== currentPackage.offering.revision
		|| installedPackage.contentDigest !== currentPackage.offering.contentDigest;
}

/** Owns the local Agent Host, its IPC channel, and its shutdown ordering. */
export class LocalAgentHostMain extends Disposable {
	private authority: AgentHostAuthority | undefined;
	private cometAgent: CometAgent | undefined;
	private channelFactory: AgentHostConnectionChannelFactory | undefined;
	private readonly settingsUpdates = new Sequencer();
	private shutdownPromise: Promise<void> | undefined;

	private constructor(private readonly options: ILocalAgentHostMainOptions) {
		super();
	}

	static async create(options: ILocalAgentHostMainOptions): Promise<LocalAgentHostMain> {
		const result = new LocalAgentHostMain(options);
		try {
			await result.initialize();
			return result;
		} catch (error) {
			result.dispose();
			throw error;
		}
	}

	shutdown(): Promise<void> {
		this.shutdownPromise ??= this.doShutdown();
		return this.shutdownPromise;
	}

	updateSettings(settings: LlmSettings): Promise<void> {
		return this.settingsUpdates.queue(async () => {
			const authority = this.authority;
			const cometAgent = this.cometAgent;
			if (authority === undefined || cometAgent === undefined) {
				throw new Error('Local Agent Host is not initialized');
			}
			const modelCatalog = this.createModelCatalog(settings);
			const agentUpdate = cometAgent.prepareConfiguration({
				authenticationRequired: this.activeModelRequiresAuthentication(settings),
				models: modelCatalog.models,
				executionProfileResolver: modelCatalog.executionProfileResolver,
			});
			await authority.updateRootConfiguration(Object.freeze({
				agents: Object.freeze([Object.freeze({
					agent: cometAgent,
					descriptor: agentUpdate.descriptor,
					commit: agentUpdate.commit,
				})]),
				sessionTypes: Object.freeze([
					this.createCometSessionType(agentUpdate.descriptor, modelCatalog, settings),
				]),
			}));
		});
	}

	private async initialize(): Promise<void> {
		const bundledPackage = await createCurrentBundledCometPackage(this.options.bundledArtifactPath);
		const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.embedded.v1');
		const modelCatalog = this.createModelCatalog(this.options.settings);
		const contentResources = this._register(new AgentContentResourceService(
			this.options.contentMaterializationRoot,
			localAgentHostContentResourceLimits,
			createAgentContentResourceScheduler(),
		));
		const toolRegistry = new AgentToolRegistry();
		const toolEndpoints = new AgentToolEndpointRegistry();
		const toolSets = new AgentToolSetPreparationService(
			localAgentHostAuthority,
			toolRegistry,
			toolEndpoints,
			maximumPreparedToolSets,
		);
		const toolAuthority = new AgentToolCallAuthority(
			localAgentHostAuthority,
			toolSets,
			new LocalAgentToolPermissionPolicy(),
			maximumBoundToolTurns,
		);
		const toolExecution = new AgentToolExecutionService({
			toolSets,
			endpoints: toolEndpoints,
			authority: toolAuthority,
			timers: new LocalAgentToolTimers(),
			now: this.options.now,
			reportUnexpectedError: onUnexpectedError,
			maximumCallRecords: maximumToolCallRecords,
		});
		const cometAgent = this._register(new CometAgent({
			runtimeRegistration,
			authenticationRequired: this.activeModelRequiresAuthentication(this.options.settings),
			models: modelCatalog.models,
			executionProfileResolver: modelCatalog.executionProfileResolver,
			toolExecution,
			contentResources,
		}));
		const catalogStore = new ApplicationStorageAgentHostCatalogStore(this.options.storage);
		await migrateLegacySessionsCatalog({
			source: new ApplicationStorageLegacyAgentHostCatalogSource(this.options.storage),
			store: catalogStore,
			companion: new LegacyChatMigrationCompanion(this.options.storage, localAgentHostAuthority),
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			sessionType: cometSessionType,
			resumeSchema: COMET_AGENT_RESUME_SCHEMA,
		});
		const artifactPort = new BundledCometArtifactPort(bundledPackage.verifiedPackage);
		const runtimePort = new EmbeddedCometPackageRuntimePort(cometAgent, bundledPackage.verifiedPackage);
		const packageLifecycle = await AgentPackageLifecycle.create({
			hostTarget: bundledPackage.target,
			installablePackages: Object.freeze([]),
			bundledComet: Object.freeze({
				verifiedPackage: bundledPackage.verifiedPackage,
				registrations: Object.freeze([cometAgent.registration]),
			}),
			stateStore: new ApplicationStorageAgentPackageStateStore(this.options.storage),
			artifactPort,
			runtimePort,
		});
		const host = this._register(await AgentHostAuthority.create({
			authority: localAgentHostAuthority,
			label: Object.freeze({ kind: 'localized' as const, key: 'agentHost.local.label' as const }),
			supportedProtocolVersions: Object.freeze([localAgentHostProtocolVersion]),
			capabilities: Object.freeze([]),
			implementation: Object.freeze({ name: 'comet.desktop.main', build: 'agent-host.v1' }),
			sessionTypes: Object.freeze([
				this.createCometSessionType(cometAgent.descriptor.get(), modelCatalog, this.options.settings),
			]),
			agentRuntimes: new EmbeddedCometRuntimeResolver(cometAgent),
			packageLifecycle,
			catalogStore,
			identityFactory: new LocalAgentHostIdentityFactory(),
			submissionPolicy: new LocalAgentHostSubmissionPolicy(this.options.now),
			toolSets,
			toolCallAuthority: toolAuthority,
			contentResources,
			now: this.options.now,
			reportUnexpectedError: onUnexpectedError,
			maximumReplayActions,
		}));
		const installedComet = packageLifecycle.snapshot().installedPackages.find(installed => (
			installed.packageId === COMET_AGENT_PACKAGE_ID
		));
		if (installedComet === undefined) {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstalled,
				'Bundled Comet package is not installed',
				{ packageId: COMET_AGENT_PACKAGE_ID },
			);
		}
		if (requiresBundledUpdate(installedComet, bundledPackage.verifiedPackage)) {
			await packageLifecycle.update({
				operationId: packageUpdateOperation(bundledPackage.verifiedPackage.offering),
				requestDigest: packageUpdateDigest(installedComet, bundledPackage.verifiedPackage.offering),
				packageId: COMET_AGENT_PACKAGE_ID,
				offering: bundledPackage.verifiedPackage.offering,
				authority: 'product',
			});
		}
		this.authority = host;
		this.cometAgent = cometAgent;
		const channelFactory = this._register(new AgentHostConnectionChannelFactory(
			() => host.createConnection(createAgentHostClientConnectionId(`desktop:${randomIdentity()}`)),
			contentResources,
			toolRegistry,
			toolEndpoints,
			this.options.channelServer,
		));
		this.options.channelServer.registerChannel(localAgentHostConnectionChannelName, channelFactory);
		this.channelFactory = channelFactory;
	}

	private createModelCatalog(settings: LlmSettings): IProductionCometModelCatalog {
		return createProductionCometModelCatalog({
			settings,
			loadSettings: this.options.loadSettings,
			fetch: this.options.fetch,
			now: this.options.now,
		});
	}

	private createCometSessionType(
		descriptor: IAgentDescriptor,
		modelCatalog: IProductionCometModelCatalog,
		settings: LlmSettings,
	): IAgentHostSessionTypeDescriptor {
		const activeModel = settings.providers[settings.activeProvider].selectedModelOption;
		const automaticModel = descriptor.models.find(candidate => candidate.id === activeModel);
		if (automaticModel === undefined) {
			throw new Error('Comet automatic model is absent from the Agent descriptor');
		}
		return Object.freeze({
			id: cometSessionType,
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			displayName: Object.freeze({ kind: 'localized' as const, key: 'agentHost.cometSession.displayName' as const }),
			description: Object.freeze({ kind: 'localized' as const, key: 'agentHost.cometSession.description' as const }),
			capabilities: Object.freeze({
				workspace: 'optional' as const,
				supportsEmptySession: true,
				supportsInitialTurn: true,
				supportsCreateChat: true,
				maximumChatCount: 64,
				supportsForkChat: true,
			}),
			models: Object.freeze(descriptor.models.map(model => model.id)),
			executionPresets: Object.freeze([Object.freeze({
				id: COMET_AUTOMATIC_EXECUTION_PRESET,
				displayName: Object.freeze({ kind: 'localized' as const, key: 'agentHost.executionPreset.automatic' as const }),
				model: automaticModel.id,
			})]),
			automaticExecutionPreset: modelCatalog.automaticPreset,
			toolPolicy: Object.freeze({ kind: 'all' as const }),
		});
	}

	private activeModelRequiresAuthentication(settings: LlmSettings): boolean {
		const provider = settings.providers[settings.activeProvider];
		return provider.apiKey.length === 0;
	}

	private async doShutdown(): Promise<void> {
		this.channelFactory?.dispose();
		try {
			if (this.authority !== undefined) {
				const value = JSON.stringify({ kind: 'shutdown', authority: localAgentHostAuthority });
				await this.authority.close(Object.freeze({
					operation: createAgentHostOperationId(`shutdown:${sha256(value)}`),
					payloadDigest: createAgentHostPayloadDigest(`sha256:${sha256(value)}`),
				}));
			}
		} finally {
			super.dispose();
		}
	}
}
