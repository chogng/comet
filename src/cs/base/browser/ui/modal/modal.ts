import 'cs/base/browser/ui/button/button.css';
import { getBaseLayerHoverDelegate } from 'cs/base/browser/ui/hover/hoverDelegate';
import type {
  HoverHandle,
  IHoverDelegate,
} from 'cs/base/browser/ui/hover/hover';
import 'cs/base/browser/ui/modal/modal.css';
import {
  Disposable,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';

export type ModalContent =
  | string
  | number
  | Node
  | Array<string | number | Node>
  | null
  | undefined;

export interface ModalProps {
  open: boolean;
  title?: ModalContent;
  content?: ModalContent;
  body?: ModalContent;
  children?: ModalContent;
  onClose: () => void;
  closeLabel?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  panelClassName?: string;
  ariaLabel?: string;
  hoverService?: IHoverDelegate;
}

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

function appendContent(target: HTMLElement, content: ModalContent) {
  if (content === null || content === undefined) {
    return;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      appendContent(target, item);
    }
    return;
  }

  if (content instanceof Node) {
    target.append(content);
    return;
  }

  target.append(document.createTextNode(String(content)));
}

function createCloseIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');

  const pathA = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathA.setAttribute('d', 'M4 4L12 12');
  pathA.setAttribute('fill', 'none');
  pathA.setAttribute('stroke', 'currentColor');
  pathA.setAttribute('stroke-width', '1.8');
  pathA.setAttribute('stroke-linecap', 'round');

  const pathB = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathB.setAttribute('d', 'M12 4L4 12');
  pathB.setAttribute('fill', 'none');
  pathB.setAttribute('stroke', 'currentColor');
  pathB.setAttribute('stroke-width', '1.8');
  pathB.setAttribute('stroke-linecap', 'round');

  svg.append(pathA, pathB);
  return svg;
}

function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function resolveTitleContent(props: ModalProps) {
  return props.title;
}

function resolveBodyContent(props: ModalProps) {
  if (props.content !== undefined) {
    return props.content;
  }

  if (props.body !== undefined) {
    return props.body;
  }

  return props.children;
}

let bodyScrollLockCount = 0;
let initialBodyOverflow = '';

function lockBodyScroll() {
  if (typeof document === 'undefined') {
    return;
  }

  if (bodyScrollLockCount === 0) {
    initialBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined' || bodyScrollLockCount === 0) {
    return;
  }

  bodyScrollLockCount -= 1;

  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = initialBodyOverflow;
  }
}

export class ModalView extends Disposable {
  private props: ModalProps;
  private readonly element = createElement('div', 'modal-backdrop');
  private readonly panelElement = createElement('section', 'modal-panel');
  private readonly headerElement = createElement('header', 'modal-header');
  private readonly titleElement = createElement('h2', 'modal-title');
  private readonly titleSpacerElement = createElement('span', 'modal-title-spacer');
  private readonly closeButton = createElement(
    'button',
    'modal-close-btn btn-base btn-ghost btn-mode-icon btn-md',
  ) as HTMLButtonElement;
  private readonly closeHover: HoverHandle;
  private readonly bodyElement = createElement('div', 'modal-body');
  private readonly openListeners = new MutableDisposable<DisposableLike>();
  private isAttached = false;
  private readonly titleId = `modal-title-${Math.random().toString(36).slice(2, 10)}`;
  private disposed = false;

  constructor(props: ModalProps) {
    super();
    this.props = {
      closeLabel: 'Close',
      closeOnOverlayClick: true,
      closeOnEscape: true,
      className: '',
      panelClassName: '',
      ...props,
    };
    const hoverService = this.props.hoverService ?? getBaseLayerHoverDelegate();
    this.closeHover = hoverService.createHover(this.closeButton, null);
    this._register(this.closeHover);
    this._register(this.openListeners);

    this.closeButton.type = 'button';
    this.closeButton.append(createCloseIcon());
    this._register(addDisposableListener(this.closeButton, 'click', this.handleCloseClick));
    this._register(addDisposableListener(this.element, 'click', this.handleOverlayClick));
    this._register(addDisposableListener(this.panelElement, 'click', this.handlePanelClick));
    this.headerElement.append(this.titleSpacerElement, this.closeButton);
    this.panelElement.append(this.headerElement, this.bodyElement);
    this.element.append(this.panelElement);
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: ModalProps) {
    if (this.disposed) {
      return;
    }

    this.props = {
      ...this.props,
      ...props,
    };
    this.render();
  }

  open() {
    if (this.disposed || this.isAttached || typeof document === 'undefined') {
      return;
    }

    lockBodyScroll();
    document.body.append(this.element);
    this.openListeners.value = addDisposableListener(window, 'keydown', this.handleWindowKeyDown);
    this.isAttached = true;
  }

  close() {
    if (!this.isAttached) {
      return;
    }

    this.element.remove();
    unlockBodyScroll();
    this.openListeners.clear();
    this.isAttached = false;
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.close();
    super.dispose();
    this.element.replaceChildren();
  }

  private readonly handleCloseClick = () => {
    this.props.onClose();
  };

  private readonly handleOverlayClick = () => {
    if (this.props.closeOnOverlayClick) {
      this.props.onClose();
    }
  };

  private readonly handlePanelClick = (event: MouseEvent) => {
    event.stopPropagation();
  };

  private readonly handleWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.props.closeOnEscape) {
      this.props.onClose();
    }
  };

  private render() {
    const {
      open,
      closeLabel = 'Close',
      className = '',
      panelClassName = '',
      ariaLabel,
    } = this.props;

    this.element.className = ['modal-backdrop', className].filter(Boolean).join(' ');
    this.panelElement.className = ['modal-panel', panelClassName].filter(Boolean).join(' ');
    this.panelElement.setAttribute('role', 'dialog');
    this.panelElement.setAttribute('aria-modal', 'true');

    const titleContent = resolveTitleContent(this.props);
    const bodyContent = resolveBodyContent(this.props);

    this.closeButton.setAttribute('aria-label', closeLabel);
    this.closeHover.update(closeLabel);
    this.closeButton.removeAttribute('title');

    this.titleElement.replaceChildren();
    appendContent(this.titleElement, titleContent);
    this.titleElement.id = this.titleId;

    this.bodyElement.replaceChildren();
    appendContent(this.bodyElement, bodyContent);

    if (titleContent === null || titleContent === undefined) {
      this.headerElement.replaceChildren(this.titleSpacerElement, this.closeButton);
      this.panelElement.removeAttribute('aria-labelledby');
      if (ariaLabel) {
        this.panelElement.setAttribute('aria-label', ariaLabel);
      } else {
        this.panelElement.removeAttribute('aria-label');
      }
    } else {
      this.headerElement.replaceChildren(this.titleElement, this.closeButton);
      this.panelElement.setAttribute('aria-labelledby', this.titleId);
      if (ariaLabel) {
        this.panelElement.setAttribute('aria-label', ariaLabel);
      } else {
        this.panelElement.removeAttribute('aria-label');
      }
    }

    if (open) {
      this.open();
    } else {
      this.close();
    }
  }
}

export function createModalView(props: ModalProps) {
  return new ModalView(props);
}
