import type { RagProviderId, RagProviderSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  NumberStepper,
  numberStepperDecrementAriaLabel,
  numberStepperIncrementAriaLabel,
} from 'cs/base/browser/ui/numberStepper/numberStepper';
import type { LocaleMessages } from 'language/locales';
import {
  createSettingsSection,
  createSettingsRow,
} from 'cs/workbench/contrib/preferences/browser/section';
import {
  buildSettingsHint as buildHint,
  buildSettingsInput as buildInput,
  buildSettingsSecretInput as buildSecretInput,
  createSettingsElement as el,
  setSettingsFocusKey,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';
import {
	maxRagRetrievalCandidateCount,
	minRagRetrievalCandidateCount,
	minRagRetrievalTopK,
} from 'cs/workbench/services/rag/config';

export type RagSettingsSectionProps = {
  labels: LocaleMessages;
  activeRagProvider: RagProviderId;
  ragProviders: Record<RagProviderId, RagProviderSettings>;
  retrievalCandidateCount: number;
  retrievalTopK: number;
  isSettingsSaving: boolean;
  isTestingRagConnection: boolean;
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

function renderRagNumberField(props: RagSettingsSectionProps, label: string, value: number, focusKey: string, min: string, max: string, onInput: (value: string) => void) {
  const wrap = el('div', 'comet-settings-limit-input-wrap');
  const stepper = new NumberStepper({
    value,
    className: 'comet-settings-number-stepper comet-settings-limit-input',
    min,
    max,
    inputMode: 'numeric',
    step: '1',
    decrementAriaLabel: numberStepperDecrementAriaLabel,
    incrementAriaLabel: numberStepperIncrementAriaLabel,
    onDidChange: onInput,
    disabled: props.isSettingsSaving,
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

function renderRagTextField(label: string, value: string, focusKey: string, onInput: (value: string) => void, className = 'comet-settings-field') {
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

export function renderRagSettingsSection(props: RagSettingsSectionProps) {
  const section = createSettingsSection({
    title: props.labels.settingsRagTitle,
    description: props.labels.settingsRagHint,
    sectionClassName: 'comet-settings-rag-section',
    panelClassName: 'comet-settings-rag-panel',
    listClassName: 'comet-settings-rag-list',
  });
  const provider = props.ragProviders[props.activeRagProvider];
  const providerControl = el('div', 'comet-settings-rag-provider-control-stack');
  providerControl.append(
    buildInput({
      value: props.labels.settingsRagProviderMoark,
      className: 'comet-settings-input-control comet-settings-rag-text-input',
      focusKey: 'settings.rag.provider',
      readOnly: true,
    }).element,
    buildHint(props.labels.settingsRagProviderHint),
  );
  section.list.append(
    createSettingsRow({
      title: props.labels.settingsRagProvider,
      control: providerControl,
      itemClassName: 'comet-settings-rag-provider-item',
      controlClassName: 'comet-settings-rag-provider-row-control',
    }),
	renderRagNumberField(props, props.labels.settingsRagCandidateCount, props.retrievalCandidateCount, 'settings.rag.candidates', String(minRagRetrievalCandidateCount), String(maxRagRetrievalCandidateCount), props.onRetrievalCandidateCountChange),
	renderRagNumberField(props, props.labels.settingsRagTopK, props.retrievalTopK, 'settings.rag.topK', String(minRagRetrievalTopK), String(props.retrievalCandidateCount), props.onRetrievalTopKChange),
    renderRagTextField(props.labels.settingsRagBaseUrl, provider.baseUrl, 'settings.rag.baseUrl', value => props.onRagProviderBaseUrlChange(props.activeRagProvider, value), 'comet-settings-field comet-settings-llm-span-2'),
    renderRagTextField(props.labels.settingsRagEmbeddingModel, provider.embeddingModel, 'settings.rag.embeddingModel', value => props.onRagProviderEmbeddingModelChange(props.activeRagProvider, value)),
    renderRagTextField(props.labels.settingsRagRerankerModel, provider.rerankerModel, 'settings.rag.rerankerModel', value => props.onRagProviderRerankerModelChange(props.activeRagProvider, value)),
    renderRagTextField(props.labels.settingsRagEmbeddingPath, provider.embeddingPath, 'settings.rag.embeddingPath', value => props.onRagProviderEmbeddingPathChange(props.activeRagProvider, value)),
    renderRagTextField(props.labels.settingsRagRerankPath, provider.rerankPath, 'settings.rag.rerankPath', value => props.onRagProviderRerankPathChange(props.activeRagProvider, value)),
  );

  const apiKeyInput = buildSecretInput({
    title: props.labels.settingsRagApiKey,
    subtitle: props.labels.settingsRagProviderMoark,
    value: '',
    placeholder: props.labels.settingsRagApiKeyPlaceholder,
    configured: Boolean(provider.apiKey),
    focusKey: 'settings.rag.apiKey',
    configuredLabel: props.labels.settingsApiKeyConfigured,
    notConfiguredLabel: props.labels.settingsApiKeyNotConfigured,
    setLabel: props.labels.settingsApiKeySet,
    updateLabel: props.labels.settingsApiKeyUpdate,
    clearLabel: props.labels.settingsApiKeyClear,
    disabled: props.isSettingsSaving,
    onSubmit: value => props.onRagProviderApiKeyChange(props.activeRagProvider, value),
    onClear: () => props.onRagProviderApiKeyChange(props.activeRagProvider, ''),
  });
  const apiKeyControl = el('div', 'comet-settings-rag-api-key-control');
  apiKeyControl.append(apiKeyInput);
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
