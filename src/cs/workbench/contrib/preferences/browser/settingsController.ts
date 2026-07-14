import type {
	LlmProviderId,
	TranslationProviderId,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  areEditorDraftStyleSettingsEqual,
  cloneEditorDraftStyleSettings,
  createDefaultEditorDraftStyleSettings,
  type EditorDraftDefaultBodyStyle,
} from 'cs/base/common/editorDraftStyle';
import {
	IEditorDraftStyleService,
	type IEditorDraftStyleService as EditorDraftStyleService,
} from 'cs/editor/browser/text/editorDraftStyleService';
import type { LocaleMessages } from 'language/locales';
import {
  parseAppErrorData,
} from 'cs/base/parts/sandbox/common/appError';
import {
  formatLocaleMessage,
  localizeAppError,
} from 'cs/workbench/common/errorMessages';
import {
  ISettingsModel,
  SettingsModel,
} from 'cs/workbench/services/settings/settingsModel';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { INativeHostService } from 'cs/platform/native/common/native';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import {
	maxBrowserMaxHistoryEntries,
	minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import {
	maxBrowserTabKeepAliveLimit,
	minBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';
import {
	maxKnowledgeBaseConcurrentIndexJobs,
	minKnowledgeBaseConcurrentIndexJobs,
} from 'cs/workbench/services/knowledgeBase/config';
import {
	maxRagRetrievalCandidateCount,
	minRagRetrievalCandidateCount,
	minRagRetrievalTopK,
} from 'cs/workbench/services/rag/config';
import { isSupportedLanguagePackLocale } from 'cs/platform/languagePacks/common/languagePacks';
import {
	IAgentHostManagementService,
	type IAgentHostManagementService as AgentHostManagementService,
} from 'cs/platform/agentHost/browser/agentHostManagementService';
import type {
	AgentConfigurationPropertyId,
	AgentHostAuthorityId,
	AgentId,
	AgentPackageId,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';

const immediateAutoSaveDelayMs = 0;
const debouncedAutoSaveDelayMs = 650;

function localizeSettingsError(ui: LocaleMessages, error: unknown) {
  return localizeAppError(ui, parseAppErrorData(error));
}

function parseClampedIntegerInput(value: string, min: number, max: number): number | undefined {
	const normalizedValue = value.trim();
	if (!/^-?\d+$/.test(normalizedValue)) {
		return undefined;
	}

	const parsedValue = Number(normalizedValue);
	if (!Number.isInteger(parsedValue)) {
		return undefined;
	}

	return Math.min(max, Math.max(min, parsedValue));
}

function parseFiniteNumberInput(value: string): number | undefined {
	const normalizedValue = value.trim();
	if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedValue)) {
		return undefined;
	}

	const parsedValue = Number(normalizedValue);
	return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export class SettingsController {
  declare readonly _serviceBrand: undefined;

  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposeEditorDraftStyleSubscription: (() => void) | null = null;
  private isApplyingLoadedEditorDraftStyle = false;
  private started = false;
  private disposed = false;
  private loadSequence = 0;

  constructor(
    @ISettingsModel private readonly settingsModel: SettingsModel,
    @INativeHostService private readonly nativeHostService: INativeHostService,
    @INotificationService private readonly notificationService: INotificationService,
    @IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
    @IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	@IEditorDraftStyleService private readonly editorDraftStyleService: EditorDraftStyleService,
	@IAgentHostManagementService private readonly agentHostManagementService: AgentHostManagementService,
  ) {}

	readonly installAgentPackage = async (
		authority: AgentHostAuthorityId,
		packageId: AgentPackageId,
	) => {
		const ui = this.getUi();
		try {
			await this.agentHostManagementService.installPackage(authority, packageId);
			this.notificationService.info(formatLocaleMessage(ui.toastAgentPackageInstalled, {
				package: packageId,
			}));
		} catch (error) {
			this.notificationService.error(formatLocaleMessage(ui.toastAgentPackageOperationFailed, {
				error: localizeSettingsError(ui, error),
			}));
		}
	};

	readonly uninstallAgentPackage = async (
		authority: AgentHostAuthorityId,
		packageId: AgentPackageId,
	) => {
		const ui = this.getUi();
		try {
			await this.agentHostManagementService.uninstallPackage(authority, packageId);
			this.notificationService.info(formatLocaleMessage(ui.toastAgentPackageUninstalled, {
				package: packageId,
			}));
		} catch (error) {
			this.notificationService.error(formatLocaleMessage(ui.toastAgentPackageOperationFailed, {
				error: localizeSettingsError(ui, error),
			}));
		}
	};

	readonly updateAgentDefault = async (
		authority: AgentHostAuthorityId,
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
		value: AgentHostProtocolValue,
	) => {
		const ui = this.getUi();
		try {
			await this.agentHostManagementService.updateAgentDefault(authority, agentId, propertyId, value);
			this.notificationService.info(formatLocaleMessage(ui.toastAgentConfigurationUpdated, {
				agent: agentId,
			}));
		} catch (error) {
			this.notificationService.error(formatLocaleMessage(ui.toastAgentConfigurationFailed, {
				error: localizeSettingsError(ui, error),
			}));
		}
	};

	readonly removeAgentDefault = async (
		authority: AgentHostAuthorityId,
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
	) => {
		const ui = this.getUi();
		try {
			await this.agentHostManagementService.removeAgentDefault(authority, agentId, propertyId);
			this.notificationService.info(formatLocaleMessage(ui.toastAgentConfigurationUpdated, {
				agent: agentId,
			}));
		} catch (error) {
			this.notificationService.error(formatLocaleMessage(ui.toastAgentConfigurationFailed, {
				error: localizeSettingsError(ui, error),
			}));
		}
	};

	readonly resetAgentDefaults = async (authority: AgentHostAuthorityId, agentId: AgentId) => {
		const ui = this.getUi();
		try {
			await this.agentHostManagementService.resetAgentDefaults(authority, agentId);
			this.notificationService.info(formatLocaleMessage(ui.toastAgentConfigurationReset, {
				agent: agentId,
			}));
		} catch (error) {
			this.notificationService.error(formatLocaleMessage(ui.toastAgentConfigurationFailed, {
				error: localizeSettingsError(ui, error),
			}));
		}
	};

	readonly reportInvalidAgentConfigurationValue = () => {
		this.notificationService.error(this.getUi().settingsAgentInvalidConfigurationValue);
	};

  readonly start = () => {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
	this.disposeEditorDraftStyleSubscription = this.editorDraftStyleService.subscribe(
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
      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, pickError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastChangeConfigLocationFailed, {
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

  readonly setSystemNotificationsEnabled = (
    nextSystemNotificationsEnabled: boolean,
  ) => {
    this.settingsModel.setSystemNotificationsEnabled(nextSystemNotificationsEnabled);
    this.scheduleImmediateAutoSave();
  };

	readonly setLocale = (value: string) => {
		if (!isSupportedLanguagePackLocale(value)) {
			return;
		}

		void this.localeService
			.updateLocalePreference(value, this.getSettingsModelContext())
			.catch(error => {
				console.error('Failed to update display language.', error);
			});
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

	readonly setStartupLayout = (nextStartupLayout: string) => {
		if (nextStartupLayout !== 'agent' && nextStartupLayout !== 'flow') {
			return;
		}

    this.settingsModel.setStartupLayout(nextStartupLayout);
    this.scheduleImmediateAutoSave();
  };

	readonly setTheme = (nextTheme: string) => {
		if (nextTheme !== 'light' && nextTheme !== 'dark' && nextTheme !== 'system') {
			return;
		}

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
	const parsedLineHeight = parseFiniteNumberInput(value);
	if (parsedLineHeight === undefined) {
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
	const parsedValue = parseFiniteNumberInput(value);
	if (parsedValue === undefined) {
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
	const parsedValue = parseFiniteNumberInput(value);
	if (parsedValue === undefined) {
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
		this.editorDraftStyleService.getSnapshot().defaultBodyStyle.inlineStyleDefaults;
	this.editorDraftStyleService.setDefaultBodyStyle(
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

	readonly setBrowserTabKeepAliveLimit = (value: string) => {
		const nextBrowserTabKeepAliveLimit = parseClampedIntegerInput(
			value,
			minBrowserTabKeepAliveLimit,
			maxBrowserTabKeepAliveLimit,
		);
		if (nextBrowserTabKeepAliveLimit === undefined) {
			return;
		}

		this.settingsModel.setBrowserTabKeepAliveLimit(nextBrowserTabKeepAliveLimit);
		this.scheduleImmediateAutoSave();
	};

	readonly setBrowserMaxHistoryEntries = (value: string) => {
		const nextBrowserMaxHistoryEntries = parseClampedIntegerInput(
			value,
			minBrowserMaxHistoryEntries,
			maxBrowserMaxHistoryEntries,
		);
		if (nextBrowserMaxHistoryEntries === undefined) {
			return;
		}

		this.settingsModel.setBrowserMaxHistoryEntries(nextBrowserMaxHistoryEntries);
		this.scheduleImmediateAutoSave();
	};

  readonly setBrowserPageZoom = (nextBrowserPageZoom: string) => {
    this.settingsModel.setBrowserPageZoom(nextBrowserPageZoom);
    this.scheduleImmediateAutoSave();
  };

  readonly setBrowserSearchEngine = (nextBrowserSearchEngine: string) => {
    this.settingsModel.setBrowserSearchEngine(nextBrowserSearchEngine);
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

	readonly setMaxConcurrentIndexJobs = (value: string) => {
		const nextMaxConcurrentIndexJobs = parseClampedIntegerInput(
			value,
			minKnowledgeBaseConcurrentIndexJobs,
			maxKnowledgeBaseConcurrentIndexJobs,
		);
		if (nextMaxConcurrentIndexJobs === undefined) {
			return;
		}

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

	readonly setRetrievalCandidateCount = (value: string) => {
		const nextRetrievalCandidateCount = parseClampedIntegerInput(
			value,
			minRagRetrievalCandidateCount,
			maxRagRetrievalCandidateCount,
		);
		if (nextRetrievalCandidateCount === undefined) {
			return;
		}

		this.settingsModel.setRetrievalCandidateCount(nextRetrievalCandidateCount);
		this.scheduleImmediateAutoSave();
	};

	readonly setRetrievalTopK = (value: string) => {
		const nextRetrievalTopK = parseClampedIntegerInput(
			value,
			minRagRetrievalTopK,
			this.settingsModel.getSnapshot().retrievalCandidateCount,
		);
		if (nextRetrievalTopK === undefined) {
			return;
		}

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

    const locale = this.localeService.getLocale();
    try {
      await this.settingsModel.saveSettings({
        ...this.getSettingsModelContext(),
        locale,
      });
      const ui = this.getUi();
      this.notificationService.info(ui.toastSettingsSaved);
      return true;
    } catch (saveError) {
      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, saveError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastSaveSettingsFailed, {
          error: localizedError,
        }),
      );
      return false;
    }
  };

  readonly handleTestLlmConnection = async () => {
    const desktopRuntime = this.nativeHostService.canInvoke();
    if (!desktopRuntime) {
      const ui = this.getUi();
      this.notificationService.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.testLlmConnection(
        this.getSettingsModelContext(),
      );
      const ui = this.getUi();
      this.notificationService.info(
        formatLocaleMessage(ui.toastLlmConnectionSucceeded, {
          provider: result.provider,
          model: result.model,
        }),
      );
    } catch (testError) {
      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, testError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastLlmConnectionFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleTestRagConnection = async () => {
    const desktopRuntime = this.nativeHostService.canInvoke();
    if (!desktopRuntime) {
      const ui = this.getUi();
      this.notificationService.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.testRagConnection(
        this.getSettingsModelContext(),
      );
      const ui = this.getUi();
      this.notificationService.info(
        formatLocaleMessage(ui.toastRagConnectionSucceeded, {
          provider: result.provider,
          embeddingModel: result.embeddingModel,
          rerankerModel: result.rerankerModel,
        }),
      );
    } catch (testError) {
      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, testError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastRagConnectionFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleTestTranslationConnection = async () => {
    const desktopRuntime = this.nativeHostService.canInvoke();
    if (!desktopRuntime) {
      const ui = this.getUi();
      this.notificationService.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.testTranslationConnection(
        this.getSettingsModelContext(),
      );
      const ui = this.getUi();
      this.notificationService.info(
        formatLocaleMessage(ui.toastTranslationConnectionSucceeded, {
          provider: result.provider,
        }),
      );
    } catch (testError) {
      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, testError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastTranslationConnectionFailed, {
          error: localizedError,
        }),
      );
    }
  };

  readonly handleFetchTranslationModels = async () => {
    const desktopRuntime = this.nativeHostService.canInvoke();
    if (!desktopRuntime) {
      const ui = this.getUi();
      this.notificationService.info(ui.toastDesktopLlmTestOnly);
      return;
    }

    try {
      const result = await this.settingsModel.listCustomTranslationModels(
        this.getSettingsModelContext(),
      );
      this.scheduleImmediateAutoSave();
      const ui = this.getUi();
      this.notificationService.info(
        formatLocaleMessage(ui.toastTranslationModelsLoaded, {
          count: String(result.models.length),
        }),
      );
    } catch (testError) {
      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, testError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastTranslationModelsFailed, {
          error: localizedError,
        }),
      );
    }
  };

  private getSettingsModelContext() {
    return {
      desktopRuntime: this.nativeHostService.canInvoke(),
      invokeDesktop: this.nativeHostService.invoke,
    };
  }

  private getUi(): LocaleMessages {
    return this.languageService.getLocaleMessages(this.localeService.getLocale());
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
		this.editorDraftStyleService.setDefaultBodyStyle(
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

      const ui = this.getUi();
      const localizedError = localizeSettingsError(ui, loadError);
      this.notificationService.error(
        formatLocaleMessage(ui.toastLoadSettingsFailed, { error: localizedError }),
      );
    }
  };

  private readonly handleEditorDraftStyleChange = () => {
    if (this.disposed || this.isApplyingLoadedEditorDraftStyle) {
      return;
    }

    const nextEditorDraftStyle = cloneEditorDraftStyleSettings(
		this.editorDraftStyleService.getSnapshot(),
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
	const snapshot = this.editorDraftStyleService.getSnapshot();
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

	this.editorDraftStyleService.setDefaultBodyStyle(nextDefaultBodyStyle);
  }

  private flushAutoSave = () => {
    const locale = this.localeService.getLocale();

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

export const ISettingsController = createDecorator<SettingsController>('settingsController');

registerSingleton(
  ISettingsController,
  SettingsController,
  InstantiationType.Delayed,
);
