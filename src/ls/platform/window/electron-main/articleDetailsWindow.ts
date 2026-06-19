import { BrowserWindow } from 'electron';

import type {
  NativeModalState,
  OpenArticleDetailsModalPayload,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { appError } from 'ls/base/common/errors';
import {
  createAuxiliaryWindow,
  resolvePreloadScriptPath,
  resolveWorkbenchRendererFilePath,
  resolveWorkbenchRendererUrl,
} from 'ls/platform/window/electron-main/window';

const nativeModalQueryKey = 'nativeModal';
const nativeModalStateChannel = 'app:modal-state';
const articleDetailsModalKind: NativeModalState['kind'] = 'article-details';

const modalStateByWebContentsId = new Map<number, NativeModalState>();
let articleDetailsWindow: BrowserWindow | null = null;

function applyWindowChrome(window: BrowserWindow) {
  if (typeof window.removeMenu === 'function') {
    window.removeMenu();
  } else {
    window.setMenuBarVisibility(false);
  }
}

function resolveRendererTarget(kind: NativeModalState['kind']) {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    return {
      type: 'url' as const,
      target: resolveWorkbenchRendererUrl(devUrl, {
        [nativeModalQueryKey]: kind,
      }),
    };
  }

  return {
    type: 'file' as const,
    target: resolveWorkbenchRendererFilePath(),
    query: {
      [nativeModalQueryKey]: kind,
    },
  };
}

function publishModalState(window: BrowserWindow, state: NativeModalState) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  window.webContents.send(nativeModalStateChannel, state);
}

function setWindowModalState(window: BrowserWindow, state: NativeModalState) {
  const webContentsId = window.webContents.id;
  modalStateByWebContentsId.set(webContentsId, state);
  publishModalState(window, state);
}

function createModalWindow(_parentWindow: BrowserWindow, title: string) {
  const modalWindow = createAuxiliaryWindow({
    show: false,
    skipTaskbar: false,
    width: 760,
    height: 640,
    minWidth: 520,
    minHeight: 420,
    title,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#eff4fb',
    webPreferences: {
      preload: resolvePreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  applyWindowChrome(modalWindow);
  modalWindow.once('ready-to-show', () => {
    if (!modalWindow.isDestroyed()) {
      modalWindow.show();
    }
  });

  const webContentsId = modalWindow.webContents.id;
  modalWindow.webContents.on('did-finish-load', () => {
    const state = modalStateByWebContentsId.get(webContentsId);
    if (state) {
      publishModalState(modalWindow, state);
    }
  });

  modalWindow.on('closed', () => {
    modalStateByWebContentsId.delete(webContentsId);
    if (articleDetailsWindow === modalWindow) {
      articleDetailsWindow = null;
    }
  });

  return modalWindow;
}

function getOrCreateArticleDetailsWindow(parentWindow: BrowserWindow, title: string) {
  if (articleDetailsWindow && !articleDetailsWindow.isDestroyed()) {
    articleDetailsWindow.setTitle(title);
    return articleDetailsWindow;
  }

  articleDetailsWindow = createModalWindow(parentWindow, title);
  return articleDetailsWindow;
}

function hasNativeModalQuery(url: string, kind: NativeModalState['kind']) {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).searchParams.get(nativeModalQueryKey) === kind;
  } catch {
    return false;
  }
}

async function ensureModalRendererLoaded(window: BrowserWindow, kind: NativeModalState['kind']) {
  const currentUrl = window.webContents.getURL();
  if (hasNativeModalQuery(currentUrl, kind)) {
    return;
  }

  const target = resolveRendererTarget(kind);
  if (target.type === 'url') {
    await window.loadURL(target.target);
    return;
  }

  await window.loadFile(target.target, { query: target.query });
}

function focusWindow(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
}

export async function openArticleDetailsModal(
  parentWindow: BrowserWindow,
  payload: OpenArticleDetailsModalPayload = {},
) {
  const article = payload.article;
  const labels = payload.labels;
  if (!article || !labels) {
    throw appError('UNKNOWN_ERROR', {
      message: 'Article details modal payload is incomplete.',
    });
  }

  const locale = payload.locale === 'zh' ? 'zh' : 'en';
  const title = article.title?.trim() || labels.untitled;
  const modalWindow = getOrCreateArticleDetailsWindow(parentWindow, title);

  setWindowModalState(modalWindow, {
    kind: articleDetailsModalKind,
    article,
    labels,
    locale,
  });

  await ensureModalRendererLoaded(modalWindow, articleDetailsModalKind);
  focusWindow(modalWindow);
  return true;
}

export function getNativeModalState(webContentsId: number): NativeModalState | null {
  return modalStateByWebContentsId.get(webContentsId) ?? null;
}
