/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { AssistantChatMessage } from 'cs/workbench/browser/assistantModel';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { localize } from 'cs/nls';
import type { Article } from 'cs/workbench/services/article/articleFetch';

export type ChatListRendererOptions = {
	readonly onApplyPatch: (messageId: string) => void;
	readonly onDownloadArticlePdf: (article: Article) => Promise<void>;
	readonly onOpenArticleDetails: (article: Article) => void | Promise<void>;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
) {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	return element;
}

export class ChatListRenderer {
	constructor(private readonly options: ChatListRendererOptions) {}

	renderElement(message: AssistantChatMessage) {
		if (message.role === 'user') {
			return this.renderUserMessage(message);
		}

		if (message.role === 'article') {
			return this.renderArticleMessage(message);
		}

		return this.renderAssistantMessage(message);
	}

	private renderUserMessage(
		message: Extract<AssistantChatMessage, { role: 'user' }>,
	) {
		const item = createElement(
			'div',
			'agentbar-message agentbar-message-user',
		);
		const text = createElement('p', 'agentbar-message-text');
		text.textContent = message.content;
		item.append(text);
		return item;
	}

	private renderArticleMessage(
		message: Extract<AssistantChatMessage, { role: 'article' }>,
	) {
		const item = createElement(
			'div',
			'agentbar-message agentbar-message-article',
		);
		const body = createElement('div', 'agentbar-message-body');
		const card = createElement('article', 'agentbar-article-card');
		const header = createElement('div', 'agentbar-article-card-header');
		const source = createElement('span', 'agentbar-article-source');
		source.textContent = message.sourceLabel;
		const downloadButton = createElement(
			'button',
			'agentbar-article-download-btn btn-base btn-secondary btn-sm',
		);
		downloadButton.type = 'button';
		downloadButton.append(
			createLxIcon(lxIconSemanticMap.articleCard.download),
			document.createTextNode(
				localize('agentbarArticleDownloadPdf', "Download PDF"),
			),
		);
		downloadButton.addEventListener('click', event => {
			event.stopPropagation();
			void this.options.onDownloadArticlePdf(message.article);
		});
		header.append(source, downloadButton);

		const title = createElement('h3', 'agentbar-article-title');
		title.textContent = message.article.title;
		title.addEventListener('click', () => {
			void this.options.onOpenArticleDetails(message.article);
		});

		const meta = createElement('p', 'agentbar-article-meta');
		meta.textContent = [
			message.article.journalTitle,
			message.article.publishedAt,
			message.article.articleType,
		].filter(Boolean).join(' | ');

		card.append(header, title, meta);
		body.append(card);
		item.append(body);
		return item;
	}

	private renderAssistantMessage(
		message: Extract<AssistantChatMessage, { role: 'assistant' }>,
	) {
		const item = createElement(
			'div',
			'agentbar-message agentbar-message-assistant',
		);
		const body = createElement('div', 'agentbar-message-body');
		const header = createElement('div', 'agentbar-result-header');
		const strong = document.createElement('strong');
		strong.textContent = localize('assistantSidebarAnswerTitle', "Answer");
		const pill = createElement(
			'span',
			`agentbar-mode-pill ${message.result.rerankApplied ? 'is-enabled' : 'is-disabled'}`,
		);
		pill.textContent = message.result.rerankApplied
			? localize('assistantSidebarRerankOn', "Rerank on")
			: localize('assistantSidebarRerankOff', "Rerank fallback");
		header.append(strong, pill);
		const answer = createElement('p', 'agentbar-answer');
		answer.textContent = message.content;
		body.append(header, answer);

		if (message.result.evidence.length > 0) {
			body.append(this.renderEvidence(message));
		}

		const patchProposal = this.renderPatchProposal(message);
		if (patchProposal) {
			body.append(patchProposal);
		}

		item.append(body);
		return item;
	}

	private renderEvidence(
		message: Extract<AssistantChatMessage, { role: 'assistant' }>,
	) {
		const evidence = createElement('div', 'agentbar-evidence');
		const title = document.createElement('strong');
		title.textContent = localize('assistantSidebarEvidenceTitle', "Evidence");
		const list = createElement('ul', 'agentbar-evidence-list');
		for (const evidenceItem of message.result.evidence) {
			const li = createElement('li', 'agentbar-evidence-item');
			const titleNode = createElement('strong', 'agentbar-evidence-title');
			titleNode.textContent = localize(
				'agentbarEvidenceRankTitle',
				"[{0}] {1}",
				evidenceItem.rank,
				evidenceItem.title,
			);
			const meta = createElement('p', 'agentbar-evidence-meta');
			meta.textContent = [evidenceItem.journalTitle, evidenceItem.publishedAt]
				.filter(Boolean)
				.join(' | ');
			const text = createElement('p', 'agentbar-evidence-text');
			text.textContent = evidenceItem.excerpt;
			li.append(titleNode, meta, text);
			list.append(li);
		}
		evidence.append(title, list);
		return evidence;
	}

	private renderPatchProposal(
		message: Extract<AssistantChatMessage, { role: 'assistant' }>,
	) {
		const patchProposal = message.patchProposal ?? null;
		if (!patchProposal) {
			return null;
		}

		const card = createElement('div', 'agentbar-patch-card');
		const header = createElement('div', 'agentbar-patch-header');
		const label = createElement('strong', 'agentbar-patch-label');
		label.textContent = patchProposal.patch.label;
		header.append(label);

		if (patchProposal.isApplied) {
			const status = createElement('span', 'agentbar-mode-pill is-enabled');
			status.textContent = localize('assistantSidebarPatchApplied', "Applied");
			header.append(status);
		} else if (patchProposal.requiresCustomExecutor) {
			const status = createElement('span', 'agentbar-mode-pill is-disabled');
			status.textContent = localize(
				'assistantSidebarPatchRequiresExecutor',
				"Custom executor required",
			);
			header.append(status);
		}

		card.append(header);

		if (patchProposal.patch.summary) {
			const summary = createElement('p', 'agentbar-patch-summary');
			summary.textContent = patchProposal.patch.summary;
			card.append(summary);
		}

		const errorText = patchProposal.validationError || patchProposal.applyError;
		if (errorText) {
			const error = createElement('p', 'agentbar-patch-error');
			error.textContent = errorText;
			card.append(error);
		}

		if (
			patchProposal.accepted &&
			!patchProposal.requiresCustomExecutor &&
			!patchProposal.validationError &&
			!patchProposal.isApplied
		) {
			const footer = createElement('div', 'agentbar-patch-footer');
			const applyButton = createElement(
				'button',
				'agentbar-patch-btn btn-base btn-secondary btn-sm',
			);
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
