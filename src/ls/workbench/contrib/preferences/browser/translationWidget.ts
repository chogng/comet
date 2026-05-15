import type {
  LlmProviderSettings,
  TranslationProviderId,
  TranslationProviderSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import { ApiKeyWidget } from 'ls/workbench/contrib/preferences/browser/apiKeyWidget';
import {
  createSettingsSection,
  createSettingsRow,
} from 'ls/workbench/contrib/preferences/browser/section';
import {
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  createSettingsElement as el,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  getLlmModelOptionsForProvider,
  parseLlmModelOptionValue,
  getLlmModelByIdForProvider,
} from 'ls/workbench/services/llm/registry';

export type TranslationWidgetProps = {
  labels: SettingsPartLabels;
  activeTranslationProvider: TranslationProviderId;
  translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  llmProviders: Record<'glm', LlmProviderSettings>;
  isSettingsSaving: boolean;
  isTestingTranslationConnection: boolean;
  showApiKey: boolean;
  onToggleShowApiKey: () => void;
  onActiveTranslationProviderChange: (provider: TranslationProviderId) => void;
  onTranslationProviderApiKeyChange: (provider: TranslationProviderId, apiKey: string) => void;
  onTranslationProviderBaseUrlChange: (provider: TranslationProviderId, baseUrl: string) => void;
  onTranslationProviderModelChange: (provider: TranslationProviderId, model: string) => void;
  onGlmModelChange: (optionValue: string) => void;
  onTestTranslationConnection: () => void;
};

const openAITranslationModelIds = ['gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini'] as const;

export class TranslationWidget {
  private props: TranslationWidgetProps;
  private readonly element = el('div', 'settings-field');
  private readonly apiKeyWidget = new ApiKeyWidget({
    title: '',
    subtitle: '',
    value: '',
    placeholder: '',
    show: false,
    focusKey: 'settings.translation.apiKey',
    toggleKey: 'settings.translation.apiKey.toggle',
    toggleLabelShow: '',
    toggleLabelHide: '',
    onToggle: () => this.props.onToggleShowApiKey(),
    onInput: (value) => this.props.onTranslationProviderApiKeyChange(this.props.activeTranslationProvider, value),
  });

  constructor(props: TranslationWidgetProps) {
    this.props = props;
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: TranslationWidgetProps) {
    this.props = props;
    this.element.replaceChildren(this.render());
  }

  private render() {
    const section = createSettingsSection({
      title: this.props.labels.settingsTranslationTitle,
      sectionClassName: 'settings-translation-section',
      panelClassName: 'settings-translation-panel',
      listClassName: 'settings-translation-list',
    });
    const providerSelect = buildSelect([
        { value: 'glm', label: this.props.labels.settingsTranslationProviderGlm },
        { value: 'openai-compatible', label: this.props.labels.settingsTranslationProviderOpenAICompatible },
        { value: 'deepl', label: this.props.labels.settingsTranslationProviderDeepL },
      ],
      this.props.activeTranslationProvider,
      'settings.translation.provider',
      (value) => this.props.onActiveTranslationProviderChange(value as TranslationProviderId),
      'settings-llm-provider',
    );
    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsTranslationProvider,
        control: providerSelect,
        itemClassName: 'settings-translation-provider-item',
        controlClassName: 'settings-translation-provider-control',
      }),
    );
    if (this.props.activeTranslationProvider === 'glm') {
      section.list.append(this.renderGlmModelRow());
      this.renderApiKeyField();
      section.list.append(this.renderApiKeyRow(this.apiKeyWidget.getElement()));
      return section.element;
    }

    if (this.props.activeTranslationProvider === 'openai-compatible') {
      section.list.append(...this.renderOpenAICompatibleRows());
    }

    this.renderApiKeyField();
    section.list.append(this.renderApiKeyRow(this.apiKeyWidget.getElement()));
    return section.element;
  }

  private renderApiKeyField() {
    const provider = this.props.activeTranslationProvider;
    this.apiKeyWidget.setProps({
      title: this.props.labels.settingsLlmApiKey,
      value: this.props.translationProviders[provider].apiKey,
      placeholder: 'Paste the API key',
      show: this.props.showApiKey,
      focusKey: `settings.translation.${provider}.apiKey`,
      toggleKey: `settings.translation.${provider}.apiKey.toggle`,
      toggleLabelShow: this.props.labels.settingsTranslationShowApiKey,
      toggleLabelHide: this.props.labels.settingsTranslationHideApiKey,
      onToggle: () => this.props.onToggleShowApiKey(),
      onInput: (value) => this.props.onTranslationProviderApiKeyChange(provider, value),
      className: 'settings-field settings-llm-api-field settings-translation-ai-field settings-llm-span-2',
      hideToggleWhenEmpty: true,
    });
  }

  private renderOpenAICompatibleRows() {
    const provider = this.props.translationProviders['openai-compatible'];
    const baseUrlInput = buildInput({
      value: provider.baseUrl,
      className: 'settings-input-control settings-translation-base-url-input',
      focusKey: 'settings.translation.openai.baseUrl',
      placeholder: 'https://api.openai.com/v1',
      onInput: (value) => this.props.onTranslationProviderBaseUrlChange('openai-compatible', value),
    }).element;

    return [
      createSettingsRow({
        title: this.props.labels.settingsTranslationBaseUrl,
        control: baseUrlInput,
        itemClassName: 'settings-translation-base-url-item',
        controlClassName: 'settings-translation-base-url-control',
      }),
      this.renderOpenAICompatibleModelRow(),
    ];
  }

  private renderGlmModelRow() {
    const provider = this.props.llmProviders.glm;
    const options = getLlmModelOptionsForProvider('glm', provider.enabledModelOptions, { enabledOnly: true });
    const selectedOption = provider.selectedModelOption
      ? parseLlmModelOptionValue(provider.selectedModelOption)
      : null;
    const selectedValue =
      options.find((option) => option.value === provider.selectedModelOption)?.value ??
      options.find((option) => option.modelId === selectedOption?.modelId)?.value ??
      options[0]?.value ??
      '';
    return createSettingsRow({
      title: this.props.labels.settingsLlmModel,
      control: buildSelect(
        options.map((option) => ({
          value: option.value,
          label: option.label,
          title: option.title,
        })),
        selectedValue,
        'settings.translation.glm.model',
        (value) => this.props.onGlmModelChange(value),
        'settings-llm-provider',
      ),
      itemClassName: 'settings-translation-model-item',
      controlClassName: 'settings-translation-model-control',
    });
  }

  private renderApiKeyRow(apiKeyElement: HTMLElement) {
    const rowContent = el('div', 'settings-translation-api-key-control');
    rowContent.append(apiKeyElement);
    return createSettingsRow({
      title: '',
      control: rowContent,
      itemClassName: 'settings-translation-api-key-item',
      titleClassName: 'settings-block-list-item-title-empty',
      contentClassName: 'settings-translation-api-key-content',
      controlClassName: 'settings-translation-api-key-row-control',
    });
  }

  private renderOpenAICompatibleModelRow() {
    const provider = this.props.translationProviders['openai-compatible'];
    const options = openAITranslationModelIds.map((modelId) => {
      const model = getLlmModelByIdForProvider('openai', modelId);
      const label = model?.label ?? modelId;
      return {
        value: modelId,
        label,
        title: label,
      };
    });
    const selectedValue = options.some((option) => option.value === provider.model)
      ? provider.model
      : 'gpt-5.4-mini';

    return createSettingsRow({
      title: this.props.labels.settingsLlmModel,
      control: buildSelect(
        options,
        selectedValue,
        'settings.translation.openai.model',
        (value) => this.props.onTranslationProviderModelChange('openai-compatible', value),
        'settings-llm-provider',
      ),
      itemClassName: 'settings-translation-model-item',
      controlClassName: 'settings-translation-model-control',
    });
  }
}
