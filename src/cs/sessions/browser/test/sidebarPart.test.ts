/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { IQuickInputService } from 'cs/platform/quickinput/common/quickInput';
import { SessionSidebarPartView } from 'cs/sessions/browser/parts/sidebar/sidebarPart';
import {
	ISessionsLayoutService,
	type ISessionsPartSizes,
	type SessionsLayoutMode,
} from 'cs/sessions/services/layout/browser/layoutService';
import type {
	ISessionsLayoutState,
} from 'cs/sessions/services/layout/browser/layoutPolicy';
import {
	ISessionsSettingsOverlayService,
	SessionsSettingsOverlayService,
} from 'cs/sessions/services/settings/browser/settingsOverlayService';
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
	ChatOriginKind,
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
import type { ISessionModel } from 'cs/sessions/services/sessions/common/sessionsProvider';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	IWorkbenchLanguageService,
	WorkbenchLanguageService,
} from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import {
	IWorkbenchSidebarEntryService,
	WorkbenchSidebarEntryService,
} from 'cs/workbench/services/sidebar/common/sidebarEntryService';

let cleanupDomEnvironment: (() => void) | undefined;

function delay(ms = 0): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

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
	async createSessionDraft(_providerId: SessionsProviderId, _options: ISessionDraftOptions): Promise<ISession> { throw new Error('Unexpected Session draft creation.'); }
	discardSessionDraft(_session: ISession): void { throw new Error('Unexpected Session draft discard.'); }
	getModels(_session: ISession, _chat: IChat): readonly ISessionModel[] { return []; }
	sendRequest(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Unexpected Session request.'); }
	createChat(_session: ISession): Promise<IChat> { throw new Error('Unexpected Chat creation.'); }
	forkChat(_session: ISession, _sourceChat: IChat, _turnId: string): Promise<IChat> { throw new Error('Unexpected Chat fork.'); }
	renameSession(_session: ISession, _title: string): Promise<void> { throw new Error('Unexpected Session rename.'); }
	renameChat(_session: ISession, _chat: IChat, _title: string): Promise<void> { throw new Error('Unexpected Chat rename.'); }
	setChatModel(_session: ISession, _chat: IChat, _modelId: string | undefined): Promise<void> { throw new Error('Unexpected model change.'); }
	setSessionArchived(_session: ISession, _archived: boolean): Promise<void> { throw new Error('Unexpected archive change.'); }
	releaseSession(_session: ISession): Promise<void> { throw new Error('Unexpected Session release.'); }
	releaseChat(_session: ISession, _chat: IChat): Promise<void> { throw new Error('Unexpected Chat release.'); }
	cancelTurn(_session: ISession, _chat: IChat, _turnId: string): Promise<void> { throw new Error('Unexpected Turn cancellation.'); }
	steerTurn(_session: ISession, _chat: IChat, _turnId: string, _message: string): Promise<void> { throw new Error('Unexpected Turn steering.'); }
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
	async openNewSession(options: IOpenNewSessionOptions = { kind: OpenNewSessionKind.Empty }): Promise<ISession | undefined> {
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

class TestSessionsLayoutService extends Disposable implements ISessionsLayoutService {
	declare readonly _serviceBrand: undefined;

	private readonly changeEmitter = this._register(new Emitter<ISessionsLayoutState>());
	readonly onDidChangeLayoutState = this.changeEmitter.event;
	readonly onDidChangeLayoutGeometry = Event.None;

	private state: ISessionsLayoutState = {
		mode: 'agent',
		isSidebarVisible: true,
		sidebarSize: 320,
		isEditorCollapsed: false,
		expandedEditorSize: 640,
	};

	getLayoutState(): ISessionsLayoutState {
		return this.state;
	}

	getLayoutGeometry() {
		return undefined;
	}

	setLayoutGeometry(): void {
		throw new Error('Unexpected layout geometry change.');
	}

	setSidebarVisible(visible: boolean): void {
		if (this.state.isSidebarVisible === visible) {
			return;
		}
		this.state = { ...this.state, isSidebarVisible: visible };
		this.changeEmitter.fire(this.state);
	}

	setViewport(_width: number, _height: number): void {
		throw new Error('Unexpected viewport change.');
	}

	applyStartupLayoutMode(_mode: SessionsLayoutMode): boolean {
		throw new Error('Unexpected startup layout change.');
	}

	applyLayoutMode(mode: SessionsLayoutMode): void {
		this.state = {
			...this.state,
			mode,
			isSidebarVisible: true,
			isEditorCollapsed: mode === 'agent',
		};
		this.changeEmitter.fire(this.state);
	}

	setPartSizes(_sizes: ISessionsPartSizes): void {
		throw new Error('Unexpected Part size change.');
	}

	setSidebarSize(_size: number): void {
		throw new Error('Unexpected Sidebar size change.');
	}

	toggleSidebarVisibility(): void {
		this.setSidebarVisible(!this.state.isSidebarVisible);
	}

	setEditorCollapsed(_collapsed: boolean, _expandedEditorSize?: number): void {
		throw new Error('Unexpected Editor collapse change.');
	}

	toggleEditorCollapsed(_expandedEditorSize?: number): void {
		throw new Error('Unexpected Editor collapse toggle.');
	}
}

function createSession(name: string): { readonly model: ISession; readonly title: ReturnType<typeof observableValue<string>> } {
	const resource = URI.parse(`test-session:/${name}`);
	const chatResource = URI.parse(`test-chat:/${name}/conversation`);
	const title = observableValue(`sidebarSessionTitle-${name}`, `Session ${name}`);
	const chat: IChat = {
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
		origin: { kind: ChatOriginKind.User },
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
			chats: observableValue<readonly IChat[]>(`sidebarSessionChats-${name}`, [chat]),
			capabilities: observableValue(`sidebarSessionCapabilities-${name}`, {
				supportsCreateChat: false,
				maximumChatCount: 1,
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

test('Session Sidebar consumes authoritative layout and Sessions services directly', async () => {
	const store = new DisposableStore();
	const dropdownServices = store.add(await createDropdownTestServices());
	const managementService = new TestSessionsManagementService();
	const sessionsService = new TestSessionsService();
	const layoutService = store.add(new TestSessionsLayoutService());
	const settingsOverlayService = store.add(new SessionsSettingsOverlayService());
	let locale: 'en' | 'zh' = 'en';
	const localeListeners = new Set<() => void>();
	let openedEditorCount = 0;
	let focusedEditorInputCount = 0;
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
		[ISessionsLayoutService, layoutService],
		[ISessionsSettingsOverlayService, settingsOverlayService],
		[IWorkbenchSidebarEntryService, sidebarEntryService],
		[IContextMenuService, dropdownServices.contextMenuService],
		[IContextViewService, dropdownServices.contextViewProvider as never],
		[IEditorGroupsService, {
			mainPart: {
				focusPrimaryInput: () => {
					focusedEditorInputCount += 1;
				},
			},
		} as never],
		[IEditorService, {
			openEditor: async () => {
				openedEditorCount += 1;
			},
		} as never],
		[IQuickInputService, { pick: async () => undefined } as never],
		[INotificationService, { error: () => {} } as never],
		[IWorkbenchLocaleService, {
			getLocale: () => locale,
			subscribe: (listener: () => void) => {
				localeListeners.add(listener);
				return () => localeListeners.delete(listener);
			},
		} as never],
		[IWorkbenchLanguageService, new WorkbenchLanguageService()],
	), true));
	const first = createSession('first');
	const second = createSession('second');
	managementService.sessions.set([second.model, first.model], undefined);
	const part = store.add(instantiationService.createInstance(SessionSidebarPartView));

	try {
		const element = part.getElement();
		assert.equal(element.classList.contains('comet-is-collapsed'), false);
		layoutService.setSidebarVisible(false);
		assert.equal(element.classList.contains('comet-is-collapsed'), true);
		layoutService.setSidebarVisible(true);
		assert.equal(element.classList.contains('comet-is-collapsed'), false);

		const sidebarToggle = element.querySelector<HTMLButtonElement>(
			'.comet-titlebar-primary-sidebar-toggle-btn',
		);
		assert.ok(sidebarToggle);
		sidebarToggle.click();
		assert.equal(layoutService.getLayoutState().isSidebarVisible, false);
		layoutService.setSidebarVisible(true);
		const addressBarButton = element.querySelector<HTMLButtonElement>(
			'.comet-titlebar-address-bar-btn',
		);
		const settingsButton = element.querySelector<HTMLButtonElement>(
			'.comet-sidebar-footer-settings-btn',
		);
		assert.ok(addressBarButton);
		assert.ok(settingsButton);
		addressBarButton.click();
		assert.equal(openedEditorCount, 1);
		assert.equal(focusedEditorInputCount, 1);
		settingsButton.click();
		assert.equal(settingsOverlayService.isVisible(), true);
		assert(element.querySelector('.comet-sidebar-footer-settings-btn')
			?.closest('.comet-actionbar-item')?.classList.contains('comet-is-active'));
		settingsOverlayService.setVisible(false);

		const moreButton = element.querySelector<HTMLButtonElement>(
			'.comet-sidebar-footer-more-btn',
		);
		assert.ok(moreButton);
		moreButton.click();
		await delay();
		const layoutItem = [...document.body.querySelectorAll<HTMLElement>('.comet-dropdown-menu-item')]
			.find(item => item.textContent?.includes('Layout'));
		assert.ok(layoutItem);
		layoutItem.click();
		await delay();
		const flowItem = [...document.body.querySelectorAll<HTMLElement>('.comet-dropdown-menu-item')]
			.find(item => item.textContent?.includes('Flow'));
		assert.ok(flowItem);
		flowItem.click();
		await delay();
		assert.equal(layoutService.getLayoutState().mode, 'flow');

		const updatedMoreButton = element.querySelector<HTMLButtonElement>(
			'.comet-sidebar-footer-more-btn',
		);
		assert.ok(updatedMoreButton);
		updatedMoreButton.click();
		await delay();
		const updatedLayoutItem = [...document.body.querySelectorAll<HTMLElement>('.comet-dropdown-menu-item')]
			.find(item => item.textContent?.includes('Layout'));
		assert.ok(updatedLayoutItem);
		updatedLayoutItem.click();
		await delay();
		const activeFlowItem = [...document.body.querySelectorAll<HTMLElement>('.comet-dropdown-menu-item')]
			.find(item => item.textContent?.includes('Flow'));
		assert.ok(activeFlowItem);
		assert(activeFlowItem.classList.contains('selected'));
		dropdownServices.contextViewProvider.hideContextView();

		locale = 'zh';
		for (const listener of [...localeListeners]) {
			listener();
		}
		assert.equal(
			element.querySelector('.comet-sidebar-footer-settings-btn')?.getAttribute('aria-label'),
			'设置',
		);

		const [newChatButton] = element.querySelectorAll<HTMLButtonElement>(
			'.comet-sidebar-home-nav-item',
		);
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

		part.dispose();
		assert.equal(localeListeners.size, 0);
		layoutService.setSidebarVisible(false);
		settingsOverlayService.setVisible(true);
		assert.equal(element.childElementCount, 0);
	} finally {
		store.dispose();
	}
});
