import { formatDateInputValue, isDateRangeValid } from 'cs/base/common/date';
import {
  Disposable,
  DisposableStore,
  MutableDisposable,
  combinedDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';
import 'cs/base/browser/ui/dateRangePicker/dateRangePicker.css';
import { $ } from 'cs/base/browser/dom';

export type DateRangePickerLabels = {
  startDate: string;
  endDate: string;
};

export type DateRangePickerProps = {
  startDate: string;
  endDate: string;
  labels: DateRangePickerLabels;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  className?: string;
  triggerIcon?: Node | string | number | null;
  triggerMode?: 'default' | 'icon';
  popupWidthMode?: 'default' | 'fit-container';
};

type DateRangeSlot = 'primary' | 'secondary';

type CalendarCell = {
  date: Date;
  value: string;
  inCurrentMonth: boolean;
};

const SVG_NS = 'http://www.w3.org/2000/svg';function addDisposableListener<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function createChevronIcon(direction: 'left' | 'right') {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    direction === 'left' ? 'M10 3.5L5.5 8 10 12.5' : 'M6 3.5L10.5 8 6 12.5',
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  icon.append(path);

  return icon;
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(year, month - 1, day);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
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
    const value = new Date(sunday);
    value.setDate(sunday.getDate() + index);
    return formatter.format(value);
  });
}

function formatMonthTitle(visibleMonth: Date) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
  });
  return formatter.format(visibleMonth);
}

function createTriggerLabel(labels: DateRangePickerLabels) {
  const chineseDateToken = '\u65e5\u671f';
  if (
    labels.startDate.includes(chineseDateToken) ||
    labels.endDate.includes(chineseDateToken) ||
    /\bdate\b/i.test(labels.startDate) ||
    /\bdate\b/i.test(labels.endDate)
  ) {
    return labels.startDate.includes(chineseDateToken) || labels.endDate.includes(chineseDateToken)
      ? chineseDateToken
      : 'Date';
  }

  return labels.endDate || labels.startDate || 'Date';
}

function appendTriggerIcon(target: HTMLElement, icon: DateRangePickerProps['triggerIcon']) {
  target.replaceChildren();
  if (icon === null || icon === undefined) {
    return;
  }

  if (icon instanceof Node) {
    target.append(icon.cloneNode(true));
    return;
  }

  target.textContent = String(icon);
}

function normalizeDateValue(value: string) {
  return parseDateValue(value) ? value : '';
}

function orderDateValues(primaryValue: string, secondaryValue: string) {
  const first = normalizeDateValue(primaryValue);
  const second = normalizeDateValue(secondaryValue);

  if (first && second) {
    return first <= second ? { start: first, end: second } : { start: second, end: first };
  }

  if (first || second) {
    return {
      start: first || second,
      end: '',
    };
  }

  return {
    start: '',
    end: '',
  };
}

export class DateRangePickerView extends Disposable {
  private props: DateRangePickerProps;
  private isOpen = false;
  private visibleMonth: Date;
  private readonly weekdayLabels = createWeekdayLabels();
  private readonly todayValue = formatDateInputValue(new Date());
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-date-range-picker');
  private readonly trigger = $<HTMLElementTagNameMap['button']>('button.comet-date-range-trigger');
  private readonly triggerContent = $<HTMLElementTagNameMap['span']>('span.comet-date-range-trigger-content');
  private readonly triggerIcon = $<HTMLElementTagNameMap['span']>('span.comet-date-range-trigger-icon');
  private readonly triggerText = $<HTMLElementTagNameMap['span']>('span.comet-date-range-trigger-text');
  private readonly popupDisposables = new DisposableStore();
  private popup: HTMLDivElement | null = null;
  private activeSlot: DateRangeSlot = 'primary';
  private draftPrimaryDate = '';
  private draftSecondaryDate = '';
  private pendingFocusDayValue: string | null = null;
  private readonly openListeners = new MutableDisposable<DisposableLike>();
  private disposed = false;

  constructor(props: DateRangePickerProps) {
    super();
    this.props = this.normalizeProps(props);
    this.syncDraftValuesFromProps();
    const now = new Date();
    this.visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this._register(this.openListeners);
    this._register(this.popupDisposables);

    this.trigger.type = 'button';
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this._register(addDisposableListener(this.trigger, 'click', this.handleTriggerClick));
    this.triggerContent.append(this.triggerIcon, this.triggerText);
    this.trigger.append(this.triggerContent);
    this.element.append(this.trigger);

    this.renderView();
  }

  getElement() {
    return this.element;
  }

  setProps(props: DateRangePickerProps) {
    this.props = this.normalizeProps(props);
    if (!this.isOpen) {
      this.syncDraftValuesFromProps();
    }
    this.renderView();
  }

  focus() {
    this.trigger.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.setOpen(false);
    super.dispose();
    this.element.replaceChildren();
  }

  private readonly handleTriggerClick = () => {
    if (!this.isOpen) {
      this.setOpen(true);
    }
  };

  private readonly handlePointerDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node)) {
      return;
    }
    if (!this.element.contains(event.target)) {
      this.setOpen(false);
    }
  };

  private readonly handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.setOpen(false);
    }
  };

  private readonly handleWindowResize = () => {
    this.updatePopupLayout();
  };

  private normalizeProps(props: DateRangePickerProps): DateRangePickerProps {
    return {
      ...props,
      className: props.className ?? '',
      triggerIcon: props.triggerIcon ?? null,
      triggerMode: props.triggerMode ?? 'default',
      popupWidthMode: props.popupWidthMode ?? 'default',
    };
  }

  private syncDraftValuesFromProps() {
    this.draftPrimaryDate = this.props.startDate;
    this.draftSecondaryDate = this.props.endDate;
  }

  private getSlotValue(slot: DateRangeSlot) {
    return slot === 'primary' ? this.draftPrimaryDate : this.draftSecondaryDate;
  }

  private setSlotValue(slot: DateRangeSlot, value: string) {
    if (slot === 'primary') {
      this.draftPrimaryDate = value;
      return;
    }

    this.draftSecondaryDate = value;
  }

  private applyOrderedSlotValue(slot: DateRangeSlot, value: string) {
    const normalizedValue = normalizeDateValue(value);
    const primaryValue = slot === 'primary' ? normalizedValue : this.draftPrimaryDate;
    const secondaryValue = slot === 'secondary' ? normalizedValue : this.draftSecondaryDate;

    if (primaryValue && secondaryValue) {
      if (primaryValue <= secondaryValue) {
        this.draftPrimaryDate = primaryValue;
        this.draftSecondaryDate = secondaryValue;
        this.activeSlot = slot === 'primary' ? 'primary' : 'secondary';
        return;
      }

      this.draftPrimaryDate = secondaryValue;
      this.draftSecondaryDate = primaryValue;
      this.activeSlot = slot === 'primary' ? 'secondary' : 'primary';
      return;
    }

    this.setSlotValue(slot, normalizedValue);
  }

  private commitDraftValues() {
    const ordered = orderDateValues(this.draftPrimaryDate, this.draftSecondaryDate);
    if (ordered.start !== this.props.startDate) {
      this.props.onStartDateChange(ordered.start);
    }
    if (ordered.end !== this.props.endDate) {
      this.props.onEndDateChange(ordered.end);
    }
  }

  private updatePopupLayout() {
    if (!this.popup) {
      return;
    }

    this.popup.style.removeProperty('width');
    this.popup.style.removeProperty('max-width');
    this.popup.style.removeProperty('left');
    this.popup.style.removeProperty('right');

    if (this.props.popupWidthMode !== 'fit-container') {
      return;
    }

const container = this.element.parentElement;
    if (!container) {
      return;
    }

const containerWidth = container.clientWidth;
    const triggerOffsetLeft = this.element.offsetLeft;
    const availableWidth = Math.max(0, containerWidth - triggerOffsetLeft);
    if (availableWidth <= 0) {
      return;
    }

const popupWidth = Math.min(280, availableWidth);
    this.popup.style.width = `${popupWidth}px`;
    this.popup.style.maxWidth = `${availableWidth}px`;

    if (triggerOffsetLeft + popupWidth > containerWidth) {
      this.popup.style.left = 'auto';
      this.popup.style.right = '0';
    }
  }

  private resolveVisibleMonth() {
    const parsed =
      parseDateValue(this.getSlotValue(this.activeSlot)) ??
      parseDateValue(this.draftPrimaryDate) ??
      parseDateValue(this.draftSecondaryDate) ??
      new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  }

  private setOpen(nextOpen: boolean) {
    if (this.disposed && nextOpen) {
      return;
    }

    if (this.isOpen === nextOpen) {
      return;
    }

    this.isOpen = nextOpen;
    if (nextOpen) {
      this.syncDraftValuesFromProps();
      this.activeSlot = 'primary';
      this.visibleMonth = this.resolveVisibleMonth();
      this.openListeners.value = combinedDisposable(
        addDisposableListener(document, 'mousedown', this.handlePointerDown),
        addDisposableListener(document, 'keydown', this.handleEscape),
        addDisposableListener(window, 'resize', this.handleWindowResize),
      );
    } else {
      this.syncDraftValuesFromProps();
      this.openListeners.clear();
    }

    this.renderView();
  }

  private stepMonth(offset: number) {
    this.visibleMonth = new Date(
      this.visibleMonth.getFullYear(),
      this.visibleMonth.getMonth() + offset,
      1,
    );
    this.renderPopup();
  }

  private restorePendingFocus() {
    if (!this.popup || !this.pendingFocusDayValue) {
      return;
    }

    const targetValue = this.pendingFocusDayValue;
    this.pendingFocusDayValue = null;
    const dayButtons = this.popup.querySelectorAll<HTMLButtonElement>('.comet-date-range-day');
    for (const button of dayButtons) {
      if (button.dataset.dateValue === targetValue && !button.disabled) {
        button.focus({ preventScroll: true });
        return;
      }
    }
  }

  private setActiveSlot(slot: DateRangeSlot) {
    if (this.activeSlot === slot) {
      return;
    }
    this.activeSlot = slot;
    this.visibleMonth = this.resolveVisibleMonth();
    this.renderPopup();
  }

  private handleSelectDate(value: string) {
    this.applyOrderedSlotValue(this.activeSlot, value);
    const parsed = parseDateValue(value);
    if (parsed) {
      this.visibleMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }
    this.pendingFocusDayValue = value;
    this.commitDraftValues();
    this.renderView();
  }

  private isCellDisabled(cell: CalendarCell) {
    return cell.value > this.todayValue;
  }

  private renderSlot(slot: DateRangeSlot, indexText: string) {
    const slotElement = $<HTMLElementTagNameMap['button']>('button', { class: ['comet-date-range-slot', this.activeSlot === slot ? 'comet-is-active' : ''].filter(Boolean).join(' ') });
    slotElement.type = 'button';
    slotElement.dataset.slot = slot;
    slotElement.setAttribute('aria-pressed', String(this.activeSlot === slot));
    this.popupDisposables.add(
      addDisposableListener(slotElement, 'click', () => {
        this.setActiveSlot(slot);
      }),
    );
    slotElement.append(
      $<HTMLElementTagNameMap['span']>('span.comet-date-range-slot-index', undefined, indexText),
      $<HTMLElementTagNameMap['span']>('span.comet-date-range-slot-value', undefined, this.getSlotValue(slot) || '--'),
    );
    return slotElement;
  }

  private renderPopup() {
    this.popupDisposables.clear();
    this.popup?.remove();
    this.popup = null;

    if (!this.isOpen) {
      return;
    }

const popup = $<HTMLElementTagNameMap['div']>('div.comet-date-range-popup');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-label', createTriggerLabel(this.props.labels));

    const slots = $<HTMLElementTagNameMap['div']>('div.comet-date-range-slots');
    slots.append(
      this.renderSlot('primary', '1'),
      $<HTMLElementTagNameMap['div']>('div.comet-date-range-slot-divider'),
      this.renderSlot('secondary', '2'),
    );

    const header = $<HTMLElementTagNameMap['div']>('div.comet-date-range-popup-header');
    const prevButton = $<HTMLElementTagNameMap['button']>('button.comet-date-range-month-nav.comet-btn-base.comet-btn-ghost.comet-btn-mode-icon.comet-btn-sm');
    prevButton.type = 'button';
    prevButton.append(createChevronIcon('left'));
    this.popupDisposables.add(
      addDisposableListener(prevButton, 'click', () => {
        this.stepMonth(-1);
      }),
    );

    const title = $<HTMLElementTagNameMap['div']>('div.comet-date-range-month-title', undefined, formatMonthTitle(this.visibleMonth));

    const nextButton = $<HTMLElementTagNameMap['button']>('button.comet-date-range-month-nav.comet-btn-base.comet-btn-ghost.comet-btn-mode-icon.comet-btn-sm');
    nextButton.type = 'button';
    nextButton.append(createChevronIcon('right'));
    this.popupDisposables.add(
      addDisposableListener(nextButton, 'click', () => {
        this.stepMonth(1);
      }),
    );
    header.append(prevButton, title, nextButton);

    const weekdays = $<HTMLElementTagNameMap['div']>('div.comet-date-range-weekdays');
    weekdays.append(
      ...this.weekdayLabels.map((weekday) => $<HTMLElementTagNameMap['span']>('span.comet-date-range-weekday', undefined, weekday)),
    );

    const orderedDraft = orderDateValues(this.draftPrimaryDate, this.draftSecondaryDate);
    const selectedValues = new Set(
      [normalizeDateValue(this.draftPrimaryDate), normalizeDateValue(this.draftSecondaryDate)].filter(Boolean),
    );
    const activeValue = this.getSlotValue(this.activeSlot);
    const showCommittedRange = Boolean(
      orderedDraft.start &&
        orderedDraft.end &&
        isDateRangeValid(orderedDraft.start, orderedDraft.end),
    );
    const grid = $<HTMLElementTagNameMap['div']>('div.comet-date-range-grid');
    grid.append(
      ...createMonthCells(this.visibleMonth).map((cell) => {
        const isSelected = selectedValues.has(cell.value);
        const isStart = cell.value === orderedDraft.start;
        const isEnd = Boolean(orderedDraft.end) && cell.value === orderedDraft.end;
        const isInRange =
          showCommittedRange && cell.value > orderedDraft.start && cell.value < orderedDraft.end;
        const isToday = cell.value === this.todayValue;
        const isActiveValue = Boolean(activeValue) && cell.value === activeValue;
        const disabled = this.isCellDisabled(cell);

        const day = $<HTMLElementTagNameMap['button']>('button', { class: [
            'comet-date-range-day',
            'comet-btn-base',
            'comet-btn-ghost',
            'comet-btn-sm',
            cell.inCurrentMonth ? '' : 'comet-is-outside',
            isSelected ? 'comet-is-selected' : '',
            isStart ? 'comet-is-start' : '',
            isEnd ? 'comet-is-end' : '',
            isInRange ? 'comet-is-in-range' : '',
            isActiveValue ? 'comet-is-active-value' : '',
            isToday ? 'comet-is-today' : '',
            disabled ? 'comet-is-disabled' : '',
          ]
            .filter(Boolean)
            .join(' ') }, String(cell.date.getDate()));
        day.type = 'button';
        day.disabled = disabled;
        day.dataset.dateValue = cell.value;
        day.setAttribute('aria-pressed', String(isSelected));
        this.popupDisposables.add(
          addDisposableListener(day, 'click', () => {
            this.handleSelectDate(cell.value);
          }),
        );
        return day;
      }),
    );

    popup.append(slots, header, weekdays, grid);
    this.popup = popup;
    this.element.append(popup);
    this.updatePopupLayout();
    this.restorePendingFocus();
  }

  private renderView() {
    this.element.className = ['comet-date-range-picker', this.props.className].filter(Boolean).join(' ');

    const triggerLabel = createTriggerLabel(this.props.labels);
    this.trigger.className = [
      'comet-date-range-trigger',
      'comet-actionbar-action',
      this.props.triggerMode === 'icon' ? 'comet-is-icon' : 'comet-is-text',
      this.isOpen ? 'comet-is-active' : '',
    ]
      .filter(Boolean)
      .join(' ');
    this.trigger.setAttribute('aria-label', triggerLabel);
    this.trigger.setAttribute('aria-expanded', String(this.isOpen));

    if (this.props.triggerIcon === null || this.props.triggerIcon === undefined) {
      this.triggerIcon.style.display = 'none';
    } else {
      this.triggerIcon.style.display = '';
      appendTriggerIcon(this.triggerIcon, this.props.triggerIcon);
    }
    this.triggerText.textContent = triggerLabel;
    this.triggerText.style.display = this.props.triggerMode === 'icon' ? 'none' : '';

    this.renderPopup();
  }
}

export function createDateRangePickerView(props: DateRangePickerProps) {
  return new DateRangePickerView(props);
}
