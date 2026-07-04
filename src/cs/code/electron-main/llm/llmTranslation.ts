import type { LlmProviderId, LlmSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import { parseLlmModelOptionValue } from 'cs/workbench/services/llm/registry';
import {
  extractResponseContent,
  requestOpenAiCompatibleResponse,
  resolveLlmRequestFromPayload,
} from 'cs/code/electron-main/llm/llm';

// LLM-based translation implementation only.
// This module owns the prompt contract and response normalization for the
// Responses API translation path. Routing, caching, and concurrency live in
// translationRouter.ts.
const llmTranslationTimeoutMs = 45000;

type TranslationBatchResponse = {
  translations?: Array<{
    index?: unknown;
    text?: unknown;
  }>;
};

export type TranslationBatchItem = {
  index: number;
  text: string;
};

function resolveLlmRequestFromSettings(settings: LlmSettings) {
  const provider = settings.activeProvider;
  const providerSettings = settings.providers[provider];
  const selectedOption = providerSettings.selectedModelOption
    ? parseLlmModelOptionValue(providerSettings.selectedModelOption)
    : null;

  return resolveLlmRequestFromPayload({
    provider,
    apiKey: providerSettings.apiKey,
    baseUrl: providerSettings.baseUrl,
    model: selectedOption?.modelId ?? '',
    serviceTier: selectedOption?.serviceTier,
  });
}

function parseJsonText<T>(value: string): T {
  const cleaned = cleanText(value);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? cleaned;
  return JSON.parse(candidate) as T;
}

function normalizeTranslationBatch(
  responseText: string,
  batch: TranslationBatchItem[],
  provider: LlmProviderId,
) {
  let parsed: TranslationBatchResponse;
  try {
    parsed = parseJsonText<TranslationBatchResponse>(responseText);
  } catch (error) {
    throw appError('LLM_CONNECTION_FAILED', {
      provider,
      status: 'INVALID_RESPONSE',
      statusText: error instanceof Error ? error.message : 'Translation JSON parse failed',
    });
  }

  const rawTranslations = Array.isArray(parsed.translations) ? parsed.translations : [];
  const translatedByIndex = new Map<number, string>();

  rawTranslations.forEach((item) => {
    const index = Number(item?.index);
    const text = cleanText(item?.text);
    if (Number.isInteger(index) && text) {
      translatedByIndex.set(index, text);
    }
  });

  const missingItem = batch.find((item) => !translatedByIndex.has(item.index));
  if (missingItem) {
    throw appError('LLM_CONNECTION_FAILED', {
      provider,
      status: 'INVALID_RESPONSE',
      statusText: `Missing translation for item ${missingItem.index}`,
    });
  }

  return batch.map((item) => translatedByIndex.get(item.index) || item.text);
}

function createBatchRequestMessage(batch: TranslationBatchItem[]) {
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
    items: batch,
  });
}

export function getLlmTranslationCacheIdentity(settings: LlmSettings) {
  const request = resolveLlmRequestFromSettings(settings);

  return {
    provider: request.provider,
    baseUrl: request.baseUrl,
    model: request.model,
  };
}

export async function translateTextsWithLlm(
  batch: TranslationBatchItem[],
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<string[]> {
  if (batch.length === 0) {
    return [];
  }

  const request = resolveLlmRequestFromSettings(settings);
  const responseJson = await requestOpenAiCompatibleResponse(
    request,
    {
      model: request.model,
      reasoning: request.reasoningEffort ? { effort: request.reasoningEffort } : undefined,
      service_tier: request.serviceTier,
      input: [
        {
          role: 'system',
          content:
            'You are a precise scientific translator. Translate each input text into concise, fluent Simplified Chinese. Preserve meaning, terminology, numbers, and line breaks. Return JSON only.',
        },
        {
          role: 'user',
          content: createBatchRequestMessage(batch),
        },
      ],
      max_output_tokens: 4000,
      temperature: 0,
    },
    llmTranslationTimeoutMs,
    signal,
  );
  const responseText = extractResponseContent(responseJson);
  return normalizeTranslationBatch(responseText, batch, request.provider);
}
