import type { AssistantChatMessage, AssistantConversation } from 'cs/workbench/browser/assistantModel';
import {
  createActionBarView,
  type ActionBarActionItem,
  type ActionBarItem,
  type ActionBarMenuItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import {
  createDropdownMenuActionViewItem,
  DropdownMenuActionViewItem,
  type DropdownMenuActionViewItemOptions,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createFilterMenuHeader } from 'cs/base/browser/ui/dropdown/dropdownSearchHeader';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';

import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { localize } from 'cs/nls';
import {
  parseLlmModelOptionValue,
  serializeLlmModelOptionValue,
  type LlmReasoningEffort,
  type LlmServiceTier,
} from 'cs/workbench/services/llm/registry';
import type { LlmProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { AgentChatThreadWidget } from 'cs/workbench/contrib/chat/browser/chatListWidget';
import 'cs/workbench/browser/parts/agentbar/media/agentbar.css';
import 'cs/workbench/contrib/chat/browser/media/chat.css';

type AgentModelDropdownOption = DropdownOption & {
  providerId?: LlmProviderId;
  modelId?: string;
  modelLabel?: string;
  reasoningEffort?: LlmReasoningEffort;
  serviceTier?: LlmServiceTier;
};

type AgentModelMenuGroup = {
  key: string;
  providerId: LlmProviderId;
  modelId: string;
  label: string;
  title?: string;
  icon?: LxIconName;
  disabled: boolean;
  options: AgentModelDropdownOption[];
};

export type AgentChatWidgetProps = {
  isKnowledgeBaseModeEnabled: boolean;
  activeLlmModelLabel: string;
  isMaxContextWindowEnabled: boolean;
  activeLlmModelSupportsMaxContextWindow: boolean;
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
  llmModelOptions: AgentModelDropdownOption[];
  activeLlmModelOptionValue: string;
  onCreateConversation: () => void;
  onActivateConversation: (conversationId: string) => void;
  onCloseConversation: (conversationId: string) => void;
  onCloseAgentBar: () => void;
  onToggleAutoModelRouting: (options?: { suppressRender?: boolean }) => string | void;
  onSelectLlmModel: (value: string) => void;
  onToggleMaxContextWindow: (options?: { suppressRender?: boolean }) => void;
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

export class AgentChatWidget {
  private props: AgentChatWidgetProps;
  private readonly element = createElement('div', 'agentbar-content');
  private readonly threadWidget: AgentChatThreadWidget;
  private readonly renderDisposables = new Set<() => void>();
  private modelDropdownActionViewItem: DropdownMenuActionViewItem | null = null;
  private transientActiveLlmModelOptionValue: string | null = null;
  private transientMaxContextWindowEnabled: boolean | null = null;

  constructor(props: AgentChatWidgetProps) {
    this.props = props;
    this.threadWidget = new AgentChatThreadWidget({
      onApplyPatch: (messageId) => {
        this.props.onApplyPatch(messageId);
      },
    });
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: AgentChatWidgetProps) {
    this.props = props;
    this.transientActiveLlmModelOptionValue = null;
    this.transientMaxContextWindowEnabled = null;
    this.render();
  }

  dispose() {
    this.disposeRenderDisposables();
    this.threadWidget.dispose();
    this.element.replaceChildren();
  }

  private render() {
    this.disposeRenderDisposables();
    this.modelDropdownActionViewItem = null;
    const canSend = !this.props.isAsking && this.props.question.trim().length > 0;
    this.element.replaceChildren(
      this.renderTopbar(),
      this.renderShell(canSend),
    );
  }

  private renderTopbar() {
    const topbar = createElement('div', 'agentbar-tabs-header');
    const topbarItems: ActionBarItem[] = [
      this.createTopbarActionItem(
        localize('assistantSidebarNewConversation', "New chat"),
        lxIconSemanticMap.assistant.newConversation,
        this.props.onCreateConversation,
      ),
      this.createTopbarHistoryActionItem(),
      this.createTopbarMoreActionItem(),
    ];

    const actionsView = createActionBarView({
      className: 'sidebar-action-bar',
      ariaRole: 'group',
      items: topbarItems,
    });
    this.renderDisposables.add(() => {
      actionsView.dispose();
    });
    topbar.append(actionsView.getElement());
    return topbar;
  }

  private renderShell(canSend: boolean) {
    const shell = createElement(
      'div',
      [
        'agentbar-shell',
        this.props.messages.length === 0 ? 'is-empty-state' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (this.props.errorMessage) {
      const error = createElement('div', 'agentbar-error');
      error.textContent = this.props.errorMessage;
      shell.append(error);
    }
    this.threadWidget.setMessages(this.props.messages);
    shell.append(this.threadWidget.getElement(), this.renderComposer(canSend));
    return shell;
  }

  private createModelDropdownActionViewItem() {
    const viewItem = new DropdownMenuActionViewItem(
      this.createModelDropdownActionViewItemOptions(),
    );
    this.modelDropdownActionViewItem = viewItem;
    return viewItem;
  }

  private createModelDropdownActionViewItemOptions(): DropdownMenuActionViewItemOptions {
    const currentOption = this.resolveCurrentModelOption();
    const currentLabel = this.getModelDropdownTriggerLabel(currentOption);

    return {
      label: currentLabel,
      title: currentLabel,
      mode: 'custom',
      buttonClassName: 'agentbar-model-switch-btn',
      className: 'agentbar-model-switch',
      disabled: this.props.llmModelOptions.length === 0,
      minWidth: 236,
      menuClassName: 'agentbar-model-menu',
      menuData: 'agentbar-model-menu',
      content: () => this.renderModelDropdownTrigger(currentOption),
      menu: this.createModelMenuItems(''),
      menuHeader: createFilterMenuHeader({
        inputClassName: 'agentbar-model-menu-search-input',
        placeholder: localize('agentbarModelSearch', "Search models"),
        ariaLabel: localize('agentbarModelSearch', "Search models"),
        getMenuItems: (query) => this.createModelMenuItems(query),
      }),
    };
  }

  private resolveCurrentModelOption() {
    const activeLlmModelOptionValue = this.getActiveLlmModelOptionValue();
    const exactOption =
      this.props.llmModelOptions.find(
        (option) => option.value === activeLlmModelOptionValue,
      ) ?? null;
    if (!exactOption) {
      return null;
    }

    return {
      ...exactOption,
      label: this.getModelOptionBaseLabel(exactOption),
    };
  }

  private renderModelDropdownTrigger(currentOption: DropdownOption | null) {
    const trigger = createElement('span', 'agentbar-model-switch-trigger');
    const label = createElement('span', 'agentbar-model-switch-label');
    label.textContent = this.getModelDropdownTriggerLabel(currentOption);
    const chevron = createLxIcon('chevron-down', 'agentbar-model-switch-chevron');

    trigger.append(label, chevron);
    return trigger;
  }

  private getModelDropdownTriggerLabel(currentOption: DropdownOption | null) {
    if (this.getActiveLlmModelOptionValue() === 'auto') {
      return localize('agentbarModelAuto', "Auto");
    }

    return currentOption?.label
      || this.props.activeLlmModelLabel
      || localize('agentbarModelSelect', "Select model");
  }

  private createModelMenuItems(keyword: string): readonly ActionBarMenuItem[] {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const isAutoModelRoutingEnabled =
      this.getActiveLlmModelOptionValue() === 'auto';
    const matchesKeyword = (value: string | undefined) =>
      !normalizedKeyword || value?.toLowerCase().includes(normalizedKeyword);
    const modelGroups = this.getModelMenuGroups().filter((group) =>
      [
        group.label,
        group.title,
        group.providerId,
        group.modelId,
        ...group.options.flatMap((option) => [
          option.label,
          option.title,
          option.value,
          option.reasoningEffort,
          option.serviceTier,
        ]),
      ]
        .filter(Boolean)
        .some((value) => matchesKeyword(value)),
    );
    const autoLabel = localize('agentbarModelAuto', "Auto");
    const autoTitle = localize(
      'agentbarModelAutoTitle',
      "Automatically route to a suitable model for the question.",
    );
    const autoDescription = localize(
      'agentbarModelAutoDescription',
      "Balanced quality and speed, recommended for most tasks",
    );
    const maxModeLabel = localize('agentbarModelMaxMode', "Max mode");
    const maxModeTitle = localize(
      'agentbarModelMaxModeTitle',
      "Use the 1M context window when available.",
    );
    const addModelsLabel = localize('agentbarModelAdd', "Add models");
    const addModelsTitle = localize(
      'agentbarModelAddTitle',
      "Open Settings to manage enabled models.",
    );
    const multipleModelsLabel = localize('agentbarModelMultiple', "Use multiple models");
    const unavailableTitle = localize('agentbarModelUnavailable', "Not available yet.");
    const emptyLabel = localize('agentbarModelSearchEmpty', "No matching models");

    const autoItem: ActionBarMenuItem = {
      label: autoLabel,
      title: autoTitle,
      description: isAutoModelRoutingEnabled
        ? autoDescription
        : undefined,
      checked: isAutoModelRoutingEnabled,
      checkedDisplay: 'switch',
      keepOpenOnClick: true,
      onClick: () => {
        this.handleToggleAutoModelRoutingFromMenu();
      },
    };
    const items: ActionBarMenuItem[] = [
      autoItem,
      {
        label: maxModeLabel,
        title: maxModeTitle,
        checked: this.getIsMaxContextWindowEnabled(),
        checkedDisplay: 'switch',
        keepOpenOnClick: true,
        disabled: !this.props.activeLlmModelSupportsMaxContextWindow,
        onClick: () => {
          this.handleToggleMaxContextWindowFromMenu();
        },
      },
      {
        label: multipleModelsLabel,
        title: unavailableTitle,
        icon: 'reasoning' as LxIconName,
        disabled: true,
      },
    ];

    if (isAutoModelRoutingEnabled) {
      const autoItems = [autoItem].filter((item) =>
        [
          item.label,
          item.title,
          item.description,
        ]
          .filter(Boolean)
          .some((value) => matchesKeyword(value)),
      );
      return autoItems.length > 0
        ? autoItems
        : [{
            id: 'agentbar-model-empty',
            label: emptyLabel,
            disabled: true,
          }];
    }

    const filteredItems = [
      ...items.filter((item) =>
        [
          item.label,
          item.title,
        ]
          .filter(Boolean)
          .some((value) => matchesKeyword(value)),
      ),
      ...modelGroups.map((group) =>
        this.createModelGroupMenuItem(group, isAutoModelRoutingEnabled),
      ),
      ...(matchesKeyword(`${addModelsLabel} ${addModelsTitle}`)
        ? [{
            label: addModelsLabel,
            title: addModelsTitle,
            icon: 'gear' as LxIconName,
            onClick: () => {
              this.props.onOpenModelSettings();
            },
          }]
        : []),
    ];

    if (filteredItems.length > 0) {
      return filteredItems;
    }

    return [
      {
        id: 'agentbar-model-empty',
        label: emptyLabel,
        disabled: true,
      },
    ];
  }

  private getActiveLlmModelOptionValue() {
    return this.transientActiveLlmModelOptionValue
      ?? this.props.activeLlmModelOptionValue;
  }

  private getIsMaxContextWindowEnabled() {
    return this.transientMaxContextWindowEnabled
      ?? this.props.isMaxContextWindowEnabled;
  }

  private resolveManualModelOptionValue() {
    if (this.props.activeLlmModelOptionValue !== 'auto') {
      return this.props.activeLlmModelOptionValue;
    }

    return this.props.llmModelOptions.find((option) => option.value !== 'auto')?.value
      ?? this.props.activeLlmModelOptionValue;
  }

  private handleToggleAutoModelRoutingFromMenu() {
    const previousValue = this.getActiveLlmModelOptionValue();
    const nextValue = this.props.onToggleAutoModelRouting({
      suppressRender: true,
    });
    this.transientActiveLlmModelOptionValue =
      typeof nextValue === 'string'
        ? nextValue
        : previousValue === 'auto'
          ? this.resolveManualModelOptionValue()
          : 'auto';
    this.refreshModelDropdownActionViewItem();
  }

  private handleToggleMaxContextWindowFromMenu() {
    this.props.onToggleMaxContextWindow({ suppressRender: true });
    this.transientMaxContextWindowEnabled = !this.getIsMaxContextWindowEnabled();
    this.refreshModelDropdownActionViewItem();
  }

  private refreshModelDropdownActionViewItem() {
    this.modelDropdownActionViewItem?.setOptions(
      this.createModelDropdownActionViewItemOptions(),
    );
  }

  private getModelMenuGroups(): AgentModelMenuGroup[] {
    const groups = new Map<string, AgentModelMenuGroup>();

    for (const option of this.props.llmModelOptions) {
      if (option.value === 'auto') {
        continue;
      }

      const parsed = parseLlmModelOptionValue(option.value);
      const providerId = option.providerId ?? parsed?.providerId;
      const modelId = option.modelId ?? parsed?.modelId;
      if (!providerId || !modelId) {
        continue;
      }

      const key = `${providerId}:${modelId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.options.push(option);
        existing.disabled = existing.disabled && Boolean(option.disabled);
        continue;
      }

      groups.set(key, {
        key,
        providerId,
        modelId,
        label: this.getModelOptionBaseLabel(option),
        title: option.title,
        icon: option.icon,
        disabled: Boolean(option.disabled),
        options: [option],
      });
    }

    return [...groups.values()];
  }

  private getModelOptionBaseLabel(option: AgentModelDropdownOption) {
    if (option.modelLabel) {
      return option.modelLabel;
    }

    return option.label
      .replace(/\s+·\s*(none|low|medium|high|xhigh|higher|highest|fast)$/i, '')
      .replace(/\s+[Nn]one$/, '')
      .replace(/\s+[Ll]ow$/, '')
      .replace(/\s+[Mm]edium$/, '')
      .replace(/\s+[Hh]igh$/, '')
      .replace(/\s+[Xx][Hh]igh$/, '')
      .replace(/\s+[Hh]igher$/, '')
      .replace(/\s+[Hh]ighest$/, '')
      .replace(/\s+[Ff]ast$/, '');
  }

  private createModelGroupMenuItem(
    group: AgentModelMenuGroup,
    isAutoModelRoutingEnabled: boolean,
  ): ActionBarMenuItem {
    const active = this.getActiveModelGroupKey() === group.key;
    const disabled = group.disabled || isAutoModelRoutingEnabled;
    const hasRuntimeOptions = group.options.some((option) =>
      Boolean(option.reasoningEffort ?? parseLlmModelOptionValue(option.value)?.reasoningEffort)
      || Boolean(option.serviceTier ?? parseLlmModelOptionValue(option.value)?.serviceTier),
    );

    if (!hasRuntimeOptions) {
      return {
        label: group.label,
        title: group.title,
        icon: group.icon,
        checked: active,
        disabled,
        onClick: () => {
          this.props.onSelectLlmModel(this.resolvePreferredModelOptionValue(group));
        },
      };
    }

    return {
      label: group.label,
      title: group.title,
      icon: group.icon,
      checked: active,
      disabled,
      submenu: this.createModelGroupSubmenu(group),
    };
  }

  private createModelGroupSubmenu(group: AgentModelMenuGroup): ActionBarMenuItem[] {
    const activeRuntime = this.getActiveRuntimeParams(group);
    const submenu: ActionBarMenuItem[] = [
      {
        label: localize('agentbarModelUse', "Use model"),
        checked: this.getActiveModelGroupKey() === group.key,
        onClick: () => {
          this.props.onSelectLlmModel(this.resolvePreferredModelOptionValue(group));
        },
      },
    ];

    const reasoningEfforts = this.getGroupReasoningEfforts(group);
    for (const effort of reasoningEfforts) {
      submenu.push({
        label: localize(
          'agentbarModelReasoning',
          "Reasoning: {0}",
          this.formatReasoningEffortLabel(effort),
        ),
        checked:
          this.getActiveModelGroupKey() === group.key &&
          (activeRuntime.reasoningEffort ?? 'none') === effort,
        onClick: () => {
          this.props.onSelectLlmModel(
            this.resolveModelOptionValue(group, effort, activeRuntime.serviceTier),
          );
        },
      });
    }

    const supportsFast = group.options.some((option) =>
      (option.serviceTier ?? parseLlmModelOptionValue(option.value)?.serviceTier) === 'priority',
    );
    if (supportsFast) {
      for (const serviceTier of [undefined, 'priority' as const]) {
        submenu.push({
          label: serviceTier === 'priority'
            ? localize('agentbarModelFastOn', "Fast: On")
            : localize('agentbarModelFastOff', "Fast: Off"),
          checked:
            this.getActiveModelGroupKey() === group.key &&
            (activeRuntime.serviceTier ?? undefined) === serviceTier,
          onClick: () => {
            this.props.onSelectLlmModel(
              this.resolveModelOptionValue(group, activeRuntime.reasoningEffort, serviceTier),
            );
          },
        });
      }
    }

    return submenu;
  }

  private getActiveModelGroupKey() {
    const parsed = parseLlmModelOptionValue(this.props.activeLlmModelOptionValue);
    return parsed ? `${parsed.providerId}:${parsed.modelId}` : '';
  }

  private getActiveRuntimeParams(group: AgentModelMenuGroup) {
    const parsed = parseLlmModelOptionValue(this.props.activeLlmModelOptionValue);
    if (!parsed || `${parsed.providerId}:${parsed.modelId}` !== group.key) {
      return {
        reasoningEffort: this.getPreferredReasoningEffort(group),
        serviceTier: undefined as LlmServiceTier | undefined,
      };
    }

    return {
      reasoningEffort: parsed.reasoningEffort,
      serviceTier: parsed.serviceTier,
    };
  }

  private getGroupReasoningEfforts(group: AgentModelMenuGroup) {
    const efforts = group.options
      .map((option) => option.reasoningEffort ?? parseLlmModelOptionValue(option.value)?.reasoningEffort)
      .filter((effort): effort is LlmReasoningEffort => Boolean(effort));
    return [...new Set(efforts)];
  }

  private getPreferredReasoningEffort(group: AgentModelMenuGroup) {
    const efforts = this.getGroupReasoningEfforts(group);
    for (const effort of ['medium', 'low', 'high', 'xhigh', 'none'] as const) {
      if (efforts.includes(effort)) {
        return effort;
      }
    }
    return efforts[0];
  }

  private resolvePreferredModelOptionValue(group: AgentModelMenuGroup) {
    const activeRuntime = this.getActiveRuntimeParams(group);
    return this.resolveModelOptionValue(
      group,
      activeRuntime.reasoningEffort,
      activeRuntime.serviceTier,
    );
  }

  private resolveModelOptionValue(
    group: AgentModelMenuGroup,
    reasoningEffort?: LlmReasoningEffort,
    serviceTier?: LlmServiceTier,
  ) {
    const candidate = serializeLlmModelOptionValue(
      group.providerId,
      group.modelId,
      reasoningEffort,
      serviceTier,
    );
    if (group.options.some((option) => option.value === candidate)) {
      return candidate;
    }

    const withoutServiceTier = serializeLlmModelOptionValue(
      group.providerId,
      group.modelId,
      reasoningEffort,
    );
    if (group.options.some((option) => option.value === withoutServiceTier)) {
      return withoutServiceTier;
    }

    const base = serializeLlmModelOptionValue(group.providerId, group.modelId);
    if (group.options.some((option) => option.value === base)) {
      return base;
    }

    return group.options[0]?.value ?? base;
  }

  private formatReasoningEffortLabel(reasoningEffort: LlmReasoningEffort) {
    switch (reasoningEffort) {
      case 'none':
        return localize('agentbarReasoningNone', "None");
      case 'low':
        return localize('agentbarReasoningLow', "Low");
      case 'medium':
        return localize('agentbarReasoningMedium', "Medium");
      case 'high':
        return localize('agentbarReasoningHigh', "High");
      case 'xhigh':
        return localize('agentbarReasoningXhigh', "Xhigh");
      case 'higher':
        return localize('agentbarReasoningHigher', "Higher");
      case 'highest':
        return localize('agentbarReasoningHighest', "Highest");
    }
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
    textarea.placeholder = localize(
      'assistantSidebarQuestionPlaceholder',
      "Ask about the fetched literature, compare findings, or draft a short evidence-backed answer.",
    );
    textarea.disabled = this.props.isAsking;
    textarea.setAttribute(
      'aria-label',
      localize('assistantSidebarQuestion', "Question"),
    );
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
      ? localize('assistantSidebarSendBusy', "Asking...")
      : localize('assistantSidebarSend', "Send");
    const actionsView = createActionBarView({
      className: 'agentbar-composer-actions',
      ariaRole: 'group',
      items: [
        this.createComposerActionItem(
          localize('assistantSidebarImage', "Image"),
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
          label: localize('agentbarHistoryEmpty', "no matching agents"),
          disabled: true,
        },
      ];
    }

    return matchedConversations.map((conversation, index) => ({
      id: `agentbar-history-${conversation.id}-${index}`,
      label: conversation.title,
      title: localize(
        'agentbarHistoryConversationTitle',
        "{0} ({1} messages)",
        conversation.title,
        conversation.messages.length,
      ),
      checked: conversation.id === this.props.activeConversationId,
      onClick: () => {
        this.props.onActivateConversation(conversation.id);
      },
    }));
  }

  private createTopbarMoreActionItem(): ActionBarItem {
    return createDropdownMenuActionViewItem({
      label: localize('assistantSidebarMore', "More"),
      title: localize('assistantSidebarMore', "More"),
      content: createLxIcon(lxIconSemanticMap.assistant.more),
      buttonClassName: 'sidebar-action-btn',
      overlayAlignment: 'start',
      menuData: AGENTBAR_TOPBAR_MORE_MENU_DATA,
      menu: [
        {
          label: localize('assistantSidebarNewConversation', "New chat"),
          onClick: () => {
            this.props.onCreateConversation();
          },
        },
      ],
    });
  }

  private createTopbarHistoryActionItem(): ActionBarItem {
    return createDropdownMenuActionViewItem({
      label: localize('assistantSidebarHistory', "History"),
      title: localize('assistantSidebarHistory', "History"),
      content: createLxIcon(lxIconSemanticMap.assistant.history),
      buttonClassName: 'sidebar-action-btn',
      overlayAlignment: 'end',
      menuData: AGENTBAR_TOPBAR_HISTORY_MENU_DATA,
      menu: this.createHistoryMenuItems(''),
      menuHeader: createFilterMenuHeader({
        className: 'agentbar-history-menu-header',
        inputClassName: 'agentbar-history-search-input',
        placeholder: localize('agentbarHistorySearch', "Search history"),
        ariaLabel: localize('agentbarHistorySearch', "Search history"),
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
