/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { AssistantChatMessage } from 'cs/workbench/browser/assistantModel';
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

type AssistantMessage = Extract<AssistantChatMessage, { role: 'assistant' }>;
type AssistantResult = NonNullable<AssistantMessage['result']>;

export class ChatListRenderer {
	private readonly markdownRenderer: ChatContentMarkdownRenderer;

	constructor(private readonly options: ChatListRendererOptions) {
		this.markdownRenderer = new ChatContentMarkdownRenderer(options.markdownRendererService);
	}

	renderElement(message: AssistantChatMessage, disposables: DisposableStore) {
		if (message.role === 'user') {
			return this.renderUserMessage(message);
		}

		return this.renderAssistantMessage(message, disposables);
	}

	private renderUserMessage(
		message: Extract<AssistantChatMessage, { role: 'user' }>,
	) {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-message.comet-agentbar-message-user');
		const text = $<HTMLElementTagNameMap['p']>('p.comet-agentbar-message-text');
		text.textContent = message.content;
		item.append(text);
		return item;
	}

	private renderAssistantMessage(
		message: Extract<AssistantChatMessage, { role: 'assistant' }>,
		disposables: DisposableStore,
	) {
		const item = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-message.comet-agentbar-message-assistant');
		const body = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-message-body');

		if (message.result) {
			const header = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-result-header');
			const strong = document.createElement('strong');
			strong.textContent = localize('assistantSidebarAnswerTitle', "Answer");
			const pill = $<HTMLElementTagNameMap['span']>('span', { class: `comet-agentbar-mode-pill ${message.result.rerankApplied ? 'comet-is-enabled' : 'comet-is-disabled'}` });
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
		const content = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-answer');

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
					'agentbarArticleExportCheckbox',
					"Include Article in Export",
				),
				this.options.isArticleSelected(href),
			));
			checkbox.domNode.classList.add('comet-agentbar-article-checkbox');

			const content = $<HTMLElementTagNameMap['span']>('span.comet-agentbar-article-choice-content');
			content.append(...Array.from(item.childNodes));
			item.classList.add('comet-agentbar-article-choice');
			item.append(checkbox.domNode, content);

			disposables.add(checkbox.onChange(() => {
				this.options.onToggleArticleSelected(href);
			}));
		}
	}

	private renderEvidence(result: AssistantResult) {
		const evidence = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-evidence');
		const title = document.createElement('strong');
		title.textContent = localize('assistantSidebarEvidenceTitle', "Evidence");
		const list = $<HTMLElementTagNameMap['ul']>('ul.comet-agentbar-evidence-list');
		for (const evidenceItem of result.evidence) {
			const li = $<HTMLElementTagNameMap['li']>('li.comet-agentbar-evidence-item');
			const titleNode = $<HTMLElementTagNameMap['strong']>('strong.comet-agentbar-evidence-title');
			titleNode.textContent = localize(
				'agentbarEvidenceRankTitle',
				"[{0}] {1}",
				evidenceItem.rank,
				evidenceItem.title,
			);
			const meta = $<HTMLElementTagNameMap['p']>('p.comet-agentbar-evidence-meta');
			meta.textContent = [evidenceItem.journalTitle, evidenceItem.publishedAt]
				.filter(Boolean)
				.join(' | ');
			const text = $<HTMLElementTagNameMap['p']>('p.comet-agentbar-evidence-text');
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

		const card = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-patch-card');
		const header = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-patch-header');
		const label = $<HTMLElementTagNameMap['strong']>('strong.comet-agentbar-patch-label');
		label.textContent = patchProposal.patch.label;
		header.append(label);

		if (patchProposal.isApplied) {
			const status = $<HTMLElementTagNameMap['span']>('span.comet-agentbar-mode-pill.comet-is-enabled');
			status.textContent = localize('assistantSidebarPatchApplied', "Applied");
			header.append(status);
		} else if (patchProposal.requiresCustomExecutor) {
			const status = $<HTMLElementTagNameMap['span']>('span.comet-agentbar-mode-pill.comet-is-disabled');
			status.textContent = localize(
				'assistantSidebarPatchRequiresExecutor',
				"Custom executor required",
			);
			header.append(status);
		}

		card.append(header);

		if (patchProposal.patch.summary) {
			const summary = $<HTMLElementTagNameMap['p']>('p.comet-agentbar-patch-summary');
			summary.textContent = patchProposal.patch.summary;
			card.append(summary);
		}

		const errorText = patchProposal.validationError || patchProposal.applyError;
		if (errorText) {
			const error = $<HTMLElementTagNameMap['p']>('p.comet-agentbar-patch-error');
			error.textContent = errorText;
			card.append(error);
		}

		if (
			patchProposal.accepted &&
			!patchProposal.requiresCustomExecutor &&
			!patchProposal.validationError &&
			!patchProposal.isApplied
		) {
			const footer = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-patch-footer');
			const applyButton = $<HTMLElementTagNameMap['button']>('button.comet-agentbar-patch-btn.comet-btn-base.comet-btn-secondary.comet-btn-sm');
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
