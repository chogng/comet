import type {
  LlmConnectionTestResult,
  LlmProviderId,
  TestLlmConnectionPayload as TestPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError, CancellationError, isAppError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import { defaultLlmProviderId } from 'cs/workbench/services/llm/config';
import { isLlmProviderId } from 'cs/workbench/services/llm/registry';

const llmTestTimeoutMs = 15000;
export type OpenAiCompatibleResponseMessageRole =
  | 'system'
  | 'user'
  | 'assistant';

export type OpenAiCompatibleResponseContentPart = {
  type: 'text';
  text: string;
};

export type OpenAiCompatibleResponseMessage = {
  role: OpenAiCompatibleResponseMessageRole;
  content: string | OpenAiCompatibleResponseContentPart[];
};

export type OpenAiCompatibleResponseFunctionCall = {
  type: 'function_call';
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

export type OpenAiCompatibleResponseFunctionCallOutput = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

export type OpenAiCompatibleResponseInputItem =
  | OpenAiCompatibleResponseMessage
  | OpenAiCompatibleResponseFunctionCall
  | OpenAiCompatibleResponseFunctionCallOutput;

export type OpenAiCompatibleResponseTool = {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type OpenAiCompatibleToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
      type: 'function';
      name: string;
    };

export type OpenAiCompatibleResponseRequest = {
  model: string;
  input: string | OpenAiCompatibleResponseInputItem[];
  instructions?: string;
  reasoning?: {
    effort?: string;
  };
  service_tier?: string;
  max_output_tokens?: number;
  temperature?: number;
  tools?: OpenAiCompatibleResponseTool[];
  tool_choice?: OpenAiCompatibleToolChoice;
  parallel_tool_calls?: boolean;
};

export type OpenAiCompatibleResponseOutputText = {
  type: 'output_text' | 'text';
  text?: unknown;
  value?: unknown;
};

export type OpenAiCompatibleResponseOutputMessage = {
  type: 'message';
  id?: string;
  role?: string;
  content?: OpenAiCompatibleResponseOutputText[];
};

export type OpenAiCompatibleResponseOutputItem =
  | OpenAiCompatibleResponseOutputMessage
  | OpenAiCompatibleResponseFunctionCall;

export type OpenAiCompatibleResponse = {
  id?: string;
  status?: string;
  output_text?: unknown;
  output?: OpenAiCompatibleResponseOutputItem[];
  usage?: Record<string, unknown>;
  service_tier?: string;
};

export type OpenAiCompatibleRequestContext = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type ResolvedLlmRequest = OpenAiCompatibleRequestContext & {
  provider: LlmProviderId;
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

function extractProviderErrorText(value: string): string {
  const errorText = cleanText(value);
  if (!errorText) {
    return '';
  }

  try {
    const payload = JSON.parse(errorText) as unknown;
    if (!payload || typeof payload !== 'object') {
      return errorText;
    }

    const record = payload as Record<string, unknown>;
    const nestedError = record.error;
    if (nestedError && typeof nestedError === 'object') {
      const nestedRecord = nestedError as Record<string, unknown>;
      const message = cleanText(nestedRecord.message);
      if (message) {
        return message;
      }
    }

    const message = cleanText(record.message);
    if (message) {
      return message;
    }

    const msg = cleanText(record.msg);
    if (msg) {
      return msg;
    }
  } catch {
    return errorText;
  }

  return errorText;
}

export async function requestOpenAiCompatibleResponse<
  TResponse = OpenAiCompatibleResponse,
>(
  request: OpenAiCompatibleRequestContext,
  payload: OpenAiCompatibleResponseRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternalSignal = () => {
    controller.abort();
  };
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (signal?.aborted) {
    abortFromExternalSignal();
  } else if (signal) {
    signal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  try {
    const response = await fetch(`${request.baseUrl}/responses`, {
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
        statusText: extractProviderErrorText(errorText) || response.statusText || 'Request failed',
      });
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted && !timedOut) {
        throw new CancellationError();
      }

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
    signal?.removeEventListener('abort', abortFromExternalSignal);
    clearTimeout(timeoutId);
  }
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

  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === 'string') {
    return cleanText(outputText);
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return '';
  }

  return cleanText(
    output
      .flatMap((item) => {
        if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') {
          return [];
        }

        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) {
          return [];
        }

        return content.map((part) => {
          if (!part || typeof part !== 'object') {
            return '';
          }

          const text = (part as { text?: unknown }).text;
          if (typeof text === 'string') {
            return text;
          }

          const value = (part as { value?: unknown }).value;
          return typeof value === 'string' ? value : '';
        });
      })
      .join('\n'),
  );
}

export async function testLlmConnection(
  payload: TestPayload = {},
): Promise<LlmConnectionTestResult> {
  const request = resolveLlmRequest(payload);
  const responseJson = await requestOpenAiCompatibleResponse(
    request,
    {
      model: request.model,
      reasoning: request.reasoningEffort ? { effort: request.reasoningEffort } : undefined,
      service_tier: request.serviceTier,
      input: [
        {
          role: 'user',
          content: 'Reply with OK only.',
        },
      ],
      max_output_tokens: 8,
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
