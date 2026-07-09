/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
  ChatServiceContext,
  IChatService,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatService as IChatServiceDecorator } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { createBatchFetchController } from 'cs/workbench/contrib/fetch/browser/batchFetchModel';
import type { BatchFetchController, BatchFetchControllerContext } from 'cs/workbench/contrib/fetch/browser/batchFetchModel';
import { createDocumentActionsController } from 'cs/workbench/browser/documentActionsModel';
import type { DocumentActionsController, DocumentActionsControllerContext } from 'cs/workbench/browser/documentActionsModel';
import { createArticleSummaryTranslationExportController } from 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';
import type {
  ArticleSummaryTranslationExportController,
  ArticleSummaryTranslationExportControllerContext,
} from 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';
import { createLibraryModel } from 'cs/workbench/browser/libraryModel';
import type { LibraryModel, LibraryModelContext } from 'cs/workbench/browser/libraryModel';

import { WebContentNavigationModel } from 'cs/workbench/contrib/browserView/browser/browserNavigationModel';
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
import { createSettingsController } from 'cs/workbench/contrib/preferences/browser/settingsController';
import type { SettingsController, SettingsControllerContext } from 'cs/workbench/contrib/preferences/browser/settingsController';
import { createEditorPartController } from 'cs/workbench/browser/parts/editor/editorPart';
import type { EditorPartChangeReason, EditorPartControllerContext, EditorPartModel } from 'cs/workbench/browser/parts/editor/editorPart';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { createEditorTabInputId } from 'cs/workbench/browser/parts/editor/editorInput';

import type { EditorPartProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import { createEditorBrowserToolbarActions } from 'cs/workbench/browser/parts/editor/editorBrowserToolbarActions';
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
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IEditorResolverService } from 'cs/workbench/services/editor/common/editorResolverService';
import { NotificationsAlerts } from 'cs/workbench/browser/parts/notifications/notificationsAlerts';
import { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import { NotificationsStatus } from 'cs/workbench/browser/parts/notifications/notificationsStatus';
import { NotificationsToasts } from 'cs/workbench/browser/parts/notifications/notificationsToasts';
import { NotificationService } from 'cs/workbench/services/notification/common/notificationService';

import {
  localeService,
} from 'cs/workbench/services/localization/browser/localeService';
import {
  getWorkbenchSessionSnapshot,
  setWorkbenchArticles,
  setWorkbenchFetchSeedUrl,
  setWorkbenchSelectedArticleKeysInOrder,
  setWorkbenchWebUrl,
  subscribeWorkbenchSession,
} from 'cs/workbench/browser/session';
import { setWorkbenchEditorCommandHandlers } from 'cs/workbench/browser/editorCommands';
import { handleWorkbenchEditorShortcut } from 'cs/workbench/browser/workbenchEditorShortcuts';
import {
  getWindowStateSnapshot,
  subscribeWindowState,
} from 'cs/workbench/browser/window';
import {
  getWorkbenchContentStateSnapshot,
  selectWorkbenchContentDerivedState,
  setBatchEndDate,
  setBatchStartDate,
  subscribeWorkbenchContentState,
} from 'cs/workbench/browser/workbenchContentState';
import {
  shouldSyncActiveContentTabFromBrowserUrl,
  shouldSyncActiveContentTabMetadataFromWebContentState,
} from 'cs/workbench/contrib/browserView/browser/browserSurfaceState';
import type { WebContentSurfaceSnapshot } from 'cs/workbench/contrib/browserView/browser/browserSurfaceState';

import { getLocaleMessages } from 'language/i18n';
import type { Article } from 'cs/workbench/services/fetch/browser/articleFetch';
import { normalizeUrl } from 'cs/workbench/common/url';
import type { AppStartupLayout, LlmProviderId, LlmProviderSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { getConfigBatchSourceSeed, normalizeBatchLimit } from 'cs/workbench/services/config/configSchema';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import type { WebContentState } from 'cs/platform/browserView/common/browserView';
import { normalizeBrowserTabKeepAliveLimit } from 'cs/workbench/services/webContent/webContentRetentionConfig';
import {
  getLlmProviderDefinition,
  getLlmModelByIdForProvider,
  getLlmModelOptionsForProvider,
  hasLlmMaxContextWindow,
  parseLlmModelOptionValue,
} from 'cs/workbench/services/llm/registry';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';

import { isEditorContentTabInput } from 'cs/workbench/browser/parts/editor/editorInput';
import type { EditorWorkspaceTab } from 'cs/workbench/browser/parts/editor/editorModel';
import type { WritingEditorStableSelectionTarget } from 'cs/editor/common/writingEditorDocument';
import { editorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';
import { INativeHostService } from 'cs/platform/native/common/native';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IContextViewService } from 'cs/platform/contextview/browser/contextView';
import {
  IWorkbenchSidebarEntryService,
  type WorkbenchSidebarEntry,
} from 'cs/workbench/services/sidebar/common/sidebarEntryService';
import { applyWorkbenchTheme } from 'cs/workbench/services/themes/browser/workbenchThemeService';
import { applyWorkbenchBrowserStyles } from 'cs/workbench/browser/style';

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
  batchFetchController: BatchFetchController;
  batchFetchContext: BatchFetchControllerContext;
};

type DesktopInvokeArgs = Record<string, unknown> | undefined;

let settingsController: SettingsController | null = null;
let libraryModel: LibraryModel | null = null;
let webContentNavigationModel: WebContentNavigationModel | null = null;
let editorPartController: EditorPartModel | null = null;
let articleSummaryTranslationExportController: ArticleSummaryTranslationExportController | null = null;
let documentActionsController: DocumentActionsController | null = null;
let batchFetchController: BatchFetchController | null = null;
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
function getArticleSelectionKey(article: Pick<Article, 'sourceUrl' | 'fetchedAt'>) {
  return `${article.sourceUrl}::${article.fetchedAt}`;
}

function buildSelectedArticleOrderLookup(
  selectedArticleKeysInOrder: readonly string[],
) {
  return new Map(
    selectedArticleKeysInOrder.map((key, index) => [key, index + 1]),
  );
}

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

function getBatchSourceDisplayLabel(source: Pick<BatchSource, 'journalTitle' | 'url'>) {
  const journalTitle = source.journalTitle.trim();
  return journalTitle || source.url;
}

function isContentTab(tab: EditorWorkspaceTab) {
  return isEditorContentTabInput(tab);
}

function toContentTabIdSet(tabs: ReadonlyArray<EditorWorkspaceTab>) {
  return new Set(tabs.filter(isContentTab).map((tab) => tab.id));
}

function areStringArraysEqual(
  previous: readonly string[],
  next: readonly string[],
) {
  return (
    previous.length === next.length &&
    previous.every((value, index) => value === next[index])
  );
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
  private retiredWorkbenchContentPartViews:
    | SessionWorkbenchContentPartViews
    | null = null;
  private readonly editorTitlebarActionsView = createEditorTitlebarActionsView({
    isEditorCollapsed: true,
    isAgentSidebarVisible: false,
    showAgentSidebarToggle: false,
    agentSidebarToggleLabel: '',
    labels: {
      expandEditor: '',
      collapseEditor: '',
    },
    onToggleEditorCollapse: () => {},
  });
  private readonly sidebarFooterActionsView = new SidebarFooterActionsView();
  private settingsView: ReturnType<typeof createSettingsPartView> | null = null;
  private editorPartController: EditorPartModel | null = null;
  private readonly globalDisposables: Array<() => void> = [];
  private webContentStateDisposable: (() => void) | null = null;
  private servicesSubscribed = false;
  private isDisposed = false;
  private isRendering = false;
  private renderPending = false;
  private webContentRuntime = false;
  private settingsOverlayVisible = false;
  private readonly sidebarEntryConversationIds: Record<
    WorkbenchSidebarEntry,
    string | null
  > = {
    home: null,
    code: null,
  };
  private previousBrowserUrl = '';
  private previousActiveContentTabId: string | null = null;
  private previousContentTargetId: string | null = null;
  private previousContentTargetUrl = '';
  private previousContentTabIds = new Set<string>();
  private readonly pendingContentTargetReleaseModes = new Map<
    string,
    'soft' | 'dispose'
  >();
  private appliedKnowledgeBaseModeEnabled: boolean | null = null;
  private hasAppliedStartupLayoutPreference = false;
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
    @IChatServiceDecorator private readonly chatService: IChatService,
    @IWorkbenchSidebarEntryService private readonly sidebarEntryService: IWorkbenchSidebarEntryService,
    @IEditorResolverService private readonly editorResolverService: IEditorResolverService,
    @IInstantiationService private readonly instantiationService: IInstantiationService,
  ) {
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
      subscribeWorkbenchSession(this.requestRender),
      subscribeWorkbenchLayoutState(this.requestRender),
      subscribeWindowState(this.requestRender),
      subscribeWorkbenchContentState(this.requestRender),
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
    this.webContentStateDisposable?.();
    this.webContentStateDisposable = null;
    window.removeEventListener('keydown', this.handleWindowKeydown);
    while (this.globalDisposables.length > 0) {
      this.globalDisposables.pop()?.();
    }

    setWorkbenchEditorCommandHandlers(null);
    this.titlebarPart.dispose();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, null);

    this.workbenchLayoutView?.dispose();
    this.workbenchLayoutView = null;
    this.workbenchContentPartViews?.dispose();
    this.workbenchContentPartViews = null;
    this.retiredWorkbenchContentPartViews = null;
    this.editorTitlebarActionsView.dispose();
    this.sidebarFooterActionsView.dispose();
    this.settingsView?.dispose();
    this.settingsView = null;
    this.editorPartController = null;
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

  private releaseContentTarget(
    webContentNavigationModel: WebContentNavigationModel,
    targetId: string | null,
    mode: 'soft' | 'dispose' = 'soft',
  ) {
    if (!targetId) {
      return;
    }

    const pendingMode = this.pendingContentTargetReleaseModes.get(targetId);
    if (pendingMode) {
      if (pendingMode === 'soft' && mode === 'dispose') {
        this.pendingContentTargetReleaseModes.set(targetId, 'dispose');
      }
      return;
    }

    this.pendingContentTargetReleaseModes.set(targetId, mode);
    const pendingViewStateSave =
      (
        this.workbenchContentPartViews ?? this.retiredWorkbenchContentPartViews
      )?.whenEditorTabViewStateSettled(targetId) ?? Promise.resolve();

    void pendingViewStateSave.finally(() => {
      const resolvedMode = this.pendingContentTargetReleaseModes.get(targetId) ?? mode;
      this.pendingContentTargetReleaseModes.delete(targetId);
      if (this.previousActiveContentTabId === targetId) {
        return;
      }

      if (resolvedMode === 'dispose') {
        webContentNavigationModel.disposeTarget(targetId);
        return;
      }

      webContentNavigationModel.releaseTarget(targetId);
    });
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

  private ensureServiceSubscriptions(services: {
    settingsController: SettingsController;
    libraryModel: LibraryModel;
    webContentNavigationModel: WebContentNavigationModel;
    editorPartController: EditorPartModel;
    chatService: IChatService;
    articleSummaryTranslationExportController: ArticleSummaryTranslationExportController;
    documentActionsController: DocumentActionsController;
    batchFetchController: BatchFetchController;
  }) {
    if (this.servicesSubscribed) {
      return;
    }

    this.servicesSubscribed = true;
    this.globalDisposables.push(
      services.settingsController.subscribe(this.requestRender),
      services.libraryModel.subscribe(this.requestRender),
      services.webContentNavigationModel.subscribe(this.requestRender),
      services.editorPartController.subscribe(this.handleEditorPartChange),
      services.chatService.subscribe(this.requestRender),
      services.articleSummaryTranslationExportController.subscribe(this.requestRender),
      services.documentActionsController.subscribe(this.requestRender),
      services.batchFetchController.subscribe(this.requestRender),
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

  private syncWebContentRuntime(
    webContentNavigationModelInstance: WebContentNavigationModel,
    webContentRuntime: boolean,
  ) {
    if (this.webContentStateDisposable && this.webContentRuntime === webContentRuntime) {
      return;
    }

    this.webContentStateDisposable?.();
    this.webContentRuntime = webContentRuntime;
    this.webContentStateDisposable = webContentNavigationModelInstance.connectWebContentState({
      webContentRuntime,
      setWebUrl: setWorkbenchWebUrl,
      setFetchSeedUrl: setWorkbenchFetchSeedUrl,
    });
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

  private syncSelectionState(
    filteredArticleKeysInOrder: string[],
    selectionModePhase: ReturnType<
      typeof getWorkbenchSessionSnapshot
    >['selectionModePhase'],
  ) {
    setWorkbenchSelectedArticleKeysInOrder((previousKeys) => {
      if (selectionModePhase === 'all') {
        if (
          previousKeys.length === filteredArticleKeysInOrder.length &&
          previousKeys.every(
            (key, index) => key === filteredArticleKeysInOrder[index],
          )
        ) {
          return previousKeys;
        }

        return filteredArticleKeysInOrder;
      }

      if (previousKeys.length === 0) {
        return previousKeys;
      }

      const visibleKeys = new Set(filteredArticleKeysInOrder);
      const nextKeys = previousKeys.filter((key) => visibleKeys.has(key));

      return nextKeys.length === previousKeys.length ? previousKeys : nextKeys;
    });
  }

  private syncWebContentSurfaceState(params: {
    browserUrl: string;
    browserPageTitle: string;
    browserFaviconUrl: string;
    webContentState: WebContentState;
    tabs: EditorWorkspaceTab[];
    webContentNavigationModel: WebContentNavigationModel;
    webContentSurfaceSnapshot: WebContentSurfaceSnapshot;
    navigateToAddressBarUrl: (nextUrl: string, showToast?: boolean) => boolean;
    updateActiveContentTabUrl: (
      url: string,
      options?: {
        isLoading?: boolean;
      },
    ) => void;
    updateActiveBrowserTabPageTitle: (pageTitle: string) => void;
    updateActiveBrowserTabFaviconUrl: (faviconUrl: string) => void;
  }) {
    const {
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      webContentState,
      tabs,
      webContentNavigationModel,
      webContentSurfaceSnapshot,
      navigateToAddressBarUrl,
      updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl,
    } = params;
    const activeContentTabId = webContentSurfaceSnapshot.activeContentTabId;

    const syncContentTarget = (targetId: string | null, targetUrl: string) => {
      void webContentNavigationModel
        .activateTarget(targetId, {
          setWebUrl: setWorkbenchWebUrl,
          setFetchSeedUrl: setWorkbenchFetchSeedUrl,
        })
        .then((state) => {
          if (
            !targetId ||
            !state ||
            state.ownership !== 'active' ||
            state.activeTargetId !== targetId ||
            state.url ||
            !targetUrl
          ) {
            return;
          }

          navigateToAddressBarUrl(targetUrl, false);
        });
    };

    if (
      this.previousContentTargetId !== activeContentTabId ||
      this.previousContentTargetUrl !== webContentSurfaceSnapshot.activeContentTabUrl
    ) {
      syncContentTarget(
        activeContentTabId,
        webContentSurfaceSnapshot.activeContentTabUrl,
      );
      this.previousContentTargetId = activeContentTabId;
      this.previousContentTargetUrl = webContentSurfaceSnapshot.activeContentTabUrl;
    }

    if (
      this.previousActiveContentTabId &&
      this.previousActiveContentTabId !== activeContentTabId
    ) {
      this.releaseContentTarget(
        webContentNavigationModel,
        this.previousActiveContentTabId,
        'soft',
      );
    }

    const nextContentTabIds = toContentTabIdSet(tabs);
    for (const previousTabId of this.previousContentTabIds) {
      if (!nextContentTabIds.has(previousTabId)) {
        this.releaseContentTarget(
          webContentNavigationModel,
          previousTabId,
          'dispose',
        );
      }
    }
    this.previousContentTabIds = nextContentTabIds;

    if (
      shouldSyncActiveContentTabFromBrowserUrl(
        webContentSurfaceSnapshot,
        browserUrl,
        this.previousBrowserUrl,
        this.previousActiveContentTabId,
      )
    ) {
      updateActiveContentTabUrl(browserUrl, {
        isLoading: webContentState.isLoading,
      });
    }

    if (
      shouldSyncActiveContentTabMetadataFromWebContentState(
        webContentSurfaceSnapshot,
        webContentState,
      )
    ) {
      updateActiveBrowserTabPageTitle(browserPageTitle);
      updateActiveBrowserTabFaviconUrl(browserFaviconUrl);
    }

    this.previousBrowserUrl = browserUrl;
    this.previousActiveContentTabId = activeContentTabId;
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
        this.editorPartController?.saveActiveDraft() ?? false,
      canSaveActiveDraft: () =>
        this.editorPartController?.canSaveActiveDraft() ?? false,
      openEditor: request =>
        this.editorPartController?.openEditor(request),
      activateTab: tabId =>
        this.editorPartController?.onActivateTab(tabId),
      closeTab: tabId =>
        this.editorPartController?.onCloseTab(tabId) ?? false,
      getTabs: () =>
        this.editorPartController?.getSnapshot().tabs ?? [],
    });
  }

  private syncPostRenderState(params: {
    selectionModePhase: ReturnType<
      typeof getWorkbenchSessionSnapshot
    >['selectionModePhase'];
    selectedArticleKeysInOrder: readonly string[];
    filteredArticleKeysInOrder: string[];
    browserUrl: string;
    browserPageTitle: string;
    browserFaviconUrl: string;
    webContentState: WebContentState;
    editorTabs: EditorWorkspaceTab[];
    webContentNavigationModel: WebContentNavigationModel;
    webContentSurfaceSnapshot: WebContentSurfaceSnapshot;
    navigateToAddressBarUrl: (nextUrl: string, showToast?: boolean) => boolean;
    updateActiveContentTabUrl: (
      url: string,
      options?: {
        isLoading?: boolean;
      },
    ) => void;
    updateActiveBrowserTabPageTitle: (pageTitle: string) => void;
    updateActiveBrowserTabFaviconUrl: (faviconUrl: string) => void;
  }) {
    const {
      selectionModePhase,
      selectedArticleKeysInOrder,
      filteredArticleKeysInOrder,
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      webContentState,
      editorTabs,
      webContentNavigationModel,
      webContentSurfaceSnapshot,
      navigateToAddressBarUrl,
      updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl,
    } = params;

    const needsSelectionSync =
      selectionModePhase === 'all'
        ? !areStringArraysEqual(
            selectedArticleKeysInOrder,
            filteredArticleKeysInOrder,
          )
        : selectedArticleKeysInOrder.length > 0 &&
          selectedArticleKeysInOrder.some(
            (key) => !filteredArticleKeysInOrder.includes(key),
          );
    if (needsSelectionSync) {
      this.syncSelectionState(filteredArticleKeysInOrder, selectionModePhase);
    }

    this.syncWebContentSurfaceState({
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      webContentState,
      tabs: editorTabs,
      webContentNavigationModel,
      webContentSurfaceSnapshot,
      navigateToAddressBarUrl,
      updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl,
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
    editorTitlebarActionsElement?: HTMLElement | null;
    editorPartProps: EditorPartProps;
  }) {
    this.retiredWorkbenchContentPartViews = null;
    this.sidebarFooterActionsView.setProps(
      props.sidebarFooterActionsProps,
    );

    //#region Column titlebar handoff

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
        props.editorTitlebarActionsElement,
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
      webUrl,
      fetchSeedUrl,
      articles,
      selectionModePhase,
      selectedArticleKeysInOrder,
    } = getWorkbenchSessionSnapshot();
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

    const settingsControllerInstance = getWorkbenchSettingsController({
      desktopRuntime,
      invokeDesktop,
      notificationService: this.notificationService,
      ui,
      locale,
    });
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
      batchLimit,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
      startupLayout,
      browserTabKeepAliveLimit,
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
      journalSourceOverrides,
    } = settingsSnapshot;
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

    const workbenchContentStateSnapshot = getWorkbenchContentStateSnapshot();
    const {
      batchStartDate,
      batchEndDate,
      filteredArticles,
    } = {
      batchStartDate: workbenchContentStateSnapshot.batchStartDate,
      batchEndDate: workbenchContentStateSnapshot.batchEndDate,
      ...selectWorkbenchContentDerivedState(workbenchContentStateSnapshot, articles),
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

    const webContentNavigationModelInstance = getWorkbenchWebContentNavigationModel(
      nativeHost,
      this.notificationService,
    );
    this.syncWebContentRuntime(webContentNavigationModelInstance, webContentRuntime);
    const { browserUrl, webContentState } =
      webContentNavigationModelInstance.getSnapshot();
    const { pageTitle: browserPageTitle = '', faviconUrl: browserFaviconUrl = '' } =
      webContentState;
    const viewPartProps = {
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      browserIsLoading: webContentState.isLoading,
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
      editorResolverService: this.editorResolverService,
      browserUrl,
      webUrl,
    });
    this.editorPartController = editorPartControllerInstance;
    const editorPartSnapshot = editorPartControllerInstance.getSnapshot();
    const {
      tabs: editorTabs,
      activeTab: activeEditorTab,
      draftBody,
      webContentSurfaceSnapshot,
      updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl,
      editorPartProps,
    } = {
      ...editorPartSnapshot,
      updateActiveContentTabUrl:
        editorPartControllerInstance.updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle:
        editorPartControllerInstance.updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl:
        editorPartControllerInstance.updateActiveBrowserTabFaviconUrl,
    };

    const chatServiceInstance = this.chatService;
    chatServiceInstance.setContext({
      desktopRuntime,
      invokeDesktop,
      ui,
      isKnowledgeBaseModeEnabled: knowledgeBaseModeEnabled,
      articles: filteredArticles,
      llmSettings: currentLlmSettings,
      ragSettings: currentRagSettings,
      fallbackWritingContext: draftBody,
      getFallbackWritingContext: editorPartControllerInstance.getDraftBody,
      getDraftDocument: editorPartControllerInstance.getDraftDocument,
      setDraftDocument: editorPartControllerInstance.setDraftDocument,
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

    const filteredArticleKeysInOrder = filteredArticles.map((article) =>
      getArticleSelectionKey(article),
    );

    const selectedArticleOrderLookup = buildSelectedArticleOrderLookup(
      selectedArticleKeysInOrder,
    );
    const filteredArticleMap = new Map(
      filteredArticles.map(
        (article) => [getArticleSelectionKey(article), article] as const,
      ),
    );
    const exportableArticles =
      selectedArticleKeysInOrder.length === 0
        ? []
        : selectedArticleKeysInOrder
            .map((key) => filteredArticleMap.get(key))
            .filter((article): article is Article => Boolean(article));
    const activeDraftExport =
      activeEditorTab?.kind === 'draft'
        ? {
            title: activeEditorTab.title,
            document: activeEditorTab.document,
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

    const navigateToAddressBarUrl = (
      nextUrl: string,
      showToast: boolean = true,
    ) =>
      webContentNavigationModelInstance.navigateToAddressBarUrl({
        nextUrl,
        showToast,
        electronRuntime,
        webContentRuntime,
        ui,
        setWebUrl: setWorkbenchWebUrl,
        setFetchSeedUrl: setWorkbenchFetchSeedUrl,
      });
    this.openerService.setDefaultExternalOpener({
      openExternal: async (href, { sourceUri }) => {
        if (sourceUri.scheme !== Schemas.http && sourceUri.scheme !== Schemas.https) {
          return false;
        }

        const browserLinkUrl = normalizeUrl(href);
        if (!browserLinkUrl) {
          return false;
        }

        if (isEditorCollapsed) {
          setEditorCollapsed(false, expandedEditorSize);
        }
        editorPartControllerInstance.openEditor({
          kind: 'browser',
          disposition: 'new-tab',
          resource: BrowserViewUri.forId(createEditorTabInputId('browser')),
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
      getWorkbenchArticleSummaryTranslationExportController({
      desktopRuntime,
      invokeDesktop,
      nativeHost,
      notificationService: this.notificationService,
      dialogService: this.dialogService,
      locale,
      ui,
      pdfDownloadDir,
      });

    const documentActionsControllerInstance =
      getWorkbenchDocumentActionsController({
        desktopRuntime,
        invokeDesktop,
        notificationService: this.notificationService,
        locale,
        ui,
        knowledgeBaseEnabled,
        pdfDownloadDir,
        knowledgeBasePdfDownloadDir,
        pdfFileNameUseSelectionOrder,
        isSelectionModeEnabled: selectionModePhase !== 'off',
        selectedArticleOrderLookup,
        exportableArticles,
        onOpenEditor: editorPartControllerInstance.openEditor,
        onExportArticleSummaries:
          articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries,
        activeDraftExport,
        onLibraryDocumentUpserted:
          libraryModelInstance.upsertDocumentSummary,
        onLibraryUpdated: refreshLibrary,
      });

    const baseEditorPartProps = editorPartProps;
    const focusWorkbenchWebUrlInput = () => {
      editorPartControllerInstance.openEditor({
        kind: 'browser',
        disposition: 'reveal-or-open',
      });
      this.workbenchContentPartViews?.focusActiveEditorPrimaryInput();
    };
    const editorBrowserToolbarActions = createEditorBrowserToolbarActions({
      browserUrl,
      browserPageTitle,
      electronRuntime,
      webContentRuntime,
      invokeDesktop,
      notificationService: this.notificationService,
      knowledgeBaseEnabled,
      setWebUrl: setWorkbenchWebUrl,
      ui,
      webContentNavigationModel: webContentNavigationModelInstance,
      onArchiveArticle: (article) => {
        setWorkbenchArticles((currentArticles) => [article, ...currentArticles]);
      },
      onLibraryDocumentUpserted:
        libraryModelInstance.upsertDocumentSummary,
      onLibraryUpdated: refreshLibrary,
      onOpenAddressBarSourceMenu: focusWorkbenchWebUrlInput,
      onToolbarExportDocx: () => {
        void documentActionsControllerInstance.handleExportDocx();
      },
      onToolbarAddressSubmit: () => {
        const { webUrl: latestWebUrl } = getWorkbenchSessionSnapshot();
        navigateToAddressBarUrl(latestWebUrl, true);
      },
      onToolbarNavigateToUrl: (url) => {
        navigateToAddressBarUrl(url, true);
      },
    });
    const contentAwareEditorPartProps: EditorPartProps = {
      ...baseEditorPartProps,
      nativeHost,
      ...editorBrowserToolbarActions,
      onToggleEditorCollapse: this.toggleEditorCollapsed,
    };
    this.editorTitlebarActionsView.setProps({
      isEditorCollapsed: true,
      isAgentSidebarVisible: false,
      showAgentSidebarToggle: false,
      labels: {
        expandEditor: contentAwareEditorPartProps.labels.expandEditor,
        collapseEditor: contentAwareEditorPartProps.labels.collapseEditor,
      },
      onToggleEditorCollapse: this.toggleEditorCollapsed,
    });

    const handleBatchFetchStart = () => {};

    const handleBatchFetchSuccess = (nextArticles: Article[]) => {
      setWorkbenchArticles(nextArticles);
    };

    const batchFetchControllerInstance = getWorkbenchBatchFetchController({
      desktopRuntime,
      addressBarUrl: fetchSeedUrl || webUrl,
      journalSourceOverrides,
      batchStartDate,
      batchEndDate,
      invokeDesktop,
      nativeHost,
      notificationService: this.notificationService,
      ui,
      onBeforeFetch: handleBatchFetchStart,
      onFetchSuccess: handleBatchFetchSuccess,
    });
    const { isBatchLoading } = batchFetchControllerInstance.getSnapshot();
    const chatArticleBatch = chatServiceInstance.collectArticleBatch(filteredArticles);
    const selectedChatArticleBatch =
      chatServiceInstance.collectSelectedArticleBatch(filteredArticles);
    const articleQuickSources = getConfigBatchSourceSeed();
    const handleFetchArticleSource = async (source: BatchSource) => {
      if (isEditorCollapsed) {
        setEditorCollapsed(false, expandedEditorSize);
      }
      editorPartControllerInstance.openEditor({
        kind: 'browser',
        disposition: 'reveal-or-open',
      });
      navigateToAddressBarUrl(source.url, false);

      const result = await batchFetchControllerInstance.handleFetchSource(source);
      if (!result.ok) {
        if ('reason' in result && result.reason === 'empty') {
          chatServiceInstance.insertArticleFetchEmptyResult(
            getBatchSourceDisplayLabel(source),
            result.message,
          );
        }
        return;
      }

      chatServiceInstance.insertArticles(
        result.articles,
        getBatchSourceDisplayLabel(source),
      );
    };

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
        editorResolverService: this.editorResolverService,
        browserUrl,
        webUrl,
      },
      chatService: chatServiceInstance,
      chatContext: {
        desktopRuntime,
        invokeDesktop,
        ui,
        isKnowledgeBaseModeEnabled: knowledgeBaseModeEnabled,
        articles: filteredArticles,
        llmSettings: currentLlmSettings,
        ragSettings: currentRagSettings,
        fallbackWritingContext: assistantWritingContext,
        getFallbackWritingContext: () =>
          formatStableSelectionWritingContext(
            this.workbenchContentPartViews?.getActiveDraftStableSelectionTarget() ?? null,
            editorPartControllerInstance.getDraftBody(),
          ),
        getDraftBody: () => editorPartControllerInstance.getDraftBody(),
        getDraftDocument: () => editorPartControllerInstance.getDraftDocument(),
        setDraftDocument: (value) =>
          editorPartControllerInstance.setDraftDocument(value),
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
        isSelectionModeEnabled: selectionModePhase !== 'off',
        selectedArticleOrderLookup,
        exportableArticles,
        onOpenEditor: editorPartControllerInstance.openEditor,
        onExportArticleSummaries:
          articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries,
        activeDraftExport,
        onLibraryUpdated: refreshLibrary,
      },
      batchFetchController: batchFetchControllerInstance,
      batchFetchContext: {
        desktopRuntime,
        addressBarUrl: fetchSeedUrl || webUrl,
        journalSourceOverrides,
        batchStartDate,
        batchEndDate,
        invokeDesktop,
        nativeHost,
        notificationService: this.notificationService,
        ui,
        onBeforeFetch: handleBatchFetchStart,
        onFetchSuccess: handleBatchFetchSuccess,
      },
    });

    this.ensureServiceSubscriptions({
      settingsController: settingsControllerInstance,
      libraryModel: libraryModelInstance,
      webContentNavigationModel: webContentNavigationModelInstance,
      editorPartController: editorPartControllerInstance,
      chatService: chatServiceInstance,
      articleSummaryTranslationExportController:
        articleSummaryTranslationExportControllerInstance,
      documentActionsController: documentActionsControllerInstance,
      batchFetchController: batchFetchControllerInstance,
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
        availableArticleCount: filteredArticles.length,
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
        articleQuickSources,
        isArticleSourceFetching: isBatchLoading,
        showArticleBatchActions:
          chatArticleBatch.length > 0 &&
          (!isBatchLoading ||
            Boolean(documentActionsSnapshot.downloadAllProgress) ||
            Boolean(articleSummaryTranslationExportSnapshot.translationExportProgress)),
        downloadAllProgress: documentActionsSnapshot.downloadAllProgress,
        translationExportProgress:
          articleSummaryTranslationExportSnapshot.translationExportProgress,
        isArticleSelected: chatServiceInstance.isArticleSelected,
      },
      actions: {
        onQuestionChange: setAssistantQuestion,
        onAsk: () => void handleAssistantAsk(),
        onApplyPatch: handleAssistantApplyPatch,
        onFetchArticleSource: (source) => void handleFetchArticleSource(source),
        onDownloadAllArticles: () =>
          documentActionsControllerInstance.handleDownloadAllArticles(selectedChatArticleBatch),
        onExportArticleSummaries: (translateSummaries) =>
          articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries(
            selectedChatArticleBatch,
            translateSummaries,
          ),
        onToggleArticleSelected: chatServiceInstance.toggleArticleSelected,
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
        batchLimit,
        supportedSources: getConfigBatchSourceSeed(),
        journalSourceOverrides,
        fetchStartDate: batchStartDate,
        fetchEndDate: batchEndDate,
        systemNotificationsEnabled,
        warningNotificationsEnabled,
        menuBarIconEnabled,
        completionNotificationsEnabled,
        useMica,
        statusbarVisible,
        startupLayout,
        browserTabKeepAliveLimit,
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
        onBatchLimitChange: (value) =>
          settingsControllerInstance.setBatchLimit(normalizeBatchLimit(value, 1)),
        onJournalSourceTitleChange:
          settingsControllerInstance.setJournalSourceTitle,
        onFetchStartDateChange: setBatchStartDate,
        onFetchEndDateChange: setBatchEndDate,
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
      activeEditorTab,
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
      editorTitlebarActionsElement:
        this.editorTitlebarActionsView.getElement(),
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
      statusbarVisible,
      leadingActions: titlebarLeadingActionsProps,
    });

    this.syncPostRenderState({
      selectionModePhase,
      selectedArticleKeysInOrder,
      filteredArticleKeysInOrder,
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      webContentState,
      editorTabs,
      webContentNavigationModel: webContentNavigationModelInstance,
      webContentSurfaceSnapshot,
      navigateToAddressBarUrl,
      updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl,
    });

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

  batchFetchController?.dispose();
  batchFetchController = null;

  webContentNavigationModel = null;
}

export function getWorkbenchSettingsController(
  context: SettingsControllerContext,
) {
  if (!settingsController) {
    settingsController = createSettingsController(context);
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

export function getWorkbenchWebContentNavigationModel(
  nativeHost: INativeHostService,
  notificationService: INotificationService,
) {
  webContentNavigationModel ??= new WebContentNavigationModel(
    nativeHost,
    notificationService,
  );
  return webContentNavigationModel;
}

export function getWorkbenchEditorPartController(
  context: EditorPartControllerContext,
) {
  editorPartController ??= createEditorPartController(context);
  return editorPartController;
}

export function getWorkbenchArticleSummaryTranslationExportController(
  context: ArticleSummaryTranslationExportControllerContext,
) {
  articleSummaryTranslationExportController ??=
    createArticleSummaryTranslationExportController(context);
  return articleSummaryTranslationExportController;
}

export function getWorkbenchDocumentActionsController(
  context: DocumentActionsControllerContext,
) {
  documentActionsController ??= createDocumentActionsController(context);
  return documentActionsController;
}

export function getWorkbenchBatchFetchController(
  context: BatchFetchControllerContext,
) {
  if (!batchFetchController) {
    batchFetchController = createBatchFetchController(context);
    batchFetchController.start();
  }
  return batchFetchController;
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
  batchFetchController: batchFetchControllerInstance,
  batchFetchContext,
}: WorkbenchServicesSyncParams) {
  settingsControllerInstance.setContext(settingsContext);
  libraryModelInstance.setContext(libraryContext);
  editorPartControllerInstance.setContext(editorPartContext);
  chatServiceInstance.setContext(chatContext);
  articleSummaryTranslationExportControllerInstance.setContext(
    articleSummaryTranslationExportContext,
  );
  documentActionsControllerInstance.setContext(documentActionsContext);
  batchFetchControllerInstance.setContext(batchFetchContext);
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
