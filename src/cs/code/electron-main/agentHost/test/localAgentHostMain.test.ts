/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { IpcMainInvokeEvent } from 'electron';

import { Event, type Event as EventType } from 'cs/base/common/event';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { LlmSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import { LocalAgentHostMain } from 'cs/code/electron-main/agentHost/localAgentHostMain';
import { COMET_AUTOMATIC_EXECUTION_PRESET } from 'cs/code/electron-main/agentHost/cometModelCatalog';
import { localAgentHostConnectionChannelName } from 'cs/platform/agentHost/common/connectionChannel';
import {
	createAgentHostOperationId,
	createAgentHostProtocolVersion,
	createAgentModelId,
	createAgentSubmissionId,
} from 'cs/platform/agentHost/common/identities';
import {
	computeAgentHostMutationDigest,
	computeAgentHostSubmissionCaptureDigest,
	getAgentHostRootChannelId,
	getAgentHostSessionsChannelId,
	type AgentHostChannelAction,
	type AgentHostMutationOutcome,
	type AgentHostMutationPayload,
	type AgentHostPrepareSubmissionResult,
	type IAgentHostInitializeResult,
	type IAgentHostPrepareSubmissionRequest,
} from 'cs/platform/agentHost/common/protocol';
import {
	ApplicationStorageAgentHostCatalogStore,
	ApplicationStorageAgentPackageStateStore,
} from 'cs/platform/agentHost/node/storage/agentHostStateStores';

const modelOption = 'openai:gpt-5.5:medium';
const packageStateStorageKey = 'agentHost.packages.v1';

function provider(baseUrl = '') {
	return {
		apiKey: '',
		baseUrl,
		selectedModelOption: '',
		enabledModelOptions: [] as string[],
	};
}

function settings(): LlmSettings {
	return {
		activeProvider: 'openai',
		providers: {
			glm: provider('https://open.bigmodel.cn/api/paas/v4'),
			kimi: provider('https://api.moonshot.cn/v1'),
			deepseek: provider('https://api.deepseek.com'),
			anthropic: provider(),
			openai: {
				apiKey: 'test-key',
				baseUrl: 'https://api.openai.com/v1',
				selectedModelOption: modelOption,
				enabledModelOptions: [modelOption],
			},
			gemini: provider('https://generativelanguage.googleapis.com/v1beta/openai/'),
			custom: provider(),
		},
	};
}

function nextSettings(): LlmSettings {
	const result = settings();
	const nextModel = 'glm:glm-4.7-flash';
	result.activeProvider = 'glm';
	result.providers.openai.selectedModelOption = '';
	result.providers.openai.enabledModelOptions = [];
	result.providers.glm.apiKey = 'next-test-key';
	result.providers.glm.selectedModelOption = nextModel;
	result.providers.glm.enabledModelOptions = [nextModel];
	return result;
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
	settingsAuthority: { current: LlmSettings } = { current: settings() },
): Promise<LocalAgentHostMain> {
	return LocalAgentHostMain.create({
		storage,
		settings: settingsAuthority.current,
		loadSettings: async signal => {
			assert.equal(signal.aborted, false);
			return settingsAuthority.current;
		},
		contentMaterializationRoot: contentRoot,
		bundledArtifactPath: artifactPath,
		channelServer,
		fetch: () => Promise.reject(new Error('An empty Session must not execute a model request.')),
		now: () => 1_000,
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
			protocolVersions: Object.freeze([createAgentHostProtocolVersion('1')]),
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
		assert.equal(root.state.agents[0].id, 'comet');
		assert.equal(root.state.agents[0].authenticationRequired, false);
		assert.deepEqual(root.state.agents[0].models.map(model => model.id), [createAgentModelId(modelOption)]);
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
			model: createAgentModelId(modelOption),
		}]);

		const capture = Object.freeze({
			message: 'Use the configured automatic model.',
			attachments: Object.freeze([]),
			interactionTargets: Object.freeze([]),
		});
		const prepareRequest: IAgentHostPrepareSubmissionRequest = Object.freeze({
			submission: createAgentSubmissionId('production-automatic'),
			target: Object.freeze({ kind: 'draft', sessionType: sessionType.id }),
			capture,
			captureDigest: await computeAgentHostSubmissionCaptureDigest(capture),
			executionSelection: Object.freeze({ kind: 'preset', preset: COMET_AUTOMATIC_EXECUTION_PRESET }),
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
		assert.equal(prepared.submission.executionProfile.modelDescriptor, root.state.agents[0].models[0].revision);
		assert.deepEqual(prepared.submission.toolSet.registrations, []);

		const payload: AgentHostMutationPayload = Object.freeze({
			kind: 'createSession',
			sessionType: sessionType.id,
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

test('saved LLM settings hot-publish one contiguous root revision and route only new preparations to the new catalog', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-agent-host-hot-settings-'));
	const storage = await createStorage();
	let host: LocalAgentHostMain | undefined;
	try {
		const artifactPath = path.join(temporaryRoot, 'comet-main.js');
		await writeFile(artifactPath, 'verified embedded Comet artifact');
		const channelServer = new RecordingChannelServer();
		const settingsAuthority = { current: settings() };
		host = await createHost(
			storage,
			artifactPath,
			path.join(temporaryRoot, 'content'),
			channelServer,
			settingsAuthority,
		);
		const channel = channelServer.registeredChannel;
		if (channel === undefined) {
			throw new Error('Agent Host IPC channel was not registered.');
		}
		const context = { sender: new TestRendererSender() } as unknown as IpcMainInvokeEvent;
		const identity = await channel.call<{ readonly connection: string }>(context, 'identity', undefined);
		const initialized = await channel.call<IAgentHostInitializeResult>(context, 'initialize', {
			connection: identity.connection,
			protocolVersions: Object.freeze([createAgentHostProtocolVersion('1')]),
			capabilities: Object.freeze([]),
			locale: 'en',
			implementation: Object.freeze({ name: 'test.renderer', build: '1' }),
			subscriptions: Object.freeze([getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]),
		});
		const initialRoot = initialized.snapshots.find(snapshot => snapshot.kind === 'root');
		if (initialRoot === undefined || initialRoot.kind !== 'root') {
			throw new Error('Agent Host root snapshot is missing.');
		}
		const actions: AgentHostChannelAction[] = [];
		const listener = channel.listen<AgentHostChannelAction>(context, 'onDidReceiveAction', undefined)(action => {
			actions.push(action);
		});
		try {
			const capture = Object.freeze({
				message: 'Capture the old automatic profile.',
				attachments: Object.freeze([]),
				interactionTargets: Object.freeze([]),
			});
			const oldPreparation = await channel.call<AgentHostPrepareSubmissionResult>(context, 'prepareSubmission', {
				submission: createAgentSubmissionId('hot-settings-old'),
				target: Object.freeze({ kind: 'draft', sessionType: initialRoot.state.sessionTypes[0].id }),
				capture,
				captureDigest: await computeAgentHostSubmissionCaptureDigest(capture),
				executionSelection: Object.freeze({ kind: 'preset', preset: COMET_AUTOMATIC_EXECUTION_PRESET }),
				toolPolicy: Object.freeze({ kind: 'all' }),
			});
			assert.equal(oldPreparation.kind, 'prepared');
			if (oldPreparation.kind !== 'prepared') {
				throw new Error('Old automatic submission was not prepared.');
			}

			settingsAuthority.current = nextSettings();
			await host.updateSettings(settingsAuthority.current);
			assert.equal(channelServer.registeredChannel, channel);
			assert.equal(actions.length, 1);
			const rootAction = actions[0];
			assert.equal(rootAction.kind, 'root');
			if (rootAction.kind !== 'root') {
				throw new Error('Hot settings did not publish a root action.');
			}
			assert.equal(rootAction.hostSequence, initialized.hostSequence + 1);
			assert.equal(rootAction.revision, initialRoot.revision + 1);
			assert.equal(rootAction.cause.kind, 'host');
			assert.deepEqual(rootAction.action.state.agents[0].models.map(model => model.id), [
				createAgentModelId('glm:glm-4.7-flash'),
			]);
			assert.deepEqual(rootAction.action.state.sessionTypes[0].models, [
				createAgentModelId('glm:glm-4.7-flash'),
			]);

			const nextPreparation = await channel.call<AgentHostPrepareSubmissionResult>(context, 'prepareSubmission', {
				submission: createAgentSubmissionId('hot-settings-next'),
				target: Object.freeze({ kind: 'draft', sessionType: rootAction.action.state.sessionTypes[0].id }),
				capture,
				captureDigest: await computeAgentHostSubmissionCaptureDigest(capture),
				executionSelection: Object.freeze({ kind: 'preset', preset: COMET_AUTOMATIC_EXECUTION_PRESET }),
				toolPolicy: Object.freeze({ kind: 'all' }),
			});
			assert.equal(nextPreparation.kind, 'prepared');
			if (nextPreparation.kind !== 'prepared') {
				throw new Error('New automatic submission was not prepared.');
			}
			assert.equal(
				oldPreparation.submission.executionProfile.modelDescriptor,
				initialRoot.state.agents[0].models[0].revision,
			);
			assert.equal(
				nextPreparation.submission.executionProfile.modelDescriptor,
				rootAction.action.state.agents[0].models[0].revision,
			);
			assert.notEqual(
				nextPreparation.submission.executionProfile.modelDescriptor,
				oldPreparation.submission.executionProfile.modelDescriptor,
			);
		} finally {
			listener.dispose();
		}
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
	assert.match(mainSource, /contentMaterializationRoot: environmentMainPaths\.agentHostContentDir/);
	assert.match(mainSource, /registerAppIpc\(storage, nativeHostMainService, themeMainService, settings => agentHost\.updateSettings\(settings\)\)/);
	const saveSettingsIndex = ipcSource.indexOf('const saved = await storage.saveSettings');
	const updateAgentHostIndex = ipcSource.indexOf('await updateLlmSettings(saved.llm)', saveSettingsIndex);
	const updateThemeIndex = ipcSource.indexOf('themeMainService.updateSettings(saved)', saveSettingsIndex);
	assert.ok(saveSettingsIndex >= 0);
	assert.ok(saveSettingsIndex < updateAgentHostIndex);
	assert.ok(updateAgentHostIndex < updateThemeIndex);
});
