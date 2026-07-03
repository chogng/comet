import type { LlmProviderId } from 'ls/base/parts/sandbox/common/sandboxTypes';
import { llmModels } from 'ls/workbench/services/llm/models';
import { llmProviderIds, llmProviders } from 'ls/workbench/services/llm/providers';
export { getLlmModelBadges, type LlmModelBadge } from 'ls/workbench/services/llm/badges';
import type {
  LlmModelDefinition,
  LlmReasoningEffort,
  LlmProviderDefinition,
  LlmServiceTier,
  LlmTask,
} from 'ls/workbench/services/llm/types';

export type {
  LlmApiStyle,
  LlmModelDefinition,
  LlmModelLatencyTier,
  LlmProviderDefinition,
  LlmReasoningEffort,
  LlmServiceTier,
  LlmTask,
} from 'ls/workbench/services/llm/types';

export { llmModels, llmProviderIds, llmProviders };

export type LlmModelOption = {
  value: string;
  providerId: LlmProviderId;
  modelId: string;
  reasoningEffort?: LlmReasoningEffort;
  serviceTier?: LlmServiceTier;
  label: string;
  title: string;
  model: LlmModelDefinition;
};

type ParsedLlmModelOptionValue = {
  providerId: LlmProviderId;
  modelId: string;
  reasoningEffort?: LlmReasoningEffort;
  serviceTier?: LlmServiceTier;
};

const DEFAULT_REASONING_EFFORT: ReadonlyArray<LlmReasoningEffort> = [
  'medium',
  'low',
  'high',
  'xhigh',
  'none',
  'higher',
  'highest',
];

const LLM_REASONING_EFFORT_SET = new Set<LlmReasoningEffort>([
  'none',
  'low',
  'medium',
  'high',
  'higher',
  'highest',
  'xhigh',
]);

const LLM_SERVICE_TIER_SET = new Set<LlmServiceTier>(['auto', 'default', 'priority', 'flex']);

function formatReasoningEffortLabel(reasoningEffort: LlmReasoningEffort) {
  return reasoningEffort.charAt(0).toUpperCase() + reasoningEffort.slice(1);
}

function formatServiceTierLabel(serviceTier: LlmServiceTier) {
  return serviceTier === 'priority'
    ? 'Fast'
    : serviceTier.charAt(0).toUpperCase() + serviceTier.slice(1);
}

function getOptionReasoningEfforts(model: LlmModelDefinition): ReadonlyArray<LlmReasoningEffort | undefined> {
  return !model.reasoningEfforts || model.reasoningEfforts.length === 0
    ? [undefined]
    : model.reasoningEfforts;
}

function getOptionServiceTiers(model: LlmModelDefinition): ReadonlyArray<LlmServiceTier | undefined> {
  return model.supported_service_tiers?.includes('priority')
    ? [undefined, 'priority']
    : [undefined];
}

function formatLlmModelOptionLabel(
  model: LlmModelDefinition,
  reasoningEffort?: LlmReasoningEffort,
  serviceTier?: LlmServiceTier,
) {
  const baseLabel =
    reasoningEffort === undefined || reasoningEffort === 'none'
      ? model.label
      : `${model.label} ${formatReasoningEffortLabel(reasoningEffort)}`;

  return serviceTier ? `${baseLabel} ${formatServiceTierLabel(serviceTier)}` : baseLabel;
}

function buildLlmModelOptions(providerId: LlmProviderId): LlmModelOption[] {
  return getLlmModelsForProvider(providerId).flatMap((model) => {
    return getOptionReasoningEfforts(model).flatMap((reasoningEffort) =>
      getOptionServiceTiers(model).map((serviceTier) => {
        const label = formatLlmModelOptionLabel(model, reasoningEffort, serviceTier);

        return {
          value: serializeLlmModelOptionValue(providerId, model.id, reasoningEffort, serviceTier),
          providerId,
          modelId: model.id,
          reasoningEffort,
          serviceTier,
          label,
          title: label,
          model,
        };
      }),
    );
  });
}

function parseOptionalReasoningEffort(value: string | undefined): LlmReasoningEffort | undefined {
  return value && LLM_REASONING_EFFORT_SET.has(value as LlmReasoningEffort)
    ? value as LlmReasoningEffort
    : undefined;
}

function parseOptionalServiceTier(
  primaryValue: string | undefined,
  fallbackValue?: string,
): LlmServiceTier | undefined {
  if (primaryValue && LLM_SERVICE_TIER_SET.has(primaryValue as LlmServiceTier)) {
    return primaryValue as LlmServiceTier;
  }

  if (fallbackValue && LLM_SERVICE_TIER_SET.has(fallbackValue as LlmServiceTier)) {
    return fallbackValue as LlmServiceTier;
  }

  return undefined;
}

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string' && llmProviderIds.includes(value as LlmProviderId);
}

export function getLlmProviderDefinition(providerId: LlmProviderId): LlmProviderDefinition {
  const provider = llmProviders.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${providerId}`);
  }

  return provider;
}

export function getLlmModelsForProvider(providerId: LlmProviderId): LlmModelDefinition[] {
  return llmModels.filter((model) => model.provider === providerId && model.enabled);
}

export function getLlmModelByIdForProvider(
  providerId: LlmProviderId,
  modelId: string,
): LlmModelDefinition | null {
  return getLlmModelsForProvider(providerId).find((model) => model.id === modelId) ?? null;
}

export function serializeLlmModelOptionValue(
  providerId: LlmProviderId,
  modelId: string,
  reasoningEffort?: LlmReasoningEffort,
  serviceTier?: LlmServiceTier,
): string {
  if (reasoningEffort && serviceTier) {
    return `${providerId}:${modelId}:${reasoningEffort}:${serviceTier}`;
  }

  if (reasoningEffort) {
    return `${providerId}:${modelId}:${reasoningEffort}`;
  }

  if (serviceTier) {
    return `${providerId}:${modelId}:${serviceTier}`;
  }

  return `${providerId}:${modelId}`;
}

export function parseLlmModelOptionValue(value: string): ParsedLlmModelOptionValue | null {
  const [providerId, modelId, thirdPart, fourthPart] = value.split(':');
  if (!isLlmProviderId(providerId) || !modelId) {
    return null;
  }

  return {
    providerId,
    modelId,
    reasoningEffort: parseOptionalReasoningEffort(thirdPart),
    serviceTier: parseOptionalServiceTier(fourthPart, thirdPart),
  };
}

export function getPreferredReasoningEffort(
  model: LlmModelDefinition,
  requested?: LlmReasoningEffort,
): LlmReasoningEffort | undefined {
  const supported = model.reasoningEfforts;
  if (!supported || supported.length === 0) {
    return undefined;
  }

  if (requested && supported.includes(requested)) {
    return requested;
  }

  for (const candidate of DEFAULT_REASONING_EFFORT) {
    if (supported.includes(candidate)) {
      return candidate;
    }
  }

  return supported[0];
}

export function getLlmModelOptionsForProvider(
  providerId: LlmProviderId,
  enabledModels?: readonly string[],
  options: { enabledOnly?: boolean } = {},
): LlmModelOption[] {
  const allOptions = buildLlmModelOptions(providerId);
  if (!options.enabledOnly) {
    return allOptions;
  }

  const enabledOptionValueSet = new Set(
    getEnabledLlmModelOptionValuesForProvider(providerId, enabledModels),
  );
  return allOptions.filter((option) => enabledOptionValueSet.has(option.value));
}

export function getEnabledLlmModelOptionValuesForProvider(
  providerId: LlmProviderId,
  enabledModels?: readonly string[],
): string[] {
  const allOptions = buildLlmModelOptions(providerId);
  if (allOptions.length === 0) {
    return [];
  }

  if (enabledModels === undefined) {
    return allOptions.map((option) => option.value);
  }

  const enabledModelSet = new Set(enabledModels);
  return allOptions
    .filter((option) => enabledModelSet.has(option.value) || enabledModelSet.has(option.modelId))
    .map((option) => option.value);
}

export function getEnabledLlmModelIdsForProvider(
  providerId: LlmProviderId,
  enabledModels?: readonly string[],
): string[] {
  const enabledModelIds = getEnabledLlmModelOptionValuesForProvider(providerId, enabledModels)
    .map((value) => parseLlmModelOptionValue(value))
    .filter((parsed): parsed is ParsedLlmModelOptionValue => Boolean(parsed))
    .map((parsed) => parsed.modelId);

  return [...new Set(enabledModelIds)];
}

export function getEnabledLlmModelsForProvider(
  providerId: LlmProviderId,
  enabledModels?: readonly string[],
): LlmModelDefinition[] {
  const enabledModelIds = new Set(
    getEnabledLlmModelIdsForProvider(providerId, enabledModels),
  );
  return getLlmModelsForProvider(providerId).filter((model) =>
    enabledModelIds.has(model.id),
  );
}

export function isLlmModelIdForProvider(providerId: LlmProviderId, modelId: string): boolean {
  return getLlmModelsForProvider(providerId).some((model) => model.id === modelId);
}

export function getDefaultModelForProvider(providerId: LlmProviderId): string {
  return getLlmModelsForProvider(providerId)[0]?.id ?? '';
}

export function getRecommendedModelForTask(
  providerId: LlmProviderId,
  task: LlmTask,
): LlmModelDefinition | null {
  const exactMatch =
    getLlmModelsForProvider(providerId).find((model) => model.recommendedTasks.includes(task)) ?? null;
  return exactMatch;
}

export function getDefaultInputTokenLimit(model: LlmModelDefinition): number | undefined {
  return model.default_input_token_limit ?? model.input_token_limit;
}

export function hasLlmMaxContextWindow(model: LlmModelDefinition): boolean {
  const defaultInputTokenLimit = getDefaultInputTokenLimit(model);
  return Boolean(
    model.input_token_limit &&
    defaultInputTokenLimit &&
    model.input_token_limit > defaultInputTokenLimit,
  );
}

export function getEffectiveInputTokenLimit(
  model: LlmModelDefinition,
  useMaxContextWindow: boolean,
): number | undefined {
  if (useMaxContextWindow && model.input_token_limit) {
    return model.input_token_limit;
  }

  return getDefaultInputTokenLimit(model);
}

export function isLlmFastModel(model: LlmModelDefinition): boolean {
  return model.latency_tier === 'fast';
}

export function supportsLlmReasoning(model: LlmModelDefinition): boolean {
  return Boolean(model.reasoningEfforts?.length) || model.recommendedTasks.includes('reasoning');
}
