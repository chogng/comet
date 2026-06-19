import { shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type {
  OpenArticleDetailsModalPayload,
  OpenPathPayload,
  ReadPdfFilePayload,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { appError } from 'ls/base/common/errors';
import type { Event } from 'ls/base/common/event';
import type { IServerChannel } from 'ls/platform/ipc/common/ipc';
import { pickPdfFileDialog } from 'ls/platform/dialogs/electron-main/dialogMainService';
import {
  getMainWindow,
  resolveWindowFromWebContents,
} from 'ls/platform/window/electron-main/window';
import { openArticleDetailsModal as openArticleDetailsModalWindow } from 'ls/platform/window/electron-main/articleDetailsWindow';

function resolvePdfFilePath(payload: ReadPdfFilePayload = {}) {
  const rawPath = payload.path?.trim();
  if (rawPath) {
    return rawPath;
  }

  const rawUrl = payload.url?.trim();
  if (!rawUrl) {
    throw appError('UNKNOWN_ERROR', { message: 'PDF path is required.' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw appError('UNKNOWN_ERROR', { message: 'PDF URL is invalid.' });
  }

  if (parsedUrl.protocol !== 'file:') {
    throw appError('URL_PROTOCOL_UNSUPPORTED', { url: rawUrl });
  }

  return fileURLToPath(parsedUrl);
}

export class NativeHostMainService {
  async pickPdfFile(parentWindow: BrowserWindow | null = getMainWindow()) {
    return pickPdfFileDialog(parentWindow);
  }

  async readPdfFile(payload: ReadPdfFilePayload = {}) {
    const filePath = resolvePdfFilePath(payload);
    if (!/\.pdf$/i.test(filePath)) {
      throw appError('UNKNOWN_ERROR', { message: 'Only PDF files can be previewed.' });
    }

    const buffer = await readFile(filePath);
    return {
      filePath,
      data: new Uint8Array(buffer),
    };
  }

  async openPath(payload: OpenPathPayload = {}) {
    const targetPath = payload.path?.trim();
    if (!targetPath) {
      throw appError('UNKNOWN_ERROR', { message: 'Path is required.' });
    }

    const openError = await shell.openPath(targetPath);
    if (openError) {
      shell.showItemInFolder(targetPath);
    }

    return true;
  }

  async openArticleDetailsModal(
    parentWindow: BrowserWindow | null,
    payload: OpenArticleDetailsModalPayload = {},
  ) {
    const targetWindow = parentWindow ?? getMainWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw appError('MAIN_WINDOW_UNAVAILABLE');
    }

    return openArticleDetailsModalWindow(targetWindow, payload);
  }

  async openArticleDetailsModalForEvent(
    event: IpcMainInvokeEvent,
    payload: OpenArticleDetailsModalPayload = {},
  ) {
    return this.openArticleDetailsModal(
      resolveWindowFromWebContents(event.sender),
      payload,
    );
  }
}

export class NativeHostMainChannel implements IServerChannel<IpcMainInvokeEvent> {
  constructor(private readonly service: NativeHostMainService) {}

  call<T = unknown>(
    event: IpcMainInvokeEvent,
    command: string,
    payload?: unknown,
  ): Promise<T> {
    switch (command) {
      case 'pick_pdf_file':
        return this.service.pickPdfFile(
          resolveWindowFromWebContents(event.sender),
        ) as Promise<T>;
      case 'read_pdf_file':
        return this.service.readPdfFile(payload as ReadPdfFilePayload) as Promise<T>;
      case 'open_path':
        return this.service.openPath(payload as OpenPathPayload) as Promise<T>;
      case 'open_article_details_modal':
        return this.service.openArticleDetailsModalForEvent(
          event,
          payload as OpenArticleDetailsModalPayload,
        ) as Promise<T>;
      default:
        throw appError('UNKNOWN_COMMAND', { command });
    }
  }

  listen<T = unknown>(): Event<T> {
    throw appError('UNKNOWN_COMMAND', {
      command: 'native host main channel does not expose events',
    });
  }
}

export const nativeHostMainService = new NativeHostMainService();
