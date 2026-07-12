/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { getComparisonKey } from 'cs/base/common/resources';
import { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import { ChatListRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatListRenderer';
import type { IChatModel } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { LocaleMessages } from 'language/locales';

/** Scrollable transcript for the one Chat model currently bound by its owner. */
export class ChatListWidget extends Disposable {
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view-thread.comet-chat-thread-widget');
	private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-chat-thread');
	private readonly scrollableElement: DomScrollableElement;
	private readonly scrollDownButton = $<HTMLElementTagNameMap['button']>('button.comet-chat-thread-scroll-down');
	private readonly renderer: ChatListRenderer;
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly modelSubscription = this._register(new MutableDisposable());
	private readonly scrollTopByResource = new Map<string, number>();
	private model: IChatModel | undefined;

	constructor(
		private ui: LocaleMessages,
		@IMarkdownRendererService markdownRendererService: IMarkdownRendererService,
		@IChatService private readonly chatService: IChatService,
	) {
		super();
		this.renderer = new ChatListRenderer({
			markdownRendererService,
			onApplyPatch: messageId => {
				const model = this.requireModel();
				this.chatService.applyPatch(model.resource, messageId);
			},
			isArticleChecked: articleId => {
				const model = this.requireModel();
				return this.chatService.isArticleChecked(model.resource, articleId);
			},
			onSetArticleChecked: (articleId, checked) => {
				const model = this.requireModel();
				this.chatService.setArticleChecked(model.resource, articleId, checked);
			},
		});
		this.scrollableElement = this._register(new DomScrollableElement(this.contentElement, {
			className: 'comet-chat-thread-scrollable',
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			useShadows: true,
		}));
		this._register(this.scrollableElement.onScroll(() => this.updateScrollDownButtonVisibility()));
		this.scrollDownButton.type = 'button';
		this.scrollDownButton.setAttribute('aria-label', this.ui.chatScrollToBottom);
		this.scrollDownButton.append(createLxIcon('chevron-down'));
		const handleScrollDownClick = () => {
			this.scrollToEnd();
			this.updateScrollDownButtonVisibility();
		};
		this.scrollDownButton.addEventListener('click', handleScrollDownClick);
		this._register(toDisposable(() => this.scrollDownButton.removeEventListener('click', handleScrollDownClick)));
		this.element.append(this.scrollableElement.getDomNode(), this.scrollDownButton);
		this.renderMessages([]);
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setLocaleMessages(ui: LocaleMessages): void {
		if (this.ui === ui) {
			return;
		}
		this.ui = ui;
		this.scrollDownButton.setAttribute('aria-label', this.ui.chatScrollToBottom);
		this.renderMessages(this.model?.getSnapshot().messages ?? []);
	}

	setModel(model: IChatModel | undefined): void {
		if (this.model) {
			this.scrollTopByResource.set(
				getComparisonKey(this.model.resource),
				this.scrollableElement.getScrollPosition().scrollTop,
			);
		}
		this.modelSubscription.clear();
		this.model = model;
		if (model) {
			this.modelSubscription.value = model.onDidChange(() => this.renderMessages(model.getSnapshot().messages));
		}
		const storedScrollTop = model
			? this.scrollTopByResource.get(getComparisonKey(model.resource))
			: undefined;
		this.renderMessages(
			model?.getSnapshot().messages ?? [],
			storedScrollTop ?? 'end',
		);
	}

	override dispose(): void {
		super.dispose();
		this.element.replaceChildren();
	}

	private renderMessages(
		messages: readonly import('cs/workbench/contrib/chat/common/chatService/chatService').ChatMessage[],
		targetScrollTop?: number | 'end',
	): void {
		const previousScrollTop = this.scrollableElement.getScrollPosition().scrollTop;
		const shouldScrollToEnd = targetScrollTop === 'end'
			|| (targetScrollTop === undefined
				&& (this.contentElement.childElementCount === 0 || this.isScrolledToBottom()));
		this.renderDisposables.clear();
		this.contentElement.replaceChildren(
			...messages.map(message => this.renderer.renderElement(message, this.renderDisposables, this.ui)),
		);
		const isEmpty = messages.length === 0;
		this.element.classList.toggle('comet-is-empty', isEmpty);
		this.contentElement.classList.toggle('comet-is-empty', isEmpty);
		this.scrollableElement.scanDomNode();
		if (shouldScrollToEnd) {
			this.scrollToEnd();
		} else {
			this.scrollableElement.setScrollPosition({
				scrollTop: targetScrollTop ?? previousScrollTop,
			});
		}
		this.updateScrollDownButtonVisibility();
	}

	private requireModel(): IChatModel {
		if (!this.model) {
			throw new Error('A Chat transcript action requires a bound Chat model.');
		}
		return this.model;
	}

	private isScrolledToBottom(): boolean {
		const distanceToBottom = this.contentElement.scrollHeight
			- this.contentElement.clientHeight
			- this.contentElement.scrollTop;
		return distanceToBottom <= 2;
	}

	private scrollToEnd(): void {
		this.scrollableElement.setScrollPosition({
			scrollTop: Math.max(0, this.contentElement.scrollHeight - this.contentElement.clientHeight),
		});
	}

	private updateScrollDownButtonVisibility(): void {
		this.element.classList.toggle(
			'comet-show-scroll-down',
			this.contentElement.childElementCount > 0 && !this.isScrolledToBottom(),
		);
	}
}
