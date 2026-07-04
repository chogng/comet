import 'cs/base/browser/ui/inputbox/inputBox.css';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';

export interface IInputBoxOptions {
  readonly placeholder?: string;
  readonly tooltip?: string;
  readonly ariaLabel?: string;
  readonly type?: HTMLInputElement['type'];
  readonly value?: string;
  readonly className?: string;
  readonly inputAttributes?: {
    readonly readOnly?: boolean;
    readonly disabled?: boolean;
    readonly min?: string;
    readonly max?: string;
    readonly step?: string;
    readonly inputMode?: HTMLInputElement['inputMode'];
    readonly autocomplete?: HTMLInputElement['autocomplete'];
    readonly spellcheck?: boolean;
    readonly autocorrect?: string;
    readonly autocapitalize?: string;
  };
}

export type InputBoxSelectionRange = {
  start: number;
  end: number;
};

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

export class InputBox extends Disposable {
  readonly element: HTMLElement;
  readonly inputElement: HTMLInputElement;
  private readonly changeEmitter = new EventEmitter<string>();
  private disposed = false;

  constructor(container: HTMLElement, _contextViewProvider: unknown, options: IInputBoxOptions = {}) {
    super();
    const inputAttributes = options.inputAttributes;
    this.element = document.createElement('div');
    this.element.className = ['comet-inputbox', 'comet-idle', options.className ?? '']
      .filter(Boolean)
      .join(' ');

    const wrapper = document.createElement('div');
    wrapper.className = 'comet-inputbox-wrapper';

    this.inputElement = document.createElement('input');
    this.inputElement.className = 'comet-input';
    this.inputElement.type = options.type ?? 'text';
    this.inputElement.value = options.value ?? '';
    this.inputElement.readOnly = Boolean(inputAttributes?.readOnly);
    this.inputElement.disabled = Boolean(inputAttributes?.disabled);
    this.inputElement.autocomplete = inputAttributes?.autocomplete ?? 'off';
    this.inputElement.spellcheck = inputAttributes?.spellcheck ?? false;
    this.inputElement.setAttribute('autocorrect', inputAttributes?.autocorrect ?? 'off');
    this.inputElement.setAttribute('autocapitalize', inputAttributes?.autocapitalize ?? 'off');
    if (inputAttributes?.min !== undefined) {
      this.inputElement.min = inputAttributes.min;
    }
    if (inputAttributes?.max !== undefined) {
      this.inputElement.max = inputAttributes.max;
    }
    if (inputAttributes?.step !== undefined) {
      this.inputElement.step = inputAttributes.step;
    }
    if (inputAttributes?.inputMode !== undefined) {
      this.inputElement.inputMode = inputAttributes.inputMode;
    }

    wrapper.append(this.inputElement);
    this.element.append(wrapper);
    container.append(this.element);
    this._register(this.changeEmitter);

    if (options.ariaLabel) {
      this.inputElement.setAttribute('aria-label', options.ariaLabel);
    }

    this.setPlaceHolder(options.placeholder ?? '');
    this.setTooltip(options.tooltip ?? options.placeholder ?? '');

    this._register(addDisposableListener(this.inputElement, 'input', this.handleInput));
    this._register(addDisposableListener(this.inputElement, 'focus', this.handleFocus));
    this._register(addDisposableListener(this.inputElement, 'blur', this.handleBlur));
  }

  get value() {
    return this.inputElement.value;
  }

  set value(value: string) {
    this.inputElement.value = value;
    this.syncEmptyState();
  }

  onDidChange(listener: (value: string) => void) {
    return this.changeEmitter.event(listener);
  }

  focus() {
    if (!this.disposed) {
      this.inputElement.focus();
    }
  }

  blur() {
    if (!this.disposed) {
      this.inputElement.blur();
    }
  }

  hasFocus() {
    return !this.disposed && document.activeElement === this.inputElement;
  }

  select(range: InputBoxSelectionRange | null = null) {
    if (!this.disposed) {
      this.inputElement.select();
      if (range) {
        this.inputElement.setSelectionRange(range.start, range.end);
        if (range.end === this.inputElement.value.length) {
          this.inputElement.scrollLeft = this.inputElement.scrollWidth;
        }
      }
    }
  }

  setPlaceHolder(placeholder: string) {
    this.inputElement.placeholder = placeholder;
    this.syncHover();
  }

  setTooltip(_tooltip: string) {
    this.syncHover();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.element.remove();
  }

  private readonly handleInput = () => {
    this.syncEmptyState();
    this.changeEmitter.fire(this.inputElement.value);
  };

  private readonly handleFocus = () => {
    this.element.classList.add('comet-synthetic-focus');
  };

  private readonly handleBlur = () => {
    this.element.classList.remove('comet-synthetic-focus');
  };

  private syncEmptyState() {
    this.element.classList.toggle('comet-empty', this.inputElement.value.length === 0);
    this.inputElement.classList.toggle('comet-empty', this.inputElement.value.length === 0);
  }

  private syncHover() {
    this.element.removeAttribute('title');
  }
}
