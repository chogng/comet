/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarMenuItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import type { LocaleMessages } from 'language/locales';
import {
	IContextMenuService,
	IContextViewService,
} from 'cs/platform/contextview/browser/contextView';
import { INotificationService } from 'cs/platform/notification/common/notification';
import type { ChatModelDropdownOption } from 'cs/workbench/contrib/chat/browser/chat';
import {
	IChatComposerContributionService,
} from 'cs/workbench/contrib/chat/browser/composer/chatComposerContributions';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import {
	ChatInputModelPickerActionViewItem,
	type IChatInputModelPickerProps,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPickerActionItem';
import {
	IChatService,
	type IChatModel,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';

export interface ChatInputPartProps {
	readonly ui: LocaleMessages;
	readonly chatModel: IChatModel | undefined;
	readonly activeModelLabel: string;
	readonly question: string;
	readonly onQuestionChange: (value: string) => void;
	readonly isBusy: boolean;
	readonly onAsk: () => void;
	readonly modelOptions: readonly ChatModelDropdownOption[];
	readonly selectedModelId: string | undefined;
	readonly onSelectModel: (modelId: string | undefined) => void;
	readonly isEmpty: boolean;
}

function getModelPickerProps(props: ChatInputPartProps): IChatInputModelPickerProps {
	return {
		activeModelLabel: props.activeModelLabel,
		modelOptions: props.modelOptions,
		selectedModelId: props.selectedModelId,
		onSelectModel: props.onSelectModel,
		ui: props.ui,
	};
}

function createChatInputAddActionItem(
	contextMenuService: IContextMenuService,
	contextViewProvider: IContextViewService,
	ui: LocaleMessages,
	sources: IChatComposerSourceService,
	chatResource: IChatModel['resource'],
	onError: (error: unknown) => void,
) {
	const addLabel = ui.chatInputAdd;
	const menu: ActionBarMenuItem[] = sources.getSources().map(source => ({
		id: `chat-input-add-${source.id}`,
		label: source.getLabel(ui),
		icon: source.icon,
		onClick: () => {
			void source.addToComposer(chatResource).catch(onError);
		},
	}));

	return createDropdownMenuActionViewItem({
		contextMenuService,
		contextViewProvider,
		label: addLabel,
		title: addLabel,
		content: createLxIcon('add'),
		className: 'comet-chat-add-menu',
		buttonClassName: 'comet-chat-add-menu-btn',
		menu,
		menuClassName: 'comet-chat-add-menu',
		menuData: 'chat-add-menu',
		minWidth: 180,
		overlayAlignmentPolicy: 'prefer-start',
	});
}

/** Generic addressed Chat composer without Feature-owned source state. */
export class ChatInputPart extends Disposable {
	private props: ChatInputPartProps;
	private readonly element = $<HTMLElementTagNameMap['div']>('div');
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly modelPicker: ChatInputModelPickerActionViewItem;
	private disposed = false;

	constructor(
		props: ChatInputPartProps,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IChatService private readonly chatService: IChatService,
		@INotificationService private readonly notificationService: INotificationService,
		@IChatComposerSourceService private readonly composerSourceService: IChatComposerSourceService,
		@IChatComposerContributionService private readonly composerContributionService: IChatComposerContributionService,
	) {
		super();
		this.props = props;
		this.modelPicker = new ChatInputModelPickerActionViewItem(
			getModelPickerProps(props),
			this.contextMenuService,
			this.contextViewService,
		);
		this.render();
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setProps(props: ChatInputPartProps): void {
		if (this.disposed) {
			return;
		}
		this.props = props;
		this.modelPicker.setProps(getModelPickerProps(props));
		this.render();
	}

	setQuestion(question: string): void {
		if (this.disposed || this.props.question === question) {
			return;
		}
		this.props = { ...this.props, question };
		const textarea = this.element.querySelector<HTMLTextAreaElement>('textarea');
		if (!textarea) {
			throw new Error('A Chat input cannot update its question before rendering.');
		}
		if (textarea.value !== question) {
			textarea.value = question;
		}
		const sendButton = this.element.querySelector<HTMLButtonElement>(
			'.comet-chat-composer-send-action',
		);
		if (!sendButton) {
			throw new Error('A Chat input cannot update its send action before rendering.');
		}
		sendButton.disabled = !this.canSend();
	}

	focus(): void {
		this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		super.dispose();
		this.element.replaceChildren();
	}

	private render(): void {
		if (this.disposed) {
			return;
		}
		this.renderDisposables.clear();
		const model = this.props.chatModel;
		if (!model) {
			this.element.replaceChildren();
			return;
		}

		const ui = this.props.ui;
		this.element.className = [
			'comet-chat-composer-host',
			this.props.isEmpty ? 'comet-is-empty-state' : '',
		].filter(Boolean).join(' ');
		const composer = $<HTMLElementTagNameMap['div']>('div', { class: [
			'comet-chat-composer',
			this.props.isEmpty ? 'comet-is-empty-state' : '',
		].filter(Boolean).join(' ') });

		const textarea = $<HTMLElementTagNameMap['textarea']>('textarea.comet-chat-composer-input');
		textarea.rows = 2;
		textarea.value = this.props.question;
		textarea.placeholder = ui.assistantSidebarQuestionPlaceholder;
		textarea.disabled = this.props.isBusy;
		textarea.setAttribute('aria-label', ui.assistantSidebarQuestion);
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

		const toolbar = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-toolbar');
		const composerTools = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-tools');
		const addMenuActions = createActionBarView({
			className: 'comet-chat-composer-add-menu-actions',
			ariaRole: 'group',
			items: [createChatInputAddActionItem(
				this.contextMenuService,
				this.contextViewService,
				ui,
				this.composerSourceService,
				model.resource,
				error => this.notificationService.error(error instanceof Error ? error : String(error)),
			)],
		});
		this.renderDisposables.add(addMenuActions);
		composerTools.append(addMenuActions.getElement());
		const modelPickerContainer = $<HTMLElementTagNameMap['div']>('div');
		this.renderDisposables.add(this.modelPicker.render(modelPickerContainer));
		composerTools.append(modelPickerContainer);
		toolbar.append(composerTools);

		const sendLabel = this.props.isBusy
			? ui.assistantSidebarSendBusy
			: ui.assistantSidebarSend;
		const actionsView = createActionBarView({
			className: 'comet-chat-composer-actions',
			ariaRole: 'group',
			items: [{
				label: sendLabel,
				title: sendLabel,
				disabled: !this.canSend(),
				content: createLxIcon(this.props.isBusy ? lxIconSemanticMap.assistant.busy : 'mic'),
				buttonClassName: 'comet-chat-composer-send-action',
				onClick: () => {
					if (this.canSend()) {
						this.props.onAsk();
					}
				},
			}],
		});
		this.renderDisposables.add(actionsView);
		toolbar.append(actionsView.getElement());

		const context = this.renderComposerContext(model);
		composer.replaceChildren(...(context ? [context] : []), textarea, toolbar);
		const contributionViews = this.composerContributionService.getContributions().map(contribution =>
			this.renderDisposables.add(contribution.createView({
				chatResource: model.resource,
				ui,
				isBusy: this.props.isBusy,
			})),
		);
		this.element.replaceChildren(composer, ...contributionViews.map(view => view.element));
	}

	private canSend(): boolean {
		return !this.props.isBusy && this.props.question.trim().length > 0;
	}

	private renderComposerContext(model: IChatModel): HTMLElement | undefined {
		const snapshot = model.getSnapshot();
		if (snapshot.pendingAttachments.length === 0 && snapshot.interactionTargets.length === 0) {
			return undefined;
		}

		const container = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-context');
		for (const attachment of snapshot.pendingAttachments) {
			container.append(this.createComposerContextChip(
				attachment.display.label,
				attachment.display.description,
				() => this.chatService.removePendingAttachment(model.resource, attachment.id),
			));
		}
		for (const target of snapshot.interactionTargets) {
			container.append(this.createComposerContextChip(
				target.display.label,
				target.display.description,
				() => this.chatService.removeInteractionTarget(model.resource, target.id),
			));
		}
		return container;
	}

	private createComposerContextChip(
		label: string,
		description: string | undefined,
		remove: () => void,
	): HTMLElement {
		const chip = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-context-chip');
		chip.title = description ?? label;
		const text = $<HTMLElementTagNameMap['span']>('span.comet-chat-composer-context-label');
		text.textContent = label;
		const removeButton = $<HTMLElementTagNameMap['button']>('button.comet-chat-composer-context-remove');
		removeButton.type = 'button';
		removeButton.disabled = this.props.isBusy;
		removeButton.setAttribute('aria-label', label);
		removeButton.append(createLxIcon('close'));
		this.renderDisposables.add(addDisposableListener(removeButton, EventType.CLICK, remove));
		chip.append(text, removeButton);
		return chip;
	}
}
