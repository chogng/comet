import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

const anthropicDefaults = {
  provider: 'anthropic',
  enabled: true,
} as const;

const anthropic: ReadonlyArray<LlmModelDefinition> = [
  {
    ...anthropicDefaults,
    id: 'claude-opus-4.6',
    label: 'Opus 4.6',
    description: 'Anthropic flagship model for high-quality chat, multimodal work, and reasoning.',
    supports_image_input: true,
    context_window_tokens: 200_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...anthropicDefaults,
    id: 'claude-opus-4.5',
    label: 'Opus 4.5',
    description: 'High-capability Anthropic model for complex chat and reasoning tasks.',
    supports_image_input: true,
    context_window_tokens: 200_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...anthropicDefaults,
    id: 'claude-sonnet-4.6',
    label: 'Sonnet 4.6',
    description: 'Balanced Anthropic model for general chat, multimodal input, and reasoning.',
    supports_image_input: true,
    context_window_tokens: 200_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...anthropicDefaults,
    id: 'claude-sonnet-4.5',
    label: 'Sonnet 4.5',
    description: 'General-purpose Anthropic model for chat and multimodal tasks.',
    supports_image_input: true,
    context_window_tokens: 200_000,
    recommendedTasks: ['chat'],
  },
  {
    ...anthropicDefaults,
    id: 'claude-haiku-4.5',
    label: 'Haiku 4.5',
    description: 'Fast Anthropic model for lighter chat and multimodal workflows.',
    supports_image_input: true,
    context_window_tokens: 200_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
];

export default anthropic;
