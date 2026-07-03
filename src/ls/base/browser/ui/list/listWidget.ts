import { ListView, type ListViewItemState } from 'ls/base/browser/ui/list/listView';
import {
  Disposable,
  MutableDisposable,
  combinedDisposable,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';

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

function createTimeoutDisposable(callback: () => void, delay: number): DisposableLike {
  let handle: number | null = window.setTimeout(() => {
    handle = null;
    callback();
  }, delay);

  return toDisposable(() => {
    if (handle === null) {
      return;
    }

    window.clearTimeout(handle);
    handle = null;
  });
}

export type ListRenderContext = ListViewItemState & {
  select: () => void;
  open: () => void;
};

export type ListRenderer<T> = {
  renderElement(item: T, context: ListRenderContext): HTMLElement;
};

export type ListKeyDownContext<T> = {
  items: readonly T[];
  activeIndex: number;
  activeItem: T;
  setFocus: (item: T | null) => void;
  setSelection: (item: T | null) => void;
  open: (item: T) => void;
  rerender: () => void;
};

export type ListOptions<T> = {
  getId: (item: T) => string;
  getLabel?: (item: T) => string;
  ariaLabel?: string;
  role?: string;
  onDidChangeSelection?: (item: T | null) => void;
  onDidOpen?: (item: T) => void;
  onKeyDown?: (event: KeyboardEvent, context: ListKeyDownContext<T>) => boolean;
};

export class ListWidget<T> extends Disposable {
  private readonly view: ListView<T>;
  private readonly typeaheadReset = new MutableDisposable<DisposableLike>();
  private items: readonly T[] = [];
  private selectedId: string | null = null;
  private focusedId: string | null = null;
  private typeaheadBuffer = '';
  private disposed = false;

  constructor(
    renderer: ListRenderer<T>,
    private readonly options: ListOptions<T>,
  ) {
    super();
    this.view = this._register(new ListView<T>(
      {
        renderElement: (item, state) =>
          renderer.renderElement(item, {
            ...state,
            select: () => {
              this.selectItem(item);
            },
            open: () => {
              this.options.onDidOpen?.(item);
            },
          }),
      },
      {
        role: options.role,
        ariaLabel: options.ariaLabel,
      },
    ));
    this._register(this.typeaheadReset);
    this._register(addDisposableListener(this.view.getElement(), 'keydown', this.handleKeyDown));
    this._register(addDisposableListener(this.view.getElement(), 'focus', this.handleElementFocus));
  }

  getElement() {
    return this.view.getElement();
  }

  setAriaLabel(label: string) {
    if (this.disposed) {
      return;
    }

    this.view.setAriaLabel(label);
  }

  focus() {
    if (this.disposed) {
      return;
    }

    this.view.focus();
  }

  getItems() {
    return this.items;
  }

  getSelection() {
    if (this.disposed || !this.selectedId) {
      return null;
    }

    return this.items.find((item) => this.options.getId(item) === this.selectedId) ?? null;
  }

  setSelection(item: T | null) {
    if (this.disposed) {
      return;
    }

    const nextSelectedId = item ? this.options.getId(item) : null;
    if (nextSelectedId && !this.hasItem(nextSelectedId)) {
      return;
    }

    this.selectedId = nextSelectedId;
    this.options.onDidChangeSelection?.(item);
    this.rerender();
  }

  getFocus() {
    if (this.disposed || !this.focusedId) {
      return null;
    }

    return this.items.find((item) => this.options.getId(item) === this.focusedId) ?? null;
  }

  setFocus(item: T | null) {
    if (this.disposed) {
      return;
    }

    const nextFocusedId = item ? this.options.getId(item) : null;
    if (nextFocusedId && !this.hasItem(nextFocusedId)) {
      return;
    }

    this.focusedId = nextFocusedId;
    this.rerender();
  }

  setItems(items: readonly T[]) {
    if (this.disposed) {
      return;
    }

    this.items = items;
    if (items.length === 0) {
      const hadSelection = this.selectedId !== null;
      this.selectedId = null;
      this.focusedId = null;
      if (hadSelection) {
        this.options.onDidChangeSelection?.(null);
      }
      this.render();
      return;
    }

    if (!this.focusedId) {
      this.focusedId = this.options.getId(items[0]);
    }
    if (this.selectedId && !this.hasItem(this.selectedId)) {
      this.selectedId = null;
      this.options.onDidChangeSelection?.(null);
    }
    if (this.focusedId && !this.hasItem(this.focusedId)) {
      this.focusedId = this.options.getId(items[0]);
    }
    this.render();
  }

  rerender() {
    if (this.disposed) {
      return;
    }

    this.render();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.items = [];
    this.selectedId = null;
    this.focusedId = null;
    this.typeaheadBuffer = '';
    super.dispose();
  }

  private render() {
    this.view.setItems(
      this.items.map((item, index) => {
        const itemId = this.options.getId(item);
        return {
          item,
          state: {
            itemId,
            index,
            isSelected: this.selectedId === itemId,
            isFocused: this.focusedId === itemId,
          },
          onDidRender: (element: HTMLElement) => combinedDisposable(
            addDisposableListener(element, 'mousedown', () => {
              this.focusedId = itemId;
            }),
            addDisposableListener(element, 'click', () => {
              this.selectItem(item);
              this.view.getElement().focus({ preventScroll: true });
            }),
          ),
        };
      }),
    );
    if (this.focusedId) {
      this.view.focusItem(this.focusedId);
    }
  }

  private readonly handleElementFocus = () => {
    if (!this.focusedId) {
      const firstItem = this.items[0];
      if (firstItem) {
        this.focusedId = this.options.getId(firstItem);
        this.rerender();
      }
      return;
    }

    this.view.focusItem(this.focusedId);
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.items.length === 0) {
      return;
    }

    const focusedIndex = this.items.findIndex(
      (item) => this.options.getId(item) === this.focusedId,
    );
    const activeIndex = focusedIndex >= 0 ? focusedIndex : 0;
    const activeItem = this.items[activeIndex];
    if (!activeItem) {
      return;
    }

    const customHandled = this.options.onKeyDown?.(event, {
      items: this.items,
      activeIndex,
      activeItem,
      setFocus: (item) => {
        this.focusedId = item ? this.options.getId(item) : null;
      },
      setSelection: (item) => {
        this.selectedId = item ? this.options.getId(item) : null;
        this.options.onDidChangeSelection?.(item);
      },
      open: (item) => {
        this.options.onDidOpen?.(item);
      },
      rerender: () => {
        this.rerender();
      },
    });
    if (customHandled) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown': {
        const nextItem = this.items[Math.min(activeIndex + 1, this.items.length - 1)];
        if (nextItem) {
          this.focusedId = this.options.getId(nextItem);
          this.rerender();
        }
        event.preventDefault();
        break;
      }
      case 'ArrowUp': {
        const previousItem = this.items[Math.max(activeIndex - 1, 0)];
        if (previousItem) {
          this.focusedId = this.options.getId(previousItem);
          this.rerender();
        }
        event.preventDefault();
        break;
      }
      case 'Home': {
        const firstItem = this.items[0];
        if (firstItem) {
          this.focusedId = this.options.getId(firstItem);
          this.rerender();
        }
        event.preventDefault();
        break;
      }
      case 'End': {
        const lastItem = this.items[this.items.length - 1];
        if (lastItem) {
          this.focusedId = this.options.getId(lastItem);
          this.rerender();
        }
        event.preventDefault();
        break;
      }
      case 'Enter': {
        this.selectItem(activeItem, true);
        event.preventDefault();
        break;
      }
      case ' ': {
        this.selectItem(activeItem);
        event.preventDefault();
        break;
      }
      default: {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.handleTypeahead(event.key, activeIndex);
          event.preventDefault();
        }
        break;
      }
    }
  };

  private selectItem(item: T, open: boolean = false) {
    this.selectedId = this.options.getId(item);
    this.focusedId = this.selectedId;
    this.options.onDidChangeSelection?.(item);
    if (open) {
      this.options.onDidOpen?.(item);
    }
    this.rerender();
  }

  private handleTypeahead(key: string, activeIndex: number) {
    this.typeaheadBuffer += key.toLocaleLowerCase();
    this.scheduleTypeaheadReset();

    const searchOrder = [
      ...this.items.slice(activeIndex + 1),
      ...this.items.slice(0, activeIndex + 1),
    ];
    const matched = searchOrder.find((item) =>
      this.getItemLabel(item).startsWith(this.typeaheadBuffer),
    );
    if (!matched) {
      return;
    }

    this.focusedId = this.options.getId(matched);
    this.rerender();
  }

  private getItemLabel(item: T) {
    return (this.options.getLabel?.(item) ?? this.options.getId(item))
      .trim()
      .toLocaleLowerCase();
  }

  private scheduleTypeaheadReset() {
    this.typeaheadReset.value = createTimeoutDisposable(() => {
      this.typeaheadBuffer = '';
    }, 700);
  }

  private hasItem(itemId: string) {
    return this.items.some((item) => this.options.getId(item) === itemId);
  }
}
