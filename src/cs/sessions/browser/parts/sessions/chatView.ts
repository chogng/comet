import type { AssistantModelSnapshot } from 'cs/workbench/browser/assistantModel';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/widget/chatWidget';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import { $ } from 'cs/base/browser/dom';
import type { ArticleBatchTaskProgress } from 'cs/workbench/browser/articleBatchTask';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

import 'cs/sessions/browser/parts/media/sessionView.css';

export type SessionChatViewProps = ChatWidgetProps;

type CreateSessionChatViewPropsParams = {
	markdownRendererService: ChatWidgetProps['markdownRendererService'];
	state: {
		isKnowledgeBaseModeEnabled: boolean;
		question: string;
		messages: AssistantModelSnapshot['messages'];
		isAsking: boolean;
		errorMessage: string | null;
		availableArticleCount: number;
		conversations: AssistantModelSnapshot['conversations'];
		activeConversationId: AssistantModelSnapshot['activeConversationId'];
		llmModelOptions: DropdownOption[];
		activeLlmModelOptionValue: string;
		activeLlmModelLabel: string;
		isMaxContextWindowEnabled: boolean;
		activeLlmModelSupportsMaxContextWindow: boolean;
		articleQuickSources: BatchSource[];
		isArticleSourceFetching: boolean;
		showArticleBatchActions: boolean;
		downloadAllProgress: ArticleBatchTaskProgress | null;
		translationExportProgress: ArticleBatchTaskProgress | null;
		isArticleSelected: (href: string) => boolean;
	};
	actions: {
		onQuestionChange: (value: string) => void;
		onAsk: () => void;
		onApplyPatch: (messageId: string) => void;
		onFetchArticleSource: (source: BatchSource) => void | Promise<void>;
		onDownloadAllArticles: () => void | Promise<void>;
		onExportArticleSummaries: (translateSummaries: boolean) => void | Promise<void>;
		onToggleArticleSelected: (href: string) => void;
		onCreateConversation: () => void;
		onActivateConversation: (conversationId: string) => void;
		onCloseConversation: (conversationId: string) => void;
		onCloseSession: () => void;
		onToggleAutoModelRouting: (options?: { suppressRender?: boolean }) => string | void;
		onSelectLlmModel: (value: string) => void;
		onToggleMaxContextWindow: (options?: { suppressRender?: boolean }) => void;
		onOpenModelSettings: () => void;
	};
};

export function createSessionChatViewProps({
	markdownRendererService,
	state: {
		isKnowledgeBaseModeEnabled,
		question,
		messages,
		isAsking,
		errorMessage,
		availableArticleCount,
		conversations,
		activeConversationId,
		llmModelOptions,
		activeLlmModelOptionValue,
		activeLlmModelLabel,
		isMaxContextWindowEnabled,
		activeLlmModelSupportsMaxContextWindow,
		articleQuickSources,
		isArticleSourceFetching,
		showArticleBatchActions,
		downloadAllProgress,
		translationExportProgress,
		isArticleSelected,
	},
	actions: {
		onQuestionChange,
		onAsk,
		onApplyPatch,
		onFetchArticleSource,
		onDownloadAllArticles,
		onExportArticleSummaries,
		onToggleArticleSelected,
		onCreateConversation,
		onActivateConversation,
		onCloseConversation,
		onCloseSession,
		onToggleAutoModelRouting,
		onSelectLlmModel,
		onToggleMaxContextWindow,
		onOpenModelSettings,
	},
}: CreateSessionChatViewPropsParams): SessionChatViewProps {
	return {
		markdownRendererService,
		isKnowledgeBaseModeEnabled,
		question,
		messages,
		onQuestionChange,
		isAsking,
		errorMessage,
		onAsk,
		onApplyPatch,
		articleQuickSources,
		isArticleSourceFetching,
		onFetchArticleSource,
		showArticleBatchActions,
		downloadAllProgress,
		translationExportProgress,
		onDownloadAllArticles,
		onExportArticleSummaries,
		isArticleSelected,
		onToggleArticleSelected,
		availableArticleCount,
		conversations,
		activeConversationId,
		llmModelOptions,
		activeLlmModelOptionValue,
		activeLlmModelLabel,
		isMaxContextWindowEnabled,
		activeLlmModelSupportsMaxContextWindow,
		onCreateConversation,
		onActivateConversation,
		onCloseConversation,
		onCloseAgentBar: onCloseSession,
		onToggleAutoModelRouting,
		onSelectLlmModel,
		onToggleMaxContextWindow,
		onOpenModelSettings,
	};
}

export class SessionChatView {
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-chat-view');
	private readonly widget: ChatWidget;

	constructor(
		props: SessionChatViewProps,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.widget = instantiationService.createInstance(ChatWidget, props);
		this.element.append(this.widget.getElement());
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionChatViewProps) {
		this.widget.setProps(props);
	}

	focus() {
		this.widget.focusInput();
	}

	dispose() {
		this.widget.dispose();
		this.element.replaceChildren();
	}
}
