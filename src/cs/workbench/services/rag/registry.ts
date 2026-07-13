import type { RagProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';

export type RagApiStyle = 'openai-compatible+rerank';

export type RagProviderDefinition = {
  id: RagProviderId;
  label: string;
  apiStyle: RagApiStyle;
  defaultBaseUrl: string;
  defaultEmbeddingPath: string;
  defaultRerankPath: string;
};

export const ragProviders: ReadonlyArray<RagProviderDefinition> = [
  {
    id: 'moark',
    label: 'Moark',
    apiStyle: 'openai-compatible+rerank',
    defaultBaseUrl: 'https://api.moark.ai/v1',
    defaultEmbeddingPath: '/embeddings',
    defaultRerankPath: '/rerank',
  },
];

export const ragProviderIds: RagProviderId[] = ragProviders.map((provider) => provider.id);

export function isRagProviderId(value: unknown): value is RagProviderId {
  return typeof value === 'string' && ragProviderIds.includes(value as RagProviderId);
}

export function getRagProviderDefinition(providerId: RagProviderId): RagProviderDefinition {
  const provider = ragProviders.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown RAG provider: ${providerId}`);
  }

  return provider;
}
