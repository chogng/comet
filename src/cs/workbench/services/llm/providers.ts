import type { LlmProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { LlmProviderDefinition } from 'cs/workbench/services/llm/types';

export const llmProviders: ReadonlyArray<LlmProviderDefinition> = [
  {
    id: 'glm',
    label: 'GLM',
    protocol: 'openai-chat-completions',
    maximumOutputTokensField: 'max_tokens',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    protocol: 'openai-chat-completions',
    maximumOutputTokensField: 'max_completion_tokens',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-chat-completions',
    maximumOutputTokensField: 'max_tokens',
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'openai-chat-completions',
    maximumOutputTokensField: 'max_tokens',
    defaultBaseUrl: '',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    protocol: 'openai-chat-completions',
    maximumOutputTokensField: 'max_tokens',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
  {
    id: 'custom',
    label: 'Custom',
    protocol: 'openai-chat-completions',
    maximumOutputTokensField: 'max_tokens',
    defaultBaseUrl: '',
  },
];

export const llmProviderIds: LlmProviderId[] = llmProviders.map((provider) => provider.id);
