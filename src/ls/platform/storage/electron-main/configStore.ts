import path from 'node:path';
import { promises as fs } from 'node:fs';

import type {
  AppTheme,
  AppSettings,
  BatchSource,
  KnowledgeBaseSettings,
  RagSettings,
  StoredAppSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import {
  cloneEditorDraftStyleSettings,
  normalizeEditorDraftStyleSettings,
} from 'ls/base/common/editorDraftStyle';
import type { StorageService } from 'ls/platform/storage/common/storage';
import { cleanText } from 'ls/base/common/strings';
import {
  batchLimitMax,
  batchLimitMin,
  defaultBatchLimit,
  defaultSameDomainOnly,
} from 'ls/platform/config/common/defaultBatchSources';
import {
  createDefaultLlmSettings,
  defaultLlmProviderSettings,
} from 'ls/workbench/services/llm/config';
import {
  getEnabledLlmModelOptionValuesForProvider,
  parseLlmModelOptionValue,
  isLlmProviderId,
} from 'ls/workbench/services/llm/registry';
import {
  createDefaultTranslationSettings,
  defaultTranslationProviderSettings,
} from 'ls/workbench/services/translation/config';
import { isTranslationProviderId } from 'ls/workbench/services/translation/registry';
import {
  cloneKnowledgeBaseSettings,
  createDefaultKnowledgeBaseSettings,
} from 'ls/workbench/services/knowledgeBase/config';
import {
  createDefaultRagSettings,
  defaultRagProviderSettings,
  defaultRagRetrievalCandidateCount,
  defaultRagRetrievalTopK,
} from 'ls/workbench/services/rag/config';
import { isRagProviderId } from 'ls/workbench/services/rag/registry';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'ls/workbench/services/webContent/webContentRetentionConfig';

type ConfigStore = Pick<StorageService, 'loadSettings' | 'saveSettings'>;
const fallbackLocale: 'zh' | 'en' = 'zh';
const defaultMaxConcurrentIndexJobs = 1;
const minConcurrentIndexJobs = 1;
const maxConcurrentIndexJobs = 4;

type ConfigStoreOptions = {
  defaultLocale?: 'zh' | 'en';
  defaultBatchSources?: ReadonlyArray<BatchSource>;
};

async function readJson<T>(filePath: string, fallbackValue: T) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallbackValue;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(serializeConfigValue(value), null, 2), 'utf8');
}

function serializeConfigValue(value: unknown) {
  if (!value || typeof value !== 'object' || !('llm' in value) || !('translation' in value)) {
    return value;
  }

  const settings = value as StoredAppSettings;
  const serializedBatchSources = settings.defaultBatchSources.map((source) => ({
    id: source.id,
    url: source.url,
    journalTitle: source.journalTitle,
  }));
  const serializedProviders = Object.fromEntries(
    Object.entries(settings.llm.providers).flatMap(([providerId, provider]) => {
      const defaultProvider = defaultLlmProviderSettings[providerId as keyof typeof defaultLlmProviderSettings];
      const hasApiKey = Boolean(cleanText(provider.apiKey));
      const hasSelectedModelOption =
        provider.selectedModelOption !== defaultProvider.selectedModelOption;
      const hasEnabledModelOptions =
        JSON.stringify(provider.enabledModelOptions ?? []) !==
        JSON.stringify(defaultProvider.enabledModelOptions ?? []);

      if (!hasApiKey && !hasSelectedModelOption && !hasEnabledModelOptions) {
        return [];
      }

      return [[
        providerId,
        {
          apiKey: provider.apiKey,
          selectedModelOption: provider.selectedModelOption,
          enabledModelOptions: provider.enabledModelOptions,
        },
      ]];
    }),
  );
  const serializedTranslationProviders = Object.fromEntries(
    Object.entries(settings.translation.providers)
      .flatMap(([providerId, provider]) => {
        const defaultProvider =
          defaultTranslationProviderSettings[providerId as keyof typeof defaultTranslationProviderSettings];
        const hasApiKey = Boolean(cleanText(provider.apiKey));
        const hasCustomBaseUrl = cleanText(provider.baseUrl) !== defaultProvider.baseUrl;

        if (!hasApiKey && !hasCustomBaseUrl) {
          return [];
        }

        return [[
          providerId,
          {
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
          },
        ]];
      }),
  );

  return {
    ...settings,
    defaultBatchSources: serializedBatchSources,
    llm: {
      ...settings.llm,
      providers: serializedProviders,
    },
    translation: {
      ...settings.translation,
      providers: serializedTranslationProviders,
    },
  };
}

function normalizeLocale(value: unknown, defaultLocale: 'zh' | 'en'): 'zh' | 'en' {
  if (value === 'zh' || value === 'en') {
    return value;
  }

  return defaultLocale;
}

function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' || value === 'system' ? value : 'light';
}

function normalizeThemeColorCustomizations(value: unknown): StoredAppSettings['workbench.colorCustomizations'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).filter(
    ([key, entryValue]) => key.trim() && typeof entryValue === 'string',
  );

  return Object.fromEntries(entries);
}

function buildSourceId(seed: unknown, index: number) {
  const cleaned = cleanText(seed);
  if (cleaned) return cleaned;

  return String(index + 1);
}

function normalizePreferredExtractorId(value: unknown): string | null {
  const cleaned = cleanText(value);
  return cleaned || null;
}

function cloneBatchSources(input: ReadonlyArray<BatchSource>): BatchSource[] {
  return input
    .map((item, index) => {
      const url = cleanText(item?.url);
      return {
        id: buildSourceId(item?.id, index),
        url,
        journalTitle: cleanText(item?.journalTitle),
        preferredExtractorId: normalizePreferredExtractorId(item?.preferredExtractorId),
      };
    })
    .filter((source) => source.url);
}

function normalizeBatchSources(
  payload: Partial<StoredAppSettings>,
  fallbackBatchSources: ReadonlyArray<BatchSource>,
): BatchSource[] {
  if (!Array.isArray(payload.defaultBatchSources)) {
    return cloneBatchSources(fallbackBatchSources);
  }

  const fallbackByUrl = new Map<string, BatchSource>();
  for (const source of fallbackBatchSources) {
    if (!source.url || fallbackByUrl.has(source.url)) {
      continue;
    }
    fallbackByUrl.set(source.url, source);
  }

  const fromStructured = payload.defaultBatchSources.map((item, index) => {
    const url = cleanText(item?.url);
    const fallbackSource = fallbackByUrl.get(url);
    return {
      id: buildSourceId(item?.id ?? fallbackSource?.id, index),
      url,
      journalTitle: cleanText(item?.journalTitle) || cleanText(fallbackSource?.journalTitle),
      preferredExtractorId: normalizePreferredExtractorId(
        item?.preferredExtractorId ?? fallbackSource?.preferredExtractorId,
      ),
    };
  });
  const normalized = fromStructured.filter((source) => source.url);
  const deduped = new Map<string, BatchSource>();

  for (const source of normalized) {
    const existing = deduped.get(source.url);
    if (!existing) {
      deduped.set(source.url, source);
      continue;
    }
    if (!existing.journalTitle && source.journalTitle) {
      deduped.set(source.url, source);
      continue;
    }
    if (!existing.id && source.id) {
      deduped.set(source.url, source);
      continue;
    }
    if (!existing.preferredExtractorId && source.preferredExtractorId) {
      deduped.set(source.url, source);
    }
  }

  return [...deduped.values()];
}

function normalizeSettings(
  payload: Partial<StoredAppSettings> = {},
  defaultLocale: 'zh' | 'en',
  fallbackBatchSources: ReadonlyArray<BatchSource>,
): StoredAppSettings {
  const downloadDir = typeof payload.defaultDownloadDir === 'string' ? cleanText(payload.defaultDownloadDir) : '';
  const normalizedBatchSources = normalizeBatchSources(payload, fallbackBatchSources);
  const parsedLimit = Number.parseInt(String(payload.defaultBatchLimit), 10);
  const normalizedLimit = Number.isNaN(parsedLimit)
    ? defaultBatchLimit
    : Math.min(batchLimitMax, Math.max(batchLimitMin, parsedLimit));

  return {
    defaultDownloadDir: downloadDir || null,
    pdfFileNameUseSelectionOrder:
      typeof payload.pdfFileNameUseSelectionOrder === 'boolean'
        ? payload.pdfFileNameUseSelectionOrder
        : false,
    browserTabKeepAliveLimit: normalizeBrowserTabKeepAliveLimit(
      payload.browserTabKeepAliveLimit,
      defaultBrowserTabKeepAliveLimit,
    ),
    defaultBatchSources: normalizedBatchSources,
    defaultBatchLimit: normalizedLimit,
    defaultSameDomainOnly:
      typeof payload.defaultSameDomainOnly === 'boolean'
        ? payload.defaultSameDomainOnly
        : defaultSameDomainOnly,
    systemNotificationsEnabled:
      typeof payload.systemNotificationsEnabled === 'boolean'
        ? payload.systemNotificationsEnabled
        : true,
    warningNotificationsEnabled:
      typeof payload.warningNotificationsEnabled === 'boolean'
        ? payload.warningNotificationsEnabled
        : true,
    menuBarIconEnabled:
      typeof payload.menuBarIconEnabled === 'boolean'
        ? payload.menuBarIconEnabled
        : false,
    completionNotificationsEnabled:
      typeof payload.completionNotificationsEnabled === 'boolean'
        ? payload.completionNotificationsEnabled
        : true,
    statusbarVisible:
      typeof payload.statusbarVisible === 'boolean'
        ? payload.statusbarVisible
        : true,
    useMica: typeof payload.useMica === 'boolean' ? payload.useMica : true,
    theme: normalizeTheme(payload.theme),
    'workbench.colorCustomizations': normalizeThemeColorCustomizations(payload['workbench.colorCustomizations']),
    locale: normalizeLocale(payload.locale, defaultLocale),
    editorDraftStyle: normalizeEditorDraftStyleSettings(payload.editorDraftStyle),
    llm: normalizeLlmSettings(payload.llm),
    translation: normalizeTranslationSettings(payload.translation),
    knowledgeBase: normalizeKnowledgeBaseSettings(payload.knowledgeBase),
    rag: normalizeRagSettings(payload.rag),
  };
}

function normalizeLlmSettings(payload: unknown): StoredAppSettings['llm'] {
  const defaults = createDefaultLlmSettings();
  const llmPayload =
    payload && typeof payload === 'object' ? (payload as Partial<StoredAppSettings['llm']>) : {};
  const activeProvider = isLlmProviderId(llmPayload.activeProvider)
    ? llmPayload.activeProvider
    : defaults.activeProvider;
  const providersPayload: Partial<Record<keyof StoredAppSettings['llm']['providers'], unknown>> =
    llmPayload.providers && typeof llmPayload.providers === 'object' ? llmPayload.providers : {};

  return {
    activeProvider,
    providers: {
      glm: normalizeLlmProviderSettings('glm', providersPayload.glm),
      kimi: normalizeLlmProviderSettings('kimi', providersPayload.kimi),
      deepseek: normalizeLlmProviderSettings('deepseek', providersPayload.deepseek),
      anthropic: normalizeLlmProviderSettings('anthropic', providersPayload.anthropic),
      openai: normalizeLlmProviderSettings('openai', providersPayload.openai),
      gemini: normalizeLlmProviderSettings('gemini', providersPayload.gemini),
      custom: normalizeLlmProviderSettings('custom', providersPayload.custom),
    },
  };
}

function normalizeLlmProviderSettings(
  provider: keyof StoredAppSettings['llm']['providers'],
  payload: unknown,
) {
  const defaults = defaultLlmProviderSettings[provider];
  const providerPayload =
    payload && typeof payload === 'object'
      ? (payload as Partial<StoredAppSettings['llm']['providers'][typeof provider]>)
      : {};
  const selectedModelOption = normalizeSelectedLlmModelOption(
    provider,
    providerPayload.selectedModelOption,
  );

  return {
    apiKey: cleanText(providerPayload.apiKey),
    baseUrl: defaults.baseUrl,
    selectedModelOption,
    enabledModelOptions: normalizeEnabledLlmModelOptions(
      provider,
      providerPayload.enabledModelOptions,
    ),
  };
}

function normalizeSelectedLlmModelOption(
  provider: keyof StoredAppSettings['llm']['providers'],
  value: unknown,
): string {
  const optionValue = cleanText(value);
  if (parseLlmModelOptionValue(optionValue)?.providerId === provider) {
    return optionValue;
  }

  return defaultLlmProviderSettings[provider].selectedModelOption;
}

function normalizeEnabledLlmModelOptions(
  provider: keyof StoredAppSettings['llm']['providers'],
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [...(defaultLlmProviderSettings[provider].enabledModelOptions ?? [])];
  }

  const normalizedOptions = getEnabledLlmModelOptionValuesForProvider(
    provider,
    value.filter((item): item is string => typeof item === 'string'),
  );

  const allOptionValues = getEnabledLlmModelOptionValuesForProvider(provider);
  if (
    normalizedOptions.length === allOptionValues.length &&
    normalizedOptions.every((optionValue, index) => optionValue === allOptionValues[index])
  ) {
    return [...(defaultLlmProviderSettings[provider].enabledModelOptions ?? [])];
  }

  return normalizedOptions;
}

function normalizeTranslationSettings(payload: unknown): StoredAppSettings['translation'] {
  const defaults = createDefaultTranslationSettings();
  const translationPayload =
    payload && typeof payload === 'object' ? (payload as Partial<StoredAppSettings['translation']>) : {};
  const activeProvider = isTranslationProviderId(translationPayload.activeProvider)
    ? translationPayload.activeProvider
    : defaults.activeProvider;
  const providersPayload:
    Partial<Record<keyof StoredAppSettings['translation']['providers'], unknown>> =
      translationPayload.providers && typeof translationPayload.providers === 'object'
        ? translationPayload.providers
        : {};

  return {
    activeProvider,
    providers: {
      deepl: normalizeTranslationProviderSettings('deepl', providersPayload.deepl),
      glm: normalizeTranslationProviderSettings('glm', providersPayload.glm),
      'openai-compatible': normalizeTranslationProviderSettings(
        'openai-compatible',
        providersPayload['openai-compatible'],
      ),
    },
  };
}

function normalizeTranslationProviderSettings(
  provider: keyof StoredAppSettings['translation']['providers'],
  payload: unknown,
) {
  const defaults = defaultTranslationProviderSettings[provider];
  const providerPayload =
    payload && typeof payload === 'object'
      ? (payload as Partial<StoredAppSettings['translation']['providers'][typeof provider]>)
      : {};

  return {
    apiKey: cleanText(providerPayload.apiKey),
    baseUrl: cleanText(providerPayload.baseUrl) || defaults.baseUrl,
  };
}

function normalizeKnowledgeBaseSettings(payload: unknown): KnowledgeBaseSettings {
  const defaults = createDefaultKnowledgeBaseSettings();
  const knowledgeBasePayload =
    payload && typeof payload === 'object'
      ? (payload as Partial<KnowledgeBaseSettings>)
      : {};
  const parsedConcurrentJobs = Number.parseInt(
    String(knowledgeBasePayload.maxConcurrentIndexJobs),
    10,
  );
  const normalizedConcurrentJobs = Number.isNaN(parsedConcurrentJobs)
    ? defaultMaxConcurrentIndexJobs
    : Math.min(maxConcurrentIndexJobs, Math.max(minConcurrentIndexJobs, parsedConcurrentJobs));
  const libraryDirectory = cleanText(
    typeof knowledgeBasePayload.libraryDirectory === 'string'
      ? knowledgeBasePayload.libraryDirectory
      : '',
  );
  const enabled =
    typeof knowledgeBasePayload.enabled === 'boolean'
      ? knowledgeBasePayload.enabled
      : defaults.enabled;
  const libraryStorageMode = knowledgeBasePayload.libraryStorageMode;
  const normalizedLibraryStorageMode =
    libraryStorageMode === 'managed-copy' ||
    libraryStorageMode === 'linked-original'
      ? libraryStorageMode
      : defaults.libraryStorageMode;

  return {
    enabled,
    autoIndexDownloadedPdf:
      typeof knowledgeBasePayload.autoIndexDownloadedPdf === 'boolean'
        ? knowledgeBasePayload.autoIndexDownloadedPdf
        : defaults.autoIndexDownloadedPdf,
    downloadDirectory:
      typeof knowledgeBasePayload.downloadDirectory === 'string'
        ? cleanText(knowledgeBasePayload.downloadDirectory) || null
        : defaults.downloadDirectory,
    libraryStorageMode: normalizedLibraryStorageMode,
    libraryDirectory: libraryDirectory || null,
    maxConcurrentIndexJobs: normalizedConcurrentJobs,
  };
}

function normalizeRagSettings(payload: unknown): RagSettings {
  const defaults = createDefaultRagSettings();
  const ragPayload =
    payload && typeof payload === 'object' ? (payload as Partial<RagSettings>) : {};
  const activeProvider = isRagProviderId(ragPayload.activeProvider)
    ? ragPayload.activeProvider
    : defaults.activeProvider;
  const providersPayload =
    ragPayload.providers && typeof ragPayload.providers === 'object'
      ? ragPayload.providers
      : defaults.providers;
  const parsedCandidateCount = Number.parseInt(String(ragPayload.retrievalCandidateCount), 10);
  const retrievalCandidateCount = Number.isNaN(parsedCandidateCount)
    ? defaultRagRetrievalCandidateCount
    : Math.min(20, Math.max(3, parsedCandidateCount));
  const parsedTopK = Number.parseInt(String(ragPayload.retrievalTopK), 10);
  const retrievalTopK = Number.isNaN(parsedTopK)
    ? defaultRagRetrievalTopK
    : Math.min(8, Math.max(1, parsedTopK));

  return {
    enabled:
      typeof ragPayload.enabled === 'boolean' ? ragPayload.enabled : defaults.enabled,
    activeProvider,
    providers: {
      moark: normalizeRagProviderSettings(providersPayload.moark),
    },
    retrievalCandidateCount,
    retrievalTopK: Math.min(retrievalCandidateCount, retrievalTopK),
  };
}

function normalizeRagProviderSettings(payload: unknown) {
  const defaults = defaultRagProviderSettings.moark;
  const providerPayload =
    payload && typeof payload === 'object'
      ? (payload as Partial<RagSettings['providers']['moark']>)
      : {};

  return {
    apiKey: cleanText(providerPayload.apiKey),
    baseUrl: cleanText(providerPayload.baseUrl) || defaults.baseUrl,
    embeddingModel: cleanText(providerPayload.embeddingModel) || defaults.embeddingModel,
    rerankerModel: cleanText(providerPayload.rerankerModel) || defaults.rerankerModel,
    embeddingPath: normalizeRelativeApiPath(providerPayload.embeddingPath, defaults.embeddingPath),
    rerankPath: normalizeRelativeApiPath(providerPayload.rerankPath, defaults.rerankPath),
  };
}

function normalizeRelativeApiPath(value: unknown, fallbackValue: string): string {
  const pathValue = cleanText(value) || fallbackValue;
  if (/^https?:\/\//i.test(pathValue)) {
    return pathValue.replace(/\/+$/, '');
  }

  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

function attachConfigPath(settings: StoredAppSettings, configPath: string): AppSettings {
  return {
    ...settings,
    editorDraftStyle: cloneEditorDraftStyleSettings(settings.editorDraftStyle),
    knowledgeBase: cloneKnowledgeBaseSettings(settings.knowledgeBase),
    configPath,
  };
}

export function createConfigStore(configFile: string, options: ConfigStoreOptions = {}): ConfigStore {
  const defaultLocale = options.defaultLocale === 'en' ? 'en' : fallbackLocale;
  const fallbackBatchSources = cloneBatchSources(options.defaultBatchSources ?? []);

  async function readSettings() {
    const payload = await readJson<Partial<StoredAppSettings>>(configFile, {});
    const normalized = normalizeSettings(payload, defaultLocale, fallbackBatchSources);
    if (!Array.isArray(payload.defaultBatchSources)) {
      try {
        await writeJson(configFile, normalized);
      } catch {
        // ignore write failures on lazy defaults hydration
      }
    }
    return attachConfigPath(normalized, configFile);
  }

  return {
    async loadSettings() {
      return readSettings();
    },

    async saveSettings(settings = {}) {
      const current = await readSettings();
      const { configPath: _configPath, ...currentStored } = current;
      const saved = normalizeSettings({ ...currentStored, ...settings }, defaultLocale, fallbackBatchSources);
      await writeJson(configFile, saved);
      return attachConfigPath(saved, configFile);
    },
  };
}
