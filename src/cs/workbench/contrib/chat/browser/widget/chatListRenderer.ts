/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatMessage } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { MarkdownString } from 'cs/base/common/htmlContent';
import type { DisposableStore } from 'cs/base/common/lifecycle';
import { ChatContentMarkdownRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatContentMarkdownRenderer';
import { $ } from 'cs/base/browser/dom';
import { Checkbox } from 'cs/base/browser/ui/toggle/toggle';
import type { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';
import { toChatImageDataUrl } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';
import type { LocaleMessages } from 'language/locales';

export type ChatListRendererOptions = {
	readonly markdownRendererService: IMarkdownRendererService;
	readonly onApplyPatch: (messageId: string) => void;
	readonly isArticleChecked: (articleId: ArticleId) => boolean;
	readonly onSetArticleChecked: (articleId: ArticleId, checked: boolean) => void;
};

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;
type AssistantResult = NonNullable<AssistantMessage['result']>;

function formatEvidenceRankTitle(message: string, rank: number, title: string): string {
	return message
		.replace(/\{0\}/gu, () => String(rank))
		.replace(/\{1\}/gu, () => title);
}

export class ChatListRenderer {
	private readonly markdownRenderer: ChatContentMarkdownRenderer;

	constructor(private readonly options: ChatListRendererOptions) {
		this.markdownRenderer = new ChatContentMarkdownRenderer(options.markdownRendererService);
	}

	renderElement(message: ChatMessage, disposables: DisposableStore, ui: LocaleMessages) {
		if (message.role === 'user') {
			return this.renderUserMessage(message);
		}

		return this.renderAssistantMessage(message, disposables, ui);
	}

	private renderUserMessage(
		message: Extract<ChatMessage, { role: 'user' }>,
	) {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-user');
		const body = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-body');
		const text = $<HTMLElementTagNameMap['p']>('p.comet-chat-message-text');
		text.textContent = message.content;
		body.append(text);
		if (message.imageAttachments.length > 0) {
			const images = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-images');
			for (const attachment of message.imageAttachments) {
				const figure = $<HTMLElementTagNameMap['figure']>('figure.comet-chat-message-image');
				const image = $<HTMLElementTagNameMap['img']>('img');
				image.src = toChatImageDataUrl(attachment);
				image.alt = attachment.name;
				image.loading = 'lazy';
				const caption = $<HTMLElementTagNameMap['figcaption']>('figcaption');
				caption.textContent = attachment.name;
				figure.append(image, caption);
				images.append(figure);
			}
			body.append(images);
		}
		item.append(body);
		return item;
	}

	private renderAssistantMessage(
		message: Extract<ChatMessage, { role: 'assistant' }>,
		disposables: DisposableStore,
		ui: LocaleMessages,
	) {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-assistant');
		const body = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-body');

		if (message.result) {
			const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-result-header');
			const strong = $<HTMLElementTagNameMap['strong']>('strong');
			strong.textContent = ui.assistantSidebarAnswerTitle;
			const pill = $<HTMLElementTagNameMap['span']>('span', { class: `comet-chat-mode-pill ${message.result.rerankApplied ? 'comet-is-enabled' : 'comet-is-disabled'}` });
			pill.textContent = message.result.rerankApplied
				? ui.assistantSidebarRerankOn
				: ui.assistantSidebarRerankOff;
			header.append(strong, pill);
			body.append(header);
		}

		body.append(this.renderMessageContent(message, disposables, ui));

		const result = message.result ?? null;
		if (result && result.evidence.length > 0) {
			body.append(this.renderEvidence(result, ui));
		}

		const patchProposal = this.renderPatchProposal(message, ui);
		if (patchProposal) {
			body.append(patchProposal);
		}

		item.append(body);
		return item;
	}

	private renderMessageContent(
		message: AssistantMessage,
		disposables: DisposableStore,
		ui: LocaleMessages,
	) {
		const content = $<HTMLElementTagNameMap['div']>('div.comet-chat-answer');

		if (message.content.trim()) {
			const rendered = disposables.add(this.markdownRenderer.render(
				new MarkdownString(message.content),
			));
			if (message.articleList) {
				this.renderArticleSelectionControls(rendered.element, message.articleList.articleIds, disposables, ui);
			}
			content.append(rendered.element);
		}

		return content;
	}

	private renderArticleSelectionControls(
		root: HTMLElement,
		articleIds: readonly ArticleId[],
		disposables: DisposableStore,
		ui: LocaleMessages,
	) {
		const items = Array.from(root.querySelectorAll('li'));
		if (items.length !== articleIds.length) {
			throw new Error('Article message items do not match their ArticleId references.');
		}

		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			const articleId = articleIds[index];
			const checkbox = disposables.add(new Checkbox(
				ui.chatArticleExportCheckbox,
				this.options.isArticleChecked(articleId),
			));
			checkbox.domNode.classList.add('comet-chat-article-checkbox');

			const content = $<HTMLElementTagNameMap['span']>('span.comet-chat-article-choice-content');
			content.append(...Array.from(item.childNodes));
			item.classList.add('comet-chat-article-choice');
			item.append(checkbox.domNode, content);

			disposables.add(checkbox.onChange(() => {
				this.options.onSetArticleChecked(articleId, checkbox.checked);
			}));
		}
	}

	private renderEvidence(result: AssistantResult, ui: LocaleMessages) {
		const evidence = $<HTMLElementTagNameMap['div']>('div.comet-chat-evidence');
		const title = $<HTMLElementTagNameMap['strong']>('strong');
		title.textContent = ui.assistantSidebarEvidenceTitle;
		const list = $<HTMLElementTagNameMap['ul']>('ul.comet-chat-evidence-list');
		for (const evidenceItem of result.evidence) {
			const li = $<HTMLElementTagNameMap['li']>('li.comet-chat-evidence-item');
			const titleNode = $<HTMLElementTagNameMap['strong']>('strong.comet-chat-evidence-title');
			titleNode.textContent = formatEvidenceRankTitle(
				ui.chatEvidenceRankTitle,
				evidenceItem.rank,
				evidenceItem.title,
			);
			const meta = $<HTMLElementTagNameMap['p']>('p.comet-chat-evidence-meta');
			meta.textContent = [evidenceItem.journalTitle, evidenceItem.publishedAt]
				.filter(Boolean)
				.join(' | ');
			const text = $<HTMLElementTagNameMap['p']>('p.comet-chat-evidence-text');
			text.textContent = evidenceItem.excerpt;
			li.append(titleNode, meta, text);
			list.append(li);
		}
		evidence.append(title, list);
		return evidence;
	}

	private renderPatchProposal(
		message: AssistantMessage,
		ui: LocaleMessages,
	) {
		const patchProposal = message.patchProposal ?? null;
		if (!patchProposal) {
			return null;
		}

		const card = $<HTMLElementTagNameMap['div']>('div.comet-chat-patch-card');
		const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-patch-header');
		const label = $<HTMLElementTagNameMap['strong']>('strong.comet-chat-patch-label');
		label.textContent = patchProposal.patch.label;
		header.append(label);

		if (patchProposal.isApplied) {
			const status = $<HTMLElementTagNameMap['span']>('span.comet-chat-mode-pill.comet-is-enabled');
			status.textContent = ui.assistantSidebarPatchApplied;
			header.append(status);
		} else if (patchProposal.requiresCustomExecutor) {
			const status = $<HTMLElementTagNameMap['span']>('span.comet-chat-mode-pill.comet-is-disabled');
			status.textContent = ui.assistantSidebarPatchRequiresExecutor;
			header.append(status);
		}

		card.append(header);

		if (patchProposal.patch.summary) {
			const summary = $<HTMLElementTagNameMap['p']>('p.comet-chat-patch-summary');
			summary.textContent = patchProposal.patch.summary;
			card.append(summary);
		}

		const errorText = patchProposal.validationError || patchProposal.applyError;
		if (errorText) {
			const error = $<HTMLElementTagNameMap['p']>('p.comet-chat-patch-error');
			error.textContent = errorText;
			card.append(error);
		}

		if (
			patchProposal.accepted &&
			!patchProposal.requiresCustomExecutor &&
			!patchProposal.validationError &&
			!patchProposal.isApplied
		) {
			const footer = $<HTMLElementTagNameMap['div']>('div.comet-chat-patch-footer');
			const applyButton = $<HTMLElementTagNameMap['button']>('button.comet-chat-patch-btn.comet-btn-base.comet-btn-secondary.comet-btn-sm');
			applyButton.type = 'button';
			applyButton.textContent = ui.assistantSidebarPatchApply;
			applyButton.addEventListener('click', () => {
				this.options.onApplyPatch(message.id);
			});
			footer.append(applyButton);
			card.append(footer);
		}

		return card;
	}
}
