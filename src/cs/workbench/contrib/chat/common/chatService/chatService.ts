/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	Article,
	LlmSettings,
	MainAgentPatchProposal,
	RagAnswerResult,
	RagSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type {
	WritingEditorDocument,
	WritingEditorStableSelectionTarget,
} from 'cs/editor/common/writingEditorDocument';
import type { DisposableHandle } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { LocaleMessages } from 'language/locales';

export const IChatService = createDecorator<IChatService>('chatService');

export type ChatServiceContext = {
	desktopRuntime: boolean;
	invokeDesktop: ElectronInvoke;
	ui: LocaleMessages;
	isKnowledgeBaseModeEnabled: boolean;
	articles: Article[];
	llmSettings: LlmSettings;
	ragSettings: RagSettings;
	fallbackWritingContext?: string;
	getFallbackWritingContext?: () => string;
	getDraftBody?: () => string;
	getDraftDocument?: () => WritingEditorDocument | null;
	setDraftDocument?: (value: WritingEditorDocument) => void;
	getActiveDraftStableSelectionTarget?: () => WritingEditorStableSelectionTarget | null;
};

export type ChatPatchProposal = MainAgentPatchProposal & {
	isApplied: boolean;
	applyError: string | null;
};

type ChatTextMessageBase = {
	id: string;
	content: string;
	includeInAgentHistory?: boolean;
};

export type ChatMessage =
	| (ChatTextMessageBase & {
		role: 'user';
	})
	| (ChatTextMessageBase & {
		role: 'assistant';
		result?: RagAnswerResult | null;
		patchProposal?: ChatPatchProposal | null;
	});

export type ChatConversation = {
	id: string;
	title: string;
	autoTitleIndex: number | null;
	question: string;
	result: RagAnswerResult | null;
	messages: ChatMessage[];
	isAsking: boolean;
	errorMessage: string | null;
};

export type ChatServiceSnapshot = {
	conversations: ChatConversation[];
	activeConversationId: string;
	selectedArticleUrlsInOrder: string[];
	activeConversation: ChatConversation | null;
	question: string;
	messages: ChatMessage[];
	result: RagAnswerResult | null;
	isAsking: boolean;
	errorMessage: string | null;
};

export interface IChatService {
	readonly _serviceBrand: undefined;
	subscribe(listener: () => void): DisposableHandle;
	getSnapshot(): ChatServiceSnapshot;
	setContext(context: ChatServiceContext): void;
	setQuestion(value: string): void;
	createConversation(): void;
	activateConversation(conversationId: string): void;
	closeConversation(conversationId: string): void;
	insertArticles(articles: readonly Article[], sourceLabel: string): void;
	insertArticleFetchEmptyResult(sourceLabel: string, message: string): void;
	applyPatch(messageId: string): void;
	ask(): Promise<void>;
	collectArticleBatch(articles: readonly Article[]): Article[];
	collectSelectedArticleBatch(articles: readonly Article[]): Article[];
	isArticleSelected(href: string): boolean;
	toggleArticleSelected(href: string): void;
}
