/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { autorun, observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type IChatOrigin,
	type ISession,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import {
	VisibleSession,
	VisibleSessions,
	type IVisibleSessionViewState,
} from 'cs/sessions/services/sessions/browser/visibleSessions';
import { isNewSessionSlot } from 'cs/sessions/services/sessions/common/sessionsView';

interface ITestChat {
	readonly model: IChat;
	readonly interactivity: ReturnType<typeof observableValue<ChatInteractivity>>;
}

interface ITestSession {
	readonly model: ISession;
	readonly chats: ReturnType<typeof observableValue<readonly IChat[]>>;
	readonly mainChat: ReturnType<typeof observableValue<IChat>>;
	readonly title: ReturnType<typeof observableValue<string>>;
}

function createChat(
	resource: string,
	options: {
		readonly origin?: IChatOrigin;
		readonly interactivity?: ChatInteractivity;
	} = {},
): ITestChat {
	const interactivity = observableValue(
		`interactivity-${resource}`,
		options.interactivity ?? ChatInteractivity.Full,
	);
	return {
		interactivity,
		model: {
			resource: URI.parse(resource),
			createdAt: new Date(1),
			title: observableValue(`title-${resource}`, resource),
			updatedAt: observableValue(`updated-${resource}`, new Date(1)),
			status: observableValue(`status-${resource}`, SessionStatus.Completed),
			isRead: observableValue(`read-${resource}`, true),
			modelId: observableValue<string | undefined>(`model-${resource}`, undefined),
			interactivity,
			capabilities: observableValue(`capabilities-${resource}`, {
				supportsRename: true,
				supportsDelete: !!options.origin,
			}),
			origin: options.origin,
		},
	};
}

function createSession(
	name: string,
	chatModels?: readonly IChat[],
	mainChatModel?: IChat,
): ITestSession {
	const resource = URI.parse(`test-session:/${name}`);
	const mainChat = mainChatModel ?? createChat(`test-chat:/${name}/main`).model;
	const chats = observableValue<readonly IChat[]>(`chats-${name}`, chatModels ?? [mainChat]);
	const mainChatObservable = observableValue<IChat>(`main-${name}`, mainChat);
	const title = observableValue(`session-title-${name}`, `Session ${name}`);
	return {
		chats,
		mainChat: mainChatObservable,
		title,
		model: {
			sessionId: toSessionId('provider.test', resource),
			resource,
			providerId: 'provider.test',
			sessionType: 'provider.test.default',
			createdAt: new Date(1),
			title,
			updatedAt: observableValue(`session-updated-${name}`, new Date(1)),
			status: observableValue(`session-status-${name}`, SessionStatus.Completed),
			isRead: observableValue(`session-read-${name}`, true),
			isArchived: observableValue(`session-archived-${name}`, false),
			workspace: observableValue(`session-workspace-${name}`, {
				kind: SessionWorkspaceKind.WorkspaceLess,
			}),
			changes: observableValue(`session-changes-${name}`, []),
			mainChat: mainChatObservable,
			chats,
			capabilities: observableValue(`session-capabilities-${name}`, {
				supportsMultipleChats: true,
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

function createVisibleSessions(viewStates = new Map<string, IVisibleSessionViewState>()): VisibleSessions {
	return new VisibleSessions(viewStates, () => {});
}

function createVisibleSession(session: ISession): VisibleSession {
	return new VisibleSession(session, session.mainChat.get(), undefined, () => {});
}

test('VisibleSessions starts with one explicit new-Session slot and replaces only non-sticky slots', () => {
	const visibility = createVisibleSessions();
	const consistency = autorun(reader => {
		const slots = visibility.visibleSessions.read(reader);
		const active = visibility.activeSession.read(reader);
		assert.equal(active === undefined || slots.includes(active), true);
	});
	try {
		assert.equal(visibility.visibleSessions.get().length, 1);
		assert.equal(isNewSessionSlot(visibility.visibleSessions.get()[0]), true);
		assert.equal(visibility.activeSession.get(), undefined);

		const first = visibility.setActive(createSession('first').model)!;
		visibility.setSticky(first, true);
		const second = visibility.setActive(createSession('second').model)!;
		assert.deepEqual(visibility.visibleSessions.get(), [first, second]);

		visibility.setActiveVisibleSession(first);
		const third = visibility.setActive(createSession('third').model)!;
		assert.deepEqual(visibility.visibleSessions.get(), [first, third]);
		assert.equal(visibility.activeSession.get(), third);

		visibility.setActive(undefined);
		assert.equal(isNewSessionSlot(visibility.visibleSessions.get()[1]), true);
		assert.equal(visibility.activeSession.get(), undefined);
	} finally {
		consistency.dispose();
		visibility.dispose();
	}
});

test('VisibleSession enforces main, Hidden, Tool, peer, and fork presentation semantics', () => {
	const main = createChat('test-chat:/semantics/main');
	const peer = createChat('test-chat:/semantics/peer', { origin: { kind: ChatOriginKind.User } });
	const fork = createChat('test-chat:/semantics/fork', {
		origin: { kind: ChatOriginKind.Fork, parentChat: main.model.resource },
	});
	const tool = createChat('test-chat:/semantics/tool', {
		origin: { kind: ChatOriginKind.Tool, parentChat: main.model.resource },
		interactivity: ChatInteractivity.ReadOnly,
	});
	const hidden = createChat('test-chat:/semantics/hidden', {
		origin: { kind: ChatOriginKind.Tool, parentChat: main.model.resource },
		interactivity: ChatInteractivity.Hidden,
	});
	const session = createSession('semantics', [main.model, peer.model, fork.model, tool.model, hidden.model], main.model);
	const visible = createVisibleSession(session.model);
	try {
		assert.deepEqual(visible.openChats.get(), [main.model, peer.model, fork.model]);
		assert.deepEqual(visible.visibleChatTabs.get(), [main.model, peer.model, fork.model]);
		assert.deepEqual(visible.closedChats.get(), []);
		assert.throws(() => visible.closeChat(main.model), /main Chat/);
		assert.throws(() => visible.openChat(hidden.model), /Hidden Chat/);
		assert.throws(() => visible.setActiveChat(tool.model), /must be opened/);

		visible.openChat(tool.model);
		assert.equal(visible.activeChat.get(), tool.model);
		assert.deepEqual(visible.openChats.get(), [main.model, peer.model, fork.model, tool.model]);
		assert.deepEqual(visible.visibleChatTabs.get(), [main.model, peer.model, fork.model, tool.model]);
		visible.closeChat(tool.model);
		assert.equal(visible.activeChat.get(), fork.model);
		assert.deepEqual(visible.openChats.get(), [main.model, peer.model, fork.model]);
		assert.equal(visible.closedChats.get().includes(tool.model), false);

		visible.openChat(peer.model);
		visible.closeChat(peer.model);
		assert.equal(visible.closedChats.get()[0], peer.model);
		assert.equal(visible.visibleChatTabs.get().includes(peer.model), false);
		visible.openChat(peer.model);
		assert.equal(visible.activeChat.get(), peer.model);
	} finally {
		visible.dispose();
	}
});

test('Explicit Session replacement preserves wrapper identity and Chat view state by URI', () => {
	const main = createChat('test-chat:/replacement/main');
	const peer = createChat('test-chat:/replacement/peer', { origin: { kind: ChatOriginKind.User } });
	const from = createSession('replacement', [main.model, peer.model], main.model);
	const visibility = createVisibleSessions();
	let titleObserver: { dispose(): void } | undefined;
	let replacementConsistency: { dispose(): void } | undefined;
	try {
		const wrapper = visibility.setActive(from.model)!;
		const observedTitles: string[] = [];
		titleObserver = autorun(reader => observedTitles.push(wrapper.title.read(reader)));
		replacementConsistency = autorun(reader => {
			const chats = wrapper.chats.read(reader);
			const activeChat = wrapper.activeChat.read(reader);
			const title = wrapper.title.read(reader);
			assert.equal(chats.includes(activeChat), true);
			if (title === 'Replacement title' || title === 'Current title') {
				assert.equal(chats.every(chat => chat !== main.model && chat !== peer.model), true);
			}
		});
		visibility.setSticky(wrapper, true);
		visibility.closeChat(wrapper, peer.model);

		const replacementMain = createChat('test-chat:/replacement/main');
		const replacementPeer = createChat('test-chat:/replacement/peer', { origin: { kind: ChatOriginKind.User } });
		const to = createSession('replacement', [replacementMain.model, replacementPeer.model], replacementMain.model);
		to.title.set('Replacement title', undefined);
		assert.throws(() => visibility.setActive(to.model), /explicit replacement/);
		visibility.replaceSession(from.model, to.model);

		assert.equal(visibility.visibleSessions.get()[0], wrapper);
		assert.equal(wrapper.sticky.get(), true);
		assert.equal(wrapper.title.get(), 'Replacement title');
		assert.deepEqual(wrapper.closedChats.get(), [replacementPeer.model]);
		from.title.set('Stale title', undefined);
		assert.equal(wrapper.title.get(), 'Replacement title');
		to.title.set('Current title', undefined);
		assert.equal(observedTitles.at(-1), 'Current title');
		visibility.removeSession(from.model);
		assert.equal(visibility.visibleSessions.get()[0], wrapper);
		visibility.openChat(wrapper, replacementPeer.model);
		assert.equal(wrapper.activeChat.get(), replacementPeer.model);
	} finally {
		replacementConsistency?.dispose();
		titleObserver?.dispose();
		visibility.dispose();
	}
});

test('Explicit Session replacement migrates view state to a new stable Session identity', () => {
	const main = createChat('test-chat:/identity-replacement/main');
	const peer = createChat('test-chat:/identity-replacement/peer', { origin: { kind: ChatOriginKind.User } });
	const from = createSession('identity-replacement-draft', [main.model, peer.model], main.model);
	const replacementMain = createChat('test-chat:/identity-replacement/main');
	const replacementPeer = createChat('test-chat:/identity-replacement/peer', { origin: { kind: ChatOriginKind.User } });
	const to = createSession(
		'identity-replacement-committed',
		[replacementMain.model, replacementPeer.model],
		replacementMain.model,
	);
	const viewStates = new Map<string, IVisibleSessionViewState>();
	const visibility = createVisibleSessions(viewStates);
	try {
		const wrapper = visibility.setActive(from.model)!;
		visibility.openChat(wrapper, peer.model);
		visibility.setSticky(wrapper, true);
		visibility.replaceSession(from.model, to.model);

		assert.equal(wrapper.sessionId, to.model.sessionId);
		assert.equal(wrapper.activeChat.get(), replacementPeer.model);
		assert.equal(wrapper.sticky.get(), true);
		assert.equal(viewStates.has(from.model.sessionId), false);
		assert.equal(viewStates.has(to.model.sessionId), true);
	} finally {
		visibility.dispose();
	}
});

test('Explicit Session replacement migrates retained state when its slot is not mounted', () => {
	const main = createChat('test-chat:/retained-replacement/main');
	const peer = createChat('test-chat:/retained-replacement/peer', { origin: { kind: ChatOriginKind.User } });
	const from = createSession('retained-replacement-draft', [main.model, peer.model], main.model);
	const replacementMain = createChat('test-chat:/retained-replacement/main');
	const replacementPeer = createChat('test-chat:/retained-replacement/peer', { origin: { kind: ChatOriginKind.User } });
	const to = createSession(
		'retained-replacement-committed',
		[replacementMain.model, replacementPeer.model],
		replacementMain.model,
	);
	const viewStates = new Map<string, IVisibleSessionViewState>();
	const visibility = createVisibleSessions(viewStates);
	try {
		const wrapper = visibility.setActive(from.model)!;
		visibility.openChat(wrapper, peer.model);
		visibility.setActive(createSession('retained-replacement-other').model);
		visibility.replaceSession(from.model, to.model);

		assert.equal(viewStates.has(from.model.sessionId), false);
		assert.equal(viewStates.has(to.model.sessionId), true);
		const restored = visibility.setActive(to.model)!;
		assert.equal(restored.activeChat.get(), replacementPeer.model);
	} finally {
		visibility.dispose();
	}
});

test('Chat reconciliation falls back to main and admits new peer Chats without guessing replacements', () => {
	const main = createChat('test-chat:/reconcile/main');
	const peer = createChat('test-chat:/reconcile/peer', { origin: { kind: ChatOriginKind.User } });
	const session = createSession('reconcile', [main.model, peer.model], main.model);
	const visibility = createVisibleSessions();
	try {
		const wrapper = visibility.setActive(session.model)!;
		visibility.openChat(wrapper, peer.model);
		peer.interactivity.set(ChatInteractivity.Hidden, undefined);
		assert.equal(wrapper.activeChat.get(), main.model);
		assert.deepEqual(wrapper.openChats.get(), [main.model]);

		const nextPeer = createChat('test-chat:/reconcile/next', { origin: { kind: ChatOriginKind.User } });
		session.chats.set([main.model, peer.model, nextPeer.model], undefined);
		assert.deepEqual(wrapper.visibleChatTabs.get(), [main.model, nextPeer.model]);
	} finally {
		visibility.dispose();
	}
});

test('Chat reconciliation preserves closed and shown state across temporary Hidden interactivity', () => {
	const main = createChat('test-chat:/hidden-state/main');
	const peer = createChat('test-chat:/hidden-state/peer', { origin: { kind: ChatOriginKind.User } });
	const tool = createChat('test-chat:/hidden-state/tool', {
		origin: { kind: ChatOriginKind.Tool, parentChat: main.model.resource },
		interactivity: ChatInteractivity.ReadOnly,
	});
	const session = createSession('hidden-state', [main.model, peer.model, tool.model], main.model);
	const visible = createVisibleSession(session.model);
	try {
		visible.closeChat(peer.model);
		visible.openChat(tool.model);
		peer.interactivity.set(ChatInteractivity.Hidden, undefined);
		tool.interactivity.set(ChatInteractivity.Hidden, undefined);
		assert.deepEqual(visible.visibleChatTabs.get(), [main.model]);

		peer.interactivity.set(ChatInteractivity.Full, undefined);
		tool.interactivity.set(ChatInteractivity.ReadOnly, undefined);
		assert.deepEqual(visible.closedChats.get(), [peer.model]);
		assert.deepEqual(visible.visibleChatTabs.get(), [main.model, tool.model]);

		session.chats.set([main.model], undefined);
		session.chats.set([main.model, peer.model, tool.model], undefined);
		assert.deepEqual(visible.closedChats.get(), []);
		assert.deepEqual(visible.visibleChatTabs.get(), [main.model, peer.model]);
	} finally {
		visible.dispose();
	}
});

test('All-sticky slots append and an explicitly un-stuck MRU slot is replaced next', () => {
	const visibility = createVisibleSessions();
	try {
		const first = visibility.setActive(createSession('sticky-first').model)!;
		visibility.setSticky(first, true);
		const second = visibility.setActive(createSession('sticky-second').model)!;
		visibility.setSticky(second, true);
		visibility.setActiveVisibleSession(first);
		const third = visibility.setActive(createSession('sticky-third').model)!;
		assert.deepEqual(visibility.visibleSessions.get(), [first, second, third]);

		visibility.setSticky(second, false);
		visibility.setActiveVisibleSession(first);
		const fourth = visibility.setActive(createSession('sticky-fourth').model)!;
		assert.deepEqual(visibility.visibleSessions.get(), [first, fourth, third]);
	} finally {
		visibility.dispose();
	}
});

test('Non-sticky slot replacement restores Session-owned Chat and sticky view state', () => {
	const main = createChat('test-chat:/view-state/main');
	const activePeer = createChat('test-chat:/view-state/active', { origin: { kind: ChatOriginKind.User } });
	const closedPeer = createChat('test-chat:/view-state/closed', { origin: { kind: ChatOriginKind.User } });
	const firstSession = createSession(
		'view-state',
		[main.model, activePeer.model, closedPeer.model],
		main.model,
	);
	const viewStates = new Map<string, IVisibleSessionViewState>();
	const visibility = createVisibleSessions(viewStates);
	try {
		const first = visibility.setActive(firstSession.model)!;
		visibility.closeChat(first, closedPeer.model);
		visibility.openChat(first, activePeer.model);
		visibility.setActive(createSession('view-state-replacement').model);

		const restored = visibility.setActive(firstSession.model)!;
		assert.notEqual(restored, first);
		assert.equal(restored.activeChat.get(), activePeer.model);
		assert.deepEqual(restored.closedChats.get(), [closedPeer.model]);
		assert.deepEqual(restored.visibleChatTabs.get(), [main.model, activePeer.model]);

		visibility.setSticky(restored, true);
		visibility.removeSession(restored);
		const restoredSticky = visibility.setActive(firstSession.model)!;
		assert.equal(restoredSticky.sticky.get(), true);
	} finally {
		visibility.dispose();
	}
});

test('Removing an active slot prefers its left neighbour and releases old model subscriptions', () => {
	const visibility = createVisibleSessions();
	let oldTitleObserver: { dispose(): void } | undefined;
	try {
		const firstModel = createSession('remove-first');
		const first = visibility.setActive(firstModel.model)!;
		visibility.setSticky(first, true);
		const second = visibility.setActive(createSession('remove-second').model)!;
		visibility.setSticky(second, true);
		const third = visibility.setActive(createSession('remove-third').model)!;
		visibility.setActiveVisibleSession(second);
		visibility.removeSession(second);
		assert.equal(visibility.activeSession.get(), first);
		assert.deepEqual(visibility.visibleSessions.get(), [first, third]);

		let observedTitle = first.title.get();
		oldTitleObserver = autorun(reader => {
			observedTitle = first.title.read(reader);
		});
		visibility.removeSession(firstModel.model);
		firstModel.title.set('Must not propagate', undefined);
		assert.notEqual(observedTitle, 'Must not propagate');
	} finally {
		oldTitleObserver?.dispose();
		visibility.dispose();
	}
});
