import type {
  ListTranslationModelsPayload,
  TestTranslationConnectionPayload,
  TranslationConnectionTestResult,
  TranslationModelsResult,
  TranslationProviderId,
  TranslationSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError, CancellationError, isAppError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import { defaultTranslationProviderId } from 'cs/workbench/services/translation/config';
import { isTranslationProviderId } from 'cs/workbench/services/translation/registry';
import {
  extractResponseContent,
  requestOpenAiCompatibleResponse,
} from 'cs/code/electron-main/llm/llm';

// Dedicated translation API implementations live here.
// This module should stay focused on provider-specific behavior such as:
// 1. request shaping
// 2. response parsing
// 3. connection testing
// It should not own cross-provider routing, batching, or cache orchestration.
const translationTimeoutMs = 20000;
const openAICompatibleTranslationModel = 'gpt-5.5';

type ResolvedTranslationRequest = {
  provider: TranslationProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ResolvedTranslationEndpoint = {
  provider: TranslationProviderId;
  apiKey: string;
  baseUrl: string;
};

type DeepLTranslationResponse = {
  translations?: Array<{
    text?: unknown;
  }>;
};

type OpenAICompatibleTranslationResponse = {
  translations?: Array<{
    index?: unknown;
    text?: unknown;
  }>;
};

type OpenAICompatibleModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

function normalizeProvider(value: unknown): TranslationProviderId {
  if (!isTranslationProviderId(value)) {
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

function resolveOpenAICompatibleTranslationEndpoint(
  payload: ListTranslationModelsPayload = {},
): ResolvedTranslationEndpoint {
  const provider = normalizeProvider(payload.provider ?? defaultTranslationProviderId);
  if (provider !== 'custom' && provider !== 'openai-compatible') {
    throw appError('LLM_PROVIDER_UNSUPPORTED', { provider });
  }

  return {
    provider,
    apiKey: normalizeApiKey(payload.apiKey),
    baseUrl: normalizeBaseUrl(payload.baseUrl),
  };
}

function resolveTranslationRequest(payload: TestTranslationConnectionPayload = {}): ResolvedTranslationRequest {
  const provider = normalizeProvider(payload.provider ?? defaultTranslationProviderId);
  return {
    provider,
    apiKey: normalizeApiKey(payload.apiKey),
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    model:
      provider === 'openai-compatible'
        ? cleanText(payload.model) || openAICompatibleTranslationModel
        : provider === 'custom'
          ? normalizeModel(payload.model)
        : 'translate-to-zh-hans',
  };
}

function resolveTranslationRequestFromSettings(settings: TranslationSettings): ResolvedTranslationRequest {
  const provider = settings.activeProvider;
  const providerSettings = settings.providers[provider];

  return resolveTranslationRequest({
    provider,
    apiKey: providerSettings.apiKey,
    baseUrl: providerSettings.baseUrl,
    model: providerSettings.model,
  });
}

async function requestDeepLTranslations(
  request: ResolvedTranslationRequest,
  texts: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternalSignal = () => controller.abort();
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
    const payload = new URLSearchParams();
    payload.set('target_lang', 'ZH-HANS');
    payload.set('preserve_formatting', '1');

    texts.forEach((text) => {
      payload.append('text', text);
    });

    const response = await fetch(`${request.baseUrl}/v2/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${request.apiKey}`,
      },
      body: payload.toString(),
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

    const payloadJson = (await response.json()) as DeepLTranslationResponse;
    const translations = Array.isArray(payloadJson.translations) ? payloadJson.translations : [];
    const resolvedTexts = translations
      .map((item) => (typeof item?.text === 'string' ? cleanText(item.text) : ''))
      .filter(Boolean);

    if (resolvedTexts.length !== texts.length) {
      throw appError('LLM_CONNECTION_FAILED', {
        provider: request.provider,
        status: 'INVALID_RESPONSE',
        statusText: `Expected ${texts.length} translations but received ${resolvedTexts.length}`,
      });
    }

    return resolvedTexts;
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

async function requestOpenAICompatibleModels(
  request: ResolvedTranslationEndpoint,
  timeoutMs: number,
): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${request.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
      },
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

    const payloadJson = (await response.json()) as OpenAICompatibleModelsResponse;
    const models = Array.isArray(payloadJson.data)
      ? payloadJson.data
          .map((item) => (typeof item?.id === 'string' ? cleanText(item.id) : ''))
          .filter(Boolean)
      : [];
    const uniqueModels = Array.from(new Set(models));

    if (uniqueModels.length === 0) {
      throw appError('LLM_CONNECTION_FAILED', {
        provider: request.provider,
        status: 'INVALID_RESPONSE',
        statusText: 'Expected OpenAI-compatible models response',
      });
    }

    return uniqueModels;
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

function parseJsonText<T>(value: string): T {
  const cleaned = cleanText(value);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? cleaned;
  return JSON.parse(candidate) as T;
}

function createOpenAICompatibleTranslationMessage(texts: string[]) {
  return JSON.stringify({
    task: 'Translate each item into Simplified Chinese.',
    output: {
      format: 'JSON object',
      schema: {
        translations: [{ index: 0, text: 'translated text' }],
      },
    },
    rules: [
      'Keep the same index values.',
      'Do not omit any item.',
      'Do not add explanations or markdown.',
      'If the source text is already Chinese, return a polished Simplified Chinese version.',
    ],
    items: texts.map((text, index) => ({ index, text })),
  });
}

function normalizeOpenAICompatibleTranslations(
  responseText: string,
  texts: string[],
  provider: TranslationProviderId,
) {
  let parsed: OpenAICompatibleTranslationResponse;
  try {
    parsed = parseJsonText<OpenAICompatibleTranslationResponse>(responseText);
  } catch (error) {
    throw appError('LLM_CONNECTION_FAILED', {
      provider,
      status: 'INVALID_RESPONSE',
      statusText: error instanceof Error ? error.message : 'Translation JSON parse failed',
    });
  }

  const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
  const translatedByIndex = new Map<number, string>();
  translations.forEach((item) => {
    const index = Number(item?.index);
    const text = cleanText(item?.text);
    if (Number.isInteger(index) && text) {
      translatedByIndex.set(index, text);
    }
  });

  const missingIndex = texts.findIndex((_, index) => !translatedByIndex.has(index));
  if (missingIndex !== -1) {
    throw appError('LLM_CONNECTION_FAILED', {
      provider,
      status: 'INVALID_RESPONSE',
      statusText: `Missing translation for item ${missingIndex}`,
    });
  }

  return texts.map((_, index) => translatedByIndex.get(index) || texts[index]);
}

async function requestOpenAICompatibleTranslations(
  request: ResolvedTranslationRequest,
  texts: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const responseJson = await requestOpenAiCompatibleResponse(
    request,
    {
      model: request.model,
      input: [
        {
          role: 'system',
          content:
            'You are a precise scientific translator. Translate each input text into concise, fluent Simplified Chinese. Preserve meaning, terminology, numbers, and line breaks. Return JSON only.',
        },
        {
          role: 'user',
          content: createOpenAICompatibleTranslationMessage(texts),
        },
      ],
      max_output_tokens: 4000,
      temperature: 0,
    },
    timeoutMs,
    signal,
  );
  const responseText = extractResponseContent(responseJson);
  return normalizeOpenAICompatibleTranslations(responseText, texts, request.provider);
}

async function requestCustomOpenAICompatibleTranslations(
  request: ResolvedTranslationRequest,
  texts: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const responseJson = await requestOpenAiCompatibleResponse(
    request,
    {
      model: request.model,
      input: [
        {
          role: 'system',
          content:
            'You are a precise scientific translator. Translate each input text into concise, fluent Simplified Chinese. Preserve meaning, terminology, numbers, and line breaks. Return JSON only.',
        },
        {
          role: 'user',
          content: createOpenAICompatibleTranslationMessage(texts),
        },
      ],
      max_output_tokens: 4000,
      temperature: 0,
    },
    timeoutMs,
    signal,
  );
  const responseText = extractResponseContent(responseJson);
  return normalizeOpenAICompatibleTranslations(responseText, texts, request.provider);
}

export function hasUsableTranslationSettings(settings: TranslationSettings): boolean {
  const providerSettings = settings.providers[settings.activeProvider];
  return Boolean(cleanText(providerSettings.apiKey));
}

export async function translateTextsWithDedicatedApi(
  texts: string[],
  settings: TranslationSettings,
  signal?: AbortSignal,
): Promise<string[]> {
  if (texts.length === 0) {
    return [];
  }

  const request = resolveTranslationRequestFromSettings(settings);

  switch (request.provider) {
    case 'deepl':
      return requestDeepLTranslations(request, texts, translationTimeoutMs, signal);
    case 'openai-compatible':
      return requestOpenAICompatibleTranslations(request, texts, translationTimeoutMs, signal);
    case 'custom':
      return requestCustomOpenAICompatibleTranslations(request, texts, translationTimeoutMs, signal);
    default:
      throw appError('LLM_PROVIDER_UNSUPPORTED', { provider: request.provider });
  }
}

export async function testTranslationConnection(
  payload: TestTranslationConnectionPayload = {},
): Promise<TranslationConnectionTestResult> {
  const request = resolveTranslationRequest(payload);
  const [translated] =
    request.provider === 'openai-compatible'
      ? await requestOpenAICompatibleTranslations(request, ['connection test'], translationTimeoutMs)
      : request.provider === 'custom'
        ? await requestCustomOpenAICompatibleTranslations(request, ['connection test'], translationTimeoutMs)
      : await requestDeepLTranslations(request, ['connection test'], translationTimeoutMs);

  return {
    provider: request.provider,
    baseUrl: request.baseUrl,
    responsePreview: translated || 'Connected',
  };
}

export async function listTranslationModels(
  payload: ListTranslationModelsPayload = {},
): Promise<TranslationModelsResult> {
  const request = resolveOpenAICompatibleTranslationEndpoint(payload);
  const models = await requestOpenAICompatibleModels(request, translationTimeoutMs);

  return {
    provider: request.provider,
    baseUrl: request.baseUrl,
    models,
  };
}
