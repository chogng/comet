import { EventEmitter } from 'cs/base/common/event';
import { normalizeUrl } from 'cs/workbench/common/url';

export type PdfDownloadMonitorStatus = {
  pageUrl: string;
  isDownloading: boolean;
  hasSucceeded: boolean;
  lastCompletedAt: number | null;
  lastFilePath: string;
  lastSourceUrl: string;
  lastError: string;
};

type PdfDownloadSuccessPayload = {
  filePath: string;
  sourceUrl: string;
};

const EMPTY_STATUS: PdfDownloadMonitorStatus = Object.freeze({
  pageUrl: '',
  isDownloading: false,
  hasSucceeded: false,
  lastCompletedAt: null,
  lastFilePath: '',
  lastSourceUrl: '',
  lastError: '',
});

const entries = new Map<string, PdfDownloadMonitorStatus>();
const onDidChangePdfDownloadStatusEmitter = new EventEmitter<void>();

function emitChange() {
  onDidChangePdfDownloadStatusEmitter.fire();
}

function toComparablePageUrl(input: string) {
  const normalized = normalizeUrl(input);
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function readStatus(key: string) {
  return entries.get(key) ?? EMPTY_STATUS;
}

function writeStatus(key: string, nextStatus: PdfDownloadMonitorStatus) {
  entries.set(key, nextStatus);
  emitChange();
}

export function markPdfDownloadStarted(pageUrl: string) {
  const key = toComparablePageUrl(pageUrl);
  if (!key) return;

  const previous = readStatus(key);
  writeStatus(key, {
    ...previous,
    pageUrl: key,
    isDownloading: true,
    hasSucceeded: false,
    lastError: '',
  });
}

export function markPdfDownloadSucceeded(
  pageUrl: string,
  payload: PdfDownloadSuccessPayload,
) {
  const key = toComparablePageUrl(pageUrl);
  if (!key) return;

  const previous = readStatus(key);
  writeStatus(key, {
    ...previous,
    pageUrl: key,
    isDownloading: false,
    hasSucceeded: true,
    lastCompletedAt: Date.now(),
    lastFilePath: payload.filePath,
    lastSourceUrl: payload.sourceUrl,
    lastError: '',
  });
}

export function markPdfDownloadFailed(pageUrl: string, errorMessage: string) {
  const key = toComparablePageUrl(pageUrl);
  if (!key) return;

  const previous = readStatus(key);
  writeStatus(key, {
    ...previous,
    pageUrl: key,
    isDownloading: false,
    hasSucceeded: false,
    lastError: errorMessage.trim(),
  });
}

export function markPdfDownloadCancelled(pageUrl: string) {
  const key = toComparablePageUrl(pageUrl);
  if (!key) return;

  const previous = readStatus(key);
  writeStatus(key, {
    ...previous,
    pageUrl: key,
    isDownloading: false,
    hasSucceeded: false,
    lastError: '',
  });
}

export function getPdfDownloadStatus(pageUrl: string) {
  const key = toComparablePageUrl(pageUrl);
  if (!key) {
    return EMPTY_STATUS;
  }

  return readStatus(key);
}

export function subscribePdfDownloadStatus(listener: () => void) {
  return onDidChangePdfDownloadStatusEmitter.event(listener);
}
