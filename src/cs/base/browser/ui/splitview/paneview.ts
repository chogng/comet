import { getGlobalSashSize, Orientation } from 'cs/base/browser/ui/sash/sash';
import { EventEmitter } from 'cs/base/common/event';
import {
  DisposableStore,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';
import {
  SplitView,
  type IView,
} from 'cs/base/browser/ui/splitview/splitview';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';

import 'cs/base/browser/ui/splitview/paneview.css';

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (typeof textContent === 'string') {
    element.textContent = textContent;
  }
  return element;
}

function appendClassNames(
  element: HTMLElement,
  ...classNames: Array<string | undefined>
) {
  for (const className of classNames) {
    if (!className) {
      continue;
    }

    const tokens = className.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }

    element.classList.add(...tokens);
  }
}

function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export type PaneClassNames = {
  pane: string;
  header: string;
  title: string;
  body: string;
};

export type PaneOptions = {
  title: string;
  expanded?: boolean;
  minimumBodySize?: number;
  maximumBodySize?: number;
  headerSize?: number;
  headerContent?: HTMLElement;
  classNames?: Partial<PaneClassNames>;
};

type PaneChangeEvent = {
  expanded: boolean;
  preferredSize: number;
};

export class Pane implements IView {
  static readonly HEADER_SIZE = 34;

  readonly element = createElement('section', 'pane');
  protected readonly headerElement = createElement('div', 'pane-header');
  protected readonly headerButtonElement = createElement('button', 'pane-header-toggle');
  protected readonly headerContentElement = createElement('span', 'pane-header-content');
  protected readonly chevronElement = createLxIcon('chevron-down', 'pane-header-chevron');
  protected readonly titleElement: HTMLSpanElement;
  protected readonly headerActionsElement = createElement('div', 'pane-header-actions');
  protected readonly bodyElement = createElement('div', 'pane-body');
  private readonly onDidChangeEmitter = new EventEmitter<PaneChangeEvent>();
  private readonly disposables = new DisposableStore();
  private expandedValue: boolean;
  private minimumBodySizeValue: number;
  private maximumBodySizeValue: number;
  private readonly headerSizeValue: number;
  private currentSize = 0;
  private expandedSize: number | undefined;

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(options: PaneOptions) {
    this.expandedValue = options.expanded !== false;
    this.minimumBodySizeValue = options.minimumBodySize ?? 160;
    this.maximumBodySizeValue =
      options.maximumBodySize ?? Number.POSITIVE_INFINITY;
    this.headerSizeValue = options.headerSize ?? Pane.HEADER_SIZE;
    this.titleElement = createElement('span', 'pane-header-title', options.title);
    this.element.style.setProperty('--cs-pane-header-size', `${this.headerSizeValue}px`);
    appendClassNames(
      this.element,
      options.classNames?.pane,
    );
    appendClassNames(
      this.headerElement,
      options.classNames?.header,
    );
    appendClassNames(
      this.titleElement,
      options.classNames?.title,
    );
    appendClassNames(
      this.bodyElement,
      options.classNames?.body,
    );

    this.headerButtonElement.type = 'button';
    this.headerButtonElement.setAttribute('aria-expanded', String(this.expandedValue));
    this.headerContentElement.append(this.chevronElement, this.titleElement);
    this.headerButtonElement.append(this.headerContentElement);
    if (options.headerContent) {
      this.headerActionsElement.append(options.headerContent);
    }
    this.renderHeader(this.headerActionsElement);
    this.headerElement.append(this.headerButtonElement, this.headerActionsElement);
    this.element.append(this.headerElement);
    this.element.classList.toggle('expanded', this.expandedValue);
    this.updateBodyAttachment();

    this.disposables.add(
      addDisposableListener(this.headerButtonElement, 'click', () => {
        this.setExpanded(!this.expandedValue);
      }),
    );
    this.disposables.add(
      addDisposableListener(this.headerButtonElement, 'keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }

        event.preventDefault();
        this.setExpanded(!this.expandedValue);
      }),
    );
  }

  get minimumSize() {
    return this.headerSizeValue + (this.expandedValue ? this.minimumBodySizeValue : 0);
  }

  get maximumSize() {
    return this.headerSizeValue + (this.expandedValue ? this.maximumBodySizeValue : 0);
  }

  isExpanded() {
    return this.expandedValue;
  }

  setTitle(title: string) {
    this.titleElement.textContent = title;
  }

  setExpanded(expanded: boolean) {
    if (this.expandedValue === expanded) {
      return;
    }

    if (!expanded && this.currentSize > this.headerSizeValue) {
      this.expandedSize = this.currentSize;
    }

    this.expandedValue = expanded;
    this.element.classList.toggle('expanded', expanded);
    this.updateBodyAttachment();
    this.headerButtonElement.setAttribute('aria-expanded', String(expanded));
    const preferredSize = expanded
      ? Math.max(this.expandedSize ?? this.minimumSize, this.minimumSize)
      : this.headerSizeValue;
    this.onDidChangeEmitter.fire({
      expanded,
      preferredSize,
    });
  }

  layout(size: number) {
    this.currentSize = size;

    if (!this.expandedValue) {
      this.layoutBody(0, 0);
      return;
    }

    this.expandedSize = Math.max(size, this.minimumSize);
    const bodySize = Math.max(0, size - this.headerSizeValue);
    this.bodyElement.style.height = `${bodySize}px`;
    this.layoutBody(bodySize, this.headerSizeValue);
  }

  dispose() {
    this.disposables.dispose();
    this.onDidChangeEmitter.dispose();
    this.element.replaceChildren();
  }

  private updateBodyAttachment() {
    if (this.expandedValue) {
      if (this.bodyElement.parentElement !== this.element) {
        this.element.append(this.bodyElement);
      }
      return;
    }

    this.bodyElement.remove();
  }

  protected renderHeader(_container: HTMLElement) {
    // Subclasses can append header affordances after the title.
  }

  protected layoutBody(_bodySize: number, _headerSize: number) {
    // Subclasses can respond to body size updates if needed.
  }
}

export type AddPaneOptions = {
  index?: number;
  flex?: boolean;
};

type PaneItem = {
  pane: Pane;
  changeListener: DisposableLike;
};

export type PaneViewOptions = {
  orientation?: Orientation;
  sashSize?: number;
  reserveSashSpace?: boolean;
};

export class PaneView {
  private static readonly RESIZE_ANIMATION_DURATION_MS = 540;
  readonly element = createElement('div', 'pane-view');
  private readonly splitView: SplitView;
  private readonly items: PaneItem[] = [];
  private readonly disposables = new DisposableStore();
  private resizeAnimationTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: PaneViewOptions = {}) {
    const orientation = options.orientation ?? Orientation.HORIZONTAL;
    this.element.classList.add(
      orientation === Orientation.HORIZONTAL ? 'horizontal' : 'vertical',
    );
    this.splitView = new SplitView(
      orientation,
      options.sashSize ?? getGlobalSashSize(),
      options.reserveSashSpace ?? true,
    );
    this.element.append(this.splitView.element);
    this.disposables.add(this.splitView);
  }

  addPane(pane: Pane, size: number, options: AddPaneOptions = {}) {
    const index = options.index ?? this.items.length;
    const changeListener = pane.onDidChange((event) => {
      const paneIndex = this.items.findIndex((item) => item.pane === pane);
      if (paneIndex < 0) {
        return;
      }

      this.triggerResizeAnimation();
      this.splitView.resizeView(paneIndex, event.preferredSize);
    });

    this.items.splice(index, 0, {
      pane,
      changeListener,
    });
    this.splitView.addView(pane, size, {
      index,
      flex: options.flex === true,
    });
  }

  layout(width: number, height: number) {
    this.splitView.layout(Math.max(0, width), Math.max(0, height));
  }

  dispose() {
    if (this.resizeAnimationTimer) {
      clearTimeout(this.resizeAnimationTimer);
      this.resizeAnimationTimer = undefined;
    }
    this.splitView.element.classList.remove('pane-view-resize-animating');
    for (const item of this.items) {
      item.changeListener.dispose();
      item.pane.dispose();
    }
    this.items.length = 0;
    this.disposables.dispose();
    this.element.replaceChildren();
  }

  private triggerResizeAnimation() {
    this.splitView.element.classList.add('pane-view-resize-animating');
    if (this.resizeAnimationTimer) {
      clearTimeout(this.resizeAnimationTimer);
    }
    this.resizeAnimationTimer = setTimeout(() => {
      this.resizeAnimationTimer = undefined;
      this.splitView.element.classList.remove('pane-view-resize-animating');
    }, PaneView.RESIZE_ANIMATION_DURATION_MS);
  }
}

export { Orientation } from 'cs/base/browser/ui/sash/sash';
