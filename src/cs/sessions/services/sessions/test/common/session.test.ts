/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { constObservable } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import {
	assertSessionInvariants,
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type IChatCapabilities,
	type ISession,
	type ISessionCapabilities,
	type ISessionWorkspaceState,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';

const TestProviderId = 'test.sessions.provider';
const TestSessionResource = URI.parse('test-session:/session');
const TestDate = new Date('2026-07-11T00:00:00.000Z');

const DefaultSessionCapabilities: ISessionCapabilities = {
	supportsMultipleChats: false,
	supportsFork: false,
	supportsRename: true,
	supportsArchive: true,
	supportsDelete: true,
	supportsChanges: true,
	supportsModels: true,
};

function createChat(
	resource: URI,
	options: {
		readonly interactivity?: ChatInteractivity;
		readonly origin?: IChat['origin'];
		readonly capabilities?: IChatCapabilities;
	} = {},
): IChat {
	return {
		resource,
		createdAt: TestDate,
		title: constObservable(resource.path),
		updatedAt: constObservable(TestDate),
		status: constObservable(SessionStatus.Draft),
		isRead: constObservable(true),
		modelId: constObservable(undefined),
		interactivity: constObservable(options.interactivity ?? ChatInteractivity.Full),
		capabilities: constObservable(options.capabilities ?? {
			supportsRename: true,
			supportsDelete: true,
		}),
		origin: options.origin,
	};
}

function createSession(options: {
	readonly chats: readonly IChat[];
	readonly mainChat: IChat;
	readonly capabilities?: Partial<ISessionCapabilities>;
	readonly workspace?: ISessionWorkspaceState;
	readonly sessionId?: string;
}): ISession {
	return {
		sessionId: options.sessionId ?? toSessionId(TestProviderId, TestSessionResource),
		resource: TestSessionResource,
		providerId: TestProviderId,
		sessionType: 'test-session-type',
		createdAt: TestDate,
		title: constObservable('Test Session'),
		updatedAt: constObservable(TestDate),
		status: constObservable(SessionStatus.Draft),
		isRead: constObservable(true),
		isArchived: constObservable(false),
		workspace: constObservable(options.workspace ?? { kind: SessionWorkspaceKind.WorkspaceLess }),
		changes: constObservable([]),
		mainChat: constObservable(options.mainChat),
		chats: constObservable(options.chats),
		capabilities: constObservable({
			...DefaultSessionCapabilities,
			...options.capabilities,
		}),
	};
}

function createMainChat(options: Parameters<typeof createChat>[1] = {}): IChat {
	return createChat(URI.parse('test-chat:/main'), {
		...options,
		capabilities: options.capabilities ?? {
			supportsRename: true,
			supportsDelete: false,
		},
	});
}

test('Session invariants accept explicit peer and Multi-Agent worker Chats', () => {
	const mainChat = createMainChat();
	const peerChat = createChat(URI.parse('test-chat:/peer'), {
		origin: { kind: ChatOriginKind.User },
	});
	const forkChat = createChat(URI.parse('test-chat:/fork'), {
		origin: {
			kind: ChatOriginKind.Fork,
			parentChat: mainChat.resource,
		},
	});
	const workerChat = createChat(URI.parse('test-chat:/worker'), {
		interactivity: ChatInteractivity.ReadOnly,
		origin: {
			kind: ChatOriginKind.Tool,
			parentChat: mainChat.resource,
		},
		capabilities: {
			supportsRename: false,
			supportsDelete: false,
		},
	});
	const session = createSession({
		mainChat,
		chats: [mainChat, peerChat, forkChat, workerChat],
		capabilities: {
			supportsMultipleChats: true,
			supportsFork: true,
		},
	});
	const workerOnlySession = createSession({
		mainChat,
		chats: [mainChat, workerChat],
	});

	assert.doesNotThrow(() => {
		assertSessionInvariants(session);
		assertSessionInvariants(workerOnlySession);
	});
});

test('Session identity is deterministic and provider-aware', () => {
	assert.deepEqual(
		[
			toSessionId('provider.a', TestSessionResource),
			toSessionId('provider.b', TestSessionResource),
		],
		[
			'provider.a:test-session:/session',
			'provider.b:test-session:/session',
		],
	);
	assert.notEqual(
		toSessionId('provider:a', URI.parse('test-session:/session')),
		toSessionId('provider', URI.parse('a:test-session:/session')),
	);
	assert.throws(
		() => toSessionId('', TestSessionResource),
		/non-empty and contain no whitespace/,
	);
});

test('Session capabilities gate current operations without invalidating authoritative history', () => {
	const mainChat = createMainChat();
	const peerChat = createChat(URI.parse('test-chat:/peer'), {
		origin: { kind: ChatOriginKind.User },
	});
	const forkChat = createChat(URI.parse('test-chat:/fork'), {
		origin: {
			kind: ChatOriginKind.Fork,
			parentChat: mainChat.resource,
		},
	});

	assert.doesNotThrow(() => assertSessionInvariants(createSession({
		mainChat,
		chats: [mainChat, peerChat, forkChat],
		capabilities: {
			supportsMultipleChats: false,
			supportsFork: false,
		},
		workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
	})));
});

test('Session invariants reject invalid identity, membership, and origin state', () => {
	const validMain = createMainChat();
	const missingMain = createMainChat();
	const duplicateMain = createMainChat();
	const duplicatePeer = createChat(duplicateMain.resource, {
		origin: { kind: ChatOriginKind.User },
	});
	const hiddenMain = createMainChat({ interactivity: ChatInteractivity.Hidden });
	const additionalWithoutOrigin = createChat(URI.parse('test-chat:/missing-origin'));
	const externalParentWorker = createChat(URI.parse('test-chat:/external-parent-worker'), {
		origin: {
			kind: ChatOriginKind.Tool,
			parentChat: URI.parse('test-chat:/outside'),
		},
	});
	const cycleA = createChat(URI.parse('test-chat:/cycle-a'), {
		origin: {
			kind: ChatOriginKind.Tool,
			parentChat: URI.parse('test-chat:/cycle-b'),
		},
	});
	const cycleB = createChat(URI.parse('test-chat:/cycle-b'), {
		origin: {
			kind: ChatOriginKind.Tool,
			parentChat: cycleA.resource,
		},
	});
	const deletableMain = createMainChat({
		capabilities: {
			supportsRename: true,
			supportsDelete: true,
		},
	});

	const invalidSessions = [
		createSession({
			mainChat: validMain,
			chats: [validMain],
			sessionId: 'not-canonical',
		}),
		createSession({ mainChat: missingMain, chats: [validMain] }),
		createSession({
			mainChat: duplicateMain,
			chats: [duplicateMain, duplicatePeer],
			capabilities: { supportsMultipleChats: true },
		}),
		createSession({ mainChat: hiddenMain, chats: [hiddenMain] }),
		createSession({
			mainChat: validMain,
			chats: [validMain, additionalWithoutOrigin],
			capabilities: { supportsMultipleChats: true },
		}),
		createSession({
			mainChat: validMain,
			chats: [validMain, externalParentWorker],
			capabilities: { supportsMultipleChats: true },
		}),
		createSession({
			mainChat: validMain,
			chats: [validMain, cycleA, cycleB],
		}),
		createSession({ mainChat: deletableMain, chats: [deletableMain] }),
	];

	const messages = invalidSessions.map(session => {
		try {
			assertSessionInvariants(session);
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});

	assert.deepEqual(messages, [
		"Session 'not-canonical' does not use its canonical provider-aware identity.",
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' does not contain its main Chat model.`,
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' contains duplicate Chat resources.`,
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' has a hidden main Chat.`,
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' has an additional Chat without an origin.`,
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' has a child Chat whose parent is outside the Session.`,
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' contains a cycle in its Chat origins.`,
		`Session '${toSessionId(TestProviderId, TestSessionResource)}' has a deletable main Chat.`,
	]);
});
