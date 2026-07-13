/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { toErrorMessage } from 'cs/base/common/errorMessage';
import { Disposable } from 'cs/base/common/lifecycle';
import { autorun } from 'cs/base/common/observable';
import { localize, localize2 } from 'cs/nls';
import { MenuRegistry } from 'cs/platform/actions/common/actions';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import { SessionsMenuIds } from 'cs/sessions/common/menus';
import { SessionsCommandIds } from 'cs/sessions/common/sessionCommands';
import { ISessionsService } from 'cs/sessions/services/sessions/browser/sessionsService';
import { ChatInteractivity, type IChat, type ISession } from 'cs/sessions/services/sessions/common/session';
import type { IActiveSession } from 'cs/sessions/services/sessions/common/sessionsView';
import {
	isCreateChatAvailable,
	isForkChatAvailable,
	type ISessionChatActionContext,
	type ISessionChatTurnActionContext,
} from 'cs/sessions/services/sessions/common/sessionActions';
import {
	ISessionsManagementService,
	type ISessionsManagementService as ISessionsManagementServiceContract,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IContextKeyService } from 'cs/platform/contextkey/common/contextkey';

function requireActionSession(
	context: IActiveSession | undefined,
	managementService: ISessionsManagementServiceContract,
): ISession {
	if (!context) {
		throw new Error('A Session action requires its originating Session context.');
	}
	const session = managementService.getSession(context.sessionId);
	if (!session) {
		throw new Error(`Session '${context.sessionId}' is not managed.`);
	}
	return session;
}

/** Owns Session header command and menu registrations for the Sessions product. */
export class SessionsActionsContribution extends Disposable {
	constructor(
		@ISessionsManagementService private readonly managementService: ISessionsManagementServiceContract,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@IDialogService private readonly dialogService: IDialogService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		const activeChatFullyInteractive = SessionsContextKeys.activeChatFullyInteractive.bindTo(contextKeyService);
		this._register(autorun(reader => {
			const activeSession = this.sessionsService.activeSession.read(reader);
			const activeChat = activeSession?.activeChat.read(reader);
			activeChatFullyInteractive.set(
				activeChat?.interactivity.read(reader) === ChatInteractivity.Full,
			);
		}));
		this.registerCreateChatAction();
		this.registerForkChatAction();
		this.registerDeleteChatAction();
		this.registerRenameAction();
		this.registerDeleteAction();
		this.registerCloseAction();
	}

	private registerCreateChatAction(): void {
		const command = {
			id: SessionsCommandIds.createChat,
			title: localize2('createChat', "New Chat"),
			icon: Codicon.add,
		};
		this._register(commandsRegistry.registerCommand(command.id, (_accessor, context?: IActiveSession) =>
			this.createChat(context),
		));
		this._register(MenuRegistry.appendMenuItem(SessionsMenuIds.sessionHeader, {
			command,
			group: 'navigation',
			order: 1,
			when: SessionsContextKeys.sessionHeaderCanCreateChat.isEqualTo(true),
		}));
	}

	private registerForkChatAction(): void {
		const command = {
			id: SessionsCommandIds.forkChat,
			title: localize2('forkChat', "Fork Chat"),
			icon: Codicon.repoForked,
		};
		this._register(commandsRegistry.registerCommand(command.id, (
			_accessor,
			context?: ISessionChatTurnActionContext,
		) => this.forkChat(context)));
		this._register(MenuRegistry.appendMenuItem(SessionsMenuIds.chatTurn, {
			command,
			group: 'navigation',
			order: 1,
			when: SessionsContextKeys.chatTurnCanFork.isEqualTo(true),
		}));
	}

	private registerDeleteChatAction(): void {
		const command = {
			id: SessionsCommandIds.deleteChat,
			title: localize2('deleteChat', "Delete Chat"),
			icon: Codicon.trash,
		};
		this._register(commandsRegistry.registerCommand(command.id, (
			_accessor,
			context?: ISessionChatActionContext,
		) => this.deleteChat(context)));
		this._register(MenuRegistry.appendMenuItem(SessionsMenuIds.chatHeader, {
			command,
			group: 'navigation',
			order: 1,
			when: SessionsContextKeys.chatHeaderSupportsDelete.isEqualTo(true),
		}));
	}

	private registerRenameAction(): void {
		const command = {
			id: SessionsCommandIds.renameSession,
			title: localize2('renameSession', "Rename Session"),
			icon: Codicon.edit,
		};
		this._register(commandsRegistry.registerCommand(command.id, (_accessor, context?: IActiveSession) =>
			this.renameSession(context),
		));
		this._register(MenuRegistry.appendMenuItem(SessionsMenuIds.sessionHeader, {
			command,
			group: 'navigation',
			order: 2,
			when: SessionsContextKeys.sessionHeaderSupportsRename.isEqualTo(true),
		}));
	}

	private registerDeleteAction(): void {
		const command = {
			id: SessionsCommandIds.deleteSession,
			title: localize2('deleteSession', "Delete Session"),
			icon: Codicon.trash,
		};
		this._register(commandsRegistry.registerCommand(command.id, (_accessor, context?: IActiveSession) =>
			this.deleteSession(context),
		));
		this._register(MenuRegistry.appendMenuItem(SessionsMenuIds.sessionHeader, {
			command,
			group: 'navigation',
			order: 3,
			when: SessionsContextKeys.sessionHeaderSupportsDelete.isEqualTo(true),
		}));
	}

	private registerCloseAction(): void {
		const command = {
			id: SessionsCommandIds.closeSession,
			title: localize2('closeSession', "Close Session"),
			icon: Codicon.close,
		};
		this._register(commandsRegistry.registerCommand(command.id, (_accessor, context?: IActiveSession) => {
			if (!context) {
				throw new Error('Close Session requires its originating Session context.');
			}
			this.sessionsService.closeSession(context);
		}));
		this._register(MenuRegistry.appendMenuItem(SessionsMenuIds.sessionHeader, {
			command,
			group: 'navigation',
			order: 4,
			when: SessionsContextKeys.sessionHeaderHasSession.isEqualTo(true),
		}));
	}

	private async createChat(context: IActiveSession | undefined): Promise<void> {
		const session = requireActionSession(context, this.managementService);
		const capabilities = session.capabilities.get();
		if (!isCreateChatAvailable(capabilities, session.chats.get().length)) {
			throw new Error(`Session '${session.sessionId}' does not currently support creating another Chat.`);
		}

		let chat: IChat;
		try {
			chat = await this.managementService.createChat(session);
		} catch (error) {
			await this.dialogService.error(localize(
				'createChatFailed',
				"Failed to create the chat: {0}",
				toErrorMessage(error),
			));
			return;
		}
		this.sessionsService.openChat(session, chat.resource);
	}

	private async forkChat(context: ISessionChatTurnActionContext | undefined): Promise<void> {
		const { session, chat } = this.requireActionChat(context);
		const turnId = context?.turnId.trim();
		if (!turnId) {
			throw new Error('Fork Chat requires its originating Turn context.');
		}
		const capabilities = session.capabilities.get();
		if (!isForkChatAvailable(capabilities, session.chats.get().length)) {
			throw new Error(`Session '${session.sessionId}' does not currently support forking another Chat.`);
		}

		let fork: IChat;
		try {
			fork = await this.managementService.forkChat(session, chat, turnId);
		} catch (error) {
			await this.dialogService.error(localize(
				'forkChatFailed',
				"Failed to fork the chat: {0}",
				toErrorMessage(error),
			));
			return;
		}
		this.sessionsService.openChat(session, fork.resource);
	}

	private async deleteChat(context: ISessionChatActionContext | undefined): Promise<void> {
		const { session, chat } = this.requireActionChat(context);
		if (!chat.capabilities.get().supportsDelete) {
			throw new Error(`Chat '${chat.resource.toString()}' does not support delete.`);
		}

		const confirmation = await this.dialogService.confirm({
			title: localize('deleteChatDialogTitle', "Delete Chat"),
			message: localize('deleteChatConfirm', "Are you sure you want to delete this chat?"),
			detail: localize('deleteChatDetail', "This action cannot be undone."),
			primaryButton: localize('deleteChatButton', "Delete"),
		});
		if (!confirmation.confirmed) {
			return;
		}

		try {
			await this.managementService.deleteChat(session, chat);
		} catch (error) {
			await this.dialogService.error(localize(
				'deleteChatFailed',
				"Failed to delete the chat: {0}",
				toErrorMessage(error),
			));
		}
	}

	private requireActionChat(context: ISessionChatActionContext | undefined): {
		readonly session: ISession;
		readonly chat: ISessionChatActionContext['chat'];
	} {
		if (!context) {
			throw new Error('A Chat action requires its originating Session and Chat context.');
		}
		const session = this.managementService.getSession(context.session.sessionId);
		if (!session) {
			throw new Error(`Session '${context.session.sessionId}' is not managed.`);
		}
		if (!session.chats.get().includes(context.chat)) {
			throw new Error(`Chat '${context.chat.resource.toString()}' is not the current model owned by Session '${session.sessionId}'.`);
		}
		return { session, chat: context.chat };
	}

	private async renameSession(context: IActiveSession | undefined): Promise<void> {
		const session = requireActionSession(context, this.managementService);
		if (!session.capabilities.get().supportsRename) {
			throw new Error(`Session '${session.sessionId}' does not support rename.`);
		}

		const { value } = await this.dialogService.input({
			title: localize('renameSessionDialogTitle', "Rename Session"),
			message: localize('renameSessionPrompt', "Enter a new session title"),
			value: session.title.get(),
			primaryButton: localize('renameSessionConfirm', "Rename"),
		});
		if (value === undefined) {
			return;
		}
		const title = value.trim();
		if (!title) {
			await this.dialogService.error(localize('renameSessionEmpty', "Session title cannot be empty."));
			return;
		}

		try {
			await this.managementService.renameSession(session, title);
		} catch (error) {
			await this.dialogService.error(localize(
				'renameSessionFailed',
				"Failed to rename the session: {0}",
				toErrorMessage(error),
			));
		}
	}

	private async deleteSession(context: IActiveSession | undefined): Promise<void> {
		const session = requireActionSession(context, this.managementService);
		if (!session.capabilities.get().supportsDelete) {
			throw new Error(`Session '${session.sessionId}' does not support delete.`);
		}

		const confirmation = await this.dialogService.confirm({
			title: localize('deleteSessionDialogTitle', "Delete Session"),
			message: localize('deleteSessionConfirm', "Are you sure you want to delete this session?"),
			detail: localize('deleteSessionDetail', "This action cannot be undone."),
			primaryButton: localize('deleteSessionButton', "Delete"),
		});
		if (!confirmation.confirmed) {
			return;
		}

		try {
			await this.managementService.deleteSession(session);
		} catch (error) {
			await this.dialogService.error(localize(
				'deleteSessionFailed',
				"Failed to delete the session: {0}",
				toErrorMessage(error),
			));
		}
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(SessionsActionsContribution),
);
