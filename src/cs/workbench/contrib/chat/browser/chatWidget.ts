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
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatListWidget } from 'cs/workbench/contrib/chat/browser/chatListWidget';
import { ChatInputPart } from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPart';

import 'cs/workbench/browser/parts/agentbar/media/agentbar.css';
import 'cs/workbench/contrib/chat/browser/widget/media/chat.css';

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

const CHAT_TOPBAR_MORE_MENU_DATA = 'agentbar-topbar-more';
const CHAT_TOPBAR_HISTORY_MENU_DATA = 'agentbar-topbar-history';

export class ChatWidget {
	private props: ChatWidgetProps;
	private readonly element = createElement('div', 'agentbar-content');
	private readonly listWidget: ChatListWidget;
	private readonly inputPart: ChatInputPart;
	private readonly renderDisposables = new DisposableStore();

	constructor(props: ChatWidgetProps) {
		this.props = props;
		this.listWidget = new ChatListWidget({
			onApplyPatch: messageId => {
				this.props.onApplyPatch(messageId);
			},
		});
		this.inputPart = new ChatInputPart(this.createInputPartProps());
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
		this.renderDisposables.dispose();
		this.inputPart.dispose();
		this.listWidget.dispose();
		this.element.replaceChildren();
	}

	private render() {
		this.renderDisposables.clear();
		this.element.replaceChildren(
			this.renderTopbar(),
			this.renderShell(),
		);
	}

	private renderTopbar() {
		const topbar = createElement('div', 'agentbar-tabs-header');
		const topbarItems: ActionBarItem[] = [
			this.createTopbarActionItem(
				localize('assistantSidebarNewConversation', "New chat"),
				lxIconSemanticMap.assistant.newConversation,
				this.props.onCreateConversation,
			),
			this.createTopbarHistoryActionItem(),
			this.createTopbarMoreActionItem(),
		];

		const actionsView = createActionBarView({
			className: 'sidebar-action-bar',
			ariaRole: 'group',
			items: topbarItems,
		});
		this.renderDisposables.add(actionsView);
		topbar.append(actionsView.getElement());
		return topbar;
	}

	private renderShell() {
		const shell = createElement(
			'div',
			[
				'agentbar-shell',
				this.props.messages.length === 0 ? 'is-empty-state' : '',
			]
				.filter(Boolean)
				.join(' '),
		);
		if (this.props.errorMessage) {
			const error = createElement('div', 'agentbar-error');
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
			llmModelOptions: this.props.llmModelOptions,
			activeLlmModelOptionValue: this.props.activeLlmModelOptionValue,
			onToggleAutoModelRouting: this.props.onToggleAutoModelRouting,
			onSelectLlmModel: this.props.onSelectLlmModel,
			onToggleMaxContextWindow: this.props.onToggleMaxContextWindow,
			onOpenModelSettings: this.props.onOpenModelSettings,
			isEmpty: this.props.messages.length === 0,
		};
	}

	private createTopbarActionItem(
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
			buttonClassName: 'sidebar-action-btn',
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

	private createTopbarMoreActionItem(): ActionBarItem {
		return createDropdownMenuActionViewItem({
			label: localize('assistantSidebarMore', "More"),
			title: localize('assistantSidebarMore', "More"),
			content: createLxIcon(lxIconSemanticMap.assistant.more),
			buttonClassName: 'sidebar-action-btn',
			overlayAlignment: 'start',
			menuData: CHAT_TOPBAR_MORE_MENU_DATA,
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

	private createTopbarHistoryActionItem(): ActionBarItem {
		return createDropdownMenuActionViewItem({
			label: localize('assistantSidebarHistory', "History"),
			title: localize('assistantSidebarHistory', "History"),
			content: createLxIcon(lxIconSemanticMap.assistant.history),
			buttonClassName: 'sidebar-action-btn',
			overlayAlignment: 'end',
			menuData: CHAT_TOPBAR_HISTORY_MENU_DATA,
			menu: this.createHistoryMenuItems(''),
			menuHeader: createFilterMenuHeader({
				className: 'agentbar-history-menu-header',
				inputClassName: 'agentbar-history-search-input',
				placeholder: localize('agentbarHistorySearch', "Search history"),
				ariaLabel: localize('agentbarHistorySearch', "Search history"),
				getMenuItems: query => this.createHistoryMenuItems(query),
			}),
		});
	}
}

export function createChatWidget(props: ChatWidgetProps) {
	return new ChatWidget(props);
}
