import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

const kimiDefaults = {
  provider: 'kimi',
  enabled: true,
} as const;

const kimi: ReadonlyArray<LlmModelDefinition> = [
  {
    ...kimiDefaults,
    id: 'kimi-k2.5',
    label: 'Kimi K2.5',
    description: 'Balanced Kimi model for chat, multimodal use, and reasoning.',
    supports_image_input: true,
    context_window_tokens: 256_000,
    max_output_tokens: 32_768,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...kimiDefaults,
    id: 'kimi-k2',
    label: 'Kimi K2',
    description: 'General-purpose Kimi model for standard chat tasks.',
    context_window_tokens: 256_000,
    recommendedTasks: ['chat'],
  },
  {
    ...kimiDefaults,
    id: 'kimi-k2-thinking',
    label: 'Kimi K2 Thinking',
    description: 'Kimi thinking model for deeper reasoning tasks.',
    supports_thinking: true,
    context_window_tokens: 256_000,
    recommendedTasks: ['reasoning'],
  },
  {
    ...kimiDefaults,
    id: 'kimi-k2-turbo-preview',
    label: 'Kimi K2 Turbo Preview',
    description: 'Fast Kimi preview model for low-latency chat.',
    context_window_tokens: 256_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
  {
    ...kimiDefaults,
    id: 'kimi-k2-thinking-turbo',
    label: 'Kimi K2 Thinking Turbo',
    description: 'Fast Kimi thinking model for responsive reasoning workflows.',
    supports_thinking: true,
    context_window_tokens: 256_000,
    latency_tier: 'fast',
    recommendedTasks: ['reasoning'],
  },
];

export default kimi;
