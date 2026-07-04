/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarActionItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import {
	ChatInputModelPickerActionViewItem,
	type ChatInputModelPickerProps,
} from 'cs/workbench/contrib/chat/browser/input/chatInputPickerActionItem';

export type ChatInputPartProps = Pick<
	ChatWidgetProps,
	| 'activeLlmModelLabel'
	| 'isMaxContextWindowEnabled'
	| 'activeLlmModelSupportsMaxContextWindow'
	| 'question'
	| 'onQuestionChange'
	| 'isAsking'
	| 'onAsk'
	| 'llmModelOptions'
	| 'activeLlmModelOptionValue'
	| 'onToggleAutoModelRouting'
	| 'onSelectLlmModel'
	| 'onToggleMaxContextWindow'
	| 'onOpenModelSettings'
> & {
	readonly isEmpty: boolean;
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

function getModelPickerProps(props: ChatInputPartProps): ChatInputModelPickerProps {
	return {
		activeLlmModelLabel: props.activeLlmModelLabel,
		isMaxContextWindowEnabled: props.isMaxContextWindowEnabled,
		activeLlmModelSupportsMaxContextWindow: props.activeLlmModelSupportsMaxContextWindow,
		llmModelOptions: props.llmModelOptions,
		activeLlmModelOptionValue: props.activeLlmModelOptionValue,
		onToggleAutoModelRouting: props.onToggleAutoModelRouting,
		onSelectLlmModel: props.onSelectLlmModel,
		onToggleMaxContextWindow: props.onToggleMaxContextWindow,
		onOpenModelSettings: props.onOpenModelSettings,
	};
}

export class ChatInputPart {
	private props: ChatInputPartProps;
	private readonly element = createElement('div');
	private readonly renderDisposables = new DisposableStore();
	private readonly modelPicker: ChatInputModelPickerActionViewItem;

	constructor(props: ChatInputPartProps) {
		this.props = props;
		this.modelPicker = new ChatInputModelPickerActionViewItem(getModelPickerProps(props));
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: ChatInputPartProps) {
		this.props = props;
		this.modelPicker.setProps(getModelPickerProps(props));
		this.render();
	}

	focus() {
		this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	dispose() {
		this.renderDisposables.dispose();
		this.element.replaceChildren();
	}

	private render() {
		this.renderDisposables.clear();
		this.element.className = [
			'agentbar-composer',
			this.props.isEmpty ? 'is-empty-state' : '',
		]
			.filter(Boolean)
			.join(' ');

		const textarea = createElement('textarea', 'agentbar-input');
		textarea.rows = 2;
		textarea.value = this.props.question;
		textarea.placeholder = localize(
			'assistantSidebarQuestionPlaceholder',
			"Ask about the fetched literature, compare findings, or draft a short evidence-backed answer.",
		);
		textarea.disabled = this.props.isAsking;
		textarea.setAttribute(
			'aria-label',
			localize('assistantSidebarQuestion', "Question"),
		);
		this.renderDisposables.add(addDisposableListener(textarea, EventType.INPUT, () => {
			this.props.onQuestionChange(textarea.value);
		}));
		this.renderDisposables.add(addDisposableListener(textarea, EventType.KEY_DOWN, event => {
			if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
				return;
			}
			event.preventDefault();
			if (this.canSend()) {
				this.props.onAsk();
			}
		}));

		const toolbar = createElement('div', 'agentbar-composer-toolbar');
		this.renderDisposables.add(this.modelPicker.render(toolbar));
		const sendLabel = this.props.isAsking
			? localize('assistantSidebarSendBusy', "Asking...")
			: localize('assistantSidebarSend', "Send");
		const actionsView = createActionBarView({
			className: 'agentbar-composer-actions',
			ariaRole: 'group',
			items: [
				this.createComposerActionItem(
					localize('assistantSidebarImage', "Image"),
					'image-filled',
					'agentbar-composer-tool-action',
				),
				{
					label: sendLabel,
					title: sendLabel,
					content: createLxIcon(
						this.props.isAsking
							? lxIconSemanticMap.assistant.busy
							: 'voice-circle-filled',
					),
					buttonClassName: 'agentbar-composer-send-action',
					onClick: () => this.props.onAsk(),
				},
			],
		});
		this.renderDisposables.add(actionsView);
		toolbar.append(actionsView.getElement());
		this.element.replaceChildren(textarea, toolbar);
	}

	private canSend() {
		return !this.props.isAsking && this.props.question.trim().length > 0;
	}

	private createComposerActionItem(
		label: string,
		icon: LxIconName,
		buttonClassName = 'agentbar-composer-tool-action',
	): ActionBarActionItem {
		return {
			label,
			title: label,
			content: createLxIcon(icon),
			buttonClassName,
		};
	}
}
