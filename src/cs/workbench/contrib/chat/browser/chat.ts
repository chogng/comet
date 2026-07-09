/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import type { LlmProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
	AssistantChatMessage,
} from 'cs/workbench/browser/assistantModel';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import type {
	LlmReasoningEffort,
	LlmServiceTier,
} from 'cs/workbench/services/llm/registry';
import type { ArticleBatchTaskProgress } from 'cs/workbench/browser/articleBatchTask';

export type ChatModelDropdownOption = DropdownOption & {
	readonly providerId?: LlmProviderId;
	readonly modelId?: string;
	readonly modelLabel?: string;
	readonly reasoningEffort?: LlmReasoningEffort;
	readonly serviceTier?: LlmServiceTier;
};

export type ChatWidgetProps = {
	readonly isKnowledgeBaseModeEnabled: boolean;
	readonly activeLlmModelLabel: string;
	readonly isMaxContextWindowEnabled: boolean;
	readonly activeLlmModelSupportsMaxContextWindow: boolean;
	readonly messages: AssistantChatMessage[];
	readonly question: string;
	readonly onQuestionChange: (value: string) => void;
	readonly isAsking: boolean;
	readonly errorMessage: string | null;
	readonly onAsk: () => void;
	readonly onApplyPatch: (messageId: string) => void;
	readonly articleQuickSources: BatchSource[];
	readonly isArticleSourceFetching: boolean;
	readonly onFetchArticleSource: (source: BatchSource) => void | Promise<void>;
	readonly showArticleBatchActions: boolean;
	readonly downloadAllProgress: ArticleBatchTaskProgress | null;
	readonly translationExportProgress: ArticleBatchTaskProgress | null;
	readonly onDownloadAllArticles: () => void | Promise<void>;
	readonly onExportArticleSummaries: (translateSummaries: boolean) => void | Promise<void>;
	readonly isArticleSelected: (href: string) => boolean;
	readonly onToggleArticleSelected: (href: string) => void;
	readonly availableArticleCount: number;
	readonly llmModelOptions: ChatModelDropdownOption[];
	readonly activeLlmModelOptionValue: string;
	readonly onCloseAgentBar: () => void;
	readonly onToggleAutoModelRouting: (options?: { suppressRender?: boolean }) => string | void;
	readonly onSelectLlmModel: (value: string) => void;
	readonly onToggleMaxContextWindow: (options?: { suppressRender?: boolean }) => void;
	readonly onOpenModelSettings: () => void;
};
