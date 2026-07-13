/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { isEqual } from 'cs/base/common/resources';
import type { LocaleMessages } from 'language/locales';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type {
	IChatWidgetModelSelectionEvent,
	IChatWidgetPresentation,
	IChatWidgetSubmitEvent,
} from 'cs/workbench/contrib/chat/browser/chat';
import { ChatListWidget } from 'cs/workbench/contrib/chat/browser/widget/chatListWidget';
import { ChatInputPart } from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPart';
import type { IChatModel } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IChatModelSnapshot } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

import 'cs/workbench/contrib/chat/browser/widget/media/chat.css';

/** Reusable UI bound to exactly one addressed Chat model at a time. */
export class ChatWidget extends Disposable {
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view-content.comet-chat-content');
	private readonly modelSubscription = this._register(new MutableDisposable());
	private readonly listWidget: ChatListWidget;
	private readonly inputPart = this._register(new MutableDisposable<ChatInputPart>());
	private model: IChatModel | undefined;
	private presentation: IChatWidgetPresentation | undefined;
	private renderedSnapshot: IChatModelSnapshot | undefined;
	private ui: LocaleMessages;

	private readonly submitRequestEmitter = this._register(new Emitter<IChatWidgetSubmitEvent>());
	readonly onDidSubmitRequest: Event<IChatWidgetSubmitEvent> = this.submitRequestEmitter.event;

	private readonly modelSelectionEmitter = this._register(new Emitter<IChatWidgetModelSelectionEvent>());
	readonly onDidSelectModel: Event<IChatWidgetModelSelectionEvent> = this.modelSelectionEmitter.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatService private readonly chatService: IChatService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		this.ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		this.element.tabIndex = -1;
		this.listWidget = this._register(instantiationService.createInstance(ChatListWidget, this.ui));
		this._register(toDisposable(this.localeService.subscribe(() => this.handleLocaleChanged())));
		this.render();
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setModel(model: IChatModel, presentation: IChatWidgetPresentation): void {
		if (!isEqual(model.resource, presentation.chatResource)) {
			throw new Error('A Chat widget presentation must address its bound Chat model.');
		}
		this.model = model;
		this.presentation = presentation;
		this.modelSubscription.value = model.onDidChange(() => this.handleModelChange());
		this.listWidget.setModel(model);
		this.render();
	}

	setPresentation(presentation: IChatWidgetPresentation): void {
		if (!this.model || !isEqual(this.model.resource, presentation.chatResource)) {
			throw new Error('A Chat widget cannot apply presentation for another Chat resource.');
		}
		this.presentation = presentation;
		this.render();
	}

	clearModel(): void {
		this.modelSubscription.clear();
		this.model = undefined;
		this.presentation = undefined;
		this.renderedSnapshot = undefined;
		this.listWidget.setModel(undefined);
		this.inputPart.clear();
		this.render();
	}

	focusInput(): void {
		if (this.presentation?.readOnly) {
			this.element.focus();
			return;
		}
		this.inputPart.value?.focus();
	}

	override dispose(): void {
		super.dispose();
		this.element.replaceChildren();
	}

	private render(): void {
		const model = this.model;
		const presentation = this.presentation;
		if (!model || !presentation) {
			this.element.replaceChildren();
			return;
		}
		const snapshot = model.getSnapshot();
		this.renderedSnapshot = snapshot;
		const shell = $<HTMLElementTagNameMap['div']>('div', { class: [
				'comet-session-chat-view-body',
				'comet-chat-shell',
				snapshot.messages.length === 0 ? 'comet-is-empty-state' : '',
			]
				.filter(Boolean)
				.join(' ') });
		if (snapshot.errorMessage) {
			const error = $<HTMLElementTagNameMap['div']>('div.comet-chat-error');
			error.textContent = snapshot.errorMessage;
			shell.append(error);
		}
		shell.append(this.listWidget.getElement());
		if (!presentation.readOnly) {
			const inputPartProps = this.createInputPartProps();
			let inputPart = this.inputPart.value;
			if (inputPart) {
				inputPart.setProps(inputPartProps);
			} else {
				inputPart = this.instantiationService.createInstance(ChatInputPart, inputPartProps);
				this.inputPart.value = inputPart;
			}
			shell.append(inputPart.getElement());
		} else {
			this.inputPart.clear();
		}
		this.element.replaceChildren(shell);
	}

	private handleModelChange(): void {
		const model = this.model;
		const previousSnapshot = this.renderedSnapshot;
		if (!model || !previousSnapshot) {
			this.render();
			return;
		}

		const snapshot = model.getSnapshot();
		if (
			previousSnapshot.messages === snapshot.messages
			&& previousSnapshot.activeRequest === snapshot.activeRequest
			&& previousSnapshot.checkedArticleIds === snapshot.checkedArticleIds
			&& snapshot.errorMessage === undefined
		) {
			this.renderedSnapshot = snapshot;
			this.inputPart.value?.setQuestion(snapshot.input);
			if (previousSnapshot.errorMessage !== undefined) {
				this.element.querySelector('.comet-chat-error')?.remove();
			}
			return;
		}

		this.render();
	}

	private handleLocaleChanged(): void {
		this.ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		this.listWidget.setLocaleMessages(this.ui);
		this.render();
	}

	private createInputPartProps() {
		const model = this.model;
		const presentation = this.presentation;
		if (!model || !presentation) {
			throw new Error('A Chat widget input requires an addressed model and presentation.');
		}
		const snapshot = model.getSnapshot();
		return {
			ui: this.ui,
			chatModel: model,
			activeModelLabel: presentation.activeModelLabel,
			question: snapshot.input,
			onQuestionChange: (value: string) => {
				this.chatService.setInput(model.resource, value);
			},
			isAsking: snapshot.activeRequest !== undefined,
			onAsk: () => {
				this.submitRequestEmitter.fire({ chatResource: model.resource });
			},
			modelOptions: presentation.modelOptions,
			selectedModelId: presentation.selectedModelId,
			onSelectModel: (modelId: string | undefined) => {
				this.modelSelectionEmitter.fire({ chatResource: model.resource, modelId });
			},
			isEmpty: snapshot.messages.length === 0,
		};
	}
}
