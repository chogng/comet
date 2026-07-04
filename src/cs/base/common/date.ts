import { appError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';

export interface DateRange {
  start: string | null;
  end: string | null;
}

export type DateRangeWithStart = DateRange & { start: string };

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_NAME_RE =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_HINT_PATTERNS = [
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/i,
  new RegExp(`\\b\\d{1,2}\\s+${MONTH_NAME_RE}\\s+\\d{4}\\b`, 'i'),
  new RegExp(`\\b${MONTH_NAME_RE}\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'i'),
];

function normalizeMonthName(value: string) {
  return value.toLowerCase().replace(/\.+$/, '');
}

function toUtcIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function isDateRangeValid(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) {
    return true;
  }

  return startDate <= endDate;
}

export function formatDateInputValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDateInputValue(dateValue: string, dayOffset: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) {
    return '';
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  date.setDate(date.getDate() + dayOffset);
  return formatDateInputValue(date);
}

export function parseDateString(value: unknown) {
  const source = cleanText(value);
  if (!source) {
    return null;
  }

  // Ignore month-level or year-level values (for example "2026/03" or "2026"),
  // because coercing them into a specific day causes false date filtering.
  if (/^\d{4}$/.test(source) || /^\d{4}[-/.]\d{1,2}$/.test(source)) {
    return null;
  }

  const isoDateMatch = source.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoDateMatch) {
    const year = Number.parseInt(isoDateMatch[1], 10);
    const month = Number.parseInt(isoDateMatch[2], 10);
    const day = Number.parseInt(isoDateMatch[3], 10);
    return toUtcIsoDate(year, month - 1, day);
  }

  const dayMonthNameMatch = source.match(/\b(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})\b/);
  if (dayMonthNameMatch) {
    const day = Number.parseInt(dayMonthNameMatch[1], 10);
    const month = MONTH_NAME_TO_INDEX[normalizeMonthName(dayMonthNameMatch[2])];
    const year = Number.parseInt(dayMonthNameMatch[3], 10);
    if (month !== undefined) {
      return toUtcIsoDate(year, month, day);
    }
  }

  const monthNameDayMatch = source.match(/\b([A-Za-z.]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (monthNameDayMatch) {
    const month = MONTH_NAME_TO_INDEX[normalizeMonthName(monthNameDayMatch[1])];
    const day = Number.parseInt(monthNameDayMatch[2], 10);
    const year = Number.parseInt(monthNameDayMatch[3], 10);
    if (month !== undefined) {
      return toUtcIsoDate(year, month, day);
    }
  }

  const parsed = new Date(source);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

export function parseDateHintFromText(value: unknown) {
  const normalized = cleanText(value);
  if (!normalized) return null;

  const direct = parseDateString(normalized);
  if (direct) return direct;

  for (const pattern of DATE_HINT_PATTERNS) {
    const matched = normalized.match(pattern);
    if (!matched) continue;

    const parsed = parseDateString(matched[0]);
    if (parsed) return parsed;
  }

  return null;
}

export function parseDateRange(startDate: unknown, endDate: unknown): DateRange {
  const normalizedStart = cleanText(startDate);
  const normalizedEnd = cleanText(endDate);
  const start = normalizedStart ? parseDateString(normalizedStart) : null;
  const end = normalizedEnd ? parseDateString(normalizedEnd) : null;

  if (normalizedStart && !start) {
    throw appError('DATE_START_INVALID', { value: normalizedStart });
  }
  if (normalizedEnd && !end) {
    throw appError('DATE_END_INVALID', { value: normalizedEnd });
  }
  if (start && end && start > end) {
    throw appError('DATE_RANGE_INVALID', { start, end });
  }

  return { start, end };
}

export function hasDateRangeStart(range: DateRange): range is DateRangeWithStart {
  return typeof range.start === 'string' && range.start.length > 0;
}

export function isWithinDateRange(value: string | null | undefined, range: DateRange) {
  if (!range.start && !range.end) {
    return true;
  }
  if (!value) {
    return false;
  }
  if (range.start && value < range.start) {
    return false;
  }
  if (range.end && value > range.end) {
    return false;
  }
  return true;
}
