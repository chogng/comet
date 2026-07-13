/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { observableValue, type ISettableObservable } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import {
	commandService,
	setCommandServiceInstantiationService,
} from 'cs/platform/commands/common/commands';
import {
	IContextMenuService,
	IContextViewService,
	type IContextMenuService as IContextMenuServiceType,
	type IContextViewService as IContextViewServiceType,
} from 'cs/platform/contextview/browser/contextView';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { ContextKeyServiceImpl, IContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { SessionsPart } from 'cs/sessions/browser/parts/sessions/sessionsPart';
import { SessionsCommandIds } from 'cs/sessions/common/sessionCommands';
import { SessionsActionsContribution } from 'cs/sessions/contrib/sessions/browser/sessions.contribution';
import type { ISessionsLayoutState } from 'cs/sessions/services/layout/browser/layoutPolicy';
import {
	ISessionsLayoutService,
	type ISessionsPartSizes,
	type SessionsLayoutMode,
} from 'cs/sessions/services/layout/browser/layoutService';
import {
	IChatViewFactory,
	type IAddressedChatView,
	type INewSessionChatView,
	type ISessionsChatView,
} from 'cs/sessions/services/chatView/browser/chatViewFactory';
import { VisibleSession } from 'cs/sessions/services/sessions/browser/visibleSessions';
import {
	ChatInteractivity,
	type IChat,
	type ISession,
	type ISessionCapabilities,
	type SessionId,
	type SessionsProviderId,
	SessionStatus,
	SessionWorkspaceKind,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import {
	NewSessionSlot,
	type IActiveSession,
	type IVisibleSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';
import type { ISessionsPartFocusTarget } from 'cs/sessions/services/sessions/browser/sessionsPartService';
import {
	ISessionsService,
	type IOpenNewSessionOptions,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import {
	ISessionsManagementService,
	type IProviderSessionType,
	type ISessionChatOwner,
	type ISessionDraftChangeEvent,
	type ISessionsManagementChangeEvent,
	type ISessionsModelsChangeEvent,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import type { ISessionDraftOptions } from 'cs/sessions/services/sessions/common/sessionsProvider';
import type { IChatRequest } from 'cs/workbench/contrib/chat/common/chatRequest';
import type { ILanguageModelChatMetadataAndIdentifier } from 'cs/workbench/contrib/chat/common/languageModels';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import {
	IDialogService,
	type IConfirmation,
	type IConfirmationResult,
	type IInput,
	type IInputResult,
} from 'cs/workbench/services/dialogs/common/dialogService';
import {
	IWorkbenchLanguageService,
	WorkbenchLanguageService,
} from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

let cleanupDomEnvironment: (() => void) | undefined;

test.before(() => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

abstract class TestSessionsChatView extends Disposable implements ISessionsChatView {
	private readonly element = document.createElement('div');
	readonly layouts: Array<{ width: number; height: number }> = [];
	focusCount = 0;
	disposeCount = 0;
	private didDispose = false;

	getElement(): HTMLElement {
		return this.element;
	}

	layout(width: number, height: number): void {
		this.layouts.push({ width, height });
	}

	focus(): void {
		this.focusCount += 1;
	}

	override dispose(): void {
		if (this.didDispose) {
			return;
		}
		this.didDispose = true;
		this.disposeCount += 1;
		this.element.remove();
		super.dispose();
	}
}

class TestNewSessionChatView extends TestSessionsChatView implements INewSessionChatView {
	readonly sessions: Array<ISession | undefined> = [];

	setSession(session: ISession | undefined): void {
		this.sessions.push(session);
	}
}

class TestAddressedChatView extends TestSessionsChatView implements IAddressedChatView {
	readonly bindings: Array<{ session: ISession; chat: IChat }> = [];

	setChat(session: ISession, chat: IChat): void {
		this.bindings.push({ session, chat });
	}
}

class TestChatViewFactory implements IChatViewFactory {
	declare readonly _serviceBrand: undefined;
	readonly newSessionViews: TestNewSessionChatView[] = [];
	readonly addressedViews: TestAddressedChatView[] = [];

	createNewSessionView(): INewSessionChatView {
		const view = new TestNewSessionChatView();
		this.newSessionViews.push(view);
		return view;
	}

	createChatView(): IAddressedChatView {
		const view = new TestAddressedChatView();
		this.addressedViews.push(view);
		return view;
	}
}

class TestActionManagementService implements ISessionsManagementService {
	declare readonly _serviceBrand: undefined;
	readonly sessions;
	readonly draftSession = observableValue<ISession | undefined>('sessionActionsDraft', undefined);
	readonly sessionTypes = observableValue<readonly IProviderSessionType[]>('sessionActionsTypes', []);
	readonly onDidChangeSessions = Event.None as Event<ISessionsManagementChangeEvent>;
	readonly onDidChangeDraftSession = Event.None as Event<ISessionDraftChangeEvent>;
	readonly onDidChangeSessionTypes = Event.None;
	readonly onDidChangeModels = Event.None as Event<ISessionsModelsChangeEvent>;
	readonly renamed: Array<{ session: ISession; title: string }> = [];
	readonly deleted: ISession[] = [];

	constructor(sessions: readonly ISession[]) {
		this.sessions = observableValue<readonly ISession[]>('sessionActionsSessions', sessions);
	}

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
	async renameSession(session: ISession, title: string): Promise<void> { this.renamed.push({ session, title }); }
	renameChat(_session: ISession, _chat: IChat, _title: string): Promise<void> { throw new Error('Unexpected Chat rename.'); }
	setChatModel(_session: ISession, _chat: IChat, _modelId: string | undefined): Promise<void> { throw new Error('Unexpected model change.'); }
	setSessionArchived(_session: ISession, _archived: boolean): Promise<void> { throw new Error('Unexpected archive change.'); }
	async deleteSession(session: ISession): Promise<void> { this.deleted.push(session); }
	deleteChat(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Unexpected Chat deletion.'); }
}

class TestActionSessionsService implements ISessionsService {
	declare readonly _serviceBrand: undefined;
	readonly visibleSessions = observableValue<readonly IVisibleSessionSlot[]>('sessionActionsVisible', [NewSessionSlot]);
	readonly activeSession = observableValue<IActiveSession | undefined>('sessionActionsActive', undefined);
	readonly closed: Array<IActiveSession | undefined> = [];

	openSession(_sessionId: SessionId): void { throw new Error('Unexpected Session open.'); }
	openNewSession(_options?: IOpenNewSessionOptions): ISession | undefined { throw new Error('Unexpected new Session open.'); }
	openChat(_session: ISession, _chatResource: URI): void { throw new Error('Unexpected Chat open.'); }
	closeChat(_session: IActiveSession, _chat: IChat): void { throw new Error('Unexpected Chat close.'); }
	reopenChat(_session: IActiveSession, _chat: IChat): void { throw new Error('Unexpected Chat reopen.'); }
	closeSession(session: IActiveSession | undefined): void { this.closed.push(session); }
	setActiveSession(_session: IActiveSession | undefined): void { throw new Error('Unexpected active Session change.'); }
	setSessionSticky(_session: IActiveSession, _sticky: boolean): void { throw new Error('Unexpected sticky Session change.'); }
	focusSession(_session: IActiveSession | undefined): void { throw new Error('Unexpected Session focus.'); }
}

class TestDialogService implements IDialogService {
	declare readonly _serviceBrand: undefined;
	inputValue: string | undefined = 'Renamed Session';
	confirmed = true;
	readonly errors: string[] = [];

	async confirm(_confirmation: IConfirmation): Promise<IConfirmationResult> { return { confirmed: this.confirmed }; }
	async prompt<T>(): Promise<{ result: T | undefined }> { return { result: undefined }; }
	async input(_input: IInput): Promise<IInputResult> { return { value: this.inputValue }; }
	async info(): Promise<void> {}
	async warn(): Promise<void> {}
	async error(message: string): Promise<void> { this.errors.push(message); }
}

function createChat(resource: string): IChat {
	return {
		resource: URI.parse(resource),
		createdAt: new Date(1),
		title: observableValue(`title-${resource}`, resource),
		updatedAt: observableValue(`updated-${resource}`, new Date(1)),
		status: observableValue(`status-${resource}`, SessionStatus.Completed),
		isRead: observableValue(`isRead-${resource}`, true),
		modelId: observableValue<string | undefined>(`modelId-${resource}`, undefined),
		interactivity: observableValue(`interactivity-${resource}`, ChatInteractivity.Full),
		capabilities: observableValue(`capabilities-${resource}`, {
			supportsRename: true,
			supportsDelete: false,
		}),
		origin: undefined,
	};
}

function createSession(
	name: string,
	capabilities: ISettableObservable<ISessionCapabilities> = observableValue(`sessionCapabilities-${name}`, {
		supportsMultipleChats: true,
		supportsFork: true,
		supportsRename: true,
		supportsArchive: true,
		supportsDelete: true,
		supportsChanges: false,
		supportsModels: false,
	}),
): ISession {
	const resource = URI.parse(`test-session:/${name}`);
	const mainChat = createChat(`test-chat:/${name}/main`);
	return {
		sessionId: toSessionId('provider.test', resource),
		resource,
		providerId: 'provider.test',
		sessionType: 'provider.test.default',
		createdAt: new Date(1),
		title: observableValue(`sessionTitle-${name}`, `Session ${name}`),
		updatedAt: observableValue(`sessionUpdated-${name}`, new Date(1)),
		status: observableValue(`sessionStatus-${name}`, SessionStatus.Completed),
		isRead: observableValue(`sessionIsRead-${name}`, true),
		isArchived: observableValue(`sessionIsArchived-${name}`, false),
		workspace: observableValue(`sessionWorkspace-${name}`, {
			kind: SessionWorkspaceKind.WorkspaceLess,
		}),
		changes: observableValue(`sessionChanges-${name}`, []),
		mainChat: observableValue(`sessionMainChat-${name}`, mainChat),
		chats: observableValue<readonly IChat[]>(`sessionChats-${name}`, [mainChat]),
		capabilities,
	};
}

function createVisibleSession(name: string): VisibleSession {
	const session = createSession(name);
	return new VisibleSession(session, session.mainChat.get(), undefined, () => {});
}

interface IActionServices {
	readonly managementService: TestActionManagementService;
	readonly sessionsService: TestActionSessionsService;
	readonly dialogService: TestDialogService;
}

class TestSessionsPartLayoutService extends Disposable implements ISessionsLayoutService {
	declare readonly _serviceBrand: undefined;

	private readonly changeEmitter = this._register(new Emitter<ISessionsLayoutState>());
	readonly onDidChangeLayoutState = this.changeEmitter.event;
	readonly onDidChangeLayoutGeometry = Event.None;

	private state: ISessionsLayoutState = {
		mode: 'flow',
		isSidebarVisible: true,
		sidebarSize: 320,
		isEditorCollapsed: false,
		expandedEditorSize: 640,
	};

	getLayoutState(): ISessionsLayoutState { return this.state; }
	getLayoutGeometry() { return undefined; }
	setLayoutGeometry(): void { throw new Error('Unexpected layout geometry change.'); }
	setViewport(): void { throw new Error('Unexpected viewport change.'); }
	applyStartupLayoutMode(): boolean { throw new Error('Unexpected startup layout change.'); }
	applyLayoutMode(_mode: SessionsLayoutMode): void { throw new Error('Unexpected layout mode change.'); }
	setPartSizes(_sizes: ISessionsPartSizes): void { throw new Error('Unexpected Part size change.'); }
	setSidebarVisible(): void { throw new Error('Unexpected Sidebar visibility change.'); }
	setSidebarSize(): void { throw new Error('Unexpected Sidebar size change.'); }
	toggleSidebarVisibility(): void { throw new Error('Unexpected Sidebar visibility toggle.'); }
	setEditorCollapsed(collapsed: boolean): void {
		this.state = { ...this.state, isEditorCollapsed: collapsed };
		this.changeEmitter.fire(this.state);
	}
	toggleEditorCollapsed(): void { this.setEditorCollapsed(!this.state.isEditorCollapsed); }
}

function createPartHarness(store: DisposableStore, actionServices?: IActionServices) {
	const factory = new TestChatViewFactory();
	const layoutService = store.add(new TestSessionsPartLayoutService());
	const contextMenuService: IContextMenuServiceType = {
		_serviceBrand: undefined,
		showContextMenu: () => {},
		hideContextMenu: () => {},
		isVisible: () => false,
		onDidShowContextMenu: () => ({ dispose: () => {} }),
		onDidHideContextMenu: () => ({ dispose: () => {} }),
		dispose: () => {},
	};
	const contextViewElement = document.createElement('div');
	const contextViewService: IContextViewServiceType = {
		_serviceBrand: undefined,
		showContextView: () => ({ close: () => {} }),
		hideContextView: () => {},
		getContextViewElement: () => contextViewElement,
		layout: () => {},
	};
	const contextKeyService = new ContextKeyServiceImpl();
	const services = new ServiceCollection(
			[IChatViewFactory, factory],
			[IContextMenuService, contextMenuService],
			[IContextViewService, contextViewService],
			[IContextKeyService, contextKeyService],
			[ISessionsLayoutService, layoutService],
			[IWorkbenchCommandService, { executeCommand: async () => undefined } as never],
			[IWorkbenchLocaleService, {
				getLocale: () => 'en',
				subscribe: () => () => {},
			} as never],
			[IWorkbenchLanguageService, new WorkbenchLanguageService()],
		);
	if (actionServices) {
		services.set(ISessionsManagementService, actionServices.managementService);
		services.set(ISessionsService, actionServices.sessionsService);
		services.set(IDialogService, actionServices.dialogService);
	}
	const instantiationService = store.add(new InstantiationService(
		services,
		true,
	));
	if (actionServices) {
		store.add(instantiationService.createInstance(SessionsActionsContribution));
	}
	const part = store.add(new SessionsPart(instantiationService));
	const grid = part.getElement().querySelector<HTMLElement>('.comet-sessions-grid');
	assert.ok(grid);
	return { contextKeyService, factory, instantiationService, layoutService, part, grid };
}

function findAddressedView(factory: TestChatViewFactory, session: IActiveSession): TestAddressedChatView {
	const view = factory.addressedViews.find(candidate => candidate.bindings.at(-1)?.session === session);
	assert.ok(view);
	return view;
}

test('SessionsPart preserves slot identity while reordering and disposes only removed records', () => {
	const store = new DisposableStore();
	const first = store.add(createVisibleSession('first'));
	const second = store.add(createVisibleSession('second'));
	const { factory, part, grid } = createPartHarness(store);
	const focusEvents: ISessionsPartFocusTarget[] = [];
	store.add(part.onDidFocusSlot(event => focusEvents.push(event)));

	try {
		part.updateVisibleSessions([first, second], first);
		part.layout(600, 400);
		const firstElement = grid.children[0];
		const secondElement = grid.children[1];
		assert.ok(firstElement instanceof HTMLElement);
		assert.ok(secondElement instanceof HTMLElement);
		const firstView = findAddressedView(factory, first);
		const secondView = findAddressedView(factory, second);
		assert.equal(factory.addressedViews.length, 2);
		assert.deepEqual(firstView.layouts.at(-1), { width: 300, height: 328 });
		assert.deepEqual(secondView.layouts.at(-1), { width: 300, height: 328 });

		part.updateVisibleSessions([second, first], second);
		assert.equal(grid.children[0], secondElement);
		assert.equal(grid.children[1], firstElement);
		assert.equal(factory.addressedViews.length, 2);
		assert.equal(secondElement.classList.contains('comet-is-active'), true);
		assert.equal(firstElement.classList.contains('comet-is-active'), false);

		part.focusSession(second);
		assert.equal(secondView.focusCount, 1);
		firstElement.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		assert.equal(focusEvents.length, 1);
		assert.equal(focusEvents[0]?.kind, 'session');
		assert.equal(focusEvents[0]?.kind === 'session' ? focusEvents[0].session : undefined, first);

		part.updateVisibleSessions([first], first);
		assert.deepEqual([...grid.children], [firstElement]);
		assert.equal(firstView.disposeCount, 0);
		assert.equal(secondView.disposeCount, 1);

		part.dispose();
		assert.equal(firstView.disposeCount, 1);
		assert.equal(secondView.disposeCount, 1);
		assert.equal(part.getElement().childElementCount, 0);
		firstElement.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		assert.equal(focusEvents.length, 1);
	} finally {
		store.dispose();
	}
});

test('SessionsPart publishes new and committed slot focus with the active slot state', () => {
	const store = new DisposableStore();
	const session = store.add(createVisibleSession('focus'));
	const { factory, part, grid } = createPartHarness(store);
	const focusEvents: ISessionsPartFocusTarget[] = [];
	store.add(part.onDidFocusSlot(event => focusEvents.push(event)));

	try {
		part.updateVisibleSessions([NewSessionSlot, session], undefined);
		const newSessionElement = grid.children[0];
		const sessionElement = grid.children[1];
		assert.ok(newSessionElement instanceof HTMLElement);
		assert.ok(sessionElement instanceof HTMLElement);
		const newSessionView = factory.newSessionViews[0];
		const addressedView = findAddressedView(factory, session);
		assert.ok(newSessionView);
		assert.equal(newSessionElement.classList.contains('comet-is-active'), true);
		assert.equal(sessionElement.classList.contains('comet-is-active'), false);

		part.focusSession(undefined);
		part.focusSession(session);
		assert.equal(newSessionView.focusCount, 1);
		assert.equal(addressedView.focusCount, 1);

		newSessionElement.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		sessionElement.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		assert.equal(focusEvents[0]?.kind, 'new-session');
		assert.equal(focusEvents[1]?.kind, 'session');
		assert.equal(focusEvents[1]?.kind === 'session' ? focusEvents[1].session : undefined, session);

		part.updateVisibleSessions([NewSessionSlot, session], session);
		assert.equal(grid.children[0], newSessionElement);
		assert.equal(grid.children[1], sessionElement);
		assert.equal(factory.newSessionViews.length, 1);
		assert.equal(factory.addressedViews.length, 1);
		assert.equal(newSessionElement.classList.contains('comet-is-active'), false);
		assert.equal(sessionElement.classList.contains('comet-is-active'), true);

		part.dispose();
		assert.equal(newSessionView.disposeCount, 1);
		assert.equal(addressedView.disposeCount, 1);
	} finally {
		store.dispose();
	}
});

test('Sessions Part owns the collapsed Editor action and mutates layout directly', () => {
	const store = new DisposableStore();
	const { layoutService, part } = createPartHarness(store);
	const toggleButton = () => part.getElement().querySelector<HTMLButtonElement>(
		'.comet-editor-titlebar-toggle-editor-btn',
	);

	try {
		assert.ok(toggleButton());
		assert.equal(toggleButton()?.closest<HTMLElement>('.comet-editor-titlebar-actionbar')?.hidden, true);
		layoutService.setEditorCollapsed(true);
		assert.equal(toggleButton()?.closest<HTMLElement>('.comet-editor-titlebar-actionbar')?.hidden, false);
		toggleButton()?.click();
		assert.equal(layoutService.getLayoutState().isEditorCollapsed, false);
	} finally {
		store.dispose();
	}
});

test('Session header gates operations by capability and preserves the originating Session target', async () => {
	const store = new DisposableStore();
	const firstModel = createSession('actions-first');
	const secondCapabilities = observableValue<ISessionCapabilities>('sessionCapabilities-actions-second', {
		supportsMultipleChats: false,
		supportsFork: false,
		supportsRename: true,
		supportsArchive: false,
		supportsDelete: true,
		supportsChanges: false,
		supportsModels: false,
	});
	const secondModel = createSession('actions-second', secondCapabilities);
	const first = store.add(new VisibleSession(firstModel, firstModel.mainChat.get(), undefined, () => {}));
	const second = store.add(new VisibleSession(secondModel, secondModel.mainChat.get(), undefined, () => {}));
	const managementService = new TestActionManagementService([firstModel, secondModel]);
	const sessionsService = new TestActionSessionsService();
	const dialogService = new TestDialogService();
	const { contextKeyService, instantiationService, part, grid } = createPartHarness(store, {
		managementService,
		sessionsService,
		dialogService,
	});
	store.add(setCommandServiceInstantiationService(instantiationService));

	try {
		assert.equal(contextKeyService.getContextKeyValue('sessions.activeChatFullyInteractive'), false);
		sessionsService.activeSession.set(first, undefined);
		assert.equal(contextKeyService.getContextKeyValue('sessions.activeChatFullyInteractive'), true);
		(first.activeChat.get().interactivity as ISettableObservable<ChatInteractivity>).set(
			ChatInteractivity.ReadOnly,
			undefined,
		);
		assert.equal(contextKeyService.getContextKeyValue('sessions.activeChatFullyInteractive'), false);

		part.updateVisibleSessions([first, second], first);
		const secondElement = grid.children[1];
		assert.ok(secondElement instanceof HTMLElement);
		const getActionIds = () => [...secondElement.querySelectorAll<HTMLElement>('[data-actionbar-item-id]')]
			.map(element => element.dataset.actionbarItemId);
		assert.deepEqual(getActionIds(), [
			SessionsCommandIds.renameSession,
			SessionsCommandIds.deleteSession,
			SessionsCommandIds.closeSession,
		]);

		const closeButton = secondElement.querySelector<HTMLButtonElement>(
			`[data-actionbar-item-id="${SessionsCommandIds.closeSession}"] button`,
		);
		assert.ok(closeButton);
		closeButton.click();
		assert.deepEqual(sessionsService.closed, [second]);

		await Promise.resolve(commandService.executeCommand(SessionsCommandIds.renameSession, second));
		await Promise.resolve(commandService.executeCommand(SessionsCommandIds.deleteSession, second));
		assert.deepEqual(managementService.renamed, [{ session: secondModel, title: 'Renamed Session' }]);
		assert.deepEqual(managementService.deleted, [secondModel]);
		assert.deepEqual(dialogService.errors, []);

		secondCapabilities.set({
			...secondCapabilities.get(),
			supportsRename: false,
			supportsDelete: false,
		}, undefined);
		assert.deepEqual(getActionIds(), [SessionsCommandIds.closeSession]);
	} finally {
		store.dispose();
	}
});
