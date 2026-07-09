/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ChatMessage } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { localize } from 'cs/nls';
import { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import { ChatListRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatListRenderer';
import { $ } from 'cs/base/browser/dom';

export type ChatListWidgetOptions = {
	readonly onApplyPatch: (messageId: string) => void;
	readonly isArticleSelected: (href: string) => boolean;
	readonly onToggleArticleSelected: (href: string) => void;
};

export class ChatListWidget {
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view-thread.comet-chat-thread-widget');
	private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-chat-thread');
	private readonly scrollableElement: DomScrollableElement;
	private readonly scrollDownButton = $<HTMLElementTagNameMap['button']>('button.comet-chat-thread-scroll-down');
	private readonly renderer: ChatListRenderer;
	private readonly disposables = new DisposableStore();
	private readonly renderDisposables = this.disposables.add(new DisposableStore());
	private messages: readonly ChatMessage[] = [];

	constructor(
		options: ChatListWidgetOptions,
		@IMarkdownRendererService markdownRendererService: IMarkdownRendererService,
	) {
		this.renderer = new ChatListRenderer({
			markdownRendererService,
			onApplyPatch: options.onApplyPatch,
			isArticleSelected: options.isArticleSelected,
			onToggleArticleSelected: options.onToggleArticleSelected,
		});
		this.scrollableElement = new DomScrollableElement(this.contentElement, {
			className: 'comet-chat-thread-scrollable',
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			useShadows: true,
		});
		this.disposables.add(this.scrollableElement);
		this.disposables.add(this.scrollableElement.onScroll(() => {
			this.updateScrollDownButtonVisibility();
		}));

		this.scrollDownButton.type = 'button';
		this.scrollDownButton.setAttribute(
			'aria-label',
			localize('chatScrollToBottom', "Scroll to Bottom"),
		);
		this.scrollDownButton.append(createLxIcon('chevron-down'));
		const handleScrollDownClick = () => {
			this.scrollToEnd();
			this.updateScrollDownButtonVisibility();
		};
		this.scrollDownButton.addEventListener('click', handleScrollDownClick);
		this.disposables.add(toDisposable(() => {
			this.scrollDownButton.removeEventListener('click', handleScrollDownClick);
		}));

		this.element.append(
			this.scrollableElement.getDomNode(),
			this.scrollDownButton,
		);
		this.updateEmptyState();
		this.updateScrollDownButtonVisibility();
	}

	getElement() {
		return this.element;
	}

	setMessages(messages: readonly ChatMessage[]) {
		const shouldScrollToEnd =
			this.messages.length === 0 ||
			this.isScrolledToBottom();
		this.messages = messages;
		this.renderDisposables.clear();
		this.contentElement.replaceChildren(
			...messages.map(message => this.renderer.renderElement(message, this.renderDisposables)),
		);
		this.updateEmptyState();
		this.scrollableElement.scanDomNode();
		if (shouldScrollToEnd) {
			this.scrollToEnd();
		}
		this.updateScrollDownButtonVisibility();
	}

	dispose() {
		this.disposables.dispose();
		this.element.replaceChildren();
	}

	private updateEmptyState() {
		const isEmpty = this.messages.length === 0;
		this.element.classList.toggle('comet-is-empty', isEmpty);
		this.contentElement.classList.toggle('comet-is-empty', isEmpty);
	}

	private isScrolledToBottom() {
		const distanceToBottom =
			this.contentElement.scrollHeight -
			this.contentElement.clientHeight -
			this.contentElement.scrollTop;
		return distanceToBottom <= 2;
	}

	private scrollToEnd() {
		this.scrollableElement.setScrollPosition({
			scrollTop: Math.max(
				0,
				this.contentElement.scrollHeight - this.contentElement.clientHeight,
			),
		});
	}

	private updateScrollDownButtonVisibility() {
		this.element.classList.toggle(
			'comet-show-scroll-down',
			this.messages.length > 0 && !this.isScrolledToBottom(),
		);
	}
}
