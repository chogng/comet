/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
  ChatServiceContext,
  IChatService,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatService as IChatServiceDecorator } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { createDocumentActionsController } from 'cs/workbench/browser/documentActionsModel';
import type { DocumentActionsController, DocumentActionsControllerContext } from 'cs/workbench/browser/documentActionsModel';
import { createArticleSummaryTranslationExportController } from 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';
import type {
  ArticleSummaryTranslationExportController,
  ArticleSummaryTranslationExportControllerContext,
} from 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';
import { createLibraryModel } from 'cs/workbench/browser/libraryModel';
import type { LibraryModel, LibraryModelContext } from 'cs/workbench/browser/libraryModel';

import { Schemas } from 'cs/base/common/network';
import {
  getWorkbenchLayoutStateSnapshot,
  registerWorkbenchPartDomNode,
  createSessionWorkbenchLayoutView,
  setAgentSidebarVisible,
  setEditorCollapsed,
  setPrimarySidebarVisible,
  subscribeWorkbenchLayoutState,
  WORKBENCH_PART_IDS,
} from 'cs/workbench/browser/layout';
import {
  ActivateCodeSidebarEntryAction,
  ActivateHomeSidebarEntryAction,
  ApplyAgentLayoutAction,
  ApplyFlowLayoutAction,
  ToggleEditorCollapsedAction,
  ToggleSidebarVisibilityAction,
} from 'cs/workbench/browser/actions/layoutActions';
import {
  SettingsController,
  type SettingsControllerContext,
} from 'cs/workbench/contrib/preferences/browser/settingsController';
import { createEditorPartController } from 'cs/workbench/browser/parts/editor/editorPart';
import type { EditorPartChangeReason, EditorPartControllerContext, EditorPartModel } from 'cs/workbench/browser/parts/editor/editorPart';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { generateUuid } from 'cs/base/common/uuid';

import type { EditorPartProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import { createEditorBrowserToolbarActions } from 'cs/workbench/contrib/browserView/browser/browserToolbarActions';
import { SidebarFooterActionsView } from 'cs/workbench/browser/parts/sidebar/sidebarFooterActions';
import {
  createSidebarFooterTitlebarLabels,
  createSidebarFooterTitlebarActionsProps,
  createTitlebarLeadingActionsProps,
} from 'cs/workbench/browser/parts/titlebar/titlebarActions';
import { createTitlebarPart } from 'cs/workbench/browser/parts/titlebar/titlebarPart';
import type { TitlebarPart } from 'cs/workbench/browser/parts/titlebar/titlebarPart';
import { syncWorkbenchWindowTitle } from 'cs/workbench/browser/parts/titlebar/windowTitle';
import {
  createSettingsPartView,
  createSettingsPartProps,
} from 'cs/workbench/contrib/preferences/browser/settingsEditor';

import {
  createSessionChatViewProps,
  type SessionChatViewProps,
} from 'cs/sessions/browser/parts/sessions/chatView';
import type { SessionSidebarProps as SidebarProps } from 'cs/sessions/browser/parts/sidebar/sidebarPart';
import { SessionWorkbenchContentPartViews } from 'cs/sessions/browser/workbenchContentPartViews';

import { createEditorTitlebarActionsView } from 'cs/workbench/browser/parts/editor/editorTitlebarActionsView';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { setARIAContainer } from 'cs/base/browser/ui/aria/aria';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { INotificationService } from 'cs/platform/notification/common/notification';
import {
  getWorkbenchInstantiationService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { IBrowserEditorToolbarService } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';
import { NotificationsAlerts } from 'cs/workbench/browser/parts/notifications/notificationsAlerts';
import { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import { NotificationsStatus } from 'cs/workbench/browser/parts/notifications/notificationsStatus';
import { NotificationsToasts } from 'cs/workbench/browser/parts/notifications/notificationsToasts';
import { NotificationService } from 'cs/workbench/services/notification/common/notificationService';

import {
  localeService,
} from 'cs/workbench/services/localization/browser/localeService';
import { setWorkbenchEditorCommandHandlers } from 'cs/workbench/browser/editorCommands';
import { handleWorkbenchEditorShortcut } from 'cs/workbench/browser/workbenchEditorShortcuts';
import {
  getWindowStateSnapshot,
  subscribeWindowState,
} from 'cs/workbench/browser/window';

import { getLocaleMessages } from 'language/i18n';
import { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import { normalizeUrl } from 'cs/workbench/common/url';
import type { AppStartupLayout, LlmProviderId, LlmProviderSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { normalizeBrowserTabKeepAliveLimit } from 'cs/workbench/services/webContent/webContentRetentionConfig';
import {
  getLlmProviderDefinition,
  getLlmModelByIdForProvider,
  getLlmModelOptionsForProvider,
  hasLlmMaxContextWindow,
  parseLlmModelOptionValue,
} from 'cs/workbench/services/llm/registry';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';

import type { WritingEditorStableSelectionTarget } from 'cs/editor/common/writingEditorDocument';
import { editorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';
import { INativeHostService } from 'cs/platform/native/common/native';
import { IWorkbenchConfigurationService } from 'cs/workbench/services/configuration/common/configuration';
import {
  BrowserMaxHistoryEntriesSettingId,
  BrowserPageZoomSettingId,
  BrowserSearchEngineSettingId,
  maxBrowserMaxHistoryEntries,
  minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IStorageService } from 'cs/platform/storage/common/storage';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import {
  IWorkbenchSidebarEntryService,
  type WorkbenchSidebarEntry,
} from 'cs/workbench/services/sidebar/common/sidebarEntryService';
import { applyWorkbenchTheme } from 'cs/workbench/services/themes/browser/workbenchThemeService';
import { applyWorkbenchBrowserStyles } from 'cs/workbench/browser/style';
import {
  ILifecycleService,
  LifecyclePhase,
  type IWorkbenchLifecycleService,
} from 'cs/workbench/services/lifecycle/common/lifecycle';

export type WorkbenchServicesSyncParams = {
  settingsController: SettingsController;
  settingsContext: SettingsControllerContext;
  libraryModel: LibraryModel;
  libraryContext: LibraryModelContext;
  editorPartController: EditorPartModel;
  editorPartContext: EditorPartControllerContext;
  chatService: IChatService;
  chatContext: ChatServiceContext;
  articleSummaryTranslationExportController: ArticleSummaryTranslationExportController;
  articleSummaryTranslationExportContext: ArticleSummaryTranslationExportControllerContext;
  documentActionsController: DocumentActionsController;
  documentActionsContext: DocumentActionsControllerContext;
};

type DesktopInvokeArgs = Record<string, unknown> | undefined;

let settingsController: SettingsController | null = null;
let libraryModel: LibraryModel | null = null;
let editorPartController: EditorPartModel | null = null;
let articleSummaryTranslationExportController: ArticleSummaryTranslationExportController | null = null;
let documentActionsController: DocumentActionsController | null = null;
let activeWorkbenchHost: WorkbenchHost | null = null;
let activeAgentChatModelOptionValue: string | null = null;

const llmProviderIconMap: Record<LlmProviderId, LxIconName> = {
  glm: 'model',
  kimi: 'kimi-color',
  deepseek: 'deepseek-color',
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini-color',
  custom: 'model',
};

const AGENT_CHAT_AUTO_MODEL_OPTION_VALUE = 'auto';

function resolveRuntimeState(nativeHost: INativeHostService) {
  const electronRuntime = nativeHost.canInvoke();
  const webContentRuntime =
    typeof nativeHost.webContent?.navigate === 'function';

  return {
    electronRuntime,
    webContentRuntime,
    desktopRuntime: electronRuntime,
  };
}

function createAgentChatLlmSettings(
  activeProvider: LlmProviderId,
  llmProviders: Record<LlmProviderId, LlmProviderSettings>,
  selectedModelOptionValue: string | null,
) {
  if (
    selectedModelOptionValue &&
    selectedModelOptionValue !== AGENT_CHAT_AUTO_MODEL_OPTION_VALUE
  ) {
    const parsed = parseLlmModelOptionValue(selectedModelOptionValue);
    if (parsed) {
      return {
        activeProvider: parsed.providerId,
        providers: {
          ...llmProviders,
          [parsed.providerId]: {
            ...llmProviders[parsed.providerId],
            selectedModelOption: selectedModelOptionValue,
          },
        },
      };
    }
  }

  return {
    activeProvider,
    providers: {
      ...llmProviders,
      [activeProvider]: {
        ...llmProviders[activeProvider],
        selectedModelOption: '',
      },
    },
  };
}

function resolveAgentChatLlmProvider(
  activeProvider: LlmProviderId,
  selectedModelOptionValue: string | null,
) {
  if (
    !selectedModelOptionValue ||
    selectedModelOptionValue === AGENT_CHAT_AUTO_MODEL_OPTION_VALUE
  ) {
    return activeProvider;
  }

  return parseLlmModelOptionValue(selectedModelOptionValue)?.providerId ?? activeProvider;
}

function resolveAgentChatManualModelOptionValue(
  activeProvider: LlmProviderId,
  llmProviders: Record<LlmProviderId, LlmProviderSettings>,
) {
  const providerSettings = llmProviders[activeProvider];
  const enabledOptions = getLlmModelOptionsForProvider(
    activeProvider,
    providerSettings.enabledModelOptions,
    { enabledOnly: true },
  );

  if (
    providerSettings.selectedModelOption &&
    enabledOptions.some((option) => option.value === providerSettings.selectedModelOption)
  ) {
    return providerSettings.selectedModelOption;
  }

  return enabledOptions[0]?.value ?? '';
}

function formatAgentChatReasoningEffortLabel(value: string | undefined) {
  if (!value || value === 'none') {
    return '';
  }

  return value === 'xhigh'
    ? 'XHigh'
    : value.charAt(0).toUpperCase() + value.slice(1);
}

function createAgentChatModelDisplayLabel(
  llmSettings: ReturnType<typeof createAgentChatLlmSettings>,
) {
  const route = resolveLlmRoute(llmSettings, 'reasoning');
  const model = getLlmModelByIdForProvider(route.provider, route.model);
  const providerSettings = llmSettings.providers[route.provider];
  const parts = [
    model?.label ?? route.model,
    model && providerSettings.useMaxContextWindow && hasLlmMaxContextWindow(model)
      ? '1M'
      : '',
    formatAgentChatReasoningEffortLabel(route.reasoningEffort),
    route.serviceTier === 'priority' ? 'Fast' : '',
  ].filter(Boolean);

  return parts.join(' ');
}

function doesAgentChatModelSupportMaxContextWindow(
  llmSettings: ReturnType<typeof createAgentChatLlmSettings>,
) {
  const route = resolveLlmRoute(llmSettings, 'reasoning');
  const model = getLlmModelByIdForProvider(route.provider, route.model);
  return model ? hasLlmMaxContextWindow(model) : false;
}

function formatStableSelectionWritingContext(
  target: WritingEditorStableSelectionTarget | null,
  fallbackDraftBody: string,
) {
  if (!target) {
    return fallbackDraftBody;
  }

  const selectedText = target.selectedText.trim();
  const blockText = target.blockText.trim();
  if (!blockText) {
    return fallbackDraftBody;
  }

  return [
    '[selection]',
    `blockId: ${target.blockId}`,
    `kind: ${target.kind}`,
    `range: ${target.range.startLineNumber}:${target.range.startColumn}-${target.range.endLineNumber}:${target.range.endColumn}`,
    `offsets: ${target.startOffset}-${target.endOffset}`,
    `collapsed: ${target.isCollapsed ? 'true' : 'false'}`,
    '',
    '[selectedText]',
    selectedText || '(empty selection)',
    '',
    '[blockText]',
    blockText,
    '',
    '[draftFallback]',
    fallbackDraftBody.trim() || '(empty draft)',
  ].join('\n');
}

class WorkbenchHost {
  private readonly rootElement: HTMLElement;
  private readonly containerElement: HTMLDivElement;
  private readonly shellElement: HTMLDivElement;
  private readonly pageMount: HTMLDivElement;
  private readonly settingsOverlayElement: HTMLDivElement;
  private readonly settingsOverlayBodyElement: HTMLDivElement;
  private readonly statusbarElement: HTMLElement;
  private readonly titlebarPart: TitlebarPart;
  private readonly notificationsDisposables = new DisposableStore();
  private workbenchLayoutView: ReturnType<typeof createSessionWorkbenchLayoutView> | null = null;
  private workbenchContentPartViews: SessionWorkbenchContentPartViews | null = null;
  private readonly collapsedEditorTitlebarActionsView: ReturnType<typeof createEditorTitlebarActionsView>;
  private readonly sidebarFooterActionsView: SidebarFooterActionsView;
  private settingsView: ReturnType<typeof createSettingsPartView> | null = null;
	private readonly globalDisposables: Array<() => void> = [];
  private servicesSubscribed = false;
  private isDisposed = false;
  private isRendering = false;
  private renderPending = false;
  private settingsOverlayVisible = false;
  private readonly sidebarEntryConversationIds: Record<
    WorkbenchSidebarEntry,
    string | null
  > = {
    home: null,
    code: null,
  };
  private appliedKnowledgeBaseModeEnabled: boolean | null = null;
  private hasAppliedStartupLayoutPreference = false;
  private appliedBrowserSettings: {
    maxHistoryEntries: number;
    pageZoom: string;
    searchEngine: string;
  } | null = null;
  private readonly handleWindowKeydown = (event: KeyboardEvent) => {
    handleWorkbenchEditorShortcut(event);
  };
  constructor(
    rootElement: HTMLElement,
    @INotificationService private readonly notificationService: NotificationService,
    @INativeHostService private readonly nativeHostService: INativeHostService,
    @IOpenerService private readonly openerService: IOpenerService,
    @IDialogService private readonly dialogService: IDialogService,
    @IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
    @IContextViewService private readonly contextViewService: IContextViewService,
    @IContextMenuService private readonly contextMenuService: IContextMenuService,
    @IChatServiceDecorator private readonly chatService: IChatService,
    @IWorkbenchSidebarEntryService private readonly sidebarEntryService: IWorkbenchSidebarEntryService,
    @IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
    @IEditorService private readonly editorService: IEditorService,
    @IDraftEditorService private readonly draftEditorService: IDraftEditorService,
	@IBrowserEditorToolbarService private readonly browserEditorToolbarService: IBrowserEditorToolbarService,
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @IFetchService private readonly fetchService: IFetchService,
    @IWorkbenchConfigurationService private readonly configurationService: IWorkbenchConfigurationService,
    @ILifecycleService private readonly lifecycleService: IWorkbenchLifecycleService,
	@IStorageService private readonly storageService: IStorageService,
  ) {
    const dropdownServices = {
      contextMenuService: this.contextMenuService,
      contextViewProvider: this.contextViewService,
    };
    this.collapsedEditorTitlebarActionsView = createEditorTitlebarActionsView({
      ...dropdownServices,
      isEditorCollapsed: true,
      isAgentSidebarVisible: false,
      showAgentSidebarToggle: false,
      agentSidebarToggleLabel: '',
      labels: {
        headerAddAction: '',
        expandEditor: '',
        collapseEditor: '',
      },
		creationActions: [],
      commandService: this.commandService,
      onToggleEditorCollapse: () => {},
    });
    this.sidebarFooterActionsView = new SidebarFooterActionsView(dropdownServices);
    this.rootElement = rootElement;
    this.containerElement = document.createElement('div');
    this.shellElement = document.createElement('div');
    this.pageMount = document.createElement('div');
    this.settingsOverlayElement = document.createElement('div');
    this.settingsOverlayBodyElement = document.createElement('div');
    this.statusbarElement = document.createElement('section');
    this.settingsOverlayElement.className = 'comet-settings-overlay';
    this.settingsOverlayElement.hidden = true;
    this.settingsOverlayBodyElement.className = 'comet-settings-body';
    this.settingsOverlayElement.append(this.settingsOverlayBodyElement);
    this.settingsOverlayElement.addEventListener('click', event => {
      if (event.target === this.settingsOverlayElement) {
        this.closeSettingsOverlay();
      }
    });
    this.titlebarPart = createTitlebarPart(
      this.containerElement,
      this.shellElement,
      this.statusbarElement,
      dropdownServices,
    );

    this.rootElement.replaceChildren(this.containerElement);
    this.containerElement.append(this.titlebarPart.getElement(), this.shellElement);
    this.shellElement.append(
      this.pageMount,
      this.settingsOverlayElement,
    );
    this.createNotificationsHandlers();

    registerWorkbenchPartDomNode(
      WORKBENCH_PART_IDS.container,
      this.containerElement,
    );
  }

  start() {
    window.addEventListener('keydown', this.handleWindowKeydown);
    this.globalDisposables.push(
      localeService.subscribe(this.requestRender),
      subscribeWorkbenchLayoutState(this.requestRender),
      subscribeWindowState(this.requestRender),
      editorDraftStyleService.subscribe(this.requestRender),
      this.sidebarEntryService.onDidChangeActiveEntry(this.requestRender),
    );

    this.requestRender();
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    window.removeEventListener('keydown', this.handleWindowKeydown);
    while (this.globalDisposables.length > 0) {
      this.globalDisposables.pop()?.();
    }

    setWorkbenchEditorCommandHandlers(null);
	this.browserEditorToolbarService.setActions(null);
    this.titlebarPart.dispose();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, null);

    this.workbenchLayoutView?.dispose();
    this.workbenchLayoutView = null;
    this.workbenchContentPartViews?.dispose();
    this.workbenchContentPartViews = null;
    this.collapsedEditorTitlebarActionsView.dispose();
    this.sidebarFooterActionsView.dispose();
    this.settingsView?.dispose();
    this.settingsView = null;
		this.notificationsDisposables.dispose();
    this.rootElement.replaceChildren();
  }

  private createNotificationsHandlers() {
    const notificationsCenter = this.notificationsDisposables.add(
      new NotificationsCenter(this.containerElement, this.notificationService.model),
    );
    this.notificationsDisposables.add(
      new NotificationsToasts(this.containerElement, this.notificationService.model),
    );
    this.notificationsDisposables.add(
      new NotificationsStatus(
        this.containerElement,
        this.notificationService.model,
        notificationsCenter,
      ),
    );
    this.notificationsDisposables.add(
      new NotificationsAlerts(this.containerElement, this.notificationService.model),
    );
  }

  private readonly requestRender = () => {
    if (this.isDisposed) {
      return;
    }

    if (this.isRendering) {
      this.renderPending = true;
      return;
    }

    this.isRendering = true;
    try {
      do {
        this.renderPending = false;
        this.performRender();
      } while (this.renderPending && !this.isDisposed);
    } finally {
      this.isRendering = false;
    }
  };

  private syncBrowserSettings(settings: {
    browserMaxHistoryEntries: number;
    browserPageZoom: string;
    browserSearchEngine: string;
  }) {
    if (
      this.appliedBrowserSettings?.maxHistoryEntries === settings.browserMaxHistoryEntries &&
      this.appliedBrowserSettings?.pageZoom === settings.browserPageZoom &&
      this.appliedBrowserSettings?.searchEngine === settings.browserSearchEngine
    ) {
      return;
    }

    this.appliedBrowserSettings = {
      maxHistoryEntries: settings.browserMaxHistoryEntries,
      pageZoom: settings.browserPageZoom,
      searchEngine: settings.browserSearchEngine,
    };
    void this.configurationService.updateValue(
      BrowserMaxHistoryEntriesSettingId,
      settings.browserMaxHistoryEntries,
    );
    void this.configurationService.updateValue(BrowserPageZoomSettingId, settings.browserPageZoom);
    void this.configurationService.updateValue(
      BrowserSearchEngineSettingId,
      settings.browserSearchEngine,
    );
  }

  private ensureServiceSubscriptions(services: {
    settingsController: SettingsController;
    libraryModel: LibraryModel;
    editorPartController: EditorPartModel;
    chatService: IChatService;
    articleSummaryTranslationExportController: ArticleSummaryTranslationExportController;
    documentActionsController: DocumentActionsController;
  }) {
    if (this.servicesSubscribed) {
      return;
    }

    this.servicesSubscribed = true;
    this.globalDisposables.push(
      services.settingsController.subscribe(this.requestRender),
      services.libraryModel.subscribe(this.requestRender),
      services.editorPartController.subscribe(this.handleEditorPartChange),
      services.chatService.subscribe(this.requestRender),
      services.articleSummaryTranslationExportController.subscribe(this.requestRender),
      services.documentActionsController.subscribe(this.requestRender),
    );
  }

  private readonly handleEditorPartChange = (
    _reason: EditorPartChangeReason,
  ) => {
    this.requestRender();
  };

  private readonly togglePrimarySidebarVisibility = () => {
    this.commandService.executeCommand(
      ToggleSidebarVisibilityAction.ID,
    );
  };

  private readonly toggleEditorCollapsed = () => {
    this.commandService.executeCommand(
      ToggleEditorCollapsedAction.ID,
    );
  };

  private readonly applyAgentLayout = () => {
    this.commandService.executeCommand(ApplyAgentLayoutAction.ID);
  };

  private readonly applyFlowLayout = () => {
    this.commandService.executeCommand(ApplyFlowLayoutAction.ID);
  };

  private readonly activateSidebarEntry = (entry: WorkbenchSidebarEntry) => {
    const commandId =
      entry === 'home'
        ? ActivateHomeSidebarEntryAction.ID
        : ActivateCodeSidebarEntryAction.ID;
    this.commandService.executeCommand(commandId);
  };

  private readonly showSettingsPage = () => {
    if (this.settingsOverlayVisible) {
      return;
    }
    this.settingsOverlayVisible = true;
    this.requestRender();
  };

  private readonly toggleSettingsPage = () => {
    this.settingsOverlayVisible = !this.settingsOverlayVisible;
    this.requestRender();
  };

  private readonly closeSettingsOverlay = () => {
    if (!this.settingsOverlayVisible) {
      return;
    }
    this.settingsOverlayVisible = false;
    this.requestRender();
  };

  private syncActiveSidebarEntryConversation() {
    const conversationId = this.ensureSidebarEntryConversation(
      this.sidebarEntryService.getActiveEntry(),
    );
    this.chatService.activateConversation(conversationId);
  }

  private ensureSidebarEntryConversation(entry: WorkbenchSidebarEntry) {
    const conversationId = this.sidebarEntryConversationIds[entry];
    if (conversationId) {
      return conversationId;
    }

    if (entry === 'home') {
      const homeConversationId = this.chatService.getSnapshot().activeConversationId;
      this.sidebarEntryConversationIds.home = homeConversationId;
      return homeConversationId;
    }

    const codeConversationId = this.chatService.createConversation();
    this.sidebarEntryConversationIds.code = codeConversationId;
    return codeConversationId;
  }

  private syncKnowledgeBaseLayout(isKnowledgeBaseModeEnabled: boolean) {
    if (
      this.appliedKnowledgeBaseModeEnabled === isKnowledgeBaseModeEnabled
    ) {
      return;
    }

    this.appliedKnowledgeBaseModeEnabled = isKnowledgeBaseModeEnabled;
    setPrimarySidebarVisible(isKnowledgeBaseModeEnabled);
    setAgentSidebarVisible(true);
  }

  private syncEditorCommandHandlers() {
    setWorkbenchEditorCommandHandlers({
      executeActiveDraftCommand: (commandId) =>
        this.workbenchContentPartViews?.executeActiveDraftCommand(commandId) ?? false,
      canExecuteActiveDraftCommand: (commandId) =>
        this.workbenchContentPartViews?.canExecuteActiveDraftCommand(commandId) ?? false,
      getActiveDraftStableSelectionTarget: () =>
        this.workbenchContentPartViews?.getActiveDraftStableSelectionTarget() ?? null,
      saveActiveDraft: () =>
        this.draftEditorService.saveActive(),
      canSaveActiveDraft: () =>
        this.draftEditorService.canSaveActive(),
    });
  }

  private renderWorkbenchContentPage(props: {
    isPrimarySidebarVisible: boolean;
    isLayoutEdgeSnappingEnabled: boolean;
    primarySidebarSize: number;
    isEditorCollapsed: boolean;
    expandedEditorSize: number;
    sidebarProps: SidebarProps;
    sessionChatProps: SessionChatViewProps;
    sidebarFooterActionsProps: ReturnType<
      typeof createSidebarFooterTitlebarActionsProps
    >;
    collapsedEditorTitlebarActionsElement: HTMLElement;
    editorPartProps: EditorPartProps;
  }) {
    this.sidebarFooterActionsView.setProps(
      props.sidebarFooterActionsProps,
    );

    //#region Column titlebar routing

    const partViewProps = {
      isPrimarySidebarVisible: props.isPrimarySidebarVisible,
      isEditorVisible: !props.isEditorCollapsed,
      sidebarProps: props.sidebarProps,
      sessionChatProps: props.sessionChatProps,
      editorPartProps: props.editorPartProps,
      leadingTitlebarActionsElement:
        this.titlebarPart.getLeadingActionsElement(),
      sidebarFooterActionsElement: this.sidebarFooterActionsView.getElement(),
      collapsedEditorTitlebarActionsElement:
        props.collapsedEditorTitlebarActionsElement,
    };

    //#endregion

    if (!this.workbenchContentPartViews) {
      this.workbenchContentPartViews = this.instantiationService.createInstance(
        SessionWorkbenchContentPartViews,
        partViewProps,
      );
    } else {
      this.workbenchContentPartViews.setProps(partViewProps);
    }
    if (!this.workbenchLayoutView) {
      this.workbenchLayoutView = createSessionWorkbenchLayoutView({
        isPrimarySidebarVisible: props.isPrimarySidebarVisible,
        isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: props.primarySidebarSize,
        isEditorCollapsed: props.isEditorCollapsed,
        expandedEditorSize: props.expandedEditorSize,
        partViews: this.workbenchContentPartViews,
      });
    } else {
      this.workbenchLayoutView.setProps({
        isPrimarySidebarVisible: props.isPrimarySidebarVisible,
        isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: props.primarySidebarSize,
        isEditorCollapsed: props.isEditorCollapsed,
        expandedEditorSize: props.expandedEditorSize,
        partViews: this.workbenchContentPartViews,
      });
    }
    this.syncEditorCommandHandlers();

    const workbenchContentElement = this.workbenchLayoutView.getElement();
    if (this.pageMount.firstChild !== workbenchContentElement) {
      this.pageMount.replaceChildren(workbenchContentElement);
    }
    this.workbenchLayoutView.layout();
  }

  private renderSettingsOverlay(
    props: {
      settingsPartProps: ReturnType<typeof createSettingsPartProps>;
    },
  ) {
    if (!this.settingsOverlayVisible) {
      this.settingsView?.dispose();
      this.settingsView = null;
      this.settingsOverlayBodyElement.replaceChildren();
      this.settingsOverlayElement.hidden = true;
      return;
    }

    if (!this.settingsView) {
      this.settingsView = createSettingsPartView(props.settingsPartProps, this.contextViewService);
    } else {
      this.settingsView.setProps(props.settingsPartProps);
    }
    this.settingsOverlayElement.hidden = false;
    const navigationElement = this.settingsView.getNavigationElement();
    const settingsElement = this.settingsView.getElement();
    if (
      this.settingsOverlayBodyElement.children[0] !== navigationElement ||
      this.settingsOverlayBodyElement.children[1] !== settingsElement ||
      this.settingsOverlayBodyElement.childElementCount !== 2
    ) {
      this.settingsOverlayBodyElement.replaceChildren(
        navigationElement,
        settingsElement,
      );
    }
  }

  private applyStartupLayoutPreferenceIfNeeded(params: {
    hasLoadedSettings: boolean;
    startupLayout: AppStartupLayout;
    isPrimarySidebarVisible: boolean;
    isAgentSidebarVisible: boolean;
    isEditorCollapsed: boolean;
  }) {
    if (this.hasAppliedStartupLayoutPreference || !params.hasLoadedSettings) {
      return false;
    }

    this.hasAppliedStartupLayoutPreference = true;
    const needsLayoutUpdate =
      !params.isPrimarySidebarVisible ||
      !params.isAgentSidebarVisible ||
      !params.isEditorCollapsed;

    if (!needsLayoutUpdate) {
      return false;
    }

    setPrimarySidebarVisible(true);
    setAgentSidebarVisible(true);
    setEditorCollapsed(true);
    return true;
  }

  private performRender() {
    const locale = localeService.getLocale();
    const ui = getLocaleMessages(locale);
    const {
      isPrimarySidebarVisible,
      isAgentSidebarVisible,
      primarySidebarSize,
      isEditorCollapsed,
      expandedEditorSize,
    } = getWorkbenchLayoutStateSnapshot();
    const { isFullscreen: isWindowFullscreen } = getWindowStateSnapshot();
    const nativeHost = this.nativeHostService;
    const { electronRuntime, webContentRuntime, desktopRuntime } =
      resolveRuntimeState(nativeHost);

    const invokeDesktop = async <T>(
      command: string,
      args?: DesktopInvokeArgs,
    ): Promise<T> => {
      return nativeHost.invoke(command as never, args as never) as Promise<T>;
    };

    const settingsControllerInstance = getWorkbenchSettingsController(
      this.instantiationService,
      {
        desktopRuntime,
        invokeDesktop,
        notificationService: this.notificationService,
        ui,
        locale,
      },
    );
    const settingsSnapshot = settingsControllerInstance.getSnapshot();
    if (
      this.applyStartupLayoutPreferenceIfNeeded({
        hasLoadedSettings: settingsSnapshot.hasLoadedSettings,
        startupLayout: settingsSnapshot.startupLayout,
        isPrimarySidebarVisible,
        isAgentSidebarVisible,
        isEditorCollapsed,
      })
    ) {
      return;
    }
    const editorDraftStyleSnapshot = editorDraftStyleService.getSnapshot();
    const {
      hasLoadedSettings,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
      startupLayout,
      browserTabKeepAliveLimit,
      browserMaxHistoryEntries,
      browserPageZoom,
      browserSearchEngine,
      useMica,
      theme,
      workbenchColorCustomizations,
      knowledgeBaseEnabled,
      autoIndexDownloadedPdf,
      knowledgeBasePdfDownloadDir,
      libraryStorageMode,
      libraryDirectory,
      maxConcurrentIndexJobs,
      activeRagProvider,
      ragProviders,
      retrievalCandidateCount,
      retrievalTopK,
      pdfDownloadDir,
      pdfFileNameUseSelectionOrder,
      activeLlmProvider,
      llmProviders,
      activeTranslationProvider,
      translationProviders,
      configPath,
      defaultConfigPath,
      isSettingsLoading,
      isSettingsSaving,
      isTestingRagConnection,
      isTestingLlmConnection,
      isTestingTranslationConnection,
      isLoadingTranslationModels,
    } = settingsSnapshot;
    this.syncBrowserSettings({
      browserMaxHistoryEntries,
      browserPageZoom,
      browserSearchEngine,
    });
    applyWorkbenchTheme(theme, workbenchColorCustomizations);
    applyWorkbenchBrowserStyles();
    const knowledgeBaseModeEnabled = knowledgeBaseEnabled;
    this.syncKnowledgeBaseLayout(knowledgeBaseModeEnabled);

    const libraryModelInstance = getWorkbenchLibraryModel({
      desktopRuntime,
      invokeDesktop,
    });
    const { librarySnapshot, isLibraryLoading } =
      libraryModelInstance.getSnapshot();
    const refreshLibrary = () => {
      void libraryModelInstance.refresh();
    };

    const currentLlmSettings = createAgentChatLlmSettings(
      activeLlmProvider,
      llmProviders,
      activeAgentChatModelOptionValue,
    );
    const agentLlmModelOptions = [{
      value: AGENT_CHAT_AUTO_MODEL_OPTION_VALUE,
      label: 'Auto',
      icon: 'agent' as const,
      title: 'Auto',
    }, ...(Object.entries(llmProviders) as Array<
      [LlmProviderId, (typeof llmProviders)[LlmProviderId]]
    >).flatMap(([provider, providerSettings]) => {
      const providerLabel = getLlmProviderDefinition(provider).label;
      const providerOptions = getLlmModelOptionsForProvider(
        provider,
        providerSettings.enabledModelOptions,
        { enabledOnly: true },
      );
      return providerOptions.map((option) => ({
        value: option.value,
        label: option.label,
        modelLabel: option.model.label,
        providerId: option.providerId,
        modelId: option.modelId,
        reasoningEffort: option.reasoningEffort,
        serviceTier: option.serviceTier,
        icon: llmProviderIconMap[provider],
        title: `${providerLabel} / ${option.title}`,
      }));
    })];
    const activeLlmModelOptionValue =
      activeAgentChatModelOptionValue ?? AGENT_CHAT_AUTO_MODEL_OPTION_VALUE;
    const currentRagSettings = {
      enabled: knowledgeBaseModeEnabled,
      activeProvider: activeRagProvider,
      providers: ragProviders,
      retrievalCandidateCount,
      retrievalTopK,
    };

    const viewPartProps = {
      browserUrl: '',
      browserPageTitle: '',
      browserFaviconUrl: '',
      browserIsLoading: false,
      electronRuntime,
      webContentRuntime,
      labels: {
        emptyState: ui.emptyState,
        contentUnavailable: ui.webContentUnavailable,
        overlayPauseHeading: ui.webContentOverlayPauseHeading,
        overlayPauseDetail: ui.webContentOverlayPauseDetail,
      },
    };
    const editorPartControllerInstance = getWorkbenchEditorPartController({
      ui,
      viewPartProps,
      nativeHost,
      dialogService: this.dialogService,
      instantiationService: this.instantiationService,
      editorGroupsService: this.editorGroupsService,
      editorService: this.editorService,
      storageService: this.storageService,
      commandService: this.commandService,
    });
		const editorPartSnapshot = editorPartControllerInstance.getSnapshot();
    const {
      group: editorGroup,
      editorPartProps,
    } = editorPartSnapshot;
    const draftBody = this.draftEditorService.getActiveBody();
    const activeEditor = editorGroup.activeEditor;
    const browserUrl = activeEditor?.getDescription() ?? '';
    const browserPageTitle = activeEditor?.getName() ?? '';
    const handleOpenEditor: EditorPartProps['onOpenEditor'] = editorPartProps.onOpenEditor;

    const chatServiceInstance = this.chatService;
    chatServiceInstance.setContext({
      desktopRuntime,
      invokeDesktop,
      ui,
      isKnowledgeBaseModeEnabled: knowledgeBaseModeEnabled,
      llmSettings: currentLlmSettings,
      ragSettings: currentRagSettings,
      fallbackWritingContext: draftBody,
      getFallbackWritingContext: () => this.draftEditorService.getActiveBody(),
      getDraftDocument: () => this.draftEditorService.getActiveDocument(),
      setDraftDocument: value => this.draftEditorService.setActiveDocument(value),
    });
    this.syncActiveSidebarEntryConversation();
    const assistantSnapshot = chatServiceInstance.getSnapshot();
    const {
      question: assistantQuestion,
      messages: assistantMessages,
      isAsking: isAssistantAsking,
      errorMessage: assistantErrorMessage,
    } = assistantSnapshot;
    const setAssistantQuestion = chatServiceInstance.setQuestion;
    const handleAssistantAsk = chatServiceInstance.ask;
    const handleAssistantApplyPatch =
      chatServiceInstance.applyPatch;

    const activeDraftDocument = this.draftEditorService.getActiveDocument();
    const activeDraftExport =
      activeDraftDocument
        ? {
            title: activeEditor?.getName() ?? '',
            document: activeDraftDocument,
            editorDraftStyle: {
              defaultBodyStyle: {
                ...editorDraftStyleSnapshot.defaultBodyStyle,
                inlineStyleDefaults: {
                  ...editorDraftStyleSnapshot.defaultBodyStyle.inlineStyleDefaults,
                },
              },
            },
          }
        : null;

    this.openerService.setDefaultExternalOpener({
      openExternal: async (href, { sourceUri }) => {
        if (sourceUri.scheme !== Schemas.http && sourceUri.scheme !== Schemas.https) {
          return false;
        }

        const browserLinkUrl = normalizeUrl(href);
        if (!browserLinkUrl) {
          return false;
        }

        handleOpenEditor({
          resource: BrowserViewUri.forId(generateUuid()),
          options: {
            viewState: {
              url: browserLinkUrl,
            },
          },
        });
        return true;
      },
    });
    const articleSummaryTranslationExportControllerInstance =
      getWorkbenchArticleSummaryTranslationExportController(
        {
          desktopRuntime,
          invokeDesktop,
          nativeHost,
          notificationService: this.notificationService,
          dialogService: this.dialogService,
          locale,
          ui,
          pdfDownloadDir,
          onUnavailableArticleIds: chatServiceInstance.removeArticleChecks,
        },
        this.fetchService,
      );

    const documentActionsControllerInstance =
      getWorkbenchDocumentActionsController(
        {
          desktopRuntime,
          invokeDesktop,
          notificationService: this.notificationService,
          locale,
          ui,
          knowledgeBaseEnabled,
          pdfDownloadDir,
          knowledgeBasePdfDownloadDir,
          pdfFileNameUseSelectionOrder,
			getExportableArticleIds: () => chatServiceInstance.getSnapshot().checkedArticleIds,
          onUnavailableArticleIds: chatServiceInstance.removeArticleChecks,
          onOpenEditor: handleOpenEditor,
          onExportArticleSummaries:
            articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries,
          activeDraftExport,
          onLibraryDocumentUpserted:
            libraryModelInstance.upsertDocumentSummary,
          onLibraryUpdated: refreshLibrary,
        },
        this.fetchService,
      );

    const baseEditorPartProps = editorPartProps;
    const focusWorkbenchWebUrlInput = () => {
      handleOpenEditor({
        resource: BrowserViewUri.forId(generateUuid()),
      });
      this.workbenchContentPartViews?.focusActiveEditorPrimaryInput();
    };
    const editorBrowserToolbarActions = createEditorBrowserToolbarActions({
      browserUrl,
      browserPageTitle,
      invokeDesktop,
      notificationService: this.notificationService,
      knowledgeBaseEnabled,
      ui,
      onLibraryUpdated: refreshLibrary,
      onOpenAddressBarSourceMenu: focusWorkbenchWebUrlInput,
      onToolbarExportDocx: () => {
        void documentActionsControllerInstance.handleExportDocx();
      },
    });
	this.browserEditorToolbarService.setActions(editorBrowserToolbarActions);
    const contentAwareEditorPartProps: EditorPartProps = {
      ...baseEditorPartProps,
      contextMenuService: this.contextMenuService,
      contextViewProvider: this.contextViewService,
      nativeHost,
		onOpenSources: focusWorkbenchWebUrlInput,
      onOpenEditor: handleOpenEditor,
      onToggleEditorCollapse: this.toggleEditorCollapsed,
    };
    this.collapsedEditorTitlebarActionsView.setProps({
      contextMenuService: this.contextMenuService,
      contextViewProvider: this.contextViewService,
      isEditorCollapsed: true,
      isAgentSidebarVisible: false,
      showAgentSidebarToggle: false,
      labels: {
        headerAddAction: contentAwareEditorPartProps.labels.headerAddAction,
        expandEditor: contentAwareEditorPartProps.labels.expandEditor,
        collapseEditor: contentAwareEditorPartProps.labels.collapseEditor,
      },
		creationActions: contentAwareEditorPartProps.creationActions,
      commandService: contentAwareEditorPartProps.commandService,
      onToggleEditorCollapse: this.toggleEditorCollapsed,
    });

    const activeDraftStableSelectionTarget =
      this.workbenchContentPartViews?.getActiveDraftStableSelectionTarget() ?? null;
    const assistantWritingContext = formatStableSelectionWritingContext(
      activeDraftStableSelectionTarget,
      draftBody,
    );

    syncWorkbenchServicesContext({
      settingsController: settingsControllerInstance,
      settingsContext: {
        desktopRuntime,
        invokeDesktop,
        notificationService: this.notificationService,
        ui,
        locale,
      },
      libraryModel: libraryModelInstance,
      libraryContext: {
        desktopRuntime,
        invokeDesktop,
      },
      editorPartController: editorPartControllerInstance,
      editorPartContext: {
        ui,
        viewPartProps,
        nativeHost,
        dialogService: this.dialogService,
        instantiationService: this.instantiationService,
        editorGroupsService: this.editorGroupsService,
        editorService: this.editorService,
        storageService: this.storageService,
        commandService: this.commandService,
      },
      chatService: chatServiceInstance,
      chatContext: {
        desktopRuntime,
        invokeDesktop,
        ui,
        isKnowledgeBaseModeEnabled: knowledgeBaseModeEnabled,
        llmSettings: currentLlmSettings,
        ragSettings: currentRagSettings,
        fallbackWritingContext: assistantWritingContext,
        getFallbackWritingContext: () =>
          formatStableSelectionWritingContext(
            this.workbenchContentPartViews?.getActiveDraftStableSelectionTarget() ?? null,
            this.draftEditorService.getActiveBody(),
          ),
        getDraftBody: () => this.draftEditorService.getActiveBody(),
        getDraftDocument: () => this.draftEditorService.getActiveDocument(),
        setDraftDocument: (value) =>
          this.draftEditorService.setActiveDocument(value),
        getActiveDraftStableSelectionTarget: () =>
          this.workbenchContentPartViews?.getActiveDraftStableSelectionTarget() ?? null,
      },
      articleSummaryTranslationExportController:
        articleSummaryTranslationExportControllerInstance,
      articleSummaryTranslationExportContext: {
        desktopRuntime,
        invokeDesktop,
        nativeHost,
        notificationService: this.notificationService,
        dialogService: this.dialogService,
        locale,
        ui,
        pdfDownloadDir,
        onUnavailableArticleIds: chatServiceInstance.removeArticleChecks,
      },
      documentActionsController: documentActionsControllerInstance,
      documentActionsContext: {
        desktopRuntime,
        invokeDesktop,
        notificationService: this.notificationService,
        locale,
        ui,
        knowledgeBaseEnabled,
        pdfDownloadDir,
        knowledgeBasePdfDownloadDir,
        pdfFileNameUseSelectionOrder,
		getExportableArticleIds: () => chatServiceInstance.getSnapshot().checkedArticleIds,
        onUnavailableArticleIds: chatServiceInstance.removeArticleChecks,
        onOpenEditor: handleOpenEditor,
        onExportArticleSummaries:
          articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries,
        activeDraftExport,
        onLibraryUpdated: refreshLibrary,
      },
    });

    this.ensureServiceSubscriptions({
      settingsController: settingsControllerInstance,
      libraryModel: libraryModelInstance,
      editorPartController: editorPartControllerInstance,
      chatService: chatServiceInstance,
      articleSummaryTranslationExportController:
        articleSummaryTranslationExportControllerInstance,
      documentActionsController: documentActionsControllerInstance,
    });

    const sidebarProps: SidebarProps = {
      labels: {
        homeTitle: ui.sidebarHomeTitle,
        codeTitle: ui.sidebarCodeTitle,
        homeNavNewChat: ui.sidebarHomeNavNewChat,
        homeNavProjects: ui.sidebarHomeNavProjects,
        homeNavArtifacts: ui.sidebarHomeNavArtifacts,
        homeNavCustomize: ui.sidebarHomeNavCustomize,
        recentsTitle: ui.sidebarRecentsTitle,
      },
      activeEntry: this.sidebarEntryService.getActiveEntry(),
      onActivateEntry: this.activateSidebarEntry,
      ...createSidebarFooterTitlebarLabels(ui),
    };

    const documentActionsSnapshot = documentActionsControllerInstance.getSnapshot();
    const articleSummaryTranslationExportSnapshot =
      articleSummaryTranslationExportControllerInstance.getSnapshot();
    const sessionChatProps = createSessionChatViewProps({
      state: {
        isKnowledgeBaseModeEnabled: knowledgeBaseModeEnabled,
        question: assistantQuestion,
        messages: assistantMessages,
        isAsking: isAssistantAsking,
        errorMessage: assistantErrorMessage,
        llmModelOptions: agentLlmModelOptions,
        activeLlmModelOptionValue,
        activeLlmModelLabel: createAgentChatModelDisplayLabel(currentLlmSettings),
        isMaxContextWindowEnabled:
          currentLlmSettings.providers[
            resolveAgentChatLlmProvider(
              activeLlmProvider,
              activeAgentChatModelOptionValue,
            )
          ].useMaxContextWindow ?? false,
        activeLlmModelSupportsMaxContextWindow:
          doesAgentChatModelSupportMaxContextWindow(currentLlmSettings),
      },
      actions: {
        onQuestionChange: setAssistantQuestion,
        onAsk: () => void handleAssistantAsk(),
        onApplyPatch: handleAssistantApplyPatch,
        onToggleAutoModelRouting: (options) => {
          activeAgentChatModelOptionValue = activeAgentChatModelOptionValue
            ? null
            : resolveAgentChatManualModelOptionValue(activeLlmProvider, llmProviders);
          if (!options?.suppressRender) {
            this.requestRender();
          }
          return activeAgentChatModelOptionValue ?? AGENT_CHAT_AUTO_MODEL_OPTION_VALUE;
        },
        onSelectLlmModel: (value) => {
          activeAgentChatModelOptionValue =
            value === AGENT_CHAT_AUTO_MODEL_OPTION_VALUE ? null : value;
          if (value === AGENT_CHAT_AUTO_MODEL_OPTION_VALUE) {
            this.requestRender();
            return;
          }
          this.requestRender();
          const parsed = parseLlmModelOptionValue(value);
          if (!parsed) {
            return;
          }
          settingsControllerInstance.setActiveLlmProvider(parsed.providerId);
          settingsControllerInstance.setLlmProviderSelectedModelOption(parsed.providerId, value);
        },
        onToggleMaxContextWindow: (options) => {
          const providerId = resolveAgentChatLlmProvider(
            activeLlmProvider,
            activeAgentChatModelOptionValue,
          );
          const nextValue =
            !(currentLlmSettings.providers[providerId].useMaxContextWindow ?? false);
          settingsControllerInstance.setLlmProviderUseMaxContextWindow(providerId, nextValue);
          if (!options?.suppressRender) {
            this.requestRender();
          }
        },
        onOpenModelSettings: () => {
          const selectedOption = activeAgentChatModelOptionValue
            ? parseLlmModelOptionValue(activeAgentChatModelOptionValue)
            : null;
          settingsControllerInstance.setActiveLlmProvider(
            selectedOption?.providerId ?? activeLlmProvider,
          );
          this.showSettingsPage();
        },
      },
    });
    const titlebarLeadingActionsProps = createTitlebarLeadingActionsProps({
      ui,
      isPrimarySidebarVisible,
      onTogglePrimarySidebar: this.togglePrimarySidebarVisibility,
      onFocusAddressBar: focusWorkbenchWebUrlInput,
    });
    const settingsPartProps = createSettingsPartProps({
      state: {
        ui,
        isSettingsLoading,
        locale,
        supportedSources: this.fetchService.getJournals(),
        systemNotificationsEnabled,
        warningNotificationsEnabled,
        menuBarIconEnabled,
        completionNotificationsEnabled,
        useMica,
        statusbarVisible,
        startupLayout,
        browserTabKeepAliveLimit,
        browserMaxHistoryEntries,
        browserPageZoom,
        browserSearchEngine,
        theme,
        editorDraftStyle: {
          defaultValue: {
            defaultBodyStyle: {
              ...settingsSnapshot.editorDraftStyle.defaultValue.defaultBodyStyle,
              inlineStyleDefaults: {
                ...settingsSnapshot.editorDraftStyle.defaultValue.defaultBodyStyle.inlineStyleDefaults,
              },
            },
          },
          userValue: settingsSnapshot.editorDraftStyle.userValue
            ? {
                defaultBodyStyle: {
                  ...settingsSnapshot.editorDraftStyle.userValue.defaultBodyStyle,
                  inlineStyleDefaults: {
                    ...settingsSnapshot.editorDraftStyle.userValue.defaultBodyStyle.inlineStyleDefaults,
                  },
                },
              }
            : null,
          value: {
            defaultBodyStyle: {
              ...editorDraftStyleSnapshot.defaultBodyStyle,
              inlineStyleDefaults: {
                ...editorDraftStyleSnapshot.defaultBodyStyle.inlineStyleDefaults,
              },
            },
          },
        },
        editorDraftFontFamilyOptions: editorDraftStyleSnapshot.fontFamilyPresets,
        editorDraftFontSizeOptions: editorDraftStyleSnapshot.fontSizePresets,
        knowledgeBaseEnabled,
        autoIndexDownloadedPdf,
        knowledgeBasePdfDownloadDir,
        libraryStorageMode,
        libraryDirectory,
        maxConcurrentIndexJobs,
        activeRagProvider,
        ragProviders,
        retrievalCandidateCount,
        retrievalTopK,
        pdfDownloadDir,
        pdfFileNameUseSelectionOrder,
        activeLlmProvider,
        llmProviders,
        activeTranslationProvider,
        translationProviders,
        desktopRuntime,
        configPath,
        defaultConfigPath,
        isLibraryLoading,
        libraryDocumentCount: librarySnapshot.totalCount,
        libraryFileCount: librarySnapshot.fileCount,
        libraryQueuedJobCount: librarySnapshot.queuedJobCount,
        libraryDocuments: librarySnapshot.items,
        libraryDbFile: librarySnapshot.libraryDbFile,
        defaultManagedDirectory: librarySnapshot.defaultManagedDirectory,
        ragCacheDir: librarySnapshot.ragCacheDir,
        isSettingsSaving,
        isTestingRagConnection,
        isTestingLlmConnection,
        isTestingTranslationConnection,
        isLoadingTranslationModels,
      },
      actions: {
        onSystemNotificationsEnabledChange:
          settingsControllerInstance.setSystemNotificationsEnabled,
        onWarningNotificationsEnabledChange:
          settingsControllerInstance.setWarningNotificationsEnabled,
        onMenuBarIconEnabledChange:
          settingsControllerInstance.setMenuBarIconEnabled,
        onCompletionNotificationsEnabledChange:
          settingsControllerInstance.setCompletionNotificationsEnabled,
        onUseMicaChange: settingsControllerInstance.setUseMica,
        onStatusbarVisibleChange: settingsControllerInstance.setStatusbarVisible,
        onStartupLayoutChange: settingsControllerInstance.setStartupLayout,
        onBrowserTabKeepAliveLimitChange: (value) =>
          settingsControllerInstance.setBrowserTabKeepAliveLimit(
            normalizeBrowserTabKeepAliveLimit(value, browserTabKeepAliveLimit),
          ),
        onBrowserMaxHistoryEntriesChange: (value) =>
          settingsControllerInstance.setBrowserMaxHistoryEntries(
            Math.min(
              maxBrowserMaxHistoryEntries,
              Math.max(
                minBrowserMaxHistoryEntries,
                Number.parseInt(String(value), 10) || minBrowserMaxHistoryEntries,
              ),
            ),
          ),
        onBrowserPageZoomChange: settingsControllerInstance.setBrowserPageZoom,
        onBrowserSearchEngineChange: settingsControllerInstance.setBrowserSearchEngine,
        onThemeChange: settingsControllerInstance.setTheme,
        onEditorDraftFontFamilyChange:
          settingsControllerInstance.setEditorDraftFontFamily,
        onEditorDraftFontSizeChange:
          settingsControllerInstance.setEditorDraftFontSize,
        onEditorDraftLineHeightChange:
          settingsControllerInstance.setEditorDraftLineHeightFromInput,
        onEditorDraftParagraphSpacingBeforeChange:
          settingsControllerInstance.setEditorDraftParagraphSpacingBeforePtFromInput,
        onEditorDraftParagraphSpacingAfterChange:
          settingsControllerInstance.setEditorDraftParagraphSpacingAfterPtFromInput,
        onEditorDraftColorChange: settingsControllerInstance.setEditorDraftColor,
        onResetEditorDraftStyle:
          settingsControllerInstance.handleResetEditorDraftStyle,
        onKnowledgeBaseEnabledChange: settingsControllerInstance.setKnowledgeBaseEnabled,
        onAutoIndexDownloadedPdfChange:
          settingsControllerInstance.setAutoIndexDownloadedPdf,
        onKnowledgeBasePdfDownloadDirChange:
          settingsControllerInstance.setKnowledgeBasePdfDownloadDir,
        onChooseKnowledgeBasePdfDownloadDir:
          settingsControllerInstance.handleChooseKnowledgeBasePdfDownloadDir,
        onLibraryStorageModeChange:
          settingsControllerInstance.setLibraryStorageMode,
        onLibraryDirectoryChange: settingsControllerInstance.setLibraryDirectory,
        onMaxConcurrentIndexJobsChange: (value) =>
          settingsControllerInstance.setMaxConcurrentIndexJobs(
            Math.min(4, Math.max(1, Number.parseInt(String(value), 10) || 1)),
          ),
        onRagProviderApiKeyChange: settingsControllerInstance.setRagProviderApiKey,
        onRagProviderBaseUrlChange:
          settingsControllerInstance.setRagProviderBaseUrl,
        onRagProviderEmbeddingModelChange:
          settingsControllerInstance.setRagProviderEmbeddingModel,
        onRagProviderRerankerModelChange:
          settingsControllerInstance.setRagProviderRerankerModel,
        onRagProviderEmbeddingPathChange:
          settingsControllerInstance.setRagProviderEmbeddingPath,
        onRagProviderRerankPathChange:
          settingsControllerInstance.setRagProviderRerankPath,
        onRetrievalCandidateCountChange: (value) =>
          settingsControllerInstance.setRetrievalCandidateCount(
            Math.min(
              20,
              Math.max(3, Number.parseInt(String(value), 10) || 10),
            ),
          ),
        onRetrievalTopKChange: (value) =>
          settingsControllerInstance.setRetrievalTopK(
            Math.min(
              retrievalCandidateCount,
              Math.max(1, Number.parseInt(String(value), 10) || 4),
            ),
          ),
        onPdfDownloadDirChange: settingsControllerInstance.setPdfDownloadDir,
        onPdfFileNameUseSelectionOrderChange:
          settingsControllerInstance.setPdfFileNameUseSelectionOrder,
        onChooseLibraryDirectory: () =>
          void settingsControllerInstance.handleChooseLibraryDirectory(),
        onChoosePdfDownloadDir: () =>
          void settingsControllerInstance.handleChoosePdfDownloadDir(),
        onActiveLlmProviderChange: settingsControllerInstance.setActiveLlmProvider,
        onLlmProviderApiKeyChange: settingsControllerInstance.setLlmProviderApiKey,
        onLlmProviderModelChange: settingsControllerInstance.setLlmProviderModel,
        onLlmProviderSelectedModelOption:
          settingsControllerInstance.setLlmProviderSelectedModelOption,
        onLlmProviderReasoningEffortChange:
          settingsControllerInstance.setLlmProviderReasoningEffort,
        onLlmProviderModelEnabledChange:
          settingsControllerInstance.setLlmProviderModelEnabled,
        onLlmProviderUseMaxContextWindowChange:
          settingsControllerInstance.setLlmProviderUseMaxContextWindow,
        onActiveTranslationProviderChange:
          settingsControllerInstance.setActiveTranslationProvider,
        onTranslationProviderApiKeyChange:
          settingsControllerInstance.setTranslationProviderApiKey,
        onTranslationProviderBaseUrlChange:
          settingsControllerInstance.setTranslationProviderBaseUrl,
        onTranslationProviderModelChange:
          settingsControllerInstance.setTranslationProviderModel,
        onTestRagConnection: () =>
          void settingsControllerInstance.handleTestRagConnection(),
        onTestLlmConnection: () =>
          void settingsControllerInstance.handleTestLlmConnection(),
        onFetchTranslationModels: () =>
          void settingsControllerInstance.handleFetchTranslationModels(),
        onTestTranslationConnection: () =>
          void settingsControllerInstance.handleTestTranslationConnection(),
        onChooseConfigPath: () =>
          void settingsControllerInstance.handleChooseConfigPath(),
        onResetConfigPath: settingsControllerInstance.handleResetConfigPath,
        onResetKnowledgeBaseSettings:
          settingsControllerInstance.handleResetKnowledgeBaseSettings,
        onResetDownloadDir: settingsControllerInstance.handleResetDownloadDir,
      },
    });

    syncWorkbenchWindowTitle({
      appName: ui.appName,
      activeEditor,
      browserPageTitle,
    });

    this.renderWorkbenchContentPage({
      isPrimarySidebarVisible,
      isLayoutEdgeSnappingEnabled: isWindowFullscreen,
      primarySidebarSize,
      isEditorCollapsed,
      expandedEditorSize,
      sidebarProps,
      sessionChatProps,
      sidebarFooterActionsProps: createSidebarFooterTitlebarActionsProps({
        ui,
        isSettingsActive: this.settingsOverlayVisible,
        isAgentSidebarVisible,
        isEditorCollapsed,
        onApplyLayoutAgent: this.applyAgentLayout,
        onApplyLayoutFlow: this.applyFlowLayout,
        onOpenSettings: this.toggleSettingsPage,
      }),
      collapsedEditorTitlebarActionsElement:
        this.collapsedEditorTitlebarActionsView.getElement(),
      editorPartProps: {
        ...contentAwareEditorPartProps,
        isAgentSidebarVisible: false,
        showAgentSidebarToggle: false,
      },
    });
    this.renderSettingsOverlay({ settingsPartProps });

    this.titlebarPart.sync({
      electronRuntime,
      useMica,
      statusbarVisible: hasLoadedSettings && statusbarVisible,
      isEditorVisible: !isEditorCollapsed,
      leadingActions: titlebarLeadingActionsProps,
    });

    this.lifecycleService.setPhase(LifecyclePhase.Restored);

  }
}

export function disposeWorkbenchServices() {
  settingsController?.dispose();
  settingsController = null;

  libraryModel?.dispose();
  libraryModel = null;

  editorPartController?.dispose();
  editorPartController = null;

  articleSummaryTranslationExportController?.dispose();
  articleSummaryTranslationExportController = null;

  documentActionsController?.dispose();
  documentActionsController = null;

}

export function getWorkbenchSettingsController(
  instantiationService: IInstantiationService,
  context: SettingsControllerContext,
) {
  if (!settingsController) {
    settingsController = instantiationService.createInstance(
      SettingsController,
      context,
    );
    settingsController.start();
  }
  return settingsController;
}

export function getWorkbenchLibraryModel(context: LibraryModelContext) {
  if (!libraryModel) {
    libraryModel = createLibraryModel(context);
    libraryModel.start();
  }
  return libraryModel;
}

export function getWorkbenchEditorPartController(
  context: EditorPartControllerContext,
) {
  editorPartController ??= createEditorPartController(context);
  return editorPartController;
}

export function getWorkbenchArticleSummaryTranslationExportController(
  context: ArticleSummaryTranslationExportControllerContext,
  fetchService: IFetchService,
) {
  articleSummaryTranslationExportController ??=
    createArticleSummaryTranslationExportController(context, fetchService);
  return articleSummaryTranslationExportController;
}

export function getWorkbenchDocumentActionsController(
  context: DocumentActionsControllerContext,
  fetchService: IFetchService,
) {
  documentActionsController ??= createDocumentActionsController(context, fetchService);
  return documentActionsController;
}

export function syncWorkbenchServicesContext({
  settingsController: settingsControllerInstance,
  settingsContext,
  libraryModel: libraryModelInstance,
  libraryContext,
  editorPartController: editorPartControllerInstance,
  editorPartContext,
  chatService: chatServiceInstance,
  chatContext,
  articleSummaryTranslationExportController:
    articleSummaryTranslationExportControllerInstance,
  articleSummaryTranslationExportContext,
  documentActionsController: documentActionsControllerInstance,
  documentActionsContext,
}: WorkbenchServicesSyncParams) {
  settingsControllerInstance.setContext(settingsContext);
  libraryModelInstance.setContext(libraryContext);
  editorPartControllerInstance.setContext(editorPartContext);
  chatServiceInstance.setContext(chatContext);
  articleSummaryTranslationExportControllerInstance.setContext(
    articleSummaryTranslationExportContext,
  );
  documentActionsControllerInstance.setContext(documentActionsContext);
}

export function renderWorkbench() {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    throw new Error('Root element #root was not found.');
  }

  applyWorkbenchTheme();
  applyWorkbenchBrowserStyles();
  setARIAContainer(document.body);

  activeWorkbenchHost?.dispose();
  activeWorkbenchHost = null;

  activeWorkbenchHost = getWorkbenchInstantiationService().createInstance(
    WorkbenchHost,
    rootElement,
  );
  activeWorkbenchHost.start();
}
