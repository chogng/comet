/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createActionBarView,
	type ActionBarActionItem,
	type ActionBarItem,
	type ActionBarMenuItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import {
	createDropdownMenuActionViewItem,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createFilterMenuHeader } from 'cs/base/browser/ui/dropdown/dropdownSearchHeader';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
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

const CHAT_HEADER_MORE_MENU_DATA = 'agentbar-header-more';
const CHAT_HEADER_HISTORY_MENU_DATA = 'agentbar-header-history';
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
	private readonly renderDisposables = this.disposables.add(new DisposableStore());

	constructor(
		props: ChatWidgetProps,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.props = props;
		this.listWidget = new ChatListWidget({
			markdownRendererService: props.markdownRendererService,
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
		this.renderDisposables.clear();
		this.element.replaceChildren(
			this.renderHeader(),
			this.renderShell(),
		);
	}

	private renderHeader() {
		const header = $<HTMLElementTagNameMap['div']>('div.comet-agentbar-tabs-header');
		const headerItems: ActionBarItem[] = [
			this.createHeaderActionItem(
				localize('assistantSidebarNewConversation', "New chat"),
				lxIconSemanticMap.assistant.newConversation,
				this.props.onCreateConversation,
			),
			this.createHeaderHistoryActionItem(),
			this.createHeaderMoreActionItem(),
		];

		const actionsView = createActionBarView({
			className: 'comet-sidebar-action-bar',
			ariaRole: 'group',
			items: headerItems,
		});
		this.renderDisposables.add(actionsView);
		header.append(actionsView.getElement());
		return header;
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

	private createHeaderActionItem(
		label: string,
		icon: LxIconName,
		onClick?: () => void,
		isActive = false,
		isToggle = false,
		triggerId?: string,
	): ActionBarActionItem {
		return {
			label,
			content: createLxIcon(icon),
			buttonClassName: 'comet-sidebar-action-btn',
			checked: isToggle ? isActive : undefined,
			active: isActive,
			buttonAttributes: triggerId
				? {
					'data-agentbar-trigger': triggerId,
				}
				: undefined,
			onClick: onClick ? () => onClick() : undefined,
		};
	}

	private createHistoryMenuItems(keyword: string): ActionBarMenuItem[] {
		const normalizedKeyword = keyword.trim().toLowerCase();
		const matchedConversations = this.props.conversations.filter(conversation =>
			conversation.title.toLowerCase().includes(normalizedKeyword),
		);

		if (matchedConversations.length === 0) {
			return [
				{
					id: 'agentbar-history-empty',
					label: localize('agentbarHistoryEmpty', "no matching agents"),
					disabled: true,
				},
			];
		}

		return matchedConversations.map((conversation, index) => ({
			id: `agentbar-history-${conversation.id}-${index}`,
			label: conversation.title,
			title: localize(
				'agentbarHistoryConversationTitle',
				"{0} ({1} messages)",
				conversation.title,
				conversation.messages.length,
			),
			checked: conversation.id === this.props.activeConversationId,
			onClick: () => {
				this.props.onActivateConversation(conversation.id);
			},
		}));
	}

	private createHeaderMoreActionItem(): ActionBarItem {
		return createDropdownMenuActionViewItem({
			label: localize('assistantSidebarMore', "More"),
			title: localize('assistantSidebarMore', "More"),
			content: createLxIcon(lxIconSemanticMap.assistant.more),
			buttonClassName: 'comet-sidebar-action-btn',
			overlayAlignment: 'start',
			menuData: CHAT_HEADER_MORE_MENU_DATA,
			menu: [
				{
					label: localize('assistantSidebarNewConversation', "New chat"),
					onClick: () => {
						this.props.onCreateConversation();
					},
				},
			],
		});
	}

	private createHeaderHistoryActionItem(): ActionBarItem {
		return createDropdownMenuActionViewItem({
			label: localize('assistantSidebarHistory', "History"),
			title: localize('assistantSidebarHistory', "History"),
			content: createLxIcon(lxIconSemanticMap.assistant.history),
			buttonClassName: 'comet-sidebar-action-btn',
			overlayAlignment: 'end',
			menuData: CHAT_HEADER_HISTORY_MENU_DATA,
			menu: this.createHistoryMenuItems(''),
			menuHeader: createFilterMenuHeader({
				className: 'comet-agentbar-history-menu-header',
				inputClassName: 'comet-agentbar-history-search-input',
				placeholder: localize('agentbarHistorySearch', "Search history"),
				ariaLabel: localize('agentbarHistorySearch', "Search history"),
				getMenuItems: query => this.createHistoryMenuItems(query),
			}),
		});
	}
}
