import type {
  LlmProviderSettings,
  TranslationProviderId,
  TranslationProviderSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { SettingsPartLabels } from 'ls/workbench/contrib/preferences/browser/settingsTypes';
import { ApiKeyWidget } from 'ls/workbench/contrib/preferences/browser/apiKeyWidget';
import {
  buildSettingsHint as buildHint,
  buildSettingsInput as buildInput,
  buildSettingsSelect as buildSelect,
  createSettingsElement as el,
  createSettingsText as text,
} from 'ls/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  getLlmModelOptionsForProvider,
  parseLlmModelOptionValue,
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
  onGlmApiKeyChange: (apiKey: string) => void;
  onGlmModelChange: (optionValue: string) => void;
  onTestTranslationConnection: () => void;
};

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
  private readonly glmApiKeyWidget = new ApiKeyWidget({
    title: '',
    subtitle: '',
    value: '',
    placeholder: '',
    show: false,
    focusKey: 'settings.translation.glm.apiKey',
    toggleKey: 'settings.translation.glm.apiKey.toggle',
    toggleLabelShow: '',
    toggleLabelHide: '',
    onToggle: () => this.props.onToggleShowApiKey(),
    onInput: (value) => this.props.onGlmApiKeyChange(value),
    className: 'settings-field settings-llm-api-field settings-translation-ai-field settings-llm-span-2',
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
    const field = el('div', 'settings-field');
    const title = el('span');
    title.textContent = this.props.labels.settingsTranslationTitle;
    const grid = el('div', 'settings-llm-grid');
    const providerField = el('div', 'settings-field');
    providerField.append(
      text(this.props.labels.settingsTranslationProvider),
      buildSelect([
        { value: 'glm', label: this.props.labels.settingsTranslationProviderGlm },
        { value: 'openai-compatible', label: this.props.labels.settingsTranslationProviderOpenAICompatible },
        { value: 'deepl', label: this.props.labels.settingsTranslationProviderDeepL },
      ], this.props.activeTranslationProvider, 'settings.translation.provider', (value) => this.props.onActiveTranslationProviderChange(value as TranslationProviderId), 'settings-llm-provider'),
    );
    grid.append(providerField);
    if (this.props.activeTranslationProvider === 'glm') {
      grid.append(this.renderGlmModelField());
      this.glmApiKeyWidget.setProps({
        title: this.props.labels.settingsLlmApiKey,
        subtitle: this.props.labels.settingsTranslationProviderGlm,
        value: this.props.llmProviders.glm.apiKey,
        placeholder: this.props.labels.settingsLlmApiKeyPlaceholder,
        show: this.props.showApiKey,
        focusKey: 'settings.translation.glm.apiKey',
        toggleKey: 'settings.translation.glm.apiKey.toggle',
        toggleLabelShow: this.props.labels.settingsTranslationShowApiKey,
        toggleLabelHide: this.props.labels.settingsTranslationHideApiKey,
        onToggle: () => this.props.onToggleShowApiKey(),
        onInput: (value) => this.props.onGlmApiKeyChange(value),
        className: 'settings-field settings-llm-api-field settings-translation-ai-field settings-llm-span-2',
      });
      grid.append(this.glmApiKeyWidget.getElement());
      field.append(title, buildHint(this.props.labels.settingsTranslationHint), grid);
      return field;
    }

    if (this.props.activeTranslationProvider === 'openai-compatible') {
      grid.append(this.renderOpenAICompatibleFields());
    }

    this.apiKeyWidget.setProps({
      title: this.props.labels.settingsLlmApiKey,
      subtitle: this.getTranslationProviderLabel(this.props.activeTranslationProvider),
      value: this.props.translationProviders[this.props.activeTranslationProvider].apiKey,
      placeholder: this.props.labels.settingsTranslationApiKeyPlaceholder,
      show: this.props.showApiKey,
      focusKey: 'settings.translation.apiKey',
      toggleKey: 'settings.translation.apiKey.toggle',
      toggleLabelShow: this.props.labels.settingsTranslationShowApiKey,
      toggleLabelHide: this.props.labels.settingsTranslationHideApiKey,
      onToggle: () => this.props.onToggleShowApiKey(),
      onInput: (value) => this.props.onTranslationProviderApiKeyChange(this.props.activeTranslationProvider, value),
    });
    grid.append(this.apiKeyWidget.getElement());
    field.append(title, buildHint(this.props.labels.settingsTranslationHint), grid);
    return field;
  }

  private renderOpenAICompatibleFields() {
    const provider = this.props.translationProviders['openai-compatible'];
    const fragment = document.createDocumentFragment();
    const baseUrlField = el('div', 'settings-field settings-llm-span-2');
    const baseUrlInput = buildInput({
      value: provider.baseUrl,
      className: 'settings-llm-provider',
      focusKey: 'settings.translation.openai.baseUrl',
      placeholder: 'https://api.openai.com/v1',
      onInput: (value) => this.props.onTranslationProviderBaseUrlChange('openai-compatible', value),
    });
    baseUrlField.append(text(this.props.labels.settingsTranslationBaseUrl), baseUrlInput.element);

    const modelField = el('div', 'settings-field settings-translation-ai-field settings-llm-span-2');
    modelField.append(
      text(this.props.labels.settingsLlmModel),
      buildHint('GPT-5.4 Mini (gpt-5.4-mini)'),
      buildHint(this.props.labels.settingsTranslationProviderOpenAICompatibleHint),
    );

    fragment.append(baseUrlField, modelField);
    return fragment;
  }

  private renderGlmModelField() {
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
    const field = el('div', 'settings-field settings-translation-ai-field');
    field.append(
      text(this.props.labels.settingsLlmModel),
      buildSelect(
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
      buildHint(this.props.labels.settingsTranslationProviderGlmHint),
    );
    return field;
  }

  private getTranslationProviderLabel(provider: TranslationProviderId) {
    switch (provider) {
      case 'glm':
        return this.props.labels.settingsTranslationProviderGlm;
      case 'openai-compatible':
        return this.props.labels.settingsTranslationProviderOpenAICompatible;
      case 'deepl':
        return this.props.labels.settingsTranslationProviderDeepL;
      default:
        return provider;
    }
  }
}
