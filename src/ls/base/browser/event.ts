import type { Event as BaseEvent } from 'ls/base/common/event';
import type { IDisposable } from 'ls/base/common/lifecycle';
import { toDisposable } from 'ls/base/common/lifecycle';

export type EventHandler = HTMLElement | HTMLDocument | Window;

export interface IDomEvent {
  <K extends keyof DOMEventMap>(
    element: EventHandler,
    type: K,
    useCapture?: boolean,
  ): BaseEvent<DOMEventMap[K]>;
  (element: EventHandler, type: string, useCapture?: boolean): BaseEvent<unknown>;
}

export type GestureEvent = Event;

export interface DOMEventMap extends HTMLElementEventMap, DocumentEventMap, WindowEventMap {
  '-monaco-gesturetap': GestureEvent;
  '-monaco-gesturechange': GestureEvent;
  '-monaco-gesturestart': GestureEvent;
  '-monaco-gesturesend': GestureEvent;
  '-monaco-gesturecontextmenu': GestureEvent;
  compositionstart: CompositionEvent;
  compositionupdate: CompositionEvent;
  compositionend: CompositionEvent;
}

export class DomEmitter<K extends keyof DOMEventMap> implements IDisposable {
  private readonly listeners = new Set<(event: DOMEventMap[K]) => void>();
  private readonly listener = (event: Event) => {
    for (const nextListener of [...this.listeners]) {
      nextListener(event as DOMEventMap[K]);
    }
  };
  private listening = false;
  private disposed = false;

  readonly event: BaseEvent<DOMEventMap[K]> = (listener) => {
    if (this.disposed) {
      return toDisposable(() => {});
    }

    this.listeners.add(listener);
    this.updateEventListener();
    return toDisposable(() => {
      this.listeners.delete(listener);
      this.updateEventListener();
    });
  };

  constructor(
    private readonly element: EventHandler,
    private readonly type: K,
    private readonly useCapture?: boolean,
  ) {}

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.removeEventListener();
    this.listeners.clear();
  }

  private updateEventListener() {
    if (this.disposed) {
      return;
    }

    if (this.listeners.size > 0 && !this.listening) {
      this.element.addEventListener(this.type, this.listener, this.useCapture);
      this.listening = true;
      return;
    }

    if (this.listeners.size === 0) {
      this.removeEventListener();
    }
  }

  private removeEventListener() {
    if (!this.listening) {
      return;
    }

    this.element.removeEventListener(this.type, this.listener, this.useCapture);
    this.listening = false;
  }
}
