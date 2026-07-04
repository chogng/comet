import type { AssistantModelSnapshot } from 'cs/workbench/browser/assistantModel';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import type { Event } from 'cs/base/common/event';
import type { ChatOpenLinkRequest, ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/chatWidget';
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
		showArticleBatchActions: boolean;
	};
	actions: {
		onQuestionChange: (value: string) => void;
		onAsk: () => void;
		onApplyPatch: (messageId: string) => void;
		onFetchArticleSource: (source: BatchSource) => void | Promise<void>;
		onDownloadAllArticles: () => void | Promise<void>;
		onExportArticleSummaries: () => void | Promise<void>;
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
		showArticleBatchActions,
	},
	actions: {
		onQuestionChange,
		onAsk,
		onApplyPatch,
		onFetchArticleSource,
		onDownloadAllArticles,
		onExportArticleSummaries,
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
		showArticleBatchActions,
		onDownloadAllArticles,
		onExportArticleSummaries,
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
	readonly onDidRequestOpenLink: Event<ChatOpenLinkRequest>;

	constructor(props: SessionChatViewProps) {
		this.widget = new ChatWidget(props);
		this.onDidRequestOpenLink = this.widget.onDidRequestOpenLink;
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
