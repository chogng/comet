/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Emitter, Event } from 'cs/base/common/event';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
	type SessionId,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import {
	SessionDraftChangeKind,
	type IProviderSessionType,
	type ISessionChatOwner,
	type ISessionDraftChangeEvent,
	type ISessionsManagementChangeEvent,
	type ISessionsManagementService,
	type ISessionsModelsChangeEvent,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import {
	SessionTransitionKind,
	type ISessionDraftOptions,
} from 'cs/sessions/services/sessions/common/sessionsProvider';
import type { IActiveSession, IVisibleSessionSlot } from 'cs/sessions/services/sessions/common/sessionsView';
import {
	ISessionsPartService,
	type ISessionsPartFocusTarget,
} from 'cs/sessions/services/sessions/browser/sessionsPartService';
import {
	OpenNewSessionKind,
	ISessionsService,
	SessionsService,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import type { ISessionModel } from 'cs/sessions/services/sessions/common/sessionsProvider';

interface ITestSession {
	readonly model: ISession;
	readonly chat: IChat;
	readonly chats: ReturnType<typeof observableValue<readonly IChat[]>>;
}

function createChat(
	resource: string,
	interactivity = ChatInteractivity.Full,
	origin: IChat['origin'] = Object.freeze({ kind: ChatOriginKind.User }),
): IChat {
	return {
		resource: URI.parse(resource),
		createdAt: new Date(1),
		title: observableValue(`title-${resource}`, resource),
		updatedAt: observableValue(`updated-${resource}`, new Date(1)),
		status: observableValue(`status-${resource}`, SessionStatus.Completed),
		isRead: observableValue(`read-${resource}`, true),
		modelId: observableValue<string | undefined>(`model-${resource}`, undefined),
		interactivity: observableValue(`interactivity-${resource}`, interactivity),
		capabilities: observableValue(`capabilities-${resource}`, {
			supportsRename: true,
			supportsDelete: true,
		}),
		origin,
	};
}

function createSession(name: string, status = SessionStatus.Completed): ITestSession {
	const resource = URI.parse(`test-session:/${name}`);
	const chat = createChat(`test-chat:/${name}/user`);
	const chats = observableValue<readonly IChat[]>(`chats-${name}`, [chat]);
	return {
		chat,
		chats,
		model: {
			sessionId: toSessionId('provider.test', resource),
			resource,
			providerId: 'provider.test',
			sessionType: 'provider.test.default',
			createdAt: new Date(1),
			title: observableValue(`session-title-${name}`, `Session ${name}`),
			updatedAt: observableValue(`session-updated-${name}`, new Date(1)),
			status: observableValue(`session-status-${name}`, status),
			isRead: observableValue(`session-read-${name}`, true),
			isArchived: observableValue(`session-archived-${name}`, false),
			workspace: observableValue(`session-workspace-${name}`, {
				kind: SessionWorkspaceKind.WorkspaceLess,
			}),
			changes: observableValue(`session-changes-${name}`, []),
			chats,
			capabilities: observableValue(`session-capabilities-${name}`, {
				supportsCreateChat: true,
				maximumChatCount: undefined,
				supportsFork: true,
				supportsRename: true,
				supportsArchive: true,
				supportsDelete: true,
				supportsChanges: false,
				supportsModels: true,
			}),
		},
	};
}

function createStorageService() {
	const values = new Map<string, string>();
	let storeCount = 0;
	const willSaveEmitter = new Emitter<{ readonly reason: 0 }>();
	const keyFor = (key: string, scope: StorageScope) => `${scope}:${key}`;
	const service = {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: willSaveEmitter.event,
		init: async () => {},
		close: async () => {},
		get: (key: string, scope: StorageScope, fallbackValue?: string) =>
			values.get(keyFor(key, scope)) ?? fallbackValue,
		getBoolean: (_key: string, _scope: StorageScope, fallbackValue?: boolean) => fallbackValue,
		getNumber: (_key: string, _scope: StorageScope, fallbackValue?: number) => fallbackValue,
		getObject: <T extends object>(_key: string, _scope: StorageScope, fallbackValue?: T) => fallbackValue,
		store: (key: string, value: string | number | boolean | object | undefined | null, scope: StorageScope, _target: StorageTarget) => {
			if (typeof value !== 'string') {
				throw new Error('Sessions view-state tests store only serialized strings.');
			}
			values.set(keyFor(key, scope), value);
			storeCount += 1;
		},
		storeAll() {},
		remove: (key: string, scope: StorageScope) => values.delete(keyFor(key, scope)),
		keys: (scope: StorageScope, _target: StorageTarget) => [...values.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(`${scope}:`.length)),
		log() {},
		optimize: async () => {},
		flush: async () => {},
		fireWillSave: () => willSaveEmitter.fire({ reason: 0 }),
		get storeCount() { return storeCount; },
		dispose: () => willSaveEmitter.dispose(),
	};
	return service as unknown as IStorageService & {
		readonly fireWillSave: () => void;
		readonly storeCount: number;
		readonly dispose: () => void;
	};
}

class TestSessionsManagementService implements ISessionsManagementService {
	declare readonly _serviceBrand: undefined;
	readonly sessions = observableValue<readonly ISession[]>('testSessions', []);
	readonly draftSession = observableValue<ISession | undefined>('testDraftSession', undefined);
	readonly sessionTypes = observableValue<readonly IProviderSessionType[]>('testSessionTypes', []);
	private readonly sessionsEmitter = new Emitter<ISessionsManagementChangeEvent>();
	readonly onDidChangeSessions = this.sessionsEmitter.event;
	private readonly draftEmitter = new Emitter<ISessionDraftChangeEvent>();
	readonly onDidChangeDraftSession = this.draftEmitter.event;
	private readonly sessionTypesEmitter = new Emitter<void>();
	readonly onDidChangeSessionTypes = this.sessionTypesEmitter.event;
	private readonly modelsEmitter = new Emitter<ISessionsModelsChangeEvent>();
	readonly onDidChangeModels = this.modelsEmitter.event;
	createDraft: (() => ISession) | undefined;
	discardedDrafts: ISession[] = [];

	getSessions(): readonly ISession[] { return this.sessions.get(); }
	getSession(sessionId: SessionId): ISession | undefined {
		return this.sessions.get().find(session => session.sessionId === sessionId);
	}
	getSessionByResource(providerId: string, resource: URI): ISession | undefined {
		return this.sessions.get().find(session => session.providerId === providerId && session.resource.toString() === resource.toString());
	}
	getSessionForChatResource(resource: URI): ISessionChatOwner | undefined {
		for (const session of this.sessions.get()) {
			const chat = session.chats.get().find(candidate => candidate.resource.toString() === resource.toString());
			if (chat) { return { session, chat }; }
		}
		return undefined;
	}
	async createSessionDraft(_providerId: string, _options: ISessionDraftOptions): Promise<ISession> {
		const draft = this.createDraft?.();
		if (!draft) { throw new Error('No draft configured.'); }
		this.draftSession.set(draft, undefined);
		this.draftEmitter.fire({ kind: SessionDraftChangeKind.Created, from: undefined, to: draft });
		return draft;
	}
	discardSessionDraft(session: ISession): void {
		if (this.draftSession.get() !== session) { throw new Error('Not current draft.'); }
		this.discardedDrafts.push(session);
		this.draftSession.set(undefined, undefined);
		this.draftEmitter.fire({ kind: SessionDraftChangeKind.Discarded, from: session, to: undefined });
	}
	getModels(): readonly ISessionModel[] { return []; }
	sendRequest(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Not implemented.'); }
	createChat(_session: ISession): Promise<IChat> { throw new Error('Not implemented.'); }
	forkChat(_session: ISession, _sourceChat: IChat, _turnId: string): Promise<IChat> { throw new Error('Not implemented.'); }
	renameSession(_session: ISession, _title: string): Promise<void> { throw new Error('Not implemented.'); }
	renameChat(_session: ISession, _chat: IChat, _title: string): Promise<void> { throw new Error('Not implemented.'); }
	setChatModel(_session: ISession, _chat: IChat, _modelId: string | undefined): Promise<void> { throw new Error('Not implemented.'); }
	setSessionArchived(_session: ISession, _archived: boolean): Promise<void> { throw new Error('Not implemented.'); }
	releaseSession(_session: ISession): Promise<void> { throw new Error('Not implemented.'); }
	releaseChat(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Not implemented.'); }
	cancelTurn(_session: ISession, _chat: IChat, _turnId: string): Promise<void> { throw new Error('Not implemented.'); }
	steerTurn(_session: ISession, _chat: IChat, _turnId: string, _message: string): Promise<void> { throw new Error('Not implemented.'); }
	deleteSession(_session: ISession): Promise<void> { throw new Error('Not implemented.'); }
	deleteChat(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Not implemented.'); }

	setSessionsAndFire(sessions: readonly ISession[], transitions: ISessionsManagementChangeEvent['transitions']): void {
		this.sessions.set(sessions, undefined);
		this.sessionsEmitter.fire({ providerId: 'provider.test', transitions });
	}

	replaceDraft(from: ISession, to: ISession): void {
		this.sessions.set([to], undefined);
		this.draftSession.set(undefined, undefined);
		this.sessionsEmitter.fire({
			providerId: 'provider.test',
			transitions: [{ kind: SessionTransitionKind.Replaced, from, to }],
		});
		this.draftEmitter.fire({ kind: SessionDraftChangeKind.Replaced, from, to });
	}

	removeDraftWithProvider(): void {
		const draft = this.draftSession.get();
		if (!draft) { throw new Error('No draft configured.'); }
		this.draftSession.set(undefined, undefined);
		this.draftEmitter.fire({ kind: SessionDraftChangeKind.ProviderRemoved, from: draft, to: undefined });
	}

	dispose(): void {
		this.sessionsEmitter.dispose();
		this.draftEmitter.dispose();
		this.sessionTypesEmitter.dispose();
		this.modelsEmitter.dispose();
	}
}

class TestSessionsPartService implements ISessionsPartService {
	declare readonly _serviceBrand: undefined;
	private readonly focusEmitter = new Emitter<ISessionsPartFocusTarget>();
	readonly onDidFocusSlot = this.focusEmitter.event;
	readonly updates: Array<{
		readonly visible: readonly IVisibleSessionSlot[];
		readonly active: IActiveSession | undefined;
		readonly activeChat: IChat | undefined;
	}> = [];
	readonly focusCalls: Array<IActiveSession | undefined> = [];
	readonly calls: Array<'update' | 'focus'> = [];
	emitFocusEventOnFocusCall = false;
	updateVisibleSessions(visible: readonly IVisibleSessionSlot[], active: IActiveSession | undefined): void {
		this.calls.push('update');
		this.updates.push({ visible, active, activeChat: active?.activeChat.get() });
	}
	focusSession(session: IActiveSession | undefined): void {
		this.calls.push('focus');
		this.focusCalls.push(session);
		if (this.emitFocusEventOnFocusCall) {
			this.focusEmitter.fire(session
				? { kind: 'session', session }
				: { kind: 'new-session' });
		}
	}
	fireFocus(target: ISessionsPartFocusTarget): void { this.focusEmitter.fire(target); }
	dispose(): void { this.focusEmitter.dispose(); }
}

function createHarness(
	initialSessions: readonly ISession[] = [],
	storageService?: ReturnType<typeof createStorageService>,
) {
	const store = new DisposableStore();
	const management = new TestSessionsManagementService();
	management.sessions.set(initialSessions, undefined);
	const part = new TestSessionsPartService();
	const storage = storageService ?? createStorageService();
	if (!storageService) {
		store.add(toDisposable(() => storage.dispose()));
	}
	const service = new SessionsService(management, part, storage);
	store.add(service);
	store.add(part);
	store.add(management);
	return { store, management, part, service, storage };
}

test('Sessions view service is registered exactly once', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === ISessionsService);
	assert.equal(registrations.length, 1);
});

test('SessionsService drives the explicit new slot and honors preserveFocus', async () => {
	const session = createSession('open');
	const { store, part, service } = createHarness([session.model]);
	try {
		assert.equal(part.updates.length, 1);
		assert.equal(service.activeSession.get(), undefined);
		service.openSession(session.model.sessionId);
		const active = service.activeSession.get()!;
		assert.equal(active.sessionId, session.model.sessionId);
		assert.equal(active.activeChat.get(), undefined);
		assert.equal(part.focusCalls.at(-1), active);

		const focusCount = part.focusCalls.length;
		await service.openNewSession({ kind: OpenNewSessionKind.Empty, preserveFocus: true });
		assert.equal(service.activeSession.get(), undefined);
		assert.equal(part.focusCalls.length, focusCount);
		assert.throws(
			() => part.fireFocus({ kind: 'session', session: active }),
			/stale Session/,
		);
		service.openSession(session.model.sessionId, { preserveFocus: true });
		assert.equal(service.activeSession.get()?.sessionId, session.model.sessionId);
		assert.equal(part.focusCalls.length, focusCount);
	} finally {
		store.dispose();
	}
});

test('SessionsService owns explicit draft creation, restoration, and discard', async () => {
	const draft = createSession('draft', SessionStatus.Draft);
	const { store, management, service } = createHarness();
	management.createDraft = () => draft.model;
	try {
		assert.equal(await service.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId: 'provider.test',
			draft: {
				sessionType: 'provider.test.default',
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
		}), draft.model);
		const visibleDraft = service.activeSession.get()!;
		assert.equal(visibleDraft.sessionId, draft.model.sessionId);
		assert.equal(visibleDraft.activeChat.get(), draft.chat);
		assert.throws(
			() => service.closeChat(visibleDraft, draft.chat),
			/must be discarded instead of closing its Chat/,
		);
		await service.openNewSession({ kind: OpenNewSessionKind.Empty });
		assert.equal(service.activeSession.get(), visibleDraft);
		service.closeSession(visibleDraft);
		assert.deepEqual(management.discardedDrafts, [draft.model]);
		assert.equal(service.activeSession.get(), undefined);
	} finally {
		store.dispose();
	}
});

test('SessionsService rejects a draft without exactly one explicit User Chat', async () => {
	const empty = createSession('draft-empty', SessionStatus.Draft);
	empty.chats.set([], undefined);
	const multiple = createSession('draft-multiple', SessionStatus.Draft);
	multiple.chats.set([
		multiple.chat,
		createChat('test-chat:/draft-multiple/peer'),
	], undefined);
	const toolOnly = createSession('draft-tool', SessionStatus.Draft);
	toolOnly.chats.set([
		createChat(
			'test-chat:/draft-tool/worker',
			ChatInteractivity.ReadOnly,
			{ kind: ChatOriginKind.Tool, parentChat: toolOnly.chat.resource },
		),
	], undefined);

	for (const draft of [empty, multiple, toolOnly]) {
		const { store, management, service } = createHarness();
		management.createDraft = () => draft.model;
		try {
			await assert.rejects(service.openNewSession({
				kind: OpenNewSessionKind.Draft,
				providerId: 'provider.test',
				draft: {
					sessionType: 'provider.test.default',
					workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
				},
			}));
			assert.deepEqual(management.discardedDrafts, [draft.model]);
			assert.equal(service.activeSession.get(), undefined);
		} finally {
			store.dispose();
		}
	}
});

test('SessionsService preserves the visible wrapper across explicit draft replacement', async () => {
	const draft = createSession('replace', SessionStatus.Draft);
	const committed = createSession('replace', SessionStatus.Running);
	const { store, management, service } = createHarness();
	management.createDraft = () => draft.model;
	try {
		await service.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId: 'provider.test',
			draft: {
				sessionType: 'provider.test.default',
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
		});
		const wrapper = service.activeSession.get()!;
		management.replaceDraft(draft.model, committed.model);
		assert.equal(service.activeSession.get(), wrapper);
		assert.equal(wrapper.status.get(), SessionStatus.Running);
		assert.equal(wrapper.activeChat.get(), committed.chat);
		assert.throws(
			() => service.openChat(draft.model, draft.chat.resource),
			/not the current managed model/,
		);
		assert.throws(
			() => service.reopenChat(wrapper, draft.chat),
			/not owned by Session/,
		);

		management.setSessionsAndFire([], [{ kind: SessionTransitionKind.Removed, session: committed.model }]);
		assert.equal(service.activeSession.get(), undefined);
	} finally {
		store.dispose();
	}
});

test('SessionsService opens an addressed Chat, rejects Hidden Chats, and keeps Part focus round-trips one-way', () => {
	const first = createSession('chat-first');
	const peer = createChat(
		'test-chat:/chat-first/peer',
		ChatInteractivity.Full,
		{ kind: ChatOriginKind.User },
	);
	const hidden = createChat(
		'test-chat:/chat-first/hidden',
		ChatInteractivity.Hidden,
		{ kind: ChatOriginKind.Tool, parentChat: first.chat.resource },
	);
	first.chats.set([first.chat, peer, hidden], undefined);
	const second = createSession('chat-second');
	const { store, part, service } = createHarness([first.model, second.model]);
	try {
		service.openSession(first.model.sessionId);
		assert.equal(service.activeSession.get()?.activeChat.get(), undefined);
		service.setSessionSticky(service.activeSession.get()!, true);
		service.openSession(second.model.sessionId);
		const secondVisible = service.activeSession.get()!;
		const focusCountBeforePreservedOpen = part.focusCalls.length;
		const updateCountBeforePreservedOpen = part.updates.length;
		service.openChat(first.model, peer.resource, { preserveFocus: true });
		const firstVisible = service.activeSession.get()!;
		assert.equal(firstVisible.activeChat.get(), peer);
		assert.equal(part.updates.length, updateCountBeforePreservedOpen + 1);
		assert.equal(part.updates.at(-1)?.activeChat, peer);
		assert.equal(part.focusCalls.length, focusCountBeforePreservedOpen);
		service.closeChat(firstVisible, peer);
		assert.equal(firstVisible.activeChat.get(), undefined);
		service.reopenChat(firstVisible, peer, { preserveFocus: true });
		assert.equal(firstVisible.activeChat.get(), peer);
		assert.equal(part.focusCalls.length, focusCountBeforePreservedOpen);
		assert.throws(() => service.openChat(first.model, hidden.resource), /Hidden Chat/);

		const focusCount = part.focusCalls.length;
		part.fireFocus({ kind: 'session', session: secondVisible });
		assert.equal(service.activeSession.get(), secondVisible);
		assert.equal(part.focusCalls.length, focusCount);
		part.fireFocus({ kind: 'session', session: firstVisible });
		assert.equal(service.activeSession.get(), firstVisible);
		assert.equal(part.focusCalls.length, focusCount);
	} finally {
		store.dispose();
	}
});

test('SessionsService retains the visible Session when its only Chat is deleted and never reselects a reappearing resource', () => {
	const session = createSession('only-chat-deletion');
	const { store, management, service } = createHarness([session.model]);
	try {
		service.openChat(session.model, session.chat.resource);
		const visibleSession = service.activeSession.get()!;
		assert.equal(visibleSession.activeChat.get(), session.chat);

		session.chats.set([], undefined);
		management.setSessionsAndFire(
			[session.model],
			[{ kind: SessionTransitionKind.Changed, session: session.model }],
		);
		assert.equal(service.activeSession.get(), visibleSession);
		assert.deepEqual(visibleSession.chats.get(), []);
		assert.equal(visibleSession.activeChat.get(), undefined);

		session.chats.set([session.chat], undefined);
		management.setSessionsAndFire(
			[session.model],
			[{ kind: SessionTransitionKind.Changed, session: session.model }],
		);
		assert.equal(service.activeSession.get(), visibleSession);
		assert.deepEqual(visibleSession.openChats.get(), [session.chat]);
		assert.equal(visibleSession.activeChat.get(), undefined);
	} finally {
		store.dispose();
	}
});

test('SessionsService focuses the authoritative fallback after provider and draft removal', async () => {
	const first = createSession('fallback-first');
	const second = createSession('fallback-second');
	const draft = createSession('fallback-draft', SessionStatus.Draft);
	const { store, management, part, service } = createHarness([first.model, second.model]);
	management.createDraft = () => draft.model;
	try {
		service.openSession(first.model.sessionId);
		service.setSessionSticky(service.activeSession.get()!, true);
		service.openSession(second.model.sessionId);
		const firstVisible = service.visibleSessions.get().find((slot): slot is IActiveSession =>
			!('kind' in slot) && slot.sessionId === first.model.sessionId,
		)!;
		const focusCountBeforeRemoval = part.focusCalls.length;
		management.setSessionsAndFire(
			[first.model],
			[{ kind: SessionTransitionKind.Removed, session: second.model }],
		);
		assert.equal(service.activeSession.get(), firstVisible);
		assert.equal(part.focusCalls.length, focusCountBeforeRemoval + 1);
		assert.equal(part.focusCalls.at(-1), firstVisible);
		assert.deepEqual(part.calls.slice(-2), ['update', 'focus']);

		await service.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId: 'provider.test',
			draft: {
				sessionType: 'provider.test.default',
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
		});
		const visibleDraft = service.activeSession.get()!;
		const focusCountBeforeDraftClose = part.focusCalls.length;
		service.closeSession(visibleDraft);
		assert.equal(service.activeSession.get(), firstVisible);
		assert.equal(part.focusCalls.length, focusCountBeforeDraftClose + 1);
		assert.equal(part.focusCalls.at(-1), firstVisible);

		await service.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId: 'provider.test',
			draft: {
				sessionType: 'provider.test.default',
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
		});
		const focusCountBeforeProviderRemoval = part.focusCalls.length;
		management.removeDraftWithProvider();
		assert.equal(service.activeSession.get(), firstVisible);
		assert.equal(part.focusCalls.length, focusCountBeforeProviderRemoval + 1);
		assert.equal(part.focusCalls.at(-1), firstVisible);
	} finally {
		store.dispose();
	}
});

test('SessionsService does not focus for non-active removal and focuses once per transition batch', () => {
	const first = createSession('batch-first');
	const second = createSession('batch-second');
	const third = createSession('batch-third');
	const { store, management, part, service } = createHarness([first.model, second.model, third.model]);
	try {
		service.openSession(first.model.sessionId);
		service.setSessionSticky(service.activeSession.get()!, true);
		service.openSession(second.model.sessionId);
		service.setSessionSticky(service.activeSession.get()!, true);
		service.openSession(third.model.sessionId);
		const thirdVisible = service.activeSession.get()!;
		const focusCountBeforeBackgroundRemoval = part.focusCalls.length;
		management.setSessionsAndFire(
			[second.model, third.model],
			[{ kind: SessionTransitionKind.Removed, session: first.model }],
		);
		assert.equal(service.activeSession.get(), thirdVisible);
		assert.equal(part.focusCalls.length, focusCountBeforeBackgroundRemoval);

		const focusCountBeforeBatch = part.focusCalls.length;
		management.setSessionsAndFire(
			[],
			[
				{ kind: SessionTransitionKind.Removed, session: second.model },
				{ kind: SessionTransitionKind.Removed, session: third.model },
			],
		);
		assert.equal(service.activeSession.get(), undefined);
		assert.equal(part.focusCalls.length, focusCountBeforeBatch + 1);
		assert.equal(part.focusCalls.at(-1), undefined);
		assert.deepEqual(part.calls.slice(-2), ['update', 'focus']);
	} finally {
		store.dispose();
	}
});

test('SessionsService persists dirty view state only during the platform save cycle', () => {
	const session = createSession('save-cycle');
	const storage = createStorageService();
	const { store, service } = createHarness([session.model], storage);
	try {
		assert.equal(storage.storeCount, 0);
		service.openSession(session.model.sessionId);
		assert.equal(storage.storeCount, 0);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 1);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 1);
		service.setSessionSticky(service.activeSession.get()!, true);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 2);
	} finally {
		store.dispose();
		storage.dispose();
	}
});

test('SessionsService removes retained view state after authoritative Session deletion', () => {
	const session = createSession('removed-view-state');
	const peer = createChat(
		'test-chat:/removed-view-state/peer',
		ChatInteractivity.Full,
		{ kind: ChatOriginKind.User },
	);
	session.chats.set([session.chat, peer], undefined);
	const storage = createStorageService();
	const { store, management, service } = createHarness([session.model], storage);
	try {
		service.openSession(session.model.sessionId);
		service.closeChat(service.activeSession.get()!, peer);
		storage.fireWillSave();
		management.setSessionsAndFire(
			[],
			[{ kind: SessionTransitionKind.Removed, session: session.model }],
		);
		storage.fireWillSave();
		const stored = storage.get('sessions.viewState', StorageScope.APPLICATION);
		assert.ok(stored);
		const snapshot = JSON.parse(stored) as {
			readonly sessionViewStates: readonly { readonly sessionId: string }[];
		};
		assert.equal(
			snapshot.sessionViewStates.some(entry => entry.sessionId === session.model.sessionId),
			false,
		);
	} finally {
		store.dispose();
		storage.dispose();
	}
});

test('SessionsService restores visible slots and per-Session Chat state after reload', () => {
	const first = createSession('reload-first');
	const peer = createChat(
		'test-chat:/reload-first/peer',
		ChatInteractivity.Full,
		{ kind: ChatOriginKind.User },
	);
	first.chats.set([first.chat, peer], undefined);
	const second = createSession('reload-second');
	const storage = createStorageService();
	const firstHarness = createHarness([first.model, second.model], storage);
	try {
		firstHarness.service.openSession(first.model.sessionId);
		const firstVisible = firstHarness.service.activeSession.get()!;
		firstHarness.service.setSessionSticky(firstVisible, true);
		firstHarness.service.openChat(first.model, peer.resource);
		assert.equal(firstVisible.activeChat.get(), peer);
		firstHarness.service.closeChat(firstVisible, peer);
		assert.equal(firstVisible.activeChat.get(), undefined);
		firstHarness.service.openSession(second.model.sessionId);
		storage.fireWillSave();
	} finally {
		firstHarness.store.dispose();
	}

	const secondHarness = createHarness([first.model, second.model], storage);
	try {
		const restoredSlots = secondHarness.service.visibleSessions.get();
		assert.deepEqual(restoredSlots.map(slot => 'kind' in slot ? slot.kind : slot.sessionId), [
			first.model.sessionId,
			second.model.sessionId,
		]);
		assert.equal(secondHarness.service.activeSession.get()?.sessionId, second.model.sessionId);
		const restoredFirst = restoredSlots.find((slot): slot is IActiveSession =>
			!('kind' in slot) && slot.sessionId === first.model.sessionId,
		)!;
		assert.equal(restoredFirst.sticky.get(), true);
		assert.equal(restoredFirst.activeChat.get(), undefined);
		assert.deepEqual(restoredFirst.closedChats.get(), [peer]);
		assert.equal(secondHarness.service.activeSession.get()?.activeChat.get(), undefined);
	} finally {
		secondHarness.store.dispose();
		storage.dispose();
	}
});

test('SessionsService completes persisted slot restoration as providers hydrate', () => {
	const first = createSession('delayed-restore-first');
	const second = createSession('delayed-restore-second');
	const storage = createStorageService();
	const firstHarness = createHarness([first.model, second.model], storage);
	try {
		firstHarness.service.openSession(first.model.sessionId);
		firstHarness.service.setSessionSticky(firstHarness.service.activeSession.get()!, true);
		firstHarness.service.openSession(second.model.sessionId);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 1);
	} finally {
		firstHarness.store.dispose();
	}

	const secondHarness = createHarness([], storage);
	try {
		secondHarness.part.emitFocusEventOnFocusCall = true;
		assert.equal(secondHarness.service.activeSession.get(), undefined);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 1);

		secondHarness.management.setSessionsAndFire(
			[first.model],
			[{ kind: SessionTransitionKind.Added, session: first.model }],
		);
		assert.deepEqual(
			secondHarness.service.visibleSessions.get().map(slot => 'kind' in slot ? slot.kind : slot.sessionId),
			[first.model.sessionId],
		);
		assert.equal(secondHarness.service.activeSession.get()?.sessionId, first.model.sessionId);
		assert.equal(secondHarness.service.activeSession.get()?.sticky.get(), true);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 1);

		secondHarness.management.setSessionsAndFire(
			[first.model, second.model],
			[{ kind: SessionTransitionKind.Added, session: second.model }],
		);
		assert.deepEqual(
			secondHarness.service.visibleSessions.get().map(slot => 'kind' in slot ? slot.kind : slot.sessionId),
			[first.model.sessionId, second.model.sessionId],
		);
		assert.equal(secondHarness.service.activeSession.get()?.sessionId, second.model.sessionId);
		storage.fireWillSave();
		assert.equal(storage.storeCount, 2);
	} finally {
		secondHarness.store.dispose();
		storage.dispose();
	}
});

test('SessionsService reuses the active wrapper while later persisted slots hydrate', () => {
	const first = createSession('incremental-restore-first');
	const second = createSession('incremental-restore-second');
	const storage = createStorageService();
	const firstHarness = createHarness([first.model, second.model], storage);
	try {
		firstHarness.service.openSession(first.model.sessionId);
		const firstVisible = firstHarness.service.activeSession.get()!;
		firstHarness.service.setSessionSticky(firstVisible, true);
		firstHarness.service.openSession(second.model.sessionId);
		firstHarness.service.setActiveSession(firstVisible);
		storage.fireWillSave();
	} finally {
		firstHarness.store.dispose();
	}

	const secondHarness = createHarness([], storage);
	try {
		secondHarness.part.emitFocusEventOnFocusCall = true;
		secondHarness.management.setSessionsAndFire(
			[first.model],
			[{ kind: SessionTransitionKind.Added, session: first.model }],
		);
		const restoredFirst = secondHarness.service.activeSession.get()!;
		const focusCount = secondHarness.part.focusCalls.length;

		secondHarness.management.setSessionsAndFire(
			[first.model, second.model],
			[{ kind: SessionTransitionKind.Added, session: second.model }],
		);
		assert.equal(secondHarness.service.visibleSessions.get()[0], restoredFirst);
		assert.equal(secondHarness.service.activeSession.get(), restoredFirst);
		assert.equal(secondHarness.part.focusCalls.length, focusCount);
	} finally {
		secondHarness.store.dispose();
		storage.dispose();
	}
});
