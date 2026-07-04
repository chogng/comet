import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

const glmDefaults = {
  provider: 'glm',
  apiStyle: 'openai-compatible',
  enabled: true,
} as const;

const glm: ReadonlyArray<LlmModelDefinition> = [
  {
    ...glmDefaults,
    id: 'glm-4.7-flash',
    label: 'GLM-4.7-Flash',
    description: 'Fast GLM model for lightweight chat tasks.',
    context_window_tokens: 200_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
  {
    ...glmDefaults,
    id: 'glm-4.6',
    label: 'GLM-4.6',
    description: 'Balanced GLM model for chat and stronger reasoning.',
    context_window_tokens: 200_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...glmDefaults,
    id: 'glm-4.5-air',
    label: 'GLM-4.5-Air',
    description: 'Lightweight GLM model tuned for faster chat responses.',
    context_window_tokens: 128_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
];

export default glm;
