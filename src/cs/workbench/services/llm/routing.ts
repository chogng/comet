import type {
  LlmProviderId,
  LlmSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  getEnabledLlmModelOptionValuesForProvider,
  getLlmModelByIdForProvider,
  getPreferredReasoningEffort,
  getRecommendedModelForTask,
  parseLlmModelOptionValue,
} from 'cs/workbench/services/llm/registry';
import type { LlmReasoningEffort } from 'cs/workbench/services/llm/registry';
import type { LlmServiceTier } from 'cs/workbench/services/llm/registry';
import type { LlmTask } from 'cs/workbench/services/llm/registry';

export type ResolvedLlmRoute = {
  provider: LlmProviderId;
  model: string;
  reasoningEffort?: LlmReasoningEffort;
  serviceTier?: LlmServiceTier;
  baseUrl: string;
  apiKey: string;
};

export function resolveLlmRoute(settings: LlmSettings, task: LlmTask): ResolvedLlmRoute {
  const provider = settings.activeProvider;
  const providerSettings = settings.providers[provider];
  const enabledOptionValues = getEnabledLlmModelOptionValuesForProvider(
    provider,
    providerSettings.enabledModelOptions,
  );
  const enabledOptionValueSet = new Set(enabledOptionValues);
  const recommendedModelId = getRecommendedModelForTask(provider, task)?.id;
  const selectedOptionValue = providerSettings.selectedModelOption;
  const selectedOption =
    (selectedOptionValue && enabledOptionValueSet.has(selectedOptionValue)
      ? parseLlmModelOptionValue(selectedOptionValue)
      : null) ??
    (recommendedModelId
      ? enabledOptionValues
          .map((value) => parseLlmModelOptionValue(value))
          .find((option) => option?.modelId === recommendedModelId) ?? null
      : null) ??
    (enabledOptionValues[0] ? parseLlmModelOptionValue(enabledOptionValues[0]) : null);
  const model = selectedOption?.modelId ?? '';
  const modelDefinition = getLlmModelByIdForProvider(provider, model);
  const reasoningEffort = modelDefinition
    ? getPreferredReasoningEffort(modelDefinition, selectedOption?.reasoningEffort)
      : null;

  return {
    provider,
    model,
    reasoningEffort: reasoningEffort ?? undefined,
    serviceTier: selectedOption?.serviceTier,
    baseUrl: providerSettings.baseUrl,
    apiKey: providerSettings.apiKey,
  };
}
