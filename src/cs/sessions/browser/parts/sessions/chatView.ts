import type { ChatServiceSnapshot } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'cs/workbench/contrib/chat/browser/widget/chatWidget';
import { $ } from 'cs/base/browser/dom';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

import 'cs/sessions/browser/parts/media/sessionView.css';

export type SessionChatViewProps = ChatWidgetProps;

type CreateSessionChatViewPropsParams = {
	state: {
		isKnowledgeBaseModeEnabled: boolean;
		question: string;
		messages: ChatServiceSnapshot['messages'];
		isAsking: boolean;
		errorMessage: string | null;
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
		llmModelOptions,
		activeLlmModelOptionValue,
		activeLlmModelLabel,
		isMaxContextWindowEnabled,
		activeLlmModelSupportsMaxContextWindow,
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
