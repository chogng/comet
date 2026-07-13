/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
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
	SessionTransitionKind,
	type ISessionDraftOptions,
	type ISessionsChangeEvent,
	type ISessionsProvider,
} from 'cs/sessions/services/sessions/common/sessionsProvider';
import type { ISessionModel } from 'cs/sessions/services/sessions/common/sessionsProvider';

const TestDate = new Date('2026-07-11T00:00:00.000Z');
const WorkspaceLess: ISessionResolvedWorkspaceState = { kind: SessionWorkspaceKind.WorkspaceLess };

const FullSessionCapabilities: ISessionCapabilities = {
	supportsCreateChat: true,
	maximumChatCount: undefined,
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
	readonly chat: IChatFixture;
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
			origin: options.origin ?? { kind: ChatOriginKind.User },
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
	const chat = createChat(options.chatResource ?? URI.parse(`test-chat:/${providerId}${resource.path}`));
	const title = observableValue('sessionTitle', resource.path);
	const updatedAt = observableValue('sessionUpdatedAt', options.updatedAt ?? TestDate);
	const status = observableValue('sessionStatus', options.status ?? SessionStatus.Completed);
	const isArchived = observableValue('sessionIsArchived', false);
	const workspace = observableValue<ISessionWorkspaceState>('sessionWorkspace', options.workspace ?? WorkspaceLess);
	const chats = observableValue<readonly IChat[]>('sessionChats', [chat.model]);
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
		chat,
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
	readonly models: ISessionModel[] = [];

	private readonly sessionTypesEmitter = this._register(new Emitter<void>());
	readonly onDidChangeSessionTypes = this.sessionTypesEmitter.event;
	private readonly sessionsEmitter = this._register(new Emitter<ISessionsChangeEvent>());
	readonly onDidChangeSessions = this.sessionsEmitter.event;
	private readonly modelsEmitter = this._register(new Emitter<void>());
	readonly onDidChangeModels = this.modelsEmitter.event;

	createSessionDraftHandler: (options: ISessionDraftOptions) => ISession = unexpectedOperation;
	discardSessionDraftHandler: (session: ISession) => void = unexpectedOperation;
	sendRequestHandler: (session: ISession, chat: IChat) => Promise<void> = async () => unexpectedOperation();
	createChatHandler: (session: ISession) => Promise<IChat> = async () => unexpectedOperation();
	forkChatHandler: (session: ISession, sourceChat: IChat, turnId: string) => Promise<IChat> = async () => unexpectedOperation();
	renameSessionHandler: (session: ISession, title: string) => Promise<void> = async () => unexpectedOperation();
	renameChatHandler: (session: ISession, chat: IChat, title: string) => Promise<void> = async () => unexpectedOperation();
	setChatModelHandler: (session: ISession, chat: IChat, modelId: string | undefined) => Promise<void> = async () => unexpectedOperation();
	setSessionArchivedHandler: (session: ISession, archived: boolean) => Promise<void> = async () => unexpectedOperation();
	releaseSessionHandler: (session: ISession) => Promise<void> = async () => unexpectedOperation();
	releaseChatHandler: (session: ISession, chat: IChat) => Promise<void> = async () => unexpectedOperation();
	cancelTurnHandler: (session: ISession, chat: IChat, turnId: string) => Promise<void> = async () => unexpectedOperation();
	steerTurnHandler: (session: ISession, chat: IChat, turnId: string, message: string) => Promise<void> = async () => unexpectedOperation();
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

	getModels(): readonly ISessionModel[] {
		return this.models;
	}

	createSessionDraft(options: ISessionDraftOptions): ISession {
		return this.createSessionDraftHandler(options);
	}

	discardSessionDraft(session: ISession): void {
		this.discardSessionDraftHandler(session);
	}

	sendRequest(session: ISession, chat: IChat): Promise<void> {
		return this.sendRequestHandler(session, chat);
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

	releaseSession(session: ISession): Promise<void> {
		return this.releaseSessionHandler(session);
	}

	releaseChat(session: ISession, chat: IChat): Promise<void> {
		return this.releaseChatHandler(session, chat);
	}

	cancelTurn(session: ISession, chat: IChat, turnId: string): Promise<void> {
		return this.cancelTurnHandler(session, chat, turnId);
	}

	steerTurn(session: ISession, chat: IChat, turnId: string, message: string): Promise<void> {
		return this.steerTurnHandler(session, chat, turnId, message);
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

function createModel(id: string): ISessionModel {
	return {
		id,
		label: id,
		enabled: true,
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
		assert.deepEqual(management.getSessionForChatResource(second.chat.model.resource), {
			session: second.model,
			chat: second.chat.model,
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

test('Session draft replacement is atomic, explicit, and preserves the addressed Chat send', async () => {
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
	let receivedAddress: { readonly session: ISession; readonly chat: IChat } | undefined;
	provider.sendRequestHandler = async (session, chat) => {
		receivedAddress = { session, chat };
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
	try {
		assert.equal(management.createSessionDraft(provider.id, {
			sessionType: `${provider.id}.default`,
			workspace: WorkspaceLess,
		}), draft.model);
		await management.sendRequest(draft.model, draft.chat.model);

		assert.deepEqual(receivedAddress, { session: draft.model, chat: draft.chat.model });
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
			management.sendRequest(draft.model, draft.chat.model),
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

test('Session draft validation rejects every invalid initial Chat shape without publishing a draft', () => {
	const scenarios: readonly {
		readonly id: string;
		readonly configure: (draft: ISessionFixture) => void;
		readonly expectedError: RegExp;
	}[] = [
		{
			id: 'empty',
			configure: draft => draft.chats.set([], undefined),
			expectedError: /must contain one interactive user Chat/,
		},
		{
			id: 'multiple',
			configure: draft => draft.chats.set([
				draft.chat.model,
				createChat(URI.parse('test-chat:/draft-multiple-peer')).model,
			], undefined),
			expectedError: /must contain one interactive user Chat/,
		},
		{
			id: 'tool-origin-only',
			configure: draft => draft.chats.set([
				createChat(URI.parse('test-chat:/draft-tool-only'), {
					origin: {
						kind: ChatOriginKind.Tool,
						parentChat: draft.chat.model.resource,
					},
				}).model,
			], undefined),
			expectedError: /parent is outside the Session/,
		},
		{
			id: 'read-only-user',
			configure: draft => draft.chat.interactivity.set(ChatInteractivity.ReadOnly, undefined),
			expectedError: /must contain one interactive user Chat/,
		},
	];

	for (const scenario of scenarios) {
		const provider = new TestSessionsProvider(`provider.invalid-draft-${scenario.id}`);
		const draft = createSession(provider.id, URI.parse(`test-session:/${scenario.id}`), {
			status: SessionStatus.Draft,
		});
		scenario.configure(draft);
		provider.createSessionDraftHandler = () => draft.model;
		let discardCount = 0;
		provider.discardSessionDraftHandler = () => {
			discardCount += 1;
		};
		const { store, management } = createHarness([provider]);
		const draftEvents: SessionDraftChangeKind[] = [];
		store.add(management.onDidChangeDraftSession(event => draftEvents.push(event.kind)));

		try {
			assert.throws(
				() => management.createSessionDraft(provider.id, {
					sessionType: `${provider.id}.default`,
					workspace: WorkspaceLess,
				}),
				scenario.expectedError,
			);
			assert.equal(discardCount, 1);
			assert.equal(management.draftSession.get(), undefined);
			assert.deepEqual(draftEvents, []);
		} finally {
			store.dispose();
		}
		assert.equal(discardCount, 1);
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
	const requests: Array<{ readonly session: ISession; readonly chat: IChat }> = [];
	provider.sendRequestHandler = async (addressedSession, addressedChat) => {
		requests.push({ session: addressedSession, chat: addressedChat });
	};
	provider.renameSessionHandler = async (_session, title) => session.title.set(title, undefined);
	provider.renameChatHandler = async (_session, chat, title) => {
		if (chat === session.chat.model) {
			session.chat.title.set(title, undefined);
		}
	};
	const selectedModels: Array<string | undefined> = [];
	provider.setChatModelHandler = async (_session, _chat, modelId) => {
		selectedModels.push(modelId);
		session.chat.modelId.set(modelId, undefined);
	};
	provider.setSessionArchivedHandler = async (_session, archived) => session.isArchived.set(archived, undefined);
	const releases: string[] = [];
	provider.releaseSessionHandler = async () => { releases.push('session'); };
	provider.releaseChatHandler = async () => { releases.push('chat'); };
	const turnOperations: Array<{ readonly kind: 'cancel' | 'steer'; readonly turnId: string; readonly message?: string }> = [];
	provider.cancelTurnHandler = async (_session, _chat, turnId) => {
		turnOperations.push({ kind: 'cancel', turnId });
	};
	provider.steerTurnHandler = async (_session, _chat, turnId, message) => {
		turnOperations.push({ kind: 'steer', turnId, message });
	};
	const { store, management } = createHarness([provider]);
	const modelEvents: string[] = [];
	store.add(management.onDidChangeModels(event => modelEvents.push(event.providerId)));
	try {
		await management.sendRequest(session.model, session.chat.model);
		await management.renameSession(session.model, 'Renamed Session');
		await management.renameChat(session.model, session.chat.model, 'Renamed Chat');
		assert.deepEqual(management.getModels(session.model, session.chat.model), provider.models);
		await management.setChatModel(session.model, session.chat.model, 'model.test');
		await management.setChatModel(session.model, session.chat.model, undefined);
		await management.setSessionArchived(session.model, true);
		await management.releaseChat(session.model, session.chat.model);
		await management.releaseSession(session.model);
		await management.cancelTurn(session.model, session.chat.model, ' turn.cancel ');
		await management.steerTurn(session.model, session.chat.model, ' turn.steer ', ' focus on tests ');
		provider.fireModelsChanged();

		assert.deepEqual(requests, [{ session: session.model, chat: session.chat.model }]);
		assert.deepEqual(selectedModels, ['model.test', undefined]);
		assert.deepEqual(modelEvents, [provider.id]);
		assert.deepEqual(releases, ['chat', 'session']);
		assert.deepEqual(turnOperations, [
			{ kind: 'cancel', turnId: 'turn.cancel' },
			{ kind: 'steer', turnId: 'turn.steer', message: 'focus on tests' },
		]);
		assert.equal(session.title.get(), 'Renamed Session');
		assert.equal(session.chat.title.get(), 'Renamed Chat');
		assert.equal(session.isArchived.get(), true);
	} finally {
		store.dispose();
	}
});

test('Sessions management rejects a disabled provider model before mutation', async () => {
	const provider = new TestSessionsProvider('provider.disabled-model');
	const session = createSession(provider.id, URI.parse('test-session:/disabled-model'));
	provider.sessions.push(session.model);
	provider.models.push({ ...createModel('model.disabled'), enabled: false });
	let mutationCount = 0;
	provider.setChatModelHandler = async () => {
		mutationCount += 1;
	};
	const { store, management } = createHarness([provider]);
	try {
		await assert.rejects(
			management.setChatModel(session.model, session.chat.model, 'model.disabled'),
			/Model 'model.disabled' is not available/,
		);
		assert.equal(mutationCount, 0);
		assert.equal(session.chat.modelId.get(), undefined);
	} finally {
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
		sessions[1].chat.title.set(title, undefined);
		provider.setSessionsAndFire([sessions[2].model], {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: current, to: sessions[2].model }],
		});
		assert.equal(chat, sessions[1].chat.model);
	};
	provider.setChatModelHandler = async (current, chat, modelId) => {
		sessions[2].chat.modelId.set(modelId, undefined);
		provider.setSessionsAndFire([sessions[3].model], {
			transitions: [{ kind: SessionTransitionKind.Replaced, from: current, to: sessions[3].model }],
		});
		assert.equal(chat, sessions[2].chat.model);
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
			management.renameChat(sessions[1].model, sessions[1].chat.model, 'Renamed Chat'),
			/stale model/,
		);
		await assert.rejects(
			management.setChatModel(sessions[2].model, sessions[2].chat.model, 'model.await'),
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
		origin: { kind: ChatOriginKind.Fork, parentChat: session.chat.model.resource },
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
		assert.equal(await management.forkChat(session.model, session.chat.model, 'turn.1'), fork.model);
		await management.deleteChat(session.model, fork.model);
		assert.deepEqual(session.chats.get(), [session.chat.model, peer.model]);
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

test('Chat creation and fork use independent capabilities and one dynamic capacity', async () => {
	const provider = new TestSessionsProvider('provider.chat-capacity');
	const session = createSession(provider.id, URI.parse('test-session:/chat-capacity'), {
		capabilities: {
			supportsCreateChat: true,
			maximumChatCount: 3,
			supportsFork: false,
		},
	});
	const peer = createChat(URI.parse('test-chat:/capacity-peer'));
	const fork = createChat(URI.parse('test-chat:/capacity-fork'), {
		origin: { kind: ChatOriginKind.Fork, parentChat: session.chat.model.resource },
	});
	provider.sessions.push(session.model);
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
	const { store, management } = createHarness([provider]);

	try {
		assert.equal(await management.createChat(session.model), peer.model);
		await assert.rejects(
			management.forkChat(session.model, session.chat.model, 'turn.disabled'),
			/does not support Chat forks/,
		);

		session.capabilities.set({
			...session.capabilities.get(),
			supportsCreateChat: false,
			supportsFork: true,
		}, undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
		assert.equal(await management.forkChat(session.model, session.chat.model, 'turn.enabled'), fork.model);
		await assert.rejects(
			management.createChat(session.model),
			/does not support user-created peer Chats/,
		);

		session.capabilities.set({
			...session.capabilities.get(),
			supportsCreateChat: true,
			maximumChatCount: 0,
		}, undefined);
		assert.doesNotThrow(() => provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		}));
		assert.equal(session.chats.get().length, 3);
		await assert.rejects(management.createChat(session.model), /maximum Chat count of 0/);
		await assert.rejects(
			management.forkChat(session.model, session.chat.model, 'turn.capacity'),
			/maximum Chat count of 0/,
		);
	} finally {
		store.dispose();
	}
});

test('Concurrent Chat creation reserves one remaining Session capacity slot', async () => {
	const provider = new TestSessionsProvider('provider.concurrent-create-capacity');
	const session = createSession(provider.id, URI.parse('test-session:/concurrent-create-capacity'), {
		capabilities: { maximumChatCount: 2 },
	});
	const peers = [
		createChat(URI.parse('test-chat:/concurrent-create-first')),
		createChat(URI.parse('test-chat:/concurrent-create-second')),
	];
	provider.sessions.push(session.model);
	const providerCallStarted = new DeferredPromise<void>();
	const releaseProviderCall = new DeferredPromise<void>();
	let providerCallCount = 0;
	provider.createChatHandler = async () => {
		const callIndex = providerCallCount++;
		providerCallStarted.complete(undefined);
		await releaseProviderCall.p;
		const peer = peers[callIndex];
		session.chats.set([...session.chats.get(), peer.model], undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
		return peer.model;
	};
	const { store, management } = createHarness([provider]);
	const operations: Promise<IChat>[] = [];

	try {
		const first = management.createChat(session.model);
		operations.push(first);
		await providerCallStarted.p;
		const second = management.createChat(session.model);
		operations.push(second);

		assert.equal(providerCallCount, 1);
		releaseProviderCall.complete(undefined);
		assert.equal(await first, peers[0].model);
		await assert.rejects(second, /maximum Chat count of 2/);
		assert.equal(providerCallCount, 1);
		assert.deepEqual(session.chats.get(), [session.chat.model, peers[0].model]);
	} finally {
		if (!releaseProviderCall.isSettled) {
			releaseProviderCall.complete(undefined);
		}
		await Promise.allSettled(operations);
		store.dispose();
	}
});

test('Concurrent Chat create and fork operations share Session capacity in call order', async () => {
	const runOrdering = async (firstKind: 'create' | 'fork'): Promise<void> => {
		const provider = new TestSessionsProvider(`provider.concurrent-${firstKind}-capacity`);
		const session = createSession(provider.id, URI.parse(`test-session:/concurrent-${firstKind}-capacity`), {
			capabilities: { maximumChatCount: 2 },
		});
		const peer = createChat(URI.parse(`test-chat:/concurrent-${firstKind}-peer`));
		const fork = createChat(URI.parse(`test-chat:/concurrent-${firstKind}-fork`), {
			origin: { kind: ChatOriginKind.Fork, parentChat: session.chat.model.resource },
		});
		provider.sessions.push(session.model);
		const providerCallStarted = new DeferredPromise<void>();
		const releaseProviderCall = new DeferredPromise<void>();
		let createCallCount = 0;
		let forkCallCount = 0;
		const commitChat = (chat: IChat): IChat => {
			session.chats.set([...session.chats.get(), chat], undefined);
			provider.setSessionsAndFire([session.model], {
				transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
			});
			return chat;
		};
		provider.createChatHandler = async () => {
			createCallCount += 1;
			providerCallStarted.complete(undefined);
			await releaseProviderCall.p;
			return commitChat(peer.model);
		};
		provider.forkChatHandler = async () => {
			forkCallCount += 1;
			providerCallStarted.complete(undefined);
			await releaseProviderCall.p;
			return commitChat(fork.model);
		};
		const { store, management } = createHarness([provider]);
		const operations: Promise<IChat>[] = [];

		try {
			const first = firstKind === 'create'
				? management.createChat(session.model)
				: management.forkChat(session.model, session.chat.model, 'turn.first');
			operations.push(first);
			await providerCallStarted.p;
			const second = firstKind === 'create'
				? management.forkChat(session.model, session.chat.model, 'turn.second')
				: management.createChat(session.model);
			operations.push(second);

			assert.deepEqual(
				{ createCallCount, forkCallCount },
				firstKind === 'create'
					? { createCallCount: 1, forkCallCount: 0 }
					: { createCallCount: 0, forkCallCount: 1 },
			);
			releaseProviderCall.complete(undefined);
			const expectedChat = firstKind === 'create' ? peer.model : fork.model;
			assert.equal(await first, expectedChat);
			await assert.rejects(second, /maximum Chat count of 2/);
			assert.deepEqual(
				{ createCallCount, forkCallCount },
				firstKind === 'create'
					? { createCallCount: 1, forkCallCount: 0 }
					: { createCallCount: 0, forkCallCount: 1 },
			);
			assert.deepEqual(session.chats.get(), [session.chat.model, expectedChat]);
		} finally {
			if (!releaseProviderCall.isSettled) {
				releaseProviderCall.complete(undefined);
			}
			await Promise.allSettled(operations);
			store.dispose();
		}
	};

	await runOrdering('create');
	await runOrdering('fork');
});

test('Chat create and delete share one FIFO catalog mutation boundary', async () => {
	const provider = new TestSessionsProvider('provider.concurrent-chat-catalog');
	const session = createSession(provider.id, URI.parse('test-session:/concurrent-chat-catalog'));
	const peer = createChat(URI.parse('test-chat:/concurrent-chat-catalog-peer'));
	provider.sessions.push(session.model);
	const createStarted = new DeferredPromise<void>();
	const releaseCreate = new DeferredPromise<void>();
	const providerCalls: string[] = [];
	provider.createChatHandler = async () => {
		providerCalls.push('create');
		createStarted.complete(undefined);
		await releaseCreate.p;
		session.chats.set([...session.chats.get(), peer.model], undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
		return peer.model;
	};
	provider.deleteChatHandler = async (_session, chat) => {
		providerCalls.push('delete');
		session.chats.set(session.chats.get().filter(candidate => candidate !== chat), undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
	};
	const { store, management } = createHarness([provider]);
	const operations: Promise<unknown>[] = [];

	try {
		const create = management.createChat(session.model);
		operations.push(create);
		await createStarted.p;
		const deletion = management.deleteChat(session.model, session.chat.model);
		operations.push(deletion);
		assert.deepEqual(providerCalls, ['create']);

		releaseCreate.complete(undefined);
		assert.equal(await create, peer.model);
		await deletion;
		assert.deepEqual(providerCalls, ['create', 'delete']);
		assert.deepEqual(session.chats.get(), [peer.model]);
	} finally {
		if (!releaseCreate.isSettled) {
			releaseCreate.complete(undefined);
		}
		await Promise.allSettled(operations);
		store.dispose();
	}
});

test('First, last, and only Chats delete by their own capability and leave an empty Session', async () => {
	const provider = new TestSessionsProvider('provider.chat-delete-order');
	const session = createSession(provider.id, URI.parse('test-session:/chat-delete-order'));
	const middle = createChat(URI.parse('test-chat:/delete-middle'));
	const last = createChat(URI.parse('test-chat:/delete-last'));
	session.chats.set([session.chat.model, middle.model, last.model], undefined);
	provider.sessions.push(session.model);
	const deleted: IChat[] = [];
	provider.deleteChatHandler = async (_session, chat) => {
		deleted.push(chat);
		session.chats.set(session.chats.get().filter(candidate => candidate !== chat), undefined);
		provider.setSessionsAndFire([session.model], {
			transitions: [{ kind: SessionTransitionKind.Changed, session: session.model }],
		});
	};
	const { store, management } = createHarness([provider]);

	try {
		await management.deleteChat(session.model, session.chat.model);
		assert.deepEqual(session.chats.get(), [middle.model, last.model]);

		await management.deleteChat(session.model, last.model);
		assert.deepEqual(session.chats.get(), [middle.model]);

		await management.deleteChat(session.model, middle.model);
		assert.deepEqual(session.chats.get(), []);
		assert.equal(management.getSession(session.model.sessionId), session.model);
		assert.deepEqual(provider.getSessions(), [session.model]);
		assert.deepEqual(deleted, [session.chat.model, last.model, middle.model]);
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
	reusedSession.chats.set([reusedSession.chat.model, existingPeer.model], undefined);
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
		origin: { kind: ChatOriginKind.Fork, parentChat: unrelatedSession.chat.model.resource },
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
			unrelatedHarness.management.forkChat(unrelatedSession.model, unrelatedSession.chat.model, 'turn.1'),
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
	chatSession.chats.set([chatSession.chat.model, peer.model], undefined);
	chatProvider.sessions.push(chatSession.model);
	chatProvider.deleteChatHandler = async () => {
		chatSession.chats.set([chatSession.chat.model, replacementPeer.model], undefined);
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

test('Capabilities and addressed Chat state gate current operations', async () => {
	const provider = new TestSessionsProvider('provider.gates');
	const session = createSession(provider.id, URI.parse('test-session:/gates'), {
		capabilities: {
			supportsCreateChat: false,
			maximumChatCount: 2,
			supportsFork: false,
			supportsRename: false,
			supportsArchive: false,
			supportsDelete: false,
			supportsModels: false,
		},
	});
	session.chat.capabilities.set({ supportsRename: true, supportsDelete: false }, undefined);
	const readOnly = createChat(URI.parse('test-chat:/read-only'), {
		origin: { kind: ChatOriginKind.Tool, parentChat: session.chat.model.resource },
		interactivity: ChatInteractivity.ReadOnly,
		capabilities: { supportsRename: true, supportsDelete: true },
	});
	session.chats.set([session.chat.model, readOnly.model], undefined);
	provider.sessions.push(session.model);
	const { store, management } = createHarness([provider]);

	try {
		await assert.rejects(management.createChat(session.model), /does not support user-created peer Chats/);
		await assert.rejects(management.forkChat(session.model, session.chat.model, 'turn'), /does not support Chat forks/);
		await assert.rejects(management.renameSession(session.model, 'Name'), /does not support rename/);
		await assert.rejects(management.setSessionArchived(session.model, true), /does not support archive/);
		await assert.rejects(management.deleteSession(session.model), /does not support delete/);
		assert.throws(() => management.getModels(session.model, session.chat.model), /does not support model selection/);
		await assert.rejects(
			management.sendRequest(session.model, readOnly.model),
			/not interactive/,
		);
		await assert.rejects(management.renameChat(session.model, readOnly.model, 'No'), /not interactive/);
		await assert.rejects(management.deleteChat(session.model, session.chat.model), /does not support delete/);
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
