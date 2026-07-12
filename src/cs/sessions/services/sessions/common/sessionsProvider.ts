/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type {
	IChat,
	ISession,
	ISessionResolvedWorkspaceState,
	ISessionType,
	SessionTypeId,
	SessionsProviderId,
} from 'cs/sessions/services/sessions/common/session';
import type { IChatRequest } from 'cs/workbench/contrib/chat/common/chatRequest';
import type { ILanguageModelChatMetadataAndIdentifier } from 'cs/workbench/contrib/chat/common/languageModels';

/** Identifies one authoritative provider collection transition. */
export const enum SessionTransitionKind {
	Added = 'added',
	Removed = 'removed',
	Changed = 'changed',
	Replaced = 'replaced',
}

export type ISessionTransition =
	| { readonly kind: SessionTransitionKind.Added; readonly session: ISession }
	| { readonly kind: SessionTransitionKind.Removed; readonly session: ISession }
	| { readonly kind: SessionTransitionKind.Changed; readonly session: ISession }
	| {
		readonly kind: SessionTransitionKind.Replaced;
		readonly from: ISession;
		readonly to: ISession;
	};

/**
 * Describes ordered provider collection transitions after the provider has
 * committed the corresponding state to `getSessions()`.
 */
export interface ISessionsChangeEvent {
	readonly transitions: readonly ISessionTransition[];
}

/** Describes the explicit context for creating one Session draft. */
export interface ISessionDraftOptions {
	readonly sessionType: SessionTypeId;
	readonly workspace: ISessionResolvedWorkspaceState;
}

/** Hard request-boundary limits enforced before provider dispatch. */
export const maximumSessionChatRequestAttachments = 64;
export const maximumSessionChatRequestPayloadBytes = 16 * 1024 * 1024;

/** Connects one backend to the provider-independent Sessions domain. */
export interface ISessionsProvider extends IDisposable {
	readonly id: SessionsProviderId;
	readonly label: string;
	readonly sessionTypes: readonly ISessionType[];
	readonly onDidChangeSessionTypes: Event<void>;
	readonly onDidChangeSessions: Event<ISessionsChangeEvent>;
	readonly onDidChangeModels: Event<void>;
	getSessions(): readonly ISession[];
	getModels(session: ISession, chat: IChat): readonly ILanguageModelChatMetadataAndIdentifier[];
	createSessionDraft(options: ISessionDraftOptions): ISession;
	discardSessionDraft(session: ISession): void;
	sendRequest(session: ISession, chat: IChat, request: IChatRequest): Promise<void>;
	createChat(session: ISession): Promise<IChat>;
	forkChat(session: ISession, sourceChat: IChat, turnId: string): Promise<IChat>;
	renameSession(session: ISession, title: string): Promise<void>;
	renameChat(session: ISession, chat: IChat, title: string): Promise<void>;
	setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void>;
	setSessionArchived(session: ISession, archived: boolean): Promise<void>;
	deleteSession(session: ISession): Promise<void>;
	deleteChat(session: ISession, chat: IChat): Promise<void>;
}
