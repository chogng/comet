import 'cs/base/browser/ui/selectbox/selectBoxCustom.css';
import type { IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import { Menu } from 'cs/base/browser/ui/menu/menu';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import type {
  ISelectOptionItem,
} from 'cs/base/browser/ui/selectbox/selectBox';

type SelectBoxCustomOptions = {
  selectElement: HTMLSelectElement;
  contextViewProvider: IContextViewProvider | undefined;
  getOptions: () => readonly ISelectOptionItem[];
  getSelectedIndex: () => number;
  onSelectIndex: (index: number) => void;
  contextViewLayer?: number;
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

export class SelectBoxCustom extends Disposable {
  private readonly selectElement: HTMLSelectElement;
  private readonly getOptions: () => readonly ISelectOptionItem[];
  private readonly getSelectedIndex: () => number;
  private readonly onSelectIndex: (index: number) => void;
  private readonly contextViewLayer: number | undefined;
  private readonly contextViewProvider: IContextViewProvider | undefined;
  private menu: Menu | null = null;
  private isMenuVisible = false;
  private activeOptionIndex = -1;
  private disposed = false;

  constructor(options: SelectBoxCustomOptions) {
    super();
    this.selectElement = options.selectElement;
    this.getOptions = options.getOptions;
    this.getSelectedIndex = options.getSelectedIndex;
    this.onSelectIndex = options.onSelectIndex;
    this.contextViewLayer = options.contextViewLayer;
    this.contextViewProvider = options.contextViewProvider;

    this._register(addDisposableListener(this.selectElement, 'click', this.handleClick));
    this._register(addDisposableListener(this.selectElement, 'mousedown', this.handleMouseDown));
    this._register(addDisposableListener(this.selectElement, 'keydown', this.handleKeyDown));
  }

  onOptionsChanged() {
    if (!this.isMenuVisible) {
      return;
    }

    this.hideMenu();
  }

  onSelectionChanged() {
    this.activeOptionIndex = this.resolveInitialActiveOptionIndex();
    this.syncMenuState();
  }

  override dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hideMenu();
    super.dispose();
  }

  private readonly handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.toggleMenu();
  };

  private readonly handleMouseDown = (event: MouseEvent) => {
    // Prevent the browser-native popup from opening in custom mode.
    event.preventDefault();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isMenuVisible) {
        this.showMenu();
        return;
      }
      this.activeOptionIndex = this.findNextEnabledOptionIndex(this.activeOptionIndex, 1);
      this.syncMenuState();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isMenuVisible) {
        this.showMenu();
        return;
      }
      this.activeOptionIndex = this.findNextEnabledOptionIndex(this.activeOptionIndex, -1);
      this.syncMenuState();
      return;
    }

    if (event.key === 'Home' && this.isMenuVisible) {
      event.preventDefault();
      event.stopPropagation();
      this.activeOptionIndex = this.findNextEnabledOptionIndex(-1, 1);
      this.syncMenuState();
      return;
    }

    if (event.key === 'End' && this.isMenuVisible) {
      event.preventDefault();
      event.stopPropagation();
      this.activeOptionIndex = this.findNextEnabledOptionIndex(this.getOptions().length, -1);
      this.syncMenuState();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isMenuVisible) {
        this.showMenu();
        return;
      }
      this.commitSelection(this.menu?.getActiveIndex() ?? this.activeOptionIndex);
      return;
    }

    if (event.key === 'Escape' && this.isMenuVisible) {
      event.preventDefault();
      event.stopPropagation();
      this.hideMenu();
      this.selectElement.focus();
    }
  };

  private readonly handleMenuHide = () => {
    this.isMenuVisible = false;
    this.menu?.dispose();
    this.menu = null;
  };

  private toggleMenu() {
    if (this.isMenuVisible) {
      this.hideMenu();
      return;
    }
    this.showMenu();
  }

  private showMenu() {
    if (this.disposed || this.isMenuVisible) {
      return;
    }

    this.activeOptionIndex = this.resolveInitialActiveOptionIndex();
    this.menu?.dispose();
    this.menu = this.createMenu();
    const menuElement = this.menu.getElement();
    menuElement.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    this.isMenuVisible = true;
    this.contextViewProvider?.showContextView({
      getAnchor: () => this.selectElement,
      render: (container) => {
        container.classList.add('comet-select-box-context-view');
        container.append(menuElement);
        return null;
      },
      onHide: this.handleMenuHide,
      layer: this.contextViewLayer,
    });
    this.syncMenuState();
  }

  private hideMenu() {
    if (!this.isMenuVisible) {
      return;
    }

    this.contextViewProvider?.hideContextView();
  }

  private resolveInitialActiveOptionIndex() {
    const selectedIndex = this.getSelectedIndex();
    const selectedOption = this.getOptions()[selectedIndex];
    if (selectedOption && !selectedOption.isDisabled) {
      return selectedIndex;
    }

    return this.findNextEnabledOptionIndex(-1, 1);
  }

  private findNextEnabledOptionIndex(startIndex: number, step: 1 | -1) {
    const options = this.getOptions();
    if (options.length === 0) {
      return -1;
    }

    let index = startIndex;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      index = (index + step + options.length) % options.length;
      if (!options[index]?.isDisabled) {
        return index;
      }
    }

    return -1;
  }

  private commitSelection(index: number) {
    const options = this.getOptions();
    if (index < 0 || index >= options.length) {
      return;
    }

    if (options[index]?.isDisabled) {
      return;
    }

    this.onSelectIndex(index);
    this.hideMenu();
    this.selectElement.focus();
  }

  private createMenu() {
    const menu = new Menu({
      items: this.createMenuItems(),
      role: 'listbox',
      itemRole: 'option',
      activeIndex: this.activeOptionIndex,
      onSelect: (event) => {
        this.commitSelection(event.index);
      },
      onCancel: () => {
        this.hideMenu();
      },
    });
    return menu;
  }

  private createMenuItems() {
    const selectedIndex = this.getSelectedIndex();
    const options = this.getOptions();
    return options.map((option, index) => ({
      id: String(index),
      label: option.text,
      tooltip: option.title ?? option.text,
      class: undefined,
      enabled: !option.isDisabled,
      checked: index === selectedIndex,
      run: () => {},
    }));
  }

  private syncMenuState() {
    if (!this.menu) {
      return;
    }

    this.menu.setOptions({
      items: this.createMenuItems(),
      role: 'listbox',
      itemRole: 'option',
      activeIndex: this.activeOptionIndex,
      onSelect: (event) => {
        this.commitSelection(event.index);
      },
      onCancel: () => {
        this.hideMenu();
      },
    });
  }
}
