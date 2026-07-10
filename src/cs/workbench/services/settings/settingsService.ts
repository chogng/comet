import type {
  AppStartupLayout,
  AppTheme,
  AppSettings as DesktopAppSettings,
  KnowledgeBaseSettings,
  LlmSettings,
  RagSettings,
  ThemeColorCustomizations,
  TranslationSettings,
  StoredAppSettings as DesktopStoredAppSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  defaultBrowserMaxHistoryEntries,
  defaultBrowserPageZoom,
  defaultBrowserSearchEngine,
  maxBrowserMaxHistoryEntries,
  minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
  cloneEditorDraftStyleSettings,
  createDefaultEditorDraftStyleSettings,
  normalizeEditorDraftStyleSettings,
  areEditorDraftStyleSettingsEqual,
  type EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import type { Locale } from 'language/i18n';
import { defaultBatchLimit, normalizeBatchLimit } from 'cs/workbench/services/config/configSchema';
import {
  createSettingValue,
  type SettingValue,
} from 'cs/workbench/services/settings/settingValue';

import {
  cloneKnowledgeBaseSettings,
  createDefaultKnowledgeBaseSettings,
} from 'cs/workbench/services/knowledgeBase/config';
import { cloneLlmSettings, createDefaultLlmSettings } from 'cs/workbench/services/llm/config';
import { cloneRagSettings, createDefaultRagSettings } from 'cs/workbench/services/rag/config';
import { cloneTranslationSettings, createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';

export type StoredAppSettingsPayload = DesktopStoredAppSettings;
export type AppSettingsPayload = DesktopAppSettings;

export type ResolvedSettingsState = {
  pdfDownloadDir: string;
  knowledgeBasePdfDownloadDir: string;
  pdfFileNameUseSelectionOrder: boolean;
  browserTabKeepAliveLimit: number;
  browserMaxHistoryEntries: number;
  browserPageZoom: string;
  browserSearchEngine: string;
  batchLimit: number;
  systemNotificationsEnabled: boolean;
  warningNotificationsEnabled: boolean;
  menuBarIconEnabled: boolean;
  completionNotificationsEnabled: boolean;
  statusbarVisible: boolean;
  startupLayout: AppStartupLayout;
  useMica: boolean;
  theme: AppTheme;
  workbenchColorCustomizations: ThemeColorCustomizations;
  locale: Locale | null;
  configPath: string;
  defaultConfigPath: string;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  llm: LlmSettings;
  translation: TranslationSettings;
  knowledgeBase: KnowledgeBaseSettings;
  rag: RagSettings;
};

export type SaveSettingsDraft = {
  pdfDownloadDir: string;
  knowledgeBasePdfDownloadDir: string;
  pdfFileNameUseSelectionOrder: boolean;
  browserTabKeepAliveLimit: number;
  browserMaxHistoryEntries: number;
  browserPageZoom: string;
  browserSearchEngine: string;
  batchLimit: number;
  systemNotificationsEnabled: boolean;
  warningNotificationsEnabled: boolean;
  menuBarIconEnabled: boolean;
  completionNotificationsEnabled: boolean;
  statusbarVisible: boolean;
  startupLayout: AppStartupLayout;
  useMica: boolean;
  theme: AppTheme;
  workbenchColorCustomizations: ThemeColorCustomizations;
  locale: Locale;
  configPath: string;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  llm: LlmSettings;
  translation: TranslationSettings;
  knowledgeBase: KnowledgeBaseSettings;
  rag: RagSettings;
};

export type SaveSettingsPayloadBuild = {
  nextDir: string;
  nextBatchLimit: number;
  payload: PartialSettingsPayload;
};

export type PartialSettingsPayload = Partial<StoredAppSettingsPayload>;

export function resolveSettingsState(
  loaded: Partial<AppSettingsPayload>,
  options: { fallbackConfigPath?: string } = {},
): ResolvedSettingsState {
  const loadedLocale = loaded.locale === 'zh' || loaded.locale === 'en' ? loaded.locale : null;
  const loadedConfigPath =
    typeof loaded.configPath === 'string' ? loaded.configPath : (options.fallbackConfigPath ?? '');
  const loadedDefaultConfigPath =
    typeof loaded.defaultConfigPath === 'string' ? loaded.defaultConfigPath : loadedConfigPath;
  const parsedBrowserHistoryEntries = Number.parseInt(
    String(loaded.browserMaxHistoryEntries),
    10,
  );
  const browserMaxHistoryEntries = Number.isNaN(parsedBrowserHistoryEntries)
    ? defaultBrowserMaxHistoryEntries
    : Math.min(
        maxBrowserMaxHistoryEntries,
        Math.max(minBrowserMaxHistoryEntries, parsedBrowserHistoryEntries),
      );

  const defaultEditorDraftStyle = createDefaultEditorDraftStyleSettings();
  const normalizedUserEditorDraftStyle =
    loaded.editorDraftStyle === undefined
      ? null
      : normalizeEditorDraftStyleSettings(loaded.editorDraftStyle);
  const editorDraftStyle = createSettingValue(
    defaultEditorDraftStyle,
    normalizedUserEditorDraftStyle,
    cloneEditorDraftStyleSettings,
  );

  return {
    pdfDownloadDir: typeof loaded.defaultDownloadDir === 'string' ? loaded.defaultDownloadDir : '',
    knowledgeBasePdfDownloadDir:
      typeof loaded.knowledgeBase?.downloadDirectory === 'string'
        ? loaded.knowledgeBase.downloadDirectory
        : '',
    pdfFileNameUseSelectionOrder:
      typeof loaded.pdfFileNameUseSelectionOrder === 'boolean'
        ? loaded.pdfFileNameUseSelectionOrder
        : false,
    browserTabKeepAliveLimit: normalizeBrowserTabKeepAliveLimit(
      loaded.browserTabKeepAliveLimit,
      defaultBrowserTabKeepAliveLimit,
    ),
    browserMaxHistoryEntries,
    browserPageZoom:
      typeof loaded.browserPageZoom === 'string' && loaded.browserPageZoom.trim()
        ? loaded.browserPageZoom.trim()
        : defaultBrowserPageZoom,
    browserSearchEngine:
      typeof loaded.browserSearchEngine === 'string' && loaded.browserSearchEngine.trim()
        ? loaded.browserSearchEngine.trim()
        : defaultBrowserSearchEngine,
    batchLimit: normalizeBatchLimit(loaded.defaultBatchLimit, defaultBatchLimit),
    systemNotificationsEnabled:
      typeof loaded.systemNotificationsEnabled === 'boolean'
        ? loaded.systemNotificationsEnabled
        : true,
    warningNotificationsEnabled:
      typeof loaded.warningNotificationsEnabled === 'boolean'
        ? loaded.warningNotificationsEnabled
        : true,
    menuBarIconEnabled:
      typeof loaded.menuBarIconEnabled === 'boolean'
        ? loaded.menuBarIconEnabled
        : false,
    completionNotificationsEnabled:
      typeof loaded.completionNotificationsEnabled === 'boolean'
        ? loaded.completionNotificationsEnabled
        : true,
    statusbarVisible:
      typeof loaded.statusbarVisible === 'boolean'
        ? loaded.statusbarVisible
        : true,
    startupLayout: loaded.startupLayout === 'agent' ? 'agent' : 'flow',
    useMica: typeof loaded.useMica === 'boolean' ? loaded.useMica : true,
    theme:
      loaded.theme === 'dark' || loaded.theme === 'system'
        ? loaded.theme
        : 'light',
    workbenchColorCustomizations: { ...(loaded['workbench.colorCustomizations'] ?? {}) },
    locale: loadedLocale,
    configPath: loadedConfigPath,
    defaultConfigPath: loadedDefaultConfigPath,
    editorDraftStyle,
    llm: cloneLlmSettings(loaded.llm ?? createDefaultLlmSettings()),
    translation: cloneTranslationSettings(loaded.translation ?? createDefaultTranslationSettings()),
    knowledgeBase: cloneKnowledgeBaseSettings(
      loaded.knowledgeBase ?? createDefaultKnowledgeBaseSettings(),
    ),
    rag: cloneRagSettings(loaded.rag ?? createDefaultRagSettings()),
  };
}

export function buildSaveSettingsPayload(draft: SaveSettingsDraft): SaveSettingsPayloadBuild {
  const nextDir = draft.pdfDownloadDir.trim();
  const nextKnowledgeBaseDir = draft.knowledgeBasePdfDownloadDir.trim();
  const nextBatchLimit = normalizeBatchLimit(draft.batchLimit, defaultBatchLimit);
  const nextBrowserTabKeepAliveLimit = normalizeBrowserTabKeepAliveLimit(
    draft.browserTabKeepAliveLimit,
    defaultBrowserTabKeepAliveLimit,
  );
  const nextBrowserMaxHistoryEntries = Math.min(
    maxBrowserMaxHistoryEntries,
    Math.max(minBrowserMaxHistoryEntries, Math.trunc(draft.browserMaxHistoryEntries)),
  );

  const nextEditorDraftStyle =
    draft.editorDraftStyle.userValue &&
    !areEditorDraftStyleSettingsEqual(
      draft.editorDraftStyle.userValue,
      draft.editorDraftStyle.defaultValue,
    )
      ? cloneEditorDraftStyleSettings(draft.editorDraftStyle.userValue)
      : undefined;

  return {
    nextDir,
    nextBatchLimit,
    payload: {
      defaultDownloadDir: nextDir || null,
      pdfFileNameUseSelectionOrder: draft.pdfFileNameUseSelectionOrder,
      browserTabKeepAliveLimit: nextBrowserTabKeepAliveLimit,
      browserMaxHistoryEntries: nextBrowserMaxHistoryEntries,
      browserPageZoom: draft.browserPageZoom,
      browserSearchEngine: draft.browserSearchEngine,
      defaultBatchLimit: nextBatchLimit,
      systemNotificationsEnabled: draft.systemNotificationsEnabled,
      warningNotificationsEnabled: draft.warningNotificationsEnabled,
      menuBarIconEnabled: draft.menuBarIconEnabled,
      completionNotificationsEnabled: draft.completionNotificationsEnabled,
      statusbarVisible: draft.statusbarVisible,
      startupLayout: draft.startupLayout,
      useMica: draft.useMica,
      theme: draft.theme,
      'workbench.colorCustomizations': { ...draft.workbenchColorCustomizations },
      locale: draft.locale,
      userSettingsPathOverride: draft.configPath.trim() || null,
      editorDraftStyle: nextEditorDraftStyle,
      llm: cloneLlmSettings(draft.llm),
      translation: cloneTranslationSettings(draft.translation),
      knowledgeBase: cloneKnowledgeBaseSettings({
        ...draft.knowledgeBase,
        downloadDirectory: nextKnowledgeBaseDir || null,
      }),
      rag: cloneRagSettings(draft.rag),
    },
  };
}

export async function loadAppSettings(
  desktopRuntime: boolean,
  invokeDesktop: ElectronInvoke,
): Promise<Partial<AppSettingsPayload>> {
  if (!desktopRuntime) return {};
  return invokeDesktop('load_settings');
}

export async function saveAppSettings(
  desktopRuntime: boolean,
  invokeDesktop: ElectronInvoke,
  payload: PartialSettingsPayload,
): Promise<Partial<AppSettingsPayload>> {
  if (!desktopRuntime) return payload;
  return invokeDesktop('save_settings', { settings: payload });
}

export async function saveAppSettingsPartial(
  desktopRuntime: boolean,
  invokeDesktop: ElectronInvoke,
  payload: PartialSettingsPayload,
): Promise<Partial<AppSettingsPayload>> {
  if (!desktopRuntime) return payload;
  return invokeDesktop('save_settings', { settings: payload });
}
