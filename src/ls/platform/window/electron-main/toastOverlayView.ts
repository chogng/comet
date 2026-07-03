import { BrowserWindow, WebContentsView } from 'electron';

import type {
  NativeToastItem,
  NativeToastLayout,
  NativeToastOptions,
  NativeToastState,
  NativeToastType,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import {
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';
import { cleanText } from 'ls/base/common/strings';
import {
  resolvePreloadScriptPath,
  resolveWorkbenchRendererFilePath,
} from 'ls/platform/window/electron-main/window';

const nativeToastStateChannel = 'app:native-toast-state';
const nativeToastQueryKey = 'nativeOverlay';
const nativeToastQueryValue = 'toast';
const overlayMargin = 24;
const defaultToastWidth = 420;
const toastGap = 12;
const toastVerticalPadding = 8;
const toastBaseHeight = 56;
const toastLineHeight = 20;
const maxEstimatedLines = 5;
const hiddenBounds = { x: 0, y: 0, width: 0, height: 0 };

type NativeToastTimerState = {
  timeout: MutableDisposable<DisposableLike>;
  startedAt: number | null;
  remainingMs: number;
};

let nativeToastWindow: BrowserWindow | null = null;
let nativeToastView: WebContentsView | null = null;
let nativeToastState: NativeToastState = { items: [] };
let nativeToastLayout: NativeToastLayout = { width: defaultToastWidth, height: 0 };
let nativeToastId = 0;
let nativeToastHovering = false;
const nativeToastViewBindings = new MutableDisposable<DisposableStore>();
const nativeToastTimers = new Map<number, NativeToastTimerState>();

type EventEmitterLike = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
};

function addDisposableEmitterListener(
  target: EventEmitterLike,
  event: string,
  listener: (...args: unknown[]) => void,
) {
  target.on(event, listener);
  return toDisposable(() => {
    target.removeListener(event, listener);
  });
}

function createTimeoutDisposable(callback: () => void, delay: number): DisposableLike {
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timeoutId = null;
    callback();
  }, delay);

  return toDisposable(() => {
    if (timeoutId === null) {
      return;
    }

    clearTimeout(timeoutId);
    timeoutId = null;
  });
}

function createNativeToastTimerState(remainingMs: number): NativeToastTimerState {
  return {
    timeout: new MutableDisposable<DisposableLike>(),
    startedAt: null,
    remainingMs,
  };
}

function resetNativeToastOverlay(view?: WebContentsView | null) {
  if (view && nativeToastView !== view) {
    return;
  }

  nativeToastViewBindings.clear();
  clearNativeToastTimers();
  nativeToastWindow = null;
  nativeToastView = null;
  nativeToastHovering = false;
  nativeToastState = { items: [] };
  nativeToastLayout = { width: defaultToastWidth, height: 0 };
}

function resolveRendererTarget() {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    url.pathname = '/src/ls/code/electron-sandbox/workbench/workbench.html';
    url.search = '';
    url.searchParams.set(nativeToastQueryKey, nativeToastQueryValue);

    return {
      type: 'url' as const,
      target: url.toString(),
    };
  }

  return {
    type: 'file' as const,
    target: resolveWorkbenchRendererFilePath(),
    query: {
      [nativeToastQueryKey]: nativeToastQueryValue,
    },
  };
}

function hasNativeToastQuery(url: string) {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).searchParams.get(nativeToastQueryKey) === nativeToastQueryValue;
  } catch {
    return false;
  }
}

async function ensureNativeToastRendererLoaded(view: WebContentsView) {
  const currentUrl = view.webContents.getURL();
  if (hasNativeToastQuery(currentUrl)) {
    return;
  }

  const target = resolveRendererTarget();
  if (target.type === 'url') {
    await view.webContents.loadURL(target.target);
    return;
  }

  await view.webContents.loadFile(target.target, { query: target.query });
}

function clearNativeToastTimer(id: number) {
  const timerState = nativeToastTimers.get(id);
  if (!timerState) {
    return;
  }

  timerState.timeout.clear();
  timerState.startedAt = null;
}

function deleteNativeToastTimer(id: number) {
  const timerState = nativeToastTimers.get(id);
  if (!timerState) {
    return;
  }

  timerState.timeout.dispose();
  nativeToastTimers.delete(id);
}

function clearNativeToastTimers() {
  for (const id of nativeToastTimers.keys()) {
    deleteNativeToastTimer(id);
  }
}

function startNativeToastTimer(id: number) {
  const timerState = nativeToastTimers.get(id);
  if (!timerState || nativeToastHovering) {
    return;
  }

  clearNativeToastTimer(id);
  timerState.startedAt = Date.now();
  timerState.timeout.value = createTimeoutDisposable(() => {
    dismissToast(id);
  }, timerState.remainingMs);
}

function pauseNativeToastTimer(id: number) {
  const timerState = nativeToastTimers.get(id);
  if (!timerState || timerState.startedAt === null) {
    return;
  }

  const elapsedMs = Math.max(0, Date.now() - timerState.startedAt);
  timerState.remainingMs = Math.max(0, timerState.remainingMs - elapsedMs);
  clearNativeToastTimer(id);
}

function pauseAllNativeToastTimers() {
  for (const id of nativeToastTimers.keys()) {
    pauseNativeToastTimer(id);
  }
}

function resumeAllNativeToastTimers() {
  if (nativeToastHovering) {
    return;
  }

  for (const id of nativeToastTimers.keys()) {
    startNativeToastTimer(id);
  }
}

function normalizeNativeToastType(value: unknown): NativeToastType {
  switch (value) {
    case 'success':
    case 'error':
    case 'warning':
      return value;
    default:
      return 'info';
  }
}

function estimateToastItemHeight(message: string) {
  const estimatedLines = Math.max(
    1,
    Math.min(
      maxEstimatedLines,
      message
        .split('\n')
        .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 38)), 0),
    ),
  );

  return toastBaseHeight + (estimatedLines - 1) * toastLineHeight;
}

function estimateNativeToastLayout(items: NativeToastItem[]): NativeToastLayout {
  if (items.length === 0) {
    return { width: defaultToastWidth, height: 0 };
  }

  const itemsHeight = items.reduce((sum, item) => sum + estimateToastItemHeight(item.message), 0);
  const totalGap = toastGap * Math.max(0, items.length - 1);

  return {
    width: defaultToastWidth,
    height: itemsHeight + totalGap + toastVerticalPadding,
  };
}

function emitNativeToastState() {
  if (!nativeToastView || nativeToastView.webContents.isDestroyed()) {
    return;
  }

  nativeToastView.webContents.send(nativeToastStateChannel, nativeToastState);
}

function applyNativeToastBounds() {
  if (!nativeToastView) {
    return;
  }

  const targetWindow = nativeToastWindow;
  if (!targetWindow || targetWindow.isDestroyed()) {
    nativeToastView.setVisible(false);
    nativeToastView.setBounds(hiddenBounds);
    return;
  }

  const fallbackLayout = estimateNativeToastLayout(nativeToastState.items);
  const resolvedWidth = Math.max(nativeToastLayout.width, fallbackLayout.width);
  const resolvedHeight = Math.max(nativeToastLayout.height, fallbackLayout.height);
  const [contentWidth, contentHeight] = targetWindow.getContentSize();
  const width = Math.min(resolvedWidth, Math.max(0, contentWidth - overlayMargin * 2));
  const height = Math.min(resolvedHeight, Math.max(0, contentHeight - overlayMargin * 2));

  if (nativeToastState.items.length === 0 || width <= 0 || height <= 0) {
    nativeToastView.setVisible(false);
    nativeToastView.setBounds(hiddenBounds);
    return;
  }

  nativeToastView.setBounds({
    x: Math.max(0, contentWidth - width - overlayMargin),
    y: Math.max(0, contentHeight - height - overlayMargin),
    width,
    height,
  });
  nativeToastView.setVisible(true);
}

function createNativeToastView(window: BrowserWindow) {
  const view = new WebContentsView({
    webPreferences: {
      preload: resolvePreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  view.setBounds(hiddenBounds);
  window.contentView.addChildView(view);

  const bindings = new DisposableStore();
  bindings.add(addDisposableEmitterListener(view.webContents, 'did-finish-load', () => {
    if (nativeToastView !== view) {
      return;
    }

    emitNativeToastState();
    applyNativeToastBounds();
  }));
  bindings.add(addDisposableEmitterListener(view.webContents, 'destroyed', () => {
    resetNativeToastOverlay(view);
  }));
  nativeToastViewBindings.value = bindings;

  return view;
}

function ensureNativeToastView(window: BrowserWindow) {
  if (
    nativeToastWindow === window &&
    nativeToastView &&
    !nativeToastView.webContents.isDestroyed()
  ) {
    return nativeToastView;
  }

  disposeToastOverlay();
  nativeToastWindow = window;
  nativeToastView = createNativeToastView(window);
  void ensureNativeToastRendererLoaded(nativeToastView).catch(() => {
    // Keep the native toast overlay best-effort only.
  });
  return nativeToastView;
}

function normalizeNativeToastOptions(options: NativeToastOptions) {
  const message = cleanText(options.message);
  if (!message) {
    return null;
  }

  return {
    message,
    type: normalizeNativeToastType(options.type),
    duration:
      options.duration === Infinity
        ? Infinity
        : typeof options.duration === 'number' && Number.isFinite(options.duration)
          ? Math.max(0, options.duration)
          : 3000,
  };
}

export function showToast(window: BrowserWindow | null | undefined, options: NativeToastOptions) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const normalizedOptions = normalizeNativeToastOptions(options);
  if (!normalizedOptions) {
    return;
  }

  ensureNativeToastView(window);

  const id = ++nativeToastId;
  const nextItem: NativeToastItem = {
    id,
    message: normalizedOptions.message,
    type: normalizedOptions.type,
  };

  nativeToastState = {
    items: [...nativeToastState.items, nextItem],
  };
  nativeToastLayout = estimateNativeToastLayout(nativeToastState.items);
  emitNativeToastState();
  applyNativeToastBounds();

  if (normalizedOptions.duration !== Infinity) {
    nativeToastTimers.set(id, createNativeToastTimerState(normalizedOptions.duration));
    startNativeToastTimer(id);
  }
}

export function dismissToast(id: number) {
  deleteNativeToastTimer(id);
  if (nativeToastState.items.length === 0) {
    return;
  }

  const nextItems = nativeToastState.items.filter((item) => item.id !== id);
  if (nextItems.length === nativeToastState.items.length) {
    return;
  }

  nativeToastState = {
    items: nextItems,
  };
  if (nextItems.length === 0) {
    nativeToastHovering = false;
  }
  nativeToastLayout = estimateNativeToastLayout(nextItems);
  emitNativeToastState();
  applyNativeToastBounds();
}

export function getToastState(): NativeToastState {
  return nativeToastState;
}

export function reportToastLayout(senderId: number, layout: NativeToastLayout) {
  if (
    !nativeToastView ||
    nativeToastView.webContents.isDestroyed() ||
    nativeToastView.webContents.id !== senderId
  ) {
    return;
  }

  const width = Number.isFinite(layout.width)
    ? Math.max(280, Math.min(520, Math.trunc(layout.width)))
    : defaultToastWidth;
  const height = Number.isFinite(layout.height)
    ? Math.max(0, Math.trunc(layout.height))
    : 0;

  nativeToastLayout = {
    width,
    height,
  };
  applyNativeToastBounds();
}

export function setToastHovering(hovering: boolean) {
  nativeToastHovering = hovering;

  if (nativeToastHovering) {
    pauseAllNativeToastTimers();
    return;
  }

  resumeAllNativeToastTimers();
}

export function disposeToastOverlay(window?: BrowserWindow | null) {
  if (!nativeToastView) {
    return;
  }

  if (window && nativeToastWindow && nativeToastWindow !== window) {
    return;
  }

  const view = nativeToastView;
  const parentWindow = nativeToastWindow;

  resetNativeToastOverlay(view);

  if (parentWindow && !parentWindow.isDestroyed()) {
    parentWindow.contentView.removeChildView(view);
  }

  if (!view.webContents.isDestroyed()) {
    view.webContents.close({ waitForBeforeUnload: false });
  }
}
