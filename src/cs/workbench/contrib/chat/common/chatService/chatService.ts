/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import type {
	MainAgentPatchProposal,
	RagAnswerResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';
import type { IChatImageAttachment } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';

export const IChatService = createDecorator<IChatService>('chatService');

/** Identifies the immutable Draft state against which a patch was generated. */
export interface IChatPatchTarget {
	readonly resource: URI;
	readonly document: WritingEditorDocument;
}

/** Describes a patch proposed by one assistant turn. */
export type ChatPatchProposal = MainAgentPatchProposal & {
	readonly target: IChatPatchTarget;
	readonly isApplied: boolean;
	readonly applyError: string | null;
};

export interface IChatArticleList {
	readonly articleIds: readonly ArticleId[];
}

interface IChatTextMessageBase {
	readonly id: string;
	readonly content: string;
	readonly imageAttachments: readonly IChatImageAttachment[];
	readonly includeInAgentHistory?: boolean;
}

export type ChatMessage =
	| (IChatTextMessageBase & {
		readonly role: 'user';
	})
	| (IChatTextMessageBase & {
		readonly role: 'assistant';
		readonly articleList?: IChatArticleList;
		readonly result?: RagAnswerResult | null;
		readonly patchProposal?: ChatPatchProposal | null;
	});

/** Identifies the only request currently mutating one Chat model. */
export interface IChatActiveRequest {
	readonly id: string;
	readonly prompt: string;
}

/** Immutable observable state for one addressed Chat resource. */
export interface IChatModelSnapshot {
	readonly input: string;
	readonly messages: readonly ChatMessage[];
	readonly activeRequest: IChatActiveRequest | undefined;
	readonly errorMessage: string | undefined;
	readonly checkedArticleIds: readonly ArticleId[];
}

/** Read surface for one addressed Chat model. */
export interface IChatModel {
	readonly resource: URI;
	readonly onDidChange: Event<void>;
	getSnapshot(): IChatModelSnapshot;
}

/** Lifetime reference to a loaded addressed Chat model. */
export interface IChatModelReference extends IDisposable {
	readonly object: IChatModel;
}

/** Initial state supplied by the owner that creates a Chat resource. */
export interface IChatModelInitialState {
	readonly input?: string;
	readonly messages?: readonly ChatMessage[];
	readonly errorMessage?: string;
	readonly checkedArticleIds?: readonly ArticleId[];
}

/** Successful result committed for one active Chat request. */
export interface IChatRequestCompletion {
	readonly content: string;
	readonly result: RagAnswerResult | null;
	readonly patchProposal: {
		readonly proposal: MainAgentPatchProposal;
		readonly target: IChatPatchTarget;
	} | null;
}

/** A validated terminal Chat state that has not yet been published to observers. */
export interface IPreparedChatRequestState {
	readonly snapshot: IChatModelSnapshot;
	commit(): void;
}

/** Owns one active Chat request until its terminal state is committed or the request is rolled back. */
export interface IChatRequestTransaction {
	prepareCompletion(completion: IChatRequestCompletion): IPreparedChatRequestState;
	prepareFailure(errorMessage: string): IPreparedChatRequestState;
	rollback(): void;
}

/** Owns loaded single-conversation models addressed strictly by resource. */
export interface IChatService {
	readonly _serviceBrand: undefined;
	createModel(resource: URI, initialState?: IChatModelInitialState): IChatModelReference;
	acquireModel(resource: URI): IChatModelReference;
	setInput(resource: URI, value: string): void;
	insertContextMessage(
		resource: URI,
		content: string,
		imageAttachments: readonly IChatImageAttachment[],
	): void;
	insertArticleList(
		resource: URI,
		sourceLabel: string,
		articleIds: readonly ArticleId[],
		content: string,
	): void;
	insertArticleFetchEmptyResult(resource: URI, sourceLabel: string, message: string): void;
	applyPatch(resource: URI, messageId: string): void;
	isArticleChecked(resource: URI, articleId: ArticleId): boolean;
	setArticleChecked(resource: URI, articleId: ArticleId, checked: boolean): void;
	removeArticleChecks(resource: URI, articleIds: readonly ArticleId[]): void;
	startRequest(
		resource: URI,
		requestId: string,
		prompt: string,
		imageAttachments: readonly IChatImageAttachment[],
	): IChatRequestTransaction;
}
