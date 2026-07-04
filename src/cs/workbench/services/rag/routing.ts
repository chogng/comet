import type {
  RagProviderId,
  RagSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';

export type ResolvedRagRoute = {
  provider: RagProviderId;
  apiKey: string;
  baseUrl: string;
  embeddingModel: string;
  rerankerModel: string;
  embeddingPath: string;
  rerankPath: string;
  retrievalCandidateCount: number;
  retrievalTopK: number;
};

export function resolveRagRoute(settings: RagSettings): ResolvedRagRoute {
  const provider = settings.activeProvider;
  const providerSettings = settings.providers[provider];

  return {
    provider,
    apiKey: providerSettings.apiKey,
    baseUrl: providerSettings.baseUrl,
    embeddingModel: providerSettings.embeddingModel,
    rerankerModel: providerSettings.rerankerModel,
    embeddingPath: providerSettings.embeddingPath,
    rerankPath: providerSettings.rerankPath,
    retrievalCandidateCount: settings.retrievalCandidateCount,
    retrievalTopK: settings.retrievalTopK,
  };
}
