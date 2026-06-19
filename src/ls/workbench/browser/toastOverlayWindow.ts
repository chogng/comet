import type {
  NativeToastState,
  NativeToastType,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import {
  LifecycleOwner,
  LifecycleStore,
  MutableLifecycle,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';
import { detectInitialLocale, getLocaleMessages } from 'language/i18n';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';
import 'ls/base/browser/ui/toast/toast.css';
import 'ls/workbench/browser/media/toastOverlayWindow.css';

const fallbackToastState: NativeToastState = {
  items: [],
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
}

function addDisposableListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function normalizeToastState(
  state: NativeToastState | null | undefined,
): NativeToastState {
  if (!state || !Array.isArray(state.items)) {
    return fallbackToastState;
  }

  return {
    items: state.items
      .filter(
        (item) =>
          typeof item?.id === 'number' && typeof item?.message === 'string',
      )
      .map((item) => ({
        id: item.id,
        message: item.message,
        type:
          item.type === 'success' ||
          item.type === 'error' ||
          item.type === 'warning'
            ? item.type
            : ('info' as const),
      })),
  };
}

function getToastIconText(type: NativeToastType) {
  switch (type) {
    case 'success':
      return 'OK';
    case 'error':
      return '!';
    case 'warning':
      return '!';
    default:
      return 'i';
  }
}

export class ToastOverlayWindowView extends LifecycleOwner {
  private readonly element = createElement('main', 'native-toast-overlay-page');
  private readonly stackElement = createElement(
    'div',
    'native-toast-overlay-stack native-toast-overlay-stack-empty',
  );
  private readonly ui = getLocaleMessages(detectInitialLocale());
  private readonly toastApi = getNativeHostService().toast;
  private readonly renderDisposables = new LifecycleStore();
  private readonly resizeObserver = new MutableLifecycle<DisposableLike>();
  private toastState: NativeToastState = fallbackToastState;
  private disposed = false;
  private readonly handleResize = () => {
    this.reportLayout();
  };

  constructor() {
    super();
    this.register(this.renderDisposables);
    this.register(this.resizeObserver);
    this.register(addDisposableListener(this.stackElement, 'mouseenter', () => {
      this.toastApi?.setHovering(true);
    }));
    this.register(addDisposableListener(this.stackElement, 'mouseleave', () => {
      this.toastApi?.setHovering(false);
    }));
    this.element.append(this.stackElement);
    this.register(addDisposableListener(window, 'resize', this.handleResize));
    if (typeof this.toastApi?.onStateChange === 'function') {
      this.register(this.toastApi.onStateChange((state) => {
        if (this.disposed) {
          return;
        }

        this.toastState = normalizeToastState(state);
        this.render();
      }));
    }

    if (typeof this.toastApi?.getState === 'function') {
      void this.toastApi
        .getState()
        .then((state) => {
          if (this.disposed) {
            return;
          }

          this.toastState = normalizeToastState(state);
          this.render();
        })
        .catch(() => {
          if (this.disposed) {
            return;
          }

          this.toastState = fallbackToastState;
          this.render();
        });
    }

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        this.reportLayout();
      });
      resizeObserver.observe(this.stackElement);
      this.resizeObserver.value = toDisposable(() => {
        resizeObserver.disconnect();
      });
    }
    this.render();
  }

  getElement() {
    return this.element;
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.toastApi?.setHovering(false);
    this.element.replaceChildren();
  }

  private reportLayout() {
    if (this.disposed) {
      return;
    }

    if (typeof this.toastApi?.reportLayout !== 'function') {
      return;
    }

    const toastItems = Array.from(
      this.stackElement.querySelectorAll<HTMLElement>('.native-toast-item'),
    );
    if (toastItems.length === 0) {
      this.toastApi.reportLayout({
        width: 0,
        height: 0,
      });
      return;
    }

    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;

    for (const item of toastItems) {
      const rect = item.getBoundingClientRect();
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }

    this.toastApi.reportLayout({
      width: Math.ceil(maxRight - minLeft),
      height: Math.ceil(maxBottom - minTop),
    });
  }

  private render() {
    if (this.disposed) {
      return;
    }

    this.renderDisposables.clear();
    this.stackElement.className = `native-toast-overlay-stack${
      this.toastState.items.length === 0 ? ' native-toast-overlay-stack-empty' : ''
    }`;

    if (this.toastState.items.length === 0) {
      this.toastApi?.setHovering(false);
    }

    this.stackElement.replaceChildren(
      ...this.toastState.items.map((item) => {
        const section = createElement(
          'section',
          `toast-item toast-${item.type} native-toast-item`,
        );
        const icon = createElement(
          'div',
          'toast-icon',
          getToastIconText(item.type),
        );
        const content = createElement('div', 'toast-content', item.message);
        const close = createElement(
          'button',
          'toast-close native-toast-close',
          'x',
        );
        close.type = 'button';
        close.setAttribute('aria-label', this.ui.toastClose);
        this.renderDisposables.add(addDisposableListener(close, 'click', () => {
          this.toastApi?.dismiss(item.id);
        }));
        section.append(icon, content, close);
        return section;
      }),
    );

    this.reportLayout();
  }
}

export function createToastOverlayWindowView() {
  return new ToastOverlayWindowView();
}
