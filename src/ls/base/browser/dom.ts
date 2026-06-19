import { toDisposable } from 'ls/base/common/lifecycle';

export function clearNode(node: HTMLElement): void {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}

export function append<T extends Node>(parent: HTMLElement, child: T): T;
export function append<T extends Node>(parent: HTMLElement, ...children: (T | string)[]): void;
export function append<T extends Node>(parent: HTMLElement, ...children: (T | string)[]): T | void {
  parent.append(...children);
  if (children.length === 1 && typeof children[0] !== 'string') {
    return children[0];
  }
}

export function reset(parent: HTMLElement, ...children: Array<Node | string>): void {
  parent.textContent = '';
  append(parent, ...children);
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
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

export function composeClassName(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(' ');
}

export function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): ReturnType<typeof toDisposable>;
export function addDisposableListener<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): ReturnType<typeof toDisposable>;
export function addDisposableListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): ReturnType<typeof toDisposable>;
export function addDisposableListener(
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

export type DomNodePagePosition = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function getDomNodePagePosition(domNode: HTMLElement): DomNodePagePosition {
  const rect = domNode.getBoundingClientRect();
  return {
    left: rect.left + window.scrollX,
    top: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

export function getDomNodeZoomLevel(domNode: HTMLElement) {
  let current: HTMLElement | null = domNode;
  let zoom = 1;

  do {
    const computedZoom = Number.parseFloat(window.getComputedStyle(current).zoom);
    if (Number.isFinite(computedZoom) && computedZoom > 0 && computedZoom !== 1) {
      zoom *= computedZoom;
    }

    current = current.parentElement;
  } while (current && current !== document.documentElement);

  return zoom;
}
