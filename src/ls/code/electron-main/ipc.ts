import { Notification, app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import type {
  AppCommand,
  AppCommandPayloadMap,
  AppCommandResultMap,
  AppSettings,
  DeleteLibraryDocumentPayload,
  FetchArticlePayload,
  FetchLatestArticlesPayload,
  IndexDownloadedPdfPayload,
  LibraryDocumentStatusPayload,
  ListLibraryDocumentsPayload,
  NativeToastOptions,
  UpsertLibraryDocumentMetadataPayload,
  WebContentPdfDownloadPayload,
  WebContentBounds,
  WebContentHtmlArchivePayload,
  WebContentBridgeResponse,
  WebContentNavigatePayload,
  WebContentState,
  ReindexLibraryDocumentPayload,
  RagAnswerArticlesPayload,
  SaveSettingsPayload,
  TestLlmConnectionPayload,
  TestRagConnectionPayload,
  TestTranslationConnectionPayload,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { StorageService } from 'ls/platform/storage/common/storage';
import {
  getWebContentState,
  clearWebContentHistory,
  disposeWebContentTarget,
  executeWebContentTargetScript,
  getWebContentSelection,
  activateWebContentTarget,
  goBackWebContent,
  goForwardWebContent,
  hardReloadWebContent,
  navigateWebContentTarget,
  reportWebContentState,
  reportWebContentRendererReady,
  releaseWebContentTarget,
  reloadWebContent,
  resolveWebContentBridgeResponse,
  setWebContentBounds,
  setWebContentLayoutPhaseState,
  setWebContentVisible,
} from 'ls/platform/window/electron-main/webContentView';
import {
  clearWorkbenchSharedSessionCache,
  clearWorkbenchSharedSessionCookies,
} from 'ls/platform/native/electron-main/sharedWebSession';
import {
  dismissToast,
  getToastState,
  reportToastLayout,
  setToastHovering,
  showToast,
} from 'ls/platform/window/electron-main/toastOverlayView';
import {
  fetchArticle,
  fetchLatestArticles,
} from 'ls/code/electron-main/fetch/dispatch';
import { exportArticlesDocx } from 'ls/code/electron-main/document/docx';
import { exportEditorDocx } from 'ls/code/electron-main/document/editorDocx';
import { archiveWebContentHtml } from 'ls/code/electron-main/document/webContentHtmlArchive';
import { normalizeFetchStrategy, shouldPrepareWebContentArtifacts } from 'ls/code/electron-main/fetch/fetchStrategy';
import type { WebContentExtractionSnapshot, WebContentSnapshot } from 'ls/code/electron-main/fetch/fetchStrategy';

import { resolveBatchWebContentExtractions, resolveBatchWebContentSnapshots, resolveWebContentSnapshotHtml } from 'ls/code/electron-main/fetch/webContentChannel';
import { previewDownloadPdf } from 'ls/code/electron-main/pdf/pdf';
import { appError, serializeAppError } from 'ls/base/common/errors';
import {
  pickDirectoryDialog,
  pickUserSettingsFileDialog,
} from 'ls/platform/dialogs/electron-main/dialogMainService';
import { testLlmConnection } from 'ls/code/electron-main/llm/llm';
import { runMainAgentTurn } from 'ls/code/electron-main/agent/agent';
import { answerQuestionFromArticles, testRagConnection } from 'ls/code/electron-main/rag/rag';
import { testTranslationConnection } from 'ls/code/electron-main/translation/translation';
import { resolveSystemNotificationPayloadFromToast } from 'ls/code/electron-main/notificationRouting';
import {
  applyMainWindowBackgroundMaterial,
  getMainWindow,
  resolveWindowFromWebContents,
} from 'ls/platform/window/electron-main/window';
import { setMenuBarIconEnabled } from 'ls/platform/window/electron-main/trayIcon';
import { electronMainChannelServer } from 'ls/code/electron-main/ipcChannelServer';
import type { IServerChannel } from 'ls/platform/ipc/common/ipc';
import {
  NativeHostMainChannel,
  nativeHostMainService,
} from 'ls/platform/native/electron-main/nativeHostMainService';
const FETCH_STATUS_CHANNEL = 'app:fetch-status';
const DOCUMENT_TRANSLATION_PROGRESS_CHANNEL = 'app:document-translation-progress';
type AppInvokeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

let micaMaterialTimeout: ReturnType<typeof setTimeout> | null = null;
let cachedSettings: AppSettings | null = null;

function showSystemNotificationFromToast(options: NativeToastOptions, settings: AppSettings) {
  const payload = resolveSystemNotificationPayloadFromToast(options, settings);
  if (!payload || !Notification.isSupported()) {
    return;
  }

  new Notification({
    title: payload.title,
    body: payload.body,
  }).show();
}

async function loadSettingsWithCache(storage: StorageService) {
  if (cachedSettings) {
    return cachedSettings;
  }

  const loaded = await storage.loadSettings();
  cachedSettings = loaded;
  return loaded;
}

async function invokeCommand<TCommand extends AppCommand>(
  command: TCommand,
  payload: AppCommandPayloadMap[TCommand],
  storage: StorageService,
  emitToRenderer?: (channel: string, payload: unknown) => void,
): Promise<AppCommandResultMap[TCommand]> {
  switch (command) {
    case 'fetch_article':
      return fetchArticle((payload as FetchArticlePayload)?.url, storage) as Promise<AppCommandResultMap[TCommand]>;
    case 'fetch_latest_articles':
      {
        const fetchLatestPayload = payload as FetchLatestArticlesPayload;
        const fetchStrategy = normalizeFetchStrategy(fetchLatestPayload.fetchStrategy ?? 'web-content-first');
        const previewExtractions = shouldPrepareWebContentArtifacts(fetchStrategy)
          ? await resolveBatchWebContentExtractions(fetchLatestPayload)
          : new Map<string, WebContentExtractionSnapshot>();
        const previewSnapshots =
          shouldPrepareWebContentArtifacts(fetchStrategy)
            ? (previewExtractions.size > 0
              ? new Map<string, WebContentSnapshot>()
              : await resolveBatchWebContentSnapshots(fetchLatestPayload))
            : new Map<string, WebContentSnapshot>();
        return fetchLatestArticles(
          fetchLatestPayload,
          storage,
          {
            previewExtractions,
            previewSnapshots,
            fetchStrategy,
            onFetchStatus: (status) => {
              emitToRenderer?.(FETCH_STATUS_CHANNEL, status);
            },
          },
        ) as Promise<AppCommandResultMap[TCommand]>;
      }
    case 'clear_web_cache':
      return clearWorkbenchSharedSessionCache() as Promise<AppCommandResultMap[TCommand]>;
    case 'clear_web_cookies':
      return clearWorkbenchSharedSessionCookies() as Promise<AppCommandResultMap[TCommand]>;
    case 'load_settings': {
      const loaded = await storage.loadSettings();
      cachedSettings = loaded;
      return loaded as AppCommandResultMap[TCommand];
    }
    case 'save_settings':
      {
        const saved = await storage.saveSettings((payload as SaveSettingsPayload)?.settings ?? {});
        cachedSettings = saved;
        setMenuBarIconEnabled(saved.menuBarIconEnabled);
        if (micaMaterialTimeout) {
          clearTimeout(micaMaterialTimeout);
          micaMaterialTimeout = null;
        }
        if (saved.useMica) {
          applyMainWindowBackgroundMaterial(true);
        } else {
          micaMaterialTimeout = setTimeout(() => {
            applyMainWindowBackgroundMaterial(false);
            micaMaterialTimeout = null;
          }, 300);
        }
        return saved as AppCommandResultMap[TCommand];
      }
    case 'test_llm_connection':
      return testLlmConnection(
        payload as TestLlmConnectionPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'test_translation_connection':
      return testTranslationConnection(
        payload as TestTranslationConnectionPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'test_rag_connection':
      return testRagConnection(
        payload as TestRagConnectionPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'pick_download_directory':
      return pickDirectoryDialog(getMainWindow()) as Promise<AppCommandResultMap[TCommand]>;
    case 'pick_user_settings_file':
      return pickUserSettingsFileDialog(
        getMainWindow(),
        (payload as import('ls/base/parts/sandbox/common/desktopTypes').PickUserSettingsFilePayload)?.defaultPath,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'pick_pdf_file':
      return nativeHostMainService.pickPdfFile(
        getMainWindow(),
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'read_pdf_file':
      return nativeHostMainService.readPdfFile(
        payload as AppCommandPayloadMap['read_pdf_file'],
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'open_path':
      return nativeHostMainService.openPath(
        payload as AppCommandPayloadMap['open_path'],
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'web_content_download_pdf': {
      const previewHtml = await resolveWebContentSnapshotHtml(payload as WebContentPdfDownloadPayload);
      const downloadResult = await previewDownloadPdf(
        payload as WebContentPdfDownloadPayload,
        app.getPath('downloads'),
        previewHtml,
      );

      try {
        const settings = await storage.loadSettings();
        if (settings.knowledgeBase.enabled && settings.knowledgeBase.autoIndexDownloadedPdf) {
          const registration = await storage.registerLibraryDocument({
            ...(payload as WebContentPdfDownloadPayload),
            filePath: downloadResult.filePath,
            sourceUrl: downloadResult.sourceUrl,
          });
          return {
            ...downloadResult,
            libraryRegistration: registration,
          } as AppCommandResultMap[TCommand];
        }
      } catch (registrationError) {
        console.error('Failed to auto-register downloaded PDF in the library.', registrationError);
      }

      return {
        ...downloadResult,
        libraryRegistration: null,
      } as AppCommandResultMap[TCommand];
    }
    case 'web_content_archive_html':
      return archiveWebContentHtml(
        payload as WebContentHtmlArchivePayload,
        app.getPath('downloads'),
        storage,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'index_downloaded_pdf':
      return storage.registerLibraryDocument(
        payload as IndexDownloadedPdfPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'upsert_library_document_metadata':
      return storage.upsertLibraryDocumentMetadata(
        payload as UpsertLibraryDocumentMetadataPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'delete_library_document':
      return storage.deleteLibraryDocument(
        payload as DeleteLibraryDocumentPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'get_library_document_status':
      return storage.getLibraryDocumentStatus(
        payload as LibraryDocumentStatusPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'list_library_documents':
      return storage.listLibraryDocuments(
        payload as ListLibraryDocumentsPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'reindex_library_document':
      return storage.reindexLibraryDocument(
        payload as ReindexLibraryDocumentPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'rag_answer_articles':
      return answerQuestionFromArticles(
        payload as RagAnswerArticlesPayload,
        await storage.loadSettings(),
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'run_main_agent_turn':
      return runMainAgentTurn(
        payload as AppCommandPayloadMap['run_main_agent_turn'],
        await storage.loadSettings(),
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'export_articles_docx':
      {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
          throw appError('MAIN_WINDOW_UNAVAILABLE');
        }
        return exportArticlesDocx(
          payload as AppCommandPayloadMap['export_articles_docx'],
          app.getPath('downloads'),
          storage,
          mainWindow,
          {
            onTranslationProgress: (progress) => {
              emitToRenderer?.(DOCUMENT_TRANSLATION_PROGRESS_CHANNEL, progress);
            },
          },
        ) as Promise<AppCommandResultMap[TCommand]>;
      }
    case 'export_editor_docx':
      {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
          throw appError('MAIN_WINDOW_UNAVAILABLE');
        }
        return exportEditorDocx(
          payload as AppCommandPayloadMap['export_editor_docx'],
          app.getPath('downloads'),
          mainWindow,
        ) as Promise<AppCommandResultMap[TCommand]>;
      }
    default:
      throw appError('UNKNOWN_COMMAND', { command });
  }
}

export function registerAppIpc(storage: StorageService) {
  electronMainChannelServer.register();
  try {
    electronMainChannelServer.registerChannel(
      'nativeHost',
      new NativeHostMainChannel(nativeHostMainService),
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== `IPC channel 'nativeHost' is already registered.`
    ) {
      throw error;
    }
  }

  electronMainChannelServer.registerChannel('app', {
    async call<T = unknown>(event: IpcMainInvokeEvent, command: string, payload?: unknown) {
      const appCommand = command as AppCommand;
      return await invokeCommand(
        appCommand,
        payload as AppCommandPayloadMap[AppCommand],
        storage,
        (channel, eventPayload) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channel, eventPayload);
          }
        },
      ) as T;
    },
    listen() {
      throw appError('UNKNOWN_COMMAND', {
        command: 'app channel events are exposed through nativeHostService today',
      });
    },
  } satisfies IServerChannel<IpcMainInvokeEvent>);

  ipcMain.handle('app:invoke', async (_event, command: AppCommand, payload: AppCommandPayloadMap[AppCommand]) => {
    try {
      return {
        ok: true,
        result: await invokeCommand(command, payload, storage, (channel, eventPayload) => {
          if (!_event.sender.isDestroyed()) {
            _event.sender.send(channel, eventPayload);
          }
        }),
      } satisfies AppInvokeResponse<AppCommandResultMap[typeof command]>;
    } catch (error) {
      return {
        ok: false,
        error: serializeAppError(error),
      } satisfies AppInvokeResponse<AppCommandResultMap[typeof command]>;
    }
  });

  ipcMain.handle('app:web-content-get-state', (_event, payload?: { targetId?: string | null }) => {
    const state: WebContentState = getWebContentState(payload?.targetId);
    return state;
  });

  ipcMain.handle(
    'app:web-content-execute-javascript',
    async (
      _event,
      payload?: {
        targetId?: string | null;
        script?: string;
        timeoutMs?: number;
      },
    ) => {
      if (typeof payload?.script !== 'string' || !payload.script.trim()) {
        return null;
      }

      return await executeWebContentTargetScript(
        payload.targetId,
        payload.script,
        {
          timeoutMs: payload.timeoutMs,
        },
      );
    },
  );

  ipcMain.handle('app:web-content-get-selection', async (_event, payload?: { targetId?: string | null }) => {
    return await getWebContentSelection(payload?.targetId);
  });

  ipcMain.on('app:web-content-report-state', (event, state: WebContentState) => {
    if (event.sender.isDestroyed()) {
      return;
    }

    reportWebContentState(state);
    event.sender.send('app:web-content-state', state);
  });

  ipcMain.on('app:web-content-bridge-ready', (event) => {
    if (event.sender.isDestroyed()) {
      return;
    }

    reportWebContentRendererReady(event.sender);
  });

  ipcMain.on('app:web-content-bridge-response', (event, response: WebContentBridgeResponse) => {
    if (event.sender.isDestroyed()) {
      return;
    }

    resolveWebContentBridgeResponse(event.sender, response);
  });

  ipcMain.on('app:native-toast-show', (event, options: NativeToastOptions) => {
    showToast(resolveWindowFromWebContents(event.sender), options);
    void loadSettingsWithCache(storage)
      .then((settings) => {
        showSystemNotificationFromToast(options, settings);
      })
      .catch((error) => {
        console.error('Failed to resolve settings for system notification.', error);
      });
  });

  ipcMain.on('app:native-toast-dismiss', (_event, id: number) => {
    dismissToast(id);
  });

  ipcMain.handle('app:native-toast-get-state', () => {
    return getToastState();
  });

  ipcMain.on('app:native-toast-layout', (event, layout) => {
    reportToastLayout(event.sender.id, layout);
  });

  ipcMain.on('app:native-toast-hover', (_event, hovering: boolean) => {
    setToastHovering(hovering);
  });

  ipcMain.on('app:web-content-activate', (_event, payload?: { targetId?: string | null }) => {
    activateWebContentTarget(payload?.targetId);
  });

  ipcMain.on('app:web-content-release', (_event, payload?: { targetId?: string | null }) => {
    releaseWebContentTarget(payload?.targetId);
  });

  ipcMain.on('app:web-content-dispose', (_event, payload?: { targetId?: string | null }) => {
    disposeWebContentTarget(payload?.targetId);
  });

  ipcMain.handle('app:web-content-navigate', async (_event, payload: WebContentNavigatePayload) => {
    try {
      await navigateWebContentTarget(payload.url, payload.targetId, payload.mode);
      return getWebContentState(payload.targetId);
    } catch (error) {
      throw new Error(serializeAppError(error));
    }
  });

  ipcMain.on('app:web-content-set-bounds', (_event, bounds: WebContentBounds | null) => {
    setWebContentBounds(bounds);
  });

  ipcMain.on('app:web-content-set-visible', (_event, visible: boolean) => {
    setWebContentVisible(Boolean(visible));
  });

  ipcMain.on('app:web-content-set-layout-phase', (_event, phase) => {
    if (phase === 'measuring' || phase === 'visible' || phase === 'hidden') {
      setWebContentLayoutPhaseState(phase);
    }
  });

  ipcMain.on('app:web-content-reload', (_event, payload?: { targetId?: string | null }) => {
    reloadWebContent(payload?.targetId);
  });

  ipcMain.on('app:web-content-hard-reload', (_event, payload?: { targetId?: string | null }) => {
    hardReloadWebContent(payload?.targetId);
  });

  ipcMain.on('app:web-content-clear-history', (_event, payload?: { targetId?: string | null }) => {
    clearWebContentHistory(payload?.targetId);
  });

  ipcMain.on('app:web-content-go-back', (_event, payload?: { targetId?: string | null }) => {
    goBackWebContent(payload?.targetId);
  });

  ipcMain.on('app:web-content-go-forward', (_event, payload?: { targetId?: string | null }) => {
    goForwardWebContent(payload?.targetId);
  });
}
