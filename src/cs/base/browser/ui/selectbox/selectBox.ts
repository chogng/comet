import 'cs/base/browser/ui/selectbox/selectBox.css';
import { EventEmitter, type Event as LsEvent } from 'cs/base/common/event';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { SelectBoxCustom } from 'cs/base/browser/ui/selectbox/selectBoxCustom';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';

export interface ISelectBoxOptions {
  useCustomDrawn?: boolean;
  ariaLabel?: string;
  ariaDescription?: string;
  className?: string;
}

export interface ISelectOptionItem {
  text: string;
  value?: string;
  title?: string;
  detail?: string;
  decoratorRight?: string;
  description?: string;
  descriptionIsMarkdown?: boolean;
  isDisabled?: boolean;
}

export interface ISelectBoxStyles {
  selectBackground?: string;
  selectListBackground?: string;
  selectForeground?: string;
  decoratorRightForeground?: string;
  selectBorder?: string;
  selectListBorder?: string;
  focusBorder?: string;
}

export interface ISelectData {
  selected: string;
  index: number;
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

function clampSelectedIndex(index: number, optionCount: number) {
  if (optionCount <= 0) {
    return -1;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= optionCount) {
    return optionCount - 1;
  }

  return index;
}

function createDecoratorIconElement() {
  const decorator = document.createElement('span');
  decorator.className = 'comet-select-box-decorator';
  decorator.setAttribute('aria-hidden', 'true');
  decorator.append(createLxIcon('unfold'));
  return decorator;
}

export class SelectBox extends Disposable {
  private options: ISelectOptionItem[] = [];
  private selected = 0;
  private styles: ISelectBoxStyles;
  private readonly selectBoxOptions: ISelectBoxOptions;
  private readonly selectElement = document.createElement('select');
  private readonly decoratorElement = createDecoratorIconElement();
  private readonly customSelectBox: SelectBoxCustom | null;
  private readonly selectEmitter = new EventEmitter<ISelectData>();
  private renderContainer: HTMLElement | null = null;
  private disposed = false;

  readonly onDidSelect: LsEvent<ISelectData> = this.selectEmitter.event;

  constructor(
    options: ISelectOptionItem[],
    selected: number,
    contextViewProvider: unknown,
    styles: ISelectBoxStyles = {},
    selectBoxOptions: ISelectBoxOptions = {},
  ) {
    super();
    this.styles = styles;
    this.selectBoxOptions = selectBoxOptions;
    const useCustomDrawn = Boolean(selectBoxOptions.useCustomDrawn);
    this.customSelectBox = useCustomDrawn
      ? new SelectBoxCustom({
          selectElement: this.selectElement,
          contextViewProvider,
          getOptions: () => this.options,
          getSelectedIndex: () => this.selected,
          onSelectIndex: (index) => this.commitCustomSelection(index),
        })
      : null;

    this.selectElement.className = ['comet-select-box', selectBoxOptions.className ?? '']
      .filter(Boolean)
      .join(' ');
    this.selectElement.classList.toggle('comet-select-box-custom', useCustomDrawn);

    if (typeof this.selectBoxOptions.ariaLabel === 'string') {
      this.selectElement.setAttribute('aria-label', this.selectBoxOptions.ariaLabel);
    }

    if (typeof this.selectBoxOptions.ariaDescription === 'string') {
      this.selectElement.setAttribute('aria-description', this.selectBoxOptions.ariaDescription);
    }

    this._register(this.selectEmitter);
    if (this.customSelectBox) {
      this._register(this.customSelectBox);
    }
    this._register(addDisposableListener(this.selectElement, 'change', this.handleChange));
    if (!this.customSelectBox) {
      this._register(addDisposableListener(this.selectElement, 'click', this.handleClick));
    }
    this.setOptions(options, selected);
  }

  get domNode() {
    return this.selectElement;
  }

  get value() {
    return this.selectElement.value;
  }

  setOptions(options: ISelectOptionItem[], selected?: number): void {
    if (this.disposed) {
      return;
    }

    this.options = [...options];
    this.selectElement.options.length = 0;
    for (const option of this.options) {
      this.selectElement.add(this.createOption(option));
    }

    this.customSelectBox?.onOptionsChanged();

    if (selected !== undefined) {
      this.select(selected);
      return;
    }

    this.select(this.selected);
  }

  select(index: number): void {
    if (this.disposed) {
      return;
    }

    this.selected = clampSelectedIndex(index, this.options.length);
    this.selectElement.selectedIndex = this.selected;
    this.syncTitle();
    this.customSelectBox?.onSelectionChanged();
  }

  setAriaLabel(label: string): void {
    if (this.disposed) {
      return;
    }

    this.selectBoxOptions.ariaLabel = label;
    this.selectElement.setAttribute('aria-label', label);
  }

  focus(): void {
    if (this.disposed) {
      return;
    }

    this.selectElement.tabIndex = 0;
    this.selectElement.focus();
  }

  blur(): void {
    if (this.disposed) {
      return;
    }

    this.selectElement.tabIndex = -1;
    this.selectElement.blur();
  }

  setFocusable(focusable: boolean): void {
    if (this.disposed) {
      return;
    }

    this.selectElement.tabIndex = focusable ? 0 : -1;
  }

  render(container: HTMLElement): void {
    if (this.disposed) {
      return;
    }

    this.renderContainer = container;
    container.classList.add('comet-select-container');
    container.append(this.selectElement, this.decoratorElement);
    this.applyStyles();
  }

  style(styles: ISelectBoxStyles): void {
    if (this.disposed) {
      return;
    }

    this.styles = styles;
    this.applyStyles();
  }

  applyStyles(): void {
    if (this.disposed) {
      return;
    }

    if (this.renderContainer) {
      this.renderContainer.style.color =
        this.styles.selectForeground
        ?? 'var(--vscode-select-foreground, #203040)';
    }
    this.selectElement.style.backgroundColor = this.styles.selectBackground ?? '';
    this.selectElement.style.color = this.styles.selectForeground ?? '';
    this.selectElement.style.borderColor = this.styles.selectBorder ?? '';
    if (this.styles.focusBorder) {
      this.selectElement.style.setProperty('--cs-select-focusBorder', this.styles.focusBorder);
    } else {
      this.selectElement.style.removeProperty('--cs-select-focusBorder');
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.renderContainer = null;
    super.dispose();
    this.selectElement.remove();
    this.decoratorElement.remove();
  }

  private readonly handleClick = (event: MouseEvent) => {
    event.stopPropagation();
  };

  private readonly handleChange = (event: Event) => {
    if (this.customSelectBox) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== 'SELECT') {
      return;
    }
    const selectElement = target as HTMLSelectElement;

    this.select(selectElement.selectedIndex);
    this.selectEmitter.fire({
      index: this.selected,
      selected: selectElement.value,
    });
  };

  private commitCustomSelection(index: number) {
    if (index < 0 || index >= this.options.length) {
      return;
    }

    if (this.options[index]?.isDisabled) {
      return;
    }

    this.select(index);
    this.selectEmitter.fire({
      index: this.selected,
      selected: this.selectElement.value,
    });
  }

  private syncTitle() {
    const option = this.options[this.selected];
    this.selectElement.title = option?.title ?? option?.text ?? '';
  }

  private createOption(option: ISelectOptionItem) {
    const optionElement = document.createElement('option');
    optionElement.value = option.value ?? option.text;
    optionElement.text = option.text;
    optionElement.disabled = Boolean(option.isDisabled);
    optionElement.title = option.title ?? option.text;
    return optionElement;
  }
}
