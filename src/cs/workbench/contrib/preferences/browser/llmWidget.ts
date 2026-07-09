import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createSwitchView } from 'cs/base/browser/ui/switch/switch';
import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LlmProviderId, LlmProviderSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import {
  createSettingsSection,
  createSettingsRow,
} from 'cs/workbench/contrib/preferences/browser/section';
import {
  buildSettingsSecretInput as buildSecretInput,
  createSettingsElement as el,
  setSettingsFocusKey as setFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  getEnabledLlmModelOptionValuesForProvider,
  getLlmModelOptionsForProvider,
  llmProviderIds,
  parseLlmModelOptionValue,
  type LlmModelOption,
  type LlmModelDefinition,
} from 'cs/workbench/services/llm/registry';

const hoverService = getHoverService();

function normalizeModelLabel(value: string) {
  return value.replace(/[\u2010-\u2015\u2212]/g, '-');
}

export type LlmSettingsSectionProps = {
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
    reasoningEffort: import('cs/workbench/services/llm/types').LlmReasoningEffort | undefined,
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

function getLlmProviderLabel(labels: SettingsPartLabels, providerId: LlmProviderId) {
  switch (providerId) {
    case 'glm':
      return labels.settingsLlmProviderGlm;
    case 'kimi':
      return labels.settingsLlmProviderKimi;
    case 'deepseek':
      return labels.settingsLlmProviderDeepSeek;
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return labels.settingsLlmProviderGemini;
    case 'openai':
      return 'OpenAI';
    case 'custom':
      return 'Custom';
    default:
      return providerId;
  }
}

type LlmModelListEntry = {
  providerId: LlmProviderId;
  providerLabel: string;
  provider: LlmProviderSettings;
  model: LlmModelDefinition;
  options: LlmModelOption[];
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

export class LlmModelSettingsSection {
  private props: LlmSettingsSectionProps;
  private readonly element = el('div', 'comet-settings-llm-settings');
  private readonly modelSection = createSettingsSection({
    title: ' ',
    sectionClassName: 'comet-settings-llm-model-section',
    panelClassName: 'comet-settings-llm-model-panel',
    listClassName: 'comet-settings-llm-model-list',
  });
  private readonly maxContextSwitchRowControl = el('div', 'comet-settings-llm-max-context-control');
  private readonly maxContextSwitch = createSwitchView();
  private readonly modelPanel = el('div', 'comet-settings-model-panel');
  private readonly modelSearchRow = el('div', 'comet-settings-model-search-row');
  private readonly modelSearchInputHost = el('div', 'comet-settings-model-search-input-host');
  private readonly modelSearchActions = this.createModelSearchActions();
  private readonly modelSearchInputBox = new InputBox(this.modelSearchInputHost, undefined, {
    className: 'comet-settings-model-search-input',
    value: '',
    placeholder: '',
  });
  private readonly modelSearchInput = setFocusKey(
    this.modelSearchInputBox.inputElement,
    'settings.llm.modelSearch',
  );
  private readonly modelList = el('div', 'comet-settings-model-list');
  private readonly modelListItemViews = new Map<string, ModelListItemView>();
  private modelOrderState: ModelOrderState = { phase: 'uninitialized' };
  private modelQuery = '';
  private isModelListExpanded = false;

  constructor(props: LlmSettingsSectionProps) {
    this.props = props;
    this.modelSearchInputBox.onDidChange((value) => {
      this.modelQuery = value;
      this.renderModelList();
    });
    this.modelSearchInput.spellcheck = false;
    this.maxContextSwitchRowControl.append(this.maxContextSwitch.getElement());
    this.modelSearchRow.append(this.modelSearchInputHost, this.modelSearchActions.getElement());
    this.modelPanel.append(this.modelSearchRow, this.modelList);
    this.element.append(this.modelSection.element);
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

  setProps(props: LlmSettingsSectionProps) {
    const previousEnabledStateKey = this.getEnabledStateKey(this.props);
    this.props = props;
    const nextEnabledStateKey = this.getEnabledStateKey(this.props);
    if (previousEnabledStateKey !== nextEnabledStateKey) {
      this.markModelOrderDirty();
    }
    this.modelSection.element.querySelector('.comet-settings-block-title')!.textContent = this.props.labels.settingsLlmModel;
    const activeProviderSettings = this.props.llmProviders[this.props.activeLlmProvider];
    this.maxContextSwitch.setProps({
      checked: activeProviderSettings.useMaxContextWindow ?? false,
      disabled: this.props.isSettingsSaving,
      className: 'comet-settings-toggle-switch',
      title: this.props.labels.settingsLlmMaxContext,
      animationKey: `settings.llm.maxContext.${this.props.activeLlmProvider}`,
      onChange: (checked) =>
        this.props.onLlmProviderUseMaxContextWindowChange(this.props.activeLlmProvider, checked),
    });
    this.modelSearchInputBox.value = this.modelQuery;
    this.modelSearchInputBox.setPlaceHolder(this.props.labels.settingsLlmSearchPlaceholder);
    this.modelSearchInputBox.setTooltip(this.props.labels.settingsLlmSearchPlaceholder);
    this.renderModelList();
    this.modelSection.list.replaceChildren(
      createSettingsRow({
        title: this.props.labels.settingsLlmMaxContext,
        description: this.props.labels.settingsLlmMaxContextHint,
        control: this.maxContextSwitchRowControl,
        itemClassName: 'comet-settings-llm-max-context-item',
        controlClassName: 'comet-settings-llm-max-context-row-control',
      }),
      createSettingsRow({
        title: '',
        control: this.modelPanel,
        itemClassName: 'comet-settings-llm-model-picker-item',
        titleClassName: 'comet-settings-block-list-item-title-empty',
        contentClassName: 'comet-settings-llm-model-picker-content',
        controlClassName: 'comet-settings-llm-model-picker-control',
      }),
    );
  }

  private createModelSearchActions() {
    return createActionBarView({
      className: 'comet-settings-model-search-actions',
      ariaRole: 'group',
      items: [
        {
          label: 'Refresh',
          title: 'Refresh',
          buttonClassName: 'comet-settings-model-search-action',
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
      const providerLabel = getLlmProviderLabel(this.props.labels, providerId);
      const optionsByModelId = new Map<string, LlmModelOption[]>();

      for (const option of getLlmModelOptionsForProvider(providerId, provider.enabledModelOptions)) {
        const modelOptions = optionsByModelId.get(option.modelId) ?? [];
        modelOptions.push(option);
        optionsByModelId.set(option.modelId, modelOptions);
      }

      for (const options of optionsByModelId.values()) {
        const firstOption = options[0];
        if (!firstOption) {
          continue;
        }
        entries.push({
          providerId,
          providerLabel,
          provider,
          model: firstOption.model,
          options,
          enabledOptionValues,
        });
      }
    }

    return entries;
  }

  private getEnabledStateKey(props: LlmSettingsSectionProps) {
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
    const entriesByValue = new Map(entries.map((entry) => [this.getModelEntryKey(entry), entry] as const));
    const enabled: string[] = [];
    const disabled: string[] = [];

    for (const entryKey of orderedValues) {
      const entry = entriesByValue.get(entryKey);
      if (!entry) {
        continue;
      }

      if (this.isModelEntryEnabled(entry)) {
        enabled.push(entryKey);
      } else {
        disabled.push(entryKey);
      }
    }

    return [...enabled, ...disabled];
  }

  private getSynchronizedModelOrder(entries: readonly LlmModelListEntry[]) {
    const entryValues = entries.map((entry) => this.getModelEntryKey(entry));
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
    const entriesByValue = new Map(entries.map((entry) => [this.getModelEntryKey(entry), entry] as const));
    return currentOrder
      .map((entryKey) => entriesByValue.get(entryKey))
      .filter((entry): entry is LlmModelListEntry => Boolean(entry));
  }

  private renderModelList() {
    const query = this.modelQuery.trim().toLowerCase();
    const entries = this.getModelListEntries().filter((entry) => {
      if (!query) {
        return true;
      }

      return [entry.model.label, entry.model.id, entry.providerLabel, entry.providerId].some(
        (value) => value.toLowerCase().includes(query),
      );
    });

    if (entries.length === 0) {
      const empty = el('div', 'comet-settings-model-list-empty');
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
    const entryKey = this.getModelEntryKey(entry);
    const existing = this.modelListItemViews.get(entryKey);
    if (existing) {
      existing.update(entry);
      return existing;
    }

    let currentEntry = entry;
    const item = el(
      'div',
      'comet-settings-model-list-item',
    );
    const nameButton = el('button', 'comet-settings-model-list-button');
    nameButton.type = 'button';
    nameButton.addEventListener('click', () => {
      if (this.props.activeLlmProvider !== currentEntry.providerId) {
        this.props.onActiveLlmProviderChange(currentEntry.providerId);
      }
      this.props.onLlmProviderModelChange(currentEntry.providerId, currentEntry.model.id);
    });

    const titleRow = el('span', 'comet-settings-model-list-title-row');
    const name = el('span', 'comet-settings-model-list-name');
    nameButton.append(titleRow);

    const switchView = createSwitchView();
    const switchElement = switchView.getElement();
    switchElement.addEventListener('click', (event) => event.stopPropagation());
    switchElement.addEventListener('mousedown', (event) => event.stopPropagation());

    const update = (nextEntry: LlmModelListEntry) => {
      currentEntry = nextEntry;
      const displayLabel = normalizeModelLabel(nextEntry.model.label);
      const isEnabled = this.isModelEntryEnabled(nextEntry);
      const selectedOption = nextEntry.provider.selectedModelOption
        ? parseLlmModelOptionValue(nextEntry.provider.selectedModelOption)
        : null;
      const isCurrent =
        this.props.activeLlmProvider === nextEntry.providerId &&
        selectedOption?.providerId === nextEntry.providerId &&
        selectedOption.modelId === nextEntry.model.id;

      item.className = [
        'comet-settings-model-list-item',
        isCurrent ? 'comet-is-current' : '',
      ]
        .filter(Boolean)
        .join(' ');
      item.dataset.modelEntryKey = this.getModelEntryKey(nextEntry);

      nameButton.disabled = !isEnabled;
      hoverService.applyHover(nameButton, nextEntry.model.description || displayLabel);
      name.textContent = displayLabel;
      titleRow.replaceChildren(name);

      switchElement.dataset.modelEntryKey = this.getModelEntryKey(nextEntry);
      switchView.setProps({
        checked: isEnabled,
        disabled: false,
        className: 'comet-settings-model-list-switch',
        title: displayLabel,
        animationKey: `settings.llm.model.${this.getModelEntryKey(nextEntry)}`,
        onChange: (_checked, event) => {
          event.stopPropagation();
          const nextEnabled = !this.isModelEntryEnabled(currentEntry);
          for (const option of currentEntry.options) {
            const optionEnabled = currentEntry.enabledOptionValues.includes(option.value);
            if (optionEnabled !== nextEnabled) {
              this.props.onLlmProviderModelEnabledChange(
                currentEntry.providerId,
                option.value,
                nextEnabled,
              );
            }
          }
        },
      });
    };

    update(entry);
    item.append(nameButton, switchElement);

    const view: ModelListItemView = {
      element: item,
      update,
    };
    this.modelListItemViews.set(entryKey, view);
    return view;
  }

  private getModelEntryKey(entry: LlmModelListEntry) {
    return `${entry.providerId}:${entry.model.id}`;
  }

  private isModelEntryEnabled(entry: LlmModelListEntry) {
    return entry.options.some((option) => entry.enabledOptionValues.includes(option.value));
  }

  private renderModelListToggle(isCollapsed: boolean) {
    const item = el('div', 'comet-settings-model-list-item comet-settings-model-list-item-toggle');
    const button = el('button', 'comet-settings-model-list-toggle-button');
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

export class LlmApiKeySettingsSection {
  private props: LlmSettingsSectionProps;
  private readonly element = el('div', 'comet-settings-llm-settings');
  private readonly apiKeySection = createSettingsSection({
    sectionClassName: 'comet-settings-llm-api-section',
    panelClassName: 'comet-settings-llm-api-block-panel',
    listClassName: 'comet-settings-llm-api-list',
  });
  private readonly apiKeyControl = el('div', 'comet-settings-llm-api-key-control');

  constructor(props: LlmSettingsSectionProps) {
    this.props = props;
    this.element.append(this.apiKeySection.element);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: LlmSettingsSectionProps) {
    this.props = props;
    const provider = this.props.llmProviders[this.props.activeLlmProvider];
    this.apiKeyControl.replaceChildren(buildSecretInput({
      title: this.props.labels.settingsLlmApiKey,
      subtitle: getLlmProviderLabel(this.props.labels, this.props.activeLlmProvider),
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
      className: 'comet-settings-field comet-settings-llm-api-field',
    }));
    this.apiKeySection.list.replaceChildren(
      createSettingsRow({
        title: '',
        control: this.apiKeyControl,
        itemClassName: 'comet-settings-llm-api-key-item',
        titleClassName: 'comet-settings-block-list-item-title-empty',
        contentClassName: 'comet-settings-llm-api-key-content',
        controlClassName: 'comet-settings-llm-api-key-row-control',
      }),
    );
  }
}
