import { shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type {
  PartsSplash,
} from 'ls/platform/theme/common/theme';
import type {
  OpenPathPayload,
  ReadPdfFilePayload,
  WindowControlAction,
  WindowState,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'ls/base/common/errors';
import type { Event } from 'ls/base/common/event';
import { toDisposable } from 'ls/base/common/lifecycle';
import type { IServerChannel } from 'ls/base/parts/ipc/common/ipc';
import { pickPdfFileDialog } from 'ls/platform/dialogs/electron-main/dialogMainService';
import {
  getWindowState,
  getMainWindow,
  resolveWindowFromWebContents,
} from 'ls/platform/window/electron-main/window';
import type { IThemeMainService } from 'ls/platform/theme/electron-main/themeMainService';

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
  constructor(private readonly themeMainService: IThemeMainService) {}

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

  async performWindowControlActionForEvent(
    event: IpcMainInvokeEvent,
    action: WindowControlAction,
  ) {
    const targetWindow = resolveWindowFromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }

    switch (action) {
      case 'minimize':
        targetWindow.minimize();
        break;
      case 'maximize':
        targetWindow.maximize();
        break;
      case 'unmaximize':
        targetWindow.unmaximize();
        break;
      case 'toggle-maximize':
        if (targetWindow.isMaximized()) {
          targetWindow.unmaximize();
        } else {
          targetWindow.maximize();
        }
        break;
      case 'close':
        targetWindow.close();
        break;
      default:
        break;
    }
  }

  async getWindowStateForEvent(event: IpcMainInvokeEvent) {
    return getWindowState(resolveWindowFromWebContents(event.sender));
  }

  onDidChangeWindowStateForEvent(event: IpcMainInvokeEvent): Event<WindowState> {
    const targetWindow = resolveWindowFromWebContents(event.sender);
    return (listener) => {
      if (!targetWindow || targetWindow.isDestroyed()) {
        return toDisposable(() => {});
      }

      const emitWindowState = () => {
        listener(getWindowState(targetWindow));
      };

      targetWindow.on('maximize', emitWindowState);
      targetWindow.on('unmaximize', emitWindowState);
      targetWindow.on('enter-full-screen', emitWindowState);
      targetWindow.on('leave-full-screen', emitWindowState);

      return toDisposable(() => {
        if (targetWindow.isDestroyed()) {
          return;
        }

        targetWindow.off('maximize', emitWindowState);
        targetWindow.off('unmaximize', emitWindowState);
        targetWindow.off('enter-full-screen', emitWindowState);
        targetWindow.off('leave-full-screen', emitWindowState);
      });
    };
  }

  async saveWindowSplashForEvent(
    event: IpcMainInvokeEvent,
    splash: PartsSplash,
  ) {
    this.themeMainService.saveWindowSplash(
      resolveWindowFromWebContents(event.sender)?.id,
      splash,
    );
  }

  async getOSColorScheme() {
    return this.themeMainService.getColorScheme();
  }

  onDidChangeColorScheme(): Event<ReturnType<IThemeMainService['getColorScheme']>> {
    return this.themeMainService.onDidChangeColorScheme;
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
      case 'perform_window_control':
        return this.service.performWindowControlActionForEvent(
          event,
          payload as WindowControlAction,
        ) as Promise<T>;
      case 'get_window_state':
        return this.service.getWindowStateForEvent(event) as Promise<T>;
      case 'save_window_splash':
        return this.service.saveWindowSplashForEvent(
          event,
          payload as PartsSplash,
        ) as Promise<T>;
      case 'get_os_color_scheme':
        return this.service.getOSColorScheme() as Promise<T>;
      default:
        throw appError('UNKNOWN_COMMAND', { command });
    }
  }

  listen<T = unknown>(event: IpcMainInvokeEvent, eventName: string): Event<T> {
    switch (eventName) {
      case 'on_did_change_window_state':
        return this.service.onDidChangeWindowStateForEvent(event) as Event<T>;
      case 'on_did_change_color_scheme':
        return this.service.onDidChangeColorScheme() as Event<T>;
      default:
        throw appError('UNKNOWN_COMMAND', { command: eventName });
    }
  }
}

export function createNativeHostMainService(themeMainService: IThemeMainService) {
  return new NativeHostMainService(themeMainService);
}
