/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

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

const baseSessionCapabilities: ISessionCapabilities = {
	supportsCreateChat: false,
	maximumChatCount: undefined,
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
		origin: options.origin ?? { kind: ChatOriginKind.User },
	};
}

function createSession(options: {
	readonly chats?: readonly IChat[];
	readonly capabilities?: Partial<ISessionCapabilities>;
	readonly workspace?: ISessionWorkspaceState;
	readonly sessionId?: string;
} = {}): ISession {
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
		chats: constObservable(options.chats ?? []),
		capabilities: constObservable({
			...baseSessionCapabilities,
			...options.capabilities,
		}),
	};
}

test('Session invariants accept empty and ordered equal-status Chat catalogs', () => {
	const userChat = createChat(URI.parse('test-chat:/user'), {
		capabilities: {
			supportsRename: true,
			supportsDelete: true,
		},
	});
	const forkChat = createChat(URI.parse('test-chat:/fork'), {
		origin: {
			kind: ChatOriginKind.Fork,
			parentChat: userChat.resource,
		},
	});
	const workerChat = createChat(URI.parse('test-chat:/worker'), {
		interactivity: ChatInteractivity.Hidden,
		origin: {
			kind: ChatOriginKind.Tool,
			parentChat: forkChat.resource,
		},
		capabilities: {
			supportsRename: false,
			supportsDelete: false,
		},
	});

	assert.doesNotThrow(() => assertSessionInvariants(createSession()));
	assert.doesNotThrow(() => assertSessionInvariants(createSession({
		chats: [workerChat, forkChat, userChat],
		capabilities: {
			supportsCreateChat: true,
			maximumChatCount: 4,
			supportsFork: true,
		},
	})));
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

test('Session capability changes do not invalidate authoritative Chat history', () => {
	const userChat = createChat(URI.parse('test-chat:/user'));
	const peerChat = createChat(URI.parse('test-chat:/peer'));
	const forkChat = createChat(URI.parse('test-chat:/fork'), {
		origin: {
			kind: ChatOriginKind.Fork,
			parentChat: userChat.resource,
		},
	});

	assert.doesNotThrow(() => assertSessionInvariants(createSession({
		chats: [userChat, peerChat, forkChat],
		capabilities: {
			supportsCreateChat: false,
			maximumChatCount: 0,
			supportsFork: false,
		},
	})));
	assert.doesNotThrow(() => assertSessionInvariants(createSession({
		chats: [userChat],
		capabilities: {
			supportsCreateChat: true,
			maximumChatCount: undefined,
			supportsFork: true,
		},
	})));
});

test('Session invariants reject invalid capacity, identity, membership, and origin state', () => {
	const userChat = createChat(URI.parse('test-chat:/user'));
	const duplicateUser = createChat(userChat.resource);
	const missingOrigin = {
		...createChat(URI.parse('test-chat:/missing-origin')),
		origin: undefined as never,
	};
	const externalParentWorker = createChat(URI.parse('test-chat:/external-parent-worker'), {
		origin: {
			kind: ChatOriginKind.Tool,
			parentChat: URI.parse('test-chat:/outside'),
		},
	});
	const selfParented = createChat(URI.parse('test-chat:/self-parented'), {
		origin: {
			kind: ChatOriginKind.Fork,
			parentChat: URI.parse('test-chat:/self-parented'),
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

	const invalidSessions = [
		createSession({ chats: [userChat], sessionId: 'not-canonical' }),
		createSession({
			chats: [userChat],
			capabilities: { maximumChatCount: -1 },
		}),
		createSession({
			chats: [userChat],
			capabilities: { maximumChatCount: 1.5 },
		}),
		createSession({ chats: [userChat, duplicateUser] }),
		createSession({ chats: [missingOrigin] }),
		createSession({ chats: [userChat, externalParentWorker] }),
		createSession({ chats: [selfParented] }),
		createSession({ chats: [cycleA, cycleB] }),
	];

	const messages = invalidSessions.map(session => {
		try {
			assertSessionInvariants(session);
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});

	const sessionId = toSessionId(TestProviderId, TestSessionResource);
	assert.deepEqual(messages, [
		"Session 'not-canonical' does not use its canonical provider-aware identity.",
		`Session '${sessionId}' has an invalid maximum Chat count.`,
		`Session '${sessionId}' has an invalid maximum Chat count.`,
		`Session '${sessionId}' contains duplicate Chat resources.`,
		`Session '${sessionId}' has a Chat without an origin.`,
		`Session '${sessionId}' has a child Chat whose parent is outside the Session.`,
		`Session '${sessionId}' has a self-parented Chat.`,
		`Session '${sessionId}' contains a cycle in its Chat origins.`,
	]);
});
