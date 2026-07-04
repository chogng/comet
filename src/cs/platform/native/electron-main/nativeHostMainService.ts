import { shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';

import type {
  PartsSplash,
} from 'cs/platform/theme/common/theme';
import type {
  OpenPathPayload,
  ReadPdfFilePayload,
  WindowControlAction,
  WindowState,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'cs/base/common/errors';
import type { Event } from 'cs/base/common/event';
import { toDisposable } from 'cs/base/common/lifecycle';
import { URI, isUriComponents } from 'cs/base/common/uri';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { pickPdfFileDialog } from 'cs/platform/dialogs/electron-main/dialogMainService';
import {
  getMainWindow,
  resolveWindowFromWebContents,
} from 'cs/platform/windows/electron-main/windows';
import { getWindowState } from 'cs/platform/window/electron-main/window';
import type { IThemeMainService } from 'cs/platform/theme/electron-main/themeMainService';

function reviveFileResource(resource: unknown, missingMessage: string) {
  if (!isUriComponents(resource)) {
    throw appError('UNKNOWN_ERROR', { message: missingMessage });
  }

  const fileResource = URI.from(resource, true);
  if (fileResource.scheme !== 'file') {
    throw appError('URL_PROTOCOL_UNSUPPORTED', { url: fileResource.toString() });
  }

  return fileResource;
}

function resolvePdfFileResource(payload: ReadPdfFilePayload | undefined) {
  return reviveFileResource(payload?.resource, 'PDF resource is required.');
}

export class NativeHostMainService {
  constructor(private readonly themeMainService: IThemeMainService) {}

  async pickPdfFile(parentWindow: BrowserWindow | null = getMainWindow()) {
    const filePath = await pickPdfFileDialog(parentWindow);
    return filePath ? URI.file(filePath).toJSON() : null;
  }

  async readPdfFile(payload: ReadPdfFilePayload | undefined) {
    const resource = resolvePdfFileResource(payload);
    const filePath = resource.fsPath;
    if (!/\.pdf$/i.test(filePath)) {
      throw appError('UNKNOWN_ERROR', { message: 'Only PDF files can be previewed.' });
    }

    const buffer = await readFile(filePath);
    return {
      resource: resource.toJSON(),
      data: new Uint8Array(buffer),
    };
  }

  async openPath(payload: OpenPathPayload | undefined) {
    const targetPath = reviveFileResource(
      payload?.resource,
      'Resource is required.',
    ).fsPath;
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
