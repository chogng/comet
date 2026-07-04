import type {
  TranslationProviderId,
  TranslationProviderSettings,
  TranslationSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { getTranslationProviderDefinition } from 'cs/workbench/services/translation/registry';

export const defaultTranslationProviderId: TranslationProviderId = 'deepl';

export const defaultTranslationProviderSettings: Record<TranslationProviderId, TranslationProviderSettings> = {
  deepl: {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('deepl').defaultBaseUrl,
    model: '',
    models: [],
  },
  glm: {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('glm').defaultBaseUrl,
    model: '',
    models: [],
  },
  'openai-compatible': {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('openai-compatible').defaultBaseUrl,
    model: 'gpt-5.5',
    models: [],
  },
  custom: {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('custom').defaultBaseUrl,
    model: '',
    models: [],
  },
};

function cloneProviderModels(models: readonly string[] | undefined): string[] {
  if (!models) {
    return [];
  }

  const normalizedModels = models
    .map((model) => (typeof model === 'string' ? model.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(normalizedModels));
}

function cloneProviderSettings(settings: TranslationProviderSettings): TranslationProviderSettings {
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    models: cloneProviderModels(settings.models),
  };
}

export function createDefaultTranslationSettings(): TranslationSettings {
  return {
    activeProvider: defaultTranslationProviderId,
    providers: {
      deepl: cloneProviderSettings(defaultTranslationProviderSettings.deepl),
      glm: cloneProviderSettings(defaultTranslationProviderSettings.glm),
      'openai-compatible': cloneProviderSettings(defaultTranslationProviderSettings['openai-compatible']),
      custom: cloneProviderSettings(defaultTranslationProviderSettings.custom),
    },
  };
}

export function cloneTranslationSettings(settings: TranslationSettings): TranslationSettings {
  return {
    activeProvider: settings.activeProvider,
    providers: {
      deepl: cloneProviderSettings(settings.providers.deepl ?? defaultTranslationProviderSettings.deepl),
      glm: cloneProviderSettings(settings.providers.glm ?? defaultTranslationProviderSettings.glm),
      'openai-compatible': cloneProviderSettings(
        settings.providers['openai-compatible'] ?? defaultTranslationProviderSettings['openai-compatible'],
      ),
      custom: cloneProviderSettings(settings.providers.custom ?? defaultTranslationProviderSettings.custom),
    },
  };
}
