/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Event } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { IQuickInputService } from 'cs/platform/quickinput/common/quickInput';
import { SessionSidebarPartView } from 'cs/sessions/browser/parts/sidebar/sidebarPart';
import {
	ISessionsService,
	OpenNewSessionKind,
	type IOpenNewSessionOptions,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import {
	ISessionsManagementService,
	type ISessionChatOwner,
	type ISessionsManagementChangeEvent,
	type ISessionsModelsChangeEvent,
	type ISessionDraftChangeEvent,
	type IProviderSessionType,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import {
	ChatInteractivity,
	type IChat,
	type ISession,
	type SessionId,
	type SessionsProviderId,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import type { ISessionDraftOptions } from 'cs/sessions/services/sessions/common/sessionsProvider';
import {
	NewSessionSlot,
	type IActiveSession,
	type IVisibleSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';
import type { IChatRequest } from 'cs/workbench/contrib/chat/common/chatRequest';
import type { ILanguageModelChatMetadataAndIdentifier } from 'cs/workbench/contrib/chat/common/languageModels';
import {
	IWorkbenchSidebarEntryService,
	WorkbenchSidebarEntryService,
} from 'cs/workbench/services/sidebar/common/sidebarEntryService';

let cleanupDomEnvironment: (() => void) | undefined;

test.before(() => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

class TestSessionsManagementService implements ISessionsManagementService {
	declare readonly _serviceBrand: undefined;
	readonly sessions = observableValue<readonly ISession[]>('testSidebarSessions', []);
	readonly draftSession = observableValue<ISession | undefined>('testSidebarDraftSession', undefined);
	readonly sessionTypes = observableValue<readonly IProviderSessionType[]>('testSidebarSessionTypes', []);
	readonly onDidChangeSessions = Event.None as Event<ISessionsManagementChangeEvent>;
	readonly onDidChangeDraftSession = Event.None as Event<ISessionDraftChangeEvent>;
	readonly onDidChangeSessionTypes = Event.None;
	readonly onDidChangeModels = Event.None as Event<ISessionsModelsChangeEvent>;

	getSessions(): readonly ISession[] { return this.sessions.get(); }
	getSession(sessionId: SessionId): ISession | undefined { return this.sessions.get().find(session => session.sessionId === sessionId); }
	getSessionByResource(_providerId: SessionsProviderId, _resource: URI): ISession | undefined { return undefined; }
	getSessionForChatResource(_resource: URI): ISessionChatOwner | undefined { return undefined; }
	createSessionDraft(_providerId: SessionsProviderId, _options: ISessionDraftOptions): ISession { throw new Error('Unexpected Session draft creation.'); }
	discardSessionDraft(_session: ISession): void { throw new Error('Unexpected Session draft discard.'); }
	getModels(_session: ISession, _chat: IChat): readonly ILanguageModelChatMetadataAndIdentifier[] { return []; }
	sendRequest(_session: ISession, _chat: IChat, _request: IChatRequest): Promise<void> { throw new Error('Unexpected Session request.'); }
	createChat(_session: ISession): Promise<IChat> { throw new Error('Unexpected Chat creation.'); }
	forkChat(_session: ISession, _sourceChat: IChat, _turnId: string): Promise<IChat> { throw new Error('Unexpected Chat fork.'); }
	renameSession(_session: ISession, _title: string): Promise<void> { throw new Error('Unexpected Session rename.'); }
	renameChat(_session: ISession, _chat: IChat, _title: string): Promise<void> { throw new Error('Unexpected Chat rename.'); }
	setChatModel(_session: ISession, _chat: IChat, _modelId: string | undefined): Promise<void> { throw new Error('Unexpected model change.'); }
	setSessionArchived(_session: ISession, _archived: boolean): Promise<void> { throw new Error('Unexpected archive change.'); }
	deleteSession(_session: ISession): Promise<void> { throw new Error('Unexpected Session deletion.'); }
	deleteChat(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Unexpected Chat deletion.'); }
}

class TestSessionsService implements ISessionsService {
	declare readonly _serviceBrand: undefined;
	readonly visibleSessions = observableValue<readonly IVisibleSessionSlot[]>('testSidebarVisibleSessions', [NewSessionSlot]);
	readonly activeSession = observableValue<IActiveSession | undefined>('testSidebarActiveSession', undefined);
	readonly openNewSessionOptions: IOpenNewSessionOptions[] = [];
	readonly openedSessionIds: SessionId[] = [];

	openSession(sessionId: SessionId): void { this.openedSessionIds.push(sessionId); }
	openNewSession(options: IOpenNewSessionOptions = { kind: OpenNewSessionKind.Empty }): ISession | undefined {
		this.openNewSessionOptions.push(options);
		return undefined;
	}
	openChat(): void { throw new Error('Unexpected Chat open.'); }
	closeChat(): void { throw new Error('Unexpected Chat close.'); }
	reopenChat(): void { throw new Error('Unexpected Chat reopen.'); }
	closeSession(): void { throw new Error('Unexpected Session close.'); }
	setActiveSession(): void { throw new Error('Unexpected active Session change.'); }
	setSessionSticky(): void { throw new Error('Unexpected sticky Session change.'); }
	focusSession(): void { throw new Error('Unexpected Session focus.'); }
}

function createSession(name: string): { readonly model: ISession; readonly title: ReturnType<typeof observableValue<string>> } {
	const resource = URI.parse(`test-session:/${name}`);
	const chatResource = URI.parse(`test-chat:/${name}/main`);
	const title = observableValue(`sidebarSessionTitle-${name}`, `Session ${name}`);
	const mainChat: IChat = {
		resource: chatResource,
		createdAt: new Date(1),
		title: observableValue(`sidebarChatTitle-${name}`, `Chat ${name}`),
		updatedAt: observableValue(`sidebarChatUpdated-${name}`, new Date(1)),
		status: observableValue(`sidebarChatStatus-${name}`, SessionStatus.Completed),
		isRead: observableValue(`sidebarChatRead-${name}`, true),
		modelId: observableValue<string | undefined>(`sidebarChatModel-${name}`, undefined),
		interactivity: observableValue(`sidebarChatInteractivity-${name}`, ChatInteractivity.Full),
		capabilities: observableValue(`sidebarChatCapabilities-${name}`, {
			supportsRename: false,
			supportsDelete: false,
		}),
		origin: undefined,
	};
	return {
		title,
		model: {
			sessionId: toSessionId('provider.test', resource),
			resource,
			providerId: 'provider.test',
			sessionType: 'provider.test.default',
			createdAt: new Date(1),
			title,
			updatedAt: observableValue(`sidebarSessionUpdated-${name}`, new Date(1)),
			status: observableValue(`sidebarSessionStatus-${name}`, SessionStatus.Completed),
			isRead: observableValue(`sidebarSessionRead-${name}`, true),
			isArchived: observableValue(`sidebarSessionArchived-${name}`, false),
			workspace: observableValue(`sidebarSessionWorkspace-${name}`, { kind: SessionWorkspaceKind.WorkspaceLess }),
			changes: observableValue(`sidebarSessionChanges-${name}`, []),
			mainChat: observableValue(`sidebarSessionMainChat-${name}`, mainChat),
			chats: observableValue<readonly IChat[]>(`sidebarSessionChats-${name}`, [mainChat]),
			capabilities: observableValue(`sidebarSessionCapabilities-${name}`, {
				supportsMultipleChats: false,
				supportsFork: false,
				supportsRename: false,
				supportsArchive: false,
				supportsDelete: false,
				supportsChanges: false,
				supportsModels: false,
			}),
		},
	};
}

test('Session Sidebar routes New Chat and authoritative Recents directly through Sessions services', () => {
	const store = new DisposableStore();
	const managementService = new TestSessionsManagementService();
	const sessionsService = new TestSessionsService();
	managementService.sessionTypes.set([{
		providerId: 'provider.test',
		sessionType: {
			id: 'provider.test.default',
			label: 'Default',
			icon: { id: 'chat' },
			supportsWorkspaceLess: true,
		},
	}], undefined);
	const sidebarEntryService = store.add(new WorkbenchSidebarEntryService());
	const instantiationService = store.add(new InstantiationService(new ServiceCollection(
		[ISessionsManagementService, managementService],
		[ISessionsService, sessionsService],
		[IWorkbenchSidebarEntryService, sidebarEntryService],
		[IQuickInputService, { pick: async () => undefined } as never],
		[INotificationService, { error: () => {} } as never],
	), true));
	const first = createSession('first');
	const second = createSession('second');
	managementService.sessions.set([second.model, first.model], undefined);
	const part = store.add(instantiationService.createInstance(SessionSidebarPartView, {
		labels: {
			homeTitle: 'Home',
			codeTitle: 'Code',
			homeNavNewChat: 'New Chat',
			homeNavProjects: 'Projects',
			homeNavArtifacts: 'Artifacts',
			homeNavCustomize: 'Customize',
			recentsTitle: 'Recents',
		},
		isCollapsed: false,
	}));

	try {
		const element = part.getElement();
		const newChatButton = [...element.querySelectorAll<HTMLButtonElement>('.comet-sidebar-home-nav-item')]
			.find(button => button.textContent === 'New Chat');
		assert.ok(newChatButton);
		newChatButton.click();
		assert.deepEqual(sessionsService.openNewSessionOptions, [{
			kind: OpenNewSessionKind.Draft,
			providerId: 'provider.test',
			draft: {
				sessionType: 'provider.test.default',
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
		}]);
		managementService.draftSession.set(first.model, undefined);
		newChatButton.click();
		assert.deepEqual(sessionsService.openNewSessionOptions.at(-1), {
			kind: OpenNewSessionKind.Empty,
		});

		const recentButtons = () => [...element.querySelectorAll<HTMLButtonElement>('.comet-sidebar-recent-session')];
		assert.deepEqual(recentButtons().map(button => button.textContent), ['Session second', 'Session first']);
		recentButtons()[1]?.click();
		assert.deepEqual(sessionsService.openedSessionIds, [first.model.sessionId]);

		first.title.set('Renamed first', undefined);
		managementService.sessions.set([first.model, second.model], undefined);
		assert.deepEqual(recentButtons().map(button => button.textContent), ['Renamed first', 'Session second']);
	} finally {
		store.dispose();
	}
});
