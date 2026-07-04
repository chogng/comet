import * as DOM from 'cs/base/browser/dom';
import {
  bindHover,
  getBaseLayerHoverDelegate,
} from 'cs/base/browser/ui/hover/hoverDelegate';
import type {
  HoverBinding,
  HoverInput,
  IHoverDelegate,
} from 'cs/base/browser/ui/hover/hover';
import { Disposable } from 'cs/base/common/lifecycle';
import type {
  ActionBarActionItem,
  ActionView,
} from 'cs/base/browser/ui/actionbar/actionbar';

// Actionbar treats icon-only labels as hover/tooltip content, not as an IconLabel
// display primitive. The rendered button can stay icon-only while hover resolves
// from item.hover -> item.title -> item.label, and aria-label still comes from label.

export type BaseActionViewItemOptions = {
  hoverService?: IHoverDelegate;
};

export type ActionViewItemOptions = BaseActionViewItemOptions;

type ActionViewRenderable = NonNullable<ActionBarActionItem['content']>;
type ActionViewMode = NonNullable<ActionBarActionItem['mode']>;

export abstract class BaseActionViewItem
  extends Disposable
  implements ActionView
{
  // Shared lifecycle and DOM ownership live in the base class so concrete items
  // only implement their specific rendering and interaction behavior.
  protected readonly element: HTMLElement;
  private disposed = false;

  constructor(element?: HTMLElement) {
    super();
    this.element = element ?? document.createElement('div');
  }

  getElement() {
    return this.element;
  }

  render(container?: HTMLElement) {
    if (this.disposed) {
      return;
    }

    if (container && this.element.parentElement !== container) {
      container.append(this.element);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.element.remove();
    super.dispose();
  }

  isDisposed() {
    return this.disposed;
  }

  focus?(): void;

  blur?(): void;

  getFocusableElement?(): HTMLElement | null;
}

function resolveHoverService(
  optionsOrHoverService: ActionViewItemOptions | IHoverDelegate,
): IHoverDelegate {
  if (isHoverDelegate(optionsOrHoverService)) {
    return optionsOrHoverService;
  }

  return optionsOrHoverService.hoverService ?? getBaseLayerHoverDelegate();
}

function resolveRenderable(renderable: ActionViewRenderable): Node {
  const resolved = typeof renderable === 'function' ? renderable() : renderable;
  if (typeof resolved === 'string') {
    return document.createTextNode(resolved);
  }
  return resolved.cloneNode(true);
}

function resolveMode(item: ActionBarActionItem): ActionViewMode {
  if (item.mode) {
    return item.mode;
  }
  return 'icon';
}

function resolveHoverInput(item: ActionBarActionItem): HoverInput {
  return item.hover === undefined ? item.title ?? item.label : item.hover;
}

function applyPressedState(button: HTMLButtonElement, checked?: boolean) {
  if (checked !== undefined) {
    button.setAttribute('aria-pressed', String(Boolean(checked)));
    return;
  }

  button.removeAttribute('aria-pressed');
}

function applyButtonAttributes(
  button: HTMLButtonElement,
  attributes: ActionBarActionItem['buttonAttributes'],
) {
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === false || value === null || value === undefined) {
      button.removeAttribute(name);
      continue;
    }
    button.setAttribute(name, value);
  }
}

export class ActionViewItem extends BaseActionViewItem {
  protected readonly button = DOM.$<HTMLButtonElement>('button.comet-actionbar-action');
  protected readonly content = DOM.$<HTMLSpanElement>('span.comet-actionbar-content');
  protected item: ActionBarActionItem;
  protected readonly hoverBinding: HoverBinding;

  constructor(item: ActionBarActionItem, options?: ActionViewItemOptions);
  constructor(item: ActionBarActionItem, hoverService?: IHoverDelegate);
  constructor(
    item: ActionBarActionItem,
    optionsOrHoverService: ActionViewItemOptions | IHoverDelegate = getBaseLayerHoverDelegate(),
  ) {
    const hoverService = resolveHoverService(optionsOrHoverService);

    super(DOM.$('div.comet-actionbar-item.comet-is-action'));
    this.item = item;
    this.button.type = 'button';
    this.button.append(this.content);
    this.element.append(this.button);
    this.hoverBinding = bindHover(this.button, null, hoverService);
    this._register(this.hoverBinding);
    this._register(DOM.addDisposableListener(this.button, 'click', this.handleButtonClick));
    this.render();
  }

  setItem(item: ActionBarActionItem) {
    this.item = item;
    this.render();
  }

  override render(container?: HTMLElement) {
    if (this.isDisposed()) {
      return;
    }

    super.render(container);
    this.updateContainerClassName();
    this.updateButtonState();
    this.updateAccessibility();
    this.updateTooltip();
    this.updateContent();
  }

  focus() {
    this.button.focus();
  }

  blur() {
    this.button.blur();
  }

  getFocusableElement() {
    return this.button;
  }

  private readonly handleButtonClick = (event: MouseEvent) => {
    this.handleClick(event);
  };

  protected readonly handleClick = (event: MouseEvent) => {
    if (this.item.onClick) {
      this.item.onClick(event);
      return;
    }

    this.item.run?.();
  };

  protected updateContainerClassName() {
    this.element.className = DOM.composeClassName([
      'comet-actionbar-item',
      'comet-is-action',
      this.item.disabled ? 'comet-is-disabled' : '',
      this.item.active ? 'comet-is-active' : '',
      this.item.checked ? 'comet-is-checked' : '',
      this.item.className,
    ]);
  }

  protected updateButtonState() {
    const mode = resolveMode(this.item);
    this.button.className = DOM.composeClassName([
      'comet-actionbar-action',
      `comet-is-${mode}`,
      this.item.buttonClassName,
    ]);
    this.button.disabled = Boolean(this.item.disabled);
    applyPressedState(this.button, this.item.checked);
    applyButtonAttributes(this.button, this.item.buttonAttributes);
  }

  protected updateAccessibility() {
    this.button.setAttribute('aria-label', this.item.label);
  }

  protected updateTooltip() {
    this.hoverBinding.update(resolveHoverInput(this.item));
  }

  protected updateContent() {
    this.content.replaceChildren(
      resolveRenderable(this.item.content ?? this.item.label),
    );
  }
}

function isHoverDelegate(
  value: ActionViewItemOptions | IHoverDelegate,
): value is IHoverDelegate {
  return typeof (value as IHoverDelegate).createHover === 'function';
}
