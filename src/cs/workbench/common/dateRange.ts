import {
  formatDateInputValue,
  isDateRangeValid,
  shiftDateInputValue,
} from 'cs/base/common/date';

export type BatchDateRange = {
  startDate: string;
  endDate: string;
};

export {
  formatDateInputValue,
  isDateRangeValid,
  shiftDateInputValue,
};

export function buildDefaultBatchDateRange(referenceDate = new Date()): BatchDateRange {
  const endDate = formatDateInputValue(referenceDate);
  return {
    endDate,
    startDate: shiftDateInputValue(endDate, -7),
  };
}
