/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	derived,
	observableValue,
	type IObservable,
	type ISettableObservable,
} from 'cs/base/common/observable';
import type { URI } from 'cs/base/common/uri';
import type { AgentChatId, AgentSessionId, AgentTurnId } from 'cs/platform/agentHost/common/identities';
import type {
	ChatInteractivity,
	IChat,
	IChatCapabilities,
	IChatOrigin,
	ISession,
	ISessionCapabilities,
	ISessionChange,
	ISessionWorkspaceState,
	SessionStatus,
	SessionTypeId,
	SessionsProviderId,
} from 'cs/sessions/services/sessions/common/session';
import { toSessionId } from 'cs/sessions/services/sessions/common/session';

export interface IAgentHostChatModelState {
	readonly title: string;
	readonly updatedAt: Date;
	readonly status: SessionStatus;
	readonly isRead: boolean;
	readonly modelId: string | undefined;
	readonly interactivity: ChatInteractivity;
	readonly capabilities: IChatCapabilities;
	readonly activeTurn: AgentTurnId | undefined;
}

export interface IAgentHostSessionModelState {
	readonly title: string;
	readonly updatedAt: Date;
	readonly status: SessionStatus;
	readonly isRead: boolean;
	readonly isArchived: boolean;
	readonly workspace: ISessionWorkspaceState;
	readonly changes: readonly ISessionChange[];
	readonly chats: readonly IChat[];
	readonly capabilities: ISessionCapabilities;
}

function snapshotChatModelState(state: IAgentHostChatModelState): IAgentHostChatModelState {
	return Object.freeze({
		...state,
		updatedAt: new Date(state.updatedAt),
		capabilities: Object.freeze({ ...state.capabilities }),
	});
}

function snapshotSessionModelState(state: IAgentHostSessionModelState): IAgentHostSessionModelState {
	return Object.freeze({
		...state,
		updatedAt: new Date(state.updatedAt),
		changes: Object.freeze([...state.changes]),
		chats: Object.freeze([...state.chats]),
		capabilities: Object.freeze({ ...state.capabilities }),
	});
}

/** Provider-owned model for one exact Agent Host Chat. */
export class AgentHostChat implements IChat {
	private readonly stateValue: ISettableObservable<IAgentHostChatModelState>;
	readonly title: IObservable<string>;
	readonly updatedAt: IObservable<Date>;
	readonly status: IObservable<SessionStatus>;
	readonly isRead: IObservable<boolean>;
	readonly modelId: IObservable<string | undefined>;
	readonly interactivity: IObservable<ChatInteractivity>;
	readonly capabilities: IObservable<IChatCapabilities>;
	readonly activeTurn: IObservable<AgentTurnId | undefined>;

	constructor(
		readonly hostSessionId: AgentSessionId,
		readonly hostChatId: AgentChatId,
		readonly resource: URI,
		readonly createdAt: Date,
		readonly origin: IChatOrigin,
		state: IAgentHostChatModelState,
	) {
		this.createdAt = new Date(createdAt);
		this.origin = Object.freeze({ ...origin });
		this.stateValue = observableValue(
			`agentHostChatState-${resource.toString()}`,
			snapshotChatModelState(state),
		);
		this.title = derived(this, reader => this.stateValue.read(reader).title);
		this.updatedAt = derived(this, reader => this.stateValue.read(reader).updatedAt);
		this.status = derived(this, reader => this.stateValue.read(reader).status);
		this.isRead = derived(this, reader => this.stateValue.read(reader).isRead);
		this.modelId = derived(this, reader => this.stateValue.read(reader).modelId);
		this.interactivity = derived(this, reader => this.stateValue.read(reader).interactivity);
		this.capabilities = derived(this, reader => this.stateValue.read(reader).capabilities);
		this.activeTurn = derived(this, reader => this.stateValue.read(reader).activeTurn);
	}

	setState(state: IAgentHostChatModelState, transaction: unknown): void {
		this.stateValue.set(snapshotChatModelState(state), transaction);
	}
}

/** Provider-owned model for one exact Agent Host Session. */
export class AgentHostSession implements ISession {
	readonly sessionId: string;
	private readonly stateValue: ISettableObservable<IAgentHostSessionModelState>;
	readonly title: IObservable<string>;
	readonly updatedAt: IObservable<Date>;
	readonly status: IObservable<SessionStatus>;
	readonly isRead: IObservable<boolean>;
	readonly isArchived: IObservable<boolean>;
	readonly workspace: IObservable<ISessionWorkspaceState>;
	readonly changes: IObservable<readonly ISessionChange[]>;
	readonly chats: IObservable<readonly IChat[]>;
	readonly capabilities: IObservable<ISessionCapabilities>;

	constructor(
		readonly hostSessionId: AgentSessionId,
		readonly resource: URI,
		readonly providerId: SessionsProviderId,
		readonly sessionType: SessionTypeId,
		readonly createdAt: Date,
		state: IAgentHostSessionModelState,
	) {
		this.sessionId = toSessionId(providerId, resource);
		this.createdAt = new Date(createdAt);
		this.stateValue = observableValue(
			`agentHostSessionState-${resource.toString()}`,
			snapshotSessionModelState(state),
		);
		this.title = derived(this, reader => this.stateValue.read(reader).title);
		this.updatedAt = derived(this, reader => this.stateValue.read(reader).updatedAt);
		this.status = derived(this, reader => this.stateValue.read(reader).status);
		this.isRead = derived(this, reader => this.stateValue.read(reader).isRead);
		this.isArchived = derived(this, reader => this.stateValue.read(reader).isArchived);
		this.workspace = derived(this, reader => this.stateValue.read(reader).workspace);
		this.changes = derived(this, reader => this.stateValue.read(reader).changes);
		this.chats = derived(this, reader => this.stateValue.read(reader).chats);
		this.capabilities = derived(this, reader => this.stateValue.read(reader).capabilities);
	}

	setState(state: IAgentHostSessionModelState, transaction: unknown): void {
		this.stateValue.set(snapshotSessionModelState(state), transaction);
	}
}
