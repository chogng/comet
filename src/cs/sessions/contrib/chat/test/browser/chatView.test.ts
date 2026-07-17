/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { LanguagePackLocale } from 'cs/platform/languagePacks/common/languagePacks';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { AddressedChatView, NewSessionChatView } from 'cs/sessions/contrib/chat/browser/chatView';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import type {
	ISessionsManagementService,
	ISessionsModelsChangeEvent,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import type {
	IChatWidgetModelSelectionEvent,
	IChatWidgetPresentation,
	IChatWidgetSubmitEvent,
} from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/widget/chatWidget';
import type { IChatModel } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import { WorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import type {
	IWorkbenchLocaleService,
	LocaleServiceContext,
} from 'cs/workbench/services/localization/common/locale';

let cleanupDomEnvironment: (() => void) | undefined;

test.before(() => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

class TestWorkbenchLocaleService implements IWorkbenchLocaleService {
	declare readonly _serviceBrand: undefined;

	private readonly listeners = new Set<() => void>();

	constructor(private locale: LanguagePackLocale = 'en') {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getLocale(): LanguagePackLocale {
		return this.locale;
	}

	applyLocale(locale: LanguagePackLocale): void {
		if (locale === this.locale) {
			return;
		}
		this.locale = locale;
		for (const listener of this.listeners) {
			listener();
		}
	}

	async updateLocalePreference(locale: LanguagePackLocale, _context: LocaleServiceContext): Promise<void> {
		this.applyLocale(locale);
	}

	syncDocumentLanguage(): void {}

	async initialize(_context: LocaleServiceContext): Promise<LanguagePackLocale> {
		return this.locale;
	}
}

class TestChatWidget extends Disposable {
	private readonly element = document.createElement('div');
	private readonly submitRequestEmitter = this._register(new Emitter<IChatWidgetSubmitEvent>());
	readonly onDidSubmitRequest = this.submitRequestEmitter.event;
	private readonly modelSelectionEmitter = this._register(new Emitter<IChatWidgetModelSelectionEvent>());
	readonly onDidSelectModel = this.modelSelectionEmitter.event;
	readonly boundModels: IChatModel[] = [];
	readonly presentations: IChatWidgetPresentation[] = [];
	focusCount = 0;
	clearCount = 0;
	private hasBoundModel = false;

	getElement(): HTMLElement {
		return this.element;
	}

	setModel(model: IChatModel, presentation: IChatWidgetPresentation): void {
		this.hasBoundModel = true;
		this.boundModels.push(model);
		this.presentations.push(presentation);
	}

	setPresentation(presentation: IChatWidgetPresentation): void {
		if (!this.hasBoundModel) {
			throw new Error('A Chat widget presentation cannot precede its model binding.');
		}
		this.presentations.push(presentation);
	}

	clearModel(): void {
		this.hasBoundModel = false;
		this.clearCount += 1;
	}

	focusInput(): void {
		this.focusCount += 1;
	}

	fireSubmit(chatResource: URI): void {
		this.submitRequestEmitter.fire({ chatResource });
	}

	fireModelSelection(chatResource: URI, modelId: string | undefined): void {
		this.modelSelectionEmitter.fire({ chatResource, modelId });
	}

	override dispose(): void {
		this.element.remove();
		super.dispose();
	}
}

function createWidgetInstantiationService(widget: TestChatWidget): IInstantiationService {
	return {
		_serviceBrand: undefined,
		createInstance: (constructor: unknown) => {
			if (constructor !== ChatWidget) {
				throw new Error('The Chat view test instantiation service only creates ChatWidget.');
			}
			return widget;
		},
		invokeFunction: () => {
			throw new Error('The Chat view test does not invoke service accessors.');
		},
		createChild: () => {
			throw new Error('The Chat view test does not create child instantiation services.');
		},
		dispose() {},
	} as unknown as IInstantiationService;
}

type SentRequest = {
	readonly session: ISession;
	readonly chat: IChat;
};

class TestSessionsManagementService extends Disposable {
	declare readonly _serviceBrand: undefined;
	readonly draftSession = observableValue<ISession | undefined>('chatViewTestDraft', undefined);
	private readonly modelsChangeEmitter = this._register(new Emitter<ISessionsModelsChangeEvent>());
	readonly onDidChangeModels = this.modelsChangeEmitter.event;
	readonly sentRequests: SentRequest[] = [];
	readonly modelSelections: Array<{ session: ISession; chat: IChat; modelId: string | undefined }> = [];
	private committedSessions: readonly ISession[] = [];

	setCommittedSessions(sessions: readonly ISession[]): void {
		this.committedSessions = sessions;
	}

	getSession(sessionId: string): ISession | undefined {
		return this.committedSessions.find(session => session.sessionId === sessionId);
	}

	getModels(): ReturnType<ISessionsManagementService['getModels']> {
		return [];
	}

	async sendRequest(session: ISession, chat: IChat): Promise<void> {
		this.sentRequests.push({ session, chat });
	}

	async setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void> {
		this.modelSelections.push({ session, chat, modelId });
	}
}

function createChat(
	resource: string,
	interactivity: ChatInteractivity = ChatInteractivity.Full,
	origin: IChat['origin'] = { kind: ChatOriginKind.User },
): IChat {
	return {
		resource: URI.parse(resource),
		createdAt: new Date(1),
		title: observableValue(`title-${resource}`, resource),
		updatedAt: observableValue(`updated-${resource}`, new Date(1)),
		status: observableValue(`status-${resource}`, SessionStatus.Completed),
		isRead: observableValue(`isRead-${resource}`, true),
		modelId: observableValue<string | undefined>(`modelId-${resource}`, undefined),
		interactivity: observableValue(`interactivity-${resource}`, interactivity),
		capabilities: observableValue(`capabilities-${resource}`, {
			supportsRename: true,
			supportsDelete: true,
		}),
		origin,
	};
}

function createSession(
	name: string,
	chats: readonly IChat[],
	status: SessionStatus = SessionStatus.Completed,
): ISession {
	const resource = URI.parse(`test-session:/${name}`);
	return {
		sessionId: toSessionId('provider.test', resource),
		resource,
		providerId: 'provider.test',
		sessionType: 'provider.test.default',
		createdAt: new Date(1),
		title: observableValue(`sessionTitle-${name}`, `Session ${name}`),
		updatedAt: observableValue(`sessionUpdated-${name}`, new Date(1)),
		status: observableValue(`sessionStatus-${name}`, status),
		isRead: observableValue(`sessionIsRead-${name}`, true),
		isArchived: observableValue(`sessionIsArchived-${name}`, false),
		workspace: observableValue(`sessionWorkspace-${name}`, {
			kind: SessionWorkspaceKind.WorkspaceLess,
		}),
		changes: observableValue(`sessionChanges-${name}`, []),
		chats: observableValue(`sessionChats-${name}`, chats),
		capabilities: observableValue(`sessionCapabilities-${name}`, {
			supportsCreateChat: true,
			maximumChatCount: undefined,
			supportsFork: true,
			supportsRename: true,
			supportsArchive: true,
			supportsDelete: true,
			supportsChanges: false,
			supportsModels: false,
		}),
	};
}

test('AddressedChatView switches explicit resources without cross-routing requests', async () => {
	const store = new DisposableStore();
	const notificationService = new NoOpNotificationService();
	const chatService = new ChatService(createTestChatStorageService());
	const firstChat = createChat('test-chat:/binding/first');
	const secondChat = createChat(
		'test-chat:/binding/second',
		ChatInteractivity.Full,
		{ kind: ChatOriginKind.User },
	);
	const session = createSession('binding', [firstChat, secondChat]);
	const managementService = store.add(new TestSessionsManagementService());
	const localeService = new TestWorkbenchLocaleService();
	const languageService = new WorkbenchLanguageService();
	managementService.setCommittedSessions([session]);
	const firstOwner = store.add(chatService.createModel(firstChat.resource));
	const secondOwner = store.add(chatService.createModel(secondChat.resource));
	const widget = new TestChatWidget();
	const view = store.add(new AddressedChatView(
		createWidgetInstantiationService(widget),
		chatService,
		managementService as unknown as ISessionsManagementService,
		notificationService,
		localeService,
		languageService,
	));

	try {
		chatService.setInput(firstChat.resource, 'First prompt');
		view.setChat(session, firstChat);
		assert.equal(widget.boundModels.at(-1)?.resource, firstChat.resource);

		chatService.setInput(secondChat.resource, 'Second prompt');
		view.setChat(session, secondChat);
		assert.equal(widget.boundModels.at(-1)?.resource, secondChat.resource);
		assert.equal(firstOwner.object.getSnapshot().input, 'First prompt');
		assert.equal(secondOwner.object.getSnapshot().input, 'Second prompt');

		widget.fireSubmit(firstChat.resource);
		await Promise.resolve();
		assert.equal(managementService.sentRequests.length, 0);

		widget.fireSubmit(secondChat.resource);
		await Promise.resolve();
		assert.equal(managementService.sentRequests.length, 1);
		const sent = managementService.sentRequests[0];
		assert.equal(sent?.session, session);
		assert.equal(sent?.chat, secondChat);

		widget.fireModelSelection(firstChat.resource, 'provider:model-stale');
		await Promise.resolve();
		assert.equal(managementService.modelSelections.length, 0);
	} finally {
		store.dispose();
	}
});

test('Sessions Chat views enforce read-only, Hidden, and draft view constraints', () => {
	const store = new DisposableStore();
	const notificationService = new NoOpNotificationService();
	const chatService = new ChatService(createTestChatStorageService());
	const readOnlyChat = createChat('test-chat:/constraints/read-only', ChatInteractivity.ReadOnly);
	const hiddenChat = createChat(
		'test-chat:/constraints/hidden',
		ChatInteractivity.Hidden,
		{ kind: ChatOriginKind.Tool, parentChat: readOnlyChat.resource },
	);
	const committedSession = createSession('constraints-committed', [readOnlyChat, hiddenChat]);
	const draftChat = createChat('test-chat:/constraints/draft');
	const draftSession = createSession('constraints-draft', [draftChat], SessionStatus.Draft);
	const managementService = store.add(new TestSessionsManagementService());
	const localeService = new TestWorkbenchLocaleService();
	const languageService = new WorkbenchLanguageService();
	managementService.setCommittedSessions([committedSession]);
	managementService.draftSession.set(draftSession, undefined);
	store.add(chatService.createModel(readOnlyChat.resource));
	store.add(chatService.createModel(draftChat.resource));
	const addressedWidget = new TestChatWidget();
	const addressedView = store.add(new AddressedChatView(
		createWidgetInstantiationService(addressedWidget),
		chatService,
		managementService as unknown as ISessionsManagementService,
		notificationService,
		localeService,
		languageService,
	));
	const newSessionWidget = new TestChatWidget();
	const newSessionView = store.add(new NewSessionChatView(
		createWidgetInstantiationService(newSessionWidget),
		chatService,
		managementService as unknown as ISessionsManagementService,
		notificationService,
		localeService,
		languageService,
	));

	try {
		addressedView.setChat(committedSession, readOnlyChat);
		assert.equal(addressedWidget.presentations.at(-1)?.readOnly, true);
		assert.throws(
			() => addressedView.setChat(committedSession, hiddenChat),
			/Hidden Chat/,
		);
		assert.throws(
			() => addressedView.setChat(draftSession, draftChat),
			/still a draft/,
		);

		assert.throws(
			() => newSessionView.setDraft(committedSession, readOnlyChat),
			/is not a draft/,
		);
		newSessionView.setDraft(draftSession, draftChat);
		assert.equal(newSessionWidget.boundModels.at(-1)?.resource, draftChat.resource);
		assert.equal(newSessionWidget.presentations.at(-1)?.readOnly, false);
		newSessionView.setDraft(undefined, undefined);
		assert.equal(newSessionWidget.clearCount, 1);
	} finally {
		store.dispose();
	}
});

test('AddressedChatView refreshes its active model label on the same instance', () => {
	const store = new DisposableStore();
	const notificationService = new NoOpNotificationService();
	const chatService = new ChatService(createTestChatStorageService());
	const chat = createChat('test-chat:/locale/active');
	const session = createSession('locale', [chat]);
	const managementService = store.add(new TestSessionsManagementService());
	managementService.setCommittedSessions([session]);
	store.add(chatService.createModel(chat.resource));
	const localeService = new TestWorkbenchLocaleService();
	const widget = new TestChatWidget();
	const view = store.add(new AddressedChatView(
		createWidgetInstantiationService(widget),
		chatService,
		managementService as unknown as ISessionsManagementService,
		notificationService,
		localeService,
		new WorkbenchLanguageService(),
	));

	try {
		view.setChat(session, chat);
		assert.equal(widget.presentations.at(-1)?.activeModelLabel, 'Auto');
		const presentationCount = widget.presentations.length;

		localeService.applyLocale('zh');

		assert.equal(widget.presentations.length, presentationCount + 1);
		assert.equal(widget.presentations.at(-1)?.activeModelLabel, '自动');
	} finally {
		store.dispose();
	}
});
