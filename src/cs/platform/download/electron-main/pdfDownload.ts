import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { DownloadItem, WebContents } from 'electron';

import { buildPdfFileName } from 'cs/platform/download/common/pdfFileName';
import { cleanText } from 'cs/base/common/strings';
import { CancellationError, isCancellationError } from 'cs/base/common/errors';
import { PdfErrorCode, isPdfError, pdfError } from 'cs/platform/download/common/pdfErrors';
import {
  WORKBENCH_SHARED_WEB_PARTITION,
  resolveWorkbenchSharedSession,
} from 'cs/platform/native/electron-main/sharedWebSession';

const PDF_FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PDF_FETCH_ACCEPT = 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8';

export type BrowserPdfFetch = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  partition: string;
};

export type PdfDownloadAttemptFailure = {
  url: string;
  status: string | number;
  statusText: string;
  contentType?: string;
};

export type PdfDownloadAttemptSuccess = {
  finalUrl: string;
  buffer: Buffer;
  contentDisposition: string;
};

export type BrowserSessionDownloadResult = {
  filePath: string;
  sourceUrl: string;
};

export type BrowserSessionDownloadEvent = {
  preventDefault: () => void;
  readonly defaultPrevented: boolean;
};

type SessionDownloadListener = {
  on(
    event: 'will-download',
    listener: (
      event: BrowserSessionDownloadEvent,
      item: DownloadItem,
      originatingWebContents?: WebContents,
    ) => void,
  ): void;
  removeListener(
    event: 'will-download',
    listener: (
      event: BrowserSessionDownloadEvent,
      item: DownloadItem,
      originatingWebContents?: WebContents,
    ) => void,
  ): void;
};

let browserPdfFetchPromise: Promise<BrowserPdfFetch | null> | null = null;
let browserPdfFetchUnsupported = false;

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw new CancellationError();
  }
}

async function waitForDelay(timeoutMs: number, abortSignal?: AbortSignal) {
  throwIfAborted(abortSignal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      abortSignal?.removeEventListener('abort', handleAbort);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleAbort = () => {
      rejectOnce(new CancellationError());
    };

    timeoutId = setTimeout(resolveOnce, Math.max(0, timeoutMs));
    abortSignal?.addEventListener('abort', handleAbort, { once: true });
    if (abortSignal?.aborted) {
      handleAbort();
    }
  });
}

export function toAbsoluteHttpUrl(rawUrl: string, pageUrl: string) {
  try {
    const resolved = new URL(rawUrl, pageUrl);
    if (!/^https?:$/i.test(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export function normalizeComparableDownloadUrl(value: string) {
  const normalized = cleanText(value);
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function resolveDownloadItemFinalUrl(item: DownloadItem, fallbackUrl: string) {
  const urlChain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
  const finalUrl = urlChain[urlChain.length - 1] || item.getURL();
  return cleanText(finalUrl) || fallbackUrl;
}

function matchesDownloadItemUrl(item: DownloadItem, expectedUrl: string) {
  const normalizedExpectedUrl = normalizeComparableDownloadUrl(expectedUrl);
  if (!normalizedExpectedUrl) {
    return true;
  }

  if (normalizeComparableDownloadUrl(item.getURL()) === normalizedExpectedUrl) {
    return true;
  }

  const urlChain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
  return urlChain.some((entry) => normalizeComparableDownloadUrl(entry) === normalizedExpectedUrl);
}

async function readFilePrefix(filePath: string, length: number) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, length));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isPdfBuffer(buffer: Buffer) {
  if (buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export async function assertDownloadedFileIsPdf({
  item,
  filePath,
  downloadUrl,
  origin,
}: {
  item: DownloadItem;
  filePath: string;
  downloadUrl: string;
  origin: string;
}) {
  const mimeType = cleanText(
    typeof item.getMimeType === 'function' ? item.getMimeType() : '',
  ).toLowerCase();
  const filePrefix = await readFilePrefix(filePath, 5);
  const isPdfMimeType = /\bapplication\/pdf\b/i.test(mimeType);
  const looksPdf = isPdfMimeType || isPdfBuffer(filePrefix);

  if (looksPdf) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup failures and surface the original validation failure.
  }

  throw pdfError(PdfErrorCode.DownloadFailed, {
    status: 'NOT_PDF_RESPONSE',
    statusText: mimeType
      ? `Unexpected downloaded content-type: ${mimeType}`
      : 'Downloaded file does not look like a PDF file',
    contentType: mimeType,
    downloadUrl,
    filePath,
    origin,
  });
}

async function resolveBrowserDownloadSession() {
  try {
    const chromiumSession = await resolveWorkbenchSharedSession();
    if (!chromiumSession || typeof chromiumSession.downloadURL !== 'function') {
      return null;
    }

    return chromiumSession;
  } catch {
    return null;
  }
}

export async function waitForPdfDownloadFromSession({
  session,
  downloadUrl,
  downloadDir,
  articleTitle = '',
  timeoutMs = 45000,
  origin,
  originatingWebContentsId,
  abortSignal,
  triggerDownload,
}: {
  session: SessionDownloadListener;
  downloadUrl: string;
  downloadDir: string;
  articleTitle?: string;
  timeoutMs?: number;
  origin: string;
  originatingWebContentsId?: number;
  abortSignal?: AbortSignal;
  triggerDownload: () => Promise<unknown> | unknown;
}): Promise<BrowserSessionDownloadResult | null> {
  return await new Promise<BrowserSessionDownloadResult | null>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      session.removeListener('will-download', handleWillDownload);
      abortSignal?.removeEventListener('abort', handleAbort);
    };

    const resolveOnce = (value: BrowserSessionDownloadResult | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleAbort = () => {
      rejectOnce(new CancellationError());
    };

    const handleWillDownload = (
      _event: BrowserSessionDownloadEvent,
      item: DownloadItem,
      originatingWebContents?: WebContents,
    ) => {
      if (
        typeof originatingWebContentsId === 'number' &&
        originatingWebContents &&
        originatingWebContents.id !== originatingWebContentsId
      ) {
        return;
      }
      if (!matchesDownloadItemUrl(item, downloadUrl)) {
        return;
      }

      const fallbackName = (() => {
        try {
          return path.basename(new URL(downloadUrl).pathname) || '';
        } catch {
          return '';
        }
      })();
      const fileName = buildPdfFileName(articleTitle, item.getFilename() || fallbackName);
      const filePath = path.join(downloadDir, fileName);
      item.setSavePath(filePath);

      item.once('done', (_doneEvent, state) => {
        void (async () => {
          if (state !== 'completed') {
            rejectOnce(
              pdfError(PdfErrorCode.DownloadFailed, {
                status: `DOWNLOAD_${String(state).toUpperCase()}`,
                statusText: `${origin} download ${state}`,
                downloadUrl,
                filePath,
                sourceUrl: resolveDownloadItemFinalUrl(item, downloadUrl),
              }),
            );
            return;
          }

          await assertDownloadedFileIsPdf({
            item,
            filePath,
            downloadUrl,
            origin,
          });

          resolveOnce({
            filePath,
            sourceUrl: resolveDownloadItemFinalUrl(item, downloadUrl),
          });
        })().catch((error) => rejectOnce(error));
      });
    };

    timeoutId = setTimeout(() => {
      resolveOnce(null);
    }, Math.max(0, timeoutMs));

    if (abortSignal?.aborted) {
      handleAbort();
      return;
    }

    session.on('will-download', handleWillDownload);
    abortSignal?.addEventListener('abort', handleAbort, { once: true });
    Promise.resolve(triggerDownload()).catch((error) => rejectOnce(error));
  });
}

function buildPdfFetchHeaders(pageUrl: string) {
  const headers: Record<string, string> = {
    'user-agent': PDF_FETCH_USER_AGENT,
    accept: PDF_FETCH_ACCEPT,
  };
  const referer = cleanText(pageUrl);
  if (referer) {
    headers.referer = referer;
  }
  return headers;
}

async function resolveBrowserPdfFetch() {
  if (browserPdfFetchUnsupported) {
    return null;
  }

  if (!browserPdfFetchPromise) {
    browserPdfFetchPromise = (async () => {
      try {
        const chromiumSession = await resolveWorkbenchSharedSession();
        if (!chromiumSession || typeof chromiumSession.fetch !== 'function') {
          browserPdfFetchUnsupported = true;
          return null;
        }

        return {
          fetch: chromiumSession.fetch.bind(chromiumSession),
          partition: WORKBENCH_SHARED_WEB_PARTITION,
        } satisfies BrowserPdfFetch;
      } catch {
        browserPdfFetchUnsupported = true;
        return null;
      }
    })();
  }

  const resolved = await browserPdfFetchPromise;
  if (!resolved && !browserPdfFetchUnsupported) {
    browserPdfFetchPromise = null;
  }

  return resolved;
}

async function fetchPdfWithPreferredTransport(candidateUrl: string, pageUrl: string, abortSignal?: AbortSignal) {
  throwIfAborted(abortSignal);
  const headers = buildPdfFetchHeaders(pageUrl);
  const browserPdfFetch = await resolveBrowserPdfFetch();
  if (browserPdfFetch) {
    try {
      return await browserPdfFetch.fetch(candidateUrl, {
        headers,
        signal: abortSignal,
      });
    } catch (error) {
      if (abortSignal?.aborted || isCancellationError(error)) {
        throw new CancellationError();
      }
      // Fall back to node fetch when browser-session fetch is unavailable for this request.
    }
  }

  throwIfAborted(abortSignal);
  return fetch(candidateUrl, { headers, signal: abortSignal });
}

export async function attemptPdfDownloadWithFetcher(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  candidateUrl: string,
  pageUrl: string,
  abortSignal?: AbortSignal,
): Promise<
  | {
      ok: true;
      value: PdfDownloadAttemptSuccess;
    }
  | {
      ok: false;
      failure: PdfDownloadAttemptFailure;
    }
> {
  try {
    throwIfAborted(abortSignal);
    const response = await fetcher(candidateUrl, {
      headers: buildPdfFetchHeaders(pageUrl),
      signal: abortSignal,
    });
    if (!response.ok) {
      return {
        ok: false,
        failure: {
          url: candidateUrl,
          status: response.status,
          statusText: response.statusText || 'HTTP request failed',
        },
      };
    }

    const contentType = cleanText(response.headers.get('content-type')).toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());
    const isPdfContentType = /\bapplication\/pdf\b/i.test(contentType);
    const looksPdf = isPdfContentType || isPdfBuffer(buffer);
    if (!looksPdf) {
      return {
        ok: false,
        failure: {
          url: candidateUrl,
          status: 'NOT_PDF_RESPONSE',
          statusText: contentType
            ? `Unexpected content-type: ${contentType}`
            : 'Response body does not look like a PDF file',
          contentType,
        },
      };
    }

    return {
      ok: true,
      value: {
        finalUrl: cleanText(response.url) || candidateUrl,
        buffer,
        contentDisposition: cleanText(response.headers.get('content-disposition')),
      },
    };
  } catch (error) {
    if (abortSignal?.aborted || isCancellationError(error)) {
      throw new CancellationError();
    }

    return {
      ok: false,
      failure: {
        url: candidateUrl,
        status: 'NETWORK_ERROR',
        statusText: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function tryPdfDownloadWithFetcherPolling({
  fetcher,
  downloadUrl,
  refererUrl,
  downloadDir,
  articleTitle = '',
  timeoutMs = 20000,
  pollMs = 500,
  unavailableStatus = 'FETCH_UNAVAILABLE',
  unavailableStatusText = 'Session fetch is unavailable',
  shouldRetry,
  abortSignal,
}: {
  fetcher?: ((url: string, init: RequestInit) => Promise<Response>) | null;
  downloadUrl: string;
  refererUrl: string;
  downloadDir: string;
  articleTitle?: string;
  timeoutMs?: number;
  pollMs?: number;
  unavailableStatus?: string;
  unavailableStatusText?: string;
  shouldRetry?: (failure: PdfDownloadAttemptFailure) => boolean;
  abortSignal?: AbortSignal;
}) {
  const failures: PdfDownloadAttemptFailure[] = [];
  throwIfAborted(abortSignal);
  if (!fetcher) {
    return {
      downloaded: null,
      failures: [
        toPdfDownloadFailure(
          downloadUrl,
          unavailableStatus,
          unavailableStatusText,
        ),
      ],
    };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const attempt = await attemptPdfDownloadWithFetcher(
      fetcher,
      downloadUrl,
      refererUrl,
      abortSignal,
    );
    if (attempt.ok) {
      throwIfAborted(abortSignal);
      return {
        downloaded: await persistDownloadedPdf(attempt.value, downloadDir, articleTitle),
        failures,
      };
    }

    failures.push(attempt.failure);
    if (!shouldRetry?.(attempt.failure)) {
      break;
    }

    await waitForDelay(pollMs, abortSignal);
  }

  return {
    downloaded: null,
    failures,
  };
}

async function attemptPdfDownload(
  candidateUrl: string,
  pageUrl: string,
  abortSignal?: AbortSignal,
): Promise<
  | {
      ok: true;
      value: PdfDownloadAttemptSuccess;
    }
  | {
      ok: false;
      failure: PdfDownloadAttemptFailure;
    }
> {
  return await attemptPdfDownloadWithFetcher(
    async (url, _init) => await fetchPdfWithPreferredTransport(url, pageUrl, abortSignal),
    candidateUrl,
    pageUrl,
    abortSignal,
  );
}

export async function tryDownloadPdfCandidates(candidateUrls: string[], pageUrl: string, abortSignal?: AbortSignal) {
  const failures: PdfDownloadAttemptFailure[] = [];
  let downloaded: PdfDownloadAttemptSuccess | null = null;

  for (const candidateUrl of candidateUrls) {
    throwIfAborted(abortSignal);
    const attempt = await attemptPdfDownload(candidateUrl, pageUrl, abortSignal);
    if (attempt.ok) {
      downloaded = attempt.value;
      break;
    }

    failures.push(attempt.failure);
  }

  return {
    downloaded,
    failures,
  };
}

export function toPdfDownloadFailure(url: string, status: string | number, statusText: string): PdfDownloadAttemptFailure {
  return {
    url,
    status,
    statusText,
  };
}

export function toPdfDownloadFailureFromError(url: string, error: unknown): PdfDownloadAttemptFailure {
  if (isPdfError(error)) {
    const details = error.details ?? {};
    return {
      url,
      status: cleanText(details.status) || error.code,
      statusText: cleanText(details.statusText) || error.message || 'Browser-session download failed',
      contentType: cleanText(details.contentType),
    };
  }

  return {
    url,
    status: 'BROWSER_SESSION_ERROR',
    statusText: error instanceof Error ? error.message : String(error),
  };
}

async function triggerBrowserSessionDownload(
  downloadUrl: string,
  pageUrl: string,
  downloadDir: string,
  articleTitle = '',
  timeoutMs = 45000,
  abortSignal?: AbortSignal,
): Promise<BrowserSessionDownloadResult | null> {
  throwIfAborted(abortSignal);
  const session = await resolveBrowserDownloadSession();
  if (!session) {
    return null;
  }

  return await waitForPdfDownloadFromSession({
    session,
    downloadUrl,
    downloadDir,
    articleTitle,
    timeoutMs,
    origin: 'browser_session',
    abortSignal,
    triggerDownload: () => {
      session.downloadURL(downloadUrl, {
        headers: buildPdfFetchHeaders(pageUrl),
      });
    },
  });
}

export async function tryBrowserSessionDownloadCandidates(
  candidateUrls: string[],
  pageUrl: string,
  downloadDir: string,
  articleTitle = '',
  abortSignal?: AbortSignal,
) {
  const failures: PdfDownloadAttemptFailure[] = [];

  for (const downloadUrl of candidateUrls) {
    throwIfAborted(abortSignal);
    try {
      const browserDownload = await triggerBrowserSessionDownload(
        downloadUrl,
        pageUrl,
        downloadDir,
        articleTitle,
        45000,
        abortSignal,
      );
      if (browserDownload) {
        return {
          downloaded: browserDownload,
          failures,
        };
      }

      failures.push(
        toPdfDownloadFailure(
          downloadUrl,
          'DOWNLOAD_NOT_TRIGGERED',
          'Browser-session download was not triggered',
        ),
      );
    } catch (error) {
      if (isCancellationError(error)) {
        throw error;
      }
      failures.push(toPdfDownloadFailureFromError(downloadUrl, error));
    }
  }

  return {
    downloaded: null,
    failures,
  };
}

function parseContentDispositionFileName(contentDisposition: string) {
  const normalized = cleanText(contentDisposition);
  if (!normalized) return '';

  const encodedMatch = normalized.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;]+)/i);
  if (encodedMatch?.[1]) {
    const rawValue = cleanText(encodedMatch[1]).replace(/^"(.*)"$/, '$1');
    try {
      return cleanText(decodeURIComponent(rawValue));
    } catch {
      return rawValue;
    }
  }

  const plainMatch = normalized.match(/filename\s*=\s*([^;]+)/i);
  if (plainMatch?.[1]) {
    return cleanText(plainMatch[1]).replace(/^"(.*)"$/, '$1');
  }

  return '';
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function persistDownloadedPdf(
  downloaded: PdfDownloadAttemptSuccess,
  downloadDir: string,
  articleTitle = '',
): Promise<BrowserSessionDownloadResult> {
  const parsed = new URL(downloaded.finalUrl);
  const fallbackName = path.basename(parsed.pathname) || `article-${Date.now()}.pdf`;
  const fileNameFromHeader = parseContentDispositionFileName(downloaded.contentDisposition);
  const fileName = buildPdfFileName(
    articleTitle,
    fileNameFromHeader || safeDecodeURIComponent(fallbackName),
  );
  const filePath = path.join(downloadDir, fileName);
  await fs.writeFile(filePath, downloaded.buffer);

  return {
    filePath,
    sourceUrl: downloaded.finalUrl,
  };
}
