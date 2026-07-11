import type {
  LlmProviderSettings,
  TranslationProviderId,
  TranslationProviderSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import {
  createSettingsSection,
  createSettingsRow,
} from 'cs/workbench/contrib/preferences/browser/section';
import {
  buildSettingsInput as buildInput,
  buildSettingsButton as buildButton,
  buildSettingsSecretInput as buildSecretInput,
  buildSettingsSelect as buildSelect,
  createSettingsElement as el,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
  getLlmModelOptionsForProvider,
  parseLlmModelOptionValue,
  getLlmModelByIdForProvider,
} from 'cs/workbench/services/llm/registry';

export type TranslationSettingsSectionProps = {
  labels: SettingsPartLabels;
  contextViewProvider: IContextViewProvider;
  activeTranslationProvider: TranslationProviderId;
  translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  llmProviders: Record<'glm', LlmProviderSettings>;
  isSettingsSaving: boolean;
  isTestingTranslationConnection: boolean;
  isLoadingTranslationModels: boolean;
  onActiveTranslationProviderChange: (provider: TranslationProviderId) => void;
  onTranslationProviderApiKeyChange: (provider: TranslationProviderId, apiKey: string) => void;
  onTranslationProviderBaseUrlChange: (provider: TranslationProviderId, baseUrl: string) => void;
  onTranslationProviderModelChange: (provider: TranslationProviderId, model: string) => void;
  onGlmModelChange: (optionValue: string) => void;
  onFetchTranslationModels: () => void;
  onTestTranslationConnection: () => void;
};

const openAITranslationModelIds = ['gpt-5.5', 'gpt-5-codex', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2'] as const;

function createCustomTranslationModelOptions(models: readonly string[]) {
  return models.map((model) => ({
    value: model,
    label: model,
    title: model,
  }));
}

export class TranslationSettingsSection {
  private props: TranslationSettingsSectionProps;
  private readonly element = el('div', 'comet-settings-field');

  constructor(props: TranslationSettingsSectionProps) {
    this.props = props;
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: TranslationSettingsSectionProps) {
    this.props = props;
    this.element.replaceChildren(this.render());
  }

  private render() {
    const section = createSettingsSection({
      title: this.props.labels.settingsTranslationTitle,
      sectionClassName: 'comet-settings-translation-section',
      panelClassName: 'comet-settings-translation-panel',
      listClassName: 'comet-settings-translation-list',
    });
    const providerSelect = buildSelect([
        { value: 'glm', label: this.props.labels.settingsTranslationProviderGlm },
        { value: 'openai-compatible', label: this.props.labels.settingsTranslationProviderOpenAICompatible },
        { value: 'custom', label: this.props.labels.settingsTranslationProviderCustom },
        { value: 'deepl', label: this.props.labels.settingsTranslationProviderDeepL },
      ],
      this.props.activeTranslationProvider,
      'settings.translation.provider',
      (value) => this.props.onActiveTranslationProviderChange(value as TranslationProviderId),
      this.props.contextViewProvider,
      'comet-settings-llm-provider',
    );
    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsTranslationProvider,
        control: providerSelect,
        itemClassName: 'comet-settings-translation-provider-item',
        controlClassName: 'comet-settings-translation-provider-control',
      }),
    );
    if (this.props.activeTranslationProvider === 'glm') {
      section.list.append(this.renderGlmModelRow());
      section.list.append(this.renderApiKeyRow(this.renderApiKeyField()));
      section.list.append(this.renderTestConnectionRow());
      return section.element;
    }

    if (this.props.activeTranslationProvider === 'openai-compatible') {
      section.list.append(...this.renderOpenAICompatibleRows());
    }

    if (this.props.activeTranslationProvider === 'custom') {
      section.list.append(...this.renderCustomRows());
    }

    section.list.append(this.renderApiKeyRow(this.renderApiKeyField()));
    section.list.append(this.renderTestConnectionRow());
    return section.element;
  }

  private renderApiKeyField() {
    const provider = this.props.activeTranslationProvider;
    return buildSecretInput({
      title: this.props.labels.settingsTranslationApiKey,
      value: '',
      placeholder: this.props.labels.settingsTranslationApiKeyPlaceholder,
      configured: Boolean(this.props.translationProviders[provider].apiKey),
      focusKey: `settings.translation.${provider}.apiKey`,
      configuredLabel: this.props.labels.settingsApiKeyConfigured,
      notConfiguredLabel: this.props.labels.settingsApiKeyNotConfigured,
      setLabel: this.props.labels.settingsApiKeySet,
      updateLabel: this.props.labels.settingsApiKeyUpdate,
      clearLabel: this.props.labels.settingsApiKeyClear,
      disabled: this.props.isSettingsSaving,
      onSubmit: (value) => this.props.onTranslationProviderApiKeyChange(provider, value),
      onClear: () => this.props.onTranslationProviderApiKeyChange(provider, ''),
      className: 'comet-settings-field comet-settings-llm-api-field comet-settings-translation-ai-field comet-settings-llm-span-2',
    });
  }

  private renderOpenAICompatibleRows() {
    const provider = this.props.translationProviders['openai-compatible'];
    const baseUrlInput = buildInput({
      value: provider.baseUrl,
      className: 'comet-settings-input-control comet-settings-translation-base-url-input',
      focusKey: 'settings.translation.openai.baseUrl',
      placeholder: 'https://api.openai.com/v1',
      onInput: (value) => this.props.onTranslationProviderBaseUrlChange('openai-compatible', value),
    }).element;

    return [
      createSettingsRow({
        title: this.props.labels.settingsTranslationBaseUrl,
        control: baseUrlInput,
        itemClassName: 'comet-settings-translation-base-url-item',
        controlClassName: 'comet-settings-translation-base-url-control',
      }),
      this.renderOpenAICompatibleModelRow(),
    ];
  }

  private renderCustomRows() {
    const provider = this.props.translationProviders.custom;
    const baseUrlInput = buildInput({
      value: provider.baseUrl,
      className: 'comet-settings-input-control comet-settings-translation-base-url-input',
      focusKey: 'settings.translation.custom.baseUrl',
      onInput: (value) => this.props.onTranslationProviderBaseUrlChange('custom', value),
    }).element;
    const modelControl = el('div', 'comet-settings-translation-model-action-control');
    if (provider.models.length > 0) {
      modelControl.append(buildSelect(
        createCustomTranslationModelOptions(provider.models),
        provider.model,
        'settings.translation.custom.model',
        (value) => this.props.onTranslationProviderModelChange('custom', value),
        this.props.contextViewProvider,
        'comet-settings-translation-model-input',
      ));
    } else {
      modelControl.append(buildInput({
        value: provider.model,
        className: 'comet-settings-input-control comet-settings-translation-model-input',
        focusKey: 'settings.translation.custom.model',
        onInput: (value) => this.props.onTranslationProviderModelChange('custom', value),
      }).element);
    }
    modelControl.append(buildButton({
      label: this.props.labels.settingsTranslationFetchModels,
      focusKey: 'settings.translation.custom.fetchModels',
      title: this.props.labels.settingsTranslationFetchModels,
      disabled: this.props.isSettingsSaving || this.props.isLoadingTranslationModels,
      onClick: this.props.onFetchTranslationModels,
    }));

    return [
      createSettingsRow({
        title: this.props.labels.settingsTranslationBaseUrl,
        control: baseUrlInput,
        itemClassName: 'comet-settings-translation-base-url-item',
        controlClassName: 'comet-settings-translation-base-url-control',
      }),
      createSettingsRow({
        title: this.props.labels.settingsLlmModel,
        control: modelControl,
        itemClassName: 'comet-settings-translation-model-item',
        controlClassName: 'comet-settings-translation-model-control comet-settings-translation-model-action-row-control',
      }),
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
        this.props.contextViewProvider,
        'comet-settings-llm-provider',
      ),
      itemClassName: 'comet-settings-translation-model-item',
      controlClassName: 'comet-settings-translation-model-control',
    });
  }

  private renderApiKeyRow(apiKeyElement: HTMLElement) {
    const rowContent = el('div', 'comet-settings-translation-api-key-control');
    rowContent.append(apiKeyElement);
    return createSettingsRow({
      title: '',
      control: rowContent,
      itemClassName: 'comet-settings-translation-api-key-item',
      titleClassName: 'comet-settings-block-list-item-title-empty',
      contentClassName: 'comet-settings-translation-api-key-content',
      controlClassName: 'comet-settings-translation-api-key-row-control',
    });
  }

  private renderTestConnectionRow() {
    const rowContent = el('div', 'comet-settings-translation-test-control');
    rowContent.append(buildButton({
      label: this.props.labels.settingsTranslationTestConnection,
      focusKey: 'settings.translation.test',
      title: this.props.labels.settingsTranslationTestConnection,
      disabled: this.props.isSettingsSaving || this.props.isTestingTranslationConnection,
      onClick: this.props.onTestTranslationConnection,
    }));

    return createSettingsRow({
      title: '',
      control: rowContent,
      itemClassName: 'comet-settings-translation-test-item',
      titleClassName: 'comet-settings-block-list-item-title-empty',
      contentClassName: 'comet-settings-translation-test-content',
      controlClassName: 'comet-settings-translation-test-row-control',
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
      : 'gpt-5.5';

    return createSettingsRow({
      title: this.props.labels.settingsLlmModel,
      control: buildSelect(
        options,
        selectedValue,
        'settings.translation.openai.model',
        (value) => this.props.onTranslationProviderModelChange('openai-compatible', value),
        this.props.contextViewProvider,
        'comet-settings-llm-provider',
      ),
      itemClassName: 'comet-settings-translation-model-item',
      controlClassName: 'comet-settings-translation-model-control',
    });
  }
}
