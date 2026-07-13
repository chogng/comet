/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type { URI } from 'cs/base/common/uri';
import type { IAgentHostAttachment, IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import type {
	AgentChatId,
	AgentSessionId,
	AgentSubmissionId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostChatState } from 'cs/platform/agentHost/common/protocol';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
	IChatAttachmentProducer,
	IChatSubmissionCapture,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import type {
	IChatHostPresentation,
	IChatHostPresentationIdentity,
	IChatHostPresentationProvider,
	ChatPresentationTypeId,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';

export const IChatService = createDecorator<IChatService>('chatService');

/** Identifies the immutable composer revision currently being prepared for Host acceptance. */
export interface IChatPreparingSubmission {
	readonly id: AgentSubmissionId;
	readonly composerRevision: number;
}

/** Immutable observable state for one addressed Chat resource. */
export interface IChatModelSnapshot {
	readonly hostState: IAgentHostChatState | undefined;
	readonly hostPresentations: readonly IChatHostPresentation[];
	readonly input: string;
	readonly composerRevision: number;
	readonly pendingAttachments: readonly IPendingChatAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
	readonly preparingSubmission: IChatPreparingSubmission | undefined;
	readonly errorMessage: string | undefined;
}

/** Read surface for one addressed Chat model. */
export interface IChatModel {
	readonly resource: URI;
	readonly onDidChange: Event<void>;
	getSnapshot(): IChatModelSnapshot;
	getHostPresentation(identity: IChatHostPresentationIdentity): IChatHostPresentation | undefined;
}

/** Lifetime reference to a loaded addressed Chat model. */
export interface IChatModelReference extends IDisposable {
	readonly object: IChatModel;
}

/** Exact Host backing identity applied only by the owner of one Chat presentation model. */
export interface IChatHostModelIdentity {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
}

/** Ownership reference used by a provider to publish authoritative Host history. */
export interface IChatModelOwnerReference extends IChatModelReference {
	replaceHostState(identity: IChatHostModelIdentity, state: IAgentHostChatState): void;
	importHostPresentations(
		identity: IChatHostModelIdentity,
		presentations: readonly IChatHostPresentation[],
	): void;
	delete(): void;
}

/** Initial state supplied by the owner that creates a Chat resource. */
export interface IChatModelInitialState {
	readonly input?: string;
	readonly composerRevision?: number;
	readonly pendingAttachments?: readonly IPendingChatAttachment[];
	readonly interactionTargets?: readonly IAgentHostInteractionTarget[];
	readonly errorMessage?: string;
}

/** Compare-and-set mutation for Feature-owned opaque presentation state. */
export interface IChatHostPresentationUpdate {
	readonly identity: IChatHostPresentationIdentity;
	readonly type: ChatPresentationTypeId;
	readonly expectedValue: AgentHostProtocolValue;
	readonly value: AgentHostProtocolValue;
}

/** Owns one resolved composer capture until exact Host acceptance or rejection is reconciled. */
export interface IPreparedChatSubmission {
	readonly capture: IChatSubmissionCapture;
	readonly attachments: readonly IAgentHostAttachment[];
	readonly interactionTargets: readonly IAgentHostInteractionTarget[];
	accept(): Promise<void>;
	reject(): Promise<void>;
}

/** Owns loaded single-conversation models addressed strictly by resource. */
export interface IChatService {
	readonly _serviceBrand: undefined;
	/** Fires only after an addressed Chat model is permanently deleted. */
	readonly onDidDeleteModel: Event<URI>;
	createModel(resource: URI, initialState?: IChatModelInitialState): IChatModelOwnerReference;
	acquireModel(resource: URI): IChatModelReference;
	registerAttachmentProducer(producer: IChatAttachmentProducer): IDisposable;
	registerHostPresentationProvider(provider: IChatHostPresentationProvider): IDisposable;
	updateHostPresentation(resource: URI, update: IChatHostPresentationUpdate): void;
	setInput(resource: URI, value: string): void;
	addComposerContext(
		resource: URI,
		attachments: readonly IPendingChatAttachment[],
		targets: readonly IAgentHostInteractionTarget[],
	): void;
	addPendingAttachments(resource: URI, attachments: readonly IPendingChatAttachment[]): void;
	removePendingAttachment(resource: URI, attachmentId: IPendingChatAttachment['id']): void;
	clearPendingAttachments(resource: URI): void;
	addInteractionTargets(resource: URI, targets: readonly IAgentHostInteractionTarget[]): void;
	removeInteractionTarget(resource: URI, targetId: IAgentHostInteractionTarget['id']): void;
	clearInteractionTargets(resource: URI): void;
	prepareSubmission(
		resource: URI,
		submissionId: AgentSubmissionId,
		token: CancellationToken,
	): Promise<IPreparedChatSubmission>;
}
