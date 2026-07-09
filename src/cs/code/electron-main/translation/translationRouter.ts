import { createHash } from 'node:crypto';

import type {
  DocumentTranslationProgress,
  LlmSettings,
  TranslationSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import type { StorageService, TranslationCacheRecord } from 'cs/platform/storage/common/storage';
import { CancellationError, isCancellationError } from 'cs/base/common/errors';
import { AppError } from 'cs/base/parts/sandbox/common/appError';
import { getLlmTranslationCacheIdentity, translateTextsWithLlm } from 'cs/code/electron-main/llm/llmTranslation';
import type { TranslationBatchItem } from 'cs/code/electron-main/llm/llmTranslation';

import { hasUsableTranslationSettings, translateTextsWithDedicatedApi } from 'cs/code/electron-main/translation/translation';

// Central translation orchestrator.
// Responsibilities:
// 1. choose dedicated translation API vs. LLM fallback
// 2. deduplicate repeated texts within one job
// 3. manage translation cache keys and persistence
// 4. batch and run translation work with bounded concurrency
const maxTranslationBatchItems = 8;
const maxTranslationBatchChars = 12000;
const translationBatchConcurrency = 3;
const translationCacheVersion = 'scientific-zh-v1';
const openAICompatibleTranslationModel = 'gpt-5.5';

type TranslationCacheItem = TranslationBatchItem & {
  cacheKey: string;
};

export type TranslationProgressReporter = (progress: DocumentTranslationProgress) => void;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancellationError();
  }
}

function buildTranslationBatches(items: TranslationBatchItem[]) {
  const batches: TranslationBatchItem[][] = [];
  let currentBatch: TranslationBatchItem[] = [];
  let currentChars = 0;

  items.forEach((item) => {
    const itemChars = item.text.length;
    const shouldFlush =
      currentBatch.length > 0 &&
      (currentBatch.length >= maxTranslationBatchItems || currentChars + itemChars > maxTranslationBatchChars);

    if (shouldFlush) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(item);
    currentChars += itemChars;
  });

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function createTranslationCacheKey(
  provider: string,
  baseUrl: string,
  model: string,
  text: string,
) {
  const hash = createHash('sha256').update(text).digest('hex');
  return `${translationCacheVersion}:${provider}:${baseUrl}:${model}:${hash}`;
}

async function runBatchesWithConcurrency<TItem>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<void>,
) {
  if (items.length === 0) {
    return;
  }

  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        await worker(items[currentIndex]);
      }
    }),
  );
}

function buildUniqueTranslationItems(
  texts: string[],
  provider: string,
  baseUrl: string,
  model: string,
) {
  const cacheKeyToIndexes = new Map<string, number[]>();
  const uniqueItems: TranslationCacheItem[] = [];

  texts.forEach((text, index) => {
    const cacheKey = createTranslationCacheKey(provider, baseUrl, model, text);
    const indexes = cacheKeyToIndexes.get(cacheKey);
    if (indexes) {
      indexes.push(index);
      return;
    }

    cacheKeyToIndexes.set(cacheKey, [index]);
    uniqueItems.push({ index, text, cacheKey });
  });

  return { uniqueItems, cacheKeyToIndexes };
}

function applyTranslatedValue(
  translatedTexts: string[],
  cacheKeyToIndexes: Map<string, number[]>,
  cacheKey: string,
  value: string,
) {
  for (const targetIndex of cacheKeyToIndexes.get(cacheKey) ?? []) {
    translatedTexts[targetIndex] = value;
  }
}

function resolveTranslationFailureMessage(error: unknown) {
  if (error instanceof AppError) {
    const statusText = error.details?.statusText;
    if (typeof statusText === 'string' && statusText) {
      return statusText;
    }

    const message = error.details?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function resolveDedicatedTranslationModel(
  activeProvider: TranslationSettings['activeProvider'],
  providerSettings: TranslationSettings['providers'][TranslationSettings['activeProvider']],
) {
  switch (activeProvider) {
    case 'openai-compatible':
      return cleanText(providerSettings.model) || openAICompatibleTranslationModel;
    case 'custom':
      return cleanText(providerSettings.model);
    default:
      return 'translate-to-zh-hans';
  }
}

function shouldUseGlmTranslation(
  llmSettings: LlmSettings,
  translationSettings: TranslationSettings,
) {
  if (translationSettings.activeProvider === 'glm') {
    return true;
  }

  return (
    !hasUsableTranslationSettings(translationSettings) &&
    Boolean(cleanText(llmSettings.providers.glm.apiKey))
  );
}

function toGlmLlmSettings(
  llmSettings: LlmSettings,
  translationSettings?: TranslationSettings,
): LlmSettings {
  const translationApiKey = translationSettings
    ? cleanText(translationSettings.providers.glm.apiKey)
    : '';

  return {
    ...llmSettings,
    activeProvider: 'glm',
    providers: {
      ...llmSettings.providers,
      glm: {
        ...llmSettings.providers.glm,
        apiKey: translationApiKey || llmSettings.providers.glm.apiKey,
      },
    },
  };
}

function resolveTranslationCacheIdentity(
  llmSettings: LlmSettings,
  translationSettings: TranslationSettings,
) {
  if (shouldUseGlmTranslation(llmSettings, translationSettings)) {
    const llmIdentity = getLlmTranslationCacheIdentity(toGlmLlmSettings(llmSettings, translationSettings));
    return {
      ...llmIdentity,
      provider: translationSettings.activeProvider === 'glm' ? 'translation:glm' : llmIdentity.provider,
      mode: 'llm' as const,
    };
  }

  if (hasUsableTranslationSettings(translationSettings)) {
    const activeProvider = translationSettings.activeProvider;
    const providerSettings = translationSettings.providers[activeProvider];
    return {
      provider: `translation:${activeProvider}`,
      baseUrl: providerSettings.baseUrl,
      model: resolveDedicatedTranslationModel(activeProvider, providerSettings),
      mode: 'dedicated' as const,
    };
  }

  const llmIdentity = getLlmTranslationCacheIdentity(llmSettings);
  return {
    ...llmIdentity,
    mode: 'llm' as const,
  };
}

export async function translateTextsToChinese(
  texts: string[],
  llmSettings: LlmSettings,
  translationSettings: TranslationSettings,
  storage: StorageService,
  onProgress?: TranslationProgressReporter,
  signal?: AbortSignal,
): Promise<string[]> {
  const normalizedTexts = texts.map((text) => cleanText(text));
  if (normalizedTexts.length === 0) {
    return [];
  }

  throwIfAborted(signal);
  const route = resolveTranslationCacheIdentity(llmSettings, translationSettings);
  const translatedTexts = [...normalizedTexts];
  const { uniqueItems, cacheKeyToIndexes } = buildUniqueTranslationItems(
    normalizedTexts,
    route.provider,
    route.baseUrl,
    route.model,
  );

  const uncachedItems: TranslationCacheItem[] = [];
  let totalBatches = 0;
  let completedBatches = 0;

  try {
    throwIfAborted(signal);
    const cachedTranslations = await storage.loadTranslationCache(uniqueItems.map((item) => item.cacheKey));

    uniqueItems.forEach((item) => {
      const cachedValue = cachedTranslations[item.cacheKey];
      if (cachedValue) {
        applyTranslatedValue(translatedTexts, cacheKeyToIndexes, item.cacheKey, cachedValue);
        return;
      }

      uncachedItems.push(item);
    });

    const batches = buildTranslationBatches(uncachedItems.map((item) => ({ index: item.index, text: item.text })));
    totalBatches = batches.length;
    const uncachedByIndex = new Map(
      uncachedItems.map((item) => [item.index, item] satisfies [number, TranslationCacheItem]),
    );
    const cacheEntriesToSave: TranslationCacheRecord[] = [];

    onProgress?.({
      phase: 'started',
      current: 0,
      total: totalBatches,
      provider: route.provider,
      model: route.model,
      message: null,
    });

    await runBatchesWithConcurrency(batches, translationBatchConcurrency, async (batch) => {
      throwIfAborted(signal);
      const batchTranslations =
        route.mode === 'dedicated'
          ? await translateTextsWithDedicatedApi(
              batch.map((item) => item.text),
              translationSettings,
              signal,
            )
          : await translateTextsWithLlm(
              batch,
              shouldUseGlmTranslation(llmSettings, translationSettings)
                ? toGlmLlmSettings(llmSettings, translationSettings)
                : llmSettings,
              signal,
            );

      throwIfAborted(signal);
      batch.forEach((item, index) => {
        const uncachedItem = uncachedByIndex.get(item.index);
        if (!uncachedItem) {
          return;
        }

        const translatedValue = batchTranslations[index];
        applyTranslatedValue(translatedTexts, cacheKeyToIndexes, uncachedItem.cacheKey, translatedValue);
        cacheEntriesToSave.push({
          key: uncachedItem.cacheKey,
          value: translatedValue,
        });
      });
      completedBatches += 1;
      onProgress?.({
        phase: 'batch',
        current: completedBatches,
        total: totalBatches,
        provider: route.provider,
        model: route.model,
        message: null,
      });
    });

    throwIfAborted(signal);
    await storage.saveTranslationCache(cacheEntriesToSave);
    onProgress?.({
      phase: 'completed',
      current: totalBatches,
      total: totalBatches,
      provider: route.provider,
      model: route.model,
      message: null,
    });

    return translatedTexts;
  } catch (error) {
    if (isCancellationError(error)) {
      throw error;
    }

    onProgress?.({
      phase: 'failed',
      current: completedBatches,
      total: totalBatches,
      provider: route.provider,
      model: route.model,
      message: resolveTranslationFailureMessage(error),
    });
    throw error;
  }
}
