/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { IpcMainInvokeEvent } from 'electron';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError, onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { ElectronMainChannelServer } from 'cs/base/parts/ipc/electron-main/ipcMain';
import type { IStorage } from 'cs/base/parts/storage/common/storage';
import { localAgentHostContentResourceLimits } from './localAgentHostConfiguration.js';
import { localAgentHostConnectionChannelName } from 'cs/platform/agentHost/common/connectionChannel';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import type {
	IAgentDescriptor,
	IAgentExecutionProfile,
} from 'cs/platform/agentHost/common/agent';
import {
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentDescriptorRevision,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentPackageContentDigest,
	createAgentPackageRevision,
	createAgentRuntimeRegistrationRevision,
	createAgentRuntimeProtocolVersion,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentTurnId,
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
	COMET_AGENT_CAPABILITY_REVISION,
	CometAgent,
} from 'cs/platform/agentHost/node/agents/comet/cometAgent';
import {
	COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
	COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
	COMET_SESSION_CONFIGURATION_SCHEMA,
} from 'cs/platform/agentHost/node/agents/comet/cometConfiguration';
import {
	AgentCredentialService,
	type IAgentCredentialSecretSource,
} from 'cs/platform/agentHost/node/credentials/agentCredentialService';
import type { IAgentCredentialReference } from 'cs/platform/agentHost/common/credentials';
import type { IProviderApiKeySecretStorage } from 'cs/platform/secrets/common/secret';
import { COMET_AGENT_RESUME_SCHEMA } from 'cs/platform/agentHost/node/agents/comet/cometResume';
import {
	AgentContentResourceService,
	createAgentContentResourceScheduler,
} from 'cs/platform/agentHost/node/content/agentContentResourceService';
import { AgentHostConnectionChannelFactory } from 'cs/platform/agentHost/electron-main/agentHostConnectionChannel';
import {
	AgentHostAuthority,
	type IAgentHostIdentityFactory,
	type IAgentHostSubmissionPolicy,
} from 'cs/platform/agentHost/node/host/agentHostAuthority';
import {
	migrateLegacySessionsCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog';
import {
	AgentPackageLifecycle,
	type IAgentPackageArtifactPort,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type { IAgentPackageTarget } from 'cs/platform/agentHost/common/packages';
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
import { LocalAgentHostSessionTypeCatalog } from './localAgentHostSessionTypeCatalog.js';
import {
	AgentPackageActivationRegistry,
	type IAgentRuntimeConnectionFactory,
} from 'cs/platform/agentHost/node/packages/agentPackageActivationRegistry';
import type {
	IAgentPackageCredentialBinding,
	ILocalAgentPackageProduct,
} from 'cs/platform/agentHost/node/packages/agentPackageProducts';

const localAgentHostAuthority = createAgentHostAuthorityId('local');
const localAgentHostProtocolVersion = createAgentHostProtocolVersion('3');
const localAgentRuntimeProtocolVersion = createAgentRuntimeProtocolVersion('3');
const cometSessionType = createAgentSessionTypeId('comet');
const maximumPreparedToolSets = 4_096;
const maximumBoundToolTurns = 1_024;
const maximumToolCallRecords = 16_384;
const maximumReplayActions = 16_384;
const maximumTurnMilliseconds = 5 * 60 * 1_000;
const localAgentRuntimeTransportLimits = Object.freeze({
	maximumRequestBytes: 16 * 1_024 * 1_024,
	maximumResponseBytes: 16 * 1_024 * 1_024,
	maximumActionBytes: 4 * 1_024 * 1_024,
	maximumConcurrentCalls: 64,
});
const initialCometAgentDefaults = Object.freeze({
	schema: COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('comet.host-defaults.initial.v1'),
	values: Object.freeze({}),
});
const legacyCometSessionConfiguration = Object.freeze({
	schema: COMET_SESSION_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('comet.session.legacy.v1'),
	values: Object.freeze({}),
});

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
	readonly providerApiKeySecretStorage: IProviderApiKeySecretStorage;
	readonly contentMaterializationRoot: string;
	readonly bundledArtifactPath: string;
	readonly agentPackageProducts: readonly ILocalAgentPackageProduct[];
	readonly packageArtifactPort: IAgentPackageArtifactPort;
	readonly channelServer: ILocalAgentHostChannelServer;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
	readonly agentRuntimeConnectionFactory?: IAgentRuntimeConnectionFactory;
}

interface ICurrentBundledCometPackage {
	readonly target: IAgentPackageTarget;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

function sha256(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
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
		id: 'comet.host-artifact',
		source,
		target: 'comet/host-artifact.js',
		digest: artifactDigest,
		license: 'MIT',
		executable: false,
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
		execution: Object.freeze({ kind: 'host' as const }),
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

const productionCredentialReferences = new Set(['glm', 'kimi', 'deepseek', 'openai']);

class LocalAgentCredentialSecretSource implements IAgentCredentialSecretSource {
	private readonly packageBindings: ReadonlyMap<string, IAgentPackageCredentialBinding>;

	constructor(
		private readonly secrets: IProviderApiKeySecretStorage,
		packageBindings: readonly IAgentPackageCredentialBinding[],
	) {
		const bindings = new Map<string, IAgentPackageCredentialBinding>();
		for (const binding of packageBindings) {
			const key = this.bindingKey(binding);
			if (bindings.has(key)) {
				throw new Error(`Duplicate Agent package credential binding '${key}'.`);
			}
			bindings.set(key, binding);
		}
		this.packageBindings = bindings;
	}

	requiredPrivilege(credential: IAgentCredentialReference): string {
		const cometCredential = credential.provider === COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER
			&& credential.scope === 'llm'
			&& productionCredentialReferences.has(credential.reference);
		if (cometCredential) {
			return 'configured.model.api-key';
		}
		const binding = this.packageBindings.get(this.bindingKey(credential));
		if (binding === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnauthorized,
				'Local Agent credential reference is not supported',
				{ provider: credential.provider, scope: credential.scope },
			);
		}
		return binding.privilege;
	}

	async resolve(credential: IAgentCredentialReference, token: CancellationToken): Promise<string | undefined> {
		this.requiredPrivilege(credential);
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const apiKey = await this.secrets.getApiKey({ scope: 'llm', providerId: credential.reference });
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		return apiKey.length === 0 ? undefined : apiKey;
	}

	private bindingKey(credential: Pick<IAgentCredentialReference, 'provider' | 'scope' | 'reference'>): string {
		return `${credential.provider}\u0000${credential.scope}\u0000${credential.reference}`;
	}
}

function randomIdentity(): string {
	return randomUUID().replaceAll('-', '');
}

/** Owns the local Agent Host, its IPC channel, and its shutdown ordering. */
export class LocalAgentHostMain extends Disposable {
	private authority: AgentHostAuthority | undefined;
	private channelFactory: AgentHostConnectionChannelFactory | undefined;
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

	private async initialize(): Promise<void> {
		const bundledPackage = await createCurrentBundledCometPackage(this.options.bundledArtifactPath);
		const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.embedded.v2');
		const agentPackages = this.options.agentPackageProducts;
		const credentials = new AgentCredentialService(
			new LocalAgentCredentialSecretSource(
				this.options.providerApiKeySecretStorage,
				Object.freeze(agentPackages.flatMap(product => product.credentialBindings)),
			),
		);
		const modelCatalog = this.createModelCatalog(credentials);
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
		const cometAgent = new CometAgent({
			runtimeRegistration,
			requiresAgentAuthentication: false,
			models: modelCatalog.models,
			executionProfileResolver: modelCatalog.executionProfileResolver,
			toolExecution,
			contentResources,
		});
		const packageStateStore = new ApplicationStorageAgentPackageStateStore(this.options.storage, {
			hostTarget: bundledPackage.target,
			registrationMigration: {
				registrations: Object.freeze([Object.freeze({
					source: Object.freeze({
						packageId: COMET_AGENT_PACKAGE_ID,
						agentId: COMET_AGENT_ID,
						revision: createAgentRuntimeRegistrationRevision('comet.embedded.v1'),
						descriptorRevision: createAgentDescriptorRevision('comet.descriptor.v1'),
						capabilityRevision: COMET_AGENT_CAPABILITY_REVISION,
						supportedToolSchemaProfiles: cometAgent.registration.supportedToolSchemaProfiles,
						supportedResumeSchemas: cometAgent.registration.supportedResumeSchemas,
						resumeMigrationEdges: cometAgent.registration.resumeMigrationEdges,
					}),
					target: cometAgent.registration,
				})]),
			},
		});
		const activationRegistry = this._register(new AgentPackageActivationRegistry({
			bundledAgents: Object.freeze([Object.freeze({
				offerings: Object.freeze([bundledPackage.verifiedPackage.offering]),
				agents: Object.freeze([cometAgent]),
				lifetime: cometAgent,
			})]),
			hostAgentFactories: Object.freeze(agentPackages.flatMap(product => (
				product.execution === 'host'
					? [Object.freeze({
						offerings: Object.freeze([product.offering]),
						create: product.createAgent,
					})]
					: []
			))),
			connectionFactory: this.options.agentRuntimeConnectionFactory,
			toolExecution,
			contentResources,
			credentialResolver: credentials,
			protocolVersions: Object.freeze([localAgentRuntimeProtocolVersion]),
			transportLimits: localAgentRuntimeTransportLimits,
			implementation: Object.freeze({ name: 'comet.desktop.main', build: 'agent-runtime.v2' }),
		}));
		const catalogStore = new ApplicationStorageAgentHostCatalogStore(this.options.storage, {
			agentDefaults: Object.freeze([initialCometAgentDefaults]),
			sessionConfigurations: Object.freeze([legacyCometSessionConfiguration]),
		});
		await migrateLegacySessionsCatalog({
			source: new ApplicationStorageLegacyAgentHostCatalogSource(this.options.storage),
			store: catalogStore,
			companion: new LegacyChatMigrationCompanion(this.options.storage, localAgentHostAuthority),
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			sessionType: cometSessionType,
			resumeSchema: COMET_AGENT_RESUME_SCHEMA,
			agentDefaults: Object.freeze([initialCometAgentDefaults]),
			sessionConfiguration: legacyCometSessionConfiguration,
		});
		const packageLifecycle = await AgentPackageLifecycle.create({
			hostTarget: bundledPackage.target,
			installablePackages: Object.freeze(agentPackages.map(product => product.offering)),
			bundledComet: Object.freeze({
				verifiedPackage: bundledPackage.verifiedPackage,
				registrations: Object.freeze([cometAgent.registration]),
			}),
			stateStore: packageStateStore,
			artifactPort: this.options.packageArtifactPort,
			activationPort: activationRegistry,
		});
		const sessionTypeCatalog = new LocalAgentHostSessionTypeCatalog(Object.freeze([
			Object.freeze({
				packageId: cometAgent.registration.packageId,
				agentId: cometAgent.registration.agentId,
				resolveRegistrationRevision: () => cometAgent.registration.revision,
				resolve: (descriptor: IAgentDescriptor) => this.createCometSessionType(descriptor, modelCatalog),
			}),
			...agentPackages.map(product => Object.freeze({
				packageId: product.definition.packageId,
				agentId: product.definition.agentId,
				resolveRegistrationRevision: product.definition.resolveRegistrationRevision,
				resolve: product.definition.resolveSessionType,
			})),
		]));
		const host = this._register(await AgentHostAuthority.create({
			authority: localAgentHostAuthority,
			label: Object.freeze({ kind: 'localized' as const, key: 'agentHost.local.label' as const }),
			supportedProtocolVersions: Object.freeze([localAgentHostProtocolVersion]),
			capabilities: Object.freeze([]),
			implementation: Object.freeze({ name: 'comet.desktop.main', build: 'agent-host.v2' }),
			sessionTypeCatalog,
			agentRuntimes: activationRegistry,
			packageLifecycle,
			credentials,
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
		this.authority = host;
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

	private createModelCatalog(credentials: AgentCredentialService): IProductionCometModelCatalog {
		return createProductionCometModelCatalog({
			credentials,
			fetch: this.options.fetch,
			now: this.options.now,
		});
	}

	private createCometSessionType(
		descriptor: IAgentDescriptor,
		modelCatalog: IProductionCometModelCatalog,
	): IAgentHostSessionTypeDescriptor {
		const automaticModel = descriptor.models.find(candidate => candidate.id === modelCatalog.automaticModel);
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
