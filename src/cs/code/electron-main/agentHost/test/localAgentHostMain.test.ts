/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import type { IpcMainInvokeEvent } from 'electron';

import { Event, type Event as EventType } from 'cs/base/common/event';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import { LocalAgentHostMain } from 'cs/code/electron-main/agentHost/localAgentHostMain';
import {
	createLocalAgentPackageArtifactFile,
	LocalAgentPackageArtifactPort,
} from 'cs/platform/agentHost/node/packages/localAgentPackageArtifactPort';
import { createMockAgentPackageProducts } from 'cs/code/common/agentHost/test/mockAgentPackages';
import { COMET_AUTOMATIC_EXECUTION_PRESET } from 'cs/code/electron-main/agentHost/cometModelCatalog';
import {
	MockAgentRuntimeConnectionFactory,
	productMockAgentRuntimeRetentionLimits,
} from 'cs/code/electron-utility/agentRuntime/test/mockAgentRuntime';
import { localAgentHostConnectionChannelName } from 'cs/platform/agentHost/common/connectionChannel';
import { resolveAgentModelConfigurationCandidate } from 'cs/platform/agentHost/common/configuration';
import {
	createAgentHostOperationId,
	createAgentPackageOperationId,
	createAgentHostProtocolVersion,
	createAgentModelId,
	createAgentSubmissionId,
} from 'cs/platform/agentHost/common/identities';
import {
	computeAgentHostMutationDigest,
	computeAgentHostSubmissionCaptureDigest,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
	type AgentHostMutationOutcome,
	type AgentHostMutationPayload,
	type AgentHostPrepareSubmissionResult,
	type IAgentHostInitializeResult,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostSetSubscriptionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	computeAgentPackageOperationDigest,
	type AgentPackageOperationOutcome,
	type AgentPackageOperationPayload,
} from 'cs/platform/agentHost/common/packages';
import {
	ApplicationStorageAgentHostCatalogStore,
	ApplicationStorageAgentPackageStateStore,
} from 'cs/platform/agentHost/node/storage/agentHostStateStores';
import {
	COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY,
	COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY,
	COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY,
	COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
	COMET_SESSION_CONFIGURATION_SCHEMA,
} from 'cs/platform/agentHost/node/agents/comet/cometConfiguration';
import type { IProviderApiKeySecretStorage, ProviderApiKeyRef } from 'cs/platform/secrets/common/secret';

const productModels = Object.freeze([
	Object.freeze({
		id: 'glm:glm-4.7-flash',
		endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		providerModel: 'glm-4.7-flash',
		credentialReference: 'glm',
	}),
	Object.freeze({
		id: 'glm:glm-4.6v-flash',
		endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		providerModel: 'glm-4.6v-flash',
		credentialReference: 'glm',
	}),
	Object.freeze({
		id: 'kimi:kimi-k2.5',
		endpoint: 'https://api.moonshot.cn/v1/chat/completions',
		providerModel: 'kimi-k2.5',
		credentialReference: 'kimi',
	}),
	Object.freeze({
		id: 'deepseek:deepseek-v4-flash',
		endpoint: 'https://api.deepseek.com/chat/completions',
		providerModel: 'deepseek-v4-flash',
		credentialReference: 'deepseek',
	}),
	Object.freeze({
		id: 'openai:gpt-5-codex:medium',
		endpoint: 'https://api.openai.com/v1/responses',
		providerModel: 'gpt-5-codex',
		credentialReference: 'openai',
	}),
	Object.freeze({
		id: 'openai:gpt-5.5:medium',
		endpoint: 'https://api.openai.com/v1/responses',
		providerModel: 'gpt-5.5',
		credentialReference: 'openai',
	}),
]);
const automaticModelOption = productModels[0].id;
const packageStateStorageKey = 'agentHost.packages.v3';
const sessionConfigurationCandidate = Object.freeze({
	schema: COMET_SESSION_CONFIGURATION_SCHEMA.revision,
	values: Object.freeze({}),
});

class TestProviderApiKeySecretStorage implements IProviderApiKeySecretStorage {
	getApiKey(ref: ProviderApiKeyRef): Promise<string> {
		return Promise.resolve(`${ref.providerId}-test-key`);
	}

	setApiKey(_ref: ProviderApiKeyRef, _apiKey: string): Promise<void> {
		return Promise.resolve();
	}

	deleteApiKey(_ref: ProviderApiKeyRef): Promise<void> {
		return Promise.resolve();
	}
}

class TestRendererSender {
	readonly id = 41;
	private destroyed = false;
	private destroyedListener: (() => void) | undefined;

	isDestroyed(): boolean {
		return this.destroyed;
	}

	once(event: string, listener: () => void): this {
		assert.equal(event, 'destroyed');
		this.destroyedListener = listener;
		return this;
	}

	off(event: string, listener: () => void): this {
		assert.equal(event, 'destroyed');
		if (this.destroyedListener === listener) {
			this.destroyedListener = undefined;
		}
		return this;
	}
}

class RecordingChannelServer {
	registeredName: string | undefined;
	registeredChannel: IServerChannel<IpcMainInvokeEvent> | undefined;

	constructor(private readonly onRegister: () => void = () => undefined) { }

	registerChannel(name: string, channel: IServerChannel<IpcMainInvokeEvent>): void {
		assert.equal(this.registeredChannel, undefined);
		this.onRegister();
		this.registeredName = name;
		this.registeredChannel = channel;
	}

	getRendererChannel(_senderId: number, _channelName: string): IChannel {
		return {
			call: () => Promise.reject(new Error('The test did not publish client content.')),
			listen: <T = unknown>(): EventType<T> => Event.None,
		};
	}
}

async function createStorage(): Promise<Storage> {
	const storage = new Storage(new InMemoryStorageDatabase());
	await storage.init();
	return storage;
}

async function makeDirectoriesWritable(directory: string): Promise<void> {
	await chmod(directory, 0o700);
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && !entry.isSymbolicLink()) {
			await makeDirectoriesWritable(path.join(directory, entry.name));
		}
	}
}

function digest(bytes: Uint8Array): string {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function installedDigestAtRegistration(storage: Storage): string {
	const serialized = storage.get(packageStateStorageKey);
	if (serialized === undefined) {
		throw new Error('Agent package state was not committed before channel registration.');
	}
	const state = JSON.parse(serialized) as {
		readonly installedPackages: readonly { readonly packageId: string; readonly contentDigest: string }[];
	};
	const installed = state.installedPackages.find(candidate => candidate.packageId === 'comet');
	if (installed === undefined) {
		throw new Error('Bundled Comet was not installed before channel registration.');
	}
	return installed.contentDigest;
}

async function createHost(
	storage: Storage,
	artifactPath: string,
	contentRoot: string,
	channelServer: RecordingChannelServer,
	options: {
		readonly mockRuntimeArtifactPath?: string;
		readonly packageStorageRoot?: string;
	} = {},
): Promise<LocalAgentHostMain> {
	const mockRuntimeArtifactPath = options.mockRuntimeArtifactPath ?? path.join(
		process.cwd(),
		'src/cs/code/electron-utility/agentRuntime/test/mockAgentRuntime.ts',
	);
	const mockAgentPackageProducts = createMockAgentPackageProducts(
		Object.freeze({ operatingSystem: process.platform, architecture: process.arch }),
		await createLocalAgentPackageArtifactFile(mockRuntimeArtifactPath),
	);
	const packageArtifactPort = new LocalAgentPackageArtifactPort({
		storageRoot: options.packageStorageRoot ?? path.join(path.dirname(contentRoot), 'packages'),
		packages: mockAgentPackageProducts.map(product => product.verifiedPackage),
	});
	return LocalAgentHostMain.create({
		storage,
		providerApiKeySecretStorage: new TestProviderApiKeySecretStorage(),
		contentMaterializationRoot: contentRoot,
		bundledArtifactPath: artifactPath,
		agentPackageProducts: mockAgentPackageProducts,
		packageArtifactPort,
		channelServer,
		fetch: () => Promise.reject(new Error('An empty Session must not execute a model request.')),
		now: () => 1_000,
		agentRuntimeConnectionFactory: new MockAgentRuntimeConnectionFactory(
			packageArtifactPort,
			productMockAgentRuntimeRetentionLimits,
		),
	});
}

test('production desktop Agent Host rejects an unverified empty bundled artifact before IPC exposure', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-agent-host-empty-'));
	const storage = await createStorage();
	try {
		const artifactPath = path.join(temporaryRoot, 'comet-main.js');
		await writeFile(artifactPath, '');
		const channelServer = new RecordingChannelServer();
		await assert.rejects(
			createHost(storage, artifactPath, path.join(temporaryRoot, 'content'), channelServer),
			/Bundled Comet artifact is empty/,
		);
		assert.equal(channelServer.registeredChannel, undefined);
	} finally {
		storage.dispose();
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('production desktop Agent Host exposes Comet and creates its exact automatic profile with no advertised Tools', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-agent-host-main-'));
	const storage = await createStorage();
	let host: LocalAgentHostMain | undefined;
	try {
		const artifactPath = path.join(temporaryRoot, 'comet-main.js');
		const artifact = new TextEncoder().encode('verified embedded Comet artifact');
		await writeFile(artifactPath, artifact);
		const channelServer = new RecordingChannelServer();
		host = await createHost(storage, artifactPath, path.join(temporaryRoot, 'content'), channelServer);
		assert.equal(channelServer.registeredName, localAgentHostConnectionChannelName);
		assert.notEqual(channelServer.registeredChannel, undefined);

		const packageState = await new ApplicationStorageAgentPackageStateStore(storage).read();
		if (packageState === undefined) {
			throw new Error('Production Agent package state was not persisted.');
		}
		assert.equal(packageState.installedPackages.length, 1);
		assert.equal(packageState.activeRegistrations[0].revision, 'comet.embedded.v2');
		assert.equal(packageState.activeRegistrations[0].descriptorRevision, 'comet.descriptor.v2');
		const installed = packageState.installedPackages[0];
		assert.equal(installed.packageId, 'comet');
		assert.equal(installed.distribution, 'bundled');
		assert.equal(installed.contentDigest, digest(artifact));
		assert.equal(installed.manifest.contentDigest, digest(artifact));
		assert.equal(installed.dependencyClosure.length, 1);
		assert.equal(installed.dependencyClosure[0].digest, digest(artifact));
		assert.equal(installed.dependencyClosure[0].verifiedDigest, digest(artifact));
		assert.equal(installed.dependencyClosure[0].immutable, true);

		const sender = new TestRendererSender();
		const context = { sender } as unknown as IpcMainInvokeEvent;
		const channel = channelServer.registeredChannel;
		if (channel === undefined) {
			throw new Error('Agent Host IPC channel was not registered.');
		}
		const identity = await channel.call<{ readonly connection: string }>(context, 'identity', undefined);
		const initialized = await channel.call<IAgentHostInitializeResult>(context, 'initialize', {
			connection: identity.connection,
			protocolVersions: Object.freeze([createAgentHostProtocolVersion('2')]),
			capabilities: Object.freeze([]),
			locale: 'en',
			implementation: Object.freeze({ name: 'test.renderer', build: '1' }),
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
		});
		const root = initialized.snapshots.find(snapshot => snapshot.kind === 'root');
		if (root === undefined || root.kind !== 'root') {
			throw new Error('Agent Host root snapshot is missing.');
		}
		assert.equal(root.state.agents.length, 1);
		assert.equal(root.state.agentRegistrations.length, 1);
		assert.equal(
			root.state.agentRegistrations[0].initialSessionConfigurationSchema,
			COMET_SESSION_CONFIGURATION_SCHEMA.revision,
		);
		assert.equal(root.state.agentDefaults.length, 1);
		assert.equal(root.state.agents[0].id, 'comet');
		assert.equal(root.state.agents[0].requiresAgentAuthentication, false);
		assert.deepEqual(
			root.state.agents[0].models.map(model => model.id),
			productModels.map(model => createAgentModelId(model.id)),
		);
		assert.deepEqual(
			root.state.agents[0].models.map(model => {
				const configuration = resolveAgentModelConfigurationCandidate(
					model.configurationSchema,
					Object.freeze({
						schema: model.configurationSchema.revision,
						values: Object.freeze({}),
					}),
				);
				return {
					id: model.id,
					scope: model.configurationSchema.scope,
					properties: model.configurationSchema.properties.map(property => property.id),
					values: configuration.values,
				};
			}),
			productModels.map(model => ({
				id: createAgentModelId(model.id),
				scope: 'model',
				properties: [
					COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY,
					COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY,
					COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY,
				],
				values: {
					[COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY]: model.endpoint,
					[COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY]: model.providerModel,
					[COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY]: {
						provider: COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
						scope: 'llm',
						reference: model.credentialReference,
					},
				},
			})),
		);
		assert.equal(root.state.sessionTypes.length, 1);
		const sessionType = root.state.sessionTypes[0];
		assert.equal(sessionType.id, 'comet');
		assert.equal(sessionType.automaticExecutionPreset, COMET_AUTOMATIC_EXECUTION_PRESET);
		assert.deepEqual(sessionType.executionPresets, [{
			id: COMET_AUTOMATIC_EXECUTION_PRESET,
			displayName: {
				kind: 'localized',
				key: 'agentHost.executionPreset.automatic',
			},
			model: createAgentModelId(automaticModelOption),
		}]);
		const automaticModel = root.state.agents[0].models.find(model => (
			model.id === createAgentModelId(automaticModelOption)
		));
		if (automaticModel === undefined) {
			throw new Error('Comet automatic model is missing.');
		}
		const modelConfigurationCandidate = resolveAgentModelConfigurationCandidate(
			automaticModel.configurationSchema,
			Object.freeze({
				schema: automaticModel.configurationSchema.revision,
				values: Object.freeze({}),
			}),
		);

		const capture = Object.freeze({
			message: 'Use the configured automatic model.',
			attachments: Object.freeze([]),
			interactionTargets: Object.freeze([]),
		});
		const prepareRequest: IAgentHostPrepareSubmissionRequest = Object.freeze({
			submission: createAgentSubmissionId('production-automatic'),
			target: Object.freeze({
				kind: 'draft',
				sessionType: sessionType.id,
				configuration: sessionConfigurationCandidate,
			}),
			capture,
			captureDigest: await computeAgentHostSubmissionCaptureDigest(capture),
			executionSelection: Object.freeze({
				kind: 'preset',
				preset: COMET_AUTOMATIC_EXECUTION_PRESET,
				configuration: modelConfigurationCandidate,
			}),
			toolPolicy: Object.freeze({ kind: 'all' }),
		});
		const prepared = await channel.call<AgentHostPrepareSubmissionResult>(
			context,
			'prepareSubmission',
			prepareRequest,
		);
		assert.equal(prepared.kind, 'prepared');
		if (prepared.kind !== 'prepared') {
			throw new Error('Automatic submission was not prepared.');
		}
		assert.equal(prepared.submission.executionProfile.modelDescriptor, automaticModel.revision);
		assert.deepEqual(prepared.submission.modelConfiguration, modelConfigurationCandidate);
		assert.deepEqual(prepared.submission.credentials, [{
			provider: COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
			scope: 'llm',
			reference: 'glm',
		}]);
		assert.equal(JSON.stringify(prepared).includes('glm-test-key'), false);
		assert.deepEqual(prepared.submission.toolSet.registrations, []);

		const payload: AgentHostMutationPayload = Object.freeze({
			kind: 'createSession',
			sessionType: sessionType.id,
			configuration: sessionConfigurationCandidate,
			chats: Object.freeze([]),
		});
		const outcome = await channel.call<AgentHostMutationOutcome>(context, 'mutate', {
			operation: createAgentHostOperationId('create-production-comet-session'),
			digest: await computeAgentHostMutationDigest(payload),
			payload,
		});
		assert.equal(outcome.kind, 'succeeded');
		if (outcome.kind !== 'succeeded') {
			throw new Error('Production Comet Session creation failed.');
		}
		assert.equal(outcome.result.kind, 'createSession');
		if (outcome.result.kind === 'createSession') {
			assert.deepEqual(outcome.result.chats, []);
		}
		const catalog = await new ApplicationStorageAgentHostCatalogStore(storage).read();
		if (catalog === undefined) {
			throw new Error('Production Agent Host catalog was not persisted.');
		}
		assert.equal(catalog.sessions.length, 1);
		assert.equal(catalog.sessions[0].state.type, 'comet');
	} finally {
		await host?.shutdown();
		storage.dispose();
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('product startup updates the verified bundled Comet revision before registering its channel', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-agent-host-update-'));
	const storage = await createStorage();
	let firstHost: LocalAgentHostMain | undefined;
	let secondHost: LocalAgentHostMain | undefined;
	try {
		const artifactPath = path.join(temporaryRoot, 'comet-main.js');
		const firstArtifact = new TextEncoder().encode('embedded Comet revision one');
		await writeFile(artifactPath, firstArtifact);
		const firstRegistrationDigests: string[] = [];
		firstHost = await createHost(
			storage,
			artifactPath,
			path.join(temporaryRoot, 'first-content'),
			new RecordingChannelServer(() => firstRegistrationDigests.push(installedDigestAtRegistration(storage))),
		);
		const firstState = await new ApplicationStorageAgentPackageStateStore(storage).read();
		assert.deepEqual(firstRegistrationDigests, [digest(firstArtifact)]);
		await firstHost.shutdown();
		firstHost = undefined;

		const secondArtifact = new TextEncoder().encode('embedded Comet revision two');
		await writeFile(artifactPath, secondArtifact);
		const secondRegistrationDigests: string[] = [];
		secondHost = await createHost(
			storage,
			artifactPath,
			path.join(temporaryRoot, 'second-content'),
			new RecordingChannelServer(() => secondRegistrationDigests.push(installedDigestAtRegistration(storage))),
		);
		const secondState = await new ApplicationStorageAgentPackageStateStore(storage).read();
		if (firstState === undefined || secondState === undefined) {
			throw new Error('Agent package state was not persisted across product startup.');
		}
		assert.deepEqual(secondRegistrationDigests, [digest(secondArtifact)]);
		assert.equal(secondState.installedPackages[0].contentDigest, digest(secondArtifact));
		assert.ok(secondState.revision > firstState.revision);
	} finally {
		await firstHost?.shutdown();
		await secondHost?.shutdown();
		storage.dispose();
		await makeDirectoriesWritable(temporaryRoot);
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('desktop Agent Host installs every connected mock product and cold-restores retained Sessions', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-agent-host-connected-mocks-'));
	const storage = await createStorage();
	let firstHost: LocalAgentHostMain | undefined;
	let secondHost: LocalAgentHostMain | undefined;
	try {
		const artifactPath = path.join(temporaryRoot, 'comet-main.js');
		const mockRuntimeArtifactPath = path.join(temporaryRoot, 'mock-agent-runtime.js');
		const packageStorageRoot = path.join(temporaryRoot, 'packages');
		await writeFile(artifactPath, 'verified embedded Comet artifact');
		await writeFile(mockRuntimeArtifactPath, 'export const mockRuntimeBuild = "one";');
		const firstChannels = new RecordingChannelServer();
		firstHost = await createHost(
			storage,
			artifactPath,
			path.join(temporaryRoot, 'first-content'),
			firstChannels,
			{ mockRuntimeArtifactPath, packageStorageRoot },
		);
		const firstChannel = firstChannels.registeredChannel;
		if (firstChannel === undefined) {
			throw new Error('First Agent Host IPC channel was not registered.');
		}
		const firstContext = { sender: new TestRendererSender() } as unknown as IpcMainInvokeEvent;
		const firstIdentity = await firstChannel.call<{ readonly connection: string }>(firstContext, 'identity', undefined);
		const firstInitialized = await firstChannel.call<IAgentHostInitializeResult>(firstContext, 'initialize', {
			connection: firstIdentity.connection,
			protocolVersions: Object.freeze([createAgentHostProtocolVersion('2')]),
			capabilities: Object.freeze([]),
			locale: 'en',
			implementation: Object.freeze({ name: 'test.renderer', build: '1' }),
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
		});
		const initialRoot = firstInitialized.snapshots.find(snapshot => snapshot.kind === 'root');
		if (initialRoot?.kind !== 'root') {
			throw new Error('Initial Agent Host root snapshot is missing.');
		}
		assert.deepEqual(
			initialRoot.state.packages.installablePackages.map(offering => offering.packageId),
			['copilot', 'codex'],
		);

		let packageRevision = initialRoot.state.packages.revision;
		for (const offering of initialRoot.state.packages.installablePackages) {
			const payload: AgentPackageOperationPayload = Object.freeze({
				kind: 'install',
				packageId: offering.packageId,
				offering,
			});
			const operation = createAgentPackageOperationId(`install-${offering.packageId}`);
			const requestDigest = await computeAgentPackageOperationDigest(packageRevision, payload);
			const outcome: AgentPackageOperationOutcome = await firstChannel.call<AgentPackageOperationOutcome>(firstContext, 'executePackageOperation', {
				operation,
				digest: requestDigest,
				expectedCatalogRevision: packageRevision,
				payload,
			});
			if (outcome.kind !== 'succeeded') {
				throw new Error(
					`Connected mock package "${offering.packageId}" did not install: ${JSON.stringify(outcome)}`,
				);
			}
			packageRevision = outcome.result.stateRevision;
		}

		let snapshots = await firstChannel.call<IAgentHostSetSubscriptionsResult>(firstContext, 'setSubscriptions', {
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
		});
		const installedRoot = snapshots.snapshots.find(snapshot => snapshot.kind === 'root');
		if (installedRoot?.kind !== 'root') {
			throw new Error('Installed Agent Host root snapshot is missing.');
		}
		assert.deepEqual(installedRoot.state.agents.map(agent => agent.id), ['comet', 'copilot', 'codex']);
		assert.deepEqual(installedRoot.state.sessionTypes.map(type => type.id), ['comet', 'copilot', 'codex']);
		assert.deepEqual(
			installedRoot.state.agentDefaults.map(defaults => defaults.schema.agent),
			['comet', 'copilot', 'codex'],
		);
		const codexRegistration = installedRoot.state.agentRegistrations.find(registration => registration.agentId === 'codex');
		if (codexRegistration === undefined) {
			throw new Error('Codex connected registration is missing.');
		}
		const codexSessionType = installedRoot.state.sessionTypes.find(type => type.agentId === 'codex');
		if (codexSessionType === undefined) {
			throw new Error('Codex connected Session type is missing.');
		}
		const createPayload: AgentHostMutationPayload = Object.freeze({
			kind: 'createSession',
			sessionType: codexSessionType.id,
			configuration: Object.freeze({
				schema: codexRegistration.initialSessionConfigurationSchema,
				values: Object.freeze({}),
			}),
			chats: Object.freeze([]),
		});
		const created = await firstChannel.call<AgentHostMutationOutcome>(firstContext, 'mutate', {
			operation: createAgentHostOperationId('create-connected-codex-session'),
			digest: await computeAgentHostMutationDigest(createPayload),
			payload: createPayload,
		});
		assert.equal(created.kind, 'succeeded');
		if (created.kind !== 'succeeded' || created.result.kind !== 'createSession') {
			throw new Error('Codex connected Session creation failed.');
		}
		const retainedSession = created.result.session;
		const firstPackageState = await new ApplicationStorageAgentPackageStateStore(storage).read();
		const firstCodexPackage = firstPackageState?.installedPackages.find(candidate => candidate.packageId === 'codex');
		if (firstCodexPackage === undefined) {
			throw new Error('Installed Codex package receipt is missing.');
		}
		const firstCodexEntryPoint = fileURLToPath(firstCodexPackage.dependencyClosure[0].source);
		const firstCodexDigest = firstCodexPackage.contentDigest;

		await firstHost.shutdown();
		firstHost = undefined;
		await writeFile(mockRuntimeArtifactPath, 'export const mockRuntimeBuild = "two";');

		const secondChannels = new RecordingChannelServer();
		secondHost = await createHost(
			storage,
			artifactPath,
			path.join(temporaryRoot, 'second-content'),
			secondChannels,
			{ mockRuntimeArtifactPath, packageStorageRoot },
		);
		const secondChannel = secondChannels.registeredChannel;
		if (secondChannel === undefined) {
			throw new Error('Second Agent Host IPC channel was not registered.');
		}
		const secondContext = { sender: new TestRendererSender() } as unknown as IpcMainInvokeEvent;
		const secondIdentity = await secondChannel.call<{ readonly connection: string }>(secondContext, 'identity', undefined);
		const secondInitialized = await secondChannel.call<IAgentHostInitializeResult>(secondContext, 'initialize', {
			connection: secondIdentity.connection,
			protocolVersions: Object.freeze([createAgentHostProtocolVersion('2')]),
			capabilities: Object.freeze([]),
			locale: 'en',
			implementation: Object.freeze({ name: 'test.renderer', build: '2' }),
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionChannelId(retainedSession)]),
		});
		const restoredRoot = secondInitialized.snapshots.find(snapshot => snapshot.kind === 'root');
		const restoredSession = secondInitialized.snapshots.find(snapshot => snapshot.kind === 'session');
		if (restoredRoot?.kind !== 'root' || restoredSession?.kind !== 'session') {
			throw new Error('Cold-restored connected Agent snapshots are missing.');
		}
		assert.deepEqual(restoredRoot.state.agents.map(agent => agent.id), ['comet', 'copilot', 'codex']);
		assert.equal(restoredSession.state.lifecycle, 'available');
		const restoredPackageState = await new ApplicationStorageAgentPackageStateStore(storage).read();
		const restoredCodexPackage = restoredPackageState?.installedPackages.find(candidate => candidate.packageId === 'codex');
		if (restoredCodexPackage === undefined) {
			throw new Error('Cold-restored Codex installed record is missing.');
		}
		assert.equal(restoredCodexPackage.contentDigest, firstCodexDigest);
		assert.equal(fileURLToPath(restoredCodexPackage.dependencyClosure[0].source), firstCodexEntryPoint);

		const codexOffering = restoredRoot.state.packages.installablePackages.find(offering => offering.packageId === 'codex');
		if (codexOffering === undefined) {
			throw new Error('Codex installable offering is missing after cold restore.');
		}
		const uninstallPayload: AgentPackageOperationPayload = Object.freeze({ kind: 'uninstall', packageId: codexOffering.packageId });
		let operation = createAgentPackageOperationId('uninstall-cold-restored-codex');
		let requestDigest = await computeAgentPackageOperationDigest(restoredRoot.state.packages.revision, uninstallPayload);
		let packageOutcome = await secondChannel.call<AgentPackageOperationOutcome>(secondContext, 'executePackageOperation', {
			operation,
			digest: requestDigest,
			expectedCatalogRevision: restoredRoot.state.packages.revision,
			payload: uninstallPayload,
		});
		assert.equal(packageOutcome.kind, 'succeeded');
		await assert.rejects(readFile(firstCodexEntryPoint));

		snapshots = await secondChannel.call<IAgentHostSetSubscriptionsResult>(secondContext, 'setSubscriptions', {
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionChannelId(retainedSession)]),
		});
		const unavailableRoot = snapshots.snapshots.find(snapshot => snapshot.kind === 'root');
		const unavailableSession = snapshots.snapshots.find(snapshot => snapshot.kind === 'session');
		if (unavailableRoot?.kind !== 'root' || unavailableSession?.kind !== 'session') {
			throw new Error('Uninstalled connected Agent snapshots are missing.');
		}
		assert.equal(unavailableRoot.state.agents.some(agent => agent.id === 'codex'), false);
		assert.equal(unavailableSession.state.lifecycle, 'unavailable');

		const reinstallPayload: AgentPackageOperationPayload = Object.freeze({
			kind: 'install',
			packageId: codexOffering.packageId,
			offering: codexOffering,
		});
		operation = createAgentPackageOperationId('reinstall-cold-restored-codex');
		requestDigest = await computeAgentPackageOperationDigest(unavailableRoot.state.packages.revision, reinstallPayload);
		packageOutcome = await secondChannel.call<AgentPackageOperationOutcome>(secondContext, 'executePackageOperation', {
			operation,
			digest: requestDigest,
			expectedCatalogRevision: unavailableRoot.state.packages.revision,
			payload: reinstallPayload,
		});
		assert.equal(packageOutcome.kind, 'succeeded');

		snapshots = await secondChannel.call<IAgentHostSetSubscriptionsResult>(secondContext, 'setSubscriptions', {
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionChannelId(retainedSession)]),
		});
		const releasedSession = snapshots.snapshots.find(snapshot => snapshot.kind === 'session');
		if (releasedSession?.kind !== 'session') {
			throw new Error('Reinstalled connected Agent Session snapshot is missing.');
		}
		assert.equal(releasedSession.state.lifecycle, 'released');

		const deletePayload: AgentHostMutationPayload = Object.freeze({ kind: 'deleteSession', session: retainedSession });
		const deleted = await secondChannel.call<AgentHostMutationOutcome>(secondContext, 'mutate', {
			operation: createAgentHostOperationId('delete-cold-restored-codex-session'),
			digest: await computeAgentHostMutationDigest(deletePayload),
			payload: deletePayload,
		});
		assert.equal(deleted.kind, 'succeeded');
	} finally {
		await firstHost?.shutdown();
		await secondHost?.shutdown();
		storage.dispose();
		await makeDirectoriesWritable(temporaryRoot);
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('desktop main composes Agent Host before IPC/window startup and closes it before storage', async () => {
	const mainSource = await readFile(path.join(process.cwd(), 'src/cs/code/electron-main/main.ts'), 'utf8');
	const ipcSource = await readFile(path.join(process.cwd(), 'src/cs/code/electron-main/ipc.ts'), 'utf8');
	const createHostIndex = mainSource.indexOf('const agentHost = await LocalAgentHostMain.create');
	const registerIpcIndex = mainSource.indexOf('registerAppIpc(storage');
	const openWindowIndex = mainSource.indexOf('await windowsMainService.openMainWindow(settings)');
	const closeHostIndex = mainSource.indexOf('await agentHost.shutdown()');
	const closeStorageIndex = mainSource.indexOf('await storage.close()');
	assert.ok(createHostIndex >= 0);
	assert.ok(createHostIndex < registerIpcIndex);
	assert.ok(createHostIndex < openWindowIndex);
	assert.ok(closeHostIndex >= 0);
	assert.ok(closeHostIndex < closeStorageIndex);
	assert.match(mainSource, /bundledArtifactPath: fileURLToPath\(import\.meta\.url\)/);
	assert.doesNotMatch(mainSource, /mockAgentRuntime|createMockAgentPackageProducts/);
	assert.doesNotMatch(mainSource, /ClaudeAgent|claudeAgent|AgentRuntimeProcessFactory/);
	assert.match(mainSource, /const agentPackages = await createProductAgentPackageCatalog\(\{/);
	assert.match(mainSource, /sdkArtifactRoot: app\.isPackaged/);
	assert.match(mainSource, /agentPackageProducts: agentPackages\.products/);
	assert.match(mainSource, /contentMaterializationRoot: environmentMainPaths\.agentHostContentDir/);
	assert.match(mainSource, /packageStorageRoot: environmentMainPaths\.agentHostPackagesDir/);
	assert.match(mainSource, /packageArtifactPort: agentPackages\.artifacts/);
	assert.match(mainSource, /providerApiKeySecretStorage: storage\.providerApiKeySecretStorage/);
	assert.match(mainSource, /agentStateRoot: environmentMainPaths\.agentHostAgentStateDir/);
	assert.match(mainSource, /registerAppIpc\(storage, nativeHostMainService, themeMainService\)/);
	const saveSettingsIndex = ipcSource.indexOf('const saved = await storage.saveSettings');
	const updateThemeIndex = ipcSource.indexOf('themeMainService.updateSettings(saved)', saveSettingsIndex);
	assert.ok(saveSettingsIndex >= 0);
	assert.ok(saveSettingsIndex < updateThemeIndex);
});
