/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ChatMessage } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { localize } from 'cs/nls';
import { MarkdownString } from 'cs/base/common/htmlContent';
import type { DisposableStore } from 'cs/base/common/lifecycle';
import { ChatContentMarkdownRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatContentMarkdownRenderer';
import { $ } from 'cs/base/browser/dom';
import { Checkbox } from 'cs/base/browser/ui/toggle/toggle';
import type { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';

export type ChatListRendererOptions = {
	readonly markdownRendererService: IMarkdownRendererService;
	readonly onApplyPatch: (messageId: string) => void;
	readonly isArticleSelected: (href: string) => boolean;
	readonly onToggleArticleSelected: (href: string) => void;
};

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;
type AssistantResult = NonNullable<AssistantMessage['result']>;

export class ChatListRenderer {
	private readonly markdownRenderer: ChatContentMarkdownRenderer;

	constructor(private readonly options: ChatListRendererOptions) {
		this.markdownRenderer = new ChatContentMarkdownRenderer(options.markdownRendererService);
	}

	renderElement(message: ChatMessage, disposables: DisposableStore) {
		if (message.role === 'user') {
			return this.renderUserMessage(message);
		}

		return this.renderAssistantMessage(message, disposables);
	}

	private renderUserMessage(
		message: Extract<ChatMessage, { role: 'user' }>,
	) {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-user');
		const text = $<HTMLElementTagNameMap['p']>('p.comet-chat-message-text');
		text.textContent = message.content;
		item.append(text);
		return item;
	}

	private renderAssistantMessage(
		message: Extract<ChatMessage, { role: 'assistant' }>,
		disposables: DisposableStore,
	) {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-chat-message.comet-chat-message-assistant');
		const body = $<HTMLElementTagNameMap['div']>('div.comet-chat-message-body');

		if (message.result) {
			const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-result-header');
			const strong = document.createElement('strong');
			strong.textContent = localize('assistantSidebarAnswerTitle', "Answer");
			const pill = $<HTMLElementTagNameMap['span']>('span', { class: `comet-chat-mode-pill ${message.result.rerankApplied ? 'comet-is-enabled' : 'comet-is-disabled'}` });
			pill.textContent = message.result.rerankApplied
				? localize('assistantSidebarRerankOn', "Rerank on")
				: localize('assistantSidebarRerankOff', "Rerank fallback");
			header.append(strong, pill);
			body.append(header);
		}

		body.append(this.renderMessageContent(message, disposables));

		const result = message.result ?? null;
		if (result && result.evidence.length > 0) {
			body.append(this.renderEvidence(result));
		}

		const patchProposal = this.renderPatchProposal(message);
		if (patchProposal) {
			body.append(patchProposal);
		}

		item.append(body);
		return item;
	}

	private renderMessageContent(
		message: AssistantMessage,
		disposables: DisposableStore,
	) {
		const content = $<HTMLElementTagNameMap['div']>('div.comet-chat-answer');

		if (message.content.trim()) {
			const rendered = disposables.add(this.markdownRenderer.render(
				new MarkdownString(message.content),
			));
			if (message.includeInAgentHistory === false) {
				this.renderArticleSelectionControls(rendered.element, disposables);
			}
			content.append(rendered.element);
		}

		return content;
	}

	private renderArticleSelectionControls(
		root: HTMLElement,
		disposables: DisposableStore,
	) {
		for (const item of Array.from(root.querySelectorAll('li'))) {
			const link = item.querySelector('a[data-href]');
			const href = link?.getAttribute('data-href') ?? '';
			if (!href) {
				continue;
			}

			const checkbox = disposables.add(new Checkbox(
				localize(
					'chatArticleExportCheckbox',
					"Include Article in Export",
				),
				this.options.isArticleSelected(href),
			));
			checkbox.domNode.classList.add('comet-chat-article-checkbox');

			const content = $<HTMLElementTagNameMap['span']>('span.comet-chat-article-choice-content');
			content.append(...Array.from(item.childNodes));
			item.classList.add('comet-chat-article-choice');
			item.append(checkbox.domNode, content);

			disposables.add(checkbox.onChange(() => {
				this.options.onToggleArticleSelected(href);
			}));
		}
	}

	private renderEvidence(result: AssistantResult) {
		const evidence = $<HTMLElementTagNameMap['div']>('div.comet-chat-evidence');
		const title = document.createElement('strong');
		title.textContent = localize('assistantSidebarEvidenceTitle', "Evidence");
		const list = $<HTMLElementTagNameMap['ul']>('ul.comet-chat-evidence-list');
		for (const evidenceItem of result.evidence) {
			const li = $<HTMLElementTagNameMap['li']>('li.comet-chat-evidence-item');
			const titleNode = $<HTMLElementTagNameMap['strong']>('strong.comet-chat-evidence-title');
			titleNode.textContent = localize(
				'chatEvidenceRankTitle',
				"[{0}] {1}",
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
			status.textContent = localize('assistantSidebarPatchApplied', "Applied");
			header.append(status);
		} else if (patchProposal.requiresCustomExecutor) {
			const status = $<HTMLElementTagNameMap['span']>('span.comet-chat-mode-pill.comet-is-disabled');
			status.textContent = localize(
				'assistantSidebarPatchRequiresExecutor',
				"Custom executor required",
			);
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
			applyButton.textContent = localize('assistantSidebarPatchApply', "Apply patch");
			applyButton.addEventListener('click', () => {
				this.options.onApplyPatch(message.id);
			});
			footer.append(applyButton);
			card.append(footer);
		}

		return card;
	}
}
