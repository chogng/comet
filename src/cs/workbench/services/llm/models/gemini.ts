import type { LlmModelDefinition } from 'cs/workbench/services/llm/types';

const geminiDefaults = {
  provider: 'gemini',
  apiStyle: 'openai-compatible',
  enabled: true,
} as const;

const gemini: ReadonlyArray<LlmModelDefinition> = [
  {
    ...geminiDefaults,
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    description: 'Preview Gemini Pro model for multimodal chat and advanced reasoning.',
    supports_image_input: true,
    context_window_tokens: 1_000_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...geminiDefaults,
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    description: 'Faster preview Gemini model for chat with solid reasoning capability.',
    supports_image_input: true,
    context_window_tokens: 1_000_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...geminiDefaults,
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash-Lite Preview',
    description: 'Low-latency Gemini preview model for quick multimodal chat.',
    supports_image_input: true,
    context_window_tokens: 1_000_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
  {
    ...geminiDefaults,
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Strong Gemini model for multimodal chat and heavier reasoning workloads.',
    supports_image_input: true,
    context_window_tokens: 1_000_000,
    recommendedTasks: ['chat', 'reasoning'],
  },
  {
    ...geminiDefaults,
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Fast Gemini model for everyday multimodal chat.',
    supports_image_input: true,
    context_window_tokens: 1_000_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
  {
    ...geminiDefaults,
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    description: 'Lightweight Gemini model optimized for very fast multimodal chat.',
    supports_image_input: true,
    context_window_tokens: 1_000_000,
    latency_tier: 'fast',
    recommendedTasks: ['chat'],
  },
];

export default gemini;
