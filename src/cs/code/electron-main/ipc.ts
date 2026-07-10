/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import type {
  AppCommand,
  AppCommandPayloadMap,
  AppCommandResultMap,
  CancelDocumentTaskPayload,
  DeleteLibraryDocumentPayload,
  IndexDownloadedPdfPayload,
  LibraryDocumentStatusPayload,
  ListTranslationModelsPayload,
  ListLibraryDocumentsPayload,
  NativeOpenDialogOptions,
  NativeSaveDialogOptions,
  UpsertLibraryDocumentMetadataPayload,
  WebContentPdfDownloadPayload,
  WebContentHtmlArchivePayload,
  ReindexLibraryDocumentPayload,
  RagAnswerArticlesPayload,
  LoadTranslationCachePayload,
  SaveFetchedArticlesPayload,
  SaveSettingsPayload,
  SaveTranslationCachePayload,
  TestLlmConnectionPayload,
  TestRagConnectionPayload,
  TestTranslationConnectionPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  WebContentBounds,
  WebContentNavigatePayload,
  WebContentState,
} from 'cs/platform/browserView/common/browserView';
import { ipcBrowserViewChannelName } from 'cs/platform/browserView/common/browserView';
import { ipcBrowserViewGroupChannelName } from 'cs/platform/browserView/common/browserViewGroup';
import type { AppStorageService } from 'cs/code/electron-main/storageService';
import {
  captureWebContentScreenshot,
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
  releaseWebContentTarget,
  reloadWebContent,
  setWebContentBounds,
  setWebContentLayoutPhaseState,
  setWebContentRetentionLimit,
  setWebContentVisible,
  BrowserViewMainService,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import { BrowserViewGroupMainService } from 'cs/platform/browserView/electron-main/browserViewGroupMainService';
import {
  clearWorkbenchSharedSessionCache,
  clearWorkbenchSharedSessionCookies,
} from 'cs/platform/native/electron-main/sharedWebSession';
import { exportArticlesDocx } from 'cs/code/electron-main/document/docx';
import { exportEditorDocx } from 'cs/code/electron-main/document/editorDocx';
import { archiveWebContentHtml } from 'cs/code/electron-main/document/webContentHtmlArchive';
import { previewDownloadPdf } from 'cs/code/electron-main/pdf/pdf';
import { resolveActiveWebContentSnapshotHtml } from 'cs/code/electron-main/pdf/webContentSnapshot';
import { serializeAppError } from 'cs/base/parts/sandbox/common/appError';
import { AppCommandErrorCode, appCommandError } from 'cs/base/parts/sandbox/common/appCommandErrors';
import {
  pickDirectoryDialog,
  pickUserSettingsFileDialog,
  showOpenDialog,
  showSaveDialog,
} from 'cs/platform/dialogs/electron-main/dialogMainService';
import { testLlmConnection } from 'cs/code/electron-main/llm/llm';
import { runMainAgentTurn } from 'cs/code/electron-main/agent/agent';
import { answerQuestionFromArticles, testRagConnection } from 'cs/code/electron-main/rag/rag';
import { listTranslationModels, testTranslationConnection } from 'cs/code/electron-main/translation/translation';
import {
  applyMainWindowBackgroundMaterial,
  getMainWindow,
} from 'cs/platform/windows/electron-main/windows';
import { setMenuBarIconEnabled } from 'cs/platform/window/electron-main/trayIcon';
import { electronMainChannelServer } from 'cs/base/parts/ipc/electron-main/ipcMain';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { registerContextMenuListener } from 'cs/base/parts/contextmenu/electron-main/contextmenu';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import {
	NativeHostMainChannel,
} from 'cs/platform/native/electron-main/nativeHostMainService';
import type { NativeHostMainService } from 'cs/platform/native/electron-main/nativeHostMainService';
import type { IThemeMainService } from 'cs/platform/theme/electron-main/themeMainService';
import { SharedProcess } from 'cs/platform/sharedProcess/electron-main/sharedProcess';
const DOCUMENT_TRANSLATION_PROGRESS_CHANNEL = 'app:document-translation-progress';
type AppInvokeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

const documentTaskAbortControllers = new Map<string, AbortController>();
const browserViewIpcDisposables = new DisposableStore();
const browserViewMainService = browserViewIpcDisposables.add(
  new BrowserViewMainService(),
);
const browserViewGroupMainService = browserViewIpcDisposables.add(
  new BrowserViewGroupMainService(browserViewMainService),
);
const sharedProcess = new SharedProcess();
const sharedProcessWindowCleanup = new Set<number>();

let micaMaterialTimeout: ReturnType<typeof setTimeout> | null = null;

function getSharedProcessWindowId(event: IpcMainInvokeEvent): number {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (!window) {
		throw new Error('Shared process request did not originate from a workbench window.');
	}
	if (!sharedProcessWindowCleanup.has(window.id)) {
		sharedProcessWindowCleanup.add(window.id);
		event.sender.once('destroyed', () => {
			sharedProcessWindowCleanup.delete(window.id);
			void sharedProcess.getChannel('playwright').call('disposeWindow', [window.id, undefined]);
		});
	}
	return window.id;
}

function getDocumentTaskId(payload: { taskId?: string } | undefined) {
  return typeof payload?.taskId === 'string' ? payload.taskId.trim() : '';
}

function startDocumentTaskAbortController(payload: { taskId?: string } | undefined) {
  const taskId = getDocumentTaskId(payload);
  if (!taskId) {
    return null;
  }

  const abortController = new AbortController();
  documentTaskAbortControllers.set(taskId, abortController);
  return {
    taskId,
    abortController,
    dispose: () => {
      if (documentTaskAbortControllers.get(taskId) === abortController) {
        documentTaskAbortControllers.delete(taskId);
      }
    },
  };
}

function cancelDocumentTask(payload: CancelDocumentTaskPayload | undefined) {
  const taskId = getDocumentTaskId(payload);
  if (!taskId) {
    return false;
  }

  const abortController = documentTaskAbortControllers.get(taskId);
  if (!abortController) {
    return false;
  }

  abortController.abort();
  documentTaskAbortControllers.delete(taskId);
  return true;
}

async function invokeCommand<TCommand extends AppCommand>(
  command: TCommand,
  payload: AppCommandPayloadMap[TCommand],
  storage: AppStorageService,
  nativeHostMainService: NativeHostMainService,
  themeMainService: IThemeMainService,
  emitToRenderer?: (channel: string, payload: unknown) => void,
): Promise<AppCommandResultMap[TCommand]> {
  switch (command) {
    case 'clear_web_cache':
      return clearWorkbenchSharedSessionCache() as Promise<AppCommandResultMap[TCommand]>;
    case 'clear_web_cookies':
      return clearWorkbenchSharedSessionCookies() as Promise<AppCommandResultMap[TCommand]>;
    case 'load_settings': {
      const loaded = await storage.loadSettings();
      return loaded as AppCommandResultMap[TCommand];
    }
    case 'save_settings':
      {
        const saved = await storage.saveSettings((payload as SaveSettingsPayload)?.settings ?? {});
        themeMainService.updateSettings(saved);
        setMenuBarIconEnabled(saved.menuBarIconEnabled);
        if (micaMaterialTimeout) {
          clearTimeout(micaMaterialTimeout);
          micaMaterialTimeout = null;
        }
        if (saved.useMica) {
          applyMainWindowBackgroundMaterial(true, themeMainService.getBackgroundColor());
        } else {
          micaMaterialTimeout = setTimeout(() => {
            applyMainWindowBackgroundMaterial(false, themeMainService.getBackgroundColor());
            micaMaterialTimeout = null;
          }, 300);
        }
        return saved as AppCommandResultMap[TCommand];
      }
    case 'save_fetched_articles':
      await storage.saveFetchedArticles((payload as SaveFetchedArticlesPayload)?.items ?? []);
      return undefined as AppCommandResultMap[TCommand];
    case 'load_translation_cache':
      return await storage.loadTranslationCache(
        (payload as LoadTranslationCachePayload)?.keys ?? [],
      ) as AppCommandResultMap[TCommand];
    case 'save_translation_cache':
      await storage.saveTranslationCache(
        (payload as SaveTranslationCachePayload)?.entries ?? [],
      );
      return undefined as AppCommandResultMap[TCommand];
    case 'test_llm_connection':
      return testLlmConnection(
        payload as TestLlmConnectionPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'test_translation_connection':
      return testTranslationConnection(
        payload as TestTranslationConnectionPayload,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'list_translation_models':
      return listTranslationModels(
        payload as ListTranslationModelsPayload,
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
        (payload as import('cs/base/parts/sandbox/common/sandboxTypes').PickUserSettingsFilePayload)?.defaultPath,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'pick_pdf_file':
      return nativeHostMainService.pickPdfFile(
        getMainWindow(),
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'show_open_dialog':
      return showOpenDialog(
        payload as NativeOpenDialogOptions,
        getMainWindow(),
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'show_save_dialog':
      return showSaveDialog(
        payload as NativeSaveDialogOptions,
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
      const downloadPayload = payload as WebContentPdfDownloadPayload;
      const taskAbortController = startDocumentTaskAbortController(downloadPayload);
      try {
				const previewHtml = await resolveActiveWebContentSnapshotHtml(downloadPayload);
        const downloadResult = await previewDownloadPdf(
          downloadPayload,
          app.getPath('downloads'),
          previewHtml,
          taskAbortController?.abortController.signal,
        );

        try {
          const settings = await storage.loadSettings();
          if (settings.knowledgeBase.enabled && settings.knowledgeBase.autoIndexDownloadedPdf) {
            const registration = await storage.registerLibraryDocument({
              ...downloadPayload,
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
      } finally {
        taskAbortController?.dispose();
      }
    }
    case 'web_content_archive_html':
      return archiveWebContentHtml(
        payload as WebContentHtmlArchivePayload,
        app.getPath('downloads'),
        storage,
      ) as Promise<AppCommandResultMap[TCommand]>;
    case 'cancel_document_task':
      return cancelDocumentTask(
        payload as CancelDocumentTaskPayload,
      ) as AppCommandResultMap[TCommand];
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
          throw appCommandError(AppCommandErrorCode.MainWindowUnavailable);
        }
        const exportPayload = payload as AppCommandPayloadMap['export_articles_docx'];
        const taskAbortController = startDocumentTaskAbortController(exportPayload);
        try {
          return await exportArticlesDocx(
            exportPayload,
            app.getPath('downloads'),
            storage,
            mainWindow,
            {
              signal: taskAbortController?.abortController.signal,
              onTranslationProgress: (progress) => {
                emitToRenderer?.(DOCUMENT_TRANSLATION_PROGRESS_CHANNEL, progress);
              },
            },
          ) as AppCommandResultMap[TCommand];
        } finally {
          taskAbortController?.dispose();
        }
      }
    case 'export_editor_docx':
      {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
          throw appCommandError(AppCommandErrorCode.MainWindowUnavailable);
        }
        return exportEditorDocx(
          payload as AppCommandPayloadMap['export_editor_docx'],
          app.getPath('downloads'),
          mainWindow,
        ) as Promise<AppCommandResultMap[TCommand]>;
      }
    default:
      throw appCommandError(AppCommandErrorCode.UnknownCommand, { command });
  }
}

export function registerAppIpc(
  storage: AppStorageService,
  nativeHostMainService: NativeHostMainService,
  themeMainService: IThemeMainService,
) {
  electronMainChannelServer.register();
	const sharedProcessMainChannels = new Map<string, IServerChannel<string>>([
		[ipcBrowserViewChannelName, ProxyChannel.fromService<string>(browserViewMainService, browserViewIpcDisposables)],
		[ipcBrowserViewGroupChannelName, ProxyChannel.fromService<string>(browserViewGroupMainService, browserViewIpcDisposables)],
	]);
	void sharedProcess.start(sharedProcessMainChannels).catch(error => {
		console.error('Shared process failed to start.', error);
	});
  electronMainChannelServer.registerChannel(
    ipcBrowserViewChannelName,
    ProxyChannel.fromService(browserViewMainService, browserViewIpcDisposables),
  );
  electronMainChannelServer.registerChannel(
    ipcBrowserViewGroupChannelName,
    ProxyChannel.fromService(browserViewGroupMainService, browserViewIpcDisposables),
  );
	electronMainChannelServer.registerChannel('playwright', {
		call: (event, command, arg, cancellationToken) => {
			const windowId = getSharedProcessWindowId(event);
			return sharedProcess.getChannel('playwright').call(command, [windowId, arg], cancellationToken);
		},
		listen: (event, eventName, arg) => {
			const windowId = getSharedProcessWindowId(event);
			return sharedProcess.getChannel('playwright').listen(eventName, [windowId, arg]);
		},
	} satisfies IServerChannel<IpcMainInvokeEvent>);
	electronMainChannelServer.registerChannel('networkFilter', {
		call: (_event, command, arg, cancellationToken) =>
			sharedProcess.getChannel('networkFilter').call(command, arg, cancellationToken),
		listen: () => {
			throw new Error('Shared network filter does not expose events.');
		},
	} satisfies IServerChannel<IpcMainInvokeEvent>);
  app.once('before-quit', () => {
    browserViewIpcDisposables.dispose();
		sharedProcess.dispose();
  });
  registerContextMenuListener();
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
        nativeHostMainService,
        themeMainService,
        (channel, eventPayload) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channel, eventPayload);
          }
        },
      ) as T;
    },
    listen() {
      throw appCommandError(AppCommandErrorCode.UnknownCommand, {
        command: 'app channel events are exposed through nativeHostService today',
      });
    },
  } satisfies IServerChannel<IpcMainInvokeEvent>);

  ipcMain.handle('app:invoke', async (_event, command: AppCommand, payload: AppCommandPayloadMap[AppCommand]) => {
    try {
      return {
        ok: true,
        result: await invokeCommand(
          command,
          payload,
          storage,
          nativeHostMainService,
          themeMainService,
          (channel, eventPayload) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send(channel, eventPayload);
            }
          },
        ),
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

  ipcMain.handle('app:web-content-capture-screenshot', async (_event, payload?: { targetId?: string | null }) => {
    return await captureWebContentScreenshot(payload?.targetId);
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

  ipcMain.on('app:web-content-set-retention-limit', (_event, limit) => {
    setWebContentRetentionLimit(limit);
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
