import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';
import { createBadge } from 'ls/base/browser/ui/badge/badge';
import { createSwitchView } from 'ls/base/browser/ui/switch/switch';
import { applyHover } from 'ls/base/browser/ui/hover/hover';
import { InputBox } from 'ls/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'ls/base/browser/ui/lxicon/lxicon';
import type { LxIconName } from 'ls/base/browser/ui/lxicon/lxicon';
import type { LlmProviderId, LlmProviderSettings } from 'ls/base/parts/sandbox/common/desktopTypes';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import { ApiKeyWidget } from 'ls/workbench/contrib/preferences/browser/apiKeyWidget';
import {
  createSettingsElement as el,
  setSettingsFocusKey as setFocusKey,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  getEffectiveInputTokenLimit,
  getEnabledLlmModelOptionValuesForProvider,
  hasLlmMaxContextWindow,
  getLlmModelBadges,
  getLlmModelOptionsForProvider,
  llmProviderIds,
  parseLlmModelOptionValue,
  type LlmModelOption,
  type LlmModelBadge,
  type LlmModelDefinition,
} from 'ls/workbench/services/llm/registry';

function normalizeModelLabel(value: string) {
  return value.replace(/[\u2010-\u2015\u2212]/g, '-');
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(millions >= 10 || Number.isInteger(millions) ? 0 : 2).replace(/\.?0+$/, '')}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands.toFixed(thousands >= 10 || Number.isInteger(thousands) ? 0 : 1).replace(/\.?0+$/, '')}K`;
  }

  return String(value);
}

export type LlmWidgetProps = {
  labels: SettingsPartLabels;
  activeLlmProvider: LlmProviderId;
  llmProviders: Record<LlmProviderId, LlmProviderSettings>;
  isSettingsSaving: boolean;
  isTestingLlmConnection: boolean;
  showApiKey: boolean;
  onToggleShowApiKey: () => void;
  onActiveLlmProviderChange: (provider: LlmProviderId) => void;
  onLlmProviderApiKeyChange: (provider: LlmProviderId, apiKey: string) => void;
  onLlmProviderModelChange: (provider: LlmProviderId, model: string) => void;
  onLlmProviderSelectedModelOption: (provider: LlmProviderId, optionValue: string) => void;
  onLlmProviderReasoningEffortChange: (
    provider: LlmProviderId,
    reasoningEffort: import('ls/workbench/services/llm/types').LlmReasoningEffort | undefined,
  ) => void;
  onLlmProviderModelEnabledChange: (
    provider: LlmProviderId,
    optionValue: string,
    enabled: boolean,
  ) => void;
  onLlmProviderUseMaxContextWindowChange: (
    provider: LlmProviderId,
    useMaxContextWindow: boolean,
  ) => void;
  onTestLlmConnection: () => void;
};

type LlmModelListEntry = {
  providerId: LlmProviderId;
  providerLabel: string;
  provider: LlmProviderSettings;
  option: LlmModelOption;
  model: LlmModelDefinition;
  enabledOptionValues: string[];
};

type ModelListItemView = {
  element: HTMLElement;
  update: (entry: LlmModelListEntry) => void;
};

type ModelOrderState =
  | { phase: 'uninitialized' }
  | { phase: 'stable'; order: string[] }
  | { phase: 'dirty'; order: string[] };

const COLLAPSED_MODEL_COUNT = 8;

const modelBadgeMeta: Record<LlmModelBadge, { icon: LxIconName; title: string }> = {
  thinking: { icon: 'brain', title: 'Thinking Model' },
  fast: { icon: 'fast', title: 'Fast Service Tier' },
  reasoning: { icon: 'reasoning', title: 'Reasoning' },
  chat: { icon: 'chat-filled', title: 'Chat' },
  image: { icon: 'image-filled', title: 'Image' },
};

export class LlmWidget {
  private props: LlmWidgetProps;
  private readonly element = el('div', 'settings-field');
  private readonly grid = el('div', 'settings-llm-grid');
  private readonly modelField = el('div', 'settings-field settings-llm-span-2');
  private readonly modelFieldTitle = el('span');
  private readonly maxContextRow = el('div', 'settings-toggle-row settings-llm-api-panel');
  private readonly maxContextText = el('div', 'settings-field');
  private readonly maxContextTitle = el('span');
  private readonly maxContextHint = el('span', 'settings-toggle-subtitle');
  private readonly maxContextSwitch = createSwitchView();
  private readonly modelPanel = el('div', 'settings-model-panel');
  private readonly modelSearchRow = el('div', 'settings-model-search-row');
  private readonly modelSearchInputHost = el('div', 'settings-model-search-input-host');
  private readonly modelSearchActions = this.createModelSearchActions();
  private readonly modelSearchInputBox = new InputBox(this.modelSearchInputHost, undefined, {
    className: 'settings-model-search-input',
    value: '',
    placeholder: '',
  });
  private readonly modelSearchInput = setFocusKey(
    this.modelSearchInputBox.inputElement,
    'settings.llm.modelSearch',
  );
  private readonly modelList = el('div', 'settings-model-list');
  private readonly modelListItemViews = new Map<string, ModelListItemView>();
  private modelOrderState: ModelOrderState = { phase: 'uninitialized' };
  private modelQuery = '';
  private isModelListExpanded = false;
  private readonly apiKeyWidget = new ApiKeyWidget({
    title: '',
    value: '',
    placeholder: '',
    show: false,
    focusKey: 'settings.llm.apiKey',
    toggleKey: 'settings.llm.apiKey.toggle',
    toggleLabelShow: '',
    toggleLabelHide: '',
    onToggle: () => this.props.onToggleShowApiKey(),
    onInput: (value) =>
      this.props.onLlmProviderApiKeyChange(this.props.activeLlmProvider, value),
    testButtonLabel: '',
    testButtonKey: 'settings.llm.test',
    testButtonDisabled: false,
    onTest: () => this.props.onTestLlmConnection(),
    className: 'settings-field settings-llm-api-field settings-llm-api-panel',
  });

  constructor(props: LlmWidgetProps) {
    this.props = props;
    this.modelSearchInputBox.onDidChange((value) => {
      this.modelQuery = value;
      this.renderModelList();
    });
    this.modelSearchInput.spellcheck = false;
    this.maxContextText.append(this.maxContextTitle, this.maxContextHint);
    this.maxContextRow.append(this.maxContextText, this.maxContextSwitch.getElement());
    this.modelSearchRow.append(this.modelSearchInputHost, this.modelSearchActions.getElement());
    this.modelPanel.append(this.modelSearchRow, this.modelList);
    this.modelField.append(this.modelFieldTitle, this.maxContextRow, this.modelPanel);
    this.grid.append(this.modelField, this.apiKeyWidget.getElement());
    this.element.append(this.grid);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  enterModelPage() {
    const entries = this.getRawModelListEntries();
    const order = this.getSynchronizedModelOrder(entries);
    this.modelOrderState = {
      phase: 'stable',
      order: this.buildGroupedModelOrder(entries, order),
    };
    this.renderModelList();
  }

  setProps(props: LlmWidgetProps) {
    const previousEnabledStateKey = this.getEnabledStateKey(this.props);
    this.props = props;
    const nextEnabledStateKey = this.getEnabledStateKey(this.props);
    if (previousEnabledStateKey !== nextEnabledStateKey) {
      this.markModelOrderDirty();
    }
    this.modelFieldTitle.textContent = this.props.labels.settingsLlmModel;
    const activeProviderSettings = this.props.llmProviders[this.props.activeLlmProvider];
    this.maxContextTitle.textContent = this.props.labels.settingsLlmMaxContext;
    this.maxContextHint.textContent = this.props.labels.settingsLlmMaxContextHint;
    this.maxContextSwitch.setProps({
      checked: activeProviderSettings.useMaxContextWindow ?? false,
      disabled: this.props.isSettingsSaving,
      className: 'settings-toggle-switch',
      title: this.props.labels.settingsLlmMaxContext,
      onChange: (checked) =>
        this.props.onLlmProviderUseMaxContextWindowChange(this.props.activeLlmProvider, checked),
    });
    this.modelSearchInputBox.value = this.modelQuery;
    this.modelSearchInputBox.setPlaceHolder(this.props.labels.settingsLlmSearchPlaceholder);
    this.modelSearchInputBox.setTooltip(this.props.labels.settingsLlmSearchPlaceholder);
    this.renderModelList();

    const provider = activeProviderSettings;
    const providerLabel = this.getProviderLabel(this.props.activeLlmProvider);
    this.apiKeyWidget.setProps({
      title: `${this.props.labels.settingsLlmApiKey} (${providerLabel})`,
      value: provider.apiKey,
      placeholder: this.props.labels.settingsLlmApiKeyPlaceholder,
      show: this.props.showApiKey,
      focusKey: 'settings.llm.apiKey',
      toggleKey: 'settings.llm.apiKey.toggle',
      toggleLabelShow: this.props.labels.settingsLlmShowApiKey,
      toggleLabelHide: this.props.labels.settingsLlmHideApiKey,
      onToggle: () => this.props.onToggleShowApiKey(),
      onInput: (value) =>
        this.props.onLlmProviderApiKeyChange(this.props.activeLlmProvider, value),
      testButtonLabel: this.props.labels.settingsLlmTestConnection,
      testButtonKey: 'settings.llm.test',
      testButtonDisabled: this.props.isSettingsSaving || this.props.isTestingLlmConnection,
      onTest: () => this.props.onTestLlmConnection(),
      className: 'settings-field settings-llm-api-field settings-llm-api-panel settings-llm-span-2',
    });
  }

  private getProviderLabel(providerId: LlmProviderId) {
    switch (providerId) {
      case 'glm':
        return this.props.labels.settingsLlmProviderGlm;
      case 'kimi':
        return this.props.labels.settingsLlmProviderKimi;
      case 'deepseek':
        return this.props.labels.settingsLlmProviderDeepSeek;
      case 'anthropic':
        return 'Anthropic';
      case 'gemini':
        return this.props.labels.settingsLlmProviderGemini;
      case 'openai':
        return 'OpenAI';
      case 'custom':
        return 'Custom';
      default:
        return providerId;
    }
  }

  private createModelSearchActions() {
    return createActionBarView({
      className: 'settings-model-search-actions',
      ariaRole: 'group',
      items: [
        {
          label: 'Refresh',
          title: 'Refresh',
          buttonClassName: 'settings-model-search-action',
          content: createLxIcon('refresh'),
          onClick: () => {
            this.modelQuery = '';
            this.modelSearchInputBox.value = '';
            this.renderModelList();
            this.modelSearchInput.focus();
          },
        },
      ],
    });
  }

  private getRawModelListEntries(): LlmModelListEntry[] {
    const entries: LlmModelListEntry[] = [];
    for (const providerId of llmProviderIds) {
      const provider = this.props.llmProviders[providerId];
      const enabledOptionValues = getEnabledLlmModelOptionValuesForProvider(
        providerId,
        provider.enabledModelOptions,
      );
      const providerLabel = this.getProviderLabel(providerId);

      for (const option of getLlmModelOptionsForProvider(providerId, provider.enabledModelOptions)) {
        entries.push({
          providerId,
          providerLabel,
          provider,
          option,
          model: option.model,
          enabledOptionValues,
        });
      }
    }

    return entries;
  }

  private getEnabledStateKey(props: LlmWidgetProps) {
    return llmProviderIds
      .map((providerId) => {
        const enabled = getEnabledLlmModelOptionValuesForProvider(
          providerId,
          props.llmProviders[providerId].enabledModelOptions,
        );
        return `${providerId}:${enabled.join(',')}`;
      })
      .join('|');
  }

  private buildGroupedModelOrder(
    entries: readonly LlmModelListEntry[],
    orderedValues: readonly string[],
  ) {
    const entriesByValue = new Map(entries.map((entry) => [entry.option.value, entry] as const));
    const enabled: string[] = [];
    const disabled: string[] = [];

    for (const optionValue of orderedValues) {
      const entry = entriesByValue.get(optionValue);
      if (!entry) {
        continue;
      }

      if (entry.enabledOptionValues.includes(entry.option.value)) {
        enabled.push(entry.option.value);
      } else {
        disabled.push(entry.option.value);
      }
    }

    return [...enabled, ...disabled];
  }

  private getSynchronizedModelOrder(entries: readonly LlmModelListEntry[]) {
    const entryValues = entries.map((entry) => entry.option.value);
    const entryValueSet = new Set(entryValues);
    const existingOrder =
      this.modelOrderState.phase === 'uninitialized' ? [] : this.modelOrderState.order;
    const currentOrder = existingOrder.filter((optionValue) => entryValueSet.has(optionValue));

    for (const optionValue of entryValues) {
      if (!currentOrder.includes(optionValue)) {
        currentOrder.push(optionValue);
      }
    }

    return currentOrder;
  }

  private markModelOrderDirty() {
    if (this.modelOrderState.phase === 'uninitialized') {
      return;
    }

    const entries = this.getRawModelListEntries();
    this.modelOrderState = {
      phase: 'dirty',
      order: this.getSynchronizedModelOrder(entries),
    };
  }

  private getModelListEntries() {
    const entries = this.getRawModelListEntries();
    if (this.modelOrderState.phase === 'uninitialized') {
      this.modelOrderState = {
        phase: 'stable',
        order: this.buildGroupedModelOrder(
          entries,
          this.getSynchronizedModelOrder(entries),
        ),
      };
    } else if (this.modelOrderState.phase === 'stable') {
      this.modelOrderState = {
        phase: 'stable',
        order: this.getSynchronizedModelOrder(entries),
      };
    } else {
      this.modelOrderState = {
        phase: 'dirty',
        order: this.getSynchronizedModelOrder(entries),
      };
    }

    const currentOrder = this.modelOrderState.order;
    const entriesByValue = new Map(entries.map((entry) => [entry.option.value, entry] as const));
    return currentOrder
      .map((optionValue) => entriesByValue.get(optionValue))
      .filter((entry): entry is LlmModelListEntry => Boolean(entry));
  }

  private renderModelList() {
    const query = this.modelQuery.trim().toLowerCase();
    const entries = this.getModelListEntries().filter((entry) => {
      if (!query) {
        return true;
      }

      return [entry.option.label, entry.model.id, entry.providerLabel, entry.providerId].some(
        (value) => value.toLowerCase().includes(query),
      );
    });

    if (entries.length === 0) {
      const empty = el('div', 'settings-model-list-empty');
      empty.textContent = this.props.labels.settingsLlmNoResults;
      this.syncModelListNodes([empty]);
      return;
    }

    const shouldCollapse = !query && entries.length > COLLAPSED_MODEL_COUNT;
    const visibleEntries =
      shouldCollapse && !this.isModelListExpanded
        ? entries.slice(0, COLLAPSED_MODEL_COUNT)
        : entries;
    const nodes = visibleEntries.map((entry) => this.getOrCreateModelListItemView(entry).element);
    if (shouldCollapse) {
      nodes.push(this.renderModelListToggle(visibleEntries.length < entries.length));
    }

    this.syncModelListNodes(nodes);
  }

  private getOrCreateModelListItemView(entry: LlmModelListEntry) {
    const existing = this.modelListItemViews.get(entry.option.value);
    if (existing) {
      existing.update(entry);
      return existing;
    }

    let currentEntry = entry;
    const item = el(
      'div',
      'settings-model-list-item',
    );
    const nameButton = el('button', 'settings-model-list-button');
    nameButton.type = 'button';
    nameButton.addEventListener('click', () => {
      if (this.props.activeLlmProvider !== currentEntry.providerId) {
        this.props.onActiveLlmProviderChange(currentEntry.providerId);
      }
      this.props.onLlmProviderSelectedModelOption(currentEntry.providerId, currentEntry.option.value);
    });

    const titleRow = el('span', 'settings-model-list-title-row');
    const name = el('span', 'settings-model-list-name');
    nameButton.append(titleRow);

    const switchView = createSwitchView();
    const switchElement = switchView.getElement();
    switchElement.addEventListener('click', (event) => event.stopPropagation());
    switchElement.addEventListener('mousedown', (event) => event.stopPropagation());

    const update = (nextEntry: LlmModelListEntry) => {
      currentEntry = nextEntry;
      const displayLabel = normalizeModelLabel(nextEntry.option.label);
      const isEnabled = nextEntry.enabledOptionValues.includes(nextEntry.option.value);
      const selectedOption = nextEntry.provider.selectedModelOption
        ? parseLlmModelOptionValue(nextEntry.provider.selectedModelOption)
        : null;
      const isCurrent =
        this.props.activeLlmProvider === nextEntry.providerId &&
        selectedOption?.providerId === nextEntry.providerId &&
        selectedOption.modelId === nextEntry.model.id &&
        selectedOption.reasoningEffort === nextEntry.option.reasoningEffort &&
        selectedOption.serviceTier === nextEntry.option.serviceTier;

      item.className = [
        'settings-model-list-item',
        isCurrent ? 'is-current' : '',
      ]
        .filter(Boolean)
        .join(' ');
      item.dataset.modelEntryKey = nextEntry.option.value;

      nameButton.disabled = !isEnabled;
      applyHover(nameButton, nextEntry.model.description || displayLabel);
      name.textContent = displayLabel;
      titleRow.replaceChildren(name);
      const metadataRow = this.renderMetadataRow(nextEntry);
      if (metadataRow) {
        titleRow.append(metadataRow);
      }

      switchElement.dataset.modelEntryKey = nextEntry.option.value;
      switchView.setProps({
        checked: isEnabled,
        disabled: false,
        className: 'settings-model-list-switch',
        title: displayLabel,
        onChange: (_checked, event) => {
          event.stopPropagation();
          this.props.onLlmProviderModelEnabledChange(
            currentEntry.providerId,
            currentEntry.option.value,
            !currentEntry.enabledOptionValues.includes(currentEntry.option.value),
          );
        },
      });
    };

    update(entry);
    item.append(nameButton, switchElement);

    const view: ModelListItemView = {
      element: item,
      update,
    };
    this.modelListItemViews.set(entry.option.value, view);
    return view;
  }

  private renderMetadataRow(entry: LlmModelListEntry, option: LlmModelOption = entry.option) {
    const row = el('span', 'settings-model-list-capabilities');
    const { model, provider } = entry;

    const badges = getLlmModelBadges(model);

    for (const badge of badges) {
      const meta = modelBadgeMeta[badge];
      row.append(
        createBadge({
          icon: meta.icon,
          title: meta.title,
          compact: true,
          className: 'settings-model-list-capability',
        }),
      );
    }

    if (model.context_window_tokens) {
      row.append(
        createBadge({
          label: `Ctx ${formatTokenCount(model.context_window_tokens)}`,
          title: `Official context window: ${formatTokenCount(model.context_window_tokens)}`,
          compact: true,
          className: 'settings-model-list-capability',
        }),
      );
    }

    const useMaxContextWindow = provider.useMaxContextWindow ?? false;
    const effectiveInputTokenLimit = getEffectiveInputTokenLimit(model, useMaxContextWindow);
    if (effectiveInputTokenLimit) {
      const hasMaxContextWindow = hasLlmMaxContextWindow(model);
      const inputTitle = useMaxContextWindow && hasMaxContextWindow
        ? `Max input token budget: ${formatTokenCount(effectiveInputTokenLimit)}`
        : hasMaxContextWindow
          ? `Default input token budget: ${formatTokenCount(effectiveInputTokenLimit)}. Enable Max Context to use ${formatTokenCount(model.input_token_limit!)}.`
          : `Input token budget: ${formatTokenCount(effectiveInputTokenLimit)}`;
      row.append(
        createBadge({
          label: `In ${formatTokenCount(effectiveInputTokenLimit)}`,
          title: inputTitle,
          compact: true,
          className: 'settings-model-list-capability',
        }),
      );
    }

    if (model.max_output_tokens) {
      row.append(
        createBadge({
          label: `Out ${formatTokenCount(model.max_output_tokens)}`,
          title: `Max output tokens: ${formatTokenCount(model.max_output_tokens)}`,
          compact: true,
          className: 'settings-model-list-capability',
        }),
      );
    }

    if (option?.serviceTier === 'priority') {
      row.append(
        createBadge({
          icon: modelBadgeMeta.fast.icon,
          label: 'Fast',
          title: 'Fast service tier (Priority)',
          compact: true,
          className: 'settings-model-list-capability',
        }),
      );
    }

    return row.childElementCount > 0 ? row : null;
  }

  private renderModelListToggle(isCollapsed: boolean) {
    const item = el('div', 'settings-model-list-item settings-model-list-item-toggle');
    const button = el('button', 'settings-model-list-toggle-button');
    button.type = 'button';
    button.textContent = isCollapsed ? 'View all models' : 'Collapse models';
    button.addEventListener('click', () => {
      this.isModelListExpanded = !this.isModelListExpanded;
      this.renderModelList();
    });
    item.append(button);
    return item;
  }

  private syncModelListNodes(nodes: readonly HTMLElement[]) {
    const desiredNodes = new Set(nodes);
    for (const child of [...this.modelList.children]) {
      if (!desiredNodes.has(child as HTMLElement)) {
        child.remove();
      }
    }

    for (const node of nodes) {
      this.modelList.append(node);
    }
  }
}
