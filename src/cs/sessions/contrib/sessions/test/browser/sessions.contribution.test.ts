/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { Event } from 'cs/base/common/event';
import { observableValue, type ISettableObservable } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { isIMenuItem, MenuRegistry } from 'cs/platform/actions/common/actions';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import { ContextKeyServiceImpl } from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import { SessionsMenuIds } from 'cs/sessions/common/menus';
import { SessionsCommandIds } from 'cs/sessions/common/sessionCommands';
import { SessionsActionsContribution } from 'cs/sessions/contrib/sessions/browser/sessions.contribution';
import {
	ISessionsService,
	type IOpenNewSessionOptions,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
	type ISessionCapabilities,
	type SessionId,
	SessionStatus,
	SessionWorkspaceKind,
	type SessionsProviderId,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import {
	isCreateChatAvailable,
	isForkChatAvailable,
} from 'cs/sessions/services/sessions/common/sessionActions';
import {
	ISessionsManagementService,
	type IProviderSessionType,
	type ISessionChatOwner,
	type ISessionDraftChangeEvent,
	type ISessionsManagementChangeEvent,
	type ISessionsModelsChangeEvent,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import type { ISessionDraftOptions } from 'cs/sessions/services/sessions/common/sessionsProvider';
import {
	type IActiveSession,
	type IVisibleSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';
import type { ISessionModel } from 'cs/sessions/services/sessions/common/sessionsProvider';
import {
	IDialogService,
	type IConfirmation,
	type IConfirmationResult,
	type IInput,
	type IInputResult,
} from 'cs/workbench/services/dialogs/common/dialogService';

const servicesAccessor = {
	get(): never {
		throw new Error('Session actions must not resolve services through the command accessor.');
	},
} as ServicesAccessor;

const defaultSessionCapabilities: ISessionCapabilities = {
	supportsCreateChat: true,
	maximumChatCount: undefined,
	supportsFork: true,
	supportsRename: true,
	supportsArchive: true,
	supportsDelete: true,
	supportsChanges: false,
	supportsModels: false,
};

class TestSessionsManagementService implements ISessionsManagementService {
	declare readonly _serviceBrand: undefined;
	readonly sessions: ISettableObservable<readonly ISession[]>;
	readonly draftSession = observableValue<ISession | undefined>('sessionActionsDraft', undefined);
	readonly sessionTypes = observableValue<readonly IProviderSessionType[]>('sessionActionsTypes', []);
	readonly onDidChangeSessions = Event.None as Event<ISessionsManagementChangeEvent>;
	readonly onDidChangeDraftSession = Event.None as Event<ISessionDraftChangeEvent>;
	readonly onDidChangeSessionTypes = Event.None;
	readonly onDidChangeModels = Event.None as Event<ISessionsModelsChangeEvent>;
	readonly createCalls: ISession[] = [];
	readonly forkCalls: Array<{ session: ISession; chat: IChat; turnId: string }> = [];
	readonly deleteCalls: Array<{ session: ISession; chat: IChat }> = [];
	createResult: IChat | undefined;
	forkResult: IChat | undefined;

	constructor(sessions: readonly ISession[]) {
		this.sessions = observableValue<readonly ISession[]>('sessionActionsSessions', sessions);
	}

	getSessions(): readonly ISession[] { return this.sessions.get(); }
	getSession(sessionId: SessionId): ISession | undefined {
		return this.sessions.get().find(session => session.sessionId === sessionId);
	}
	getSessionByResource(_providerId: SessionsProviderId, _resource: URI): ISession | undefined { return undefined; }
	getSessionForChatResource(_resource: URI): ISessionChatOwner | undefined { return undefined; }
	async createSessionDraft(_providerId: SessionsProviderId, _options: ISessionDraftOptions): Promise<ISession> {
		throw new Error('Unexpected Session draft creation.');
	}
	discardSessionDraft(_session: ISession): void { throw new Error('Unexpected Session draft discard.'); }
	getModels(_session: ISession, _chat: IChat): readonly ISessionModel[] { return []; }
	sendRequest(_session: ISession, _chat: IChat): Promise<void> {
		throw new Error('Unexpected Session request.');
	}
	async createChat(session: ISession): Promise<IChat> {
		this.createCalls.push(session);
		if (!this.createResult) {
			throw new Error('The test did not configure a created Chat.');
		}
		return this.createResult;
	}
	async forkChat(session: ISession, chat: IChat, turnId: string): Promise<IChat> {
		this.forkCalls.push({ session, chat, turnId });
		if (!this.forkResult) {
			throw new Error('The test did not configure a forked Chat.');
		}
		return this.forkResult;
	}
	renameSession(_session: ISession, _title: string): Promise<void> { throw new Error('Unexpected Session rename.'); }
	renameChat(_session: ISession, _chat: IChat, _title: string): Promise<void> { throw new Error('Unexpected Chat rename.'); }
	setChatModel(_session: ISession, _chat: IChat, _modelId: string | undefined): Promise<void> {
		throw new Error('Unexpected Chat model change.');
	}
	setSessionArchived(_session: ISession, _archived: boolean): Promise<void> {
		throw new Error('Unexpected archive change.');
	}
	releaseSession(_session: ISession): Promise<void> { throw new Error('Unexpected Session release.'); }
	releaseChat(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Unexpected Chat release.'); }
	cancelTurn(_session: ISession, _chat: IChat, _turnId: string): Promise<void> { throw new Error('Unexpected Turn cancellation.'); }
	steerTurn(_session: ISession, _chat: IChat, _turnId: string, _message: string): Promise<void> { throw new Error('Unexpected Turn steering.'); }
	deleteSession(_session: ISession): Promise<void> { throw new Error('Unexpected Session deletion.'); }
	async deleteChat(session: ISession, chat: IChat): Promise<void> {
		this.deleteCalls.push({ session, chat });
	}
}

class TestSessionsService implements ISessionsService {
	declare readonly _serviceBrand: undefined;
	readonly visibleSessions = observableValue<readonly IVisibleSessionSlot[]>('sessionActionsVisible', []);
	readonly activeSession = observableValue<IActiveSession | undefined>('sessionActionsActive', undefined);
	readonly openedChats: Array<{ session: ISession; resource: URI }> = [];

	openSession(_sessionId: SessionId): void { throw new Error('Unexpected Session open.'); }
	async openNewSession(_options?: IOpenNewSessionOptions): Promise<ISession | undefined> {
		throw new Error('Unexpected new Session open.');
	}
	openChat(session: ISession, resource: URI): void { this.openedChats.push({ session, resource }); }
	closeChat(_session: IActiveSession, _chat: IChat): void { throw new Error('Unexpected Chat close.'); }
	reopenChat(_session: IActiveSession, _chat: IChat): void { throw new Error('Unexpected Chat reopen.'); }
	closeSession(_session: IActiveSession | undefined): void { throw new Error('Unexpected Session close.'); }
	setActiveSession(_session: IActiveSession | undefined): void { throw new Error('Unexpected active Session change.'); }
	setSessionSticky(_session: IActiveSession, _sticky: boolean): void { throw new Error('Unexpected sticky change.'); }
	focusSession(_session: IActiveSession | undefined): void { throw new Error('Unexpected Session focus.'); }
}

class TestDialogService implements IDialogService {
	declare readonly _serviceBrand: undefined;
	confirmed = true;
	confirmCount = 0;
	readonly errors: string[] = [];

	async confirm(_confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.confirmCount += 1;
		return { confirmed: this.confirmed };
	}
	async prompt<T>(): Promise<{ result: T | undefined }> { return { result: undefined }; }
	async input(_input: IInput): Promise<IInputResult> { return { value: undefined }; }
	async info(): Promise<void> {}
	async warn(): Promise<void> {}
	async error(message: string): Promise<void> { this.errors.push(message); }
}

function createChat(
	name: string,
	options: {
		readonly supportsDelete?: boolean;
		readonly interactivity?: ChatInteractivity;
	} = {},
): IChat {
	const resource = URI.parse(`test-chat:/${name}`);
	return {
		resource,
		createdAt: new Date(1),
		title: observableValue(`chatTitle-${name}`, `Chat ${name}`),
		updatedAt: observableValue(`chatUpdated-${name}`, new Date(1)),
		status: observableValue(`chatStatus-${name}`, SessionStatus.Completed),
		isRead: observableValue(`chatIsRead-${name}`, true),
		modelId: observableValue<string | undefined>(`chatModel-${name}`, undefined),
		interactivity: observableValue(
			`chatInteractivity-${name}`,
			options.interactivity ?? ChatInteractivity.Full,
		),
		capabilities: observableValue(`chatCapabilities-${name}`, {
			supportsRename: true,
			supportsDelete: options.supportsDelete ?? true,
		}),
		origin: { kind: ChatOriginKind.User },
	};
}

function createSession(
	name: string,
	chats: readonly IChat[],
	capabilities: ISessionCapabilities = defaultSessionCapabilities,
): ISession {
	const resource = URI.parse(`test-session:/${name}`);
	return {
		sessionId: toSessionId('provider.test', resource),
		resource,
		providerId: 'provider.test',
		sessionType: 'provider.test.session',
		createdAt: new Date(1),
		title: observableValue(`sessionTitle-${name}`, `Session ${name}`),
		updatedAt: observableValue(`sessionUpdated-${name}`, new Date(1)),
		status: observableValue(`sessionStatus-${name}`, SessionStatus.Completed),
		isRead: observableValue(`sessionIsRead-${name}`, true),
		isArchived: observableValue(`sessionIsArchived-${name}`, false),
		workspace: observableValue(`sessionWorkspace-${name}`, { kind: SessionWorkspaceKind.WorkspaceLess }),
		changes: observableValue(`sessionChanges-${name}`, []),
		chats: observableValue<readonly IChat[]>(`sessionChats-${name}`, chats),
		capabilities: observableValue(`sessionCapabilities-${name}`, capabilities),
	};
}

function createActiveSession(session: ISession, activeChat: IChat | undefined): IActiveSession {
	return {
		...session,
		activeChat: observableValue('sessionActionActiveChat', activeChat),
		openChats: observableValue('sessionActionOpenChats', session.chats.get()),
		closedChats: observableValue<readonly IChat[]>('sessionActionClosedChats', []),
		visibleChatTabs: observableValue('sessionActionVisibleChatTabs', session.chats.get()),
		sticky: observableValue('sessionActionSticky', false),
	};
}

function getMenuItem(menuId: (typeof SessionsMenuIds)[keyof typeof SessionsMenuIds], commandId: string) {
	const item = MenuRegistry.getMenuItems(menuId).find(candidate =>
		isIMenuItem(candidate) && candidate.command.id === commandId,
	);
	assert.ok(item && isIMenuItem(item));
	return item;
}

async function executeCommand(commandId: string, argument: unknown): Promise<void> {
	const command = commandsRegistry.getCommand(commandId);
	assert.ok(command);
	await Promise.resolve(command.handler(servicesAccessor, argument));
}

suite('Sessions Chat actions', { concurrency: false }, () => {
	test('register typed lifecycle commands under capability-scoped menus', () => {
		const chat = createChat('menus');
		const session = createSession('menus', [chat]);
		const contribution = new SessionsActionsContribution(
			new TestSessionsManagementService([session]),
			new TestSessionsService(),
			new TestDialogService(),
			new ContextKeyServiceImpl(),
		);

		try {
			for (const commandId of Object.values(SessionsCommandIds)) {
				assert.ok(commandsRegistry.getCommand(commandId), `Expected command '${commandId}' to be registered.`);
			}
			assert.deepEqual(
				getMenuItem(SessionsMenuIds.sessionHeader, SessionsCommandIds.createChat).when,
				SessionsContextKeys.sessionHeaderCanCreateChat.isEqualTo(true),
			);
			assert.deepEqual(
				getMenuItem(SessionsMenuIds.chatHeader, SessionsCommandIds.deleteChat).when,
				SessionsContextKeys.chatHeaderSupportsDelete.isEqualTo(true),
			);
			assert.deepEqual(
				getMenuItem(SessionsMenuIds.chatTurn, SessionsCommandIds.forkChat).when,
				SessionsContextKeys.chatTurnCanFork.isEqualTo(true),
			);
		} finally {
			contribution.dispose();
		}

		for (const commandId of Object.values(SessionsCommandIds)) {
			assert.equal(commandsRegistry.getCommand(commandId), null);
		}
		assert.equal(
			MenuRegistry.getMenuItems(SessionsMenuIds.chatHeader).some(item =>
				isIMenuItem(item) && item.command.id === SessionsCommandIds.deleteChat,
			),
			false,
		);
	});

	test('route create, fork, and delete through exact originating identities', async () => {
		const source = createChat('source', { interactivity: ChatInteractivity.ReadOnly });
		const selected = createChat('selected');
		const created = createChat('created');
		const forked = createChat('forked');
		const session = createSession('routing', [source, selected]);
		const activeSession = createActiveSession(session, selected);
		const management = new TestSessionsManagementService([session]);
		management.createResult = created;
		management.forkResult = forked;
		const sessions = new TestSessionsService();
		const dialogs = new TestDialogService();
		const contribution = new SessionsActionsContribution(
			management,
			sessions,
			dialogs,
			new ContextKeyServiceImpl(),
		);

		try {
			await executeCommand(SessionsCommandIds.createChat, activeSession);
			await executeCommand(SessionsCommandIds.forkChat, {
				session: activeSession,
				chat: source,
				turnId: ' turn.7 ',
			});
			await executeCommand(SessionsCommandIds.deleteChat, {
				session: activeSession,
				chat: source,
			});

			assert.deepEqual(management.createCalls, [session]);
			assert.deepEqual(management.forkCalls, [{ session, chat: source, turnId: 'turn.7' }]);
			assert.deepEqual(management.deleteCalls, [{ session, chat: source }]);
			assert.deepEqual(sessions.openedChats, [
				{ session, resource: created.resource },
				{ session, resource: forked.resource },
			]);
			assert.equal(dialogs.confirmCount, 1);
			assert.deepEqual(dialogs.errors, []);
		} finally {
			contribution.dispose();
		}
	});

	test('gate create and fork independently by capability and shared capacity', async () => {
		assert.equal(isCreateChatAvailable({ ...defaultSessionCapabilities, supportsCreateChat: false }, 0), false);
		assert.equal(isCreateChatAvailable({ ...defaultSessionCapabilities, maximumChatCount: 1 }, 0), true);
		assert.equal(isCreateChatAvailable({ ...defaultSessionCapabilities, maximumChatCount: 1 }, 1), false);
		assert.equal(isForkChatAvailable({ ...defaultSessionCapabilities, supportsFork: false }, 0), false);
		assert.equal(isForkChatAvailable({ ...defaultSessionCapabilities, maximumChatCount: 1 }, 0), true);
		assert.equal(isForkChatAvailable({ ...defaultSessionCapabilities, maximumChatCount: 1 }, 1), false);

		const chat = createChat('at-capacity');
		const session = createSession('at-capacity', [chat], {
			...defaultSessionCapabilities,
			maximumChatCount: 1,
		});
		const activeSession = createActiveSession(session, chat);
		const management = new TestSessionsManagementService([session]);
		const contribution = new SessionsActionsContribution(
			management,
			new TestSessionsService(),
			new TestDialogService(),
			new ContextKeyServiceImpl(),
		);

		try {
			await assert.rejects(
				executeCommand(SessionsCommandIds.createChat, activeSession),
				/does not currently support creating another Chat/,
			);
			await assert.rejects(
				executeCommand(SessionsCommandIds.forkChat, {
					session: activeSession,
					chat,
					turnId: 'turn.1',
				}),
				/does not currently support forking another Chat/,
			);
			assert.deepEqual(management.createCalls, []);
			assert.deepEqual(management.forkCalls, []);
		} finally {
			contribution.dispose();
		}
	});

	test('gate deletion only by the addressed Chat capability and preserve cancellation', async () => {
		const deletable = createChat('deletable', { interactivity: ChatInteractivity.ReadOnly });
		const protectedChat = createChat('protected', { supportsDelete: false });
		const session = createSession('delete-gates', [deletable, protectedChat]);
		const activeSession = createActiveSession(session, protectedChat);
		const management = new TestSessionsManagementService([session]);
		const dialogs = new TestDialogService();
		const contribution = new SessionsActionsContribution(
			management,
			new TestSessionsService(),
			dialogs,
			new ContextKeyServiceImpl(),
		);

		try {
			await assert.rejects(
				executeCommand(SessionsCommandIds.deleteChat, { session: activeSession, chat: protectedChat }),
				/does not support delete/,
			);
			assert.equal(dialogs.confirmCount, 0);

			dialogs.confirmed = false;
			await executeCommand(SessionsCommandIds.deleteChat, { session: activeSession, chat: deletable });
			assert.equal(dialogs.confirmCount, 1);
			assert.deepEqual(management.deleteCalls, []);
		} finally {
			contribution.dispose();
		}
	});
});
