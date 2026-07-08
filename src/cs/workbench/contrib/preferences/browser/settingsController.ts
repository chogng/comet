import { toast } from 'cs/base/browser/ui/toast/toast';
import type {
  AppStartupLayout,
  AppTheme,
  LlmProviderId,
  TranslationProviderId,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
  areEditorDraftStyleSettingsEqual,
  cloneEditorDraftStyleSettings,
  createDefaultEditorDraftStyleSettings,
  type EditorDraftDefaultBodyStyle,
} from 'cs/base/common/editorDraftStyle';
import { editorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import {
  parseAppErrorData,
} from 'cs/base/common/errors';
import {
  formatLocaleMessage,
  localizeAppError,
} from 'cs/workbench/common/errorMessages';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import type { SettingsModelSnapshot } from 'cs/workbench/services/settings/settingsModel';

export type SettingsControllerContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
  ui: LocaleMessages;
  locale: Locale;
};

type SettingsModelContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
};

type CreateSettingsControllerParams = SettingsControllerContext;

const immediateAutoSaveDelayMs = 0;
const debouncedAutoSaveDelayMs = 650;

function localizeSettingsError(ui: LocaleMessages, error: unknown) {
  return localizeAppError(ui, parseAppErrorData(error));
}

export class SettingsController {
  private context: SettingsControllerContext;
  private readonly settingsModel: SettingsModel;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposeEditorDraftStyleSubscription: (() => void) | null = null;
  private isApplyingLoadedEditorDraftStyle = false;
  private started = false;
  private disposed = false;
  private loadSequence = 0;

  constructor(context: CreateSettingsControllerParams) {
    this.context = context;
    this.settingsModel = new SettingsModel();
  }

  readonly subscribe = (listener: () => void) =>
    this.settingsModel.subscribe(listener);

  readonly getSnapshot = (): SettingsModelSnapshot =>
    this.settingsModel.getSnapshot();

  readonly setContext = (context: SettingsControllerContext) => {
    this.context = context;
  };

  readonly start = () => {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.disposeEditorDraftStyleSubscription = editorDraftStyleService.subscribe(
      this.handleEditorDraftStyleChange,
    );
    void this.loadSettings();
  };

  readonly dispose = () => {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      this.flushAutoSave();
    }

    this.disposeEditorDraftStyleSubscription?.();
    this.disposeEditorDraftStyleSubscription = null;
    this.disposed = true;
  };

  readonly handleChoosePdfDownloadDir = async () => {
    try {
      const result = await this.settingsModel.choosePdfDownloadDir(
        this.getSettingsModelContext(),
      );
      if (result.kind === 'selected') {
        this.scheduleImmediateAutoSave();
      }
    } catch (pickError) {
      console.error('Failed to choose PDF download directory.', pickError);
    }
  };

  readonly handleChooseKnowledgeBasePdfDownloadDir = async () => {
    try {
      const result = await this.settingsModel.chooseKnowledgeBasePdfDownloadDir(
        this.getSettingsModelContext(),
      );
      if (result.kind === 'selected') {
        this.scheduleImmediateAutoSave();
      }
    } catch (pickError) {
      console.error('Failed to choose knowledge-base PDF download directory.', pickError);
    }
  };

  readonly handleChooseLibraryDirectory = async () => {
    try {
      const result = await this.settingsModel.chooseLibraryDirectory(
        this.getSettingsModelContext(),
      );
      if (result.kind === 'selected') {
        this.scheduleImmediateAutoSave();
      }
    } catch (pickError) {
      console.error('Failed to choose library directory.', pickError);
    }
  };

  readonly handleChooseConfigPath = async () => {
    try {
      const result = await this.settingsModel.chooseConfigPath(
        this.getSettingsModelContext(),
      );
      if (result.kind === 'selected') {
        this.scheduleImmediateAutoSave();
      }
    } catch (pickError) {
      const localizedError = localizeSettingsError(this.context.ui, pickError);
      toast.error(
        formatLocaleMessage(this.context.ui.toastChangeConfigLocationFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleResetConfigPath = () => {
    this.settingsModel.resetConfigPath();
    this.scheduleImmediateAutoSave();
  };

  readonly handleResetKnowledgeBaseSettings = () => {
    this.settingsModel.resetKnowledgeBaseSettings();
    this.scheduleImmediateAutoSave();
  };

  readonly setBatchLimit = (nextBatchLimit: number) => {
    this.settingsModel.setBatchLimit(nextBatchLimit);
    this.scheduleImmediateAutoSave();
  };

  readonly setJournalSourceTitle = (url: string, journalTitle: string) => {
    this.settingsModel.setJournalSourceTitle(url, journalTitle);
    this.scheduleDebouncedAutoSave();
  };

  readonly setSystemNotificationsEnabled = (
    nextSystemNotificationsEnabled: boolean,
  ) => {
    this.settingsModel.setSystemNotificationsEnabled(nextSystemNotificationsEnabled);
    this.scheduleImmediateAutoSave();
  };

  readonly setWarningNotificationsEnabled = (
    nextWarningNotificationsEnabled: boolean,
  ) => {
    this.settingsModel.setWarningNotificationsEnabled(nextWarningNotificationsEnabled);
    this.scheduleImmediateAutoSave();
  };

  readonly setMenuBarIconEnabled = (nextMenuBarIconEnabled: boolean) => {
    this.settingsModel.setMenuBarIconEnabled(nextMenuBarIconEnabled);
    this.scheduleImmediateAutoSave();
  };

  readonly setCompletionNotificationsEnabled = (
    nextCompletionNotificationsEnabled: boolean,
  ) => {
    this.settingsModel.setCompletionNotificationsEnabled(nextCompletionNotificationsEnabled);
    this.scheduleImmediateAutoSave();
  };

  readonly setUseMica = (nextUseMica: boolean) => {
    this.settingsModel.setUseMica(nextUseMica);
    this.scheduleImmediateAutoSave();
  };

  readonly setStatusbarVisible = (nextStatusbarVisible: boolean) => {
    this.settingsModel.setStatusbarVisible(nextStatusbarVisible);
    this.scheduleImmediateAutoSave();
  };

  readonly setStartupLayout = (nextStartupLayout: AppStartupLayout) => {
    this.settingsModel.setStartupLayout(nextStartupLayout);
    this.scheduleImmediateAutoSave();
  };

  readonly setTheme = (nextTheme: AppTheme) => {
    this.settingsModel.setTheme(nextTheme);
    this.scheduleImmediateAutoSave();
  };

  readonly setEditorDraftFontFamily = (nextFontFamilyValue: string) => {
    this.updateEditorDraftDefaultBodyStyle((defaultBodyStyle) => ({
      ...defaultBodyStyle,
      fontFamilyValue: nextFontFamilyValue,
    }));
  };

  readonly setEditorDraftFontSize = (nextFontSizeValue: string) => {
    this.updateEditorDraftDefaultBodyStyle((defaultBodyStyle) => ({
      ...defaultBodyStyle,
      fontSizeValue: nextFontSizeValue,
    }));
  };

  readonly setEditorDraftLineHeight = (nextLineHeight: number) => {
    if (!Number.isFinite(nextLineHeight)) {
      return;
    }

    const clampedLineHeight = Math.min(4, Math.max(0.5, nextLineHeight));
    this.updateEditorDraftDefaultBodyStyle((defaultBodyStyle) => ({
      ...defaultBodyStyle,
      lineHeight: clampedLineHeight,
    }));
  };

  readonly setEditorDraftLineHeightFromInput = (value: string) => {
    const normalizedLineHeightValue = value.trim();
    if (!normalizedLineHeightValue || normalizedLineHeightValue === '.') {
      return;
    }

    const parsedLineHeight = Number.parseFloat(normalizedLineHeightValue);
    if (!Number.isFinite(parsedLineHeight)) {
      return;
    }

    this.setEditorDraftLineHeight(parsedLineHeight);
  };

  readonly setEditorDraftParagraphSpacingBeforePt = (nextParagraphSpacingBeforePt: number) => {
    if (!Number.isFinite(nextParagraphSpacingBeforePt)) {
      return;
    }

    const clampedSpacing = Math.min(200, Math.max(0, nextParagraphSpacingBeforePt));
    this.updateEditorDraftDefaultBodyStyle((defaultBodyStyle) => ({
      ...defaultBodyStyle,
      paragraphSpacingBeforePt: clampedSpacing,
    }));
  };

  readonly setEditorDraftParagraphSpacingBeforePtFromInput = (value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || normalizedValue === '.') {
      return;
    }

    const parsedValue = Number.parseFloat(normalizedValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }

    this.setEditorDraftParagraphSpacingBeforePt(parsedValue);
  };

  readonly setEditorDraftParagraphSpacingAfterPt = (nextParagraphSpacingAfterPt: number) => {
    if (!Number.isFinite(nextParagraphSpacingAfterPt)) {
      return;
    }

    const clampedSpacing = Math.min(200, Math.max(0, nextParagraphSpacingAfterPt));
    this.updateEditorDraftDefaultBodyStyle((defaultBodyStyle) => ({
      ...defaultBodyStyle,
      paragraphSpacingAfterPt: clampedSpacing,
    }));
  };

  readonly setEditorDraftParagraphSpacingAfterPtFromInput = (value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || normalizedValue === '.') {
      return;
    }

    const parsedValue = Number.parseFloat(normalizedValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }

    this.setEditorDraftParagraphSpacingAfterPt(parsedValue);
  };

  readonly setEditorDraftColor = (nextColor: string) => {
    this.updateEditorDraftDefaultBodyStyle((defaultBodyStyle) => ({
      ...defaultBodyStyle,
      color: nextColor,
    }));
  };

  readonly handleResetEditorDraftStyle = () => {
    const defaultBodyStyle = createDefaultEditorDraftStyleSettings().defaultBodyStyle;
    const currentInlineDefaults =
      editorDraftStyleService.getSnapshot().defaultBodyStyle.inlineStyleDefaults;
    editorDraftStyleService.setDefaultBodyStyle(
      {
        fontFamilyValue: defaultBodyStyle.fontFamilyValue,
        fontSizeValue: defaultBodyStyle.fontSizeValue,
        lineHeight: defaultBodyStyle.lineHeight,
        paragraphSpacingBeforePt: defaultBodyStyle.paragraphSpacingBeforePt,
        paragraphSpacingAfterPt: defaultBodyStyle.paragraphSpacingAfterPt,
        color: defaultBodyStyle.color,
        inlineStyleDefaults: {
          bold: currentInlineDefaults.bold,
          italic: currentInlineDefaults.italic,
          underline: currentInlineDefaults.underline,
        },
      },
    );
  };

  readonly setPdfDownloadDir = (nextPdfDownloadDir: string) => {
    this.settingsModel.setPdfDownloadDir(nextPdfDownloadDir);
    this.scheduleDebouncedAutoSave();
  };

  readonly setKnowledgeBasePdfDownloadDir = (
    nextKnowledgeBasePdfDownloadDir: string,
  ) => {
    this.settingsModel.setKnowledgeBasePdfDownloadDir(
      nextKnowledgeBasePdfDownloadDir,
    );
    this.scheduleDebouncedAutoSave();
  };

  readonly setPdfFileNameUseSelectionOrder = (
    nextPdfFileNameUseSelectionOrder: boolean,
  ) => {
    this.settingsModel.setPdfFileNameUseSelectionOrder(
      nextPdfFileNameUseSelectionOrder,
    );
    this.scheduleImmediateAutoSave();
  };

  readonly setBrowserTabKeepAliveLimit = (nextBrowserTabKeepAliveLimit: number) => {
    this.settingsModel.setBrowserTabKeepAliveLimit(nextBrowserTabKeepAliveLimit);
    this.scheduleImmediateAutoSave();
  };

  readonly setKnowledgeBaseEnabled = (nextKnowledgeBaseEnabled: boolean) => {
    this.settingsModel.setKnowledgeBaseEnabled(nextKnowledgeBaseEnabled);
    this.scheduleImmediateAutoSave();
  };

  readonly setAutoIndexDownloadedPdf = (
    nextAutoIndexDownloadedPdf: boolean,
  ) => {
    this.settingsModel.setAutoIndexDownloadedPdf(nextAutoIndexDownloadedPdf);
    this.scheduleImmediateAutoSave();
  };

  readonly setLibraryStorageMode = (
    nextLibraryStorageMode: 'linked-original' | 'managed-copy',
  ) => {
    this.settingsModel.setLibraryStorageMode(nextLibraryStorageMode);
    this.scheduleImmediateAutoSave();
  };

  readonly setLibraryDirectory = (nextLibraryDirectory: string) => {
    this.settingsModel.setLibraryDirectory(nextLibraryDirectory);
    this.scheduleDebouncedAutoSave();
  };

  readonly setMaxConcurrentIndexJobs = (nextMaxConcurrentIndexJobs: number) => {
    this.settingsModel.setMaxConcurrentIndexJobs(nextMaxConcurrentIndexJobs);
    this.scheduleImmediateAutoSave();
  };

  readonly setRagProviderApiKey = (provider: 'moark', apiKey: string) => {
    this.settingsModel.setRagProviderApiKey(provider, apiKey);
    this.scheduleDebouncedAutoSave();
  };

  readonly setRagProviderBaseUrl = (provider: 'moark', baseUrl: string) => {
    this.settingsModel.setRagProviderBaseUrl(provider, baseUrl);
    this.scheduleDebouncedAutoSave();
  };

  readonly setRagProviderEmbeddingModel = (
    provider: 'moark',
    embeddingModel: string,
  ) => {
    this.settingsModel.setRagProviderEmbeddingModel(provider, embeddingModel);
    this.scheduleDebouncedAutoSave();
  };

  readonly setRagProviderRerankerModel = (
    provider: 'moark',
    rerankerModel: string,
  ) => {
    this.settingsModel.setRagProviderRerankerModel(provider, rerankerModel);
    this.scheduleDebouncedAutoSave();
  };

  readonly setRagProviderEmbeddingPath = (
    provider: 'moark',
    embeddingPath: string,
  ) => {
    this.settingsModel.setRagProviderEmbeddingPath(provider, embeddingPath);
    this.scheduleDebouncedAutoSave();
  };

  readonly setRagProviderRerankPath = (provider: 'moark', rerankPath: string) => {
    this.settingsModel.setRagProviderRerankPath(provider, rerankPath);
    this.scheduleDebouncedAutoSave();
  };

  readonly setRetrievalCandidateCount = (nextRetrievalCandidateCount: number) => {
    this.settingsModel.setRetrievalCandidateCount(nextRetrievalCandidateCount);
    this.scheduleImmediateAutoSave();
  };

  readonly setRetrievalTopK = (nextRetrievalTopK: number) => {
    this.settingsModel.setRetrievalTopK(nextRetrievalTopK);
    this.scheduleImmediateAutoSave();
  };

  readonly setActiveLlmProvider = (nextProvider: LlmProviderId) => {
    this.settingsModel.setActiveLlmProvider(nextProvider);
    this.scheduleImmediateAutoSave();
  };

  readonly setLlmProviderUseMaxContextWindow = (
    provider: LlmProviderId,
    useMaxContextWindow: boolean,
  ) => {
    this.settingsModel.setLlmProviderUseMaxContextWindow(provider, useMaxContextWindow);
    this.scheduleImmediateAutoSave();
  };

  readonly setLlmProviderApiKey = (
    provider: LlmProviderId,
    apiKey: string,
  ) => {
    this.settingsModel.setLlmProviderApiKey(provider, apiKey);
    this.scheduleDebouncedAutoSave();
  };

  readonly setLlmProviderModel = (
    provider: LlmProviderId,
    model: string,
  ) => {
    this.settingsModel.setLlmProviderModel(provider, model);
    this.scheduleImmediateAutoSave();
  };

  readonly setLlmProviderReasoningEffort = (
    provider: LlmProviderId,
    reasoningEffort: import('cs/workbench/services/llm/types').LlmReasoningEffort | undefined,
  ) => {
    this.settingsModel.setLlmProviderReasoningEffort(provider, reasoningEffort);
    this.scheduleImmediateAutoSave();
  };

  readonly setLlmProviderSelectedModelOption = (
    provider: LlmProviderId,
    optionValue: string,
  ) => {
    this.settingsModel.setLlmProviderSelectedModelOption(provider, optionValue);
    this.scheduleImmediateAutoSave();
  };

  readonly setLlmProviderModelEnabled = (
    provider: LlmProviderId,
    optionValue: string,
    enabled: boolean,
  ) => {
    this.settingsModel.setLlmProviderModelEnabled(provider, optionValue, enabled);
    this.scheduleImmediateAutoSave();
  };

  readonly setActiveTranslationProvider = (nextProvider: TranslationProviderId) => {
    this.settingsModel.setActiveTranslationProvider(nextProvider);
    this.scheduleImmediateAutoSave();
  };

  readonly setTranslationProviderApiKey = (
    provider: TranslationProviderId,
    apiKey: string,
  ) => {
    this.settingsModel.setTranslationProviderApiKey(provider, apiKey);
    this.scheduleDebouncedAutoSave();
  };

  readonly setTranslationProviderBaseUrl = (
    provider: TranslationProviderId,
    baseUrl: string,
  ) => {
    this.settingsModel.setTranslationProviderBaseUrl(provider, baseUrl);
    this.scheduleDebouncedAutoSave();
  };

  readonly setTranslationProviderModel = (
    provider: TranslationProviderId,
    model: string,
  ) => {
    this.settingsModel.setTranslationProviderModel(provider, model);
    this.scheduleImmediateAutoSave();
  };

  readonly handleResetDownloadDir = () => {
    this.settingsModel.resetDownloadDir();
    this.scheduleImmediateAutoSave();
  };

  readonly handleSaveSettings = async (): Promise<boolean> => {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    const { locale, ui } = this.context;
    try {
      await this.settingsModel.saveSettings({
        ...this.getSettingsModelContext(),
        locale,
      });
      toast.success(ui.toastSettingsSaved);
      return true;
    } catch (saveError) {
      const localizedError = localizeSettingsError(ui, saveError);
      toast.error(
        formatLocaleMessage(ui.toastSaveSettingsFailed, {
          error: localizedError,
        }),
      );
      return false;
    }
  };

  readonly handleTestLlmConnection = async () => {
    const { desktopRuntime, ui } = this.context;
    if (!desktopRuntime) {
      toast.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.testLlmConnection(
        this.getSettingsModelContext(),
      );
      toast.success(
        formatLocaleMessage(ui.toastLlmConnectionSucceeded, {
          provider: result.provider,
          model: result.model,
        }),
      );
    } catch (testError) {
      const localizedError = localizeSettingsError(ui, testError);
      toast.error(
        formatLocaleMessage(ui.toastLlmConnectionFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleTestRagConnection = async () => {
    const { desktopRuntime, ui } = this.context;
    if (!desktopRuntime) {
      toast.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.testRagConnection(
        this.getSettingsModelContext(),
      );
      toast.success(
        formatLocaleMessage(ui.toastRagConnectionSucceeded, {
          provider: result.provider,
          embeddingModel: result.embeddingModel,
          rerankerModel: result.rerankerModel,
        }),
      );
    } catch (testError) {
      const localizedError = localizeSettingsError(ui, testError);
      toast.error(
        formatLocaleMessage(ui.toastRagConnectionFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleTestTranslationConnection = async () => {
    const { desktopRuntime, ui } = this.context;
    if (!desktopRuntime) {
      toast.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.testTranslationConnection(
        this.getSettingsModelContext(),
      );
      toast.success(
        formatLocaleMessage(ui.toastTranslationConnectionSucceeded, {
          provider: result.provider,
        }),
      );
    } catch (testError) {
      const localizedError = localizeSettingsError(ui, testError);
      toast.error(
        formatLocaleMessage(ui.toastTranslationConnectionFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleFetchTranslationModels = async () => {
    const { desktopRuntime, ui } = this.context;
    if (!desktopRuntime) {
      toast.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.listCustomTranslationModels(
        this.getSettingsModelContext(),
      );
      this.scheduleImmediateAutoSave();
      toast.success(
        formatLocaleMessage(ui.toastTranslationModelsLoaded, {
          count: String(result.models.length),
        }),
      );
    } catch (testError) {
      const localizedError = localizeSettingsError(ui, testError);
      toast.error(
        formatLocaleMessage(ui.toastTranslationModelsFailed, {
          error: localizedError,
        }),
      );
    }
  };

  private getSettingsModelContext(): SettingsModelContext {
    return {
      desktopRuntime: this.context.desktopRuntime,
      invokeDesktop: this.context.invokeDesktop,
    };
  }

  private loadSettings = async () => {
    const loadSequence = ++this.loadSequence;

    try {
      await this.settingsModel.loadSettings(this.getSettingsModelContext());
      if (this.disposed || loadSequence !== this.loadSequence) {
        return;
      }

      this.isApplyingLoadedEditorDraftStyle = true;
      try {
        editorDraftStyleService.setDefaultBodyStyle(
          cloneEditorDraftStyleSettings(this.settingsModel.getSnapshot().editorDraftStyle.value)
            .defaultBodyStyle,
        );
      } finally {
        this.isApplyingLoadedEditorDraftStyle = false;
      }
    } catch (loadError) {
      if (this.disposed || loadSequence !== this.loadSequence) {
        return;
      }

      const { ui } = this.context;
      const localizedError = localizeSettingsError(ui, loadError);
      toast.error(
        formatLocaleMessage(ui.toastLoadSettingsFailed, { error: localizedError }),
      );
    }
  };

  private readonly handleEditorDraftStyleChange = () => {
    if (this.disposed || this.isApplyingLoadedEditorDraftStyle) {
      return;
    }

    const nextEditorDraftStyle = cloneEditorDraftStyleSettings(
      editorDraftStyleService.getSnapshot(),
    );
    const previousEditorDraftStyle = this.settingsModel.getSnapshot().editorDraftStyle.value;
    if (areEditorDraftStyleSettingsEqual(previousEditorDraftStyle, nextEditorDraftStyle)) {
      return;
    }

    this.settingsModel.setEditorDraftStyle(nextEditorDraftStyle);
    this.scheduleDebouncedAutoSave();
  };

  private updateEditorDraftDefaultBodyStyle(
    updater: (defaultBodyStyle: EditorDraftDefaultBodyStyle) => EditorDraftDefaultBodyStyle,
  ) {
    const snapshot = editorDraftStyleService.getSnapshot();
    const nextDefaultBodyStyle = updater({
      fontFamilyValue: snapshot.defaultBodyStyle.fontFamilyValue,
      fontSizeValue: snapshot.defaultBodyStyle.fontSizeValue,
      lineHeight: snapshot.defaultBodyStyle.lineHeight,
      paragraphSpacingBeforePt: snapshot.defaultBodyStyle.paragraphSpacingBeforePt,
      paragraphSpacingAfterPt: snapshot.defaultBodyStyle.paragraphSpacingAfterPt,
      color: snapshot.defaultBodyStyle.color,
      inlineStyleDefaults: {
        ...snapshot.defaultBodyStyle.inlineStyleDefaults,
      },
    });

    editorDraftStyleService.setDefaultBodyStyle(nextDefaultBodyStyle);
  }

  private flushAutoSave = () => {
    const { locale } = this.context;

    void this.settingsModel
      .saveSettingsDraft({
        ...this.getSettingsModelContext(),
        locale,
      })
      .catch((saveError: unknown) => {
        console.error('Failed to auto-save settings draft.', saveError);
      });
  };

  private scheduleAutoSave(delayMs: number) {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      this.flushAutoSave();
    }, delayMs);
  }

  private scheduleImmediateAutoSave() {
    this.scheduleAutoSave(immediateAutoSaveDelayMs);
  }

  private scheduleDebouncedAutoSave() {
    this.scheduleAutoSave(debouncedAutoSaveDelayMs);
  }
}

// The controller stays feature-local: it coordinates UI actions, autosave, and
// desktop side effects for the preferences editor, while the pure data model
// remains under services/settings.
export function createSettingsController(
  params: CreateSettingsControllerParams,
) {
  return new SettingsController(params);
}
