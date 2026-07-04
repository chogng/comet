import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createDateRangePickerView: typeof import('cs/base/browser/ui/dateRangePicker/dateRangePicker').createDateRangePickerView;

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createDateRangePickerView } = await import('cs/base/browser/ui/dateRangePicker/dateRangePicker'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('date range picker keeps popup open when the start day is clicked repeatedly', () => {
  let startDate = '2026-03-01';
  let endDate = '2026-03-07';
  let picker: ReturnType<typeof createDateRangePickerView>;
  const buildProps = () => ({
    startDate,
    endDate,
    labels: {
      startDate: 'Start date',
      endDate: 'End date',
    },
    onStartDateChange: (value: string) => {
      startDate = value;
      picker.setProps(buildProps());
    },
    onEndDateChange: (value: string) => {
      endDate = value;
      picker.setProps(buildProps());
    },
  });
  picker = createDateRangePickerView(buildProps());

  document.body.append(picker.getElement());

  try {
    const trigger = picker.getElement().querySelector('.comet-date-range-trigger');
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('Expected date range trigger button.');
    }
    trigger.click();

    const findDayButton = (value: string) =>
      picker.getElement().querySelector<HTMLButtonElement>(`[data-date-value="${value}"]`);

    const anchorDay = findDayButton('2026-03-03');
    if (!(anchorDay instanceof HTMLButtonElement)) {
      throw new Error('Expected anchor day button.');
    }
    anchorDay.click();

    const repeatedDay = findDayButton('2026-03-03');
    if (!(repeatedDay instanceof HTMLButtonElement)) {
      throw new Error('Expected repeated day button.');
    }
    repeatedDay.click();
    repeatedDay.click();

    assert.equal(startDate, '2026-03-03');
    assert.equal(endDate, '2026-03-07');
    assert(picker.getElement().querySelector('.comet-date-range-popup') instanceof HTMLElement);
  } finally {
    picker.dispose();
    document.body.replaceChildren();
  }
});

test('date range picker calendar writes into slot 2 after switching the active slot', () => {
  let startDate = '2026-03-01';
  let endDate = '2026-03-07';
  let picker: ReturnType<typeof createDateRangePickerView>;
  const buildProps = () => ({
    startDate,
    endDate,
    labels: {
      startDate: 'Start date',
      endDate: 'End date',
    },
    onStartDateChange: (value: string) => {
      startDate = value;
      picker.setProps(buildProps());
    },
    onEndDateChange: (value: string) => {
      endDate = value;
      picker.setProps(buildProps());
    },
  });
  picker = createDateRangePickerView(buildProps());

  document.body.append(picker.getElement());

  try {
    const trigger = picker.getElement().querySelector('.comet-date-range-trigger');
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('Expected date range trigger button.');
    }
    trigger.click();

    const secondarySlot = picker
      .getElement()
      .querySelector<HTMLButtonElement>('.comet-date-range-slot[data-slot="secondary"]');
    if (!(secondarySlot instanceof HTMLButtonElement)) {
      throw new Error('Expected secondary slot.');
    }
    secondarySlot.click();

    const findDayButton = (value: string) =>
      picker.getElement().querySelector<HTMLButtonElement>(`[data-date-value="${value}"]`);

    const replacementDay = findDayButton('2026-03-04');
    if (!(replacementDay instanceof HTMLButtonElement)) {
      throw new Error('Expected replacement day button.');
    }
    replacementDay.click();

    assert.equal(startDate, '2026-03-01');
    assert.equal(endDate, '2026-03-04');
    assert(picker.getElement().querySelector('.comet-date-range-popup') instanceof HTMLElement);
  } finally {
    picker.dispose();
    document.body.replaceChildren();
  }
});

test('date range picker still commits an ordered range when slot 1 is moved after slot 2', () => {
  let startDate = '2026-03-01';
  let endDate = '2026-03-07';
  let picker: ReturnType<typeof createDateRangePickerView>;
  const buildProps = () => ({
    startDate,
    endDate,
    labels: {
      startDate: 'Start date',
      endDate: 'End date',
    },
    onStartDateChange: (value: string) => {
      startDate = value;
      picker.setProps(buildProps());
    },
    onEndDateChange: (value: string) => {
      endDate = value;
      picker.setProps(buildProps());
    },
  });
  picker = createDateRangePickerView(buildProps());

  document.body.append(picker.getElement());

  try {
    const trigger = picker.getElement().querySelector('.comet-date-range-trigger');
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('Expected date range trigger button.');
    }
    trigger.click();

    const findDayButton = (value: string) =>
      picker.getElement().querySelector<HTMLButtonElement>(`[data-date-value="${value}"]`);

    const nextPrimaryDay = findDayButton('2026-03-09');
    if (!(nextPrimaryDay instanceof HTMLButtonElement)) {
      throw new Error('Expected primary replacement day button.');
    }
    nextPrimaryDay.click();

    assert.equal(startDate, '2026-03-07');
    assert.equal(endDate, '2026-03-09');
  } finally {
    picker.dispose();
    document.body.replaceChildren();
  }
});
