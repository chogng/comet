/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatListWidget } from 'cs/workbench/contrib/chat/browser/widget/chatListWidget';
import { ChatInputPart } from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPart';
import { $ } from 'cs/base/browser/dom';

import 'cs/workbench/contrib/chat/browser/widget/media/chat.css';

export class ChatWidget {
	private props: ChatWidgetProps;
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view-content.comet-chat-content');
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
				'comet-chat-shell',
				this.props.messages.length === 0 ? 'comet-is-empty-state' : '',
			]
				.filter(Boolean)
				.join(' ') });
		if (this.props.errorMessage) {
			const error = $<HTMLElementTagNameMap['div']>('div.comet-chat-error');
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
			inputToolbarActions: [],
			llmModelOptions: this.props.llmModelOptions,
			activeLlmModelOptionValue: this.props.activeLlmModelOptionValue,
			onToggleAutoModelRouting: this.props.onToggleAutoModelRouting,
			onSelectLlmModel: this.props.onSelectLlmModel,
			onToggleMaxContextWindow: this.props.onToggleMaxContextWindow,
			onOpenModelSettings: this.props.onOpenModelSettings,
			isEmpty: this.props.messages.length === 0,
		};
	}

}
