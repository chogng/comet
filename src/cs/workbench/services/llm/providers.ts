import type { LlmProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { LlmProviderDefinition } from 'cs/workbench/services/llm/types';

export const llmProviders: ReadonlyArray<LlmProviderDefinition> = [
  {
    id: 'glm',
    label: 'GLM',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: '',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    apiStyle: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
  {
    id: 'custom',
    label: 'Custom',
    apiStyle: 'openai-compatible',
    defaultBaseUrl: '',
  },
];

export const llmProviderIds: LlmProviderId[] = llmProviders.map((provider) => provider.id);
