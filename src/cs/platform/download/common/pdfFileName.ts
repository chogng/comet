import { cleanText } from 'cs/base/common/strings';

const INVALID_FILE_NAME_RE = /[<>:"/\\|?*\u0000-\u001F]/g;
const TRAILING_FILE_NAME_RE = /[. ]+$/g;
const PDF_EXTENSION_RE = /\.pdf$/i;
const DEFAULT_MAX_NAME_LENGTH = 180;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

function normalizeFileSystemName(
  value: unknown,
  {
    stripPdfExtension = false,
    maxLength = DEFAULT_MAX_NAME_LENGTH,
  }: {
    stripPdfExtension?: boolean;
    maxLength?: number;
  } = {},
) {
  const cleaned = cleanText(value);
  const source = stripPdfExtension ? cleaned.replace(PDF_EXTENSION_RE, '') : cleaned;
  if (!source) {
    return '';
  }

  const safeMaxLength = Number.isFinite(maxLength)
    ? Math.max(1, Math.trunc(maxLength))
    : DEFAULT_MAX_NAME_LENGTH;

  const normalized = source
    .replace(INVALID_FILE_NAME_RE, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_FILE_NAME_RE, '')
    .trim();

  if (!normalized) {
    return '';
  }

  const trimmed = normalized.slice(0, safeMaxLength).replace(TRAILING_FILE_NAME_RE, '').trim();
  if (!trimmed) {
    return '';
  }

  return WINDOWS_RESERVED_NAMES.has(trimmed.toUpperCase()) ? `${trimmed}_` : trimmed;
}

function normalizePdfFileStem(value: unknown) {
  return normalizeFileSystemName(value, { stripPdfExtension: true });
}

export function buildPdfDirectoryName(preferredName: unknown) {
  return normalizeFileSystemName(preferredName, { maxLength: 120 });
}

export function buildPdfFileName(preferredTitle: unknown, fallbackName?: unknown) {
  const preferredStem = normalizePdfFileStem(preferredTitle);
  if (preferredStem) {
    return `${preferredStem}.pdf`;
  }

  const fallbackStem = normalizePdfFileStem(fallbackName);
  if (fallbackStem) {
    return `${fallbackStem}.pdf`;
  }

  return `article-${Date.now()}.pdf`;
}
