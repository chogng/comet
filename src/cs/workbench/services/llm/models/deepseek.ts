import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

const deepseekDefaults = {
  provider: 'deepseek',
  apiStyle: 'openai-compatible',
  enabled: true,
} as const;

const deepseek: ReadonlyArray<LlmModelDefinition> = [
  {
    ...deepseekDefaults,
    id: 'deepseek-chat',
    label: 'DeepSeek V3.2',
    description: 'Standard DeepSeek V3.2 model for fast chat tasks.',
    context_window_tokens: 128_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
  {
    ...deepseekDefaults,
    id: 'deepseek-reasoner',
    label: 'DeepSeek V3.2 Thinking',
    description: 'DeepSeek V3.2 thinking variant for more deliberate reasoning.',
    supports_thinking: true,
    context_window_tokens: 128_000,
    recommendedTasks: ['reasoning'],
  },
];

export default deepseek;
