import type { TranslationProviderId } from 'ls/base/parts/sandbox/common/sandboxTypes';

export type TranslationApiStyle = 'deepl-compatible' | 'llm-compatible' | 'openai-compatible';

export type TranslationProviderDefinition = {
  id: TranslationProviderId;
  label: string;
  apiStyle: TranslationApiStyle;
  defaultBaseUrl: string;
};

export const translationProviders: ReadonlyArray<TranslationProviderDefinition> = [
  {
    id: 'deepl',
    label: 'DeepL',
    apiStyle: 'deepl-compatible',
    defaultBaseUrl: 'https://api-free.deepl.com',
  },
  {
    id: 'glm',
    label: 'GLM',
    apiStyle: 'llm-compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
];

export const translationProviderIds: TranslationProviderId[] = translationProviders.map((provider) => provider.id);

export function isTranslationProviderId(value: unknown): value is TranslationProviderId {
  return typeof value === 'string' && translationProviderIds.includes(value as TranslationProviderId);
}

export function getTranslationProviderDefinition(providerId: TranslationProviderId): TranslationProviderDefinition {
  const provider = translationProviders.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown translation provider: ${providerId}`);
  }

  return provider;
}
