/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { IObservable } from 'cs/base/common/observable';
import type { URI } from 'cs/base/common/uri';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
	IChat,
	ISession,
	ISessionType,
	SessionId,
	SessionsProviderId,
} from 'cs/sessions/services/sessions/common/session';
import type {
	ISessionDraftOptions,
	ISessionModel,
	ISessionTransition,
} from 'cs/sessions/services/sessions/common/sessionsProvider';

/** Identifies one provider-owned Session type available for draft creation. */
export interface IProviderSessionType {
	readonly providerId: SessionsProviderId;
	readonly sessionType: ISessionType;
}

/** Describes one validated change to the aggregate Session collection. */
export interface ISessionsManagementChangeEvent {
	readonly providerId: SessionsProviderId;
	readonly transitions: readonly ISessionTransition[];
}

/** Identifies why the separately managed Session draft changed. */
export const enum SessionDraftChangeKind {
	Created = 'created',
	Discarded = 'discarded',
	Replaced = 'replaced',
	ProviderRemoved = 'provider-removed',
}

/** Describes one draft lifecycle transition. */
export interface ISessionDraftChangeEvent {
	readonly kind: SessionDraftChangeKind;
	readonly from: ISession | undefined;
	readonly to: ISession | undefined;
}

/** Identifies the provider whose model family changed. */
export interface ISessionsModelsChangeEvent {
	readonly providerId: SessionsProviderId;
}

/** Identifies the Session and Chat that own one Chat resource. */
export interface ISessionChatOwner {
	readonly session: ISession;
	readonly chat: IChat;
}

export const ISessionsManagementService = createDecorator<ISessionsManagementService>('sessionsManagementService');

/** Owns the aggregate Sessions domain and routes operations to owning providers. */
export interface ISessionsManagementService {
	readonly _serviceBrand: undefined;
	readonly sessions: IObservable<readonly ISession[]>;
	readonly draftSession: IObservable<ISession | undefined>;
	readonly sessionTypes: IObservable<readonly IProviderSessionType[]>;
	readonly onDidChangeSessions: Event<ISessionsManagementChangeEvent>;
	readonly onDidChangeDraftSession: Event<ISessionDraftChangeEvent>;
	readonly onDidChangeSessionTypes: Event<void>;
	readonly onDidChangeModels: Event<ISessionsModelsChangeEvent>;
	getSessions(): readonly ISession[];
	getSession(sessionId: SessionId): ISession | undefined;
	getSessionByResource(providerId: SessionsProviderId, resource: URI): ISession | undefined;
	getSessionForChatResource(resource: URI): ISessionChatOwner | undefined;
	createSessionDraft(providerId: SessionsProviderId, options: ISessionDraftOptions): Promise<ISession>;
	discardSessionDraft(session: ISession): void;
	getModels(session: ISession, chat: IChat): readonly ISessionModel[];
	sendRequest(session: ISession, chat: IChat): Promise<void>;
	createChat(session: ISession): Promise<IChat>;
	forkChat(session: ISession, sourceChat: IChat, turnId: string): Promise<IChat>;
	renameSession(session: ISession, title: string): Promise<void>;
	renameChat(session: ISession, chat: IChat, title: string): Promise<void>;
	setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void>;
	setSessionArchived(session: ISession, archived: boolean): Promise<void>;
	releaseSession(session: ISession): Promise<void>;
	releaseChat(session: ISession, chat: IChat): Promise<void>;
	cancelTurn(session: ISession, chat: IChat, turnId: string): Promise<void>;
	steerTurn(session: ISession, chat: IChat, turnId: string, message: string): Promise<void>;
	deleteSession(session: ISession): Promise<void>;
	deleteChat(session: ISession, chat: IChat): Promise<void>;
}
