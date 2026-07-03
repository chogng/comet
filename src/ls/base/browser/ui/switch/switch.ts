import 'ls/base/browser/ui/switch/switch.css';
import {
  getHoverService,
  type HoverHandle,
} from 'ls/base/browser/ui/hover/hover';
import { Disposable, toDisposable } from 'ls/base/common/lifecycle';

export interface SwitchProps {
  checked?: boolean;
  disabled?: boolean;
  label?: string | Node;
  className?: string;
  inputName?: string;
  value?: string;
  title?: string;
  animationKey?: string;
  onChange?: (checked: boolean, event: Event) => void;
}

const switchTransitionMemoryTtlMs = 260;

type SwitchTransitionMemory = {
  from: boolean;
  to: boolean;
  expiresAt: number;
};

const switchTransitionMemory = new Map<string, SwitchTransitionMemory>();

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function raf(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }

  const handle = globalThis.setTimeout(() => callback(now()), 16) as unknown as number;
  return handle;
}

function cancelRaf(handle: number) {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }

  globalThis.clearTimeout(handle);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function setOptionalAttribute(
  element: HTMLElement,
  attribute: string,
  value: string | undefined,
) {
  if (typeof value === 'string' && value.length > 0) {
    element.setAttribute(attribute, value);
    return;
  }

  element.removeAttribute(attribute);
}

function setLabelContent(target: HTMLElement, label: string | Node) {
  target.replaceChildren();
  if (label instanceof Node) {
    target.append(label);
    return;
  }

  target.textContent = label;
}

function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export class SwitchView extends Disposable {
  private props: SwitchProps;
  private readonly element = createElement('label', 'switch-root');
  private readonly inputElement = createElement('input', 'switch-input');
  private readonly sliderElement = createElement('span', 'switch-slider');
  private readonly labelElement = createElement('span', 'switch-label');
  private readonly hoverController: HoverHandle;
  private pendingAnimationFrame: number | undefined;
  private rendered = false;
  private disposed = false;

  constructor(props: SwitchProps = {}) {
    super();
    this.props = props;
    this.hoverController = getHoverService().createHover(this.element, null);
    this._register(this.hoverController);
    this.inputElement.type = 'checkbox';
    this._register(addDisposableListener(this.inputElement, 'change', this.handleChange));
    this.sliderElement.setAttribute('aria-hidden', 'true');
    this.element.append(this.inputElement, this.sliderElement);
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: SwitchProps = {}) {
    if (this.disposed) {
      return;
    }

    this.props = props;
    this.render();
  }

  focus() {
    if (this.disposed) {
      return;
    }

    this.inputElement.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelPendingAnimationFrame();
    super.dispose();
    this.element.replaceChildren();
    this.labelElement.replaceChildren();
  }

  private readonly handleChange = (event: Event) => {
    const checked = this.inputElement.checked;
    const previousChecked = this.props.checked ?? !checked;
    this.rememberTransition(previousChecked, checked);
    this.props = {
      ...this.props,
      checked,
    };
    this.props.onChange?.(checked, event);
    this.render();
  };

  private getAnimationKey() {
    const key = this.props.animationKey?.trim();
    return key ? key : undefined;
  }

  private rememberTransition(from: boolean, to: boolean) {
    const key = this.getAnimationKey();
    if (!key || from === to) {
      return;
    }

    const memory: SwitchTransitionMemory = {
      from,
      to,
      expiresAt: now() + switchTransitionMemoryTtlMs,
    };
    switchTransitionMemory.set(key, memory);
    globalThis.setTimeout(() => {
      if (switchTransitionMemory.get(key) === memory) {
        switchTransitionMemory.delete(key);
      }
    }, switchTransitionMemoryTtlMs);
  }

  private takeMountTransition(targetChecked: boolean) {
    const key = this.getAnimationKey();
    if (!key) {
      return undefined;
    }

    const memory = switchTransitionMemory.get(key);
    if (!memory || memory.to !== targetChecked || memory.from === targetChecked) {
      return undefined;
    }

    if (memory.expiresAt < now()) {
      switchTransitionMemory.delete(key);
      return undefined;
    }

    switchTransitionMemory.delete(key);
    return memory;
  }

  private cancelPendingAnimationFrame() {
    if (this.pendingAnimationFrame === undefined) {
      return;
    }

    cancelRaf(this.pendingAnimationFrame);
    this.pendingAnimationFrame = undefined;
  }

  private scheduleCheckedAnimation(targetChecked: boolean) {
    this.cancelPendingAnimationFrame();
    this.pendingAnimationFrame = raf(() => {
      this.pendingAnimationFrame = raf(() => {
        this.pendingAnimationFrame = undefined;
        if (this.disposed) {
          return;
        }

        this.inputElement.checked = targetChecked;
      });
    });
  }

  private render() {
    const {
      checked = false,
      disabled = false,
      label,
      className = '',
      inputName,
      value,
      title,
    } = this.props;

    this.element.className = [
      'switch-root',
      disabled ? 'switch-disabled' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    setOptionalAttribute(this.inputElement, 'name', inputName);
    setOptionalAttribute(this.inputElement, 'value', value);

    const mountTransition = this.rendered ? undefined : this.takeMountTransition(checked);
    this.inputElement.checked = mountTransition?.from ?? checked;
    this.inputElement.disabled = disabled;
    this.rendered = true;
    if (mountTransition) {
      this.scheduleCheckedAnimation(checked);
    }

    if (title) {
      this.hoverController.update(title);
      this.element.removeAttribute('title');
      this.inputElement.setAttribute('aria-label', title);
    } else {
      this.hoverController.update(null);
      if (typeof label === 'string' && label.length > 0) {
        this.inputElement.removeAttribute('aria-label');
      } else {
        this.inputElement.setAttribute('aria-label', 'Toggle');
      }
    }

    if (typeof label === 'string' ? label.length > 0 : Boolean(label)) {
      setLabelContent(this.labelElement, label as string | Node);
      if (!this.labelElement.parentElement) {
        this.element.append(this.labelElement);
      }
    } else {
      this.labelElement.replaceChildren();
      this.labelElement.remove();
    }
  }
}

export function createSwitchView(props: SwitchProps = {}) {
  return new SwitchView(props);
}
