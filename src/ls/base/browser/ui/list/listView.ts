import 'ls/base/browser/ui/list/list.css';

import {
  Disposable,
  DisposableStore,
  type DisposableInput,
} from 'ls/base/common/lifecycle';

export type ListViewItemState = {
  itemId: string;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
};

export type ListViewRenderItem<T> = {
  item: T;
  state: ListViewItemState;
  onDidRender?: (element: HTMLElement) => DisposableInput;
};

export type ListViewRenderer<T> = {
  renderElement(item: T, state: ListViewItemState): HTMLElement;
};

function escapeAttributeSelectorValue(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, '\\$&');
}

export class ListView<T> extends Disposable {
  private readonly element = document.createElement('div');
  private readonly renderDisposables = new DisposableStore();
  private disposed = false;

  constructor(
    private readonly renderer: ListViewRenderer<T>,
    options: {
      role?: string;
      ariaLabel?: string;
    } = {},
  ) {
    super();
    this._register(this.renderDisposables);
    this.element.className = 'list-view';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', options.role ?? 'listbox');
    if (options.ariaLabel) {
      this.element.setAttribute('aria-label', options.ariaLabel);
    }
  }

  getElement() {
    return this.element;
  }

  setAriaLabel(label: string) {
    if (this.disposed) {
      return;
    }

    this.element.setAttribute('aria-label', label);
  }

  focus() {
    if (this.disposed) {
      return;
    }

    this.element.focus();
  }

  focusItem(itemId: string) {
    if (this.disposed || document.activeElement !== this.element) {
      return;
    }

    const activeRow = this.element.querySelector<HTMLElement>(
      `[data-list-item-id="${escapeAttributeSelectorValue(itemId)}"]`,
    );
    activeRow?.focus();
  }

  setItems(items: readonly ListViewRenderItem<T>[]) {
    if (this.disposed) {
      return;
    }

    this.renderDisposables.clear();
    const fragment = document.createDocumentFragment();

    for (const { item, state, onDidRender } of items) {
      const element = this.renderer.renderElement(item, state);
      element.dataset['listItemId'] = state.itemId;
      element.tabIndex = state.isFocused ? 0 : -1;
      element.classList.add('list-view-row');
      element.setAttribute('aria-selected', String(state.isSelected));
      element.classList.toggle('is-selected', state.isSelected);
      element.classList.toggle('is-focused', state.isFocused);
      if (!element.getAttribute('role') && this.element.getAttribute('role') === 'listbox') {
        element.setAttribute('role', 'option');
      }
      const disposable = onDidRender?.(element);
      if (disposable) {
        if (typeof disposable === 'function') {
          this.renderDisposables.add(disposable);
        } else {
          this.renderDisposables.add(disposable);
        }
      }
      fragment.append(element);
    }

    this.element.replaceChildren(fragment);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.element.replaceChildren();
  }
}
