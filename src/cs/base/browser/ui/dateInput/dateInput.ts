import 'cs/base/browser/ui/dateInput/dateInput.css';
import {
  AnchorAlignment,
  ContextView,
  ContextViewDOMPosition,
} from 'cs/base/browser/ui/contextview/contextview';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { formatDateInputValue } from 'cs/base/common/date';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { $ } from 'cs/base/browser/dom';

export type DateInputLabels = {
  calendar: string;
  clear: string;
  today: string;
};

export type DateInputOptions = {
  value: string;
  labels: DateInputLabels;
  className?: string;
  inputClassName?: string;
  focusKey?: string;
  contextViewLayer?: number;
  onInput?: (value: string) => void;
};

type CalendarCell = {
  date: Date;
  value: string;
  inCurrentMonth: boolean;
};

const defaultLabels: DateInputLabels = {
  calendar: 'Calendar',
  clear: 'Clear',
  today: 'Today',
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

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function createMonthCells(visibleMonth: Date): CalendarCell[] {
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const startWeekday = monthStart.getDay();
  const cells: CalendarCell[] = [];

  for (let index = 0; index < 42; index += 1) {
    const offset = index - startWeekday;
    const cellDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + offset);
    cells.push({
      date: cellDate,
      value: formatDateInputValue(cellDate),
      inCurrentMonth: cellDate.getMonth() === monthStart.getMonth(),
    });
  }

  return cells;
}

function createWeekdayLabels() {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const sunday = new Date(2024, 0, 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return formatter.format(date);
  });
}

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

function resolveVisibleMonth(value: string) {
  const parsed = parseDateValue(value) ?? new Date();
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function resolveNextFocusValue(value: string, dayOffset: number) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return formatDateInputValue(new Date());
  }

  parsed.setDate(parsed.getDate() + dayOffset);
  return formatDateInputValue(parsed);
}

export class DateInput extends Disposable {
  private options: DateInputOptions;
  private readonly contextView: ContextView;
  private readonly ownsContextView: boolean;
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-date-input');
  private readonly inputBox: InputBox;
  private readonly button = $<HTMLElementTagNameMap['button']>('button.comet-date-input-button');
  private readonly weekdayLabels = createWeekdayLabels();
  private visibleMonth: Date;
  private selectedValue: string;
  private pendingFocusValue: string | null = null;
  private cleanupObserver: MutationObserver | null = null;
  private disposed = false;
  private contextViewVisible = false;

  constructor(options: DateInputOptions, contextView?: ContextView) {
    super();
    this.options = this.normalizeOptions(options);
    this.selectedValue = this.options.value;
    this.visibleMonth = resolveVisibleMonth(this.selectedValue);
    this.contextView = contextView ?? new ContextView(document.body, ContextViewDOMPosition.FIXED);
    this.ownsContextView = !contextView;

    const host = $<HTMLElementTagNameMap['div']>('div');
    this.inputBox = new InputBox(host, undefined, {
      className: ['comet-date-input-field', this.options.inputClassName ?? ''].filter(Boolean).join(' '),
      value: this.selectedValue,
      inputAttributes: {
        autocomplete: 'off',
        spellcheck: false,
      },
    });
    this._register(this.inputBox);
    this._register(this.inputBox.onDidChange(this.handleInputChange));

    if (this.options.focusKey) {
      this.inputBox.inputElement.dataset.focusKey = this.options.focusKey;
    }

    this.button.type = 'button';
    this.button.append(createLxIcon('calendar'));
    this._register(addDisposableListener(this.button, 'click', this.handleButtonClick));
    this._register(addDisposableListener(this.inputBox.inputElement, 'focus', this.handleInputFocus));
    this._register(addDisposableListener(this.inputBox.inputElement, 'keydown', this.handleInputKeyDown));

    this.element.append(this.inputBox.element, this.button);
    this.syncLabels();
    this.syncClassName();
    this.scheduleDetachedCleanup();
  }

  getElement() {
    return this.element;
  }

  get inputElement() {
    return this.inputBox.inputElement;
  }

  setOptions(options: DateInputOptions) {
    this.options = this.normalizeOptions(options);
    if (this.selectedValue !== this.options.value) {
      this.selectedValue = this.options.value;
      this.inputBox.value = this.options.value;
      this.visibleMonth = resolveVisibleMonth(this.selectedValue);
    }
    this.syncLabels();
    this.syncClassName();
  }

  focus() {
    this.inputBox.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hide();
    if (this.ownsContextView) {
      this.contextView.dispose();
    }
    super.dispose();
    this.element.replaceChildren();
    this.cleanupObserver?.disconnect();
    this.cleanupObserver = null;
  }

  private normalizeOptions(options: DateInputOptions): DateInputOptions {
    return {
      ...options,
      labels: {
        ...defaultLabels,
        ...options.labels,
      },
      className: options.className ?? '',
      inputClassName: options.inputClassName ?? '',
    };
  }

  private syncLabels() {
    this.button.ariaLabel = this.options.labels.calendar;
    this.button.title = this.options.labels.calendar;
  }

  private syncClassName() {
    this.element.className = ['comet-date-input', this.options.className].filter(Boolean).join(' ');
  }

  private scheduleDetachedCleanup() {
    queueMicrotask(() => {
      if (this.disposed || !this.element.isConnected) {
        return;
      }

      this.cleanupObserver = new MutationObserver(() => {
        if (!this.element.isConnected) {
          this.dispose();
        }
      });
      this.cleanupObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }

  private readonly handleButtonClick = () => {
    this.toggle();
  };

  private readonly handleInputFocus = () => {
    this.show();
  };

  private readonly handleInputChange = (value: string) => {
    this.selectedValue = value;
    const parsed = parseDateValue(value);
    if (parsed) {
      this.visibleMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }
    this.options.onInput?.(value);
  };

  private readonly handleInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.show();
      this.focusDay(this.selectedValue || formatDateInputValue(new Date()));
    }
  };

  private toggle() {
    if (this.contextViewVisible) {
      this.hide();
      return;
    }

    this.show();
  }

  private show() {
    if (this.disposed) {
      return;
    }

    this.visibleMonth = resolveVisibleMonth(this.selectedValue);
    this.contextView.show({
      getAnchor: () => this.element,
      render: container => {
        container.classList.add('comet-date-input-context-view');
        container.append(this.renderPopover());
        return null;
      },
      anchorAlignment: AnchorAlignment.RIGHT,
      layer: this.options.contextViewLayer,
      onHide: () => {
        this.contextViewVisible = false;
        this.pendingFocusValue = null;
      },
    });
    this.contextViewVisible = true;
  }

  private hide() {
    if (this.contextViewVisible) {
      this.contextView.hide();
    }
  }

  private commitValue(value: string) {
    this.selectedValue = value;
    this.inputBox.value = value;
    this.options.onInput?.(value);
  }

  private stepMonth(offset: number) {
    this.visibleMonth = new Date(
      this.visibleMonth.getFullYear(),
      this.visibleMonth.getMonth() + offset,
      1,
    );
    this.refreshPopover();
  }

  private refreshPopover() {
    if (!this.contextViewVisible) {
      return;
    }

    this.contextView.show({
      getAnchor: () => this.element,
      render: container => {
        container.classList.add('comet-date-input-context-view');
        container.append(this.renderPopover());
        return null;
      },
      anchorAlignment: AnchorAlignment.RIGHT,
      layer: this.options.contextViewLayer,
      onHide: () => {
        this.contextViewVisible = false;
        this.pendingFocusValue = null;
      },
    });
    this.contextViewVisible = true;
    this.restorePendingFocus();
  }

  private focusDay(value: string) {
    this.pendingFocusValue = value;
    const parsed = parseDateValue(value);
    if (parsed) {
      this.visibleMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }
    this.refreshPopover();
  }

  private restorePendingFocus() {
    if (!this.pendingFocusValue) {
      return;
    }

    const targetValue = this.pendingFocusValue;
    this.pendingFocusValue = null;
    const dayButtons = this.contextView
      .getViewElement()
      .querySelectorAll<HTMLButtonElement>('.comet-date-input-day');
    for (const button of dayButtons) {
      if (button.dataset.dateValue === targetValue) {
        button.focus({ preventScroll: true });
        return;
      }
    }
  }

  private renderPopover() {
    const popover = $<HTMLElementTagNameMap['div']>('div.comet-date-input-popover');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-label', this.options.labels.calendar);

    const header = $<HTMLElementTagNameMap['div']>('div.comet-date-input-header');
    const previousButton = $<HTMLElementTagNameMap['button']>('button.comet-date-input-month-nav');
    previousButton.type = 'button';
    previousButton.append(createLxIcon('chevron-left'));
    previousButton.addEventListener('click', () => this.stepMonth(-1));

    const title = $<HTMLElementTagNameMap['div']>('div.comet-date-input-month-title', undefined, formatMonthTitle(this.visibleMonth));

    const nextButton = $<HTMLElementTagNameMap['button']>('button.comet-date-input-month-nav');
    nextButton.type = 'button';
    nextButton.append(createLxIcon('chevron-right'));
    nextButton.addEventListener('click', () => this.stepMonth(1));
    header.append(previousButton, title, nextButton);

    const weekdays = $<HTMLElementTagNameMap['div']>('div.comet-date-input-weekdays');
    weekdays.append(
      ...this.weekdayLabels.map((weekday) => $<HTMLElementTagNameMap['span']>('span.comet-date-input-weekday', undefined, weekday)),
    );

    const todayValue = formatDateInputValue(new Date());
    const grid = $<HTMLElementTagNameMap['div']>('div.comet-date-input-grid');
    grid.append(...createMonthCells(this.visibleMonth).map((cell) => {
      const day = $<HTMLElementTagNameMap['button']>('button', { class: [
          'comet-date-input-day',
          cell.inCurrentMonth ? '' : 'comet-is-outside',
          cell.value === todayValue ? 'comet-is-today' : '',
          cell.value === this.selectedValue ? 'comet-is-selected' : '',
        ].filter(Boolean).join(' ') }, String(cell.date.getDate()));
      day.type = 'button';
      day.dataset.dateValue = cell.value;
      day.setAttribute('aria-pressed', String(cell.value === this.selectedValue));
      day.addEventListener('click', () => {
        this.commitValue(cell.value);
        this.hide();
        this.inputBox.focus();
      });
      day.addEventListener('keydown', (event) => this.handleDayKeyDown(event, cell.value));
      return day;
    }));

    const footer = $<HTMLElementTagNameMap['div']>('div.comet-date-input-footer');
    const clearButton = $<HTMLElementTagNameMap['button']>('button.comet-date-input-footer-button', undefined, this.options.labels.clear);
    clearButton.type = 'button';
    clearButton.addEventListener('click', () => {
      this.commitValue('');
      this.hide();
      this.inputBox.focus();
    });

    const todayButton = $<HTMLElementTagNameMap['button']>('button.comet-date-input-footer-button', undefined, this.options.labels.today);
    todayButton.type = 'button';
    todayButton.addEventListener('click', () => {
      this.commitValue(todayValue);
      this.hide();
      this.inputBox.focus();
    });
    footer.append(clearButton, todayButton);

    popover.append(header, weekdays, grid, footer);
    return popover;
  }

  private handleDayKeyDown(event: KeyboardEvent, value: string) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const offset = offsets[event.key];
    if (offset !== undefined) {
      event.preventDefault();
      this.focusDay(resolveNextFocusValue(value, offset));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.commitValue(value);
      this.hide();
      this.inputBox.focus();
    }
  }
}

export function createDateInput(options: DateInputOptions, contextView?: ContextView) {
  return new DateInput(options, contextView);
}
