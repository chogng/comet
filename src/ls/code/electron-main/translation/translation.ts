import type {
  TestTranslationConnectionPayload,
  TranslationConnectionTestResult,
  TranslationProviderId,
  TranslationSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { appError, isAppError } from 'ls/base/common/errors';
import { cleanText } from 'ls/base/common/strings';
import { defaultTranslationProviderId } from 'ls/workbench/services/translation/config';
import { isTranslationProviderId } from 'ls/workbench/services/translation/registry';

// Dedicated translation API implementations live here.
// This module should stay focused on provider-specific behavior such as:
// 1. request shaping
// 2. response parsing
// 3. connection testing
// It should not own cross-provider routing, batching, or cache orchestration.
const translationTimeoutMs = 20000;
const openAICompatibleTranslationModel = 'gpt-5.4-mini';

type ResolvedTranslationRequest = {
  provider: TranslationProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
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

type OpenAICompatibleResponsesPayload = {
  model: string;
  input: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  max_output_tokens: number;
  temperature: number;
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

function resolveTranslationRequest(payload: TestTranslationConnectionPayload = {}): ResolvedTranslationRequest {
  const provider = normalizeProvider(payload.provider ?? defaultTranslationProviderId);
  return {
    provider,
    apiKey: normalizeApiKey(payload.apiKey),
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    model:
      provider === 'openai-compatible'
        ? cleanText(payload.model) || openAICompatibleTranslationModel
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
  });
}

async function requestDeepLTranslations(
  request: ResolvedTranslationRequest,
  texts: string[],
  timeoutMs: number,
): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

function extractResponsesTextContent(payload: unknown): string {
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
        if (!item || typeof item !== 'object') {
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

async function requestOpenAICompatibleResponse(
  request: ResolvedTranslationRequest,
  payload: OpenAICompatibleResponsesPayload,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
        statusText: response.statusText || errorText || 'Request failed',
      });
    }

    return response.json();
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

async function requestOpenAICompatibleTranslations(
  request: ResolvedTranslationRequest,
  texts: string[],
  timeoutMs: number,
): Promise<string[]> {
  const responseJson = await requestOpenAICompatibleResponse(
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
  );
  const responseText = extractResponsesTextContent(responseJson);
  let parsed: OpenAICompatibleTranslationResponse;
  try {
    parsed = parseJsonText<OpenAICompatibleTranslationResponse>(responseText);
  } catch (error) {
    throw appError('LLM_CONNECTION_FAILED', {
      provider: request.provider,
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
      provider: request.provider,
      status: 'INVALID_RESPONSE',
      statusText: `Missing translation for item ${missingIndex}`,
    });
  }

  return texts.map((_, index) => translatedByIndex.get(index) || texts[index]);
}

export function hasUsableTranslationSettings(settings: TranslationSettings): boolean {
  const providerSettings = settings.providers[settings.activeProvider];
  return Boolean(cleanText(providerSettings.apiKey));
}

export async function translateTextsWithDedicatedApi(
  texts: string[],
  settings: TranslationSettings,
): Promise<string[]> {
  if (texts.length === 0) {
    return [];
  }

  const request = resolveTranslationRequestFromSettings(settings);

  switch (request.provider) {
    case 'deepl':
      return requestDeepLTranslations(request, texts, translationTimeoutMs);
    case 'openai-compatible':
      return requestOpenAICompatibleTranslations(request, texts, translationTimeoutMs);
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
      : await requestDeepLTranslations(request, ['connection test'], translationTimeoutMs);

  return {
    provider: request.provider,
    baseUrl: request.baseUrl,
    responsePreview: translated || 'Connected',
  };
}
