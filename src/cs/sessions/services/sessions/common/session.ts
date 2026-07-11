/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IObservable } from 'cs/base/common/observable';
import { getComparisonKey, isEqual } from 'cs/base/common/resources';
import type { ThemeIcon } from 'cs/base/common/themables';
import type { URI } from 'cs/base/common/uri';

export type SessionId = string;
export type SessionTypeId = string;
export type SessionsProviderId = string;

/** Describes one provider-owned kind of Session. */
export interface ISessionType {
	readonly id: SessionTypeId;
	readonly label: string;
	readonly icon: ThemeIcon;
	/** Whether new Sessions of this type may be created without a workspace. */
	readonly supportsWorkspaceLess: boolean;
}

/** Describes the lifecycle state of a Session or Chat. */
export const enum SessionStatus {
	Draft = 'draft',
	Running = 'running',
	NeedsInput = 'needs-input',
	Completed = 'completed',
	Failed = 'failed',
}

/** Describes whether the user can interact with a Chat. */
export const enum ChatInteractivity {
	Full = 'full',
	ReadOnly = 'read-only',
	Hidden = 'hidden',
}

/** Identifies how a Chat entered its owning Session. */
export const enum ChatOriginKind {
	User = 'user',
	Fork = 'fork',
	Tool = 'tool',
}

export type IChatOrigin =
	| { readonly kind: ChatOriginKind.User; readonly parentChat?: never }
	| { readonly kind: ChatOriginKind.Fork; readonly parentChat: URI }
	| { readonly kind: ChatOriginKind.Tool; readonly parentChat: URI };

/** Declares Chat-level operations guaranteed by its provider. */
export interface IChatCapabilities {
	readonly supportsRename: boolean;
	readonly supportsDelete: boolean;
}

/** Describes one repository associated with a Session workspace folder. */
export interface ISessionRepository {
	readonly root: URI;
	readonly branch: string | undefined;
	readonly baseBranch: string | undefined;
}

/** Describes one folder in a Session workspace. */
export interface ISessionWorkspaceFolder {
	readonly resource: URI;
	readonly workingDirectory: URI;
	readonly name: string;
	readonly repository: ISessionRepository | undefined;
}

/** Describes the workspace shared by all Chats in one Session. */
export interface ISessionWorkspace {
	readonly resource: URI;
	readonly label: string;
	readonly folders: readonly ISessionWorkspaceFolder[];
}

/** Identifies whether workspace association is resolving, resolved, or absent. */
export const enum SessionWorkspaceKind {
	Resolving = 'resolving',
	Workspace = 'workspace',
	WorkspaceLess = 'workspace-less',
}

export type ISessionResolvedWorkspaceState =
	| { readonly kind: SessionWorkspaceKind.Workspace; readonly workspace: ISessionWorkspace }
	| { readonly kind: SessionWorkspaceKind.WorkspaceLess };

export type ISessionWorkspaceState =
	| { readonly kind: SessionWorkspaceKind.Resolving }
	| ISessionResolvedWorkspaceState;

/** Describes one file changed by a Session. */
export interface ISessionChange {
	readonly resource: URI;
	readonly kind: SessionChangeKind;
}

/** Describes how a Session changed a file. */
export const enum SessionChangeKind {
	Created = 'created',
	Modified = 'modified',
	Deleted = 'deleted',
}

/** Declares Session-level operations guaranteed by its provider. */
export interface ISessionCapabilities {
	readonly supportsMultipleChats: boolean;
	readonly supportsFork: boolean;
	readonly supportsRename: boolean;
	readonly supportsArchive: boolean;
	readonly supportsDelete: boolean;
	readonly supportsChanges: boolean;
	readonly supportsModels: boolean;
}

/** Represents one addressed conversation stream inside a Session. */
export interface IChat {
	readonly resource: URI;
	readonly createdAt: Date;
	readonly title: IObservable<string>;
	readonly updatedAt: IObservable<Date>;
	readonly status: IObservable<SessionStatus>;
	readonly isRead: IObservable<boolean>;
	readonly modelId: IObservable<string | undefined>;
	readonly interactivity: IObservable<ChatInteractivity>;
	readonly capabilities: IObservable<IChatCapabilities>;
	readonly origin: IChatOrigin | undefined;
}

/** Represents one provider-owned Agent working context. */
export interface ISession {
	readonly sessionId: SessionId;
	readonly resource: URI;
	readonly providerId: SessionsProviderId;
	readonly sessionType: SessionTypeId;
	readonly createdAt: Date;
	readonly title: IObservable<string>;
	readonly updatedAt: IObservable<Date>;
	readonly status: IObservable<SessionStatus>;
	readonly isRead: IObservable<boolean>;
	readonly isArchived: IObservable<boolean>;
	readonly workspace: IObservable<ISessionWorkspaceState>;
	readonly changes: IObservable<readonly ISessionChange[]>;
	readonly mainChat: IObservable<IChat>;
	readonly chats: IObservable<readonly IChat[]>;
	readonly capabilities: IObservable<ISessionCapabilities>;
}

/** Builds the canonical provider-aware identity for a Session resource. */
export function toSessionId(providerId: SessionsProviderId, resource: URI): SessionId {
	assertSessionsProviderId(providerId);
	return `${encodeURIComponent(providerId)}:${resource.toString()}`;
}

/** Verifies that a provider ID is stable and safe to use as an identity component. */
export function assertSessionsProviderId(providerId: SessionsProviderId): void {
	if (!providerId || /\s/u.test(providerId)) {
		throw new Error('A Sessions provider ID must be non-empty and contain no whitespace.');
	}
}

/** Verifies the provider-independent invariants required of every Session model. */
export function assertSessionInvariants(session: ISession): void {
	if (!session.providerId) {
		throw new Error(`Session '${session.sessionId}' does not identify its provider.`);
	}
	if (!session.sessionType) {
		throw new Error(`Session '${session.sessionId}' does not identify its Session type.`);
	}
	const expectedSessionId = toSessionId(session.providerId, session.resource);
	if (session.sessionId !== expectedSessionId) {
		throw new Error(`Session '${session.sessionId}' does not use its canonical provider-aware identity.`);
	}

	const chats = session.chats.get();
	const mainChat = session.mainChat.get();
	if (!chats.includes(mainChat)) {
		throw new Error(`Session '${session.sessionId}' does not contain its main Chat model.`);
	}

	const chatsByResource = new Map<string, IChat>();
	for (const chat of chats) {
		if (chat !== mainChat && !chat.origin) {
			throw new Error(`Session '${session.sessionId}' has an additional Chat without an origin.`);
		}
		const resourceKey = getComparisonKey(chat.resource);
		if (chatsByResource.has(resourceKey)) {
			throw new Error(`Session '${session.sessionId}' contains duplicate Chat resources.`);
		}
		chatsByResource.set(resourceKey, chat);
	}
	for (const chat of chats) {
		assertChatOrigin(session, chat, chatsByResource);
	}
	assertChatOriginsAcyclic(session, chats, chatsByResource);

	if (mainChat.origin && mainChat.origin.kind !== ChatOriginKind.User) {
		throw new Error(`Session '${session.sessionId}' has a non-user main Chat origin.`);
	}
	if (mainChat.interactivity.get() === ChatInteractivity.Hidden) {
		throw new Error(`Session '${session.sessionId}' has a hidden main Chat.`);
	}
	if (mainChat.capabilities.get().supportsDelete) {
		throw new Error(`Session '${session.sessionId}' has a deletable main Chat.`);
	}
}

function assertChatOrigin(
	session: ISession,
	chat: IChat,
	chatsByResource: ReadonlyMap<string, IChat>,
): void {
	const origin = chat.origin;
	if (!origin) {
		return;
	}

	if (origin.kind === ChatOriginKind.User) {
		if (origin.parentChat) {
			throw new Error(`Session '${session.sessionId}' has a user Chat with a parent.`);
		}
		return;
	}

	if (origin.kind !== ChatOriginKind.Fork && origin.kind !== ChatOriginKind.Tool) {
		throw new Error(`Session '${session.sessionId}' has an unknown Chat origin.`);
	}
	if (!origin.parentChat) {
		throw new Error(`Session '${session.sessionId}' has a child Chat without a parent.`);
	}
	if (isEqual(origin.parentChat, chat.resource)) {
		throw new Error(`Session '${session.sessionId}' has a self-parented Chat.`);
	}
	if (!chatsByResource.has(getComparisonKey(origin.parentChat))) {
		throw new Error(`Session '${session.sessionId}' has a child Chat whose parent is outside the Session.`);
	}
}

function assertChatOriginsAcyclic(
	session: ISession,
	chats: readonly IChat[],
	chatsByResource: ReadonlyMap<string, IChat>,
): void {
	for (const chat of chats) {
		const path = new Set<string>();
		let current = chat;
		while (current.origin && current.origin.kind !== ChatOriginKind.User) {
			const resourceKey = getComparisonKey(current.resource);
			if (path.has(resourceKey)) {
				throw new Error(`Session '${session.sessionId}' contains a cycle in its Chat origins.`);
			}
			path.add(resourceKey);
			current = chatsByResource.get(getComparisonKey(current.origin.parentChat))!;
		}
	}
}
