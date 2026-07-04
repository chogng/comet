import 'cs/base/browser/ui/button/button.css';
import { getBaseLayerHoverDelegate } from 'cs/base/browser/ui/hover/hoverDelegate';
import type {
  HoverHandle,
  HoverInput,
  IHoverDelegate,
} from 'cs/base/browser/ui/hover/hover';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';
export type ButtonMode = 'text' | 'icon';
export type ButtonContentMode = 'with' | 'without';
export type ButtonContent = string | number | Node | null | undefined | false;

export interface ButtonProps {
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  mode?: ButtonMode;
  iconMode?: ButtonContentMode;
  textMode?: ButtonContentMode;
  isLoading?: boolean;
  leftIcon?: ButtonContent;
  rightIcon?: ButtonContent;
  content?: ButtonContent;
  children?: ButtonContent;
  disabled?: boolean;
  title?: string;
  hover?: HoverInput;
  ariaLabel?: string;
  type?: 'button' | 'submit' | 'reset';
  hoverService?: IHoverDelegate;
  onClick?: (event: MouseEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
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

function isPresent(value: ButtonContent) {
  return value !== null && value !== undefined && value !== false;
}

function isNodeContent(value: ButtonContent): value is Node {
  return value instanceof Node;
}

function appendButtonContent(target: HTMLElement, content: ButtonContent) {
  if (!isPresent(content)) {
    return;
  }

  if (isNodeContent(content)) {
    target.append(content);
    return;
  }

  target.append(document.createTextNode(String(content)));
}

function createSpinnerIcon() {
  const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spinner.setAttribute('class', 'btn-spinner');
  spinner.setAttribute('viewBox', '0 0 24 24');
  spinner.setAttribute('width', '16');
  spinner.setAttribute('height', '16');
  spinner.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '2');
  circle.setAttribute('stroke-linecap', 'round');
  circle.setAttribute('stroke-dasharray', '42 18');
  spinner.append(circle);

  return spinner;
}

function createContentWrapper(className: string, content: ButtonContent) {
  const wrapper = createElement('span', className);
  appendButtonContent(wrapper, content);
  return wrapper;
}

function resolveButtonContent(props: ButtonProps) {
  if (isPresent(props.children)) {
    return props.children;
  }

  return props.content;
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

export class ButtonView extends Disposable {
  private props: ButtonProps;
  private readonly element = createElement('button');
  private readonly hoverController: HoverHandle;
  private disposed = false;

  constructor(props: ButtonProps = {}) {
    super();
    this.props = props;
    const hoverService = props.hoverService ?? getBaseLayerHoverDelegate();
    this.hoverController = hoverService.createHover(this.element, null);
    this._register(this.hoverController);
    this._register(addDisposableListener(this.element, 'click', this.handleClick));
    this._register(addDisposableListener(this.element, 'focus', this.handleFocus));
    this._register(addDisposableListener(this.element, 'blur', this.handleBlur));
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: ButtonProps = {}) {
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

    this.element.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.element.replaceChildren();
  }

  private readonly handleClick = (event: MouseEvent) => {
    this.props.onClick?.(event);
  };

  private readonly handleFocus = (event: FocusEvent) => {
    this.props.onFocus?.(event);
  };

  private readonly handleBlur = (event: FocusEvent) => {
    this.props.onBlur?.(event);
  };

  private render() {
    const {
      className = '',
      variant = 'secondary',
      size = 'md',
      mode = 'text',
      iconMode = 'with',
      textMode = mode === 'icon' ? 'without' : 'with',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled = false,
      title,
      hover,
      ariaLabel,
      type = 'button',
    } = this.props;

    const content = resolveButtonContent(this.props);
    const hasContent = isPresent(content);
    const showText = textMode === 'with' && hasContent;
    const hasLeftIcon = isPresent(leftIcon);
    const hasRightIcon = isPresent(rightIcon);
    const showLeftIcon = !isLoading && iconMode === 'with' && hasLeftIcon;
    const showRightIcon = !isLoading && iconMode === 'with' && hasRightIcon;
    const showChildrenAsIcon =
      !isLoading &&
      iconMode === 'with' &&
      !showText &&
      !hasLeftIcon &&
      !hasRightIcon &&
      hasContent;

    this.element.className = [
      'btn-base',
      `btn-${variant}`,
      `btn-${size}`,
      `btn-mode-${mode}`,
      isLoading ? 'btn-loading' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    this.element.type = type;
    this.element.disabled = isLoading || disabled;

    const resolvedHover = hover === undefined ? title ?? null : hover;
    this.hoverController.update(resolvedHover);
    this.element.removeAttribute('title');

    if (ariaLabel) {
      this.element.setAttribute('aria-label', ariaLabel);
    } else {
      this.element.removeAttribute('aria-label');
    }

    const nextChildren: Node[] = [];
    if (isLoading) {
      nextChildren.push(createSpinnerIcon());
    }

    if (showLeftIcon) {
      nextChildren.push(createContentWrapper('btn-icon-left', leftIcon));
    }

    if (showChildrenAsIcon) {
      nextChildren.push(createContentWrapper('btn-icon-only', content));
    }

    if (showText) {
      nextChildren.push(createContentWrapper('btn-content', content));
    }

    if (showRightIcon) {
      nextChildren.push(createContentWrapper('btn-icon-right', rightIcon));
    }

    this.element.replaceChildren(...nextChildren);
  }
}

export function createButtonView(props: ButtonProps = {}) {
  return new ButtonView(props);
}
