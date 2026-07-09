/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createDropdownMenuActionViewItem,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatListWidget } from 'cs/workbench/contrib/chat/browser/widget/chatListWidget';
import { ChatInputPart } from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPart';
import {
	createChatInputToolbarActionItem,
	renderChatInputToolbarActionContent,
	type ChatInputToolbarActionItem,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputToolbar';
import { $ } from 'cs/base/browser/dom';

import 'cs/workbench/browser/parts/agentbar/media/agentbar.css';
import 'cs/workbench/contrib/chat/browser/widget/media/chat.css';

const CHAT_ARTICLE_SUMMARY_EXPORT_MENU_DATA = 'agentbar-article-summary-export';

function isArticleBatchMessage(message: ChatWidgetProps['messages'][number]) {
	return message.role === 'assistant' && message.includeInAgentHistory === false;
}

function isArticleBatchConversation(messages: ChatWidgetProps['messages']) {
	return messages.length > 0 && messages.every(isArticleBatchMessage);
}

export class ChatWidget {
	private props: ChatWidgetProps;
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view-content.comet-agentbar-content');
	private readonly disposables = new DisposableStore();
	private readonly listWidget: ChatListWidget;
	private readonly inputPart: ChatInputPart;

	constructor(
		props: ChatWidgetProps,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.props = props;
		this.listWidget = instantiationService.createInstance(ChatListWidget, {
			onApplyPatch: messageId => {
				this.props.onApplyPatch(messageId);
			},
			isArticleSelected: href => this.props.isArticleSelected(href),
			onToggleArticleSelected: href => this.props.onToggleArticleSelected(href),
		});
		this.inputPart = instantiationService.createInstance(
			ChatInputPart,
			this.createInputPartProps(),
		);
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: ChatWidgetProps) {
		this.props = props;
		this.render();
	}

	focusInput() {
		this.inputPart.focus();
	}

	dispose() {
		this.disposables.dispose();
		this.inputPart.dispose();
		this.listWidget.dispose();
		this.element.replaceChildren();
	}

	private render() {
		this.element.replaceChildren(this.renderShell());
	}

	private renderShell() {
		const shell = $<HTMLElementTagNameMap['div']>('div', { class: [
				'comet-session-chat-view-body',
				'comet-agentbar-shell',
				this.props.messages.length === 0 ? 'comet-is-empty-state' : '',
				isArticleBatchConversation(this.props.messages) ? 'comet-is-article-batch-state' : '',
			]
				.filter(Boolean)
				.join(' ') });
		if (this.props.errorMessage) {
			const error = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-error');
			error.textContent = this.props.errorMessage;
			shell.append(error);
		}
		this.listWidget.setMessages(this.props.messages);
		this.inputPart.setProps(this.createInputPartProps());
		shell.append(this.listWidget.getElement(), this.inputPart.getElement());
		return shell;
	}

	private createInputPartProps() {
		return {
			activeLlmModelLabel: this.props.activeLlmModelLabel,
			isMaxContextWindowEnabled: this.props.isMaxContextWindowEnabled,
			activeLlmModelSupportsMaxContextWindow: this.props.activeLlmModelSupportsMaxContextWindow,
			question: this.props.question,
			onQuestionChange: this.props.onQuestionChange,
			isAsking: this.props.isAsking,
			onAsk: this.props.onAsk,
			articleQuickSources: this.props.articleQuickSources,
			isArticleSourceFetching: this.props.isArticleSourceFetching,
			onFetchArticleSource: this.props.onFetchArticleSource,
			inputToolbarActions: this.createInputToolbarActions(),
			llmModelOptions: this.props.llmModelOptions,
			activeLlmModelOptionValue: this.props.activeLlmModelOptionValue,
			onToggleAutoModelRouting: this.props.onToggleAutoModelRouting,
			onSelectLlmModel: this.props.onSelectLlmModel,
			onToggleMaxContextWindow: this.props.onToggleMaxContextWindow,
			onOpenModelSettings: this.props.onOpenModelSettings,
			isEmpty: this.props.messages.length === 0,
		};
	}

	private createInputToolbarActions(): ChatInputToolbarActionItem[] {
		if (!this.props.showArticleBatchActions) {
			return [];
		}

		const exportArticleSummariesLabel = localize('chatQuickActionExportArticleSummaries', "导出摘要");
		return [
			createChatInputToolbarActionItem({
				label: localize('chatQuickActionDownloadAllArticles', "下载全部"),
				icon: lxIconSemanticMap.fetch.batchDownload,
				disabled: this.props.isArticleSourceFetching && !this.props.downloadAllProgress,
				progress: this.props.downloadAllProgress,
				onClick: this.props.onDownloadAllArticles,
			}),
			this.props.translationExportProgress
				? createChatInputToolbarActionItem({
					label: exportArticleSummariesLabel,
					icon: 'translate',
					progress: this.props.translationExportProgress,
					onClick: () => this.props.onExportArticleSummaries(true),
				})
				: createDropdownMenuActionViewItem({
					label: exportArticleSummariesLabel,
					title: exportArticleSummariesLabel,
					mode: 'text',
					content: () => renderChatInputToolbarActionContent(
						exportArticleSummariesLabel,
						'translate',
						'chevron-down',
					),
					buttonClassName: 'comet-chat-composer-input-toolbar-action',
					disabled: this.props.isArticleSourceFetching,
					menuData: CHAT_ARTICLE_SUMMARY_EXPORT_MENU_DATA,
					menu: [
						{
							id: 'agentbar-article-summary-export-original',
							label: localize('chatQuickActionExportOriginalArticleSummaries', "直接导出摘要"),
							icon: 'export',
							onClick: () => {
								void this.props.onExportArticleSummaries(false);
							},
						},
						{
							id: 'agentbar-article-summary-export-translated',
							label: localize('chatQuickActionExportTranslatedArticleSummaries', "翻译并导出摘要"),
							icon: 'translate',
							onClick: () => {
								void this.props.onExportArticleSummaries(true);
							},
						},
					],
				}),
		];
	}

}
