import type {
  LlmProviderId,
  LlmProviderSettings,
  LlmSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import {
  getEnabledLlmModelOptionValuesForProvider,
  getLlmProviderDefinition,
  parseLlmModelOptionValue,
  serializeLlmModelOptionValue,
} from 'ls/workbench/services/llm/registry';

export const defaultLlmProviderId: LlmProviderId = 'glm';

const defaultEnabledLlmModelOptions: Record<LlmProviderId, string[]> = {
  glm: [serializeLlmModelOptionValue('glm', 'glm-4.7-flash')],
  kimi: [serializeLlmModelOptionValue('kimi', 'kimi-k2.5')],
  deepseek: [serializeLlmModelOptionValue('deepseek', 'deepseek-chat')],
  anthropic: [],
  openai: [
    serializeLlmModelOptionValue('openai', 'gpt-5.3-codex', 'medium'),
    serializeLlmModelOptionValue('openai', 'gpt-5.4', 'medium'),
  ],
  gemini: [],
  custom: [],
};

export const defaultLlmProviderSettings: Record<LlmProviderId, LlmProviderSettings> = {
  glm: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('glm').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.glm[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.glm,
  },
  kimi: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('kimi').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.kimi[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.kimi,
  },
  deepseek: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('deepseek').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.deepseek[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.deepseek,
  },
  anthropic: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('anthropic').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.anthropic[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.anthropic,
  },
  openai: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('openai').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.openai[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.openai,
  },
  gemini: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('gemini').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.gemini[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.gemini,
  },
  custom: {
    apiKey: '',
    baseUrl: getLlmProviderDefinition('custom').defaultBaseUrl,
    selectedModelOption: defaultEnabledLlmModelOptions.custom[0] ?? '',
    enabledModelOptions: defaultEnabledLlmModelOptions.custom,
  },
};

function cloneProviderSettings(
  provider: LlmProviderId,
  settings: LlmProviderSettings,
): LlmProviderSettings {
  const enabledModelOptions = getEnabledLlmModelOptionValuesForProvider(
    provider,
    settings.enabledModelOptions,
  );
  const selectedOptionValue = settings.selectedModelOption;
  const activeOption =
    (selectedOptionValue && enabledModelOptions.includes(selectedOptionValue)
      ? parseLlmModelOptionValue(selectedOptionValue)
      : null) ??
    (enabledModelOptions[0] ? parseLlmModelOptionValue(enabledModelOptions[0]) : null);
  const selectedModelOption = activeOption
    ? serializeLlmModelOptionValue(
        provider,
        activeOption.modelId,
        activeOption.reasoningEffort,
        activeOption.serviceTier,
      )
    : '';

  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    selectedModelOption,
    enabledModelOptions,
    useMaxContextWindow: settings.useMaxContextWindow ?? false,
  };
}

export function createDefaultLlmSettings(): LlmSettings {
  return {
    activeProvider: defaultLlmProviderId,
    providers: {
      glm: cloneProviderSettings('glm', defaultLlmProviderSettings.glm),
      kimi: cloneProviderSettings('kimi', defaultLlmProviderSettings.kimi),
      deepseek: cloneProviderSettings('deepseek', defaultLlmProviderSettings.deepseek),
      anthropic: cloneProviderSettings('anthropic', defaultLlmProviderSettings.anthropic),
      openai: cloneProviderSettings('openai', defaultLlmProviderSettings.openai),
      gemini: cloneProviderSettings('gemini', defaultLlmProviderSettings.gemini),
      custom: cloneProviderSettings('custom', defaultLlmProviderSettings.custom),
    },
  };
}

export function cloneLlmSettings(settings: LlmSettings): LlmSettings {
  return {
    activeProvider: settings.activeProvider,
    providers: {
      glm: cloneProviderSettings('glm', settings.providers.glm),
      kimi: cloneProviderSettings('kimi', settings.providers.kimi),
      deepseek: cloneProviderSettings('deepseek', settings.providers.deepseek),
      anthropic: cloneProviderSettings('anthropic', settings.providers.anthropic),
      openai: cloneProviderSettings('openai', settings.providers.openai),
      gemini: cloneProviderSettings('gemini', settings.providers.gemini),
      custom: cloneProviderSettings('custom', settings.providers.custom),
    },
  };
}

export function getLlmProviderDefaults(provider: LlmProviderId): LlmProviderSettings {
  return cloneProviderSettings(provider, defaultLlmProviderSettings[provider]);
}
