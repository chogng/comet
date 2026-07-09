import type { RagProviderId, RagProviderSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  NumberStepper,
  numberStepperDecrementAriaLabel,
  numberStepperIncrementAriaLabel,
} from 'cs/base/browser/ui/numberStepper/numberStepper';
import type { SettingsPartLabels } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import { ApiKeyWidget } from 'cs/workbench/contrib/preferences/browser/apiKeyWidget';
import {
  createSettingsSection,
  createSettingsRow,
} from 'cs/workbench/contrib/preferences/browser/section';
import {
  buildSettingsHint as buildHint,
  buildSettingsInput as buildInput,
  createSettingsElement as el,
  setSettingsFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';

export type RagSettingsSectionProps = {
  labels: SettingsPartLabels;
  activeRagProvider: RagProviderId;
  ragProviders: Record<RagProviderId, RagProviderSettings>;
  retrievalCandidateCount: number;
  retrievalTopK: number;
  isSettingsSaving: boolean;
  isTestingRagConnection: boolean;
  showApiKey: boolean;
  onToggleShowApiKey: () => void;
  onRagProviderApiKeyChange: (provider: RagProviderId, apiKey: string) => void;
  onRagProviderBaseUrlChange: (provider: RagProviderId, baseUrl: string) => void;
  onRagProviderEmbeddingModelChange: (provider: RagProviderId, model: string) => void;
  onRagProviderRerankerModelChange: (provider: RagProviderId, model: string) => void;
  onRagProviderEmbeddingPathChange: (provider: RagProviderId, path: string) => void;
  onRagProviderRerankPathChange: (provider: RagProviderId, path: string) => void;
  onRetrievalCandidateCountChange: (value: string) => void;
  onRetrievalTopKChange: (value: string) => void;
  onTestRagConnection: () => void;
};

export class RagSettingsSection {
  private props: RagSettingsSectionProps;
  private readonly element = el('div', 'comet-settings-field');
  private readonly apiKeyWidget = new ApiKeyWidget({
    title: '',
    subtitle: '',
    value: '',
    placeholder: '',
    show: false,
    focusKey: 'settings.rag.apiKey',
    toggleKey: 'settings.rag.apiKey.toggle',
    toggleLabelShow: '',
    toggleLabelHide: '',
    onToggle: () => this.props.onToggleShowApiKey(),
    onInput: (value) => this.props.onRagProviderApiKeyChange(this.props.activeRagProvider, value),
  });

  constructor(props: RagSettingsSectionProps) {
    this.props = props;
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: RagSettingsSectionProps) {
    this.props = props;
    this.element.replaceChildren(this.render());
  }

  private renderNumberField(label: string, value: number, focusKey: string, min: string, max: string, onInput: (value: string) => void) {
    const wrap = el('div', 'comet-settings-limit-input-wrap');
    const stepper = new NumberStepper({
      value,
      className: 'comet-settings-limit-input',
      min,
      max,
      inputMode: 'numeric',
      step: '1',
      decrementAriaLabel: numberStepperDecrementAriaLabel,
      incrementAriaLabel: numberStepperIncrementAriaLabel,
      onDidChange: onInput,
      disabled: this.props.isSettingsSaving,
    });
    setSettingsFocusKey(stepper.inputElement, focusKey);
    wrap.append(stepper.element);
    return createSettingsRow({
      title: label,
      control: wrap,
      itemClassName: 'comet-settings-rag-number-item',
      controlClassName: 'comet-settings-rag-number-control',
    });
  }

  private renderTextField(label: string, value: string, focusKey: string, onInput: (value: string) => void, className = 'comet-settings-field') {
    return createSettingsRow({
      title: label,
      control: buildInput({
      value,
      className: 'comet-settings-input-control comet-settings-rag-text-input',
      focusKey,
      onInput,
      }).element,
      itemClassName: className.includes('comet-settings-llm-span-2')
        ? 'comet-settings-rag-text-item comet-settings-rag-wide-item'
        : 'comet-settings-rag-text-item',
      controlClassName: 'comet-settings-rag-text-control',
    });
  }

  private render() {
    const section = createSettingsSection({
      title: this.props.labels.settingsRagTitle,
      description: this.props.labels.settingsRagHint,
      sectionClassName: 'comet-settings-rag-section',
      panelClassName: 'comet-settings-rag-panel',
      listClassName: 'comet-settings-rag-list',
    });
    const provider = this.props.ragProviders[this.props.activeRagProvider];
    const providerControl = el('div', 'comet-settings-rag-provider-control-stack');
    providerControl.append(
      buildInput({
        value: this.props.labels.settingsRagProviderMoark,
        className: 'comet-settings-input-control comet-settings-rag-text-input',
        focusKey: 'settings.rag.provider',
        readOnly: true,
      }).element,
      buildHint(this.props.labels.settingsRagProviderHint),
    );
    section.list.append(
      createSettingsRow({
        title: this.props.labels.settingsRagProvider,
        control: providerControl,
        itemClassName: 'comet-settings-rag-provider-item',
        controlClassName: 'comet-settings-rag-provider-row-control',
      }),
      this.renderNumberField(this.props.labels.settingsRagCandidateCount, this.props.retrievalCandidateCount, 'settings.rag.candidates', '3', '20', this.props.onRetrievalCandidateCountChange),
      this.renderNumberField(this.props.labels.settingsRagTopK, this.props.retrievalTopK, 'settings.rag.topK', '1', String(this.props.retrievalCandidateCount), this.props.onRetrievalTopKChange),
      this.renderTextField(this.props.labels.settingsRagBaseUrl, provider.baseUrl, 'settings.rag.baseUrl', (value) => this.props.onRagProviderBaseUrlChange(this.props.activeRagProvider, value), 'comet-settings-field comet-settings-llm-span-2'),
      this.renderTextField(this.props.labels.settingsRagEmbeddingModel, provider.embeddingModel, 'settings.rag.embeddingModel', (value) => this.props.onRagProviderEmbeddingModelChange(this.props.activeRagProvider, value)),
      this.renderTextField(this.props.labels.settingsRagRerankerModel, provider.rerankerModel, 'settings.rag.rerankerModel', (value) => this.props.onRagProviderRerankerModelChange(this.props.activeRagProvider, value)),
      this.renderTextField(this.props.labels.settingsRagEmbeddingPath, provider.embeddingPath, 'settings.rag.embeddingPath', (value) => this.props.onRagProviderEmbeddingPathChange(this.props.activeRagProvider, value)),
      this.renderTextField(this.props.labels.settingsRagRerankPath, provider.rerankPath, 'settings.rag.rerankPath', (value) => this.props.onRagProviderRerankPathChange(this.props.activeRagProvider, value)),
    );
    this.apiKeyWidget.setProps({
      title: this.props.labels.settingsLlmApiKey,
      subtitle: this.props.labels.settingsRagProviderMoark,
      value: provider.apiKey,
      placeholder: this.props.labels.settingsRagApiKeyPlaceholder,
      show: this.props.showApiKey,
      focusKey: 'settings.rag.apiKey',
      toggleKey: 'settings.rag.apiKey.toggle',
      toggleLabelShow: this.props.labels.settingsRagShowApiKey,
      toggleLabelHide: this.props.labels.settingsRagHideApiKey,
      onToggle: () => this.props.onToggleShowApiKey(),
      onInput: (value) => this.props.onRagProviderApiKeyChange(this.props.activeRagProvider, value),
    });
    const apiKeyControl = el('div', 'comet-settings-rag-api-key-control');
    apiKeyControl.append(this.apiKeyWidget.getElement());
    section.list.append(createSettingsRow({
      title: '',
      control: apiKeyControl,
      itemClassName: 'comet-settings-rag-api-key-item',
      titleClassName: 'comet-settings-block-list-item-title-empty',
      contentClassName: 'comet-settings-rag-api-key-content',
      controlClassName: 'comet-settings-rag-api-key-row-control',
    }));
    return section.element;
  }
}
