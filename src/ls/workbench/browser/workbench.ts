import { createAssistantModel } from 'ls/workbench/browser/assistantModel';
import type { AssistantModel, AssistantModelContext } from 'ls/workbench/browser/assistantModel';
import { createBatchFetchController } from 'ls/workbench/browser/batchFetchModel';
import type { BatchFetchController, BatchFetchControllerContext } from 'ls/workbench/browser/batchFetchModel';
import { createDocumentActionsController } from 'ls/workbench/browser/documentActionsModel';
import type { DocumentActionsController, DocumentActionsControllerContext } from 'ls/workbench/browser/documentActionsModel';
import { createLibraryModel } from 'ls/workbench/browser/libraryModel';
import type { LibraryModel, LibraryModelContext } from 'ls/workbench/browser/libraryModel';

import { setWorkbenchBrowserTabKeepAliveLimit } from 'ls/workbench/browser/webContentRetentionState';
import { WebContentNavigationModel } from 'ls/workbench/browser/webContentNavigationModel';
import {
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchContentClassName,
  getWorkbenchShellClassName,
  registerWorkbenchPartDomNode,
  WorkbenchContentLayoutController,
  WorkbenchLayoutSlotView,
  setAgentSidebarVisible,
  setEditorCollapsed,
  setWorkbenchSidebarSizes,
  setPrimarySidebarVisible,
  subscribeWorkbenchLayoutState,
  toggleAgentSidebarVisibility,
  toggleEditorCollapsed,
  togglePrimarySidebarVisibility,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import { createSettingsController } from 'ls/workbench/contrib/preferences/browser/settingsController';
import type { SettingsController, SettingsControllerContext } from 'ls/workbench/contrib/preferences/browser/settingsController';
import { createEditorPartController } from 'ls/workbench/browser/parts/editor/editorPart';
import type { EditorPartChangeReason, EditorPartControllerContext, EditorPartModel } from 'ls/workbench/browser/parts/editor/editorPart';

import type { EditorPartProps } from 'ls/workbench/browser/parts/editor/editorPartView';
import { createEditorBrowserToolbarActions } from 'ls/workbench/browser/parts/editor/editorBrowserToolbarActions';
import { PrimaryBarFooterActionsView } from 'ls/workbench/browser/parts/primarybar/primarybarFooterActions';
import type { PrimaryBarFooterLayoutMode } from 'ls/workbench/browser/parts/primarybar/primarybarFooterActions';
import { SidebarTopbarActionsView } from 'ls/workbench/browser/parts/sidebar/sidebarTopbarActions';
import {
  createSettingsPartView,
  createSettingsPartProps,
  createSettingsTopbarActionsView,
} from 'ls/workbench/contrib/preferences/browser/settingsEditor';
import { createAgentBarPartProps } from 'ls/workbench/browser/parts/agentbar/agentbarPart';
import type { AgentBarPartProps } from 'ls/workbench/browser/parts/agentbar/agentbarPart';

import type { PrimaryBarProps } from 'ls/workbench/browser/parts/primarybar/primarybarPart';
import { createFetchPaneProps } from 'ls/workbench/browser/parts/sidebar/fetchPanePart';

import { createToastOverlayWindowView } from 'ls/workbench/browser/toastOverlayWindow';
import { createArticleDetailsModalWindowView } from 'ls/workbench/browser/articleDetailsModalWindow';
import { createWorkbenchContentPartViews } from 'ls/workbench/browser/workbenchContentPartViews';
import { showWorkbenchTextInputModal } from 'ls/workbench/browser/workbenchEditorModals';
import { createEditorTopbarActionsView } from 'ls/workbench/browser/parts/editor/editorTopbarActionsView';
import type { LxIconName } from 'ls/base/browser/ui/lxicon/lxicon';
import { setARIAContainer } from 'ls/base/browser/ui/aria/aria';
import { createToastHost } from 'ls/base/browser/ui/toast/toastHost';
import type { ToastHost } from 'ls/base/browser/ui/toast/toastHost';

import {
  localeService,
} from 'ls/workbench/contrib/localization/browser/localeService';
import {
  getWorkbenchSessionSnapshot,
  setWorkbenchArticles,
  setWorkbenchFetchSeedUrl,
  setWorkbenchSelectedArticleKeysInOrder,
  setWorkbenchSelectionModePhase,
  setWorkbenchWebUrl,
  subscribeWorkbenchSession,
} from 'ls/workbench/browser/session';
import { setWorkbenchEditorCommandHandlers } from 'ls/workbench/browser/editorCommands';
import { handleWorkbenchEditorShortcut } from 'ls/workbench/browser/workbenchEditorShortcuts';
import {
  getWindowStateSnapshot,
  subscribeWindowState,
} from 'ls/workbench/browser/window';
import {
  getWorkbenchContentStateSnapshot,
  selectWorkbenchContentDerivedState,
  setBatchEndDate,
  setBatchStartDate,
  subscribeWorkbenchContentState,
} from 'ls/workbench/browser/workbenchContentState';
import {
  resolveContentSourceUrl,
  shouldSyncActiveContentTabFromBrowserUrl,
  shouldSyncActiveContentTabMetadataFromWebContentState,
} from 'ls/workbench/browser/webContentSurfaceState';
import type { WebContentSurfaceSnapshot } from 'ls/workbench/browser/webContentSurfaceState';

import { getLocaleMessages } from 'language/i18n';
import type { Article } from 'ls/workbench/services/article/articleFetch';
import { normalizeUrl } from 'ls/workbench/common/url';
import type { LibraryDocumentSummary, LlmProviderId, LlmProviderSettings } from 'ls/base/parts/sandbox/common/desktopTypes';
import { getConfigBatchSourceSeed, normalizeBatchLimit } from 'ls/workbench/services/config/configSchema';
import type { BatchSource } from 'ls/workbench/services/config/configSchema';
import type { WebContentState } from 'ls/workbench/services/webContent/webContentNavigationService';
import { normalizeBrowserTabKeepAliveLimit } from 'ls/workbench/services/webContent/webContentRetentionConfig';
import {
  getLlmProviderDefinition,
  getLlmModelOptionsForProvider,
  parseLlmModelOptionValue,
} from 'ls/workbench/services/llm/registry';

import { isEditorContentTabInput } from 'ls/workbench/browser/parts/editor/editorInput';
import type { EditorWorkspaceTab } from 'ls/workbench/browser/parts/editor/editorModel';
import type { WritingEditorStableSelectionTarget } from 'ls/editor/common/writingEditorDocument';
import { editorDraftStyleService } from 'ls/editor/browser/text/editorDraftStyleService';
import {
  hasDesktopRuntime,
  hasWebContentRuntime,
} from 'ls/base/common/platform';
import { EventEmitter } from 'ls/base/common/event';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostService';
import { applyWorkbenchTheme } from 'ls/workbench/services/themes/browser/workbenchThemeService';
import { applyWorkbenchBrowserStyles } from 'ls/workbench/browser/style';
import type { EditorOpenRequest } from 'ls/workbench/services/editor/common/editorOpenTypes';
import 'ls/workbench/browser/media/workbench.css';

export type WorkbenchPage = 'content' | 'settings';

export type WorkbenchStateSnapshot = {
  activePage: WorkbenchPage;
};

export type WorkbenchServicesSyncParams = {
  settingsController: SettingsController;
  settingsContext: SettingsControllerContext;
  libraryModel: LibraryModel;
  libraryContext: LibraryModelContext;
  editorPartController: EditorPartModel;
  editorPartContext: EditorPartControllerContext;
  assistantModel: AssistantModel;
  assistantContext: AssistantModelContext;
  documentActionsController: DocumentActionsController;
  documentActionsContext: DocumentActionsControllerContext;
  batchFetchController: BatchFetchController;
  batchFetchContext: BatchFetchControllerContext;
};

type WorkbenchEvent =
  | {
      type: 'SET_ACTIVE_PAGE';
      page: WorkbenchPage;
    }
  | {
      type: 'TOGGLE_SETTINGS';
    };

export function resolveWorkbenchStatusbarVisibility(statusbarVisible: boolean) {
  return statusbarVisible;
}

type DesktopInvokeArgs = Record<string, unknown> | undefined;

const DEFAULT_WORKBENCH_STATE: WorkbenchStateSnapshot = {
  activePage: 'content',
};

const INITIAL_BATCH_SOURCES = getConfigBatchSourceSeed();

let workbenchState = DEFAULT_WORKBENCH_STATE;
const onDidChangeWorkbenchStateEmitter = new EventEmitter<void>();
let settingsController: SettingsController | null = null;
let libraryModel: LibraryModel | null = null;
let webContentNavigationModel: WebContentNavigationModel | null = null;
let editorPartController: EditorPartModel | null = null;
let assistantModel: AssistantModel | null = null;
let documentActionsController: DocumentActionsController | null = null;
let batchFetchController: BatchFetchController | null = null;
let activeWorkbenchHost: WorkbenchHost | null = null;
let activeOverlayView:
  | ReturnType<typeof createToastOverlayWindowView>
  | ReturnType<typeof createArticleDetailsModalWindowView>
  | null = null;
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

function toFileUrl(filePath: string) {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }

  if (/^[a-zA-Z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }

  return encodeURI(`file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
}

function looksLikePdfResource(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.endsWith('.pdf') ||
    normalized.includes('.pdf?') ||
    normalized.includes('/pdf') ||
    normalized.includes('format=pdf') ||
    normalized.includes('download=pdf')
  );
}

function buildSelectedArticleOrderLookup(
  selectedArticleKeysInOrder: readonly string[],
) {
  return new Map(
    selectedArticleKeysInOrder.map((key, index) => [key, index + 1]),
  );
}

function resolveRuntimeState() {
  const electronRuntime = hasDesktopRuntime();
  const webContentRuntime = hasWebContentRuntime();

  return {
    electronRuntime,
    webContentRuntime,
    desktopRuntime: electronRuntime,
  };
}

export type WorkbenchLayoutViewProps = {
  mode?: 'content' | 'settings';
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  isLayoutEdgeSnappingEnabled: boolean;
  primarySidebarSize: number;
  agentSidebarSize: number;
  isEditorCollapsed: boolean;
  expandedEditorSize: number;
  partViews: ReturnType<typeof createWorkbenchContentPartViews>;
};

function createWorkbenchLayoutElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

export class WorkbenchLayoutView {
  private props: WorkbenchLayoutViewProps;
  private lastContentEditorSize: number | null = null;
  private readonly element = createWorkbenchLayoutElement('section', 'workbench-content-layout');
  private readonly mainElement = createWorkbenchLayoutElement('main');
  private readonly primarySidebarSlot = new WorkbenchLayoutSlotView(
    'workbench-content-slot-leading-group workbench-leading-pane workbench-leading-pane-primary',
    true,
  );
  private readonly editorSlot = new WorkbenchLayoutSlotView('workbench-content-slot-editor');
  private readonly agentBarSlot = new WorkbenchLayoutSlotView(
    'workbench-content-slot-agent',
    true,
  );
  private readonly layoutController: WorkbenchContentLayoutController;
  private disposed = false;

  get gridView() {
    return (this.layoutController as unknown as { gridView: unknown }).gridView;
  }

  get layoutAnimationFrame() {
    return (this.layoutController as unknown as { layoutAnimationFrame: unknown }).layoutAnimationFrame;
  }

  get resizeObserver() {
    return (this.layoutController as unknown as { resizeObserver: unknown }).resizeObserver;
  }

  get handleWindowResize() {
    return (this.layoutController as unknown as {
      handleWindowResize: EventListenerOrEventListenerObject;
    }).handleWindowResize;
  }

  constructor(props: WorkbenchLayoutViewProps) {
    this.props = props;
    this.element.append(this.mainElement);
    this.layoutController = new WorkbenchContentLayoutController({
      container: this.element,
      contentHost: this.mainElement,
      primarySidebarSlot: this.primarySidebarSlot,
      editorSlot: this.editorSlot,
      agentSidebarSlot: this.agentBarSlot,
      getState: () => ({
        isPrimarySidebarVisible: this.props.isPrimarySidebarVisible,
        isAgentSidebarVisible: this.props.isAgentSidebarVisible,
        isLayoutEdgeSnappingEnabled: this.props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: this.props.primarySidebarSize,
        agentSidebarSize: this.props.agentSidebarSize,
        isEditorCollapsed: this.props.isEditorCollapsed,
        expandedEditorSize: this.props.expandedEditorSize,
      }),
      onPrimarySidebarVisibilityChange: setPrimarySidebarVisible,
      onAgentSidebarVisibilityChange: setAgentSidebarVisible,
      onSidebarSizesChange: setWorkbenchSidebarSizes,
    });
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: WorkbenchLayoutViewProps) {
    if (this.disposed) {
      return;
    }

    const previousMode = this.resolveMode(this.props.mode);
    const nextMode = this.resolveMode(props.mode);
    if (previousMode === 'content' && nextMode === 'settings') {
      const editorSize = this.layoutController.getEditorViewSize();
      if (
        typeof editorSize === 'number' &&
        Number.isFinite(editorSize) &&
        editorSize > 0
      ) {
        this.lastContentEditorSize = editorSize;
      }
    }
    if (previousMode === 'settings' && nextMode === 'content') {
      this.layoutController.setNextSyncCachedSizesOverride({
        primarySidebarSize: props.primarySidebarSize,
        editorSize: this.lastContentEditorSize ?? props.expandedEditorSize,
        agentSidebarSize: props.agentSidebarSize,
      });
    }

    this.props = props;
    this.render();
  }

  layout() {
    this.layoutController.layout();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.layoutController.dispose();
    this.element.replaceChildren();
  }

  private readonly handleToggleEditorCollapse = () => {
    const editorViewSize = this.layoutController.getEditorViewSize();
    if (!this.props.isEditorCollapsed && typeof editorViewSize === 'number') {
      toggleEditorCollapsed(editorViewSize);
      return;
    }

    toggleEditorCollapsed();
  };

  private resolveMode(mode: WorkbenchLayoutViewProps['mode']) {
    return mode === 'settings' ? 'settings' : 'content';
  }

  private render() {
    this.mainElement.className = getWorkbenchContentClassName({
      isPrimarySidebarVisible: this.props.isPrimarySidebarVisible,
      isAgentSidebarVisible: this.props.isAgentSidebarVisible,
    });

    this.props.partViews.setLayoutState({
      isEditorCollapsed: this.props.isEditorCollapsed,
      onToggleEditorCollapse: this.handleToggleEditorCollapse,
    });
    this.primarySidebarSlot.setContent(this.props.partViews.getPrimarySidebarElement());
    this.editorSlot.setContent(this.props.partViews.getEditorElement());
    this.agentBarSlot.setContent(this.props.partViews.getAgentSidebarElement());
    this.layoutController.sync();
  }
}

export function createWorkbenchLayoutView(props: WorkbenchLayoutViewProps) {
  return new WorkbenchLayoutView(props);
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

function detectNativeModalKind() {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get('nativeModal');
}

function detectNativeOverlayKind() {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get('nativeOverlay');
}

function reduceWorkbenchState(
  state: WorkbenchStateSnapshot,
  event: WorkbenchEvent,
): WorkbenchStateSnapshot {
  switch (event.type) {
    case 'SET_ACTIVE_PAGE':
      if (state.activePage === event.page) {
        return state;
      }
      return {
        ...state,
        activePage: event.page,
      };
    case 'TOGGLE_SETTINGS':
      return {
        ...state,
        activePage: state.activePage === 'settings' ? 'content' : 'settings',
      };
    default:
      return state;
  }
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

function resolveCurrentPdfDownloadArticle(
  articles: ReadonlyArray<Article>,
  sourceUrl: string,
): Pick<
  Article,
  | 'title'
  | 'sourceUrl'
  | 'fetchedAt'
  | 'journalTitle'
  | 'doi'
  | 'authors'
  | 'publishedAt'
  | 'sourceId'
> | null {
  const normalizedSourceUrl = normalizeUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    return null;
  }

  const matchedArticle = articles.find(
    (article) => normalizeUrl(article.sourceUrl) === normalizedSourceUrl,
  );

  return {
    title: matchedArticle?.title ?? '',
    sourceUrl: normalizedSourceUrl,
    fetchedAt: matchedArticle?.fetchedAt ?? new Date().toISOString(),
    journalTitle: matchedArticle?.journalTitle ?? null,
    doi: matchedArticle?.doi ?? null,
    authors: matchedArticle?.authors ?? [],
    publishedAt: matchedArticle?.publishedAt ?? null,
    sourceId: matchedArticle?.sourceId ?? null,
  };
}

class WorkbenchHost {
  private readonly rootElement: HTMLElement;
  private readonly containerElement: HTMLDivElement;
  private readonly shellElement: HTMLDivElement;
  private readonly pageMount: HTMLDivElement;
  private readonly toastMount: HTMLDivElement;
  private readonly statusbarElement: HTMLElement;
  private readonly toastHost: ToastHost;
  private workbenchLayoutView: ReturnType<typeof createWorkbenchLayoutView> | null = null;
  private workbenchContentPartViews: ReturnType<typeof createWorkbenchContentPartViews> | null = null;
  private retiredWorkbenchContentPartViews:
    | ReturnType<typeof createWorkbenchContentPartViews>
    | null = null;
  private readonly auxiliaryEditorTopbarActionsView = createEditorTopbarActionsView({
    isEditorCollapsed: true,
    isAgentSidebarVisible: false,
    showAgentSidebarToggle: true,
    agentSidebarToggleLabel: '',
    labels: {
      topbarAddAction: '',
      createDraft: '',
      createBrowser: '',
      createFile: '',
      expandEditor: '',
      collapseEditor: '',
    },
    onOpenEditor: (_request: EditorOpenRequest) => {},
    onToggleEditorCollapse: toggleEditorCollapsed,
    onToggleAgentSidebar: () => {},
  });
  private readonly sidebarTopbarActionsView = new SidebarTopbarActionsView();
  private readonly settingsTopbarActionsView = createSettingsTopbarActionsView({
    backLabel: '',
    onNavigateBack: () => {},
  });
  private readonly primaryBarFooterActionsView = new PrimaryBarFooterActionsView();
  private settingsView: ReturnType<typeof createSettingsPartView> | null = null;
  private editorPartController: EditorPartModel | null = null;
  private readonly globalDisposables: Array<() => void> = [];
  private webContentStateDisposable: (() => void) | null = null;
  private servicesSubscribed = false;
  private isDisposed = false;
  private isRendering = false;
  private renderPending = false;
  private webContentRuntime = false;
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
  private readonly handleWindowKeydown = (event: KeyboardEvent) => {
    handleWorkbenchEditorShortcut(event);
  };

  constructor(rootElement: HTMLElement) {
    this.rootElement = rootElement;
    this.containerElement = document.createElement('div');
    this.shellElement = document.createElement('div');
    this.pageMount = document.createElement('div');
    this.toastMount = document.createElement('div');
    this.statusbarElement = document.createElement('section');
    this.toastHost = createToastHost(this.toastMount);

    this.rootElement.replaceChildren(this.containerElement);
    this.containerElement.append(this.shellElement);
    this.shellElement.append(this.pageMount, this.toastMount);

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
      subscribeWorkbenchState(this.requestRender),
      subscribeWorkbenchLayoutState(this.requestRender),
      subscribeWindowState(this.requestRender),
      subscribeWorkbenchContentState(this.requestRender),
      editorDraftStyleService.subscribe(this.requestRender),
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
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, null);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, null);

    this.workbenchLayoutView?.dispose();
    this.workbenchLayoutView = null;
    this.workbenchContentPartViews?.dispose();
    this.workbenchContentPartViews = null;
    this.retiredWorkbenchContentPartViews = null;
    this.auxiliaryEditorTopbarActionsView.dispose();
    this.sidebarTopbarActionsView.dispose();
    this.settingsTopbarActionsView.dispose();
    this.primaryBarFooterActionsView.dispose();
    this.settingsView?.dispose();
    this.settingsView = null;
    this.editorPartController = null;
    this.toastHost.dispose();
    this.rootElement.replaceChildren();
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
    assistantModel: AssistantModel;
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
      services.assistantModel.subscribe(this.requestRender),
      services.documentActionsController.subscribe(this.requestRender),
      services.batchFetchController.subscribe(this.requestRender),
    );
  }

  private readonly handleEditorPartChange = (
    _reason: EditorPartChangeReason,
  ) => {
    this.requestRender();
  };

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
    setAgentSidebarVisible(isKnowledgeBaseModeEnabled);
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

  private syncStatusbarVisibility(statusbarVisible: boolean) {
    if (statusbarVisible) {
      if (!this.statusbarElement.isConnected) {
        this.containerElement.append(this.statusbarElement);
      }
      registerWorkbenchPartDomNode(
        WORKBENCH_PART_IDS.statusbar,
        this.statusbarElement,
      );
      return;
    }

    if (this.statusbarElement.parentElement === this.containerElement) {
      this.containerElement.removeChild(this.statusbarElement);
    }
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
  }

  private syncWorkbenchChrome(params: {
    electronRuntime: boolean;
    useMica: boolean;
    statusbarVisible: boolean;
    activePage: WorkbenchPage;
  }) {
    const { electronRuntime, useMica, statusbarVisible, activePage } = params;
    const isStatusbarVisible = resolveWorkbenchStatusbarVisibility(statusbarVisible);

    this.containerElement.className = [
      'app-window',
      electronRuntime && useMica ? 'is-mica-enabled' : '',
      isStatusbarVisible ? 'has-statusbar' : '',
    ]
      .filter(Boolean)
      .join(' ');
    this.shellElement.className = getWorkbenchShellClassName({ activePage });
    this.syncStatusbarVisibility(isStatusbarVisible);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, null);
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
    isAgentSidebarVisible: boolean;
    isLayoutEdgeSnappingEnabled: boolean;
    primarySidebarSize: number;
    agentSidebarSize: number;
    isEditorCollapsed: boolean;
    expandedEditorSize: number;
    fetchPaneProps: ReturnType<typeof createFetchPaneProps>;
    primaryBarProps: PrimaryBarProps;
    agentBarProps: AgentBarPartProps;
    sidebarTopbarActionsProps: {
      isPrimarySidebarVisible: boolean;
      primarySidebarToggleLabel: string;
      addressBarLabel: string;
      onTogglePrimarySidebar: () => void;
      onFocusAddressBar: () => void;
    };
    onOpenSettings: () => void;
    onApplyLayoutAgent: () => void;
    onApplyLayoutFlow: () => void;
    editorTopbarAuxiliaryActionsElement?: HTMLElement | null;
    editorPartProps: EditorPartProps;
  }) {
    this.retiredWorkbenchContentPartViews = null;
    this.settingsView?.dispose();
    this.settingsView = null;
    this.sidebarTopbarActionsView.setProps(props.sidebarTopbarActionsProps);
    this.primaryBarFooterActionsView.setProps({
      accountLabel: props.primaryBarProps.accountLabel,
      moreLabel: props.primaryBarProps.moreLabel,
      settingsLabel: props.primaryBarProps.settingsLabel,
      isSettingsActive: false,
      activeLayoutMode: this.resolvePrimaryBarFooterLayoutMode({
        isAgentSidebarVisible: props.isAgentSidebarVisible,
        isEditorCollapsed: props.isEditorCollapsed,
      }),
      onApplyLayoutAgent: props.onApplyLayoutAgent,
      onApplyLayoutFlow: props.onApplyLayoutFlow,
      onOpenSettings: props.onOpenSettings,
    });
    const partViewProps = {
      mode: 'content' as const,
      isPrimarySidebarVisible: props.isPrimarySidebarVisible,
      isAgentSidebarVisible: props.isAgentSidebarVisible,
      primaryBarProps: props.primaryBarProps,
      agentBarProps: props.agentBarProps,
      editorPartProps: props.editorPartProps,
      sidebarTopbarActionsElement: this.sidebarTopbarActionsView.getElement(),
      primaryBarFooterActionsElement: this.primaryBarFooterActionsView.getElement(),
      editorTopbarAuxiliaryActionsElement: props.editorTopbarAuxiliaryActionsElement,
    };
    if (!this.workbenchContentPartViews) {
      this.workbenchContentPartViews = createWorkbenchContentPartViews(partViewProps);
    } else {
      this.workbenchContentPartViews.setProps(partViewProps);
    }
    if (!this.workbenchLayoutView) {
      this.workbenchLayoutView = createWorkbenchLayoutView({
        mode: 'content',
        isPrimarySidebarVisible: props.isPrimarySidebarVisible,
        isAgentSidebarVisible: props.isAgentSidebarVisible,
        isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: props.primarySidebarSize,
        agentSidebarSize: props.agentSidebarSize,
        isEditorCollapsed: props.isEditorCollapsed,
        expandedEditorSize: props.expandedEditorSize,
        partViews: this.workbenchContentPartViews,
      });
    } else {
      this.workbenchLayoutView.setProps({
        mode: 'content',
        isPrimarySidebarVisible: props.isPrimarySidebarVisible,
        isAgentSidebarVisible: props.isAgentSidebarVisible,
        isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: props.primarySidebarSize,
        agentSidebarSize: props.agentSidebarSize,
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

  private resolvePrimaryBarFooterLayoutMode(props: {
    isAgentSidebarVisible: boolean;
    isEditorCollapsed: boolean;
  }): PrimaryBarFooterLayoutMode | null {
    if (props.isEditorCollapsed) {
      return null;
    }

    return props.isAgentSidebarVisible ? 'agent' : 'flow';
  }

  private renderSettingsPage(
    props: {
      settingsPartProps: ReturnType<typeof createSettingsPartProps>;
      isLayoutEdgeSnappingEnabled: boolean;
      primarySidebarSize: number;
      agentSidebarSize: number;
      expandedEditorSize: number;
      primaryBarProps: PrimaryBarProps;
      agentBarProps: AgentBarPartProps;
      editorPartProps: EditorPartProps;
      onOpenSettings: () => void;
      onApplyLayoutAgent: () => void;
      onApplyLayoutFlow: () => void;
    },
  ) {
    this.retiredWorkbenchContentPartViews = null;
    setWorkbenchEditorCommandHandlers(null);
    if (!this.settingsView) {
      this.settingsView = createSettingsPartView(props.settingsPartProps);
    } else {
      this.settingsView.setProps(props.settingsPartProps);
    }
    this.settingsTopbarActionsView.setProps({
      backLabel: props.settingsPartProps.labels.settingsNavigationBack,
      onNavigateBack: props.settingsPartProps.onNavigateBack,
    });
    this.primaryBarFooterActionsView.setProps({
      accountLabel: props.primaryBarProps.accountLabel,
      moreLabel: props.primaryBarProps.moreLabel,
      settingsLabel: props.primaryBarProps.settingsLabel,
      isSettingsActive: true,
      activeLayoutMode: 'flow',
      onApplyLayoutAgent: props.onApplyLayoutAgent,
      onApplyLayoutFlow: props.onApplyLayoutFlow,
      onOpenSettings: props.onOpenSettings,
    });
    const partViewProps = {
      mode: 'settings' as const,
      isPrimarySidebarVisible: true,
      isAgentSidebarVisible: false,
      primaryBarProps: props.primaryBarProps,
      settingsNavigationElement: this.settingsView.getNavigationElement(),
      settingsTopbarActionsElement: this.settingsTopbarActionsView.getElement(),
      agentBarProps: props.agentBarProps,
      editorPartProps: props.editorPartProps,
      settingsContentElement: this.settingsView.getContentElement(),
      sidebarTopbarActionsElement: this.sidebarTopbarActionsView.getElement(),
      primaryBarFooterActionsElement: this.primaryBarFooterActionsView.getElement(),
      editorTopbarAuxiliaryActionsElement: null,
    };
    if (!this.workbenchContentPartViews) {
      this.workbenchContentPartViews = createWorkbenchContentPartViews(partViewProps);
    } else {
      this.workbenchContentPartViews.setProps(partViewProps);
    }
    if (!this.workbenchLayoutView) {
      this.workbenchLayoutView = createWorkbenchLayoutView({
        mode: 'settings',
        isPrimarySidebarVisible: true,
        isAgentSidebarVisible: false,
        isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: props.primarySidebarSize,
        agentSidebarSize: props.agentSidebarSize,
        isEditorCollapsed: false,
        expandedEditorSize: props.expandedEditorSize,
        partViews: this.workbenchContentPartViews,
      });
    } else {
      this.workbenchLayoutView.setProps({
        mode: 'settings',
        isPrimarySidebarVisible: true,
        isAgentSidebarVisible: false,
        isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
        primarySidebarSize: props.primarySidebarSize,
        agentSidebarSize: props.agentSidebarSize,
        isEditorCollapsed: false,
        expandedEditorSize: props.expandedEditorSize,
        partViews: this.workbenchContentPartViews,
      });
    }

    const workbenchContentElement = this.workbenchLayoutView.getElement();
    if (this.pageMount.firstChild !== workbenchContentElement) {
      this.pageMount.replaceChildren(workbenchContentElement);
    }
    this.workbenchLayoutView.layout();
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
    const { activePage } = getWorkbenchStateSnapshot();
    const {
      isPrimarySidebarVisible,
      isAgentSidebarVisible,
      primarySidebarSize,
      agentSidebarSize,
      isEditorCollapsed,
      expandedEditorSize,
    } = getWorkbenchLayoutStateSnapshot();
    const { electronRuntime, webContentRuntime, desktopRuntime } =
      resolveRuntimeState();
    const { isFullscreen: isWindowFullscreen } = getWindowStateSnapshot();

    const invokeDesktop = async <T>(
      command: string,
      args?: DesktopInvokeArgs,
    ): Promise<T> => {
      return nativeHostService.invoke(command as never, args as never) as Promise<T>;
    };

    const settingsControllerInstance = getWorkbenchSettingsController({
      desktopRuntime,
      invokeDesktop,
      ui,
      locale,
      initialBatchSources: INITIAL_BATCH_SOURCES,
    });
    const settingsSnapshot = settingsControllerInstance.getSnapshot();
    const editorDraftStyleSnapshot = editorDraftStyleService.getSnapshot();
    const {
      batchSources,
      batchLimit,
      sameDomainOnly,
      systemNotificationsEnabled,
      warningNotificationsEnabled,
      menuBarIconEnabled,
      completionNotificationsEnabled,
      statusbarVisible,
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
      isSettingsLoading,
      isSettingsSaving,
      isTestingRagConnection,
      isTestingLlmConnection,
      isTestingTranslationConnection,
    } = settingsSnapshot;
    setWorkbenchBrowserTabKeepAliveLimit(browserTabKeepAliveLimit);
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
      hasData,
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

    const webContentNavigationModelInstance = getWorkbenchWebContentNavigationModel();
    this.syncWebContentRuntime(webContentNavigationModelInstance, webContentRuntime);
    const { browserUrl, webContentState } =
      webContentNavigationModelInstance.getSnapshot();
    const { pageTitle: browserPageTitle = '', faviconUrl: browserFaviconUrl = '' } =
      webContentState;
    const viewPartProps = {
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      electronRuntime,
      webContentRuntime,
      labels: {
        emptyState: ui.emptyState,
        contentUnavailable: ui.webContentUnavailable,
      },
    };
    const editorPartControllerInstance = getWorkbenchEditorPartController({
      ui,
      viewPartProps,
      browserUrl,
      webUrl,
    });
    this.editorPartController = editorPartControllerInstance;
    const editorPartSnapshot = editorPartControllerInstance.getSnapshot();
    const {
      tabs: editorTabs,
      activeTab: activeEditorTab,
      draftBody,
      createBrowserTab: handleCreateBrowserTab,
      createPdfTab: handleCreatePdfTab,
      webContentSurfaceSnapshot,
      updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl,
      editorPartProps,
    } = {
      ...editorPartSnapshot,
      createBrowserTab: editorPartControllerInstance.createBrowserTab,
      createPdfTab: editorPartControllerInstance.createPdfTab,
      updateActiveContentTabUrl:
        editorPartControllerInstance.updateActiveContentTabUrl,
      updateActiveBrowserTabPageTitle:
        editorPartControllerInstance.updateActiveBrowserTabPageTitle,
      updateActiveBrowserTabFaviconUrl:
        editorPartControllerInstance.updateActiveBrowserTabFaviconUrl,
    };

    const assistantModelInstance = getWorkbenchAssistantModel({
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
    const assistantSnapshot = assistantModelInstance.getSnapshot();
    const {
      question: assistantQuestion,
      messages: assistantMessages,
      isAsking: isAssistantAsking,
      errorMessage: assistantErrorMessage,
      conversations: assistantConversations,
      activeConversationId: activeAssistantConversationId,
    } = assistantSnapshot;
    const setAssistantQuestion = assistantModelInstance.setQuestion;
    const handleAssistantAsk = assistantModelInstance.handleAsk;
    const handleAssistantCreateConversation =
      assistantModelInstance.handleCreateConversation;
    const handleAssistantActivateConversation =
      assistantModelInstance.handleActivateConversation;
    const handleAssistantCloseConversation =
      assistantModelInstance.handleCloseConversation;
    const handleAssistantApplyPatch =
      assistantModelInstance.handleApplyPatch;

    const filteredArticleKeysInOrder = filteredArticles.map((article) =>
      getArticleSelectionKey(article),
    );

    const selectedArticleKeys = new Set(selectedArticleKeysInOrder);
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

    const documentActionsControllerInstance =
      getWorkbenchDocumentActionsController({
        desktopRuntime,
        invokeDesktop,
        locale,
        ui,
        knowledgeBaseEnabled,
        pdfDownloadDir,
        knowledgeBasePdfDownloadDir,
        pdfFileNameUseSelectionOrder,
        isSelectionModeEnabled: selectionModePhase !== 'off',
        selectedArticleOrderLookup,
        exportableArticles,
        activeDraftExport,
        onLibraryDocumentUpserted:
          libraryModelInstance.upsertDocumentSummary,
        onLibraryUpdated: refreshLibrary,
      });
    const handleSharedPdfDownload =
      documentActionsControllerInstance.handleSharedPdfDownload;
    const handleOpenArticleDetails =
      documentActionsControllerInstance.handleOpenArticleDetails;

    const handleSidebarPdfDownload = () => {
      const sourceUrl = resolveContentSourceUrl(
        webContentSurfaceSnapshot,
        browserUrl,
        webUrl,
      );
      if (!sourceUrl) {
        return;
      }

      const downloadArticle = resolveCurrentPdfDownloadArticle(
        filteredArticles,
        sourceUrl,
      );
      if (!downloadArticle) {
        return;
      }

      void handleSharedPdfDownload(downloadArticle);
    };

    const handleLibraryDocumentOpen = (document: LibraryDocumentSummary) => {
      const localFilePath = String(document.latestFilePath ?? '').trim();
      if (localFilePath && looksLikePdfResource(localFilePath)) {
        handleCreatePdfTab(toFileUrl(localFilePath));
        return;
      }

      const sourceUrl = String(document.sourceUrl ?? '').trim();
      if (sourceUrl) {
        if (looksLikePdfResource(sourceUrl)) {
          handleCreatePdfTab(sourceUrl);
          return;
        }
        handleCreateBrowserTab(sourceUrl);
      }
    };

    const handleLibraryDocumentRename = async (
      document: LibraryDocumentSummary,
    ) => {
      const nextTitle =
        (await showWorkbenchTextInputModal({
          title: ui.libraryContextRenameTitle,
          label: ui.libraryContextRenameLabel,
          defaultValue: document.title?.trim() || '',
          placeholder: ui.libraryContextRenamePlaceholder,
          ui,
        })) ?? '';
      if (!nextTitle) {
        return;
      }

      const updatedDocument = await invokeDesktop<LibraryDocumentSummary>(
        'upsert_library_document_metadata',
        {
          documentId: document.documentId,
          articleTitle: nextTitle,
        },
      );
      libraryModelInstance.upsertDocumentSummary(updatedDocument);
      void refreshLibrary();
    };

    const handleLibraryDocumentEditSourceUrl = async (
      document: LibraryDocumentSummary,
    ) => {
      const nextSourceUrl =
        (await showWorkbenchTextInputModal({
          title: ui.libraryContextEditSourceUrlTitle,
          label: ui.libraryContextEditSourceUrlLabel,
          defaultValue: document.sourceUrl?.trim() || '',
          placeholder: 'https://',
          ui,
        })) ?? '';
      if (!nextSourceUrl) {
        return;
      }

      const updatedDocument = await invokeDesktop<LibraryDocumentSummary>(
        'upsert_library_document_metadata',
        {
          documentId: document.documentId,
          sourceUrl: nextSourceUrl,
        },
      );
      libraryModelInstance.upsertDocumentSummary(updatedDocument);
      void refreshLibrary();
    };

    const handleLibraryDocumentDelete = async (
      document: LibraryDocumentSummary,
    ) => {
      const confirmed = window.confirm(
        ui.libraryContextDeleteConfirm.replace(
          '{title}',
          document.title?.trim() || ui.untitled,
        ),
      );
      if (!confirmed) {
        return;
      }

      const deleted = await invokeDesktop<boolean>('delete_library_document', {
        documentId: document.documentId,
      });
      if (!deleted) {
        return;
      }

      libraryModelInstance.removeDocumentSummary(document.documentId);
      void refreshLibrary();
    };

    const baseEditorPartProps = editorPartProps;
    const focusWorkbenchWebUrlInput = () => {
      editorPartControllerInstance.openBrowserPane();
      this.workbenchContentPartViews?.focusActiveEditorPrimaryInput();
    };
    const editorBrowserToolbarActions = createEditorBrowserToolbarActions({
      browserUrl,
      browserPageTitle,
      electronRuntime,
      webContentRuntime,
      invokeDesktop,
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
      ...editorBrowserToolbarActions,
    };
    this.auxiliaryEditorTopbarActionsView.setProps({
      isEditorCollapsed: true,
      isAgentSidebarVisible,
      showAgentSidebarToggle: true,
      agentSidebarToggleLabel: isAgentSidebarVisible
        ? ui.titlebarHideAssistant
        : ui.titlebarShowAssistant,
      labels: {
        topbarAddAction: contentAwareEditorPartProps.labels.topbarAddAction,
        createDraft: contentAwareEditorPartProps.labels.createDraft,
        createBrowser: contentAwareEditorPartProps.labels.createBrowser,
        createFile: contentAwareEditorPartProps.labels.createFile,
        expandEditor: contentAwareEditorPartProps.labels.expandEditor,
        collapseEditor: contentAwareEditorPartProps.labels.collapseEditor,
      },
      onOpenEditor: contentAwareEditorPartProps.onOpenEditor,
      onToggleEditorCollapse: toggleEditorCollapsed,
      onToggleAgentSidebar: toggleAgentSidebarVisibility,
    });

    const handleBatchFetchStart = () => {
      setWorkbenchArticles([]);
    };

    const handleBatchFetchSuccess = (nextArticles: Article[]) => {
      setWorkbenchArticles(nextArticles);
    };

    const batchFetchControllerInstance = getWorkbenchBatchFetchController({
      desktopRuntime,
      addressBarUrl: fetchSeedUrl || webUrl,
      batchSources,
      sameDomainOnly,
      batchStartDate,
      batchEndDate,
      invokeDesktop,
      ui,
      onBeforeFetch: handleBatchFetchStart,
      onFetchSuccess: handleBatchFetchSuccess,
    });
    const { isBatchLoading } = batchFetchControllerInstance.getSnapshot();
    const handleFetchLatestBatch =
      batchFetchControllerInstance.handleFetchLatestBatch;

    const handleToggleSelectionMode = () => {
      const previousPhase = getWorkbenchSessionSnapshot().selectionModePhase;
      if (previousPhase === 'off') {
        setWorkbenchSelectedArticleKeysInOrder([]);
        setWorkbenchSelectionModePhase('multi');
        return;
      }

      if (previousPhase === 'multi') {
        setWorkbenchSelectedArticleKeysInOrder(filteredArticleKeysInOrder);
        setWorkbenchSelectionModePhase('all');
        return;
      }

      setWorkbenchSelectedArticleKeysInOrder([]);
      setWorkbenchSelectionModePhase('off');
    };

    const handleToggleArticleSelected = (article: Article) => {
      if (getWorkbenchSessionSnapshot().selectionModePhase === 'off') {
        return;
      }

      const articleKey = getArticleSelectionKey(article);
      setWorkbenchSelectedArticleKeysInOrder((previousKeys) => {
        if (previousKeys.includes(articleKey)) {
          return previousKeys.filter((key) => key !== articleKey);
        }

        return [...previousKeys, articleKey];
      });
    };

    const handleCloseAgentSidebar = () => {
      setAgentSidebarVisible(false);
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
        browserUrl,
        webUrl,
      },
      assistantModel: assistantModelInstance,
      assistantContext: {
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
      documentActionsController: documentActionsControllerInstance,
      documentActionsContext: {
        desktopRuntime,
        invokeDesktop,
        locale,
        ui,
        knowledgeBaseEnabled,
        pdfDownloadDir,
        knowledgeBasePdfDownloadDir,
        pdfFileNameUseSelectionOrder,
        isSelectionModeEnabled: selectionModePhase !== 'off',
        selectedArticleOrderLookup,
        exportableArticles,
        activeDraftExport,
        onLibraryUpdated: refreshLibrary,
      },
      batchFetchController: batchFetchControllerInstance,
      batchFetchContext: {
        desktopRuntime,
        addressBarUrl: fetchSeedUrl || webUrl,
        batchSources,
        sameDomainOnly,
        batchStartDate,
        batchEndDate,
        invokeDesktop,
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
      assistantModel: assistantModelInstance,
      documentActionsController: documentActionsControllerInstance,
      batchFetchController: batchFetchControllerInstance,
    });

    const fetchPaneProps = createFetchPaneProps({
      state: {
        ui,
        locale,
        articles: filteredArticles,
        hasData,
        fetchStartDate: batchStartDate,
        fetchEndDate: batchEndDate,
        isFetchLoading: isBatchLoading,
        isSelectionModeEnabled: selectionModePhase !== 'off',
        selectionModePhase,
        selectedArticleKeys,
      },
      actions: {
        onFocusWebUrlInput: focusWorkbenchWebUrlInput,
        onFetchStartDateChange: setBatchStartDate,
        onFetchEndDateChange: setBatchEndDate,
        onFetch: () => void handleFetchLatestBatch(),
        onDownloadPdf: handleSharedPdfDownload,
        onOpenArticleDetails: handleOpenArticleDetails,
        onToggleSelectionMode: handleToggleSelectionMode,
        onToggleArticleSelected: handleToggleArticleSelected,
      },
    });

    const primaryBarProps: PrimaryBarProps = {
      labels: fetchPaneProps.labels,
      accountLabel: ui.appName,
      moreLabel: ui.agentbarToolbarMore,
      settingsLabel: ui.titlebarSettings,
      fetchPaneProps,
      librarySnapshot,
      isLibraryLoading,
      onRefreshLibrary: () => void refreshLibrary(),
      onDownloadPdf: handleSidebarPdfDownload,
      onDocumentOpen: handleLibraryDocumentOpen,
      onDocumentRename: (document: LibraryDocumentSummary) => {
        void handleLibraryDocumentRename(document);
      },
      onDocumentEditSourceUrl: (document: LibraryDocumentSummary) => {
        void handleLibraryDocumentEditSourceUrl(document);
      },
      onDocumentDelete: (document: LibraryDocumentSummary) => {
        void handleLibraryDocumentDelete(document);
      },
    };

    const agentBarProps = createAgentBarPartProps({
      state: {
        ui,
        isKnowledgeBaseModeEnabled: knowledgeBaseModeEnabled,
        question: assistantQuestion,
        messages: assistantMessages,
        isAsking: isAssistantAsking,
        errorMessage: assistantErrorMessage,
        availableArticleCount: filteredArticles.length,
        conversations: assistantConversations,
        activeConversationId: activeAssistantConversationId,
        llmModelOptions: agentLlmModelOptions,
        activeLlmModelOptionValue,
        isSecondarySidebarVisible: isPrimarySidebarVisible,
      },
      actions: {
        onQuestionChange: setAssistantQuestion,
        onAsk: () => void handleAssistantAsk(),
        onApplyPatch: handleAssistantApplyPatch,
        onCreateConversation: handleAssistantCreateConversation,
        onActivateConversation: handleAssistantActivateConversation,
        onCloseConversation: handleAssistantCloseConversation,
        onCloseAgentBar: handleCloseAgentSidebar,
        onToggleSecondarySidebar: togglePrimarySidebarVisibility,
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
        onOpenModelSettings: () => {
          const selectedOption = activeAgentChatModelOptionValue
            ? parseLlmModelOptionValue(activeAgentChatModelOptionValue)
            : null;
          settingsControllerInstance.setActiveLlmProvider(
            selectedOption?.providerId ?? activeLlmProvider,
          );
          setWorkbenchActivePage('settings');
        },
      },
    });
    const sidebarTopbarActionsProps = {
      isPrimarySidebarVisible,
      primarySidebarToggleLabel: isPrimarySidebarVisible
        ? ui.titlebarHidePrimarySidebar
        : ui.titlebarShowPrimarySidebar,
      addressBarLabel: ui.agentbarToolbarAddressBar,
      onTogglePrimarySidebar: togglePrimarySidebarVisibility,
      onFocusAddressBar: focusWorkbenchWebUrlInput,
    };

    const settingsPartProps = createSettingsPartProps({
      state: {
        ui,
        isSettingsLoading,
        locale,
        batchSources,
        batchLimit,
        sameDomainOnly,
        fetchStartDate: batchStartDate,
        fetchEndDate: batchEndDate,
        systemNotificationsEnabled,
        warningNotificationsEnabled,
        menuBarIconEnabled,
        completionNotificationsEnabled,
        useMica,
        statusbarVisible,
        browserTabKeepAliveLimit,
        theme,
        editorDraftStyle: {
          defaultBodyStyle: {
            ...editorDraftStyleSnapshot.defaultBodyStyle,
            inlineStyleDefaults: {
              ...editorDraftStyleSnapshot.defaultBodyStyle.inlineStyleDefaults,
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
      },
      actions: {
        onNavigateBack: toggleWorkbenchSettings,
        onBatchSourceUrlChange: settingsControllerInstance.handleBatchSourceUrlChange,
        onBatchSourceJournalTitleChange:
          settingsControllerInstance.handleBatchSourceJournalTitleChange,
        onAddBatchSource: settingsControllerInstance.handleAddBatchSource,
        onRemoveBatchSource: settingsControllerInstance.handleRemoveBatchSource,
        onMoveBatchSource: settingsControllerInstance.handleMoveBatchSource,
        onBatchLimitChange: (value) =>
          settingsControllerInstance.setBatchLimit(normalizeBatchLimit(value, 1)),
        onSameDomainOnlyChange: settingsControllerInstance.setSameDomainOnly,
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
        onTestRagConnection: () =>
          void settingsControllerInstance.handleTestRagConnection(),
        onTestLlmConnection: () =>
          void settingsControllerInstance.handleTestLlmConnection(),
        onTestTranslationConnection: () =>
          void settingsControllerInstance.handleTestTranslationConnection(),
        onOpenConfigLocation: () =>
          void settingsControllerInstance.handleOpenConfigLocation(),
        onResetDownloadDir: settingsControllerInstance.handleResetDownloadDir,
      },
    });

    this.syncWorkbenchChrome({
      electronRuntime,
      useMica,
      statusbarVisible,
      activePage,
    });

    if (activePage === 'content') {
      this.renderWorkbenchContentPage({
        isPrimarySidebarVisible,
        isAgentSidebarVisible,
        isLayoutEdgeSnappingEnabled: isWindowFullscreen,
        primarySidebarSize,
        agentSidebarSize,
        isEditorCollapsed,
        expandedEditorSize,
        fetchPaneProps,
        primaryBarProps,
        agentBarProps,
        sidebarTopbarActionsProps,
        onOpenSettings: toggleWorkbenchSettings,
        onApplyLayoutAgent: () => {
          setPrimarySidebarVisible(true);
          setAgentSidebarVisible(true);
          setEditorCollapsed(false);
        },
        onApplyLayoutFlow: () => {
          setPrimarySidebarVisible(true);
          setAgentSidebarVisible(false);
          setEditorCollapsed(false);
        },
        editorTopbarAuxiliaryActionsElement:
          this.auxiliaryEditorTopbarActionsView.getElement(),
        editorPartProps: {
          ...contentAwareEditorPartProps,
          isAgentSidebarVisible,
          showAgentSidebarToggle: true,
          agentSidebarToggleLabel: isAgentSidebarVisible
            ? ui.titlebarHideAssistant
            : ui.titlebarShowAssistant,
          onToggleAgentSidebar: toggleAgentSidebarVisibility,
        },
      });
    } else {
      this.renderSettingsPage({
        settingsPartProps,
        isLayoutEdgeSnappingEnabled: isWindowFullscreen,
        primarySidebarSize,
        agentSidebarSize,
        expandedEditorSize,
        primaryBarProps,
        agentBarProps,
        editorPartProps: contentAwareEditorPartProps,
        onOpenSettings: toggleWorkbenchSettings,
        onApplyLayoutAgent: () => {
          setPrimarySidebarVisible(true);
          setAgentSidebarVisible(true);
          setEditorCollapsed(false);
        },
        onApplyLayoutFlow: () => {
          setPrimarySidebarVisible(true);
          setAgentSidebarVisible(false);
          setEditorCollapsed(false);
        },
      });
    }

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

    this.toastHost.render(ui.toastClose);
  }
}

export function subscribeWorkbenchState(listener: () => void) {
  return onDidChangeWorkbenchStateEmitter.event(listener);
}

export function getWorkbenchStateSnapshot() {
  return workbenchState;
}

export function dispatchWorkbenchEvent(event: WorkbenchEvent) {
  const nextState = reduceWorkbenchState(workbenchState, event);
  if (Object.is(nextState, workbenchState)) {
    return;
  }

  workbenchState = nextState;
  onDidChangeWorkbenchStateEmitter.fire();
}

export function setWorkbenchActivePage(page: WorkbenchPage) {
  dispatchWorkbenchEvent({
    type: 'SET_ACTIVE_PAGE',
    page,
  });
}

export function toggleWorkbenchSettings() {
  dispatchWorkbenchEvent({
    type: 'TOGGLE_SETTINGS',
  });
}

export function disposeWorkbenchServices() {
  settingsController?.dispose();
  settingsController = null;

  libraryModel?.dispose();
  libraryModel = null;

  editorPartController?.dispose();
  editorPartController = null;

  documentActionsController?.dispose();
  documentActionsController = null;

  batchFetchController?.dispose();
  batchFetchController = null;

  webContentNavigationModel = null;
  assistantModel = null;
}

export function getWorkbenchSettingsController(
  context: SettingsControllerContext & { initialBatchSources: BatchSource[] },
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

export function getWorkbenchWebContentNavigationModel() {
  webContentNavigationModel ??= new WebContentNavigationModel();
  return webContentNavigationModel;
}

export function getWorkbenchEditorPartController(
  context: EditorPartControllerContext,
) {
  editorPartController ??= createEditorPartController(context);
  return editorPartController;
}

export function getWorkbenchAssistantModel(context: AssistantModelContext) {
  assistantModel ??= createAssistantModel(context);
  return assistantModel;
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
  assistantModel: assistantModelInstance,
  assistantContext,
  documentActionsController: documentActionsControllerInstance,
  documentActionsContext,
  batchFetchController: batchFetchControllerInstance,
  batchFetchContext,
}: WorkbenchServicesSyncParams) {
  settingsControllerInstance.setContext(settingsContext);
  libraryModelInstance.setContext(libraryContext);
  editorPartControllerInstance.setContext(editorPartContext);
  assistantModelInstance.setContext(assistantContext);
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
  activeOverlayView?.dispose();
  activeOverlayView = null;

  const nativeOverlayKind = detectNativeOverlayKind();
  const nativeModalKind = detectNativeModalKind();

  if (nativeOverlayKind === 'toast') {
    activeOverlayView = createToastOverlayWindowView();
    rootElement.replaceChildren(activeOverlayView.getElement());
    return;
  }

  if (nativeModalKind === 'article-details') {
    activeOverlayView = createArticleDetailsModalWindowView();
    rootElement.replaceChildren(activeOverlayView.getElement());
    return;
  }

  activeWorkbenchHost = new WorkbenchHost(rootElement);
  activeWorkbenchHost.start();
}
