import type { AssistantModelSnapshot } from 'ls/workbench/browser/assistantModel';
import type { DropdownOption } from 'ls/base/browser/ui/dropdown/dropdown';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'ls/workbench/browser/layout';
import { AgentChatWidget } from 'ls/workbench/contrib/agentChat/browser/agentChatWidget';
import type { AgentChatWidgetProps } from 'ls/workbench/contrib/agentChat/browser/agentChatWidget';
import { getWindowChromeLayout } from 'ls/platform/window/common/window';

import { createAgentBarLabels } from 'ls/workbench/browser/parts/agentbar/agentbarLabels';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export type { AgentChatWidgetProps } from 'ls/workbench/contrib/agentChat/browser/agentChatWidget';
export type AgentBarPartProps = AgentChatWidgetProps & {
  isPrimarySidebarVisible?: boolean;
  topbarActionsElement?: HTMLElement | null;
  topbarTrailingActionsElement?: HTMLElement | null;
};

type CreateAgentBarPartPropsParams = {
  state: {
    ui: Parameters<typeof createAgentBarLabels>[0];
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
    isSecondarySidebarVisible: boolean;
  };
  actions: {
    onQuestionChange: (value: string) => void;
    onAsk: () => void;
    onApplyPatch: (messageId: string) => void;
    onCreateConversation: () => void;
    onActivateConversation: (conversationId: string) => void;
    onCloseConversation: (conversationId: string) => void;
    onCloseAgentBar: () => void;
    onToggleSecondarySidebar: () => void;
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

export function createAgentBarPartProps({
  state: {
    ui,
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
    onCloseAgentBar,
    onToggleAutoModelRouting,
    onSelectLlmModel,
    onToggleMaxContextWindow,
    onOpenModelSettings,
  },
}: CreateAgentBarPartPropsParams): AgentBarPartProps {
  return {
    labels: createAgentBarLabels(ui),
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
    onCloseAgentBar,
    onToggleAutoModelRouting,
    onSelectLlmModel,
    onToggleMaxContextWindow,
    onOpenModelSettings,
    isPrimarySidebarVisible: true,
  };
}

export class AgentBarPartView {
  private readonly element = createElement(
    'section',
    'agentbar',
  );
  private readonly topbarElement = createElement(
    'div',
    'agentbar-topbar',
  );
  private readonly topbarActionsElement = createElement(
    'div',
    'agentbar-topbar-actions',
  );
  private readonly topbarLeadingActionsElement = createElement(
    'div',
    'agentbar-topbar-leading',
  );
  private readonly topbarTrailingActionsElement = createElement(
    'div',
    'agentbar-topbar-trailing',
  );
  private readonly leadingWindowControlsSpacer = createElement(
    'div',
    'agentbar-topbar-window-controls-spacer',
  );
  private readonly sidebar: AgentChatWidget;

  constructor(props: AgentBarPartProps) {
    registerWorkbenchPartDomNode(
      WORKBENCH_PART_IDS.agentSidebar,
      this.element,
    );
    this.sidebar = new AgentChatWidget(props);
    if (WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0) {
      this.leadingWindowControlsSpacer.style.setProperty(
        '--window-controls-width',
        `${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
      );
      this.topbarElement.append(this.leadingWindowControlsSpacer);
    }
    this.topbarActionsElement.append(
      this.topbarLeadingActionsElement,
      this.topbarTrailingActionsElement,
    );
    this.topbarElement.append(this.topbarActionsElement);
    this.element.append(this.topbarElement, this.sidebar.getElement());
    this.renderTopbar(props);
  }

  getElement() {
    return this.element;
  }

  getTopbarElement() {
    return this.topbarElement;
  }

  setProps(props: AgentBarPartProps) {
    this.sidebar.setProps(props);
    this.renderTopbar(props);
  }

  dispose() {
    this.sidebar.dispose();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.agentSidebar, null);
    this.element.replaceChildren();
  }

  private renderTopbar(props: AgentBarPartProps) {
    this.syncTopbarSlot(
      this.topbarLeadingActionsElement,
      props.topbarActionsElement ?? null,
    );
    this.syncTopbarSlot(
      this.topbarTrailingActionsElement,
      props.topbarTrailingActionsElement ?? null,
    );
  }

  private syncTopbarSlot(
    slotElement: HTMLElement,
    topbarActionsElement: HTMLElement | null,
  ) {
    const currentTopbarActionsElement = slotElement.firstElementChild;
    if (topbarActionsElement) {
      if (currentTopbarActionsElement !== topbarActionsElement) {
        slotElement.replaceChildren(topbarActionsElement);
      }
      return;
    }

    if (currentTopbarActionsElement) {
      slotElement.replaceChildren();
    }
  }
}

export function createAgentBarPartView(props: AgentBarPartProps) {
  return new AgentBarPartView(props);
}
