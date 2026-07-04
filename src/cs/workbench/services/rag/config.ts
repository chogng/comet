import type {
  RagProviderId,
  RagProviderSettings,
  RagSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { getRagProviderDefinition } from 'cs/workbench/services/rag/registry';

export const defaultRagProviderId: RagProviderId = 'moark';
export const defaultRagRetrievalCandidateCount = 10;
export const defaultRagRetrievalTopK = 4;

export const defaultRagProviderSettings: Record<RagProviderId, RagProviderSettings> = {
  moark: {
    apiKey: '',
    baseUrl: getRagProviderDefinition('moark').defaultBaseUrl,
    embeddingModel: 'Qwen3-Embedding-8B',
    rerankerModel: 'Qwen3-Reranker-8B',
    embeddingPath: getRagProviderDefinition('moark').defaultEmbeddingPath,
    rerankPath: getRagProviderDefinition('moark').defaultRerankPath,
  },
};

function cloneProviderSettings(settings: RagProviderSettings): RagProviderSettings {
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    embeddingModel: settings.embeddingModel,
    rerankerModel: settings.rerankerModel,
    embeddingPath: settings.embeddingPath,
    rerankPath: settings.rerankPath,
  };
}

export function createDefaultRagSettings(): RagSettings {
  return {
    enabled: true,
    activeProvider: defaultRagProviderId,
    providers: {
      moark: cloneProviderSettings(defaultRagProviderSettings.moark),
    },
    retrievalCandidateCount: defaultRagRetrievalCandidateCount,
    retrievalTopK: defaultRagRetrievalTopK,
  };
}

export function cloneRagSettings(settings: RagSettings): RagSettings {
  return {
    enabled: settings.enabled,
    activeProvider: settings.activeProvider,
    providers: {
      moark: cloneProviderSettings(settings.providers.moark),
    },
    retrievalCandidateCount: settings.retrievalCandidateCount,
    retrievalTopK: settings.retrievalTopK,
  };
}
