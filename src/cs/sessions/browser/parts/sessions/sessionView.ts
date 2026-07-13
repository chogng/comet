/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { Disposable, MutableDisposable } from 'cs/base/common/lifecycle';
import { autorun } from 'cs/base/common/observable';
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
import { SessionStatus } from 'cs/sessions/services/sessions/common/session';
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

/** Owns the contributed Chat view for one stable visible Sessions slot. */
export class SessionView extends Disposable {
	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-session-view');
	private readonly headerElement = $<HTMLElementTagNameMap['header']>('header.comet-session-header');
	private readonly titleElement = $<HTMLElementTagNameMap['span']>('span.comet-session-header-title');
	private readonly headerActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-session-header-actions');
	private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-session-view-content');
	private readonly binding = this._register(new MutableDisposable<ISessionsChatView>());
	private readonly headerHasSessionContext: ContextKey<boolean>;
	private readonly headerSupportsRenameContext: ContextKey<boolean>;
	private readonly headerSupportsDeleteContext: ContextKey<boolean>;
	private readonly headerToolbar: MenuWorkbenchToolBar;
	private bindingKind: SessionViewBinding['kind'] | undefined;

	constructor(
		private readonly slot: IVisibleSessionSlot,
		@IChatViewFactory private readonly chatViewFactory: IChatViewFactory,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const headerContextKeyService = new ContextKeyServiceImpl();
		this.headerHasSessionContext = SessionsContextKeys.sessionHeaderHasSession.bindTo(headerContextKeyService);
		this.headerSupportsRenameContext = SessionsContextKeys.sessionHeaderSupportsRename.bindTo(headerContextKeyService);
		this.headerSupportsDeleteContext = SessionsContextKeys.sessionHeaderSupportsDelete.bindTo(headerContextKeyService);
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
		this.headerElement.append(this.titleElement, this.headerActionsElement);
		this.element.append(this.headerElement, this.contentElement);
		this._register(autorun(reader => {
			const current = this.slot;
			if (isNewSessionSlot(current)) {
				this.headerToolbar.context = undefined;
				this.headerHasSessionContext.set(false);
				this.headerSupportsRenameContext.set(false);
				this.headerSupportsDeleteContext.set(false);
				this.bindNewSession(undefined);
				this.titleElement.textContent = '';
				this.headerElement.hidden = true;
				return;
			}
			const capabilities = current.capabilities.read(reader);
			const status = current.status.read(reader);
			this.headerToolbar.context = current;
			this.headerHasSessionContext.set(true);
			this.headerSupportsRenameContext.set(status !== SessionStatus.Draft && capabilities.supportsRename);
			this.headerSupportsDeleteContext.set(status !== SessionStatus.Draft && capabilities.supportsDelete);
			this.titleElement.textContent = current.title.read(reader);
			this.headerElement.hidden = false;
			if (status === SessionStatus.Draft) {
				this.bindNewSession(current);
				return;
			}
			this.bindChat(current, current.activeChat.read(reader));
		}));
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setActive(active: boolean): void {
		this.element.classList.toggle('comet-is-active', active);
	}

	layout(width: number, height: number): void {
		this.binding.value?.layout(width, Math.max(0, height - (this.headerElement.hidden ? 0 : 32)));
	}

	focus(): void {
		this.binding.value?.focus();
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
		this.element.replaceChildren();
	}

	private bindNewSession(session: IActiveSession | undefined): void {
		const binding = this.ensureBinding('new');
		binding.view.setSession(session);
	}

	private bindChat(session: IActiveSession, chat: ReturnType<IActiveSession['activeChat']['get']>): void {
		const binding = this.ensureBinding('chat');
		binding.view.setChat(session, chat);
	}

	private ensureBinding(kind: 'new'): Extract<SessionViewBinding, { readonly kind: 'new' }>;
	private ensureBinding(kind: 'chat'): Extract<SessionViewBinding, { readonly kind: 'chat' }>;
	private ensureBinding(kind: SessionViewBinding['kind']): SessionViewBinding {
		if (this.bindingKind === kind && this.binding.value) {
			return { kind, view: this.binding.value } as SessionViewBinding;
		}
		const view = kind === 'new'
			? this.chatViewFactory.createNewSessionView()
			: this.chatViewFactory.createChatView();
		this.bindingKind = kind;
		this.binding.value = view;
		this.contentElement.replaceChildren(view.getElement());
		return { kind, view } as SessionViewBinding;
	}
}
