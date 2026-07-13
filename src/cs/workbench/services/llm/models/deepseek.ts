import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

const deepseekDefaults = {
  provider: 'deepseek',
  enabled: true,
} as const;

const deepseek: ReadonlyArray<LlmModelDefinition> = [
  {
    ...deepseekDefaults,
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'DeepSeek V4 Flash for long-context chat, reasoning, and agent tasks.',
    supports_thinking: true,
    context_window_tokens: 1_000_000,
    max_output_tokens: 384_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat', 'reasoning'],
  },
];

export default deepseek;
