import type { AssistantModelSnapshot } from 'cs/workbench/browser/assistantModel';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/chatWidget';
import type { Article } from 'cs/workbench/services/article/articleFetch';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import { $ } from 'cs/base/browser/dom';

import 'cs/sessions/browser/parts/media/sessionView.css';

export type SessionChatViewProps = ChatWidgetProps;

type CreateSessionChatViewPropsParams = {
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
	};
	actions: {
		onQuestionChange: (value: string) => void;
		onAsk: () => void;
		onApplyPatch: (messageId: string) => void;
		onFetchArticleSource: (source: BatchSource) => void | Promise<void>;
		onDownloadArticlePdf: (article: Article) => Promise<void>;
		onOpenArticleDetails: (article: Article) => void | Promise<void>;
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
	},
	actions: {
		onQuestionChange,
		onAsk,
		onApplyPatch,
		onFetchArticleSource,
		onDownloadArticlePdf,
		onOpenArticleDetails,
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
		onDownloadArticlePdf,
		onOpenArticleDetails,
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

	constructor(props: SessionChatViewProps) {
		this.widget = new ChatWidget(props);
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

export function createSessionChatView(props: SessionChatViewProps) {
	return new SessionChatView(props);
}
