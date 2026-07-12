/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { autorun } from 'cs/base/common/observable';
import { isEqual } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { ChatModelDropdownOption, IChatWidgetPresentation } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/widget/chatWidget';
import {
	IChatService,
	type IChatModel,
	type IChatModelReference,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	ChatRequestAttachmentKind,
	type IChatRequest,
	type IChatRequestAttachment,
} from 'cs/workbench/contrib/chat/common/chatRequest';
import { parseLlmModelOptionValue } from 'cs/workbench/services/llm/registry';
import { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import type {
	IAddressedChatView,
	INewSessionChatView,
} from 'cs/sessions/services/chatView/browser/chatViewFactory';
import { ChatInteractivity, SessionStatus, type IChat, type ISession } from 'cs/sessions/services/sessions/common/session';
import { ISessionsManagementService } from 'cs/sessions/services/sessions/common/sessionsManagement';

abstract class AbstractSessionsChatView extends Disposable {
	protected readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view');
	private readonly widget: ChatWidget;
	private readonly modelReference = this._register(new MutableDisposable<IChatModelReference>());
	private readonly bindingDisposables = this._register(new DisposableStore());
	private session: ISession | undefined;
	private chat: IChat | undefined;
	private model: IChatModel | undefined;
	private width = 0;
	private height = 0;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IChatService private readonly chatService: IChatService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IDraftEditorService private readonly draftEditorService: IDraftEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		this.widget = this._register(instantiationService.createInstance(ChatWidget));
		this.element.append(this.widget.getElement());
		this._register(this.widget.onDidSubmitRequest(event => {
			if (this.isCurrentResource(event.chatResource)) {
				void this.sendRequest();
			}
		}));
		this._register(this.widget.onDidSelectModel(event => {
			if (this.isCurrentResource(event.chatResource)) {
				void this.setModel(event.modelId);
			}
		}));
		this._register(toDisposable(this.localeService.subscribe(() => this.updatePresentation())));
	}

	getElement(): HTMLElement {
		return this.element;
	}

	layout(width: number, height: number): void {
		this.width = width;
		this.height = height;
		this.element.style.width = `${Math.max(0, width)}px`;
		this.element.style.height = `${Math.max(0, height)}px`;
	}

	focus(): void {
		this.widget.focusInput();
	}

	protected clearChat(): void {
		this.bindingDisposables.clear();
		this.modelReference.clear();
		this.session = undefined;
		this.chat = undefined;
		this.model = undefined;
		this.widget.clearModel();
	}

	protected setBoundChat(session: ISession, chat: IChat): void {
		if (!session.chats.get().includes(chat)) {
			throw new Error(`Chat '${chat.resource.toString()}' is not owned by Session '${session.sessionId}'.`);
		}
		if (chat.interactivity.get() === ChatInteractivity.Hidden) {
			throw new Error(`Hidden Chat '${chat.resource.toString()}' cannot be rendered.`);
		}
		const managedSession = this.resolveManagedSession(session);
		if (this.model
			&& isEqual(this.model.resource, chat.resource)
			&& this.session === managedSession
			&& this.chat === chat) {
			this.updatePresentation();
			return;
		}

		this.bindingDisposables.clear();
		this.modelReference.clear();
		const reference = this.chatService.acquireModel(chat.resource);
		this.modelReference.value = reference;
		this.session = managedSession;
		this.chat = chat;
		this.model = reference.object;
		try {
			this.widget.setModel(reference.object, this.createPresentation());
			this.bindingDisposables.add(autorun(reader => {
				chat.modelId.read(reader);
				chat.interactivity.read(reader);
				managedSession.capabilities.read(reader);
				this.updatePresentation();
			}));
			this.bindingDisposables.add(this.sessionsManagementService.onDidChangeModels(event => {
				if (event.providerId === managedSession.providerId) {
					this.updatePresentation();
				}
			}));
		} catch (error) {
			this.bindingDisposables.clear();
			this.modelReference.clear();
			this.session = undefined;
			this.chat = undefined;
			this.model = undefined;
			this.widget.clearModel();
			throw error;
		}
		this.layout(this.width, this.height);
	}

	override dispose(): void {
		this.clearChat();
		this.element.replaceChildren();
		super.dispose();
	}

	private resolveManagedSession(session: ISession): ISession {
		const committed = this.sessionsManagementService.getSession(session.sessionId);
		if (committed) {
			return committed;
		}
		const draft = this.sessionsManagementService.draftSession.get();
		if (draft?.sessionId === session.sessionId) {
			return draft;
		}
		throw new Error(`Session '${session.sessionId}' is not managed.`);
	}

	private updatePresentation(): void {
		if (this.model && this.chat) {
			this.widget.setPresentation(this.createPresentation());
		}
	}

	private createPresentation(): IChatWidgetPresentation {
		const session = this.requireSession();
		const chat = this.requireChat();
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		const modelOptions = session.capabilities.get().supportsModels
			? this.createModelOptions(this.sessionsManagementService.getModels(session, chat))
			: [];
		const selectedModelId = chat.modelId.get();
		const selectedModel = selectedModelId
			? modelOptions.find(option => option.value === selectedModelId)
			: undefined;
		return {
			chatResource: chat.resource,
			readOnly: chat.interactivity.get() !== ChatInteractivity.Full,
			modelOptions,
			selectedModelId,
			activeModelLabel: selectedModelId
				? selectedModel
					? selectedModel.label
					: ui.chatModelUnavailable
				: ui.chatModelAuto,
		};
	}

	private createModelOptions(
		models: ReturnType<ISessionsManagementService['getModels']>,
	): readonly ChatModelDropdownOption[] {
		return models.map(model => {
			const parsed = parseLlmModelOptionValue(model.identifier);
			return {
				value: model.identifier,
				label: model.metadata.name,
				title: model.metadata.detail,
				providerId: parsed?.providerId,
				modelId: parsed?.modelId,
				reasoningEffort: parsed?.reasoningEffort,
				serviceTier: parsed?.serviceTier,
			};
		});
	}

	private async setModel(modelId: string | undefined): Promise<void> {
		try {
			await this.sessionsManagementService.setChatModel(
				this.requireSession(),
				this.requireChat(),
				modelId,
			);
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private async sendRequest(): Promise<void> {
		const session = this.requireSession();
		const chat = this.requireChat();
		const model = this.requireModel();
		const snapshot = model.getSnapshot();
		const request: IChatRequest = {
			prompt: snapshot.input,
			attachments: this.createAttachments(snapshot.checkedArticleIds),
		};
		try {
			await this.sessionsManagementService.sendRequest(session, chat, request);
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private createAttachments(articleIds: readonly string[]): readonly IChatRequestAttachment[] {
		const attachments: IChatRequestAttachment[] = articleIds.map(articleId => ({
			kind: ChatRequestAttachmentKind.Article,
			id: `article:${articleId}`,
			name: articleId,
			articleId,
		}));
		const editorAttachment = this.draftEditorService.getActiveRequestAttachment();
		if (editorAttachment) {
			attachments.push(editorAttachment);
		}
		return attachments;
	}

	private isCurrentResource(resource: URI): boolean {
		return !!this.chat && isEqual(this.chat.resource, resource);
	}

	private requireSession(): ISession {
		if (!this.session) {
			throw new Error('A Sessions Chat view requires a bound Session.');
		}
		return this.session;
	}

	private requireChat(): IChat {
		if (!this.chat) {
			throw new Error('A Sessions Chat view requires a bound Chat.');
		}
		return this.chat;
	}

	private requireModel(): IChatModel {
		if (!this.model) {
			throw new Error('A Sessions Chat view requires a loaded Chat model.');
		}
		return this.model;
	}
}

/** Renders the main Chat of a provider-owned new-Session draft. */
export class NewSessionChatView extends AbstractSessionsChatView implements INewSessionChatView {
	setSession(session: ISession | undefined): void {
		if (!session) {
			this.clearChat();
			return;
		}
		if (session.status.get() !== SessionStatus.Draft) {
			throw new Error(`Session '${session.sessionId}' is not a draft.`);
		}
		this.setBoundChat(session, session.mainChat.get());
	}
}

/** Renders one explicitly addressed Chat in a committed Session. */
export class AddressedChatView extends AbstractSessionsChatView implements IAddressedChatView {
	setChat(session: ISession, chat: IChat): void {
		if (session.status.get() === SessionStatus.Draft) {
			throw new Error(`Session '${session.sessionId}' is still a draft.`);
		}
		this.setBoundChat(session, chat);
	}
}
