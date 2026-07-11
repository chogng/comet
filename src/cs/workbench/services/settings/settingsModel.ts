import type {
  AppStartupLayout,
  AppTheme,
  LibraryStorageMode,
  LlmProviderId,
  LlmProviderSettings,
  RagProviderId,
  RagProviderSettings,
  ThemeColorCustomizations,
  TranslationProviderId,
  TranslationProviderSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
  areEditorDraftStyleSettingsEqual,
  cloneEditorDraftStyleSettings,
  createDefaultEditorDraftStyleSettings,
  type EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import { LatestAsyncOperation } from 'cs/base/common/async';
import { EventEmitter } from 'cs/base/common/event';
import type { Locale } from 'language/i18n';
import {
  areSettingValuesEqual,
  cloneSettingValue,
  createSettingValue,
  deriveUserSettingValue,
  type SettingValue,
} from 'cs/workbench/services/settings/settingValue';

import {
  buildSaveSettingsPayload,
  loadAppSettings,
  resolveSettingsState,
  saveAppSettings,
  saveAppSettingsPartial,
  type ResolvedSettingsState,
} from 'cs/workbench/services/settings/settingsService';
import {
  createDefaultKnowledgeBaseSettings,
} from 'cs/workbench/services/knowledgeBase/config';
import { cloneLlmSettings, createDefaultLlmSettings } from 'cs/workbench/services/llm/config';
import {
  getEnabledLlmModelOptionValuesForProvider,
  getLlmModelByIdForProvider,
  getPreferredReasoningEffort,
  isLlmModelIdForProvider,
  parseLlmModelOptionValue,
  serializeLlmModelOptionValue,
} from 'cs/workbench/services/llm/registry';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';
import { cloneRagSettings, createDefaultRagSettings } from 'cs/workbench/services/rag/config';
import { resolveRagRoute } from 'cs/workbench/services/rag/routing';
import { cloneTranslationSettings, createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';
import { defaultBrowserTabKeepAliveLimit } from 'cs/workbench/services/webContent/webContentRetentionConfig';
import {
  defaultBrowserMaxHistoryEntries,
  defaultBrowserPageZoom,
  defaultBrowserSearchEngine,
} from 'cs/base/parts/sandbox/common/browserSettings';

export type SettingsModelSnapshot = {
  pdfDownloadDir: string;
  knowledgeBasePdfDownloadDir: string;
  pdfFileNameUseSelectionOrder: boolean;
  browserTabKeepAliveLimit: number;
  browserMaxHistoryEntries: number;
  browserPageZoom: string;
  browserSearchEngine: string;
  systemNotificationsEnabled: boolean;
  warningNotificationsEnabled: boolean;
  menuBarIconEnabled: boolean;
  completionNotificationsEnabled: boolean;
  statusbarVisible: boolean;
  startupLayout: AppStartupLayout;
  useMica: boolean;
  theme: AppTheme;
  workbenchColorCustomizations: ThemeColorCustomizations;
  editorDraftStyle: SettingValue<EditorDraftStyleSettings>;
  knowledgeBaseEnabled: boolean;
  autoIndexDownloadedPdf: boolean;
  libraryStorageMode: LibraryStorageMode;
  libraryDirectory: string;
  maxConcurrentIndexJobs: number;
  activeRagProvider: RagProviderId;
  ragProviders: Record<RagProviderId, RagProviderSettings>;
  retrievalCandidateCount: number;
  retrievalTopK: number;
  activeLlmProvider: LlmProviderId;
  llmProviders: Record<LlmProviderId, LlmProviderSettings>;
  activeTranslationProvider: TranslationProviderId;
  translationProviders: Record<TranslationProviderId, TranslationProviderSettings>;
  configPath: string;
  defaultConfigPath: string;
  isSettingsLoading: boolean;
  hasLoadedSettings: boolean;
  isSettingsSaving: boolean;
  isTestingRagConnection: boolean;
  isTestingLlmConnection: boolean;
  isTestingTranslationConnection: boolean;
  isLoadingTranslationModels: boolean;
};

type SettingsModelContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
};

type SaveSettingsContext = SettingsModelContext & {
  locale: Locale;
};

function getSelectedProviderOptionValue(providerSettings: LlmProviderSettings) {
  return providerSettings.selectedModelOption;
}

export type ChoosePdfDownloadDirResult =
  | {
      kind: 'desktop-only';
    }
  | {
      kind: 'not-selected';
    }
  | {
      kind: 'selected';
      dir: string;
    };

export type LoadSettingsResult = {
  locale: Locale | null;
};

export type SaveSettingsResult = {
  nextDir: string;
  locale: Locale | null;
};

function areJsonEqual(previous: unknown, next: unknown) {
  return JSON.stringify(previous) === JSON.stringify(next);
}

function areSettingsModelSnapshotsEqual(
  previous: SettingsModelSnapshot,
  next: SettingsModelSnapshot,
) {
  return (
    previous.pdfDownloadDir === next.pdfDownloadDir &&
    previous.knowledgeBasePdfDownloadDir === next.knowledgeBasePdfDownloadDir &&
    previous.pdfFileNameUseSelectionOrder === next.pdfFileNameUseSelectionOrder &&
    previous.browserTabKeepAliveLimit === next.browserTabKeepAliveLimit &&
    previous.browserMaxHistoryEntries === next.browserMaxHistoryEntries &&
    previous.browserPageZoom === next.browserPageZoom &&
    previous.browserSearchEngine === next.browserSearchEngine &&
    previous.systemNotificationsEnabled === next.systemNotificationsEnabled &&
    previous.warningNotificationsEnabled === next.warningNotificationsEnabled &&
    previous.menuBarIconEnabled === next.menuBarIconEnabled &&
    previous.completionNotificationsEnabled === next.completionNotificationsEnabled &&
    previous.statusbarVisible === next.statusbarVisible &&
    previous.startupLayout === next.startupLayout &&
    previous.useMica === next.useMica &&
    previous.theme === next.theme &&
    areSettingValuesEqual(
      previous.editorDraftStyle,
      next.editorDraftStyle,
      areEditorDraftStyleSettingsEqual,
    ) &&
    previous.knowledgeBaseEnabled === next.knowledgeBaseEnabled &&
    previous.autoIndexDownloadedPdf === next.autoIndexDownloadedPdf &&
    previous.libraryStorageMode === next.libraryStorageMode &&
    previous.libraryDirectory === next.libraryDirectory &&
    previous.maxConcurrentIndexJobs === next.maxConcurrentIndexJobs &&
    previous.activeRagProvider === next.activeRagProvider &&
    previous.retrievalCandidateCount === next.retrievalCandidateCount &&
    previous.retrievalTopK === next.retrievalTopK &&
    previous.activeLlmProvider === next.activeLlmProvider &&
    previous.activeTranslationProvider === next.activeTranslationProvider &&
    previous.configPath === next.configPath &&
    previous.defaultConfigPath === next.defaultConfigPath &&
    previous.isSettingsLoading === next.isSettingsLoading &&
    previous.hasLoadedSettings === next.hasLoadedSettings &&
    previous.isSettingsSaving === next.isSettingsSaving &&
    previous.isTestingRagConnection === next.isTestingRagConnection &&
    previous.isTestingLlmConnection === next.isTestingLlmConnection &&
    previous.isTestingTranslationConnection === next.isTestingTranslationConnection &&
    previous.isLoadingTranslationModels === next.isLoadingTranslationModels &&
    areJsonEqual(previous.workbenchColorCustomizations, next.workbenchColorCustomizations) &&
    areJsonEqual(previous.ragProviders, next.ragProviders) &&
    areJsonEqual(previous.llmProviders, next.llmProviders) &&
    areJsonEqual(previous.translationProviders, next.translationProviders)
  );
}

function createInitialSettingsModelSnapshot(): SettingsModelSnapshot {
  const defaultKnowledgeBaseSettings = createDefaultKnowledgeBaseSettings();
  const defaultRagSettings = createDefaultRagSettings();
  const defaultLlmSettings = createDefaultLlmSettings();
  const defaultTranslationSettings = createDefaultTranslationSettings();

  return {
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    browserTabKeepAliveLimit: defaultBrowserTabKeepAliveLimit,
    browserMaxHistoryEntries: defaultBrowserMaxHistoryEntries,
    browserPageZoom: defaultBrowserPageZoom,
    browserSearchEngine: defaultBrowserSearchEngine,
    systemNotificationsEnabled: true,
    warningNotificationsEnabled: true,
    menuBarIconEnabled: false,
    completionNotificationsEnabled: true,
    statusbarVisible: true,
    startupLayout: 'flow',
    useMica: true,
    theme: 'light',
    workbenchColorCustomizations: {},
    editorDraftStyle: createSettingValue(
      createDefaultEditorDraftStyleSettings(),
      null,
      cloneEditorDraftStyleSettings,
    ),
    knowledgeBaseEnabled: defaultKnowledgeBaseSettings.enabled,
    autoIndexDownloadedPdf: defaultKnowledgeBaseSettings.autoIndexDownloadedPdf,
    libraryStorageMode: defaultKnowledgeBaseSettings.libraryStorageMode,
    libraryDirectory: '',
    maxConcurrentIndexJobs: defaultKnowledgeBaseSettings.maxConcurrentIndexJobs,
    activeRagProvider: defaultRagSettings.activeProvider,
    ragProviders: cloneRagSettings(defaultRagSettings).providers,
    retrievalCandidateCount: defaultRagSettings.retrievalCandidateCount,
    retrievalTopK: defaultRagSettings.retrievalTopK,
    activeLlmProvider: defaultLlmSettings.activeProvider,
    llmProviders: defaultLlmSettings.providers,
    activeTranslationProvider: defaultTranslationSettings.activeProvider,
    translationProviders: defaultTranslationSettings.providers,
    configPath: '',
    defaultConfigPath: '',
    isSettingsLoading: false,
    hasLoadedSettings: false,
    isSettingsSaving: false,
    isTestingRagConnection: false,
    isTestingLlmConnection: false,
    isTestingTranslationConnection: false,
    isLoadingTranslationModels: false,
  };
}

export class SettingsModel {
  private snapshot: SettingsModelSnapshot;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private readonly saveOperation = new LatestAsyncOperation();
  private readonly explicitSaveOperation = new LatestAsyncOperation();

  constructor() {
    this.snapshot = createInitialSettingsModelSnapshot();
  }

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setSnapshot(nextSnapshot: SettingsModelSnapshot) {
    if (
      Object.is(this.snapshot, nextSnapshot) ||
      areSettingsModelSnapshotsEqual(this.snapshot, nextSnapshot)
    ) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.emitChange();
  }

  private updateSnapshot(
    updater: (snapshot: SettingsModelSnapshot) => SettingsModelSnapshot,
  ) {
    this.setSnapshot(updater(this.snapshot));
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setSystemNotificationsEnabled = (systemNotificationsEnabled: boolean) => {
    if (this.snapshot.systemNotificationsEnabled === systemNotificationsEnabled) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      systemNotificationsEnabled,
    }));
  };

  readonly setWarningNotificationsEnabled = (warningNotificationsEnabled: boolean) => {
    if (this.snapshot.warningNotificationsEnabled === warningNotificationsEnabled) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      warningNotificationsEnabled,
    }));
  };

  readonly setMenuBarIconEnabled = (menuBarIconEnabled: boolean) => {
    if (this.snapshot.menuBarIconEnabled === menuBarIconEnabled) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      menuBarIconEnabled,
    }));
  };

  readonly setCompletionNotificationsEnabled = (completionNotificationsEnabled: boolean) => {
    if (this.snapshot.completionNotificationsEnabled === completionNotificationsEnabled) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      completionNotificationsEnabled,
    }));
  };

  readonly setUseMica = (useMica: boolean) => {
    if (this.snapshot.useMica === useMica) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      useMica,
    }));
  };

  readonly setStatusbarVisible = (statusbarVisible: boolean) => {
    if (this.snapshot.statusbarVisible === statusbarVisible) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      statusbarVisible,
    }));
  };

  readonly setStartupLayout = (startupLayout: AppStartupLayout) => {
    if (this.snapshot.startupLayout === startupLayout) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      startupLayout,
    }));
  };

  readonly setTheme = (theme: AppTheme) => {
    if (this.snapshot.theme === theme) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      theme,
    }));
  };

  readonly setEditorDraftStyle = (editorDraftStyle: EditorDraftStyleSettings) => {
    this.updateSnapshot((snapshot) => {
      const normalizedEditorDraftStyle = cloneEditorDraftStyleSettings(editorDraftStyle);
      const nextEditorDraftStyle = createSettingValue(
        snapshot.editorDraftStyle.defaultValue,
        deriveUserSettingValue(
          snapshot.editorDraftStyle.defaultValue,
          normalizedEditorDraftStyle,
          cloneEditorDraftStyleSettings,
          areEditorDraftStyleSettingsEqual,
        ),
        cloneEditorDraftStyleSettings,
      );
      if (
        areSettingValuesEqual(
          snapshot.editorDraftStyle,
          nextEditorDraftStyle,
          areEditorDraftStyleSettingsEqual,
        )
      ) {
        return snapshot;
      }

      return {
        ...snapshot,
        editorDraftStyle: nextEditorDraftStyle,
      };
    });
  };

  readonly setKnowledgeBaseEnabled = (knowledgeBaseEnabled: boolean) => {
    if (this.snapshot.knowledgeBaseEnabled === knowledgeBaseEnabled) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      knowledgeBaseEnabled,
    }));
  };

  readonly setAutoIndexDownloadedPdf = (autoIndexDownloadedPdf: boolean) => {
    if (this.snapshot.autoIndexDownloadedPdf === autoIndexDownloadedPdf) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      autoIndexDownloadedPdf,
    }));
  };

  readonly setLibraryStorageMode = (libraryStorageMode: LibraryStorageMode) => {
    if (this.snapshot.libraryStorageMode === libraryStorageMode) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      libraryStorageMode,
    }));
  };

  readonly setLibraryDirectory = (libraryDirectory: string) => {
    if (this.snapshot.libraryDirectory === libraryDirectory) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      libraryDirectory,
    }));
  };

  readonly setMaxConcurrentIndexJobs = (maxConcurrentIndexJobs: number) => {
    if (this.snapshot.maxConcurrentIndexJobs === maxConcurrentIndexJobs) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      maxConcurrentIndexJobs,
    }));
  };

  readonly setActiveRagProvider = (activeRagProvider: RagProviderId) => {
    if (this.snapshot.activeRagProvider === activeRagProvider) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      activeRagProvider,
    }));
  };

  readonly setRagProviderApiKey = (provider: RagProviderId, apiKey: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      ragProviders: {
        ...snapshot.ragProviders,
        [provider]: {
          ...snapshot.ragProviders[provider],
          apiKey,
        },
      },
    }));
  };

  readonly setRagProviderBaseUrl = (provider: RagProviderId, baseUrl: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      ragProviders: {
        ...snapshot.ragProviders,
        [provider]: {
          ...snapshot.ragProviders[provider],
          baseUrl,
        },
      },
    }));
  };

  readonly setRagProviderEmbeddingModel = (provider: RagProviderId, embeddingModel: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      ragProviders: {
        ...snapshot.ragProviders,
        [provider]: {
          ...snapshot.ragProviders[provider],
          embeddingModel,
        },
      },
    }));
  };

  readonly setRagProviderRerankerModel = (provider: RagProviderId, rerankerModel: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      ragProviders: {
        ...snapshot.ragProviders,
        [provider]: {
          ...snapshot.ragProviders[provider],
          rerankerModel,
        },
      },
    }));
  };

  readonly setRagProviderEmbeddingPath = (provider: RagProviderId, embeddingPath: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      ragProviders: {
        ...snapshot.ragProviders,
        [provider]: {
          ...snapshot.ragProviders[provider],
          embeddingPath,
        },
      },
    }));
  };

  readonly setRagProviderRerankPath = (provider: RagProviderId, rerankPath: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      ragProviders: {
        ...snapshot.ragProviders,
        [provider]: {
          ...snapshot.ragProviders[provider],
          rerankPath,
        },
      },
    }));
  };

  readonly setRetrievalCandidateCount = (retrievalCandidateCount: number) => {
    if (this.snapshot.retrievalCandidateCount === retrievalCandidateCount) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      retrievalCandidateCount,
      retrievalTopK: Math.min(retrievalCandidateCount, snapshot.retrievalTopK),
    }));
  };

  readonly setRetrievalTopK = (retrievalTopK: number) => {
    if (this.snapshot.retrievalTopK === retrievalTopK) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      retrievalTopK: Math.min(snapshot.retrievalCandidateCount, retrievalTopK),
    }));
  };

  readonly setPdfDownloadDir = (pdfDownloadDir: string) => {
    if (this.snapshot.pdfDownloadDir === pdfDownloadDir) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      pdfDownloadDir,
    }));
  };

  readonly setKnowledgeBasePdfDownloadDir = (
    knowledgeBasePdfDownloadDir: string,
  ) => {
    if (this.snapshot.knowledgeBasePdfDownloadDir === knowledgeBasePdfDownloadDir) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      knowledgeBasePdfDownloadDir,
    }));
  };

  readonly setConfigPath = (configPath: string) => {
    if (this.snapshot.configPath === configPath) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      configPath,
    }));
  };

  readonly setPdfFileNameUseSelectionOrder = (pdfFileNameUseSelectionOrder: boolean) => {
    if (this.snapshot.pdfFileNameUseSelectionOrder === pdfFileNameUseSelectionOrder) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      pdfFileNameUseSelectionOrder,
    }));
  };

  readonly setBrowserTabKeepAliveLimit = (browserTabKeepAliveLimit: number) => {
    if (this.snapshot.browserTabKeepAliveLimit === browserTabKeepAliveLimit) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      browserTabKeepAliveLimit,
    }));
  };

  readonly setBrowserMaxHistoryEntries = (browserMaxHistoryEntries: number) => {
    if (this.snapshot.browserMaxHistoryEntries === browserMaxHistoryEntries) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      browserMaxHistoryEntries,
    }));
  };

  readonly setBrowserPageZoom = (browserPageZoom: string) => {
    if (this.snapshot.browserPageZoom === browserPageZoom) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      browserPageZoom,
    }));
  };

  readonly setBrowserSearchEngine = (browserSearchEngine: string) => {
    if (this.snapshot.browserSearchEngine === browserSearchEngine) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      browserSearchEngine,
    }));
  };

  readonly setActiveLlmProvider = (activeLlmProvider: LlmProviderId) => {
    if (this.snapshot.activeLlmProvider === activeLlmProvider) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      activeLlmProvider,
    }));
  };

  readonly setLlmProviderApiKey = (provider: LlmProviderId, apiKey: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      llmProviders: {
        ...snapshot.llmProviders,
        [provider]: {
          ...snapshot.llmProviders[provider],
          apiKey,
        },
      },
    }));
  };

  readonly setLlmProviderUseMaxContextWindow = (
    provider: LlmProviderId,
    useMaxContextWindow: boolean,
  ) => {
    this.updateSnapshot((snapshot) => {
      const providerSettings = snapshot.llmProviders[provider];
      if ((providerSettings.useMaxContextWindow ?? false) === useMaxContextWindow) {
        return snapshot;
      }

      return {
        ...snapshot,
        llmProviders: {
          ...snapshot.llmProviders,
          [provider]: {
            ...providerSettings,
            useMaxContextWindow,
          },
        },
      };
    });
  };

  readonly setLlmProviderModel = (provider: LlmProviderId, model: string) => {
    if (!isLlmModelIdForProvider(provider, model)) {
      return;
    }

    this.updateSnapshot((snapshot) => {
      const providerSettings = snapshot.llmProviders[provider];
      const enabledModelOptions = getEnabledLlmModelOptionValuesForProvider(
        provider,
        providerSettings.enabledModelOptions,
      );
      const currentSelection = getSelectedProviderOptionValue(providerSettings)
        ? parseLlmModelOptionValue(getSelectedProviderOptionValue(providerSettings))
        : null;
      const currentRequestedEffort =
        currentSelection?.providerId === provider && currentSelection.modelId === model
          ? currentSelection.reasoningEffort
          : undefined;
      const currentServiceTier =
        currentSelection?.providerId === provider && currentSelection.modelId === model
          ? currentSelection.serviceTier
          : undefined;
      const nextModelOptions = enabledModelOptions
        .map((value) => parseLlmModelOptionValue(value))
        .filter((option): option is NonNullable<typeof option> =>
          Boolean(option && option.providerId === provider && option.modelId === model),
        );
      const nextReasoningEffort = getPreferredReasoningEffort(
        getLlmModelByIdForProvider(provider, model) ?? {
          id: model,
          label: model,
          description: model,
          provider,
          apiStyle: 'openai-compatible',
          recommendedTasks: [],
          enabled: true,
        },
        currentRequestedEffort,
      );
      const preferredOption = nextModelOptions.find(
        (option) => option.reasoningEffort === nextReasoningEffort,
      );
      const nextSelectedModelOption =
        preferredOption
          ? serializeLlmModelOptionValue(
              provider,
              preferredOption.modelId,
              preferredOption.reasoningEffort,
              preferredOption.serviceTier ?? currentServiceTier,
            )
          : nextModelOptions[0]
            ? serializeLlmModelOptionValue(
                provider,
                nextModelOptions[0].modelId,
                nextModelOptions[0].reasoningEffort,
                nextModelOptions[0].serviceTier ?? currentServiceTier,
              )
            : '';

      if (providerSettings.selectedModelOption === nextSelectedModelOption) {
        return snapshot;
      }

      return {
        ...snapshot,
        llmProviders: {
          ...snapshot.llmProviders,
          [provider]: {
            ...providerSettings,
            selectedModelOption: nextSelectedModelOption,
          },
        },
      };
    });
  };

  readonly setLlmProviderReasoningEffort = (
    provider: LlmProviderId,
    reasoningEffort: import('cs/workbench/services/llm/types').LlmReasoningEffort | undefined,
  ) => {
    this.updateSnapshot((snapshot) => {
      const providerSettings = snapshot.llmProviders[provider];
      const selectedOption = getSelectedProviderOptionValue(providerSettings)
        ? parseLlmModelOptionValue(getSelectedProviderOptionValue(providerSettings))
        : null;
      if (!selectedOption || selectedOption.providerId !== provider) {
        return snapshot;
      }

      const model = getLlmModelByIdForProvider(provider, selectedOption.modelId);
      if (!model) {
        return snapshot;
      }
      const nextReasoningEffort = getPreferredReasoningEffort(model, reasoningEffort);
      const nextSelectedModelOption = serializeLlmModelOptionValue(
        provider,
        selectedOption.modelId,
        nextReasoningEffort,
        selectedOption.serviceTier,
      );
      if (providerSettings.selectedModelOption === nextSelectedModelOption) {
        return snapshot;
      }

      return {
        ...snapshot,
        llmProviders: {
          ...snapshot.llmProviders,
          [provider]: {
            ...providerSettings,
            selectedModelOption: nextSelectedModelOption,
          },
        },
      };
    });
  };

  readonly setLlmProviderSelectedModelOption = (
    provider: LlmProviderId,
    optionValue: string,
  ) => {
    const parsedOption = parseLlmModelOptionValue(optionValue);
    if (!parsedOption || parsedOption.providerId !== provider) {
      return;
    }

    this.updateSnapshot((snapshot) => {
      const providerSettings = snapshot.llmProviders[provider];
      const enabledModelOptions = getEnabledLlmModelOptionValuesForProvider(
        provider,
        providerSettings.enabledModelOptions,
      );
      const nextSelectedModelOption = enabledModelOptions.includes(optionValue) ? optionValue : '';
      if (providerSettings.selectedModelOption === nextSelectedModelOption) {
        return snapshot;
      }

      return {
        ...snapshot,
        llmProviders: {
          ...snapshot.llmProviders,
          [provider]: {
            ...providerSettings,
            selectedModelOption: nextSelectedModelOption,
          },
        },
      };
    });
  };

  readonly setLlmProviderModelEnabled = (
    provider: LlmProviderId,
    optionValue: string,
    enabled: boolean,
  ) => {
    const parsedOption = parseLlmModelOptionValue(optionValue);
    if (!parsedOption || parsedOption.providerId !== provider) {
      return;
    }

    this.updateSnapshot((snapshot) => {
      const providerSettings = snapshot.llmProviders[provider];
      const currentEnabledModels = getEnabledLlmModelOptionValuesForProvider(
        provider,
        providerSettings.enabledModelOptions,
      );
      const isCurrentlyEnabled = currentEnabledModels.includes(optionValue);
      if (isCurrentlyEnabled === enabled) {
        return snapshot;
      }

      const currentEnabledSet = new Set(currentEnabledModels);
      const nextEnabledModels = getEnabledLlmModelOptionValuesForProvider(provider).filter(
        (value) =>
          enabled
            ? currentEnabledSet.has(value) || value === optionValue
            : currentEnabledSet.has(value) && value !== optionValue,
      );
      const currentSelectionValue = providerSettings.selectedModelOption;
      const nextSelection =
        (currentSelectionValue && nextEnabledModels.includes(currentSelectionValue)
          ? parseLlmModelOptionValue(currentSelectionValue)
          : null) ??
        (nextEnabledModels[0] ? parseLlmModelOptionValue(nextEnabledModels[0]) : null);

      return {
        ...snapshot,
        llmProviders: {
          ...snapshot.llmProviders,
          [provider]: {
            ...providerSettings,
            selectedModelOption: nextSelection
              ? serializeLlmModelOptionValue(
                  provider,
                  nextSelection.modelId,
                  nextSelection.reasoningEffort,
                  nextSelection.serviceTier,
                )
              : '',
            enabledModelOptions: nextEnabledModels,
          },
        },
      };
    });
  };

  readonly setActiveTranslationProvider = (activeTranslationProvider: TranslationProviderId) => {
    if (this.snapshot.activeTranslationProvider === activeTranslationProvider) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      activeTranslationProvider,
    }));
  };

  readonly setTranslationProviderApiKey = (provider: TranslationProviderId, apiKey: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      translationProviders: {
        ...snapshot.translationProviders,
        [provider]: {
          ...snapshot.translationProviders[provider],
          apiKey,
          models: provider === 'custom' ? [] : snapshot.translationProviders[provider].models,
        },
      },
    }));
  };

  readonly setTranslationProviderBaseUrl = (provider: TranslationProviderId, baseUrl: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      translationProviders: {
        ...snapshot.translationProviders,
        [provider]: {
          ...snapshot.translationProviders[provider],
          baseUrl,
          models: provider === 'custom' ? [] : snapshot.translationProviders[provider].models,
        },
      },
    }));
  };

  readonly setTranslationProviderModel = (provider: TranslationProviderId, model: string) => {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      translationProviders: {
        ...snapshot.translationProviders,
        [provider]: {
          ...snapshot.translationProviders[provider],
          model,
        },
      },
    }));
  };

  readonly resetDownloadDir = () => {
    this.setPdfDownloadDir('');
  };

  readonly resetConfigPath = () => {
    this.setConfigPath(this.snapshot.defaultConfigPath);
  };

  readonly resetKnowledgeBaseSettings = () => {
    const defaultKnowledgeBaseSettings = createDefaultKnowledgeBaseSettings();
    const defaultRagSettings = createDefaultRagSettings();

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      knowledgeBaseEnabled: defaultKnowledgeBaseSettings.enabled,
      autoIndexDownloadedPdf: defaultKnowledgeBaseSettings.autoIndexDownloadedPdf,
      knowledgeBasePdfDownloadDir: defaultKnowledgeBaseSettings.downloadDirectory ?? '',
      libraryStorageMode: defaultKnowledgeBaseSettings.libraryStorageMode,
      libraryDirectory: defaultKnowledgeBaseSettings.libraryDirectory ?? '',
      maxConcurrentIndexJobs: defaultKnowledgeBaseSettings.maxConcurrentIndexJobs,
      activeRagProvider: defaultRagSettings.activeProvider,
      ragProviders: cloneRagSettings(defaultRagSettings).providers,
      retrievalCandidateCount: defaultRagSettings.retrievalCandidateCount,
      retrievalTopK: defaultRagSettings.retrievalTopK,
    }));
  };

  async loadSettings({
    desktopRuntime,
    invokeDesktop,
  }: SettingsModelContext): Promise<LoadSettingsResult> {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      isSettingsLoading: true,
    }));

    try {
      const loaded = await loadAppSettings(desktopRuntime, invokeDesktop);
      const resolved = resolveSettingsState(loaded);

      this.updateSnapshot((snapshot) => ({
        ...snapshot,
        pdfDownloadDir: resolved.pdfDownloadDir,
        knowledgeBasePdfDownloadDir: resolved.knowledgeBasePdfDownloadDir,
        pdfFileNameUseSelectionOrder: resolved.pdfFileNameUseSelectionOrder,
        browserTabKeepAliveLimit: resolved.browserTabKeepAliveLimit,
        browserMaxHistoryEntries: resolved.browserMaxHistoryEntries,
        browserPageZoom: resolved.browserPageZoom,
        browserSearchEngine: resolved.browserSearchEngine,
        systemNotificationsEnabled: resolved.systemNotificationsEnabled,
        warningNotificationsEnabled: resolved.warningNotificationsEnabled,
        menuBarIconEnabled: resolved.menuBarIconEnabled,
        completionNotificationsEnabled: resolved.completionNotificationsEnabled,
        statusbarVisible: resolved.statusbarVisible,
        startupLayout: resolved.startupLayout,
        useMica: resolved.useMica,
        theme: resolved.theme,
        workbenchColorCustomizations: resolved.workbenchColorCustomizations,
        editorDraftStyle: cloneSettingValue(
          resolved.editorDraftStyle,
          cloneEditorDraftStyleSettings,
        ),
        knowledgeBaseEnabled: resolved.knowledgeBase.enabled,
        autoIndexDownloadedPdf: resolved.knowledgeBase.autoIndexDownloadedPdf,
        libraryStorageMode: resolved.knowledgeBase.libraryStorageMode,
        libraryDirectory: resolved.knowledgeBase.libraryDirectory ?? '',
        maxConcurrentIndexJobs: resolved.knowledgeBase.maxConcurrentIndexJobs,
        activeRagProvider: resolved.rag.activeProvider,
        ragProviders: cloneRagSettings(resolved.rag).providers,
        retrievalCandidateCount: resolved.rag.retrievalCandidateCount,
        retrievalTopK: resolved.rag.retrievalTopK,
        activeLlmProvider: resolved.llm.activeProvider,
        llmProviders: cloneLlmSettings(resolved.llm).providers,
        activeTranslationProvider: resolved.translation.activeProvider,
        translationProviders: cloneTranslationSettings(resolved.translation).providers,
        configPath: resolved.configPath,
        defaultConfigPath: resolved.defaultConfigPath,
        hasLoadedSettings: true,
      }));

      return {
        locale: resolved.locale,
      };
    } finally {
      this.updateSnapshot((snapshot) => ({
        ...snapshot,
        isSettingsLoading: false,
      }));
    }
  }

  async choosePdfDownloadDir({
    desktopRuntime,
    invokeDesktop,
  }: SettingsModelContext): Promise<ChoosePdfDownloadDirResult> {
    if (!desktopRuntime) {
      return {
        kind: 'desktop-only',
      };
    }

    const selected = await invokeDesktop<string | null>('pick_download_directory');
    if (!selected) {
      return {
        kind: 'not-selected',
      };
    }

    this.setPdfDownloadDir(selected);
    return {
      kind: 'selected',
      dir: selected,
    };
  }

  async chooseLibraryDirectory({
    desktopRuntime,
    invokeDesktop,
  }: SettingsModelContext): Promise<ChoosePdfDownloadDirResult> {
    if (!desktopRuntime) {
      return {
        kind: 'desktop-only',
      };
    }

    const selected = await invokeDesktop<string | null>('pick_download_directory');
    if (!selected) {
      return {
        kind: 'not-selected',
      };
    }

    this.setLibraryDirectory(selected);
    return {
      kind: 'selected',
      dir: selected,
    };
  }

  async chooseKnowledgeBasePdfDownloadDir({
    desktopRuntime,
    invokeDesktop,
  }: SettingsModelContext): Promise<ChoosePdfDownloadDirResult> {
    if (!desktopRuntime) {
      return {
        kind: 'desktop-only',
      };
    }

    const selected = await invokeDesktop<string | null>('pick_download_directory');
    if (!selected) {
      return {
        kind: 'not-selected',
      };
    }

    this.setKnowledgeBasePdfDownloadDir(selected);
    return {
      kind: 'selected',
      dir: selected,
    };
  }

  async chooseConfigPath({
    desktopRuntime,
    invokeDesktop,
  }: SettingsModelContext): Promise<ChoosePdfDownloadDirResult> {
    if (!desktopRuntime) {
      return {
        kind: 'desktop-only',
      };
    }

    const selected = await invokeDesktop<string | null>('pick_user_settings_file', {
      defaultPath: this.snapshot.configPath,
    });
    if (!selected) {
      return {
        kind: 'not-selected',
      };
    }

    this.setConfigPath(selected);
    return {
      kind: 'selected',
      dir: selected,
    };
  }

  async saveLocale(
    { desktopRuntime, invokeDesktop }: SettingsModelContext,
    locale: Locale,
  ): Promise<void> {
    await saveAppSettingsPartial(desktopRuntime, invokeDesktop, {
      locale,
    });
  }

  async saveSettingsDraft({
    desktopRuntime,
    invokeDesktop,
    locale,
  }: SaveSettingsContext): Promise<void> {
    const {
      pdfDownloadDir,
      knowledgeBasePdfDownloadDir,
      pdfFileNameUseSelectionOrder,
      browserTabKeepAliveLimit,
      browserMaxHistoryEntries,
      browserPageZoom,
      browserSearchEngine,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
      startupLayout,
      useMica,
      theme,
      workbenchColorCustomizations,
      editorDraftStyle,
      knowledgeBaseEnabled,
      autoIndexDownloadedPdf,
      libraryStorageMode,
      libraryDirectory,
      maxConcurrentIndexJobs,
      activeRagProvider,
      ragProviders,
      retrievalCandidateCount,
      retrievalTopK,
      activeLlmProvider,
      llmProviders,
      activeTranslationProvider,
      translationProviders,
      configPath,
    } =
      this.snapshot;
    const { payload } = buildSaveSettingsPayload({
      pdfDownloadDir,
      knowledgeBasePdfDownloadDir,
      pdfFileNameUseSelectionOrder,
      browserTabKeepAliveLimit,
      browserMaxHistoryEntries,
      browserPageZoom,
      browserSearchEngine,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
      startupLayout,
      useMica,
      theme,
      workbenchColorCustomizations,
      configPath,
      editorDraftStyle,
      locale,
      knowledgeBase: {
        enabled: knowledgeBaseEnabled,
        autoIndexDownloadedPdf,
        downloadDirectory: knowledgeBasePdfDownloadDir.trim() || null,
        libraryStorageMode,
        libraryDirectory: libraryDirectory.trim() || null,
        maxConcurrentIndexJobs,
      },
      rag: {
        enabled: knowledgeBaseEnabled,
        activeProvider: activeRagProvider,
        providers: cloneRagSettings({
          enabled: knowledgeBaseEnabled,
          activeProvider: activeRagProvider,
          providers: ragProviders,
          retrievalCandidateCount,
          retrievalTopK,
        }).providers,
        retrievalCandidateCount,
        retrievalTopK,
      },
      llm: {
        activeProvider: activeLlmProvider,
        providers: cloneLlmSettings({
          activeProvider: activeLlmProvider,
          providers: llmProviders,
        }).providers,
      },
      translation: {
        activeProvider: activeTranslationProvider,
        providers: cloneTranslationSettings({
          activeProvider: activeTranslationProvider,
          providers: translationProviders,
        }).providers,
      },
    });
    const saveOperation = this.saveOperation.begin();
    const saved = await saveAppSettings(desktopRuntime, invokeDesktop, payload);
    if (!saveOperation.isCurrent()) {
      return;
    }

    const resolved = resolveSettingsState(saved, {
      fallbackConfigPath: configPath,
    });

    this.applyResolvedSettingsState(resolved);
  }

  async saveSettings({
    desktopRuntime,
    invokeDesktop,
    locale,
  }: SaveSettingsContext): Promise<SaveSettingsResult> {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      isSettingsSaving: true,
    }));

    const {
      pdfDownloadDir,
      knowledgeBasePdfDownloadDir,
      pdfFileNameUseSelectionOrder,
      browserTabKeepAliveLimit,
      browserMaxHistoryEntries,
      browserPageZoom,
      browserSearchEngine,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
      startupLayout,
      useMica,
      theme,
      workbenchColorCustomizations,
      editorDraftStyle,
      knowledgeBaseEnabled,
      autoIndexDownloadedPdf,
      libraryStorageMode,
      libraryDirectory,
      maxConcurrentIndexJobs,
      activeRagProvider,
      ragProviders,
      retrievalCandidateCount,
      retrievalTopK,
      activeLlmProvider,
      llmProviders,
      activeTranslationProvider,
      translationProviders,
      configPath,
    } =
      this.snapshot;
    const { nextDir, payload } = buildSaveSettingsPayload({
      pdfDownloadDir,
      knowledgeBasePdfDownloadDir,
      pdfFileNameUseSelectionOrder,
      browserTabKeepAliveLimit,
      browserMaxHistoryEntries,
      browserPageZoom,
      browserSearchEngine,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
      startupLayout,
      useMica,
      theme,
      workbenchColorCustomizations,
      configPath,
      editorDraftStyle,
      locale,
      knowledgeBase: {
        enabled: knowledgeBaseEnabled,
        autoIndexDownloadedPdf,
        downloadDirectory: knowledgeBasePdfDownloadDir.trim() || null,
        libraryStorageMode,
        libraryDirectory: libraryDirectory.trim() || null,
        maxConcurrentIndexJobs,
      },
      rag: {
        enabled: knowledgeBaseEnabled,
        activeProvider: activeRagProvider,
        providers: cloneRagSettings({
          enabled: knowledgeBaseEnabled,
          activeProvider: activeRagProvider,
          providers: ragProviders,
          retrievalCandidateCount,
          retrievalTopK,
        }).providers,
        retrievalCandidateCount,
        retrievalTopK,
      },
      llm: {
        activeProvider: activeLlmProvider,
        providers: cloneLlmSettings({
          activeProvider: activeLlmProvider,
          providers: llmProviders,
        }).providers,
      },
      translation: {
        activeProvider: activeTranslationProvider,
        providers: cloneTranslationSettings({
          activeProvider: activeTranslationProvider,
          providers: translationProviders,
        }).providers,
      },
    });

    const saveOperation = this.saveOperation.begin();
    const explicitSaveOperation = this.explicitSaveOperation.begin();

    try {
      const saved = await saveAppSettings(desktopRuntime, invokeDesktop, payload);
      const resolved = resolveSettingsState(saved, {
        fallbackConfigPath: configPath,
      });

      if (saveOperation.isCurrent()) {
        this.applyResolvedSettingsState(resolved);
      }

      return {
        nextDir,
        locale: resolved.locale,
      };
    } finally {
      if (explicitSaveOperation.isCurrent()) {
        this.updateSnapshot((snapshot) => ({
          ...snapshot,
          isSettingsSaving: false,
        }));
      }
    }
  }

  private applyResolvedSettingsState(resolved: ResolvedSettingsState) {
    const nextTranslationProviders = cloneTranslationSettings(resolved.translation).providers;

    this.updateSnapshot((snapshot) => {
      const currentCustomProvider = snapshot.translationProviders.custom;
      const nextCustomProvider = nextTranslationProviders.custom;
      const keepCustomModels =
        currentCustomProvider.apiKey === nextCustomProvider.apiKey &&
        currentCustomProvider.baseUrl === nextCustomProvider.baseUrl &&
        currentCustomProvider.models.length > nextCustomProvider.models.length;
      const translationProviders = keepCustomModels
        ? {
            ...nextTranslationProviders,
            custom: {
              ...nextCustomProvider,
              models: currentCustomProvider.models,
            },
          }
        : nextTranslationProviders;

      return {
        ...snapshot,
        pdfDownloadDir: resolved.pdfDownloadDir,
        knowledgeBasePdfDownloadDir: resolved.knowledgeBasePdfDownloadDir,
        pdfFileNameUseSelectionOrder: resolved.pdfFileNameUseSelectionOrder,
        browserTabKeepAliveLimit: resolved.browserTabKeepAliveLimit,
        browserMaxHistoryEntries: resolved.browserMaxHistoryEntries,
        browserPageZoom: resolved.browserPageZoom,
        browserSearchEngine: resolved.browserSearchEngine,
        systemNotificationsEnabled: resolved.systemNotificationsEnabled,
        warningNotificationsEnabled: resolved.warningNotificationsEnabled,
        menuBarIconEnabled: resolved.menuBarIconEnabled,
        completionNotificationsEnabled: resolved.completionNotificationsEnabled,
        statusbarVisible: resolved.statusbarVisible,
        startupLayout: resolved.startupLayout,
        useMica: resolved.useMica,
        theme: resolved.theme,
        workbenchColorCustomizations: resolved.workbenchColorCustomizations,
        editorDraftStyle: cloneSettingValue(
          resolved.editorDraftStyle,
          cloneEditorDraftStyleSettings,
        ),
        knowledgeBaseEnabled: resolved.knowledgeBase.enabled,
        autoIndexDownloadedPdf: resolved.knowledgeBase.autoIndexDownloadedPdf,
        libraryStorageMode: resolved.knowledgeBase.libraryStorageMode,
        libraryDirectory: resolved.knowledgeBase.libraryDirectory ?? '',
        maxConcurrentIndexJobs: resolved.knowledgeBase.maxConcurrentIndexJobs,
        activeRagProvider: resolved.rag.activeProvider,
        ragProviders: cloneRagSettings(resolved.rag).providers,
        retrievalCandidateCount: resolved.rag.retrievalCandidateCount,
        retrievalTopK: resolved.rag.retrievalTopK,
        activeLlmProvider: resolved.llm.activeProvider,
        llmProviders: cloneLlmSettings(resolved.llm).providers,
        activeTranslationProvider: resolved.translation.activeProvider,
        translationProviders,
        configPath: resolved.configPath,
        defaultConfigPath: resolved.defaultConfigPath,
      };
    });
  }

  async testLlmConnection({
    invokeDesktop,
  }: SettingsModelContext) {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      isTestingLlmConnection: true,
    }));

    try {
      const { activeLlmProvider, llmProviders } = this.snapshot;
      const route = resolveLlmRoute(
        {
          activeProvider: activeLlmProvider,
          providers: llmProviders,
        },
        'chat',
      );

      return await invokeDesktop('test_llm_connection', {
        provider: route.provider,
        apiKey: route.apiKey,
        baseUrl: route.baseUrl,
        model: route.model,
        reasoningEffort: route.reasoningEffort,
      });
    } finally {
      this.updateSnapshot((snapshot) => ({
        ...snapshot,
        isTestingLlmConnection: false,
      }));
    }
  }

  async testRagConnection({
    invokeDesktop,
  }: SettingsModelContext) {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      isTestingRagConnection: true,
    }));

    try {
      const {
        activeRagProvider,
        ragProviders,
        retrievalCandidateCount,
        retrievalTopK,
        knowledgeBaseEnabled,
      } = this.snapshot;
      const route = resolveRagRoute({
        enabled: knowledgeBaseEnabled,
        activeProvider: activeRagProvider,
        providers: ragProviders,
        retrievalCandidateCount,
        retrievalTopK,
      });

      return await invokeDesktop('test_rag_connection', {
        provider: route.provider,
        apiKey: route.apiKey,
        baseUrl: route.baseUrl,
        embeddingModel: route.embeddingModel,
        rerankerModel: route.rerankerModel,
        embeddingPath: route.embeddingPath,
        rerankPath: route.rerankPath,
      });
    } finally {
      this.updateSnapshot((snapshot) => ({
        ...snapshot,
        isTestingRagConnection: false,
      }));
    }
  }

  async listCustomTranslationModels({
    invokeDesktop,
  }: SettingsModelContext) {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      isLoadingTranslationModels: true,
    }));

    const providerSettings = this.snapshot.translationProviders.custom;

    try {
      const result = await invokeDesktop('list_translation_models', {
        provider: 'custom',
        apiKey: providerSettings.apiKey,
        baseUrl: providerSettings.baseUrl,
      });

      this.updateSnapshot((snapshot) => {
        const currentProviderSettings = snapshot.translationProviders.custom;
        if (
          currentProviderSettings.apiKey !== providerSettings.apiKey ||
          currentProviderSettings.baseUrl !== providerSettings.baseUrl
        ) {
          return snapshot;
        }

        return {
          ...snapshot,
          translationProviders: {
            ...snapshot.translationProviders,
            custom: {
              ...currentProviderSettings,
              models: result.models,
            },
          },
        };
      });

      return result;
    } finally {
      this.updateSnapshot((snapshot) => ({
        ...snapshot,
        isLoadingTranslationModels: false,
      }));
    }
  }

  async testTranslationConnection({
    invokeDesktop,
  }: SettingsModelContext) {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      isTestingTranslationConnection: true,
    }));

    try {
      const { activeTranslationProvider, translationProviders } = this.snapshot;
      if (activeTranslationProvider === 'glm') {
        const route = resolveLlmRoute(
          {
            activeProvider: 'glm',
            providers: this.snapshot.llmProviders,
          },
          'chat',
        );
        const result = await invokeDesktop('test_llm_connection', {
          provider: route.provider,
          apiKey: translationProviders.glm.apiKey,
          baseUrl: route.baseUrl,
          model: route.model,
          reasoningEffort: route.reasoningEffort,
        });

        return {
          provider: activeTranslationProvider,
          baseUrl: result.baseUrl,
          responsePreview: result.responsePreview,
        };
      }

      const providerSettings = translationProviders[activeTranslationProvider];

      return await invokeDesktop('test_translation_connection', {
        provider: activeTranslationProvider,
        apiKey: providerSettings.apiKey,
        baseUrl: providerSettings.baseUrl,
        model: providerSettings.model,
      });
    } finally {
      this.updateSnapshot((snapshot) => ({
        ...snapshot,
        isTestingTranslationConnection: false,
      }));
    }
  }
}
