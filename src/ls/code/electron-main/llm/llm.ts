import type {
  LlmConnectionTestResult,
  LlmProviderId,
  TestLlmConnectionPayload as TestPayload,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { appError, isAppError } from 'ls/base/common/errors';
import { cleanText } from 'ls/base/common/strings';
import { defaultLlmProviderId } from 'ls/workbench/services/llm/config';
import { isLlmProviderId } from 'ls/workbench/services/llm/registry';

const llmTestTimeoutMs = 15000;
export type OpenAiCompatibleMessageRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool';

export type OpenAiCompatibleChatCompletionContentPart = {
  type: 'text';
  text: string;
};

export type OpenAiCompatibleChatCompletionToolCall = {
  id?: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenAiCompatibleChatCompletionMessage = {
  role: OpenAiCompatibleMessageRole;
  content: string | OpenAiCompatibleChatCompletionContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: OpenAiCompatibleChatCompletionToolCall[];
};

export type OpenAiCompatibleChatCompletionTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type OpenAiCompatibleToolChoice =
  | 'auto'
  | 'none'
  | {
      type: 'function';
      function: {
        name: string;
      };
    };

export type OpenAiCompatibleChatCompletionRequest = {
  model: string;
  messages: OpenAiCompatibleChatCompletionMessage[];
  reasoning_effort?: string;
  service_tier?: string;
  max_tokens?: number;
  temperature?: number;
  tools?: OpenAiCompatibleChatCompletionTool[];
  tool_choice?: OpenAiCompatibleToolChoice;
};

export type OpenAiCompatibleChatCompletionResponse = {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: OpenAiCompatibleChatCompletionMessage;
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown>;
};

export type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatCompletionMessage[];
  reasoning_effort?: string;
  service_tier?: string;
  max_tokens: number;
  temperature: number;
};

export type ResolvedLlmRequest = {
  provider: LlmProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: TestPayload['reasoningEffort'];
  serviceTier?: TestPayload['serviceTier'];
};

function normalizeProvider(value: unknown): LlmProviderId {
  if (!isLlmProviderId(value)) {
    throw appError('LLM_PROVIDER_UNSUPPORTED', {
      provider: typeof value === 'string' ? value : '',
    });
  }

  return value;
}

function normalizeBaseUrl(value: unknown): string {
  const baseUrl = cleanText(value);
  if (!baseUrl) {
    throw appError('LLM_BASE_URL_INVALID', { value: '' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw appError('LLM_BASE_URL_INVALID', { value: baseUrl });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw appError('LLM_BASE_URL_INVALID', { value: baseUrl });
  }

  return parsedUrl.toString().replace(/\/+$/, '');
}

function normalizeApiKey(value: unknown): string {
  const apiKey = cleanText(value);
  if (!apiKey) {
    throw appError('LLM_API_KEY_MISSING');
  }

  return apiKey;
}

function normalizeModel(value: unknown): string {
  const model = cleanText(value);
  if (!model) {
    throw appError('LLM_MODEL_MISSING');
  }

  return model;
}

function resolveLlmRequest(payload: TestPayload = {}): ResolvedLlmRequest {
  const provider = normalizeProvider(payload.provider ?? defaultLlmProviderId);
  const apiKey = normalizeApiKey(payload.apiKey);
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const model = normalizeModel(payload.model);

  return {
    provider,
    apiKey,
    baseUrl,
    model,
    reasoningEffort: payload.reasoningEffort,
    serviceTier: payload.serviceTier,
  };
}

export async function requestOpenAiCompatibleChatCompletion<
  TResponse = OpenAiCompatibleChatCompletionResponse,
>(
  request: ResolvedLlmRequest,
  payload: OpenAiCompatibleChatCompletionRequest,
  timeoutMs: number,
): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${request.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = cleanText(await response.text());
      throw appError('LLM_CONNECTION_FAILED', {
        provider: request.provider,
        status: response.status,
        statusText: response.statusText || errorText || 'Request failed',
      });
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw appError('LLM_CONNECTION_FAILED', {
        provider: request.provider,
        status: 'TIMEOUT',
        statusText: `Connection timed out after ${timeoutMs}ms`,
      });
    }

    if (isAppError(error)) {
      throw error;
    }

    throw appError('LLM_CONNECTION_FAILED', {
      provider: request.provider,
      status: 'NETWORK_ERROR',
      statusText: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestChatCompletion(
  request: ResolvedLlmRequest,
  payload: ChatCompletionRequest,
  timeoutMs: number,
): Promise<unknown> {
  return requestOpenAiCompatibleChatCompletion(request, payload, timeoutMs);
}

function extractResponsePreview(payload: unknown): string {
  const content = extractResponseContent(payload);
  if (!content) {
    return 'Connected';
  }

  const cleaned = content.replace(/\s+/g, ' ');
  return cleaned || 'Connected';
}

export function extractTextContent(value: unknown): string {
  if (typeof value === 'string') {
    return cleanText(value);
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return cleanText(
    value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        return typeof (item as { text?: unknown }).text === 'string'
          ? (item as { text: string }).text
          : '';
      })
      .join('\n'),
  );
}

export function extractResponseContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return extractTextContent(content);
}

export async function testLlmConnection(
  payload: TestPayload = {},
): Promise<LlmConnectionTestResult> {
  const request = resolveLlmRequest(payload);
  const responseJson = await requestChatCompletion(
    request,
    {
      model: request.model,
      reasoning_effort: request.reasoningEffort,
      service_tier: request.serviceTier,
      messages: [
        {
          role: 'user',
          content: 'Reply with OK only.',
        },
      ],
      max_tokens: 8,
      temperature: 0,
    },
    llmTestTimeoutMs,
  );

  return {
    provider: request.provider,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    baseUrl: request.baseUrl,
    responsePreview: extractResponsePreview(responseJson),
  };
}

export function resolveLlmRequestFromPayload(payload: TestPayload = {}): ResolvedLlmRequest {
  return resolveLlmRequest(payload);
}
