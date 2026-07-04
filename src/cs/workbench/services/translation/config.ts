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
  },
  glm: {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('glm').defaultBaseUrl,
    model: '',
  },
  'openai-compatible': {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('openai-compatible').defaultBaseUrl,
    model: 'gpt-5.4-mini',
  },
};

function cloneProviderSettings(settings: TranslationProviderSettings): TranslationProviderSettings {
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
  };
}

export function createDefaultTranslationSettings(): TranslationSettings {
  return {
    activeProvider: defaultTranslationProviderId,
    providers: {
      deepl: cloneProviderSettings(defaultTranslationProviderSettings.deepl),
      glm: cloneProviderSettings(defaultTranslationProviderSettings.glm),
      'openai-compatible': cloneProviderSettings(defaultTranslationProviderSettings['openai-compatible']),
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
    },
  };
}
