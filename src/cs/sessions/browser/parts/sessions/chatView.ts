import type { AssistantModelSnapshot } from 'cs/workbench/browser/assistantModel';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import {
	AgentChatWidget,
	type AgentChatWidgetProps,
} from 'cs/workbench/contrib/chat/browser/chatWidget';

import 'cs/sessions/browser/parts/media/sessionView.css';

export type SessionChatViewProps = AgentChatWidgetProps;

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
	};
	actions: {
		onQuestionChange: (value: string) => void;
		onAsk: () => void;
		onApplyPatch: (messageId: string) => void;
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

function createElement<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
) {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	return element;
}

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
	},
	actions: {
		onQuestionChange,
		onAsk,
		onApplyPatch,
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
	private readonly element = createElement('div', 'session-chat-view');
	private readonly widget: AgentChatWidget;

	constructor(props: SessionChatViewProps) {
		this.widget = new AgentChatWidget(props);
		this.element.append(this.widget.getElement());
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionChatViewProps) {
		this.widget.setProps(props);
	}

	focus() {
		this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	dispose() {
		this.widget.dispose();
		this.element.replaceChildren();
	}
}

export function createSessionChatView(props: SessionChatViewProps) {
	return new SessionChatView(props);
}
