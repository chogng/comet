/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from 'cs/base/browser/dom';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { getComparisonKey, isEqual } from 'cs/base/common/resources';
import { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import { ChatListRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatListRenderer';
import type {
	IChatModel,
	IChatModelSnapshot,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IAgentHostChatState } from 'cs/platform/agentHost/common/protocol';
import type { LocaleMessages } from 'language/locales';
import type { IChatHostPresentation } from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import { IChatBrowserPresentationService } from 'cs/workbench/contrib/chat/browser/chatBrowserPresentations';
import { IChatTranscriptSelectionService } from 'cs/workbench/contrib/chat/browser/chatTranscriptSelections';

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
		@IChatBrowserPresentationService private readonly presentationService: IChatBrowserPresentationService,
		@IChatTranscriptSelectionService private readonly transcriptSelectionService: IChatTranscriptSelectionService,
	) {
		super();
		this.renderer = new ChatListRenderer({
			markdownRendererService,
			presentationService,
		});
		this._register(presentationService.onDidChange(resource => {
			if (this.model && isEqual(this.model.resource, resource)) {
				this.renderSnapshot(this.model.getSnapshot());
			}
		}));
		this.scrollableElement = this._register(new DomScrollableElement(this.contentElement, {
			className: 'comet-chat-thread-scrollable',
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			useShadows: true,
		}));
		this._register(this.scrollableElement.onScroll(() => this.updateScrollDownButtonVisibility()));
		this._register(addDisposableListener(
			this.contentElement.ownerDocument,
			'selectionchange',
			() => this.updateTranscriptSelection(),
		));
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
		this.renderItems(undefined, []);
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
		const snapshot = this.model?.getSnapshot();
		this.renderItems(
			snapshot?.hostState,
			snapshot?.hostPresentations ?? [],
		);
	}

	setModel(model: IChatModel | undefined): void {
		if (this.model) {
			this.transcriptSelectionService.clearSelection(this.model.resource);
			this.scrollTopByResource.set(
				getComparisonKey(this.model.resource),
				this.scrollableElement.getScrollPosition().scrollTop,
			);
		}
		this.modelSubscription.clear();
		this.model = model;
		if (model) {
			this.modelSubscription.value = model.onDidChange(() => this.renderSnapshot(model.getSnapshot()));
		}
		const storedScrollTop = model
			? this.scrollTopByResource.get(getComparisonKey(model.resource))
			: undefined;
		const snapshot = model?.getSnapshot();
		this.renderItems(
			snapshot?.hostState,
			snapshot?.hostPresentations ?? [],
			storedScrollTop ?? 'end',
		);
	}

	override dispose(): void {
		if (this.model) {
			this.transcriptSelectionService.clearSelection(this.model.resource);
		}
		super.dispose();
		this.element.replaceChildren();
	}

	private renderSnapshot(snapshot: IChatModelSnapshot): void {
		this.renderItems(
			snapshot.hostState,
			snapshot.hostPresentations,
		);
	}

	private renderItems(
		hostState: IAgentHostChatState | undefined,
		hostPresentations: readonly IChatHostPresentation[],
		targetScrollTop?: number | 'end',
	): void {
		const previousScrollTop = this.scrollableElement.getScrollPosition().scrollTop;
		const shouldScrollToEnd = targetScrollTop === 'end'
			|| (targetScrollTop === undefined
				&& (this.contentElement.childElementCount === 0 || this.isScrolledToBottom()));
		this.renderDisposables.clear();
		if (this.model) {
			this.transcriptSelectionService.clearSelection(this.model.resource);
		}
		this.renderer.beginRender();
		const renderedHostTurns = hostState === undefined
			? []
			: hostState.turns.flatMap(turn => this.renderer.renderHostTurn(
				this.model!.resource,
				{ session: hostState.session, chat: hostState.id },
				turn,
				hostPresentations.filter(presentation => presentation.turn === turn.id),
				this.renderDisposables,
				this.ui,
			));
		const featurePresentations = this.model
			? this.presentationService.getFeaturePresentations(this.model.resource)
			: [];
		this.contentElement.replaceChildren(
			...renderedHostTurns,
			...featurePresentations.map(presentation => this.renderer.renderFeaturePresentation(
				this.model!.resource,
				presentation,
				this.renderDisposables,
				this.ui,
			)),
		);
		const isEmpty = (hostState?.turns.length ?? 0) === 0 && featurePresentations.length === 0;
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

	private updateTranscriptSelection(): void {
		const model = this.model;
		if (!model) {
			return;
		}
		this.transcriptSelectionService.setSelection(
			model.resource,
			this.renderer.captureSelection(this.contentElement.ownerDocument.getSelection()),
		);
	}
}
