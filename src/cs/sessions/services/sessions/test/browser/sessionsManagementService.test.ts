/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { observableValue, type ISettableObservable } from 'cs/base/common/observable';
import { ThemeIcon } from 'cs/base/common/themables';
import { URI } from 'cs/base/common/uri';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import {
	StorageScope,
	StorageTarget,
	WillSaveStateReason,
	type IWillSaveStateEvent,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import { SessionsManagementService } from 'cs/sessions/services/sessions/browser/sessionsManagementService';
import { SessionsProvidersService } from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { SessionsRecencyStorage } from 'cs/sessions/services/sessions/browser/sessionsRecencyStorage';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type IChatCapabilities,
	type ISession,
	type ISessionCapabilities,
	type ISessionResolvedWorkspaceState,
	type ISessionType,
	type ISessionWorkspaceState,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import {
	ISessionsManagementService,
	SessionDraftChangeKind,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import {
	maximumSessionChatRequestAttachments,
	maximumSessionChatRequestPayloadBytes,
	SessionTransitionKind,
	type ISessionDraftOptions,
	type ISessionsChangeEvent,
	type ISessionsProvider,
} from 'cs/sessions/services/sessions/common/sessionsProvider';
import {
	ChatRequestAttachmentKind,
	type IChatRequest,
	type IChatRequestAttachment,
} from 'cs/workbench/contrib/chat/common/chatRequest';
import type { ILanguageModelChatMetadataAndIdentifier } from 'cs/workbench/contrib/chat/common/languageModels';

const TestDate = new Date('2026-07-11T00:00:00.000Z');
const WorkspaceLess: ISessionResolvedWorkspaceState = { kind: SessionWorkspaceKind.WorkspaceLess };

const FullSessionCapabilities: ISessionCapabilities = {
	supportsMultipleChats: true,
	supportsFork: true,
	supportsRename: true,
	supportsArchive: true,
	supportsDelete: true,
	supportsChanges: true,
	supportsModels: true,
};

interface IChatFixture {
	readonly model: IChat;
	readonly title: ISettableObservable<string>;
	readonly modelId: ISettableObservable<string | undefined>;
	readonly interactivity: ISettableObservable<ChatInteractivity>;
	readonly capabilities: ISettableObservable<IChatCapabilities>;
}

interface ISessionFixture {
	readonly model: ISession;
	readonly title: ISettableObservable<string>;
	readonly updatedAt: ISettableObservable<Date>;
	readonly status: ISettableObservable<SessionStatus>;
	readonly isArchived: ISettableObservable<boolean>;
	readonly workspace: ISettableObservable<ISessionWorkspaceState>;
	readonly chats: ISettableObservable<readonly IChat[]>;
	readonly capabilities: ISettableObservable<ISessionCapabilities>;
	readonly mainChat: IChatFixture;
}

function createChat(
	resource: URI,
	options: {
		readonly origin?: IChat['origin'];
		readonly interactivity?: ChatInteractivity;
		readonly capabilities?: IChatCapabilities;
	} = {},
): IChatFixture {
	const title = observableValue('chatTitle', resource.path);
	const modelId = observableValue<string | undefined>('chatModelId', undefined);
	const interactivity = observableValue('chatInteractivity', options.interactivity ?? ChatInteractivity.Full);
	const capabilities = observableValue('chatCapabilities', options.capabilities ?? {
		supportsRename: true,
		supportsDelete: true,
	});
	return {
		title,
		modelId,
		interactivity,
		capabilities,
		model: {
			resource,
			createdAt: TestDate,
			title,
			updatedAt: observableValue('chatUpdatedAt', TestDate),
			status: observableValue('chatStatus', SessionStatus.Completed),
			isRead: observableValue('chatIsRead', true),
			modelId,
			interactivity,
			capabilities,
			origin: options.origin,
		},
	};
}

function createSession(
	providerId: string,
	resource: URI,
	options: {
		readonly chatResource?: URI;
		readonly status?: SessionStatus;
		readonly sessionType?: string;
		readonly capabilities?: Partial<ISessionCapabilities>;
		readonly workspace?: ISessionWorkspaceState;
		readonly updatedAt?: Date;
	} = {},
): ISessionFixture {
	const mainChat = createChat(options.chatResource ?? URI.parse(`test-chat:/${providerId}${resource.path}`), {
		capabilities: { supportsRename: true, supportsDelete: false },
	});
	const title = observableValue('sessionTitle', resource.path);
	const updatedAt = observableValue('sessionUpdatedAt', options.updatedAt ?? TestDate);
	const status = observableValue('sessionStatus', options.status ?? SessionStatus.Completed);
	const isArchived = observableValue('sessionIsArchived', false);
	const workspace = observableValue<ISessionWorkspaceState>('sessionWorkspace', options.workspace ?? WorkspaceLess);
	const chats = observableValue<readonly IChat[]>('sessionChats', [mainChat.model]);
	const capabilities = observableValue('sessionCapabilities', {
		...FullSessionCapabilities,
		...options.capabilities,
	});
	return {
		title,
		updatedAt,
		status,
		isArchived,
		workspace,
		chats,
		capabilities,
		mainChat,
		model: {
			sessionId: toSessionId(providerId, resource),
			resource,
			providerId,
			sessionType: options.sessionType ?? `${providerId}.default`,
			createdAt: TestDate,
			title,
			updatedAt,
			status,
			isRead: observableValue('sessionIsRead', true),
			isArchived,
			workspace,
			changes: observableValue('sessionChanges', []),
			mainChat: observableValue('sessionMainChat', mainChat.model),
			chats,
			capabilities,
		},
	};
}

function unexpectedOperation(): never {
	throw new Error('Unexpected Sessions provider operation.');
}

class TestSessionsProvider extends Disposable implements ISessionsProvider {
	readonly label: string;
	readonly sessionTypes: ISessionType[];
	readonly sessions: ISession[] = [];
	readonly models: ILanguageModelChatMetadataAndIdentifier[] = [];

	private readonly sessionTypesEmitter = this._register(new Emitter<void>());
	readonly onDidChangeSessionTypes = this.sessionTypesEmitter.event;
	private readonly sessionsEmitter = this._register(new Emitter<ISessionsChangeEvent>());
	readonly onDidChangeSessions = this.sessionsEmitter.event;
	private readonly modelsEmitter = this._register(new Emitter<void>());
	readonly onDidChangeModels = this.modelsEmitter.event;

	createSessionDraftHandler: (options: ISessionDraftOptions) => ISession = unexpectedOperation;
	discardSessionDraftHandler: (session: ISession) => void = unexpectedOperation;
	sendRequestHandler: (session: ISession, chat: IChat, request: IChatRequest) => Promise<void> = async () => unexpectedOperation();
	createChatHandler: (session: ISession) => Promise<IChat> = async () => unexpectedOperation();
	forkChatHandler: (session: ISession, sourceChat: IChat, turnId: string) => Promise<IChat> = async () => unexpectedOperation();
	renameSessionHandler: (session: ISession, title: string) => Promise<void> = async () => unexpectedOperation();
	renameChatHandler: (session: ISession, chat: IChat, title: string) => Promise<void> = async () => unexpectedOperation();
	setChatModelHandler: (session: ISession, chat: IChat, modelId: string | undefined) => Promise<void> = async () => unexpectedOperation();
	setSessionArchivedHandler: (session: ISession, archived: boolean) => Promise<void> = async () => unexpectedOperation();
	deleteSessionHandler: (session: ISession) => Promise<void> = async () => unexpectedOperation();
	deleteChatHandler: (session: ISession, chat: IChat) => Promise<void> = async () => unexpectedOperation();

	constructor(
		readonly id: string,
		supportsWorkspaceLess = true,
	) {
		super();
		this.label = id;
		this.sessionTypes = [{
			id: `${id}.default`,
			label: id,
			icon: ThemeIcon.fromId('comment'),
			supportsWorkspaceLess,
		}];
	}

	getSessions(): readonly ISession[] {
		return this.sessions;
	}

	getModels(): readonly ILanguageModelChatMetadataAndIdentifier[] {
		return this.models;
	}

	createSessionDraft(options: ISessionDraftOptions): ISession {
		return this.createSessionDraftHandler(options);
	}

	discardSessionDraft(session: ISession): void {
		this.discardSessionDraftHandler(session);
	}

	sendRequest(session: ISession, chat: IChat, request: IChatRequest): Promise<void> {
		return this.sendRequestHandler(session, chat, request);
	}

	createChat(session: ISession): Promise<IChat> {
		return this.createChatHandler(session);
	}

	forkChat(session: ISession, sourceChat: IChat, turnId: string): Promise<IChat> {
		return this.forkChatHandler(session, sourceChat, turnId);
	}

	renameSession(session: ISession, title: string): Promise<void> {
		return this.renameSessionHandler(session, title);
	}

	renameChat(session: ISession, chat: IChat, title: string): Promise<void> {
		return this.renameChatHandler(session, chat, title);
	}

	setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void> {
		return this.setChatModelHandler(session, chat, modelId);
	}

	setSessionArchived(session: ISession, archived: boolean): Promise<void> {
		return this.setSessionArchivedHandler(session, archived);
	}

	deleteSession(session: ISession): Promise<void> {
		return this.deleteSessionHandler(session);
	}

	deleteChat(session: ISession, chat: IChat): Promise<void> {
		return this.deleteChatHandler(session, chat);
	}

	setSessionsAndFire(sessions: readonly ISession[], event: ISessionsChangeEvent): void {
		this.sessions.splice(0, this.sessions.length, ...sessions);
		this.sessionsEmitter.fire(event);
	}

	fireSessionTypesChanged(): void {
		this.sessionTypesEmitter.fire();
	}

	fireModelsChanged(): void {
		this.modelsEmitter.fire();
	}
}

function createStorageService() {
	const values = new Map<string, string>();
	const willSaveStateEmitter = new Emitter<IWillSaveStateEvent>();
	let nextStoreError: Error | undefined;
	const keyFor = (key: string, scope: StorageScope) => `${scope}:${key}`;
	const service = {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: willSaveStateEmitter.event,
		init: async () => {},
		close: async () => {},
		get: (key: string, scope: StorageScope, fallbackValue?: string) =>
			values.get(keyFor(key, scope)) ?? fallbackValue,
		getBoolean: (_key: string, _scope: StorageScope, fallbackValue?: boolean) => fallbackValue,
		getNumber: (_key: string, _scope: StorageScope, fallbackValue?: number) => fallbackValue,
		getObject: <T extends object>(_key: string, _scope: StorageScope, fallbackValue?: T) => fallbackValue,
		store: (key: string, value: string | number | boolean | object | undefined | null, scope: StorageScope, _target: StorageTarget) => {
			if (nextStoreError) {
				const error = nextStoreError;
				nextStoreError = undefined;
				throw error;
			}
			if (typeof value !== 'string') {
				throw new Error('Sessions management tests store only serialized values.');
			}
			values.set(keyFor(key, scope), value);
		},
		storeAll() {},
		remove: (key: string, scope: StorageScope) => values.delete(keyFor(key, scope)),
		keys: (scope: StorageScope, _target: StorageTarget) => [...values.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(`${scope}:`.length)),
		log() {},
		optimize: async () => {},
		flush: async (reason = WillSaveStateReason.NONE) => {
			const joins: Promise<void>[] = [];
			let acceptingJoins = true;
			willSaveStateEmitter.fire({
				reason,
				join(promise) {
					if (!acceptingJoins) {
						throw new Error('Storage save participants must join synchronously.');
					}
					joins.push(promise);
				},
			});
			acceptingJoins = false;
			await Promise.all(joins);
		},
		setRaw: (key: string, value: string) => values.set(keyFor(key, StorageScope.APPLICATION), value),
		getRaw: (key: string) => values.get(keyFor(key, StorageScope.APPLICATION)),
		failNextStore: (error: Error) => {
			nextStoreError = error;
		},
	};
	return service as unknown as IStorageService & {
		readonly setRaw: (key: string, value: string) => void;
		readonly getRaw: (key: string) => string | undefined;
		readonly failNextStore: (error: Error) => void;
	};
}

function getStoredRecencySessionIds(
	storageService: ReturnType<typeof createStorageService>,
): readonly string[] {
	const serialized = storageService.getRaw('sessions.recency');
	assert.ok(serialized);
	return (JSON.parse(serialized) as { readonly sessionIds: readonly string[] }).sessionIds;
}

function createHarness(
	providers: readonly TestSessionsProvider[],
	storageService = createStorageService(),
): {
	readonly store: DisposableStore;
	readonly registry: SessionsProvidersService;
	readonly management: SessionsManagementService;
	readonly storageService: ReturnType<typeof createStorageService>;
} {
	const store = new DisposableStore();
	const registry = store.add(new SessionsProvidersService());
	for (const provider of providers) {
		store.add(provider);
		store.add(registry.registerProvider(provider));
	}
	const management = store.add(new SessionsManagementService(registry, storageService));
	return { store, registry, management, storageService };
}

async function assertRecencyLifecycleSaveFailure(options: {
	readonly provider: TestSessionsProvider;
	readonly initialSessions: readonly ISession[];
	readonly providerSessionsAfterTransition: readonly ISession[];
	readonly event: ISessionsChangeEvent;
	readonly error: Error;
	readonly beforeTransition?: () => void;
}): Promise<void> {
	options.provider.sessions.push(...options.initialSessions);
	const storageService = createStorageService();
	const { store, management } = createHarness([options.provider], storageService);
	await storageService.flush();
	const initialStoredRecency = storageService.getRaw('sessions.recency');
	const publishedTransitions: Array<ISessionsChangeEvent['transitions']> = [];
	store.add(management.onDidChangeSessions(event => publishedTransitions.push(event.transitions)));

	try {
		options.beforeTransition?.();
		options.provider.setSessionsAndFire(options.providerSessionsAfterTransition, options.event);
		assert.deepEqual(options.provider.getSessions(), options.providerSessionsAfterTransition);
		assert.deepEqual(
			new Set(management.getSessions()),
			new Set(options.providerSessionsAfterTransition),
		);
		assert.deepEqual(publishedTransitions, [options.event.transitions]);
		for (const session of options.providerSessionsAfterTransition) {
			assert.equal(management.getSession(session.sessionId), session);
		}
		const nextSessionIds = new Set(options.providerSessionsAfterTransition.map(session => session.sessionId));
		for (const session of options.initialSessions) {
			if (!nextSessionIds.has(session.sessionId)) {
				assert.equal(management.getSession(session.sessionId), undefined);
			}
		}

		storageService.failNextStore(options.error);
		await assert.rejects(
			storageService.flush(),
			error => error === options.error,
		);
		assert.equal(storageService.getRaw('sessions.recency'), initialStoredRecency);
		for (const session of options.providerSessionsAfterTransition) {
			assert.equal(management.getSession(session.sessionId), session);
		}
		await storageService.flush();
		assert.deepEqual(
			getStoredRecencySessionIds(storageService),
			management.getSessions().map(session => session.sessionId),
		);
	} finally {
		store.dispose();
	}
}

function createModel(identifier: string): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier,
		metadata: {
			id: identifier,
			name: identifier,
			vendor: 'test',
			version: '1',
		},
	};
}

test('Sessions management service is registered exactly once', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === ISessionsManagementService);
	assert.equal(registrations.length, 1);
});

test('Sessions management initialization releases earlier provider subscriptions atomically', () => {
	const store = new DisposableStore();
	const registry = store.add(new SessionsProvidersService());
	const firstProvider = store.add(new TestSessionsProvider('provider.first'));
	const secondProvider = store.add(new TestSessionsProvider('provider.second'));
	store.add(registry.registerProvider(firstProvider));
	store.add(registry.registerProvider(secondProvider));

	let activeFirstProviderSubscriptions = 0;
	const firstProviderSessionsEvent = firstProvider.onDidChangeSessions;
	const trackedFirstProviderSessionsEvent: Event<ISessionsChangeEvent> = (listener, thisArgs) => {
		activeFirstProviderSubscriptions += 1;
		const subscription = firstProviderSessionsEvent(listener, thisArgs);
		return toDisposable(() => {
				activeFirstProviderSubscriptions -= 1;
				subscription.dispose();
		});
	};
	Object.defineProperty(firstProvider, 'onDidChangeSessions', {
		configurable: true,
		value: trackedFirstProviderSessionsEvent,
	});

	const subscriptionFailure = new Error('provider subscription failed');
	const failingSecondProviderSessionsEvent: Event<ISessionsChangeEvent> = () => {
		throw subscriptionFailure;
	};
	Object.defineProperty(secondProvider, 'onDidChangeSessions', {
		configurable: true,
		value: failingSecondProviderSessionsEvent,
	});

	try {
		assert.throws(
			() => new SessionsManagementService(registry, createStorageService()),
			(error: unknown) => error === subscriptionFailure,
		);
		assert.equal(activeFirstProviderSubscriptions, 0);

		const participant = registry.registerChangeParticipant({
			prepareProvidersChange: () => ({
				commit: () => {},
				dispose: () => {},
			}),
		});
		participant.dispose();
	} finally {
		store.dispose();
	}
});

test('Sessions management aggregates provider snapshots with provider-aware lookup and global Chat ownership', () => {
	const sharedResource = URI.parse('test-session:/shared');
	const firstProvider = new TestSessionsProvider('provider.first');
	const secondProvider = new TestSessionsProvider('provider.second');
	const first = createSession(firstProvider.id, sharedResource, { chatResource: URI.parse('test-chat:/first') });
	const second = createSession(secondProvider.id, sharedResource, { chatResource: URI.parse('test-chat:/second') });
	firstProvider.sessions.push(first.model);
	secondProvider.sessions.push(second.model);
	const { store, management } = createHarness([firstProvider, secondProvider]);

	try {
		assert.deepEqual(management.getSessions(), [first.model, second.model]);
		assert.equal(management.getSession(first.model.sessionId), first.model);
		assert.equal(management.getSessionByResource(firstProvider.id, sharedResource), first.model);
		assert.equal(management.getSessionByResource(secondProvider.id, sharedResource), second.model);
		assert.deepEqual(management.getSessionForChatResource(second.mainChat.model.resource), {
			session: second.model,
			chat: second.mainChat.model,
		});
		assert.deepEqual(
			management.sessionTypes.get().map(entry => `${entry.providerId}:${entry.sessionType.id}`),
			[
				'provider.first:provider.first.default',
				'provider.second:provider.second.default',
			],
		);
	} finally {
		store.dispose();
	}

	const duplicateChatProvider = new TestSessionsProvider('provider.duplicate');
	const duplicateA = createSession(duplicateChatProvider.id, URI.parse('test-session:/a'), {
		chatResource: URI.parse('test-chat:/duplicate'),
	});
	const duplicateB = createSession(duplicateChatProvider.id, URI.parse('test-session:/b'), {
		chatResource: URI.parse('test-chat:/duplicate'),
	});
	duplicateChatProvider.sessions.push(duplicateA.model, duplicateB.model);
	const registry = new SessionsProvidersService();
	const registration = registry.registerProvider(duplicateChatProvider);
	try {
		assert.throws(
			() => new SessionsManagementService(registry, createStorageService()),
			/Chat resource .* is owned by both Session/,
		);
	} finally {
		registration.dispose();
		duplicateChatProvider.dispose();
		registry.dispose();
	}
});

test('Sessions management persists authoritative cross-provider recency and removes deleted identities', async () => {
	const storageService = createStorageService();
	const olderProvider = new TestSessionsProvider('provider.z-older');
	const newerProvider = new TestSessionsProvider('provider.a-newer');
	const older = createSession(olderProvider.id, URI.parse('test-session:/older'), {
		updatedAt: new Date('2026-07-11T01:00:00.000Z'),
	});
	const newer = createSession(newerProvider.id, URI.parse('test-session:/newer'), {
		updatedAt: new Date('2026-07-11T02:00:00.000Z'),
	});
	olderProvider.sessions.push(older.model);
	newerProvider.sessions.push(newer.model);
	const firstHarness = createHarness([olderProvider, newerProvider], storageService);
	try {
		const initialOrder = firstHarness.management.getSessions();
		assert.deepEqual(initialOrder, [newer.model, older.model]);
		assert.equal(Object.isFrozen(initialOrder), true);
		assert.throws(() => (initialOrder as ISession[]).reverse(), TypeError);
		older.updatedAt.set(new Date('2026-07-11T03:00:00.000Z'), undefined);
		olderProvider.setSessionsAndFire([older.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: older.model }],
		});
		assert.deepEqual(firstHarness.management.getSessions(), [older.model, newer.model]);
		await storageService.flush();
	} finally {
		firstHarness.store.dispose();
	}

	const restoredOlderProvider = new TestSessionsProvider('provider.z-older');
	const restoredNewerProvider = new TestSessionsProvider('provider.a-newer');
	const equalActivity = new Date('2026-07-11T04:00:00.000Z');
	const restoredOlder = createSession(restoredOlderProvider.id, URI.parse('test-session:/older'), {
		updatedAt: equalActivity,
	});
	const restoredNewer = createSession(restoredNewerProvider.id, URI.parse('test-session:/newer'), {
		updatedAt: equalActivity,
	});
	restoredOlderProvider.sessions.push(restoredOlder.model);
	restoredNewerProvider.sessions.push(restoredNewer.model);
	const secondHarness = createHarness(
		[restoredNewerProvider, restoredOlderProvider],
		storageService,
	);
	try {
		assert.deepEqual(secondHarness.management.getSessions(), [restoredOlder.model, restoredNewer.model]);
		restoredOlderProvider.setSessionsAndFire([], {
			transitions: [{ kind: SessionTransitionKind.Removed, session: restoredOlder.model }],
		});
		assert.deepEqual(secondHarness.management.getSessions(), [restoredNewer.model]);
		await storageService.flush();
	} finally {
		secondHarness.store.dispose();
	}

	const finalProvider = new TestSessionsProvider('provider.a-newer');
	const finalSession = createSession(finalProvider.id, URI.parse('test-session:/newer'), {
		updatedAt: equalActivity,
	});
	finalProvider.sessions.push(finalSession.model);
	const finalHarness = createHarness([finalProvider], storageService);
	try {
		assert.deepEqual(finalHarness.management.getSessions(), [finalSession.model]);
	} finally {
		finalHarness.store.dispose();
	}
});

test('Sessions recency updates rank before lifecycle persistence and surfaces save failures', async () => {
	const storageService = createStorageService();
	const recencyStorage = new SessionsRecencyStorage(storageService);
	const first = createSession('provider.recency-rank', URI.parse('test-session:/first')).model;
	const second = createSession('provider.recency-rank', URI.parse('test-session:/second')).model;
	const initialOrder = recencyStorage.update([first, second]);
	assert.equal(storageService.getRaw('sessions.recency'), undefined);
	await storageService.flush();
	const initialStoredRecency = storageService.getRaw('sessions.recency');
	const promotedSession = initialOrder[1];
	const storageError = new Error('Recency rank write failed.');
	const promotedOrder = recencyStorage.update(initialOrder, [promotedSession.sessionId]);
	assert.equal(promotedOrder[0], promotedSession);

	storageService.failNextStore(storageError);
	await assert.rejects(
		storageService.flush(),
		error => error === storageError,
	);
	assert.equal(storageService.getRaw('sessions.recency'), initialStoredRecency);
	assert.deepEqual(recencyStorage.update(initialOrder), promotedOrder);
	await storageService.flush();
	assert.deepEqual(
		getStoredRecencySessionIds(storageService),
		promotedOrder.map(session => session.sessionId),
	);
	recencyStorage.dispose();
});

test('Sessions recency saves the immutable snapshot captured at the lifecycle boundary', async () => {
	const storageService = createStorageService();
	const recencyStorage = new SessionsRecencyStorage(storageService);
	const first = createSession('provider.recency-boundary', URI.parse('test-session:/first')).model;
	const second = createSession('provider.recency-boundary', URI.parse('test-session:/second')).model;

	try {
		recencyStorage.update([first]);
		const firstSave = storageService.flush();
		recencyStorage.update([first, second], [second.sessionId]);
		await firstSave;
		assert.deepEqual(getStoredRecencySessionIds(storageService), [first.sessionId]);

		await storageService.flush();
		assert.deepEqual(getStoredRecencySessionIds(storageService), [second.sessionId, first.sessionId]);
	} finally {
		recencyStorage.dispose();
	}
});

test('Sessions recency defers storage capacity validation to lifecycle save', async () => {
	const storageService = createStorageService();
	const recencyStorage = new SessionsRecencyStorage(storageService);
	const session = createSession(
		'provider.recency-capacity',
		URI.parse(`test-session:/${'x'.repeat(8_192)}`),
	).model;

	try {
		assert.deepEqual(recencyStorage.update([session]), [session]);
		await assert.rejects(
			storageService.flush(),
			/invalid Session ID/,
		);
	} finally {
		recencyStorage.dispose();
	}
});

test('Sessions management remains consistent across recency lifecycle save failures', async () => {
	const addedProvider = new TestSessionsProvider('provider.add-persistence-failure');
	const first = createSession(addedProvider.id, URI.parse('test-session:/first')).model;
	const added = createSession(addedProvider.id, URI.parse('test-session:/added')).model;
	await assertRecencyLifecycleSaveFailure({
		provider: addedProvider,
		initialSessions: [first],
		providerSessionsAfterTransition: [first, added],
		event: { transitions: [{ kind: SessionTransitionKind.Added, session: added }] },
		error: new Error('Added recency write failed.'),
	});

	const replacedProvider = new TestSessionsProvider('provider.replace-persistence-failure');
	const stable = createSession(replacedProvider.id, URI.parse('test-session:/stable')).model;
	const replaced = createSession(replacedProvider.id, URI.parse('test-session:/replaced')).model;
	const replacement = createSession(replacedProvider.id, URI.parse('test-session:/replacement')).model;
	await assertRecencyLifecycleSaveFailure({
		provider: replacedProvider,
		initialSessions: [stable, replaced],
		providerSessionsAfterTransition: [stable, replacement],
		event: {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: replaced, to: replacement }],
		},
		error: new Error('Replacement recency write failed.'),
	});

	const removedProvider = new TestSessionsProvider('provider.remove-persistence-failure');
	const retained = createSession(removedProvider.id, URI.parse('test-session:/retained')).model;
	const removed = createSession(removedProvider.id, URI.parse('test-session:/removed')).model;
	await assertRecencyLifecycleSaveFailure({
		provider: removedProvider,
		initialSessions: [retained, removed],
		providerSessionsAfterTransition: [retained],
		event: { transitions: [{ kind: SessionTransitionKind.Removed, session: removed }] },
		error: new Error('Removal recency write failed.'),
	});

	const changedProvider = new TestSessionsProvider('provider.change-persistence-failure');
	const changedFixture = createSession(changedProvider.id, URI.parse('test-session:/changed'));
	const changed = changedFixture.model;
	await assertRecencyLifecycleSaveFailure({
		provider: changedProvider,
		initialSessions: [changed],
		providerSessionsAfterTransition: [changed],
		event: { transitions: [{ kind: SessionTransitionKind.Changed, session: changed }] },
		error: new Error('Changed recency write failed.'),
		beforeTransition: () => changedFixture.updatedAt.set(
			new Date(changedFixture.updatedAt.get().getTime() + 1_000),
			undefined,
		),
	});
});

test('Sessions management rejects malformed persisted recency atomically', () => {
	const storageService = createStorageService();
	storageService.setRaw('sessions.recency', JSON.stringify({
		version: 1,
		sessionIds: ['duplicate', 'duplicate'],
	}));
	const registry = new SessionsProvidersService();
	try {
		assert.throws(
			() => new SessionsManagementService(registry, storageService),
			/duplicate Session IDs/,
		);
	} finally {
		registry.dispose();
	}
});

test('Sessions management applies provider registration and removal as authoritative lifecycle changes', () => {
	const { store, registry, management } = createHarness([]);
	const provider = store.add(new TestSessionsProvider('provider.dynamic'));
	const session = createSession(provider.id, URI.parse('test-session:/dynamic'));
	provider.sessions.push(session.model);
	const snapshots: Array<{ readonly kinds: readonly SessionTransitionKind[]; readonly sessions: readonly ISession[] }> = [];
	store.add(management.onDidChangeSessions(event => {
		snapshots.push({
			kinds: event.transitions.map(transition => transition.kind),
			sessions: management.sessions.get(),
		});
	}));
	const registration = store.add(registry.registerProvider(provider));

	try {
		assert.deepEqual(management.sessions.get(), [session.model]);
		registration.dispose();
		assert.deepEqual(management.sessions.get(), []);
		assert.deepEqual(snapshots, [
			{ kinds: [SessionTransitionKind.Added], sessions: [session.model] },
			{ kinds: [SessionTransitionKind.Removed], sessions: [] },
		]);

		provider.setSessionsAndFire([], {
			transitions: [{ kind: SessionTransitionKind.Removed, session: session.model }],
		});
		assert.equal(snapshots.length, 2);
	} finally {
		store.dispose();
	}
});

test('Session draft replacement is atomic, explicit, and preserves the complete Chat request', async () => {
	const provider = new TestSessionsProvider('provider.draft');
	const resource = URI.parse('test-session:/draft');
	const draft = createSession(provider.id, resource, {
		chatResource: resource,
		status: SessionStatus.Draft,
	});
	const committed = createSession(provider.id, resource, {
		chatResource: resource,
		status: SessionStatus.Running,
	});
	provider.createSessionDraftHandler = () => draft.model;
	provider.discardSessionDraftHandler = () => {};
	let receivedRequest: IChatRequest | undefined;
	provider.sendRequestHandler = async (_session, _chat, request) => {
		receivedRequest = request;
		provider.setSessionsAndFire([committed.model], {
			transitions: [{
				kind: SessionTransitionKind.Replaced,
				from: draft.model,
				to: committed.model,
			}],
		});
	};
	const { store, management } = createHarness([provider]);
	const replacementSnapshots: Array<{ readonly sessions: readonly ISession[]; readonly draft: ISession | undefined }> = [];
	store.add(management.onDidChangeSessions(() => {
		replacementSnapshots.push({
			sessions: management.sessions.get(),
			draft: management.draftSession.get(),
		});
	}));
	const draftEvents: SessionDraftChangeKind[] = [];
	store.add(management.onDidChangeDraftSession(event => draftEvents.push(event.kind)));
	const attachment: IChatRequestAttachment = {
		kind: ChatRequestAttachmentKind.Text,
		id: 'attachment.text',
		name: 'Evidence',
		content: 'immutable evidence',
		mimeType: 'text/plain',
	};
	const request: IChatRequest = { prompt: 'Start', attachments: [attachment] };

	try {
		assert.equal(management.createSessionDraft(provider.id, {
			sessionType: `${provider.id}.default`,
			workspace: WorkspaceLess,
		}), draft.model);
		await management.sendRequest(draft.model, draft.mainChat.model, request);

		assert.notEqual(receivedRequest, request);
		assert.deepEqual(receivedRequest, request);
		assert.notEqual(receivedRequest.attachments, request.attachments);
		assert.notEqual(receivedRequest.attachments[0], attachment);
		assert.deepEqual(replacementSnapshots, [{ sessions: [committed.model], draft: undefined }]);
		assert.deepEqual(draftEvents, [SessionDraftChangeKind.Created, SessionDraftChangeKind.Replaced]);
		assert.equal(management.draftSession.get(), undefined);
		assert.deepEqual(management.sessions.get(), [committed.model]);
	} finally {
		store.dispose();
	}
});

test('Session drafts require replacement on send and invalid drafts are released', async () => {
	const provider = new TestSessionsProvider('provider.invalid-draft');
	const draft = createSession(provider.id, URI.parse('test-session:/uncommitted'), {
		status: SessionStatus.Draft,
	});
	provider.createSessionDraftHandler = () => draft.model;
	let discardCount = 0;
	provider.discardSessionDraftHandler = () => {
		discardCount += 1;
	};
	provider.sendRequestHandler = async () => {};
	const { store, management } = createHarness([provider]);

	try {
		management.createSessionDraft(provider.id, {
			sessionType: `${provider.id}.default`,
			workspace: WorkspaceLess,
		});
		await assert.rejects(
			management.sendRequest(draft.model, draft.mainChat.model, { prompt: 'Start', attachments: [] }),
			/not explicitly replaced/,
		);
		management.discardSessionDraft(draft.model);
		assert.equal(discardCount, 1);
	} finally {
		store.dispose();
	}

	const invalidProvider = new TestSessionsProvider('provider.bad-draft');
	const invalidDraft = createSession(invalidProvider.id, URI.parse('test-session:/bad'), {
		status: SessionStatus.Running,
	});
	invalidProvider.createSessionDraftHandler = () => invalidDraft.model;
	let invalidDiscardCount = 0;
	invalidProvider.discardSessionDraftHandler = () => {
		invalidDiscardCount += 1;
	};
	const invalidHarness = createHarness([invalidProvider]);
	try {
		assert.throws(
			() => invalidHarness.management.createSessionDraft(invalidProvider.id, {
				sessionType: `${invalidProvider.id}.default`,
				workspace: WorkspaceLess,
			}),
			/not a draft/,
		);
		assert.equal(invalidDiscardCount, 1);
		assert.equal(invalidHarness.management.draftSession.get(), undefined);
	} finally {
		invalidHarness.store.dispose();
	}
});

test('Provider transitions cannot be bypassed by mutable snapshots or inconsistent after-state', () => {
	const provider = new TestSessionsProvider('provider.transitions');
	const first = createSession(provider.id, URI.parse('test-session:/first'));
	const second = createSession(provider.id, URI.parse('test-session:/second'));
	provider.sessions.push(first.model);
	const { store, management } = createHarness([provider]);

	try {
		provider.sessions.push(second.model);
		assert.deepEqual(management.sessions.get(), [first.model]);
		provider.setSessionsAndFire([first.model, second.model], {
			transitions: [{ kind: SessionTransitionKind.Added, session: second.model }],
		});
		assert.deepEqual(management.sessions.get(), [second.model, first.model]);
	} finally {
		store.dispose();
	}

	const inconsistentProvider = new TestSessionsProvider('provider.inconsistent');
	const before = createSession(inconsistentProvider.id, URI.parse('test-session:/before'));
	const after = createSession(inconsistentProvider.id, URI.parse('test-session:/after'));
	inconsistentProvider.sessions.push(before.model);
	const inconsistentHarness = createHarness([inconsistentProvider]);
	try {
		assert.throws(
			() => inconsistentProvider.setSessionsAndFire([before.model], {
				transitions: [{ kind: SessionTransitionKind.Replaced, from: before.model, to: after.model }],
			}),
			/getSessions\(\) does not match its ordered transitions/,
		);
		assert.deepEqual(inconsistentHarness.management.sessions.get(), [before.model]);
	} finally {
		inconsistentHarness.store.dispose();
	}

	const implicitProvider = new TestSessionsProvider('provider.implicit');
	const implicitBefore = createSession(implicitProvider.id, URI.parse('test-session:/same'));
	const implicitAfter = createSession(implicitProvider.id, URI.parse('test-session:/same'), {
		chatResource: URI.parse('test-chat:/replacement'),
	});
	implicitProvider.sessions.push(implicitBefore.model);
	const implicitHarness = createHarness([implicitProvider]);
	try {
		assert.throws(
			() => implicitProvider.setSessionsAndFire([implicitAfter.model], {
				transitions: [
					{ kind: SessionTransitionKind.Removed, session: implicitBefore.model },
					{ kind: SessionTransitionKind.Added, session: implicitAfter.model },
				],
			}),
			/explicit replacement transition/,
		);
	} finally {
		implicitHarness.store.dispose();
	}
});

test('Committed provider snapshots reject Session drafts', () => {
	const provider = new TestSessionsProvider('provider.committed-draft');
	const draft = createSession(provider.id, URI.parse('test-session:/draft-in-collection'), {
		status: SessionStatus.Draft,
	});
	provider.sessions.push(draft.model);
	const registry = new SessionsProvidersService();
	const registration = registry.registerProvider(provider);
	try {
		assert.throws(
			() => new SessionsManagementService(registry, createStorageService()),
			/Committed Session snapshot .* contains a draft/,
		);
	} finally {
		registration.dispose();
		provider.dispose();
		registry.dispose();
	}

	const transitionProvider = new TestSessionsProvider('provider.added-draft');
	const transitionDraft = createSession(transitionProvider.id, URI.parse('test-session:/added-draft'), {
		status: SessionStatus.Draft,
	});
	const harness = createHarness([transitionProvider]);
	try {
		assert.throws(
			() => transitionProvider.setSessionsAndFire([transitionDraft.model], {
				transitions: [{ kind: SessionTransitionKind.Added, session: transitionDraft.model }],
			}),
			/Committed Session snapshot .* contains a draft/,
		);
		assert.deepEqual(harness.management.sessions.get(), []);
	} finally {
		harness.store.dispose();
	}
});

test('Provider Session type snapshots are copied, event-driven, and validate committed Sessions', () => {
	const invalidProvider = new TestSessionsProvider('provider.invalid-type');
	const invalidSession = createSession(invalidProvider.id, URI.parse('test-session:/invalid-type'), {
		sessionType: `${invalidProvider.id}.missing`,
	});
	invalidProvider.sessions.push(invalidSession.model);
	const invalidRegistry = new SessionsProvidersService();
	const invalidRegistration = invalidRegistry.registerProvider(invalidProvider);
	try {
		assert.throws(
			() => new SessionsManagementService(invalidRegistry, createStorageService()),
			/not offered by provider/,
		);
	} finally {
		invalidRegistration.dispose();
		invalidProvider.dispose();
		invalidRegistry.dispose();
	}

	const provider = new TestSessionsProvider('provider.types');
	const { store, management } = createHarness([provider]);
	const additionalType = {
		id: `${provider.id}.additional`,
		label: 'Additional',
		icon: ThemeIcon.fromId('sparkle'),
		supportsWorkspaceLess: true,
	};
	let typeEvents = 0;
	store.add(management.onDidChangeSessionTypes(() => typeEvents += 1));

	try {
		provider.sessionTypes.push(additionalType);
		assert.equal(management.sessionTypes.get().length, 1);
		assert.throws(
			() => management.createSessionDraft(provider.id, {
				sessionType: additionalType.id,
				workspace: WorkspaceLess,
			}),
			/Session types do not match its tracked snapshot/,
		);

		provider.fireSessionTypesChanged();
		assert.deepEqual(
			management.sessionTypes.get().map(entry => entry.sessionType.label),
			[provider.id, 'Additional'],
		);
		assert.equal(typeEvents, 1);
		const additionalDraft = createSession(provider.id, URI.parse('test-session:/additional-draft'), {
			status: SessionStatus.Draft,
			sessionType: additionalType.id,
		});
		provider.createSessionDraftHandler = options => {
			assert.equal(options.sessionType, additionalType.id);
			return additionalDraft.model;
		};
		provider.discardSessionDraftHandler = () => {};
		assert.equal(management.createSessionDraft(provider.id, {
			sessionType: additionalType.id,
			workspace: WorkspaceLess,
		}), additionalDraft.model);
		management.discardSessionDraft(additionalDraft.model);

		additionalType.label = 'Mutated without event';
		assert.deepEqual(
			management.sessionTypes.get().map(entry => entry.sessionType.label),
			[provider.id, 'Additional'],
		);
		assert.throws(
			() => management.createSessionDraft(provider.id, {
				sessionType: additionalType.id,
				workspace: WorkspaceLess,
			}),
			/Session types do not match its tracked snapshot/,
		);
	} finally {
		store.dispose();
	}

	const removalProvider = new TestSessionsProvider('provider.type-removal');
	const currentSession = createSession(removalProvider.id, URI.parse('test-session:/current'));
	removalProvider.sessions.push(currentSession.model);
	const removalHarness = createHarness([removalProvider]);
	try {
		removalProvider.sessionTypes.splice(0, removalProvider.sessionTypes.length, {
			id: `${removalProvider.id}.other`,
			label: 'Other',
			icon: ThemeIcon.fromId('sparkle'),
			supportsWorkspaceLess: true,
		});
		assert.throws(
			() => removalProvider.fireSessionTypesChanged(),
			/not offered by provider/,
		);
		assert.deepEqual(
			removalHarness.management.sessionTypes.get().map(entry => entry.sessionType.id),
			[`${removalProvider.id}.default`],
		);
	} finally {
		removalHarness.store.dispose();
	}
});

test('Sessions management routes required operations and explicit Auto model selection to the owner', async () => {
	const provider = new TestSessionsProvider('provider.routing');
	const session = createSession(provider.id, URI.parse('test-session:/routing'));
	provider.sessions.push(session.model);
	provider.models.push(createModel('model.test'));
	const requests: IChatRequest[] = [];
	provider.sendRequestHandler = async (_session, _chat, request) => {
		requests.push(request);
	};
	provider.renameSessionHandler = async (_session, title) => session.title.set(title, undefined);
	provider.renameChatHandler = async (_session, chat, title) => {
		if (chat === session.mainChat.model) {
			session.mainChat.title.set(title, undefined);
		}
	};
	const selectedModels: Array<string | undefined> = [];
	provider.setChatModelHandler = async (_session, _chat, modelId) => {
		selectedModels.push(modelId);
		session.mainChat.modelId.set(modelId, undefined);
	};
	provider.setSessionArchivedHandler = async (_session, archived) => session.isArchived.set(archived, undefined);
	const { store, management } = createHarness([provider]);
	const modelEvents: string[] = [];
	store.add(management.onDidChangeModels(event => modelEvents.push(event.providerId)));
	const attachment: IChatRequestAttachment = {
		kind: ChatRequestAttachmentKind.Resource,
		id: 'resource',
		name: 'Source',
		resource: URI.parse('file:///source.txt'),
		mimeType: 'text/plain',
	};
	const request: IChatRequest = { prompt: 'Continue', attachments: [attachment] };

	try {
		await management.sendRequest(session.model, session.mainChat.model, request);
		await management.renameSession(session.model, 'Renamed Session');
		await management.renameChat(session.model, session.mainChat.model, 'Renamed Chat');
		assert.deepEqual(management.getModels(session.model, session.mainChat.model), provider.models);
		await management.setChatModel(session.model, session.mainChat.model, 'model.test');
		await management.setChatModel(session.model, session.mainChat.model, undefined);
		await management.setSessionArchived(session.model, true);
		provider.fireModelsChanged();

		assert.notEqual(requests[0], request);
		assert.equal(requests[0].prompt, request.prompt);
		const receivedAttachment = requests[0].attachments[0];
		assert.notEqual(receivedAttachment, attachment);
		assert.equal(receivedAttachment.kind, ChatRequestAttachmentKind.Resource);
		if (receivedAttachment.kind !== ChatRequestAttachmentKind.Resource
			|| attachment.kind !== ChatRequestAttachmentKind.Resource) {
			throw new Error('Expected a resource attachment snapshot.');
		}
		assert.equal(receivedAttachment.resource.toString(), attachment.resource.toString());
		assert.deepEqual(selectedModels, ['model.test', undefined]);
		assert.deepEqual(modelEvents, [provider.id]);
		assert.equal(session.title.get(), 'Renamed Session');
		assert.equal(session.mainChat.title.get(), 'Renamed Chat');
		assert.equal(session.isArchived.get(), true);
	} finally {
		store.dispose();
	}
});

test('Sessions management rejects duplicate, excessive, and oversized Chat request attachments', async () => {
	const provider = new TestSessionsProvider('provider.request-limits');
	const session = createSession(provider.id, URI.parse('test-session:/request-limits'));
	provider.sessions.push(session.model);
	provider.sendRequestHandler = async () => {};
	const { store, management } = createHarness([provider]);
	const createTextAttachment = (id: string, content = 'text'): IChatRequestAttachment => ({
		kind: ChatRequestAttachmentKind.Text,
		id,
		name: id,
		content,
		mimeType: 'text/plain',
	});

	try {
		await assert.rejects(
			management.sendRequest(session.model, session.mainChat.model, {
				prompt: 'Ask',
				attachments: [createTextAttachment('duplicate'), createTextAttachment('duplicate')],
			}),
			/duplicated/,
		);
		await assert.rejects(
			management.sendRequest(session.model, session.mainChat.model, {
				prompt: 'Ask',
				attachments: Array.from(
					{ length: maximumSessionChatRequestAttachments + 1 },
					(_, index) => createTextAttachment(`attachment-${index}`),
				),
			}),
			/more than/,
		);
		await assert.rejects(
			management.sendRequest(session.model, session.mainChat.model, {
				prompt: 'Ask',
				attachments: [createTextAttachment(
					'oversized',
					'x'.repeat(maximumSessionChatRequestPayloadBytes),
				)],
			}),
			/serialized bytes/,
		);
	} finally {
		store.dispose();
	}
});

test('Sessions management dispatches an immutable request snapshot across an asynchronous provider call', async () => {
	const provider = new TestSessionsProvider('provider.request-snapshot');
	const session = createSession(provider.id, URI.parse('test-session:/request-snapshot'));
	provider.sessions.push(session.model);
	let releaseRequest!: () => void;
	const requestGate = new Promise<void>(resolve => releaseRequest = resolve);
	let receivedRequest: IChatRequest | undefined;
	provider.sendRequestHandler = async (_session, _chat, request) => {
		receivedRequest = request;
		await requestGate;
	};
	const { store, management } = createHarness([provider]);
	const document = {
		type: 'doc',
		content: [{
			type: 'paragraph',
			content: [{ type: 'text', text: 'original document' }],
		}],
	};
	const attachment = {
		kind: ChatRequestAttachmentKind.Editor as const,
		id: 'editor',
		name: 'Editor',
		resource: URI.parse('draft:/request-snapshot'),
		document,
		selection: { blockId: 'block-1', startOffset: 0, endOffset: 8 },
	};
	const attachments: IChatRequestAttachment[] = [attachment];
	const request = { prompt: 'Original prompt', attachments };

	try {
		const sendRequest = management.sendRequest(session.model, session.mainChat.model, request);
		request.prompt = 'Mutated prompt';
		document.content[0].content[0].text = 'mutated document';
		attachments.push({
			kind: ChatRequestAttachmentKind.Text,
			id: 'late',
			name: 'Late',
			content: 'late mutation',
			mimeType: 'text/plain',
		});

		assert.ok(receivedRequest);
		assert.equal(receivedRequest.prompt, 'Original prompt');
		assert.equal(receivedRequest.attachments.length, 1);
		const receivedAttachment = receivedRequest.attachments[0];
		assert.equal(receivedAttachment.kind, ChatRequestAttachmentKind.Editor);
		if (receivedAttachment.kind !== ChatRequestAttachmentKind.Editor) {
			throw new Error('Expected an editor attachment snapshot.');
		}
		assert.equal(receivedAttachment.document.content?.[0]?.content?.[0]?.text, 'original document');
		assert.equal(Object.isFrozen(receivedRequest), true);
		assert.equal(Object.isFrozen(receivedRequest.attachments), true);
		assert.equal(Object.isFrozen(receivedAttachment), true);
		assert.equal(Object.isFrozen(receivedAttachment.document), true);
		assert.equal(Object.isFrozen(receivedAttachment.document.content?.[0] ?? {}), true);
		releaseRequest();
		await sendRequest;
	} finally {
		releaseRequest();
		store.dispose();
	}
});

test('Mutation postconditions reject Session or Chat models replaced while awaiting the provider', async () => {
	const provider = new TestSessionsProvider('provider.await-replacement');
	const resource = URI.parse('test-session:/await-replacement');
	const sessions = [
		createSession(provider.id, resource),
		createSession(provider.id, resource),
		createSession(provider.id, resource),
		createSession(provider.id, resource),
		createSession(provider.id, resource),
	];
	provider.sessions.push(sessions[0].model);
	provider.models.push(createModel('model.await'));
	provider.renameSessionHandler = async (current, title) => {
		sessions[0].title.set(title, undefined);
		provider.setSessionsAndFire([sessions[1].model], {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: current, to: sessions[1].model }],
		});
	};
	provider.renameChatHandler = async (current, chat, title) => {
		sessions[1].mainChat.title.set(title, undefined);
		provider.setSessionsAndFire([sessions[2].model], {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: current, to: sessions[2].model }],
		});
		assert.equal(chat, sessions[1].mainChat.model);
	};
	provider.setChatModelHandler = async (current, chat, modelId) => {
		sessions[2].mainChat.modelId.set(modelId, undefined);
		provider.setSessionsAndFire([sessions[3].model], {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: current, to: sessions[3].model }],
		});
		assert.equal(chat, sessions[2].mainChat.model);
	};
	provider.setSessionArchivedHandler = async (current, archived) => {
		sessions[3].isArchived.set(archived, undefined);
		provider.setSessionsAndFire([sessions[4].model], {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: current, to: sessions[4].model }],
		});
	};
	const { store, management } = createHarness([provider]);

	try {
		await assert.rejects(management.renameSession(sessions[0].model, 'Renamed'), /stale model/);
		await assert.rejects(
			management.renameChat(sessions[1].model, sessions[1].mainChat.model, 'Renamed Chat'),
			/stale model/,
		);
		await assert.rejects(
			management.setChatModel(sessions[2].model, sessions[2].mainChat.model, 'model.await'),
			/stale model/,
		);
		await assert.rejects(management.setSessionArchived(sessions[3].model, true), /stale model/);
		assert.equal(management.sessions.get()[0], sessions[4].model);
	} finally {
		store.dispose();
	}
});

test('Sessions management routes peer, fork, Chat delete, and Session delete lifecycles', async () => {
	const provider = new TestSessionsProvider('provider.lifecycle');
	const session = createSession(provider.id, URI.parse('test-session:/lifecycle'));
	provider.sessions.push(session.model);
	const peer = createChat(URI.parse('test-chat:/peer'), {
		origin: { kind: ChatOriginKind.User },
	});
	const fork = createChat(URI.parse('test-chat:/fork'), {
		origin: { kind: ChatOriginKind.Fork, parentChat: session.mainChat.model.resource },
	});
	provider.createChatHandler = async () => {
		session.chats.set([...session.chats.get(), peer.model], undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
		return peer.model;
	};
	provider.forkChatHandler = async () => {
		session.chats.set([...session.chats.get(), fork.model], undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
		return fork.model;
	};
	provider.deleteChatHandler = async (_session, chat) => {
		session.chats.set(session.chats.get().filter(candidate => candidate !== chat), undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
	};
	provider.deleteSessionHandler = async deletedSession => {
		provider.setSessionsAndFire([], {
			transitions: [{ kind: SessionTransitionKind.Removed, session: deletedSession }],
		});
	};
	const { store, management } = createHarness([provider]);
	const transitionKinds: SessionTransitionKind[] = [];
	store.add(management.onDidChangeSessions(event => {
		transitionKinds.push(...event.transitions.map(transition => transition.kind));
	}));

	try {
		assert.equal(await management.createChat(session.model), peer.model);
		assert.equal(await management.forkChat(session.model, session.mainChat.model, 'turn.1'), fork.model);
		await management.deleteChat(session.model, fork.model);
		assert.deepEqual(session.chats.get(), [session.mainChat.model, peer.model]);
		await management.deleteSession(session.model);
		assert.deepEqual(management.sessions.get(), []);
		assert.deepEqual(transitionKinds, [
			SessionTransitionKind.Changed,
			SessionTransitionKind.Changed,
			SessionTransitionKind.Changed,
			SessionTransitionKind.Removed,
		]);
	} finally {
		store.dispose();
	}
});

test('Chat creation requires one new resource and an authoritative matching collection transition', async () => {
	const reusedProvider = new TestSessionsProvider('provider.reused-chat');
	const reusedSession = createSession(reusedProvider.id, URI.parse('test-session:/reused-chat'));
	const existingPeer = createChat(URI.parse('test-chat:/existing-peer'), {
		origin: { kind: ChatOriginKind.User },
	});
	reusedSession.chats.set([reusedSession.mainChat.model, existingPeer.model], undefined);
	reusedProvider.sessions.push(reusedSession.model);
	reusedProvider.createChatHandler = async () => {
		reusedProvider.setSessionsAndFire([reusedSession.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: reusedSession.model }],
		});
		return existingPeer.model;
	};
	const reusedHarness = createHarness([reusedProvider]);
	try {
		await assert.rejects(
			reusedHarness.management.createChat(reusedSession.model),
			/preserve the Chat collection and add exactly one new Chat resource/,
		);
	} finally {
		reusedHarness.store.dispose();
	}

	const silentProvider = new TestSessionsProvider('provider.silent-chat');
	const silentSession = createSession(silentProvider.id, URI.parse('test-session:/silent-chat'));
	const silentPeer = createChat(URI.parse('test-chat:/silent-peer'), {
		origin: { kind: ChatOriginKind.User },
	});
	silentProvider.sessions.push(silentSession.model);
	silentProvider.createChatHandler = async () => {
		silentSession.chats.set([...silentSession.chats.get(), silentPeer.model], undefined);
		return silentPeer.model;
	};
	const silentHarness = createHarness([silentProvider]);
	try {
		await assert.rejects(
			silentHarness.management.createChat(silentSession.model),
			/authoritative changed transition for the new Chat/,
		);
	} finally {
		silentHarness.store.dispose();
	}

	const unrelatedProvider = new TestSessionsProvider('provider.unrelated-change');
	const unrelatedSession = createSession(unrelatedProvider.id, URI.parse('test-session:/unrelated-change'));
	const fork = createChat(URI.parse('test-chat:/unreported-fork'), {
		origin: { kind: ChatOriginKind.Fork, parentChat: unrelatedSession.mainChat.model.resource },
	});
	unrelatedProvider.sessions.push(unrelatedSession.model);
	unrelatedProvider.forkChatHandler = async () => {
		unrelatedProvider.setSessionsAndFire([unrelatedSession.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: unrelatedSession.model }],
		});
		unrelatedSession.chats.set([...unrelatedSession.chats.get(), fork.model], undefined);
		return fork.model;
	};
	const unrelatedHarness = createHarness([unrelatedProvider]);
	try {
		await assert.rejects(
			unrelatedHarness.management.forkChat(unrelatedSession.model, unrelatedSession.mainChat.model, 'turn.1'),
			/authoritative changed transition for the Chat fork/,
		);
	} finally {
		unrelatedHarness.store.dispose();
	}
});

test('Delete postconditions use stable Session and Chat identities', async () => {
	const sessionProvider = new TestSessionsProvider('provider.stable-session-delete');
	const resource = URI.parse('test-session:/stable-delete');
	const session = createSession(sessionProvider.id, resource);
	const replacement = createSession(sessionProvider.id, resource);
	sessionProvider.sessions.push(session.model);
	sessionProvider.deleteSessionHandler = async () => {
		sessionProvider.setSessionsAndFire([replacement.model], {
			transitions: [{
				kind: SessionTransitionKind.Replaced,
				from: session.model,
				to: replacement.model,
			}],
		});
	};
	const sessionHarness = createHarness([sessionProvider]);
	try {
		await assert.rejects(
			sessionHarness.management.deleteSession(session.model),
			/did not remove Session identity/,
		);
		assert.equal(sessionHarness.management.sessions.get()[0], replacement.model);
	} finally {
		sessionHarness.store.dispose();
	}

	const chatProvider = new TestSessionsProvider('provider.stable-chat-delete');
	const chatSession = createSession(chatProvider.id, URI.parse('test-session:/stable-chat-delete'));
	const peerResource = URI.parse('test-chat:/stable-peer');
	const peer = createChat(peerResource, { origin: { kind: ChatOriginKind.User } });
	const replacementPeer = createChat(peerResource, { origin: { kind: ChatOriginKind.User } });
	chatSession.chats.set([chatSession.mainChat.model, peer.model], undefined);
	chatProvider.sessions.push(chatSession.model);
	chatProvider.deleteChatHandler = async () => {
		chatSession.chats.set([chatSession.mainChat.model, replacementPeer.model], undefined);
		chatProvider.setSessionsAndFire([chatSession.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: chatSession.model }],
		});
	};
	const chatHarness = createHarness([chatProvider]);
	try {
		await assert.rejects(
			chatHarness.management.deleteChat(chatSession.model, peer.model),
			/did not remove Chat/,
		);
		assert.equal(chatSession.chats.get()[1], replacementPeer.model);
	} finally {
		chatHarness.store.dispose();
	}
});

test('Capabilities, Chat interactivity, and main Chat semantics gate current operations', async () => {
	const provider = new TestSessionsProvider('provider.gates');
	const session = createSession(provider.id, URI.parse('test-session:/gates'), {
		capabilities: {
			supportsMultipleChats: false,
			supportsFork: false,
			supportsRename: false,
			supportsArchive: false,
			supportsDelete: false,
			supportsModels: false,
		},
	});
	const readOnly = createChat(URI.parse('test-chat:/read-only'), {
		origin: { kind: ChatOriginKind.Tool, parentChat: session.mainChat.model.resource },
		interactivity: ChatInteractivity.ReadOnly,
		capabilities: { supportsRename: true, supportsDelete: true },
	});
	session.chats.set([session.mainChat.model, readOnly.model], undefined);
	provider.sessions.push(session.model);
	const { store, management } = createHarness([provider]);

	try {
		await assert.rejects(management.createChat(session.model), /does not support user-created peer Chats/);
		await assert.rejects(management.forkChat(session.model, session.mainChat.model, 'turn'), /does not support Chat forks/);
		await assert.rejects(management.renameSession(session.model, 'Name'), /does not support rename/);
		await assert.rejects(management.setSessionArchived(session.model, true), /does not support archive/);
		await assert.rejects(management.deleteSession(session.model), /does not support delete/);
		assert.throws(() => management.getModels(session.model, session.mainChat.model), /does not support model selection/);
		await assert.rejects(
			management.sendRequest(session.model, readOnly.model, { prompt: 'No', attachments: [] }),
			/not interactive/,
		);
		await assert.rejects(management.renameChat(session.model, readOnly.model, 'No'), /not interactive/);
		await assert.rejects(management.deleteChat(session.model, session.mainChat.model), /main Chat .* cannot be deleted/);
	} finally {
		store.dispose();
	}
});

test('Workspace-less draft creation is gated by the selected Session type', () => {
	const provider = new TestSessionsProvider('provider.workspace-required', false);
	const { store, management } = createHarness([provider]);
	try {
		assert.throws(
			() => management.createSessionDraft(provider.id, {
				sessionType: `${provider.id}.default`,
				workspace: WorkspaceLess,
			}),
			/does not support workspace-less drafts/,
		);
	} finally {
		store.dispose();
	}
});

test('Provider removal clears its separately managed draft without invoking provider discard', () => {
	const { store, registry, management } = createHarness([]);
	const provider = store.add(new TestSessionsProvider('provider.removed-draft'));
	const draft = createSession(provider.id, URI.parse('test-session:/removed-draft'), {
		status: SessionStatus.Draft,
	});
	provider.createSessionDraftHandler = () => draft.model;
	let discardCount = 0;
	provider.discardSessionDraftHandler = () => {
		discardCount += 1;
	};
	const registration = store.add(registry.registerProvider(provider));
	const draftEvents: SessionDraftChangeKind[] = [];
	store.add(management.onDidChangeDraftSession(event => draftEvents.push(event.kind)));

	try {
		management.createSessionDraft(provider.id, {
			sessionType: `${provider.id}.default`,
			workspace: WorkspaceLess,
		});
		registration.dispose();
		assert.equal(management.draftSession.get(), undefined);
		assert.equal(discardCount, 0);
		assert.deepEqual(draftEvents, [
			SessionDraftChangeKind.Created,
			SessionDraftChangeKind.ProviderRemoved,
		]);
	} finally {
		store.dispose();
	}
});
