import path from 'node:path';
import { promises as fs } from 'node:fs';

import type {
  AppTheme,
  AppSettings,
  JournalSourceOverride,
  KnowledgeBaseSettings,
  RagSettings,
  StoredAppSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  defaultBrowserMaxHistoryEntries,
  defaultBrowserPageZoom,
  defaultBrowserSearchEngine,
  maxBrowserMaxHistoryEntries,
  minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import {
  cloneEditorDraftStyleSettings,
  normalizeEditorDraftStyleSettings,
  type EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import { cleanText } from 'cs/base/common/strings';
import type {
  IProviderApiKeySecretStorage,
  ProviderApiKeyScope,
} from 'cs/platform/secrets/common/secret';
import {
  batchLimitMax,
  batchLimitMin,
  defaultBatchLimit,
  getDefaultBatchSources,
} from 'cs/platform/configuration/common/defaultBatchSources';
import {
  createDefaultLlmSettings,
  defaultLlmProviderSettings,
} from 'cs/workbench/services/llm/config';
import {
  getEnabledLlmModelOptionValuesForProvider,
  parseLlmModelOptionValue,
  isLlmProviderId,
} from 'cs/workbench/services/llm/registry';
import {
  createDefaultTranslationSettings,
  defaultTranslationProviderSettings,
} from 'cs/workbench/services/translation/config';
import { isTranslationProviderId } from 'cs/workbench/services/translation/registry';
import {
  cloneKnowledgeBaseSettings,
  createDefaultKnowledgeBaseSettings,
} from 'cs/workbench/services/knowledgeBase/config';
import {
  createDefaultRagSettings,
  defaultRagProviderSettings,
  defaultRagRetrievalCandidateCount,
  defaultRagRetrievalTopK,
} from 'cs/workbench/services/rag/config';
import { isRagProviderId } from 'cs/workbench/services/rag/registry';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';

const fallbackLocale: 'zh' | 'en' = 'en';
const defaultMaxConcurrentIndexJobs = 1;
const minConcurrentIndexJobs = 1;
const maxConcurrentIndexJobs = 4;

type ConfigurationMainServiceOptions = {
  defaultLocale?: 'zh' | 'en';
  providerApiKeySecretStorage: IProviderApiKeySecretStorage;
};

type UserSettings = {
  'literature.journalSourceOverrides'?: JournalSourceOverride[];
  'literature.editorDraftStyle'?: EditorDraftStyleSettings;
  journalSourceOverrides?: JournalSourceOverride[];
};

function normalizeUserSettingsPathOverride(value: unknown, defaultUserSettingsFile: string) {
  const normalized = cleanText(typeof value === 'string' ? value : '');
  if (!normalized || normalized === defaultUserSettingsFile) {
    return null;
  }

  return normalized;
}

function resolveUserSettingsFilePath(
  payload: Partial<StoredAppSettings>,
  defaultUserSettingsFile: string,
) {
  return normalizeUserSettingsPathOverride(
    payload.userSettingsPathOverride,
    defaultUserSettingsFile,
  ) ?? defaultUserSettingsFile;
}

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

function createDefaultUserJournalSourceOverrides() {
  return getDefaultBatchSources().map((source): JournalSourceOverride => ({
    url: source.url,
    journalTitle: source.journalTitle,
  }));
}

function mergeJournalSourceOverrides(
  base: ReadonlyArray<JournalSourceOverride>,
  overrides: ReadonlyArray<JournalSourceOverride>,
) {
  const merged = new Map<string, JournalSourceOverride>();
  for (const source of [...base, ...overrides]) {
    const url = cleanText(source.url);
    if (!url) {
      continue;
    }

    merged.set(url, {
      url,
      journalTitle: cleanText(source.journalTitle),
    });
  }

  return [...merged.values()];
}

async function ensureUserSettingsFile(
  filePath: string,
  appSettingsPayload: Partial<StoredAppSettings>,
) {
  const defaultSourceOverrides = createDefaultUserJournalSourceOverrides();
  const legacySourceOverrides = normalizeJournalSourceOverrides(
    appSettingsPayload.journalSourceOverrides,
  );

  try {
    const existing = await readJson<Partial<UserSettings>>(filePath, {});
    const existingSourceOverrides = resolveUserJournalSourceOverrides(existing);
    const nextSourceOverrides = mergeJournalSourceOverrides(
      defaultSourceOverrides,
      existingSourceOverrides.length > 0 ? existingSourceOverrides : legacySourceOverrides,
    );
    await writeJson(filePath, {
      ...existing,
      'literature.journalSourceOverrides': nextSourceOverrides,
    });
  } catch {
    await writeJson(filePath, {
      'literature.journalSourceOverrides': mergeJournalSourceOverrides(
        defaultSourceOverrides,
        legacySourceOverrides,
      ),
    } satisfies Partial<UserSettings>);
  }
}

async function writeUserSettingsEditorDraftStyle(
  filePath: string,
  editorDraftStyle: EditorDraftStyleSettings,
) {
  const existing = await readJson<Partial<UserSettings>>(filePath, {});
  await writeJson(filePath, {
    ...existing,
    'literature.editorDraftStyle': cloneEditorDraftStyleSettings(editorDraftStyle),
  } satisfies Partial<UserSettings>);
}

function serializeConfigValue(value: unknown) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const payload = value as Partial<StoredAppSettings>;
  if (!payload.llm || !payload.translation) {
    return removeProviderApiKeysFromPayload(payload);
  }

  const settings = removeProviderApiKeysFromPayload(payload) as StoredAppSettings;
  const serializedProviders = Object.fromEntries(
    Object.entries(settings.llm.providers).flatMap(([providerId, provider]) => {
      const defaultProvider = defaultLlmProviderSettings[providerId as keyof typeof defaultLlmProviderSettings];
      const hasSelectedModelOption =
        provider.selectedModelOption !== defaultProvider.selectedModelOption;
      const hasEnabledModelOptions =
        JSON.stringify(provider.enabledModelOptions ?? []) !==
        JSON.stringify(defaultProvider.enabledModelOptions ?? []);

      if (!hasSelectedModelOption && !hasEnabledModelOptions) {
        return [];
      }

      return [[
        providerId,
        {
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
        const hasCustomBaseUrl = cleanText(provider.baseUrl) !== defaultProvider.baseUrl;
        const hasCustomModel = cleanText(provider.model) !== defaultProvider.model;
        const hasModels =
          JSON.stringify(provider.models) !== JSON.stringify(defaultProvider.models);

        if (!hasCustomBaseUrl && !hasCustomModel && !hasModels) {
          return [];
        }

        return [[
          providerId,
          {
            baseUrl: provider.baseUrl,
            model: provider.model,
            models: provider.models,
          },
        ]];
      }),
  );

  return {
    ...settings,
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

function getProviderApiKey(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }

  return cleanText((payload as { apiKey?: unknown }).apiKey);
}

function hasProviderApiKeyProperty(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && 'apiKey' in payload);
}

function removeProviderApiKeyProperty<T>(payload: T): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const { apiKey: _apiKey, ...rest } = payload as T & { apiKey?: unknown };
  return rest as T;
}

function removeProviderApiKeysFromProviders<T extends Record<string, unknown>>(providers: T): T {
  return Object.fromEntries(
    Object.entries(providers).map(([providerId, provider]) => [
      providerId,
      removeProviderApiKeyProperty(provider),
    ]),
  ) as T;
}

function removeProviderApiKeysFromPayload(
  payload: Partial<StoredAppSettings>,
): Partial<StoredAppSettings> {
  return {
    ...payload,
    ...(payload.llm
      ? {
          llm: {
            ...payload.llm,
            providers: removeProviderApiKeysFromProviders(payload.llm.providers ?? {}),
          },
        }
      : {}),
    ...(payload.translation
      ? {
          translation: {
            ...payload.translation,
            providers: removeProviderApiKeysFromProviders(payload.translation.providers ?? {}),
          },
        }
      : {}),
    ...(payload.rag
      ? {
          rag: {
            ...payload.rag,
            providers: removeProviderApiKeysFromProviders(payload.rag.providers ?? {}),
          },
        }
      : {}),
  };
}

async function persistProviderApiKey(
  providerApiKeySecretStorage: IProviderApiKeySecretStorage,
  scope: ProviderApiKeyScope,
  providerId: string,
  apiKey: string,
): Promise<void> {
  await providerApiKeySecretStorage.setApiKey({ scope, providerId }, apiKey);
}

async function persistProviderApiKeys(
  providerApiKeySecretStorage: IProviderApiKeySecretStorage,
  settings: StoredAppSettings,
): Promise<void> {
  await Promise.all([
    ...Object.entries(settings.llm.providers).map(([providerId, provider]) =>
      persistProviderApiKey(providerApiKeySecretStorage, 'llm', providerId, provider.apiKey)),
    ...Object.entries(settings.translation.providers).map(([providerId, provider]) =>
      persistProviderApiKey(providerApiKeySecretStorage, 'translation', providerId, provider.apiKey)),
    ...Object.entries(settings.rag.providers).map(([providerId, provider]) =>
      persistProviderApiKey(providerApiKeySecretStorage, 'rag', providerId, provider.apiKey)),
  ]);
}

async function mergeProviderApiKeys(
  providerApiKeySecretStorage: IProviderApiKeySecretStorage,
  settings: StoredAppSettings,
): Promise<StoredAppSettings> {
  const llmEntries = await Promise.all(
    Object.entries(settings.llm.providers).map(async ([providerId, provider]) => [
      providerId,
      {
        ...provider,
        apiKey: await providerApiKeySecretStorage.getApiKey({ scope: 'llm', providerId }),
      },
    ] as const),
  );
  const translationEntries = await Promise.all(
    Object.entries(settings.translation.providers).map(async ([providerId, provider]) => [
      providerId,
      {
        ...provider,
        apiKey: await providerApiKeySecretStorage.getApiKey({ scope: 'translation', providerId }),
      },
    ] as const),
  );
  const ragEntries = await Promise.all(
    Object.entries(settings.rag.providers).map(async ([providerId, provider]) => [
      providerId,
      {
        ...provider,
        apiKey: await providerApiKeySecretStorage.getApiKey({ scope: 'rag', providerId }),
      },
    ] as const),
  );

  return {
    ...settings,
    llm: {
      ...settings.llm,
      providers: Object.fromEntries(llmEntries) as StoredAppSettings['llm']['providers'],
    },
    translation: {
      ...settings.translation,
      providers: Object.fromEntries(translationEntries) as StoredAppSettings['translation']['providers'],
    },
    rag: {
      ...settings.rag,
      providers: Object.fromEntries(ragEntries) as StoredAppSettings['rag']['providers'],
    },
  };
}

async function migrateProviderApiKeys(
  providerApiKeySecretStorage: IProviderApiKeySecretStorage,
  payload: Partial<StoredAppSettings>,
): Promise<boolean> {
  let migrated = false;

  for (const [providerId, provider] of Object.entries(payload.llm?.providers ?? {})) {
    if (hasProviderApiKeyProperty(provider)) {
      migrated = true;
      const apiKey = getProviderApiKey(provider);
      if (apiKey) {
        await persistProviderApiKey(providerApiKeySecretStorage, 'llm', providerId, apiKey);
      }
    }
  }
  for (const [providerId, provider] of Object.entries(payload.translation?.providers ?? {})) {
    if (hasProviderApiKeyProperty(provider)) {
      migrated = true;
      const apiKey = getProviderApiKey(provider);
      if (apiKey) {
        await persistProviderApiKey(providerApiKeySecretStorage, 'translation', providerId, apiKey);
      }
    }
  }
  for (const [providerId, provider] of Object.entries(payload.rag?.providers ?? {})) {
    if (hasProviderApiKeyProperty(provider)) {
      migrated = true;
      const apiKey = getProviderApiKey(provider);
      if (apiKey) {
        await persistProviderApiKey(providerApiKeySecretStorage, 'rag', providerId, apiKey);
      }
    }
  }

  return migrated;
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

function normalizeJournalSourceOverrides(value: unknown): JournalSourceOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Map<string, JournalSourceOverride>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const url = cleanText(record.url);
    if (!url) {
      continue;
    }

    const override: JournalSourceOverride = {
      url,
    };
    const journalTitle = cleanText(record.journalTitle);
    if (journalTitle) {
      override.journalTitle = journalTitle;
    }

    deduped.set(url, override);
  }

  return [...deduped.values()];
}

function resolveUserJournalSourceOverrides(userSettings: Partial<UserSettings>) {
  if (Array.isArray(userSettings['literature.journalSourceOverrides'])) {
    return normalizeJournalSourceOverrides(userSettings['literature.journalSourceOverrides']);
  }

  return normalizeJournalSourceOverrides(userSettings.journalSourceOverrides);
}

function resolveUserEditorDraftStyle(userSettings: Partial<UserSettings>) {
  if (userSettings['literature.editorDraftStyle'] !== undefined) {
    return normalizeEditorDraftStyleSettings(userSettings['literature.editorDraftStyle']);
  }

  return null;
}

function normalizeSettings(
  payload: Partial<StoredAppSettings> = {},
  defaultLocale: 'zh' | 'en',
  defaultUserSettingsFile?: string,
): StoredAppSettings {
  const downloadDir = typeof payload.defaultDownloadDir === 'string' ? cleanText(payload.defaultDownloadDir) : '';
  const parsedLimit = Number.parseInt(String(payload.defaultBatchLimit), 10);
  const normalizedLimit = Number.isNaN(parsedLimit)
    ? defaultBatchLimit
    : Math.min(batchLimitMax, Math.max(batchLimitMin, parsedLimit));
  const parsedBrowserHistoryEntries = Number.parseInt(
    String(payload.browserMaxHistoryEntries),
    10,
  );
  const normalizedBrowserHistoryEntries = Number.isNaN(parsedBrowserHistoryEntries)
    ? defaultBrowserMaxHistoryEntries
    : Math.min(
        maxBrowserMaxHistoryEntries,
        Math.max(minBrowserMaxHistoryEntries, parsedBrowserHistoryEntries),
      );
  const browserPageZoom =
    typeof payload.browserPageZoom === 'string' && payload.browserPageZoom.trim()
      ? payload.browserPageZoom.trim()
      : defaultBrowserPageZoom;
  const browserSearchEngine =
    typeof payload.browserSearchEngine === 'string' && payload.browserSearchEngine.trim()
      ? payload.browserSearchEngine.trim()
      : defaultBrowserSearchEngine;

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
    browserMaxHistoryEntries: normalizedBrowserHistoryEntries,
    browserPageZoom,
    browserSearchEngine,
    defaultBatchLimit: normalizedLimit,
    journalSourceOverrides: normalizeJournalSourceOverrides(payload.journalSourceOverrides),
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
    startupLayout: payload.startupLayout === 'agent' ? 'agent' : 'flow',
    useMica: typeof payload.useMica === 'boolean' ? payload.useMica : true,
    theme: normalizeTheme(payload.theme),
    'workbench.colorCustomizations': normalizeThemeColorCustomizations(payload['workbench.colorCustomizations']),
    locale: normalizeLocale(payload.locale, defaultLocale),
    userSettingsPathOverride: defaultUserSettingsFile
      ? normalizeUserSettingsPathOverride(payload.userSettingsPathOverride, defaultUserSettingsFile)
      : cleanText(typeof payload.userSettingsPathOverride === 'string' ? payload.userSettingsPathOverride : '') || null,
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
      custom: normalizeTranslationProviderSettings('custom', providersPayload.custom),
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
    model: cleanText(providerPayload.model) || defaults.model,
    models: normalizeTranslationProviderModels(providerPayload.models),
  };
}

function normalizeTranslationProviderModels(models: unknown): string[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return Array.from(new Set(models.map((model) => cleanText(model)).filter(Boolean)));
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

function attachConfigPath(
  settings: StoredAppSettings,
  configPath: string,
  defaultConfigPath: string,
): AppSettings {
  return {
    ...settings,
    editorDraftStyle: cloneEditorDraftStyleSettings(settings.editorDraftStyle),
    knowledgeBase: cloneKnowledgeBaseSettings(settings.knowledgeBase),
    configPath,
    defaultConfigPath,
  };
}

export function createConfigurationMainService(
  configFile: string,
  userSettingsFile: string,
  options: ConfigurationMainServiceOptions,
): AppSettingsConfigurationService {
  const defaultLocale = options.defaultLocale === 'zh' ? 'zh' : fallbackLocale;
  const { providerApiKeySecretStorage } = options;

  async function readSettings() {
    const payload = await readJson<Partial<StoredAppSettings>>(configFile, {});
    const migratedProviderApiKeys = await migrateProviderApiKeys(
      providerApiKeySecretStorage,
      payload,
    );
    const resolvedUserSettingsFile = resolveUserSettingsFilePath(payload, userSettingsFile);
    const { editorDraftStyle: _legacyEditorDraftStyle, ...configPayload } = payload;
    if (migratedProviderApiKeys) {
      await writeJson(configFile, removeProviderApiKeysFromPayload(configPayload));
    }
    await ensureUserSettingsFile(resolvedUserSettingsFile, payload);
    const userSettings = await readJson<Partial<UserSettings>>(resolvedUserSettingsFile, {});
    const userEditorDraftStyle = resolveUserEditorDraftStyle(userSettings);
    const normalized = normalizeSettings(
      {
        ...configPayload,
        journalSourceOverrides: resolveUserJournalSourceOverrides(userSettings),
        ...(userEditorDraftStyle ? { editorDraftStyle: userEditorDraftStyle } : {}),
      },
      defaultLocale,
      userSettingsFile,
    );
    const withProviderApiKeys = await mergeProviderApiKeys(
      providerApiKeySecretStorage,
      normalized,
    );
    return attachConfigPath(withProviderApiKeys, resolvedUserSettingsFile, userSettingsFile);
  }

  return {
    async loadSettings() {
      return readSettings();
    },

    async saveSettings(settings = {}) {
      const current = await readSettings();
      const { configPath: _configPath, ...currentStored } = current;
      const saved = normalizeSettings(
        {
          ...currentStored,
          ...settings,
          journalSourceOverrides: [],
        },
        defaultLocale,
        userSettingsFile,
      );
      await persistProviderApiKeys(providerApiKeySecretStorage, saved);
      const targetUserSettingsFile =
        resolveUserSettingsFilePath(saved, userSettingsFile);
      const { editorDraftStyle, ...savedConfig } = saved;
      await writeJson(configFile, savedConfig);
      await ensureUserSettingsFile(targetUserSettingsFile, {
        ...saved,
        journalSourceOverrides: currentStored.journalSourceOverrides,
      });
      await writeUserSettingsEditorDraftStyle(targetUserSettingsFile, editorDraftStyle);
      return readSettings();
    },
  };
}
