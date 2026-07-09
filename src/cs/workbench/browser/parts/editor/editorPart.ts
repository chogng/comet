import type { LocaleMessages } from 'language/locales';
import { toEditorTabInput } from 'cs/workbench/browser/parts/editor/editorInput';
import { createWebContentSurfaceSnapshot } from 'cs/workbench/contrib/browserView/browser/browserSurfaceState';
import type { WebContentSurfaceSnapshot } from 'cs/workbench/contrib/browserView/browser/browserSurfaceState';

import { createEditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import type { EditorModelSnapshot, EditorWorkspaceTab, WritingEditorDocument } from 'cs/workbench/browser/parts/editor/editorModel';
import { createEditorOpenService } from 'cs/workbench/services/editor/browser/editorOpenService';
import type { EditorOpenService } from 'cs/workbench/services/editor/common/editorOpenService';
import type {
  EditorOpenHandler,
  EditorOpenRequest,
} from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { EditorPartBaseProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorViewStateKey } from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type { SerializedEditorViewStateEntry } from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { createEditorBrowserToolbarTitlebarLabels } from 'cs/workbench/browser/parts/titlebar/titlebarActions';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';

export type EditorPartState = {
  ui: LocaleMessages;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  dialogService: IDialogService;
  groupId: string;
  tabs: EditorWorkspaceTab[];
  dirtyDraftTabIds: readonly string[];
  activeTabId: string | null;
  activeTab: EditorWorkspaceTab | null;
  viewStateEntries: SerializedEditorViewStateEntry[];
};

export type EditorPartActions = {
  onActivateTab: (tabId: string) => void;
  onReorderTab: (
    tabId: string,
    targetSlotIndex: number,
  ) => void;
  onCloseTab: (tabId: string) => Promise<boolean>;
  onCloseOtherTabs: (tabId: string) => Promise<boolean>;
  onCloseAllTabs: () => Promise<boolean>;
  onRenameTab: (tabId: string) => void | Promise<void>;
  onOpenEditor: EditorOpenHandler;
  onPromptRenameBrowserFavorite: (
    params: { url: string; title: string },
  ) => Promise<string | null>;
  onPromptCreateBrowserFavoriteFolder: (
    params: { url: string; title: string },
  ) => Promise<string | null>;
  onDraftDocumentChange: (value: WritingEditorDocument) => void;
  onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
  onDeleteEditorViewState: (key: EditorViewStateKey) => void;
};

export type EditorPartControllerContext = {
  ui: LocaleMessages;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  dialogService: IDialogService;
  browserUrl: string;
  webUrl: string;
};

export type EditorPartControllerSnapshot = Pick<
  EditorModelSnapshot,
  | 'groupId'
  | 'tabs'
  | 'dirtyDraftTabIds'
  | 'activeTabId'
  | 'activeTab'
  | 'viewStateEntries'
> & {
  draftBody: string;
  webContentSurfaceSnapshot: WebContentSurfaceSnapshot;
  editorPartProps: EditorPartBaseProps;
};

export type EditorPartModel = EditorPartController;
export type EditorPartChangeReason = 'structure' | 'context';

type CreateEditorPartPropsParams = {
  state: EditorPartState;
  actions: EditorPartActions;
};

function toStructuralWorkspaceTab(tab: EditorWorkspaceTab) {
  return {
    ...toEditorTabInput(tab),
    residency: tab.residency,
  };
}

function createEditorPartStructureKey(snapshot: EditorPartControllerSnapshot) {
  return JSON.stringify({
    groupId: snapshot.groupId,
    tabs: snapshot.tabs.map(toStructuralWorkspaceTab),
    dirtyDraftTabIds: [...snapshot.dirtyDraftTabIds].sort(),
    activeTabId: snapshot.activeTabId,
    activeTab: snapshot.activeTab ? toStructuralWorkspaceTab(snapshot.activeTab) : null,
    webContentSurfaceSnapshot: snapshot.webContentSurfaceSnapshot,
  });
}

export function createEditorPartProps({
  state: {
    ui,
    viewPartProps,
    nativeHost,
    dialogService,
    groupId,
    tabs,
    dirtyDraftTabIds,
    activeTabId,
    activeTab,
    viewStateEntries,
  },
  actions: {
    onActivateTab,
    onReorderTab,
    onCloseTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onRenameTab,
    onOpenEditor,
    onPromptRenameBrowserFavorite,
    onPromptCreateBrowserFavoriteFolder,
    onDraftDocumentChange,
    onSetEditorViewState,
    onDeleteEditorViewState,
  },
}: CreateEditorPartPropsParams): EditorPartBaseProps {
  return {
    labels: {
      headerAddAction: ui.editorHeaderAddAction,
      createDraft: ui.editorCreateDraft,
      createBrowser: ui.editorCreateBrowser,
      createFile: ui.editorCreateFile,
      newTab: ui.editorNewTab,
      toolbarSources: ui.agentbarToolbarSources,
      toolbarFavorite: ui.agentbarToolbarFavorite,
      toolbarArchivePage: ui.editorToolbarArchivePage,
      ...createEditorBrowserToolbarTitlebarLabels(ui),
      toolbarMore: ui.agentbarToolbarMore,
      toolbarHardReload: ui.editorToolbarHardReload,
      toolbarCopyCurrentUrl: ui.editorToolbarCopyCurrentUrl,
      toolbarClearBrowsingHistory: ui.editorToolbarClearBrowsingHistory,
      toolbarClearCookies: ui.editorToolbarClearCookies,
      toolbarClearCache: ui.editorToolbarClearCache,
      toolbarAddressBar: ui.agentbarToolbarAddressBar,
      toolbarAddressPlaceholder: ui.editorToolbarAddressPlaceholder,
      browserLibraryPanelTitle: ui.agentbarToolbarSources,
      browserLibraryPanelRecentTitle: ui.editorToolbarSourcesRecent,
      browserLibraryPanelRecentTodayTitle: ui.editorToolbarSourcesToday,
      browserLibraryPanelRecentYesterdayTitle: ui.editorToolbarSourcesYesterday,
      browserLibraryPanelRecentLast7DaysTitle: ui.editorToolbarSourcesLast7Days,
      browserLibraryPanelRecentLast30DaysTitle: ui.editorToolbarSourcesLast30Days,
      browserLibraryPanelRecentOlderTitle: ui.editorToolbarSourcesOlder,
      browserLibraryPanelFavoritesTitle: ui.editorToolbarSourcesFavorites,
      browserLibraryPanelEmptyState: ui.editorToolbarSourcesEmpty,
      browserLibraryPanelContextOpen: ui.editorFavoriteContextOpen,
      browserLibraryPanelContextOpenInNewTab: ui.editorFavoriteContextOpenInNewTab,
      browserLibraryPanelContextNewFolder: ui.editorFavoriteContextNewFolder,
      browserLibraryPanelContextRename: ui.editorFavoriteContextRename,
      browserLibraryPanelContextRemoveFavorite: ui.editorFavoriteContextRemove,
      draftMode: ui.editorDraftMode,
      sourceMode: ui.editorSourceMode,
      pdfMode: ui.editorPdfMode,
      close: ui.toastClose,
      closeOthers: ui.editorTabContextCloseOthers,
      closeAll: ui.editorTabContextCloseAll,
      rename: ui.editorTabContextRename,
      editorModalConfirm: ui.editorModalConfirm,
      editorModalCancel: ui.editorModalCancel,
      renameFavoriteTitle: ui.editorFavoriteRenameTitle,
      renameFavoriteLabel: ui.editorFavoriteRenameLabel,
      newFavoriteFolderTitle: ui.editorFavoriteNewFolderTitle,
      newFavoriteFolderLabel: ui.editorFavoriteNewFolderLabel,
      expandEditor: ui.editorExpand,
      collapseEditor: ui.editorCollapse,
      emptyWorkspaceTitle: ui.editorEmptyWorkspaceTitle,
      emptyWorkspaceBody: ui.editorEmptyWorkspaceBody,
      draftBodyPlaceholder: ui.editorDraftBodyPlaceholder,
      pdfTitle: ui.editorPdfTitle,
      pdfOpenFile: ui.editorPdfOpenFile,
      renameTabTitle: ui.editorTabRenameTitle,
      renameTabLabel: ui.editorTabRenameLabel,
      status: {
        statusbarAriaLabel: ui.editorStatusbarAriaLabel,
        words: ui.editorStatusWords,
        characters: ui.editorStatusCharacters,
        paragraphs: ui.editorStatusParagraphs,
        selection: ui.editorStatusSelection,
        block: ui.editorStatusBlock,
        line: ui.editorStatusLine,
        column: ui.editorStatusColumn,
        url: ui.editorStatusUrl,
        blockFigure: ui.editorStatusFigure,
        ready: ui.statusReady,
      },
      textGroup: ui.editorRibbonText,
      formatGroup: ui.editorRibbonFormat,
      insertGroup: ui.editorRibbonInsert,
      historyGroup: ui.editorRibbonHistory,
      paragraph: ui.editorParagraph,
      heading1: ui.editorHeading1,
      heading2: ui.editorHeading2,
      heading3: ui.editorHeading3,
      bold: ui.editorBold,
      italic: ui.editorItalic,
      underline: ui.editorUnderline,
      fontFamily: ui.editorFontFamily,
      fontSize: ui.editorFontSize,
      defaultTextStyle: ui.editorDefaultTextStyle,
      alignLeft: ui.editorAlignLeft,
      alignCenter: ui.editorAlignCenter,
      alignRight: ui.editorAlignRight,
      clearInlineStyles: ui.editorClearInlineStyles,
      bulletList: ui.editorBulletList,
      orderedList: ui.editorOrderedList,
      blockquote: ui.editorBlockquote,
      undo: ui.editorUndo,
      redo: ui.editorRedo,
      insertCitation: ui.editorInsertCitation,
      insertFigure: ui.editorInsertFigure,
      insertFigureRef: ui.editorInsertFigureRef,
      citationPrompt: ui.editorCitationPrompt,
      figureUrlPrompt: ui.editorFigureUrlPrompt,
      figureCaptionPrompt: ui.editorFigureCaptionPrompt,
      figureRefPrompt: ui.editorFigureRefPrompt,
      fontFamilyPrompt: ui.editorFontFamilyPrompt,
      fontSizePrompt: ui.editorFontSizePrompt,
    },
    viewPartProps,
    nativeHost,
    dialogService,
    groupId,
    tabs,
    dirtyDraftTabIds,
    activeTabId,
    activeTab,
    viewStateEntries,
    onActivateTab,
    onReorderTab,
    onCloseTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onRenameTab,
    onOpenEditor,
    onPromptRenameBrowserFavorite,
    onPromptCreateBrowserFavoriteFolder,
    onDraftDocumentChange,
    onSetEditorViewState,
    onDeleteEditorViewState,
    showTitlebarActions: true,
    showToolbar: true,
    isEditorCollapsed: false,
    onToggleEditorCollapse: () => {},
  };
}

function createEditorPartControllerSnapshot(
  context: EditorPartControllerContext,
  editorModel: ReturnType<typeof createEditorModel>,
  actions: EditorPartActions,
): EditorPartControllerSnapshot {
  const editorSnapshot = editorModel.getSnapshot();
  const { ui, viewPartProps, nativeHost, dialogService } = context;
  const {
    groupId,
    tabs,
    dirtyDraftTabIds,
    activeTabId,
    activeTab,
    viewStateEntries,
  } = editorSnapshot;
  const draftBody = editorModel.getDraftBody();
  const webContentSurfaceSnapshot = createWebContentSurfaceSnapshot(activeTab);

  return {
    groupId,
    tabs,
    dirtyDraftTabIds,
    activeTabId,
    activeTab,
    viewStateEntries,
    draftBody,
    webContentSurfaceSnapshot,
    editorPartProps: createEditorPartProps({
      state: {
        ui,
        viewPartProps,
        nativeHost,
        dialogService,
        groupId,
        tabs,
        dirtyDraftTabIds,
        activeTabId,
        activeTab,
        viewStateEntries,
      },
      actions,
    }),
  };
}

function areEditorPartControllerContextsEqual(
  previous: EditorPartControllerContext,
  next: EditorPartControllerContext,
) {
  return (
    previous.ui === next.ui &&
    previous.nativeHost === next.nativeHost &&
    previous.dialogService === next.dialogService &&
    previous.browserUrl === next.browserUrl &&
    previous.webUrl === next.webUrl &&
    previous.viewPartProps.browserUrl === next.viewPartProps.browserUrl &&
    (previous.viewPartProps.browserPageTitle ?? '') ===
      (next.viewPartProps.browserPageTitle ?? '') &&
    (previous.viewPartProps.browserFaviconUrl ?? '') ===
      (next.viewPartProps.browserFaviconUrl ?? '') &&
    Boolean(previous.viewPartProps.browserIsLoading) ===
      Boolean(next.viewPartProps.browserIsLoading) &&
    previous.viewPartProps.electronRuntime === next.viewPartProps.electronRuntime &&
    previous.viewPartProps.webContentRuntime === next.viewPartProps.webContentRuntime &&
    previous.viewPartProps.labels.emptyState === next.viewPartProps.labels.emptyState &&
    previous.viewPartProps.labels.contentUnavailable ===
      next.viewPartProps.labels.contentUnavailable
  );
}

export class EditorPartController {
  private context: EditorPartControllerContext;
  private readonly editorModel = createEditorModel();
  private readonly editorOpenService: EditorOpenService;
  private snapshot: EditorPartControllerSnapshot;
  private closeOperationQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<
    (reason: EditorPartChangeReason) => void
  >();
  private readonly actions: EditorPartActions;
  private readonly unsubscribeWritingModel: () => void;

  constructor(context: EditorPartControllerContext) {
    this.context = context;
    this.editorOpenService = createEditorOpenService(this.editorModel);
    this.actions = {
      onActivateTab: this.onActivateTab,
      onReorderTab: this.onReorderTab,
      onCloseTab: this.onCloseTab,
      onCloseOtherTabs: this.onCloseOtherTabs,
      onCloseAllTabs: this.onCloseAllTabs,
      onRenameTab: this.onRenameTab,
      onOpenEditor: this.openEditor,
      onPromptRenameBrowserFavorite: this.promptRenameBrowserFavorite,
      onPromptCreateBrowserFavoriteFolder: this.promptCreateBrowserFavoriteFolder,
      onDraftDocumentChange: this.setDraftDocument,
      onSetEditorViewState: this.setEditorViewState,
      onDeleteEditorViewState: this.deleteEditorViewState,
    };
    this.snapshot = createEditorPartControllerSnapshot(
      this.context,
      this.editorModel,
      this.actions,
    );
    this.unsubscribeWritingModel = this.editorModel.subscribe(() => {
      this.refreshSnapshot('model');
    });
  }

  readonly subscribe = (listener: (reason: EditorPartChangeReason) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: EditorPartControllerContext) => {
    if (areEditorPartControllerContextsEqual(this.context, context)) {
      return;
    }

    this.context = context;
    this.refreshSnapshot('context');
  };

  readonly dispose = () => {
    this.unsubscribeWritingModel();
    this.editorModel.dispose();
    this.listeners.clear();
  };

  readonly openEditor = (request: EditorOpenRequest) => {
    if (request.kind !== 'pdf' || request.url?.trim()) {
      return this.editorOpenService.open(request);
    }

    return this.resolveOpenEditorRequest(request).then((resolvedRequest) => {
      if (!resolvedRequest) {
        return {
          handled: false,
          activeTabId: null,
        };
      }

      return this.editorOpenService.open(resolvedRequest);
    });
  };

  readonly createDraftTab = () => {
    this.openEditor({
      kind: 'draft',
      disposition: 'reveal-or-open',
    });
  };

  readonly createBrowserTab = (url: string) => {
    if (!url.trim()) {
      return;
    }

    this.openEditor({
      kind: 'browser',
      disposition: 'reveal-or-open',
      url,
    });
  };

  readonly openBrowserUrlInNewTab = (url: string) => {
    if (!url.trim()) {
      return;
    }

    this.openEditor({
      kind: 'browser',
      disposition: 'new-tab',
      url,
    });
  };

  readonly openBrowserPane = () => {
    this.openEditor({
      kind: 'browser',
      disposition: 'reveal-or-open',
    });
  };
  readonly createPdfTab = (url: string) => {
    if (!url.trim()) {
      return;
    }

    void this.openEditor({
      kind: 'pdf',
      disposition: 'reveal-or-open',
      url,
    });
  };

  readonly canSaveActiveDraft = () => this.editorModel.canSaveActiveDraft();

  readonly saveActiveDraft = () => this.editorModel.saveActiveDraft();

  readonly updateActiveContentTabUrl = (
    url: string,
    options: {
      isLoading?: boolean;
    } = {},
  ) => {
    this.openEditor({
      kind: 'browser',
      disposition: 'current',
      url,
      options,
    });
  };

  readonly updateActiveBrowserTabPageTitle = (pageTitle: string) => {
    this.editorModel.updateActiveBrowserTabPageTitle(pageTitle);
  };
  readonly updateActiveBrowserTabFaviconUrl = (faviconUrl: string) => {
    this.editorModel.updateActiveBrowserTabFaviconUrl(faviconUrl);
  };

  readonly getDraftBody = () => this.editorModel.getDraftBody();
  readonly getDraftDocument = () => this.editorModel.getDraftDocument();
  readonly setDraftDocument = (value: WritingEditorDocument) => {
    this.editorModel.setDraftDocument(value);
  };
  readonly setEditorViewState = (
    key: EditorViewStateKey,
    state: unknown,
  ) => {
    this.editorModel.setEditorViewState(key, state);
  };
  readonly deleteEditorViewState = (key: EditorViewStateKey) => {
    this.editorModel.deleteEditorViewState(key);
  };

  readonly onActivateTab = (tabId: string) => {
    this.editorModel.activateTab(tabId);
  };

  readonly onReorderTab = (
    tabId: string,
    targetSlotIndex: number,
  ) => {
    this.editorModel.reorderTab(tabId, targetSlotIndex);
  };

  readonly onCloseTab = (tabId: string) =>
    this.enqueueCloseOperation(async () => {
      if (!this.hasTab(tabId)) {
        return false;
      }

      const didConfirm = await this.confirmCloseForTabIds([tabId]);
      if (!didConfirm) {
        return false;
      }

      const shouldKeepBrowserPane = this.shouldKeepBrowserPaneAfterClosingTab(tabId);
      this.editorModel.closeTab(tabId);
      if (shouldKeepBrowserPane) {
        this.openBrowserPane();
      }
      return true;
    });

  readonly onCloseOtherTabs = (tabId: string) =>
    this.enqueueCloseOperation(async () => {
      if (!this.hasTab(tabId)) {
        return false;
      }

      const tabsToClose = this.editorModel
        .getSnapshot()
        .tabs.filter((tab) => tab.id !== tabId)
        .map((tab) => tab.id);
      const didConfirm = await this.confirmCloseForTabIds(tabsToClose);
      if (!didConfirm) {
        return false;
      }

      this.editorModel.closeOtherTabs(tabId);
      return true;
    });

  readonly onCloseAllTabs = () =>
    this.enqueueCloseOperation(async () => {
      const tabsToClose = this.editorModel.getSnapshot().tabs.map((tab) => tab.id);
      const didConfirm = await this.confirmCloseForTabIds(tabsToClose);
      if (!didConfirm) {
        return false;
      }

      this.editorModel.closeAllTabs();
      return true;
    });

  readonly onRenameTab = async (tabId: string) => {
    const targetTab = this.editorModel
      .getSnapshot()
      .tabs.find((tab) => tab.id === tabId);
    if (!targetTab) {
      return;
    }

    const { ui } = this.context;
    const nextTitle =
      (await this.context.dialogService.input({
        title: ui.editorTabRenameTitle,
        message: ui.editorTabRenameLabel,
        value: targetTab.title.trim(),
        primaryButton: ui.editorModalConfirm,
        cancelButton: ui.editorModalCancel,
      })).value ?? '';
    if (!nextTitle) {
      return;
    }

    this.editorModel.renameTab(tabId, nextTitle);
  };

  readonly promptRenameBrowserFavorite = async ({
    title,
  }: {
    url: string;
    title: string;
  }) => {
    const { ui } = this.context;
    const nextTitle =
      (await this.context.dialogService.input({
        title: ui.editorFavoriteRenameTitle,
        message: ui.editorFavoriteRenameLabel,
        value: title.trim(),
        primaryButton: ui.editorModalConfirm,
        cancelButton: ui.editorModalCancel,
      })).value ?? '';
    return nextTitle.trim() || null;
  };

  readonly promptCreateBrowserFavoriteFolder = async ({
    title,
  }: {
    url: string;
    title: string;
  }) => {
    const { ui } = this.context;
    const nextFolderName =
      (await this.context.dialogService.input({
        title: ui.editorFavoriteNewFolderTitle,
        message: ui.editorFavoriteNewFolderLabel,
        value: '',
        placeholder: title.trim(),
        primaryButton: ui.editorModalConfirm,
        cancelButton: ui.editorModalCancel,
      })).value ?? '';
    return nextFolderName.trim() || null;
  };

  private readonly confirmCloseForTabIds = async (tabIds: readonly string[]) => {
    if (tabIds.length === 0) {
      return true;
    }

    const dirtyDraftTabIds = this.editorModel.getDirtyDraftTabIds(tabIds);
    if (dirtyDraftTabIds.length === 0) {
      return true;
    }

    const { ui } = this.context;
    const dirtyTabs = this.editorModel
      .getSnapshot()
      .tabs.filter(
        (tab): tab is Extract<EditorWorkspaceTab, { kind: 'draft' }> =>
          tab.kind === 'draft' && dirtyDraftTabIds.includes(tab.id),
      );
    const firstDirtyTitle =
      dirtyTabs[0]?.title.trim() || ui.editorDraftMode;
    const confirmation = await this.context.dialogService.prompt<'save' | 'discard'>({
      title: ui.editorUnsavedChangesTitle,
      message:
        dirtyDraftTabIds.length === 1
          ? ui.editorUnsavedChangesMessageSingle.replace('{title}', firstDirtyTitle)
          : ui.editorUnsavedChangesMessageMultiple.replace(
              '{count}',
              String(dirtyDraftTabIds.length),
            ),
      buttons: [
        {
          label: ui.editorUnsavedChangesSave,
          result: 'save',
          primary: true,
        },
        {
          label: ui.editorUnsavedChangesDiscard,
          result: 'discard',
        },
      ],
      cancelButton: ui.editorModalCancel,
    });

    switch (confirmation.result) {
      case 'save':
        for (const dirtyTabId of dirtyDraftTabIds) {
          this.editorModel.saveDraftTab(dirtyTabId);
        }
        return true;
      case 'discard':
        return true;
      default:
        return false;
    }
  };

  private hasTab(tabId: string) {
    return this.editorModel
      .getSnapshot()
      .tabs.some((tab) => tab.id === tabId);
  }

  private shouldKeepBrowserPaneAfterClosingTab(tabId: string) {
    const { tabs, activeTabId } = this.editorModel.getSnapshot();
    const closingTab = tabs.find((tab) => tab.id === tabId);
    if (!closingTab || closingTab.kind !== 'browser') {
      return false;
    }

    if (activeTabId !== tabId) {
      return false;
    }

    return !tabs.some(
      (tab) => tab.id !== tabId && tab.kind === 'browser',
    );
  }

  private enqueueCloseOperation<T>(operation: () => Promise<T>) {
    const scheduledOperation = this.closeOperationQueue.then(
      operation,
      operation,
    );
    this.closeOperationQueue = scheduledOperation.then(
      () => undefined,
      () => undefined,
    );
    return scheduledOperation;
  }

  private emitChange(reason: EditorPartChangeReason) {
    for (const listener of this.listeners) {
      listener(reason);
    }
  }

  private refreshSnapshot(reason: 'model' | 'context') {
    this.setSnapshot(
      createEditorPartControllerSnapshot(
        this.context,
        this.editorModel,
        this.actions,
      ),
      reason,
    );
  }

  private setSnapshot(
    nextSnapshot: EditorPartControllerSnapshot,
    reason: 'model' | 'context',
  ) {
    if (Object.is(this.snapshot, nextSnapshot)) {
      return;
    }

    const previousSnapshot = this.snapshot;
    this.snapshot = nextSnapshot;

    if (
      reason === 'model' &&
      createEditorPartStructureKey(previousSnapshot) ===
        createEditorPartStructureKey(nextSnapshot)
    ) {
      return;
    }

    this.emitChange(reason === 'context' ? 'context' : 'structure');
  }

  private readonly resolveOpenEditorRequest = async (
    request: EditorOpenRequest,
  ): Promise<EditorOpenRequest | null> => {
    if (request.kind !== 'pdf' || request.url?.trim()) {
      return request;
    }

    return request;
  };
}

export function createEditorPartController(
  context: EditorPartControllerContext,
) {
  return new EditorPartController(context);
}
