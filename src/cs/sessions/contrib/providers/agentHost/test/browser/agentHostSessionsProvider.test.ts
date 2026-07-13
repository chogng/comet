/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	createAgentCapabilityRevision,
	createAgentChatId,
	createAgentDescriptorRevision,
	createAgentExecutionPresetId,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostActionDigest,
	createAgentHostAuthorityId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
	type AgentHostChannelId,
	type AgentSessionId,
} from 'cs/platform/agentHost/common/identities';
import type {
	AgentPackageOperationOutcome,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import {
	AgentHostOperationFailureCode,
	getAgentHostChatChannelId,
	getAgentHostRootChannelId,
	getAgentHostSessionChannelId,
	getAgentHostSessionsChannelId,
	type AgentHostChannelAction,
	type AgentHostChannelSnapshot,
	type AgentHostMutationOutcome,
	type AgentHostReconnectResult,
	type IAgentHostChatState,
	type IAgentHostInitializeRequest,
	type IAgentHostInitializeResult,
	type IAgentHostMutationRequest,
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostReconnectRequest,
	type IAgentHostRootState,
	type IAgentHostSessionCatalogState,
	type IAgentHostSessionState,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
} from 'cs/platform/agentHost/common/protocol';
import { AgentHostSessionsProvider } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionsProvider';
import { resolveAgentHostDisplayText } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionProjection';
import {
	ChatInteractivity,
	ChatOriginKind,
	SessionWorkspaceKind,
} from 'cs/sessions/services/sessions/common/session';
import { SessionTransitionKind } from 'cs/sessions/services/sessions/common/sessionsProvider';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';

const authority = createAgentHostAuthorityId('local');
const packageId = createAgentPackageId('comet');
const agentId = createAgentId('comet');
const sessionType = createAgentSessionTypeId('comet.chat');
const modelId = createAgentModelId('comet-model');
const automaticPreset = createAgentExecutionPresetId('automatic');
const payloadDigest = createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`);

function createRootState(): IAgentHostRootState {
	return {
		authority,
		label: { kind: 'literal', value: 'Local Agent Host' },
		capabilities: {
			supportsCreateSession: true,
			supportsPackageOperations: false,
			supportsAgentAuthentication: false,
		},
		packages: {
			revision: 0,
			installablePackages: [],
			installedPackages: [],
			activations: [],
			retainedBackingRecords: [],
			materializedBackings: [],
		},
		agents: [{
			id: agentId,
			packageId,
			revision: createAgentDescriptorRevision('agent-revision-1'),
			displayName: 'Comet',
			description: 'Comet test Agent',
			capabilities: {
				revision: createAgentCapabilityRevision('capabilities-1'),
				supportsEmptySession: true,
				supportsCreateChat: true,
				maximumChatCount: 5,
				supportsForkChat: true,
				supportsQueue: false,
				supportsSteering: false,
				supportsCancellation: true,
				supportsReleaseSession: true,
				supportsReleaseChat: true,
				supportsDeleteSession: true,
				supportsDeleteChat: true,
			},
			models: [{
				id: modelId,
				revision: createAgentModelDescriptorRevision('model-revision-1'),
				displayName: 'Comet Model',
				enabled: true,
				toolSchemaProfiles: [createAgentToolSchemaProfileId('comet.tools')],
				attachments: {
					carriers: ['inline', 'reference'],
					shapes: ['blob', 'tree'],
					mediaTypes: ['text/plain', 'image/png'],
					maximumCount: 16,
					maximumItemBytes: 1_000_000,
					maximumTotalBytes: 4_000_000,
					maximumTreeDepth: 8,
					maximumTreeEntries: 1_000,
					supportsClientContentForBackgroundExecution: true,
				},
			}],
			authenticationRequired: false,
		}],
		sessionTypes: [{
			id: sessionType,
			packageId,
			agentId,
			displayName: { kind: 'literal', value: 'Comet Session' },
			description: { kind: 'literal', value: 'Comet Session type' },
			capabilities: {
				workspace: 'optional',
				supportsEmptySession: true,
				supportsInitialTurn: true,
				supportsCreateChat: true,
				maximumChatCount: 5,
				supportsForkChat: true,
			},
			models: [modelId],
			executionPresets: [{
				id: automaticPreset,
				displayName: { kind: 'literal', value: 'Automatic' },
				model: modelId,
			}],
			automaticExecutionPreset: automaticPreset,
			toolPolicy: { kind: 'all' },
		}],
	};
}

function createChatState(
	session: AgentSessionId,
	id: string,
	title: string,
	overrides: Partial<IAgentHostChatState> = {},
): IAgentHostChatState {
	const chat = createAgentChatId(id);
	return {
		id: chat,
		createdAt: 10,
		title,
		origin: { kind: 'user' },
		model: modelId,
		lifecycle: 'available',
		interactivity: 'full',
		status: 'completed',
		isRead: true,
		capabilities: {
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: true,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: true,
			supportsCancel: true,
		},
		modifiedAt: 11,
		session,
		turns: [],
		...overrides,
	};
}

function toChatSummary(chat: IAgentHostChatState): IAgentHostSessionState['chats'][number] {
	return {
		id: chat.id,
		createdAt: chat.createdAt,
		title: chat.title,
		origin: chat.origin,
		model: chat.model,
		lifecycle: chat.lifecycle,
		interactivity: chat.interactivity,
		status: chat.status,
		isRead: chat.isRead,
		capabilities: chat.capabilities,
		modifiedAt: chat.modifiedAt,
	};
}

function createSessionState(
	id: string,
	title: string,
	chats: readonly IAgentHostChatState[],
	overrides: Partial<IAgentHostSessionState> = {},
): IAgentHostSessionState {
	return {
		id: createAgentSessionId(id),
		packageId,
		agentId,
		type: sessionType,
		createdAt: 1,
		title,
		archived: false,
		lifecycle: 'available',
		status: 'completed',
		isRead: true,
		modifiedAt: 2,
		capabilities: {
			supportsCreateChat: true,
			maximumChatCount: 5,
			supportsFork: true,
			supportsRename: true,
			supportsArchive: true,
			supportsDelete: true,
			supportsChanges: true,
			supportsModels: true,
		},
		changes: [],
		chats: chats.map(toChatSummary),
		...overrides,
	};
}

function toSessionSummary(session: IAgentHostSessionState): IAgentHostSessionCatalogState['sessions'][number] {
	return {
		id: session.id,
		packageId: session.packageId,
		agentId: session.agentId,
		type: session.type,
		createdAt: session.createdAt,
		title: session.title,
		archived: session.archived,
		lifecycle: session.lifecycle,
		status: session.status,
		isRead: session.isRead,
		modifiedAt: session.modifiedAt,
	};
}

class TestAgentHostConnection implements IAgentHostConnection {
	readonly authority = authority;
	readonly connection = createAgentHostClientConnectionId('test-connection');
	private readonly actionEmitter = new Emitter<AgentHostChannelAction>();
	readonly onDidReceiveAction = this.actionEmitter.event;
	root = createRootState();
	readonly sessions = new Map<AgentSessionId, IAgentHostSessionState>();
	catalog: IAgentHostSessionCatalogState = { sessions: [] };
	sequence = 1;
	readonly revisions = new Map<AgentHostChannelId, number>();
	readonly activeSubscriptions = new Set<AgentHostChannelId>();
	readonly setSubscriptionsRequests: IAgentHostSetSubscriptionsRequest[] = [];
	readonly reconnectRequests: IAgentHostReconnectRequest[] = [];
	readonly mutationRequests: IAgentHostMutationRequest[] = [];
	reconnectResult: AgentHostReconnectResult | undefined;
	prepare: (request: IAgentHostPrepareSubmissionRequest) => ReturnType<IAgentHostConnection['prepareSubmission']> = async () => ({
		kind: 'rejected',
		failure: {
			code: AgentHostOperationFailureCode.InvalidPayload,
			message: 'Preparation is not configured.',
			reconciliation: 'terminal',
		},
	});
	mutateRequest: (request: IAgentHostMutationRequest) => Promise<AgentHostMutationOutcome> = async () => {
		throw new Error('Mutation is not configured.');
	};
	operationOutcome: (request: IAgentHostOperationOutcomeRequest) => Promise<AgentHostMutationOutcome> = async () => ({ kind: 'unknown' });

	constructor(sessions: readonly IAgentHostSessionState[] = []) {
		this.replaceSessions(sessions);
	}

	replaceSessions(sessions: readonly IAgentHostSessionState[]): void {
		this.sessions.clear();
		for (const session of sessions) {
			this.sessions.set(session.id, session);
		}
		this.catalog = { sessions: sessions.map(toSessionSummary) };
	}

	setRevision(channel: AgentHostChannelId, revision: number): void {
		this.revisions.set(channel, revision);
	}

	async initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		assert.deepStrictEqual(request.subscriptions, [getAgentHostRootChannelId(), getAgentHostSessionsChannelId()]);
		this.replaceActiveSubscriptions(request.subscriptions);
		return {
			protocolVersion: createAgentHostProtocolVersion('1'),
			capabilities: [],
			implementation: { name: 'test-host', build: '1' },
			hostSequence: createAgentHostSequence(this.sequence),
			snapshots: request.subscriptions.map(channel => this.snapshot(channel)!),
			missingChannels: [],
		};
	}

	async reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		this.reconnectRequests.push(request);
		if (this.reconnectResult === undefined) {
			throw new Error('Reconnect is not configured.');
		}
		const missing = new Set(this.reconnectResult.missingChannels.map(item => item.channel));
		this.replaceActiveSubscriptions(request.subscriptions.filter(channel => !missing.has(channel)));
		return this.reconnectResult;
	}

	async setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		this.setSubscriptionsRequests.push(request);
		const snapshots: AgentHostChannelSnapshot[] = [];
		const missingChannels: IAgentHostSetSubscriptionsResult['missingChannels'][number][] = [];
		for (const channel of request.subscriptions) {
			const snapshot = this.snapshot(channel);
			if (snapshot) {
				snapshots.push(snapshot);
			} else {
				missingChannels.push({ channel, reason: 'notFound' });
			}
		}
		this.replaceActiveSubscriptions(snapshots.map(snapshot => snapshot.channel));
		return {
			hostSequence: createAgentHostSequence(this.sequence),
			snapshots,
			missingChannels,
		};
	}

	prepareSubmission(request: IAgentHostPrepareSubmissionRequest): ReturnType<IAgentHostConnection['prepareSubmission']> {
		return this.prepare(request);
	}

	async mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		this.mutationRequests.push(request);
		return this.mutateRequest(request);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		return this.operationOutcome(request);
	}

	executePackageOperation(_request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		return Promise.resolve({ kind: 'unknown' });
	}

	getPackageOperationOutcome(_request: IAgentPackageOperationOutcomeRequest): Promise<AgentPackageOperationOutcome> {
		return Promise.resolve({ kind: 'unknown' });
	}

	emitSessionState(state: IAgentHostSessionState, revision: number, digestCharacter: string): AgentHostChannelAction {
		this.sessions.set(state.id, state);
		this.catalog = { sessions: [...this.sessions.values()].map(toSessionSummary) };
		this.sequence++;
		const channel = getAgentHostSessionChannelId(state.id);
		this.setRevision(channel, revision);
		const action: AgentHostChannelAction = {
			channel,
			kind: 'session',
			hostSequence: createAgentHostSequence(this.sequence),
			revision: createAgentHostChannelRevision(revision),
			digest: createAgentHostActionDigest(`sha256:${digestCharacter.repeat(64)}`),
			cause: { kind: 'host' },
			action: { kind: 'sessionStateChanged', state },
		};
		if (this.activeSubscriptions.has(channel)) {
			this.actionEmitter.fire(action);
		}
		return action;
	}

	emit(action: AgentHostChannelAction): void {
		if (this.activeSubscriptions.has(action.channel)) {
			this.actionEmitter.fire(action);
		}
	}

	dispose(): void {
		this.actionEmitter.dispose();
	}

	private replaceActiveSubscriptions(subscriptions: readonly AgentHostChannelId[]): void {
		this.activeSubscriptions.clear();
		for (const channel of subscriptions) {
			this.activeSubscriptions.add(channel);
		}
	}

	snapshot(channel: AgentHostChannelId): AgentHostChannelSnapshot | undefined {
		const revision = createAgentHostChannelRevision(this.revisions.get(channel) ?? 1);
		const hostSequence = createAgentHostSequence(this.sequence);
		if (channel === getAgentHostRootChannelId()) {
			return { channel, kind: 'root', hostSequence, revision, state: this.root };
		}
		if (channel === getAgentHostSessionsChannelId()) {
			return { channel, kind: 'sessions', hostSequence, revision, state: this.catalog };
		}
		for (const session of this.sessions.values()) {
			if (channel === getAgentHostSessionChannelId(session.id)) {
				return { channel, kind: 'session', hostSequence, revision, state: session };
			}
			for (const summary of session.chats) {
				if (channel === getAgentHostChatChannelId(session.id, summary.id)) {
					const chat = (session as IAgentHostSessionState & { readonly fullChats?: readonly IAgentHostChatState[] }).fullChats
						?.find(candidate => candidate.id === summary.id);
					if (!chat) {
						throw new Error(`Test Session '${session.id}' has no full Chat '${summary.id}'.`);
					}
					return { channel, kind: 'chat', hostSequence, revision, state: chat };
				}
			}
		}
		return undefined;
	}
}

type TestSessionState = IAgentHostSessionState & { readonly fullChats: readonly IAgentHostChatState[] };

function withFullChats(state: IAgentHostSessionState, chats: readonly IAgentHostChatState[]): TestSessionState {
	return Object.assign(state, { fullChats: chats });
}

function createFixture(sessions: readonly IAgentHostSessionState[] = []) {
	const connection = new TestAgentHostConnection(sessions);
	const chatService = new ChatService(createTestChatStorageService());
	return { connection, chatService };
}

async function createProvider(connection: TestAgentHostConnection, chatService: ChatService): Promise<AgentHostSessionsProvider> {
	return AgentHostSessionsProvider.create(connection, chatService, {
		locale: 'en',
		resolveDisplayText: displayText => {
			if (displayText.kind !== 'literal') {
				throw new Error(`Unexpected localized display text '${displayText.key}'.`);
			}
			return displayText.value;
		},
		implementation: { name: 'comet-test', build: '1' },
	});
}

function waitForSessionsChange(provider: AgentHostSessionsProvider) {
	return new Promise<Parameters<Parameters<typeof provider.onDidChangeSessions>[0]>[0]>(resolve => {
		const disposable = provider.onDidChangeSessions(event => {
			disposable.dispose();
			resolve(event);
		});
	});
}

suite('AgentHostSessionsProvider', { concurrency: false }, () => {
	test('reprojects provider, Session type, draft, and preset display across consecutive locale changes without changing identity', async () => {
		const { connection, chatService } = createFixture();
		connection.root = {
			...connection.root,
			label: { kind: 'localized', key: 'agentHost.local.label' },
			sessionTypes: connection.root.sessionTypes.map(descriptor => ({
				...descriptor,
				displayName: { kind: 'localized', key: 'agentHost.cometSession.displayName' },
				description: { kind: 'localized', key: 'agentHost.cometSession.description' },
				executionPresets: descriptor.executionPresets.map(preset => ({
					...preset,
					displayName: { kind: 'localized', key: 'agentHost.executionPreset.automatic' },
				})),
			})),
		};
		const localized = {
			en: {
				'agentHost.local.label': 'Local',
				'agentHost.cometSession.displayName': 'Comet Session',
				'agentHost.cometSession.description': 'General Agent session',
				'agentHost.executionPreset.automatic': 'Automatic',
			},
			zh: {
				'agentHost.local.label': '本地',
				'agentHost.cometSession.displayName': '智能体会话',
				'agentHost.cometSession.description': '通用智能体会话',
				'agentHost.executionPreset.automatic': '自动',
			},
		} as const;
		let locale: keyof typeof localized = 'en';
		const resolveDisplayText = (displayText: Parameters<typeof resolveAgentHostDisplayText>[0]) => (
			resolveAgentHostDisplayText(displayText, localized[locale])
		);
		const provider = await AgentHostSessionsProvider.create(connection, chatService, {
			locale,
			resolveDisplayText,
			implementation: { name: 'comet-test', build: '1' },
		});
		try {
			const providerId = provider.id;
			const projectedTypeId = provider.sessionTypes[0].id;
			const draft = provider.createSessionDraft({
				sessionType,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			});
			assert.equal(provider.label, 'Local');
			assert.equal(provider.sessionTypes[0].label, 'Comet Session');
			assert.equal(draft.title.get(), 'Comet Session');
			assert.equal(resolveDisplayText(connection.root.sessionTypes[0].executionPresets[0].displayName), 'Automatic');

			let presentationChanges = 0;
			provider.onDidChangeSessionTypes(() => presentationChanges++);
			locale = 'zh';
			provider.refreshLocalizedPresentation();
			assert.equal(provider.label, '本地');
			assert.equal(provider.sessionTypes[0].label, '智能体会话');
			assert.equal(draft.title.get(), '智能体会话');
			assert.equal(resolveDisplayText(connection.root.sessionTypes[0].executionPresets[0].displayName), '自动');

			locale = 'en';
			provider.refreshLocalizedPresentation();
			assert.equal(provider.label, 'Local');
			assert.equal(provider.sessionTypes[0].label, 'Comet Session');
			assert.equal(draft.title.get(), 'Comet Session');
			assert.equal(presentationChanges, 2);
			assert.equal(provider.id, providerId);
			assert.equal(provider.sessionTypes[0].id, projectedTypeId);
			assert.equal(provider.getSessions().length, 0);
		} finally {
			provider.dispose();
		}
	});

	test('projects ordered zero-to-many Chats without a privileged or fallback Chat', async () => {
		const empty = withFullChats(createSessionState('empty-session', 'Empty', []), []);
		const fullSessionId = createAgentSessionId('full-session');
		const first = createChatState(fullSessionId, 'chat-one', 'First');
		const second = createChatState(fullSessionId, 'chat-two', 'Second', {
			origin: { kind: 'fork', parentChat: first.id, parentTurn: createAgentTurnId('turn-parent') },
			lifecycle: 'released',
		});
		const full = withFullChats(createSessionState('full-session', 'Full', [first, second]), [first, second]);
		const { connection, chatService } = createFixture([empty, full]);
		const provider = await createProvider(connection, chatService);
		try {
			const sessions = provider.getSessions();
			assert.equal(sessions.length, 2);
			assert.deepStrictEqual(sessions[0]!.chats.get(), []);
			const chats = sessions[1]!.chats.get();
			assert.equal(chats.length, 2);
			assert.equal(chats[0]!.origin.kind, ChatOriginKind.User);
			assert.equal(chats[1]!.origin.kind, ChatOriginKind.Fork);
			assert.equal(
				chats[1]!.origin.kind === ChatOriginKind.Fork
					? chats[1]!.origin.parentChat.toString()
					: undefined,
				chats[0]!.resource.toString(),
			);
			assert.equal(chats[1]!.interactivity.get(), ChatInteractivity.ReadOnly);
		} finally {
			provider.dispose();
		}
	});

	test('applies contiguous actions once and requires a fresh exact snapshot after a gap', async () => {
		const initial = withFullChats(createSessionState('action-session', 'Initial', []), []);
		const { connection, chatService } = createFixture([initial]);
		connection.setRevision(getAgentHostSessionChannelId(initial.id), 1);
		const provider = await createProvider(connection, chatService);
		try {
			let changes = 0;
			provider.onDidChangeSessions(() => changes++);
			const contiguous = withFullChats({ ...initial, title: 'Contiguous', modifiedAt: 3 }, []);
			const firstChange = waitForSessionsChange(provider);
			const action = connection.emitSessionState(contiguous, 2, 'b');
			await firstChange;
			assert.equal(provider.getSessions()[0].title.get(), 'Contiguous');
			assert.equal(changes, 1);

			connection.emit(action);
			const gapped = withFullChats({ ...contiguous, title: 'Fresh snapshot', modifiedAt: 4 }, []);
			const gapChange = waitForSessionsChange(provider);
			connection.emitSessionState(gapped, 4, 'c');
			await gapChange;
			assert.equal(provider.getSessions()[0].title.get(), 'Fresh snapshot');
			assert.equal(changes, 2);
		} finally {
			provider.dispose();
		}
	});

	test('applies a strict reconnect replay before synchronizing the exact topology', async () => {
		const initial = withFullChats(createSessionState('replay-session', 'Initial', []), []);
		const { connection, chatService } = createFixture([initial]);
		const sessionChannel = getAgentHostSessionChannelId(initial.id);
		connection.setRevision(sessionChannel, 1);
		const provider = await createProvider(connection, chatService);
		try {
			const replayed = withFullChats({ ...initial, title: 'Replayed', modifiedAt: 3 }, []);
			connection.replaceSessions([replayed]);
			connection.sequence = 2;
			connection.setRevision(sessionChannel, 2);
			connection.reconnectResult = {
				kind: 'replay',
				fromHostSequence: createAgentHostSequence(1),
				throughHostSequence: createAgentHostSequence(2),
				actions: [{
					channel: sessionChannel,
					kind: 'session',
					hostSequence: createAgentHostSequence(2),
					revision: createAgentHostChannelRevision(2),
					digest: createAgentHostActionDigest(`sha256:${'e'.repeat(64)}`),
					cause: { kind: 'host' },
					action: { kind: 'sessionStateChanged', state: replayed },
				}],
				missingChannels: [],
			};

			await provider.recoverConnection();
			assert.equal(provider.getSessions()[0].title.get(), 'Replayed');
			assert.deepStrictEqual(connection.reconnectRequests[0].subscriptions, [
				getAgentHostRootChannelId(),
				getAgentHostSessionsChannelId(),
				sessionChannel,
			]);
		} finally {
			provider.dispose();
		}
	});

	test('rejects a reconnect replay gap without requesting a replacement snapshot', async () => {
		const initial = withFullChats(createSessionState('replay-gap-session', 'Initial', []), []);
		const { connection, chatService } = createFixture([initial]);
		const sessionChannel = getAgentHostSessionChannelId(initial.id);
		connection.setRevision(sessionChannel, 1);
		const provider = await createProvider(connection, chatService);
		try {
			const gapped = withFullChats({ ...initial, title: 'Must not apply', modifiedAt: 3 }, []);
			connection.replaceSessions([gapped]);
			connection.sequence = 2;
			connection.setRevision(sessionChannel, 3);
			connection.reconnectResult = {
				kind: 'replay',
				fromHostSequence: createAgentHostSequence(1),
				throughHostSequence: createAgentHostSequence(2),
				actions: [{
					channel: sessionChannel,
					kind: 'session',
					hostSequence: createAgentHostSequence(2),
					revision: createAgentHostChannelRevision(3),
					digest: createAgentHostActionDigest(`sha256:${'f'.repeat(64)}`),
					cause: { kind: 'host' },
					action: { kind: 'sessionStateChanged', state: gapped },
				}],
				missingChannels: [],
			};
			const subscriptionRequestCount = connection.setSubscriptionsRequests.length;

			await assert.rejects(provider.recoverConnection(), /reconnect replay is not contiguous/);
			assert.equal(connection.setSubscriptionsRequests.length, subscriptionRequestCount);
			assert.throws(() => provider.getSessions(), /is disposed/);
		} finally {
			provider.dispose();
		}
	});

	test('drops reconnect snapshot missing channels, reducers, subscriptions, and Chat models', async () => {
		const sessionId = createAgentSessionId('snapshot-session');
		const first = createChatState(sessionId, 'first-chat', 'First');
		const second = createChatState(sessionId, 'second-chat', 'Second');
		const initial = withFullChats(createSessionState('snapshot-session', 'Snapshot', [first, second]), [first, second]);
		const { connection, chatService } = createFixture([initial]);
		const provider = await createProvider(connection, chatService);
		const firstResource = provider.getSessions()[0].chats.get()[0].resource;
		try {
			const retained = withFullChats(createSessionState('snapshot-session', 'Snapshot', [second]), [second]);
			connection.replaceSessions([retained]);
			connection.sequence = 4;
			connection.setRevision(getAgentHostSessionsChannelId(), 2);
			connection.setRevision(getAgentHostSessionChannelId(sessionId), 2);
			connection.setRevision(getAgentHostChatChannelId(sessionId, second.id), 2);
			const firstChannel = getAgentHostChatChannelId(sessionId, first.id);
			const retainedChannels = [
				getAgentHostRootChannelId(),
				getAgentHostSessionsChannelId(),
				getAgentHostSessionChannelId(sessionId),
				getAgentHostChatChannelId(sessionId, second.id),
			];
			connection.reconnectResult = {
				kind: 'snapshots',
				hostSequence: createAgentHostSequence(4),
				snapshots: retainedChannels.map(channel => connection.snapshot(channel)!),
				missingChannels: [{ channel: firstChannel, reason: 'deleted' }],
			};

			await provider.recoverConnection();
			assert.equal(provider.getSessions()[0].chats.get().length, 1);
			assert.equal(provider.getSessions()[0].chats.get()[0].title.get(), 'Second');
			assert.equal(connection.reconnectRequests[0].subscriptions.includes(firstChannel), true);
			assert.deepStrictEqual([...connection.activeSubscriptions], retainedChannels);
			assert.throws(() => chatService.acquireModel(firstResource), /does not exist/);
		} finally {
			provider.dispose();
		}
	});

	test('drops an ordinary subscription missing channel while refreshing after deletion', async () => {
		const sessionId = createAgentSessionId('ordinary-missing-session');
		const first = createChatState(sessionId, 'first-chat', 'First');
		const second = createChatState(sessionId, 'second-chat', 'Second');
		const initial = withFullChats(createSessionState('ordinary-missing-session', 'Ordinary', [first, second]), [first, second]);
		const { connection, chatService } = createFixture([initial]);
		const provider = await createProvider(connection, chatService);
		const session = provider.getSessions()[0];
		const firstModel = session.chats.get()[0];
		const firstChannel = getAgentHostChatChannelId(sessionId, first.id);
		connection.mutateRequest = async request => {
			assert.equal(request.payload.kind, 'deleteChat');
			const retained = withFullChats(createSessionState('ordinary-missing-session', 'Ordinary', [second]), [second]);
			connection.sequence++;
			connection.replaceSessions([retained]);
			connection.setRevision(getAgentHostSessionsChannelId(), 2);
			connection.setRevision(getAgentHostSessionChannelId(sessionId), 2);
			return {
				kind: 'succeeded',
				result: {
					kind: 'deleteChat',
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(connection.sequence),
					revisions: [],
					session: sessionId,
					chat: first.id,
				},
			};
		};
		try {
			await provider.deleteChat(session, firstModel);
			assert.equal(provider.getSessions()[0].chats.get().length, 1);
			assert.equal(connection.activeSubscriptions.has(firstChannel), false);
			assert.equal(
				connection.setSubscriptionsRequests.some(request => request.subscriptions.includes(firstChannel)),
				true,
			);
			assert.throws(() => chatService.acquireModel(firstModel.resource), /does not exist/);
		} finally {
			provider.dispose();
		}
	});

	test('preserves a rejected draft composer and atomically replaces it after Host acceptance', async () => {
		const { connection, chatService } = createFixture();
		const provider = await createProvider(connection, chatService);
		try {
			const draft = provider.createSessionDraft({
				sessionType,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			});
			const draftChat = draft.chats.get()[0];
			chatService.setInput(draftChat.resource, 'immutable prompt');
			await assert.rejects(provider.sendRequest(draft, draftChat), /Preparation is not configured/);
			const preserved = chatService.acquireModel(draftChat.resource);
			assert.equal(preserved.object.getSnapshot().input, 'immutable prompt');
			preserved.dispose();

			connection.prepare = async request => {
				const runtimeRegistration = createAgentRuntimeRegistrationRevision('runtime-1');
				const agentDescriptor = createAgentDescriptorRevision('agent-revision-1');
				const modelDescriptor = createAgentModelDescriptorRevision('model-revision-1');
				return {
				kind: 'prepared',
				submission: {
					submission: request.submission,
					payloadDigest,
					message: request.capture.message,
					attachments: request.capture.attachments,
					interactionTargets: request.capture.interactionTargets,
					executionProfile: {
						revision: createAgentExecutionProfileRevision('profile-1'),
						digest: createAgentExecutionProfileDigest(`sha256:${'d'.repeat(64)}`),
						agentDescriptor,
						modelDescriptor,
						data: '{}',
					},
					runtimeRegistration,
					toolSet: {
						revision: createAgentToolSetRevision('tools-1'),
						schemaProfile: createAgentToolSchemaProfileId('comet.tools'),
						runtimeRegistration,
						agentDescriptor,
						modelDescriptor,
						registrations: [],
					},
					requestedDeadline: 100,
					outputConstraints: {},
				},
				};
			};
			connection.mutateRequest = async request => {
				assert.equal(request.payload.kind, 'createSession');
				if (request.payload.kind !== 'createSession') {
					throw new Error('Expected createSession.');
				}
				assert.equal(request.payload.chats.length, 1);
				assert.equal(request.payload.chats[0].initialSubmission?.message, 'immutable prompt');
				const sessionId = createAgentSessionId('committed-session');
				const chat = createChatState(sessionId, 'committed-chat', 'Committed', {
					turns: [{
						id: createAgentTurnId('committed-turn'),
						submission: request.payload.chats[0].initialSubmission!.submission,
						payloadDigest: request.payload.chats[0].initialSubmission!.payloadDigest,
						state: 'completed',
						user: { text: 'immutable prompt', attachments: [], interactionTargets: [] },
						response: [{ kind: 'text', text: 'answer' }],
					}],
				});
				const session = withFullChats(createSessionState('committed-session', 'Committed', [chat]), [chat]);
				connection.sequence++;
				connection.replaceSessions([session]);
				return {
					kind: 'succeeded',
					result: {
						kind: 'createSession',
						operation: request.operation,
						digest: request.digest,
						hostSequence: createAgentHostSequence(connection.sequence),
						revisions: [],
						session: sessionId,
						chats: [{
							chat: chat.id,
							turn: chat.turns[0].id,
							submission: chat.turns[0].submission,
						}],
					},
				};
			};
			const changed = waitForSessionsChange(provider);
			await provider.sendRequest(draft, draftChat);
			const event = await changed;
			assert.deepStrictEqual(event.transitions.map(transition => transition.kind), [SessionTransitionKind.Replaced]);
			assert.equal(connection.mutationRequests.length, 1);
			assert.equal(provider.getSessions().length, 1);
			assert.equal(provider.getSessions()[0].chats.get().length, 1);
			assert.throws(() => chatService.acquireModel(draftChat.resource), /does not exist/);
		} finally {
			provider.dispose();
		}
	});

	test('resends an explicitly unknown mutation with the same operation identity and digest', async () => {
		const sessionId = createAgentSessionId('retry-session');
		const chat = createChatState(sessionId, 'retry-chat', 'Retry Chat');
		const initial = withFullChats(createSessionState('retry-session', 'Before', [chat]), [chat]);
		const { connection, chatService } = createFixture([initial]);
		let attempt = 0;
		connection.mutateRequest = async request => {
			attempt++;
			if (attempt === 1) {
				return { kind: 'unknown' };
			}
			const renamed = withFullChats({ ...initial, title: 'After', modifiedAt: 5 }, [chat]);
			connection.sequence++;
			connection.replaceSessions([renamed]);
			return {
				kind: 'succeeded',
				result: {
					kind: 'renameSession',
					operation: request.operation,
					digest: request.digest,
					hostSequence: createAgentHostSequence(connection.sequence),
					revisions: [],
					session: sessionId,
				},
			};
		};
		const provider = await createProvider(connection, chatService);
		const chatResource = provider.getSessions()[0].chats.get()[0].resource;
		try {
			await provider.renameSession(provider.getSessions()[0], 'After');
			assert.equal(connection.mutationRequests.length, 2);
			assert.equal(connection.mutationRequests[0].operation, connection.mutationRequests[1].operation);
			assert.equal(connection.mutationRequests[0].digest, connection.mutationRequests[1].digest);
			assert.equal(provider.getSessions()[0].title.get(), 'After');
		} finally {
			provider.dispose();
		}
		assert.throws(() => chatService.acquireModel(chatResource), /does not exist/);
	});

	test('routes release, cancellation, and steering to exact Host identities', async () => {
		const sessionId = createAgentSessionId('operation-session');
		const turnId = createAgentTurnId('operation-turn');
		const chat = createChatState(sessionId, 'operation-chat', 'Operations', {
			status: 'running',
			activeTurn: turnId,
			turns: [{
				id: turnId,
				submission: createAgentSubmissionId('operation-submission'),
				payloadDigest,
				state: 'running',
				user: { text: 'prompt', attachments: [], interactionTargets: [] },
				response: [],
			}],
		});
		const initial = withFullChats(createSessionState('operation-session', 'Operations', [chat]), [chat]);
		const { connection, chatService } = createFixture([initial]);
		connection.root = {
			...connection.root,
			agents: connection.root.agents.map(agent => ({
				...agent,
				capabilities: { ...agent.capabilities, supportsSteering: true },
			})),
		};
		connection.mutateRequest = async request => {
			connection.sequence++;
			const commit = {
				operation: request.operation,
				digest: request.digest,
				hostSequence: createAgentHostSequence(connection.sequence),
				revisions: [],
			};
			switch (request.payload.kind) {
				case 'releaseSession':
					return { kind: 'succeeded', result: { ...commit, kind: 'releaseSession', session: request.payload.session } };
				case 'releaseChat':
					return { kind: 'succeeded', result: { ...commit, kind: 'releaseChat', session: request.payload.session, chat: request.payload.chat } };
				case 'cancelTurn':
					return { kind: 'succeeded', result: { ...commit, kind: 'cancelTurn', session: request.payload.session, chat: request.payload.chat, turn: request.payload.turn } };
				case 'steerTurn':
					return { kind: 'succeeded', result: { ...commit, kind: 'steerTurn', session: request.payload.session, chat: request.payload.chat, turn: request.payload.turn } };
				default:
					throw new Error(`Unexpected mutation '${request.payload.kind}'.`);
			}
		};
		const provider = await createProvider(connection, chatService);
		try {
			const session = provider.getSessions()[0];
			const addressedChat = session.chats.get()[0];
			await provider.cancelTurn(session, addressedChat, turnId);
			await provider.steerTurn(session, addressedChat, turnId, ' focus on exact tests ');
			await provider.releaseChat(session, addressedChat);
			await provider.releaseSession(session);

			assert.deepStrictEqual(connection.mutationRequests.map(request => request.payload), [
				{ kind: 'cancelTurn', session: sessionId, chat: chat.id, turn: turnId },
				{ kind: 'steerTurn', session: sessionId, chat: chat.id, turn: turnId, message: 'focus on exact tests' },
				{ kind: 'releaseChat', session: sessionId, chat: chat.id },
				{ kind: 'releaseSession', session: sessionId },
			]);
		} finally {
			provider.dispose();
		}
	});
});
