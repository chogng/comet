/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	constObservable,
	observableValue,
	type IObservable,
	type ISettableObservable,
} from 'cs/base/common/observable';
import type { URI } from 'cs/base/common/uri';
import {
	ChatInteractivity,
	type IChat,
	type IChatCapabilities,
	type ISession,
	type ISessionCapabilities,
	type ISessionChange,
	type ISessionResolvedWorkspaceState,
	SessionStatus,
	toSessionId,
} from 'cs/sessions/services/sessions/common/session';
import {
	DefaultSessionsProviderId,
	DefaultSessionTypeId,
} from 'cs/sessions/contrib/providers/default/browser/defaultSessionResources';

const DefaultChatCapabilities: IChatCapabilities = Object.freeze({
	supportsRename: true,
	supportsDelete: false,
});

function createDefaultSessionCapabilities(status: SessionStatus): ISessionCapabilities {
	return Object.freeze({
		supportsMultipleChats: false,
		supportsFork: false,
		supportsRename: true,
		supportsArchive: false,
		supportsDelete: status === SessionStatus.Completed || status === SessionStatus.Failed,
		supportsChanges: false,
		supportsModels: true,
	});
}

/** Mutable provider-owned model for one default main Chat. */
export class DefaultChat implements IChat {
	readonly createdAt: Date;
	readonly origin = undefined;

	private readonly titleValue: ISettableObservable<string>;
	readonly title: IObservable<string>;
	private readonly updatedAtValue: ISettableObservable<Date>;
	readonly updatedAt: IObservable<Date>;
	private readonly statusValue: ISettableObservable<SessionStatus>;
	readonly status: IObservable<SessionStatus>;
	readonly isRead = constObservable(true);
	private readonly modelIdValue: ISettableObservable<string | undefined>;
	readonly modelId: IObservable<string | undefined>;
	readonly interactivity = constObservable(ChatInteractivity.Full);
	readonly capabilities = constObservable(DefaultChatCapabilities);

	constructor(
		readonly resource: URI,
		createdAt: Date,
		updatedAt: Date,
		title: string,
		status: SessionStatus,
	) {
		this.createdAt = new Date(createdAt);
		const debugName = resource.toString();
		this.titleValue = observableValue(`defaultChatTitle-${debugName}`, title);
		this.title = this.titleValue;
		this.updatedAtValue = observableValue(`defaultChatUpdatedAt-${debugName}`, new Date(updatedAt));
		this.updatedAt = this.updatedAtValue;
		this.statusValue = observableValue(`defaultChatStatus-${debugName}`, status);
		this.status = this.statusValue;
		this.modelIdValue = observableValue<string | undefined>(`defaultChatModel-${debugName}`, undefined);
		this.modelId = this.modelIdValue;
	}

	setTitle(title: string): void {
		this.titleValue.set(title, undefined);
	}

	setUpdatedAt(updatedAt: Date): void {
		this.updatedAtValue.set(new Date(updatedAt), undefined);
	}

	setStatus(status: SessionStatus): void {
		this.statusValue.set(status, undefined);
	}

	setModelId(modelId: string | undefined): void {
		this.modelIdValue.set(modelId, undefined);
	}
}

/** Mutable provider-owned model for one default single-Chat Session. */
export class DefaultSession implements ISession {
	readonly sessionId: string;
	readonly providerId = DefaultSessionsProviderId;
	readonly sessionType = DefaultSessionTypeId;
	readonly createdAt: Date;

	private readonly titleValue: ISettableObservable<string>;
	readonly title: IObservable<string>;
	private readonly updatedAtValue: ISettableObservable<Date>;
	readonly updatedAt: IObservable<Date>;
	private readonly statusValue: ISettableObservable<SessionStatus>;
	readonly status: IObservable<SessionStatus>;
	private readonly capabilitiesValue: ISettableObservable<ISessionCapabilities>;
	readonly capabilities: IObservable<ISessionCapabilities>;
	readonly isRead = constObservable(true);
	readonly isArchived = constObservable(false);
	readonly workspace: IObservable<ISessionResolvedWorkspaceState>;
	readonly changes: IObservable<readonly ISessionChange[]> = constObservable(Object.freeze([]));
	readonly mainChat: IObservable<IChat>;
	readonly chats: IObservable<readonly IChat[]>;

	constructor(
		readonly resource: URI,
		readonly chat: DefaultChat,
		workspace: ISessionResolvedWorkspaceState,
		createdAt: Date,
		updatedAt: Date,
		title: string,
		status: SessionStatus,
	) {
		this.sessionId = toSessionId(this.providerId, resource);
		this.createdAt = new Date(createdAt);
		const debugName = resource.toString();
		this.titleValue = observableValue(`defaultSessionTitle-${debugName}`, title);
		this.title = this.titleValue;
		this.updatedAtValue = observableValue(`defaultSessionUpdatedAt-${debugName}`, new Date(updatedAt));
		this.updatedAt = this.updatedAtValue;
		this.statusValue = observableValue(`defaultSessionStatus-${debugName}`, status);
		this.status = this.statusValue;
		this.capabilitiesValue = observableValue(
			`defaultSessionCapabilities-${debugName}`,
			createDefaultSessionCapabilities(status),
		);
		this.capabilities = this.capabilitiesValue;
		this.workspace = constObservable(workspace);
		this.mainChat = constObservable(chat);
		this.chats = constObservable(Object.freeze([chat]));
	}

	setTitle(title: string): void {
		this.titleValue.set(title, undefined);
	}

	setActivity(status: SessionStatus, updatedAt: Date): void {
		this.statusValue.set(status, undefined);
		this.capabilitiesValue.set(createDefaultSessionCapabilities(status), undefined);
		this.updatedAtValue.set(new Date(updatedAt), undefined);
		this.chat.setStatus(status);
		this.chat.setUpdatedAt(updatedAt);
	}

	setUpdatedAt(updatedAt: Date): void {
		this.updatedAtValue.set(new Date(updatedAt), undefined);
		this.chat.setUpdatedAt(updatedAt);
	}
}
