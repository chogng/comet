import 'cs/base/browser/ui/toast/toast.css';
import { EventEmitter } from 'cs/base/common/event';
import {
  Disposable,
  DisposableStore,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';
import { $ } from 'cs/base/browser/dom';
import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

type ResolvedToastOptions = {
  message: string;
  type: ToastType;
  duration: number;
};

export type ToastBridge = {
  canHandle: () => boolean;
  show: (options: ToastOptions) => number | void;
  dismiss?: (id: number) => void;
};

interface ToastItem extends ResolvedToastOptions {
  id: number;
  isExiting?: boolean;
}

type ToastContainerOptions = {
  closeLabel?: string;
};

let toastId = 0;
let toasts: ToastItem[] = [];
const TOAST_EXIT_DURATION = 200;
let toastBridge: ToastBridge | null = null;
const onDidChangeToastsEmitter = new EventEmitter<ToastItem[]>();
const toastTimers = new Map<number, DisposableStore>();

function notify() {
  onDidChangeToastsEmitter.fire([...toasts]);
}

function createToastOptions(options: ToastOptions | string): ResolvedToastOptions {
  return {
    message: typeof options === 'string' ? options : options.message,
    type: typeof options === 'string' ? 'info' : options.type || 'info',
    duration: typeof options === 'string' ? 3000 : options.duration || 3000,
  };
}

function createTimeoutDisposable(callback: () => void, delay: number): DisposableLike {
  let handle: number | null = window.setTimeout(() => {
    handle = null;
    callback();
  }, delay);

  return toDisposable(() => {
    if (handle === null) {
      return;
    }

    window.clearTimeout(handle);
    handle = null;
  });
}

function getToastTimerStore(id: number) {
  let store = toastTimers.get(id);
  if (!store) {
    store = new DisposableStore();
    toastTimers.set(id, store);
  }

  return store;
}

function clearToastTimerStore(id: number) {
  const store = toastTimers.get(id);
  if (!store) {
    return;
  }

  store.dispose();
  toastTimers.delete(id);
}

export function registerToastBridge(bridge: ToastBridge | null) {
  toastBridge = bridge;
}

function getToastIconName(type: ToastType): LxIconName {
  switch (type) {
    case 'success':
      return 'check';
    case 'error':
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

function dismissToast(id: number) {
  const target = toasts.find((item) => item.id === id);
  if (!target || target.isExiting) {
    return;
  }

const timerStore = getToastTimerStore(id);
  timerStore.clear();
  toasts = toasts.map((item) =>
    item.id === id ? { ...item, isExiting: true } : item,
  );
  notify();

  timerStore.add(createTimeoutDisposable(() => {
    clearToastTimerStore(id);
    toasts = toasts.filter((item) => item.id !== id);
    notify();
  }, TOAST_EXIT_DURATION));
}

export const toast = {
  show: (options: ToastOptions | string) => {
    const defaultOptions = createToastOptions(options);
    if (toastBridge?.canHandle()) {
      return toastBridge.show(defaultOptions) ?? -1;
    }

const id = ++toastId;
    const newToast: ToastItem = { ...defaultOptions, id, isExiting: false };
    toasts.push(newToast);
    notify();

    if (defaultOptions.duration !== Infinity) {
      getToastTimerStore(id).add(createTimeoutDisposable(() => {
        dismissToast(id);
      }, defaultOptions.duration));
    }

    return id;
  },
  dismiss: (id: number) => {
    if (toastBridge?.canHandle()) {
      toastBridge.dismiss?.(id);
      return;
    }
    dismissToast(id);
  },
  success: (message: string, duration?: number) =>
    toast.show({ message, type: 'success', duration }),
  error: (message: string, duration?: number) =>
    toast.show({ message, type: 'error', duration }),
  info: (message: string, duration?: number) =>
    toast.show({ message, type: 'info', duration }),
  warning: (message: string, duration?: number) =>
    toast.show({ message, type: 'warning', duration }),
};

function renderToastItem(item: ToastItem, closeLabel: string) {
  const toastElement = $<HTMLElementTagNameMap['div']>('div', { class: `comet-toast-item comet-toast-${item.type}${item.isExiting ? ' exit' : ''}` });
  const icon = $<HTMLElementTagNameMap['div']>('div.comet-toast-icon');
  icon.append(createLxIcon(getToastIconName(item.type)));
  const content = $<HTMLElementTagNameMap['div']>('div.comet-toast-content', undefined, item.message);
  const closeActionBar = createActionBarView({
    className: 'comet-toast-actions',
    ariaLabel: closeLabel,
    items: [
      {
        id: 'close',
        label: closeLabel,
        hover: closeLabel,
        content: createLxIcon('close'),
        mode: 'icon',
        buttonClassName: 'comet-toast-close',
        onClick: () => dismissToast(item.id),
      },
    ],
  });
  toastElement.append(icon, content, closeActionBar.getElement());
  return {
    element: toastElement,
    closeActionBar,
  };
}

export class ToastContainerView extends Disposable {
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-toast-container');
  private readonly renderDisposables = new DisposableStore();
  private closeLabel: string;
  private disposed = false;

  constructor({ closeLabel = 'Close' }: ToastContainerOptions = {}) {
    super();
    this.closeLabel = closeLabel;
    this._register(this.renderDisposables);
    this._register(onDidChangeToastsEmitter.event(this.render));
    this.render(toasts);
  }

  getElement() {
    return this.element;
  }

  setCloseLabel(closeLabel: string) {
    if (this.disposed) {
      return;
    }

    if (this.closeLabel === closeLabel) {
      return;
    }
    this.closeLabel = closeLabel;
    this.render(toasts);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.element.replaceChildren();
  }

  private readonly render = (currentToasts: ToastItem[]) => {
    this.renderDisposables.clear();

    const nodes = currentToasts.map((item) => {
      const rendered = renderToastItem(item, this.closeLabel);
      this.renderDisposables.add(rendered.closeActionBar);
      return rendered.element;
    });

    this.element.replaceChildren(...nodes);
  };
}

export function createToastContainerView(options?: ToastContainerOptions) {
  return new ToastContainerView(options);
}
