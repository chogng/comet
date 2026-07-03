import type { LlmProviderId } from 'ls/base/parts/sandbox/common/sandboxTypes';

export type LlmApiStyle = 'openai' | 'openai-compatible';
export type LlmTask = 'chat' | 'reasoning';
export type LlmModelLatencyTier = 'fast';
export type LlmServiceTier = 'auto' | 'default' | 'priority' | 'flex';
export type LlmReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'higher'
  | 'highest'
  | 'xhigh';

export type LlmProviderDefinition = {
  id: LlmProviderId;
  label: string;
  apiStyle: LlmApiStyle;
  defaultBaseUrl: string;
};

export type LlmModelDefinition = {
  id: string;
  label: string;
  snapshots?: readonly string[];
  description: string;
  release_date?: string;
  knowledge_cutoff_date?: string;
  supports_thinking?: boolean;
  supports_image_input?: boolean;
  supports_chat?: boolean;
  provider: LlmProviderId;
  apiStyle: LlmApiStyle;
  context_window_tokens?: number;
  default_input_token_limit?: number;
  input_token_limit?: number;
  max_output_tokens?: number;
  latency_tier?: LlmModelLatencyTier;
  supported_service_tiers?: readonly LlmServiceTier[];
  default_service_tier?: LlmServiceTier;
  reasoningEfforts?: readonly LlmReasoningEffort[];
  recommendedTasks: readonly LlmTask[];
  enabled: boolean;
};
