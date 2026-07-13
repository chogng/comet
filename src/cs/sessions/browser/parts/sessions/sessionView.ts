/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import { autorun } from 'cs/base/common/observable';
import { localize } from 'cs/nls';
import { MenuWorkbenchToolBar } from 'cs/platform/actions/browser/toolbar';
import {
	ContextKeyServiceImpl,
	IContextKeyService,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import { SessionsMenuIds } from 'cs/sessions/common/menus';
import { IChatViewFactory } from 'cs/sessions/services/chatView/browser/chatViewFactory';
import { ISessionsService } from 'cs/sessions/services/sessions/browser/sessionsService';
import { SessionStatus } from 'cs/sessions/services/sessions/common/session';
import {
	isCreateChatAvailable,
	type ISessionChatActionContext,
} from 'cs/sessions/services/sessions/common/sessionActions';
import {
	type IActiveSession,
	type IVisibleSessionSlot,
	isNewSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';
import type {
	IAddressedChatView,
	INewSessionChatView,
	ISessionsChatView,
} from 'cs/sessions/services/chatView/browser/chatViewFactory';

import 'cs/sessions/browser/parts/sessions/media/sessionView.css';

type SessionViewBinding =
	| { readonly kind: 'new'; readonly view: INewSessionChatView }
	| { readonly kind: 'chat'; readonly view: IAddressedChatView };

interface IChatNavigationItem {
	readonly chat: NonNullable<ReturnType<IActiveSession['activeChat']['get']>>;
	readonly title: string;
}

/** Owns the contributed Chat view for one stable visible Sessions slot. */
export class SessionView extends Disposable {
	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-session-view');
	private readonly headerElement = $<HTMLElementTagNameMap['header']>('header.comet-session-header');
	private readonly titleElement = $<HTMLElementTagNameMap['span']>('span.comet-session-header-title');
	private readonly headerActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-session-header-actions');
	private readonly chatHostElement = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-host');
	private readonly chatTabsElement = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-tabs');
	private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-session-view-content');
	private readonly noChatElement = $<HTMLElementTagNameMap['div']>('div.comet-session-no-chat');
	private readonly noChatMessageElement = $<HTMLElementTagNameMap['div']>('div.comet-session-no-chat-message');
	private readonly noChatChoicesElement = $<HTMLElementTagNameMap['div']>('div.comet-session-no-chat-choices');
	private readonly binding = this._register(new MutableDisposable<ISessionsChatView>());
	private readonly chatNavigationDisposables = this._register(new DisposableStore());
	private readonly headerHasSessionContext: ContextKey<boolean>;
	private readonly headerCanCreateChatContext: ContextKey<boolean>;
	private readonly headerSupportsRenameContext: ContextKey<boolean>;
	private readonly headerSupportsDeleteContext: ContextKey<boolean>;
	private readonly chatHeaderSupportsDeleteContext: ContextKey<boolean>;
	private readonly headerToolbar: MenuWorkbenchToolBar;
	private readonly chatHeaderToolbar: MenuWorkbenchToolBar;
	private bindingKind: SessionViewBinding['kind'] | undefined;
	private boundSession: IActiveSession | undefined;
	private boundChat: ReturnType<IActiveSession['activeChat']['get']>;
	private layoutWidth = 0;
	private layoutHeight = 0;

	constructor(
		private readonly slot: IVisibleSessionSlot,
		@IChatViewFactory private readonly chatViewFactory: IChatViewFactory,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.chatTabsElement.setAttribute('role', 'tablist');
		this.chatTabsElement.setAttribute('aria-label', localize('sessions.chatTabs', "Chats"));
		this.noChatMessageElement.textContent = localize('sessions.noOpenChat', "No chat is open.");
		this.noChatElement.append(this.noChatMessageElement, this.noChatChoicesElement);
		const headerContextKeyService = new ContextKeyServiceImpl();
		this.headerHasSessionContext = SessionsContextKeys.sessionHeaderHasSession.bindTo(headerContextKeyService);
		this.headerCanCreateChatContext = SessionsContextKeys.sessionHeaderCanCreateChat.bindTo(headerContextKeyService);
		this.headerSupportsRenameContext = SessionsContextKeys.sessionHeaderSupportsRename.bindTo(headerContextKeyService);
		this.headerSupportsDeleteContext = SessionsContextKeys.sessionHeaderSupportsDelete.bindTo(headerContextKeyService);
		this.chatHeaderSupportsDeleteContext = SessionsContextKeys.chatHeaderSupportsDelete.bindTo(headerContextKeyService);
		const scopedInstantiationService = this._register(instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, headerContextKeyService],
		)));
		this.headerToolbar = this._register(scopedInstantiationService.createInstance(
			MenuWorkbenchToolBar,
			this.headerActionsElement,
			SessionsMenuIds.sessionHeader,
			{
				menuOptions: { shouldForwardArgs: true },
				toolbarOptions: { primaryGroup: () => true },
			},
		));
		this.chatHeaderToolbar = this._register(scopedInstantiationService.createInstance(
			MenuWorkbenchToolBar,
			this.headerActionsElement,
			SessionsMenuIds.chatHeader,
			{
				menuOptions: { shouldForwardArgs: true },
				toolbarOptions: { primaryGroup: () => true },
			},
		));
		this.headerElement.append(this.titleElement, this.headerActionsElement);
		this.chatHostElement.append(this.chatTabsElement, this.contentElement);
		this.element.append(this.headerElement, this.chatHostElement);
		this._register(autorun(reader => {
			const current = this.slot;
			if (isNewSessionSlot(current)) {
				this.renderChatTabs(undefined, undefined, []);
				this.headerToolbar.context = undefined;
				this.chatHeaderToolbar.context = undefined;
				this.headerHasSessionContext.set(false);
				this.headerCanCreateChatContext.set(false);
				this.headerSupportsRenameContext.set(false);
				this.headerSupportsDeleteContext.set(false);
				this.chatHeaderSupportsDeleteContext.set(false);
				this.bindNewSession(undefined, undefined);
				this.titleElement.textContent = '';
				this.headerElement.hidden = true;
				return;
			}
			const capabilities = current.capabilities.read(reader);
			const status = current.status.read(reader);
			const chats = current.chats.read(reader);
			const chat = current.activeChat.read(reader);
			this.headerToolbar.context = current;
			this.chatHeaderToolbar.context = chat
				? { session: current, chat } satisfies ISessionChatActionContext
				: undefined;
			this.headerHasSessionContext.set(true);
			this.headerCanCreateChatContext.set(
				status !== SessionStatus.Draft && isCreateChatAvailable(capabilities, chats.length),
			);
			this.headerSupportsRenameContext.set(status !== SessionStatus.Draft && capabilities.supportsRename);
			this.headerSupportsDeleteContext.set(status !== SessionStatus.Draft && capabilities.supportsDelete);
			this.chatHeaderSupportsDeleteContext.set(
				status !== SessionStatus.Draft && chat?.capabilities.read(reader).supportsDelete === true,
			);
			this.titleElement.textContent = current.title.read(reader);
			this.headerElement.hidden = false;
			if (status === SessionStatus.Draft) {
				this.renderChatTabs(undefined, undefined, []);
				this.bindNewSession(current, current.activeChat.read(reader));
				return;
			}
			const visibleChatTabs = current.visibleChatTabs.read(reader).map(tab => ({
				chat: tab,
				title: tab.title.read(reader),
			}));
			const closedChats = current.closedChats.read(reader).map(closedChat => ({
				chat: closedChat,
				title: closedChat.title.read(reader),
			}));
			this.renderChatTabs(current, chat, visibleChatTabs);
			if (!chat) {
				this.bindNoChat(current, visibleChatTabs, closedChats);
				return;
			}
			this.bindChat(current, chat);
		}));
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setActive(active: boolean): void {
		this.element.classList.toggle('comet-is-active', active);
	}

	layout(width: number, height: number): void {
		this.layoutWidth = width;
		this.layoutHeight = height;
		const headerHeight = this.headerElement.hidden ? 0 : 32;
		const tabsHeight = this.chatTabsElement.hidden ? 0 : 32;
		this.binding.value?.layout(width, Math.max(0, height - headerHeight - tabsHeight));
	}

	focus(): void {
		this.binding.value?.focus();
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
		this.element.replaceChildren();
	}

	private bindNewSession(session: IActiveSession | undefined, chat: ReturnType<IActiveSession['activeChat']['get']>): void {
		if (this.bindingKind === 'new'
			&& this.binding.value
			&& this.boundSession === session
			&& this.boundChat === chat) {
			return;
		}
		const view = this.chatViewFactory.createNewSessionView();
		try {
			view.setDraft(session, chat);
			this.commitBinding('new', view, session, chat);
		} catch (error) {
			view.dispose();
			throw error;
		}
	}

	private bindChat(session: IActiveSession, chat: NonNullable<ReturnType<IActiveSession['activeChat']['get']>>): void {
		if (this.bindingKind === 'chat'
			&& this.binding.value
			&& this.boundSession === session
			&& this.boundChat === chat) {
			return;
		}
		const view = this.chatViewFactory.createChatView();
		try {
			view.setChat(session, chat);
			this.commitBinding('chat', view, session, chat);
		} catch (error) {
			view.dispose();
			throw error;
		}
	}

	private bindNoChat(
		session: IActiveSession,
		openChats: readonly IChatNavigationItem[],
		closedChats: readonly IChatNavigationItem[],
	): void {
		this.noChatChoicesElement.replaceChildren(...[
			...openChats.map(item => this.createChatChoice(session, item, false)),
			...closedChats.map(item => this.createChatChoice(session, item, true)),
		]);
		this.bindingKind = undefined;
		this.boundSession = undefined;
		this.boundChat = undefined;
		this.contentElement.replaceChildren(this.noChatElement);
		this.binding.clear();
	}

	private commitBinding(
		kind: SessionViewBinding['kind'],
		view: ISessionsChatView,
		session: IActiveSession | undefined,
		chat: ReturnType<IActiveSession['activeChat']['get']>,
	): void {
		this.contentElement.replaceChildren(view.getElement());
		this.bindingKind = kind;
		this.boundSession = session;
		this.boundChat = chat;
		this.binding.value = view;
		this.layout(this.layoutWidth, this.layoutHeight);
	}

	private renderChatTabs(
		session: IActiveSession | undefined,
		activeChat: ReturnType<IActiveSession['activeChat']['get']>,
		chats: readonly IChatNavigationItem[],
	): void {
		this.chatNavigationDisposables.clear();
		if (!session || chats.length <= 1) {
			this.chatTabsElement.hidden = true;
			this.chatTabsElement.replaceChildren();
			this.layout(this.layoutWidth, this.layoutHeight);
			return;
		}
		this.chatTabsElement.hidden = false;
		const tabs = chats.map(item => {
			const tab = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-tab');
			const selectButton = $<HTMLElementTagNameMap['button']>('button.comet-session-chat-tab-select');
			selectButton.type = 'button';
			selectButton.textContent = item.title;
			selectButton.setAttribute('role', 'tab');
			selectButton.setAttribute('aria-selected', String(item.chat === activeChat));
			selectButton.title = item.title;
			this.chatNavigationDisposables.add(addDisposableListener(selectButton, EventType.CLICK, () => {
				this.reopenChat(session, item.chat);
			}));
			const closeButton = $<HTMLElementTagNameMap['button']>('button.comet-session-chat-tab-close');
			closeButton.type = 'button';
			closeButton.textContent = '\u00d7';
			closeButton.title = localize('sessions.closeChat', "Close Chat");
			closeButton.setAttribute('aria-label', localize('sessions.closeChat', "Close Chat"));
			this.chatNavigationDisposables.add(addDisposableListener(closeButton, EventType.CLICK, event => {
				event.stopPropagation();
				this.closeChat(session, item.chat);
			}));
			tab.classList.toggle('comet-is-active', item.chat === activeChat);
			tab.append(selectButton, closeButton);
			return tab;
		});
		this.chatTabsElement.replaceChildren(...tabs);
		this.layout(this.layoutWidth, this.layoutHeight);
	}

	private createChatChoice(
		session: IActiveSession,
		item: IChatNavigationItem,
		closed: boolean,
	): HTMLButtonElement {
		const button = $<HTMLElementTagNameMap['button']>('button.comet-session-no-chat-choice');
		button.type = 'button';
		button.textContent = closed
			? localize('sessions.reopenNamedChat', "Reopen {0}", item.title)
			: localize('sessions.openNamedChat', "Open {0}", item.title);
		this.chatNavigationDisposables.add(addDisposableListener(button, EventType.CLICK, () => {
			this.reopenChat(session, item.chat);
		}));
		return button;
	}

	private reopenChat(session: IActiveSession, chat: IChatNavigationItem['chat']): void {
		this.instantiationService.invokeFunction(accessor => {
			accessor.get(ISessionsService).reopenChat(session, chat, { preserveFocus: true });
		});
	}

	private closeChat(session: IActiveSession, chat: IChatNavigationItem['chat']): void {
		this.instantiationService.invokeFunction(accessor => {
			accessor.get(ISessionsService).closeChat(session, chat);
		});
	}
}
