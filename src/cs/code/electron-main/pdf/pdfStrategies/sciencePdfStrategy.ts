import type { BrowserWindow } from 'electron';

import type { PdfDownloadResult } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError, CancellationError, isCancellationError } from 'cs/base/common/errors';
import { isCompatFetchEnvEnabled } from 'cs/code/electron-main/fetchTiming';
import { clearWorkbenchSharedSessionOrigins } from 'cs/platform/native/electron-main/sharedWebSession';
import { persistDownloadedPdf, toPdfDownloadFailure, toPdfDownloadFailureFromError, tryBrowserSessionDownloadCandidates, tryPdfDownloadWithFetcherPolling, tryDownloadPdfCandidates, waitForPdfDownloadFromSession } from 'cs/platform/download/electron-main/pdfDownload';
import type { BrowserSessionDownloadResult, PdfDownloadAttemptFailure } from 'cs/platform/download/electron-main/pdfDownload';

import { buildScienceEpdfPageUrl } from 'cs/code/electron-main/pdf/sciencePdf';
import {
  triggerSciencePdfDownloadInValidationWindow,
  withValidatedSciencePageWindow,
} from 'cs/platform/window/electron-main/scienceValidationWindow';
import type { PdfDownloadContext, PdfDownloadStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/pdfStrategyTypes';

type ScienceValidatedPageDownloadOptions = {
  useWindowFetchProbe?: boolean;
  abortSignal?: AbortSignal;
};

const SCIENCE_PDF_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);

let sciencePdfDownloadQueueTail: Promise<void> = Promise.resolve();
let sciencePdfDownloadQueueDepth = 0;

function logSciencePdf(stage: string, details: Record<string, unknown>) {
  if (!SCIENCE_PDF_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[science-pdf] ${stage} ${encodedDetails}`);
}

function summarizeScienceFailures(failures: PdfDownloadAttemptFailure[]) {
  return failures.map((failure) => ({
    url: failure.url,
    status: failure.status,
    statusText: failure.statusText,
    contentType: failure.contentType || '',
  }));
}

function findScienceValidationRequiredFailure(failures: PdfDownloadAttemptFailure[]) {
  return (
    failures.find((failure) => String(failure.status).toUpperCase() === 'SCIENCE_VALIDATION_REQUIRED') ??
    null
  );
}

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw new CancellationError();
  }
}

async function waitForPromiseOrAbort<T>(
  promise: Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  throwIfAborted(abortSignal);
  if (!abortSignal) {
    return await promise;
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      abortSignal.removeEventListener('abort', handleAbort);
    };

    const resolveOnce = (value: T) => {
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

    abortSignal.addEventListener('abort', handleAbort, { once: true });
    if (abortSignal.aborted) {
      handleAbort();
      return;
    }

    promise.then(resolveOnce, rejectOnce);
  });
}

function throwScienceDownloadFailure(
  request: PdfDownloadContext,
  failures: PdfDownloadAttemptFailure[],
): never {
  const prioritizedFailure =
    findScienceValidationRequiredFailure(failures) ?? failures[failures.length - 1] ?? null;
  throw appError('PDF_DOWNLOAD_FAILED', {
    status: prioritizedFailure?.status ?? 'NETWORK_ERROR',
    statusText:
      prioritizedFailure?.statusText ?? 'Unable to download Science PDF from shared-session window',
    pageUrl: request.pageUrl,
    attemptedUrls: request.sciencePdfCandidateUrls,
    failures,
  });
}

async function runSerializedSciencePdfDownload<T>(
  pageUrl: string,
  task: () => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  const waitForTurn = sciencePdfDownloadQueueTail;
  let releaseTurn = () => {};
  let enteredQueue = false;
  sciencePdfDownloadQueueDepth += 1;
  const queuePosition = sciencePdfDownloadQueueDepth;
  sciencePdfDownloadQueueTail = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });

  if (queuePosition > 1) {
    logSciencePdf('queued', {
      pageUrl,
      queuePosition,
    });
  }

  try {
    await waitForPromiseOrAbort(waitForTurn.catch(() => {}), abortSignal);
    throwIfAborted(abortSignal);
    enteredQueue = true;
    logSciencePdf('queue_enter', {
      pageUrl,
      queuePosition,
    });

    const result = await task();
    logSciencePdf('task_resolved', {
      pageUrl,
      queuePosition,
    });
    return result;
  } catch (error) {
    logSciencePdf('task_rejected', {
      pageUrl,
      queuePosition,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
            }
          : {
              message: String(error),
            },
    });
    throw error;
  } finally {
    sciencePdfDownloadQueueDepth = Math.max(0, sciencePdfDownloadQueueDepth - 1);
    if (enteredQueue) {
      releaseTurn();
    } else {
      waitForTurn.finally(releaseTurn);
    }
    logSciencePdf('queue_exit', {
      pageUrl,
      remainingQueueDepth: sciencePdfDownloadQueueDepth,
    });
  }
}

async function clearScienceSessionState() {
  return await clearWorkbenchSharedSessionOrigins([
    'https://www.science.org',
    'https://science.org',
  ]);
}

async function triggerValidatedSciencePageDownload(
  window: BrowserWindow,
  downloadUrl: string,
  downloadDir: string,
  articleTitle = '',
  timeoutMs = 45000,
  abortSignal?: AbortSignal,
): Promise<BrowserSessionDownloadResult | null> {
  throwIfAborted(abortSignal);
  const webContents = window.webContents;
  if (webContents.isDestroyed()) {
    return null;
  }

  const abortController = new AbortController();
  const handleWindowClosed = () => {
    abortController.abort();
  };
  const handleAbort = () => {
    abortController.abort();
  };
  window.once('closed', handleWindowClosed);
  abortSignal?.addEventListener('abort', handleAbort, { once: true });

  try {
    return await waitForPdfDownloadFromSession({
      session: webContents.session,
      downloadUrl,
      downloadDir,
      articleTitle,
      timeoutMs,
      origin: 'validated_page',
      originatingWebContentsId: webContents.id,
      abortSignal: abortController.signal,
      triggerDownload: () =>
        triggerSciencePdfDownloadInValidationWindow(window, downloadUrl, {
          abortSignal: abortController.signal,
          pageUrl: downloadUrl,
        }),
    });
  } finally {
    if (!window.isDestroyed()) {
      window.removeListener('closed', handleWindowClosed);
    }
    abortSignal?.removeEventListener('abort', handleAbort);
  }
}

function shouldContinueWaitingForValidatedScienceAuthorization(
  failure: PdfDownloadAttemptFailure,
) {
  const status = String(failure.status).toUpperCase();
  return status === '403' || status === 'NOT_PDF_RESPONSE' || status === 'NETWORK_ERROR';
}

async function tryValidatedScienceWindowFetch(
  window: BrowserWindow,
  downloadUrl: string,
  refererUrl: string,
  downloadDir: string,
  articleTitle = '',
  timeoutMs = 20000,
  pollMs = 500,
  abortSignal?: AbortSignal,
) {
  const session = window.webContents.session;
  return await tryPdfDownloadWithFetcherPolling({
    fetcher: session && typeof session.fetch === 'function' ? session.fetch.bind(session) : null,
    downloadUrl,
    refererUrl,
    downloadDir,
    articleTitle,
    timeoutMs,
    pollMs,
    unavailableStatus: 'SCIENCE_VALIDATION_FETCH_UNAVAILABLE',
    unavailableStatusText: 'Validation window session fetch is unavailable',
    shouldRetry: shouldContinueWaitingForValidatedScienceAuthorization,
    abortSignal,
  });
}

async function tryValidatedSciencePageDownload(
  pageUrl: string,
  downloadUrl: string,
  downloadDir: string,
  articleTitle = '',
  options: ScienceValidatedPageDownloadOptions = {},
) {
  const { useWindowFetchProbe = true, abortSignal } = options;
  throwIfAborted(abortSignal);

  try {
    const downloaded = await withValidatedSciencePageWindow(pageUrl, async (window, validation) => {
      throwIfAborted(abortSignal);
      const validatedWindowFetchAttempt = useWindowFetchProbe
        ? await tryValidatedScienceWindowFetch(
            window,
            downloadUrl,
            validation.finalUrl || pageUrl,
            downloadDir,
            articleTitle,
            20000,
            500,
            abortSignal,
          )
        : {
            downloaded: null,
            failures: [] as PdfDownloadAttemptFailure[],
          };
      throwIfAborted(abortSignal);
      if (validatedWindowFetchAttempt.downloaded) {
        logSciencePdf('validated_window_fetch_success', {
          pageUrl,
          sourceUrl: validatedWindowFetchAttempt.downloaded.sourceUrl,
          filePath: validatedWindowFetchAttempt.downloaded.filePath,
        });
        return validatedWindowFetchAttempt.downloaded;
      }

      if (useWindowFetchProbe && validatedWindowFetchAttempt.failures.length > 0) {
        logSciencePdf('validated_window_fetch_not_ready', {
          pageUrl,
          failures: summarizeScienceFailures(validatedWindowFetchAttempt.failures),
        });
      }

      const clickedDownload = await triggerValidatedSciencePageDownload(
        window,
        downloadUrl,
        downloadDir,
        articleTitle,
        45000,
        abortSignal,
      );
      throwIfAborted(abortSignal);
      if (clickedDownload) {
        return clickedDownload;
      }

      if (validatedWindowFetchAttempt.failures.length > 0) {
        const latestFailure =
          validatedWindowFetchAttempt.failures[validatedWindowFetchAttempt.failures.length - 1];
        throw appError('PDF_DOWNLOAD_FAILED', {
          status: latestFailure?.status ?? 'DOWNLOAD_NOT_TRIGGERED',
          statusText:
            latestFailure?.statusText ??
            'Validated Science page became visible before PDF authorization was ready',
          url: downloadUrl,
        });
      }

      return null;
    });

    return {
      downloaded,
      failures: [] as PdfDownloadAttemptFailure[],
    };
  } catch (error) {
    if (isCancellationError(error) || abortSignal?.aborted) {
      throw new CancellationError();
    }

    logSciencePdf('validated_page_exception', {
      pageUrl,
      downloadUrl,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
            }
          : {
              message: String(error),
            },
    });
    return {
      downloaded: null,
      failures: [toPdfDownloadFailureFromError(downloadUrl, error)],
    };
  }
}

function shouldRetryScienceDownloadWithCleanSession(failures: PdfDownloadAttemptFailure[]) {
  if (failures.length === 0) {
    return false;
  }

  return failures.some((failure) => {
    const status = String(failure.status).toUpperCase();
    return (
      status === '403' ||
      status === 'NOT_PDF_RESPONSE' ||
      status === 'DOWNLOAD_INTERRUPTED' ||
      status === 'DOWNLOAD_NOT_TRIGGERED'
    );
  });
}

function resolveStrictScienceDownloadTargets(request: PdfDownloadContext) {
  const validationPageUrl =
    buildScienceEpdfPageUrl(request.pageUrl, request.doi) ||
    (request.requestedDownloadUrl
      ? buildScienceEpdfPageUrl(request.requestedDownloadUrl, request.doi)
      : null) ||
    request.pageUrl ||
    request.requestedDownloadUrl ||
    request.sciencePdfCandidateUrls[0] ||
    '';
  const preferredPdfUrl =
    request.sciencePdfCandidateUrls[0] || request.requestedDownloadUrl || '';
  if (!validationPageUrl || !preferredPdfUrl) {
    return null;
  }

  return {
    validationPageUrl,
    preferredPdfUrl,
  };
}

async function downloadSciencePdf(request: PdfDownloadContext): Promise<PdfDownloadResult> {
  return await runSerializedSciencePdfDownload(request.pageUrl, async () => {
    throwIfAborted(request.abortSignal);
    logSciencePdf('start', {
      pageUrl: request.pageUrl,
      requestedDownloadUrl: request.requestedDownloadUrl,
      doi: request.doi,
      directCandidateUrls: request.sciencePdfCandidateUrls,
      downloadDir: request.downloadDir,
      strategy: 'validated-window-primary',
    });

    const failures: PdfDownloadAttemptFailure[] = [];
    const strictDownloadTargets = resolveStrictScienceDownloadTargets(request);

    if (strictDownloadTargets) {
      logSciencePdf('validated_page_attempt', {
        pageUrl: request.pageUrl,
        validationPageUrl: strictDownloadTargets.validationPageUrl,
        preferredPdfUrl: strictDownloadTargets.preferredPdfUrl,
        strategy: 'primary_shared_window',
      });
      const validatedPageDownloadAttempt = await tryValidatedSciencePageDownload(
        strictDownloadTargets.validationPageUrl,
        strictDownloadTargets.preferredPdfUrl,
        request.downloadDir,
        request.articleTitle,
        {
          useWindowFetchProbe: true,
          abortSignal: request.abortSignal,
        },
      );
      throwIfAborted(request.abortSignal);
      if (validatedPageDownloadAttempt.downloaded) {
        logSciencePdf('validated_page_success', {
          pageUrl: request.pageUrl,
          sourceUrl: validatedPageDownloadAttempt.downloaded.sourceUrl,
          filePath: validatedPageDownloadAttempt.downloaded.filePath,
        });
        return validatedPageDownloadAttempt.downloaded;
      }

      failures.push(...validatedPageDownloadAttempt.failures);
      if (validatedPageDownloadAttempt.failures.length > 0) {
        logSciencePdf('validated_page_failed', {
          pageUrl: request.pageUrl,
          failures: summarizeScienceFailures(validatedPageDownloadAttempt.failures),
        });
        if (findScienceValidationRequiredFailure(validatedPageDownloadAttempt.failures)) {
          throwScienceDownloadFailure(request, failures);
        }
      } else {
        failures.push(
          toPdfDownloadFailure(
            strictDownloadTargets.preferredPdfUrl,
            'DOWNLOAD_NOT_TRIGGERED',
            'Validated Science page click did not trigger a download',
          ),
        );
      }

      if (shouldRetryScienceDownloadWithCleanSession(failures)) {
        logSciencePdf('session_reset_retry', {
          pageUrl: request.pageUrl,
          failures: summarizeScienceFailures(failures),
        });
        await clearScienceSessionState();
        throwIfAborted(request.abortSignal);

        const cleanValidatedPageDownloadAttempt = await tryValidatedSciencePageDownload(
          strictDownloadTargets.validationPageUrl,
          strictDownloadTargets.preferredPdfUrl,
          request.downloadDir,
          request.articleTitle,
          {
            useWindowFetchProbe: true,
            abortSignal: request.abortSignal,
          },
        );
        throwIfAborted(request.abortSignal);
        if (cleanValidatedPageDownloadAttempt.downloaded) {
          logSciencePdf('session_reset_validated_page_success', {
            pageUrl: request.pageUrl,
            sourceUrl: cleanValidatedPageDownloadAttempt.downloaded.sourceUrl,
            filePath: cleanValidatedPageDownloadAttempt.downloaded.filePath,
          });
          return cleanValidatedPageDownloadAttempt.downloaded;
        }

        failures.push(...cleanValidatedPageDownloadAttempt.failures);
        if (cleanValidatedPageDownloadAttempt.failures.length > 0) {
          logSciencePdf('session_reset_validated_page_failed', {
            pageUrl: request.pageUrl,
            failures: summarizeScienceFailures(cleanValidatedPageDownloadAttempt.failures),
          });
        } else {
          failures.push(
            toPdfDownloadFailure(
              strictDownloadTargets.preferredPdfUrl,
              'DOWNLOAD_NOT_TRIGGERED',
              'Validated Science page click did not trigger a download after session reset',
            ),
          );
        }
      }
    }

    const browserDownloadAttempt = await tryBrowserSessionDownloadCandidates(
      request.sciencePdfCandidateUrls,
      request.pageUrl,
      request.downloadDir,
      request.articleTitle,
      request.abortSignal,
    );
    throwIfAborted(request.abortSignal);
    if (browserDownloadAttempt.downloaded) {
      logSciencePdf('browser_session_success', {
        pageUrl: request.pageUrl,
        sourceUrl: browserDownloadAttempt.downloaded.sourceUrl,
        filePath: browserDownloadAttempt.downloaded.filePath,
        strategy: 'fallback_shared_session',
      });
      return browserDownloadAttempt.downloaded;
    }

    failures.push(...browserDownloadAttempt.failures);
    if (browserDownloadAttempt.failures.length > 0) {
      logSciencePdf('direct_attempts_failed', {
        pageUrl: request.pageUrl,
        failures: summarizeScienceFailures(browserDownloadAttempt.failures),
        strategy: 'fallback_shared_session',
        directCandidateUrls: request.sciencePdfCandidateUrls,
      });
    }

    const directDownloadAttempt =
      request.sciencePdfCandidateUrls.length > 0
        ? await tryDownloadPdfCandidates(
            request.sciencePdfCandidateUrls,
            request.pageUrl,
            request.abortSignal,
          )
        : { downloaded: null, failures: [] as PdfDownloadAttemptFailure[] };
    throwIfAborted(request.abortSignal);
    if (directDownloadAttempt.downloaded) {
      logSciencePdf('http_fetch_success', {
        pageUrl: request.pageUrl,
        finalUrl: directDownloadAttempt.downloaded.finalUrl,
        strategy: 'fallback_http_fetch',
      });
      throwIfAborted(request.abortSignal);
      return await persistDownloadedPdf(
        directDownloadAttempt.downloaded,
        request.downloadDir,
        request.articleTitle,
      );
    }

    failures.push(...directDownloadAttempt.failures);
    logSciencePdf('failed', {
      pageUrl: request.pageUrl,
      attemptedUrls: request.sciencePdfCandidateUrls,
      failures: summarizeScienceFailures(failures),
    });
    throwScienceDownloadFailure(request, failures);
  }, request.abortSignal);
}

export const sciencePdfStrategy: PdfDownloadStrategy = {
  id: 'science-exclusive',
  priority: 'exclusive',
  matches(request) {
    return request.sciencePdfCandidateUrls.length > 0;
  },
  async download(request) {
    return await downloadSciencePdf(request);
  },
};
