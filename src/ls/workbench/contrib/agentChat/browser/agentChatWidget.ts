import type { AssistantChatMessage, AssistantConversation } from 'ls/workbench/browser/assistantModel';
import {
  createActionBarView,
  type ActionBarActionItem,
  type ActionBarItem,
  type ActionBarMenuItem,
} from 'ls/base/browser/ui/actionbar/actionbar';
import {
  createDropdownMenuActionViewItem,
  DropdownMenuActionViewItem,
} from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import {
  createDropdownSearchInputView,
  createFilterMenuHeader,
} from 'ls/base/browser/ui/dropdown/dropdownSearchHeader';
import type { DropdownOption } from 'ls/base/browser/ui/dropdown/dropdown';
import { applyHover } from 'ls/base/browser/ui/hover/hover';
import { HorizontalScrollbar } from 'ls/base/browser/ui/scrollbar/horizontalScrollbar';
import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';
import type { LxIconName } from 'ls/base/browser/ui/lxicon/lxicon';

import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicon/lxiconSemantic';
import type { AgentBarLabels } from 'ls/workbench/browser/parts/agentbar/agentbarLabels';
import 'ls/workbench/browser/parts/agentbar/media/agentbar.css';
import 'ls/workbench/contrib/agentChat/browser/media/agentChatWidget.css';

export type AgentChatWidgetProps = {
  labels: AgentBarLabels;
  isKnowledgeBaseModeEnabled: boolean;
  messages: AssistantChatMessage[];
  question: string;
  onQuestionChange: (value: string) => void;
  isAsking: boolean;
  errorMessage: string | null;
  onAsk: () => void;
  onApplyPatch: (messageId: string) => void;
  availableArticleCount: number;
  conversations: AssistantConversation[];
  activeConversationId: string;
  llmModelOptions: DropdownOption[];
  activeLlmModelOptionValue: string;
  onCreateConversation: () => void;
  onActivateConversation: (conversationId: string) => void;
  onCloseConversation: (conversationId: string) => void;
  onCloseAgentBar: () => void;
  isSecondarySidebarVisible: boolean;
  onToggleSecondarySidebar: () => void;
  onSelectLlmModel: (value: string) => void;
  onOpenModelSettings: () => void;
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

const AGENTBAR_TOPBAR_MORE_MENU_DATA = 'agentbar-topbar-more';
const AGENTBAR_TOPBAR_HISTORY_MENU_DATA = 'agentbar-topbar-history';
const AGENTBAR_HISTORY_SEARCH_PLACEHOLDER = 'Search history';
const AGENTBAR_HISTORY_SEARCH_ARIA_LABEL = 'Search history';
const AGENTBAR_MODEL_SEARCH_PLACEHOLDER = 'Search models';
const AGENTBAR_MODEL_SEARCH_ARIA_LABEL = 'Search models';
const AGENTBAR_MODEL_SEARCH_EMPTY_LABEL = 'No matching models';

export class AgentChatWidget {
  private props: AgentChatWidgetProps;
  private readonly element = createElement('div', 'agentbar-content');
  private readonly renderDisposables = new Set<() => void>();
  private tabStripScrollLeft = 0;

  constructor(props: AgentChatWidgetProps) {
    this.props = props;
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: AgentChatWidgetProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    this.disposeRenderDisposables();
    this.element.replaceChildren();
  }

  private render() {
    this.disposeRenderDisposables();
    const canSend = !this.props.isAsking && this.props.question.trim().length > 0;
    this.element.replaceChildren(
      this.renderTopbar(),
      this.renderShell(canSend),
    );
  }

  private renderTopbar() {
    const topbar = createElement('div', 'agentbar-tabs-header');
    const stripHost = createElement(
      'div',
      'agentbar-tab-scroll-host horizontal-scrollbar-host',
    );
    const strip = createElement(
      'div',
      'agentbar-tab-strip horizontal-scrollbar-strip',
    );
    let activeTabButton: HTMLButtonElement | null = null;
    for (const conversation of this.props.conversations) {
      const item = createElement('div', 'agentbar-tab-item');
      const button = createElement(
        'button',
        [
          'agentbar-tab',
          conversation.id === this.props.activeConversationId ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      button.type = 'button';
      button.textContent = conversation.title;
      applyHover(button, conversation.title);
      if (conversation.id === this.props.activeConversationId) {
        activeTabButton = button;
      }
      button.addEventListener('click', () =>
        this.props.onActivateConversation(conversation.id),
      );

      const close = createElement(
        'button',
        'agentbar-tab-close btn-base btn-ghost btn-mode-icon',
      );
      close.type = 'button';
      close.append(createLxIcon(lxIconSemanticMap.assistant.closeConversation));
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this.props.conversations.length === 1) {
          this.props.onCloseAgentBar();
          return;
        }
        this.props.onCloseConversation(conversation.id);
      });
      item.append(button, close);
      strip.append(item);
    }

    const scrollbarTrack = createElement(
      'div',
      'agentbar-tab-scrollbar horizontal-scrollbar-track',
    );
    scrollbarTrack.setAttribute('aria-hidden', 'true');
    const scrollbarThumb = createElement(
      'div',
      'agentbar-tab-scrollbar-thumb horizontal-scrollbar-thumb',
    );
    scrollbarThumb.setAttribute('aria-hidden', 'true');
    scrollbarTrack.append(scrollbarThumb);
    stripHost.append(strip, scrollbarTrack);

    const tabStripScrollbar = new HorizontalScrollbar(
      stripHost,
      strip,
      scrollbarTrack,
      scrollbarThumb,
      {
        activeItem: activeTabButton,
        initialScrollLeft: this.tabStripScrollLeft,
        scrollYToX: true,
        mouseWheelSmoothScroll: false,
        consumeMouseWheelIfScrollbarIsNeeded: true,
        onScrollLeftChange: (scrollLeft) => {
          this.tabStripScrollLeft = scrollLeft;
        },
      },
    );
    this.renderDisposables.add(() => {
      tabStripScrollbar.dispose();
    });

    const topbarItems: ActionBarItem[] = [
      this.createTopbarActionItem(
        this.props.labels.assistantNewConversation,
        lxIconSemanticMap.assistant.newConversation,
        this.props.onCreateConversation,
      ),
      this.createTopbarHistoryActionItem(),
      this.createTopbarMoreActionItem(),
      this.createTopbarActionItem(
        this.props.isSecondarySidebarVisible
          ? this.props.labels.assistantHideSecondarySidebar
          : this.props.labels.assistantShowSecondarySidebar,
        this.props.isSecondarySidebarVisible
          ? lxIconSemanticMap.assistant.secondarySidebarOpen
          : lxIconSemanticMap.assistant.secondarySidebarClosed,
        this.props.onToggleSecondarySidebar,
        this.props.isSecondarySidebarVisible,
        true,
      ),
    ];

    const actionsView = createActionBarView({
      className: 'sidebar-action-bar',
      ariaRole: 'group',
      items: topbarItems,
    });
    this.renderDisposables.add(() => {
      actionsView.dispose();
    });
    topbar.append(stripHost, actionsView.getElement());
    return topbar;
  }

  private renderShell(canSend: boolean) {
    const shell = createElement('div', 'agentbar-shell');
    if (this.props.errorMessage) {
      const error = createElement('div', 'agentbar-error');
      error.textContent = this.props.errorMessage;
      shell.append(error);
    }
    shell.append(this.renderThread(), this.renderComposer(canSend));
    return shell;
  }

  private renderThread() {
    const thread = createElement(
      'div',
      [
        'agentbar-thread',
        this.props.messages.length === 0 ? 'is-empty' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    for (const message of this.props.messages) {
      if (message.role === 'user') {
        const item = createElement(
          'div',
          'agentbar-message agentbar-message-user',
        );
        const text = createElement('p', 'agentbar-message-text');
        text.textContent = message.content;
        item.append(text);
        thread.append(item);
        continue;
      }

      const item = createElement(
        'div',
        'agentbar-message agentbar-message-assistant',
      );
      const body = createElement('div', 'agentbar-message-body');
      const header = createElement('div', 'agentbar-result-header');
      const strong = document.createElement('strong');
      strong.textContent = this.props.labels.assistantAnswerTitle;
      const pill = createElement(
        'span',
        `agentbar-mode-pill ${message.result.rerankApplied ? 'is-enabled' : 'is-disabled'}`,
      );
      pill.textContent = message.result.rerankApplied
        ? this.props.labels.assistantRerankOn
        : this.props.labels.assistantRerankOff;
      header.append(strong, pill);
      const answer = createElement('p', 'agentbar-answer');
      answer.textContent = message.content;
      body.append(header, answer);

      if (message.result.evidence.length > 0) {
        const evidence = createElement('div', 'agentbar-evidence');
        const title = document.createElement('strong');
        title.textContent = this.props.labels.assistantEvidenceTitle;
        const list = createElement('ul', 'agentbar-evidence-list');
        for (const evidenceItem of message.result.evidence) {
          const li = createElement('li', 'agentbar-evidence-item');
          const titleNode = createElement('strong', 'agentbar-evidence-title');
          titleNode.textContent = `[${evidenceItem.rank}] ${evidenceItem.title}`;
          const meta = createElement('p', 'agentbar-evidence-meta');
          meta.textContent = [evidenceItem.journalTitle, evidenceItem.publishedAt]
            .filter(Boolean)
            .join(' | ');
          const text = createElement('p', 'agentbar-evidence-text');
          text.textContent = evidenceItem.excerpt;
          li.append(titleNode, meta, text);
          list.append(li);
        }
        evidence.append(title, list);
        body.append(evidence);
      }

      const patchProposal = this.renderPatchProposal(message);
      if (patchProposal) {
        body.append(patchProposal);
      }

      item.append(body);
      thread.append(item);
    }
    return thread;
  }

  private renderPatchProposal(
    message: Extract<AssistantChatMessage, { role: 'assistant' }>,
  ) {
    const patchProposal = message.patchProposal ?? null;
    if (!patchProposal) {
      return null;
    }

    const card = createElement('div', 'agentbar-patch-card');
    const header = createElement('div', 'agentbar-patch-header');
    const label = createElement('strong', 'agentbar-patch-label');
    label.textContent = patchProposal.patch.label;
    header.append(label);

    if (patchProposal.isApplied) {
      const status = createElement('span', 'agentbar-mode-pill is-enabled');
      status.textContent = this.props.labels.assistantPatchApplied;
      header.append(status);
    } else if (patchProposal.requiresCustomExecutor) {
      const status = createElement('span', 'agentbar-mode-pill is-disabled');
      status.textContent = this.props.labels.assistantPatchRequiresExecutor;
      header.append(status);
    }

    card.append(header);

    if (patchProposal.patch.summary) {
      const summary = createElement('p', 'agentbar-patch-summary');
      summary.textContent = patchProposal.patch.summary;
      card.append(summary);
    }

    const errorText = patchProposal.validationError || patchProposal.applyError;
    if (errorText) {
      const error = createElement('p', 'agentbar-patch-error');
      error.textContent = errorText;
      card.append(error);
    }

    if (
      patchProposal.accepted &&
      !patchProposal.requiresCustomExecutor &&
      !patchProposal.validationError &&
      !patchProposal.isApplied
    ) {
      const footer = createElement('div', 'agentbar-patch-footer');
      const applyButton = createElement(
        'button',
        'agentbar-patch-btn btn-base btn-secondary btn-sm',
      );
      applyButton.type = 'button';
      applyButton.textContent = this.props.labels.assistantPatchApply;
      applyButton.addEventListener('click', () =>
        this.props.onApplyPatch(message.id),
      );
      footer.append(applyButton);
      card.append(footer);
    }

    return card;
  }

  private createModelDropdownActionViewItem() {
    const currentOption =
      this.props.llmModelOptions.find(
        (option) => option.value === this.props.activeLlmModelOptionValue,
      ) ?? null;

    return new DropdownMenuActionViewItem({
      label: currentOption?.label ?? 'Switch model',
      title: 'Switch model',
      mode: 'custom',
      buttonClassName: 'agentbar-model-switch-btn',
      className: 'agentbar-model-switch',
      disabled: this.props.llmModelOptions.length === 0,
      overlayRole: 'dialog',
      minWidth: 280,
      content: () => this.renderModelDropdownTrigger(currentOption),
      renderOverlay: ({ hide }: { hide: () => void }) => this.renderModelDropdownMenu(hide),
    });
  }

  private renderModelDropdownTrigger(currentOption: DropdownOption | null) {
    const trigger = createElement('span', 'agentbar-model-switch-trigger');
    const activeIcon = currentOption?.icon
      ? createLxIcon(currentOption.icon, 'agentbar-model-switch-icon')
      : null;
    const label = createElement('span', 'agentbar-model-switch-label');
    label.textContent = currentOption?.label ?? 'Select model';
    const chevron = createLxIcon('chevron-down', 'agentbar-model-switch-chevron');

    if (activeIcon) {
      trigger.append(activeIcon);
    }
    trigger.append(label, chevron);
    return trigger;
  }

  private renderModelDropdownMenu(hide: () => void) {
    const menu = createElement('div', 'agentbar-model-menu');
    menu.setAttribute('role', 'group');
    const content = createElement('div', 'agentbar-model-menu-content');
    const searchInput = createDropdownSearchInputView({
      className: 'agentbar-model-menu-search-header',
      inputClassName: 'agentbar-model-menu-search-input',
      placeholder: AGENTBAR_MODEL_SEARCH_PLACEHOLDER,
      ariaLabel: AGENTBAR_MODEL_SEARCH_ARIA_LABEL,
      onChange: (value) => {
        this.renderModelDropdownMenuContent(content, hide, value);
      },
      onEscape: hide,
    });
    menu.append(searchInput.element, content);
    this.renderModelDropdownMenuContent(content, hide, '');
    return menu;
  }

  private renderModelDropdownMenuContent(
    container: HTMLElement,
    hide: () => void,
    keyword: string,
  ) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const matchesKeyword = (value: string | undefined) =>
      !normalizedKeyword || value?.toLowerCase().includes(normalizedKeyword);

    const modeItems = [
      {
        label: 'Auto Max mode',
        description: 'Let the app route to the recommended model automatically.',
        icon: 'agent' as LxIconName,
        checked: this.props.activeLlmModelOptionValue === 'auto',
        onClick: () => {
          this.props.onSelectLlmModel('auto');
          hide();
        },
      },
      {
        label: 'Use multiple models',
        description: 'Not available yet.',
        icon: 'reasoning' as LxIconName,
        disabled: true,
      },
    ]
      .filter((item) =>
        [
          item.label,
          item.description,
        ]
          .filter(Boolean)
          .some((value) => matchesKeyword(value)),
      )
      .map((item) => this.createModelMenuItem(item));

    const modelItems = this.props.llmModelOptions
      .filter((option) => option.value !== 'auto')
      .filter((option) =>
        [
          option.label,
          option.title,
          option.value,
        ]
          .filter(Boolean)
          .some((value) => matchesKeyword(value)),
      )
      .map((option) =>
        this.createModelMenuItem({
          label: option.label,
          description: option.title,
          icon: option.icon,
          checked: this.props.activeLlmModelOptionValue === option.value,
          disabled: option.disabled,
          onClick: () => {
            this.props.onSelectLlmModel(option.value);
            hide();
          },
        }),
      );

    const addModelsItem = matchesKeyword('Add models Open Settings to manage enabled models.')
      ? this.createModelMenuItem({
          label: 'Add models',
          description: 'Open Settings to manage enabled models.',
          icon: 'gear',
          onClick: () => {
            this.props.onOpenModelSettings();
            hide();
          },
        })
      : null;

    const nodes: HTMLElement[] = [];
    if (modeItems.length > 0) {
      nodes.push(this.renderModelMenuSectionLabel('Mode'));
      nodes.push(...modeItems);
    }
    if (modeItems.length > 0 && modelItems.length > 0) {
      nodes.push(this.renderModelMenuSeparator());
    }
    if (modelItems.length > 0) {
      nodes.push(this.renderModelMenuSectionLabel('Models'));
      nodes.push(...modelItems);
    }
    if ((modeItems.length > 0 || modelItems.length > 0) && addModelsItem) {
      nodes.push(this.renderModelMenuSeparator());
    }
    if (addModelsItem) {
      nodes.push(addModelsItem);
    }
    if (nodes.length === 0) {
      const emptyState = createElement('div', 'agentbar-model-menu-empty');
      emptyState.textContent = AGENTBAR_MODEL_SEARCH_EMPTY_LABEL;
      container.replaceChildren(emptyState);
      return;
    }

    container.replaceChildren(...nodes);
  }

  private renderModelMenuSectionLabel(label: string) {
    const element = createElement('div', 'agentbar-model-menu-section-label');
    element.textContent = label;
    return element;
  }

  private renderModelMenuSeparator() {
    return createElement('div', 'agentbar-model-menu-separator');
  }

  private createModelMenuItem(options: {
    label: string;
    description?: string;
    icon?: LxIconName;
    checked?: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }) {
    const item = createElement(
      'button',
      [
        'agentbar-model-menu-item',
        options.checked ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    item.type = 'button';
    item.disabled = Boolean(options.disabled);
    item.setAttribute('aria-pressed', String(Boolean(options.checked)));

    const content = createElement('span', 'agentbar-model-menu-item-content');
    if (options.icon) {
      content.append(createLxIcon(options.icon, 'agentbar-model-menu-item-icon'));
    }

    const copy = createElement('span', 'agentbar-model-menu-item-copy');
    const label = createElement('span', 'agentbar-model-menu-item-label');
    label.textContent = options.label;
    copy.append(label);
    if (options.description) {
      const description = createElement('span', 'agentbar-model-menu-item-description');
      description.textContent = options.description;
      copy.append(description);
    }
    content.append(copy);

    const check = createElement('span', 'agentbar-model-menu-item-check');
    if (options.checked) {
      check.append(createLxIcon('check'));
    }

    item.append(content, check);
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (options.disabled) {
        return;
      }
      options.onClick?.();
    });
    return item;
  }

  private renderComposer(canSend: boolean) {
    const composer = createElement(
      'div',
      [
        'agentbar-composer',
        this.props.messages.length === 0 ? 'is-empty-state' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    const textarea = createElement('textarea', 'agentbar-input');
    textarea.rows = 2;
    textarea.value = this.props.question;
    textarea.placeholder = this.props.labels.assistantQuestionPlaceholder;
    textarea.disabled = this.props.isAsking;
    textarea.setAttribute('aria-label', this.props.labels.assistantQuestion);
    textarea.addEventListener('input', () =>
      this.props.onQuestionChange(textarea.value),
    );
    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
        return;
      }
      event.preventDefault();
      if (canSend) {
        this.props.onAsk();
      }
    });

    const toolbar = createElement('div', 'agentbar-composer-toolbar');
    const modelDropdownView = this.createModelDropdownActionViewItem();
    modelDropdownView.render(toolbar);
    this.renderDisposables.add(() => {
      modelDropdownView.dispose();
    });
    const sendLabel = this.props.isAsking
      ? this.props.labels.assistantSendBusy
      : this.props.labels.assistantSend;
    const actionsView = createActionBarView({
      className: 'agentbar-composer-actions',
      ariaRole: 'group',
      items: [
        this.createComposerActionItem(
          this.props.labels.assistantImage,
          'image-filled',
          'agentbar-composer-tool-action',
        ),
        {
          label: sendLabel,
          title: sendLabel,
          content: createLxIcon(
            this.props.isAsking
              ? lxIconSemanticMap.assistant.busy
              : 'voice-circle-filled',
          ),
          buttonClassName: 'agentbar-composer-send-action',
          onClick: () => this.props.onAsk(),
        },
      ],
    });
    this.renderDisposables.add(() => {
      actionsView.dispose();
    });
    toolbar.append(actionsView.getElement());
    composer.append(textarea, toolbar);
    return composer;
  }

  private createTopbarActionItem(
    label: string,
    icon: LxIconName,
    onClick?: () => void,
    isActive = false,
    isToggle = false,
    triggerId?: string,
  ): ActionBarActionItem {
    return {
      label,
      content: createLxIcon(icon),
      buttonClassName: 'sidebar-action-btn',
      checked: isToggle ? isActive : undefined,
      active: isActive,
      buttonAttributes: triggerId
        ? {
            'data-agentbar-trigger': triggerId,
          }
        : undefined,
      onClick: onClick ? () => onClick() : undefined,
    };
  }

  private createComposerActionItem(
    label: string,
    icon: LxIconName,
    buttonClassName = 'agentbar-composer-tool-action',
  ): ActionBarActionItem {
    return {
      label,
      title: label,
      content: createLxIcon(icon),
      buttonClassName,
    };
  }

  private createHistoryMenuItems(keyword: string): ActionBarMenuItem[] {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const matchedConversations = this.props.conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalizedKeyword),
    );

    if (matchedConversations.length === 0) {
      return [
        {
          id: 'agentbar-history-empty',
          label: 'no matching agents',
          disabled: true,
        },
      ];
    }

    return matchedConversations.map((conversation, index) => ({
      id: `agentbar-history-${conversation.id}-${index}`,
      label: conversation.title,
      title: `${conversation.title} (${conversation.messages.length} messages)`,
      checked: conversation.id === this.props.activeConversationId,
      onClick: () => {
        this.props.onActivateConversation(conversation.id);
      },
    }));
  }

  private createTopbarMoreActionItem(): ActionBarItem {
    return createDropdownMenuActionViewItem({
      label: this.props.labels.assistantMore,
      title: this.props.labels.assistantMore,
      content: createLxIcon(lxIconSemanticMap.assistant.more),
      buttonClassName: 'sidebar-action-btn',
      overlayAlignment: 'start',
      menuData: AGENTBAR_TOPBAR_MORE_MENU_DATA,
      menu: [
        {
          label: this.props.labels.assistantNewConversation,
          onClick: () => {
            this.props.onCreateConversation();
          },
        },
      ],
    });
  }

  private createTopbarHistoryActionItem(): ActionBarItem {
    return createDropdownMenuActionViewItem({
      label: this.props.labels.assistantHistory,
      title: this.props.labels.assistantHistory,
      content: createLxIcon(lxIconSemanticMap.assistant.history),
      buttonClassName: 'sidebar-action-btn',
      overlayAlignment: 'end',
      menuData: AGENTBAR_TOPBAR_HISTORY_MENU_DATA,
      menu: this.createHistoryMenuItems(''),
      menuHeader: createFilterMenuHeader({
        className: 'agentbar-history-menu-header',
        inputClassName: 'agentbar-history-search-input',
        placeholder: AGENTBAR_HISTORY_SEARCH_PLACEHOLDER,
        ariaLabel: AGENTBAR_HISTORY_SEARCH_ARIA_LABEL,
        getMenuItems: (query) => this.createHistoryMenuItems(query),
      }),
    });
  }

  private disposeRenderDisposables() {
    for (const dispose of this.renderDisposables) {
      dispose();
    }
    this.renderDisposables.clear();
  }
}

export function createAgentChatWidget(props: AgentChatWidgetProps) {
  return new AgentChatWidget(props);
}

export default AgentChatWidget;
