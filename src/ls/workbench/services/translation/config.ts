import type {
  TranslationProviderId,
  TranslationProviderSettings,
  TranslationSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { getTranslationProviderDefinition } from 'ls/workbench/services/translation/registry';

export const defaultTranslationProviderId: TranslationProviderId = 'deepl';

export const defaultTranslationProviderSettings: Record<TranslationProviderId, TranslationProviderSettings> = {
  deepl: {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('deepl').defaultBaseUrl,
  },
  glm: {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('glm').defaultBaseUrl,
  },
  'openai-compatible': {
    apiKey: '',
    baseUrl: getTranslationProviderDefinition('openai-compatible').defaultBaseUrl,
  },
};

function cloneProviderSettings(settings: TranslationProviderSettings): TranslationProviderSettings {
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
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
