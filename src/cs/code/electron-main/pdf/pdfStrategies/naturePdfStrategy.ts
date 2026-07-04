import { appError } from 'cs/base/common/errors';
import { isCompatFetchEnvEnabled } from 'cs/code/electron-main/fetchTiming';
import { persistDownloadedPdf, tryBrowserSessionDownloadCandidates, tryDownloadPdfCandidates } from 'cs/platform/download/electron-main/pdfDownload';
import type { PdfDownloadAttemptFailure } from 'cs/platform/download/electron-main/pdfDownload';

import type { PdfDownloadContext, PdfDownloadStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/pdfStrategyTypes';

const NATURE_PDF_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);

function logNaturePdf(stage: string, details: Record<string, unknown>) {
  if (!NATURE_PDF_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[nature-pdf] ${stage} ${encodedDetails}`);
}

function summarizeNatureFailures(failures: PdfDownloadAttemptFailure[]) {
  return failures.map((failure) => ({
    url: failure.url,
    status: failure.status,
    statusText: failure.statusText,
    contentType: failure.contentType || '',
  }));
}

async function downloadNatureResearchPdfWithFallbacks(request: PdfDownloadContext) {
  logNaturePdf('start', {
    pageUrl: request.pageUrl,
    requestedDownloadUrl: request.requestedDownloadUrl,
    directCandidateUrls: request.naturePdfCandidateUrls,
    downloadDir: request.downloadDir,
  });

  const browserDownloadAttempt = await tryBrowserSessionDownloadCandidates(
    request.naturePdfCandidateUrls,
    request.pageUrl,
    request.downloadDir,
    request.articleTitle,
  );
  if (browserDownloadAttempt.downloaded) {
    logNaturePdf('browser_session_success', {
      pageUrl: request.pageUrl,
      sourceUrl: browserDownloadAttempt.downloaded.sourceUrl,
      filePath: browserDownloadAttempt.downloaded.filePath,
    });
    return browserDownloadAttempt.downloaded;
  }

  const failures: PdfDownloadAttemptFailure[] = [...browserDownloadAttempt.failures];
  if (browserDownloadAttempt.failures.length > 0) {
    logNaturePdf('browser_session_failed', {
      pageUrl: request.pageUrl,
      failures: summarizeNatureFailures(browserDownloadAttempt.failures),
    });
  }

  const directDownloadAttempt =
    request.naturePdfCandidateUrls.length > 0
      ? await tryDownloadPdfCandidates(request.naturePdfCandidateUrls, request.pageUrl)
      : { downloaded: null, failures: [] as PdfDownloadAttemptFailure[] };
  if (directDownloadAttempt.downloaded) {
    logNaturePdf('http_fetch_success', {
      pageUrl: request.pageUrl,
      finalUrl: directDownloadAttempt.downloaded.finalUrl,
    });
    return await persistDownloadedPdf(
      directDownloadAttempt.downloaded,
      request.downloadDir,
      request.articleTitle,
    );
  }

  failures.push(...directDownloadAttempt.failures);
  const latestFailure = failures[failures.length - 1];
  logNaturePdf('failed', {
    pageUrl: request.pageUrl,
    attemptedUrls: request.naturePdfCandidateUrls,
    failures: summarizeNatureFailures(failures),
  });

  throw appError('PDF_DOWNLOAD_FAILED', {
    status: latestFailure?.status ?? 'PDF_LINK_NOT_FOUND',
    statusText:
      latestFailure?.statusText ?? 'Unable to download Nature PDF from known candidate URLs',
    pageUrl: request.pageUrl,
    attemptedUrls: request.naturePdfCandidateUrls,
    failures,
  });
}

export const naturePdfStrategy: PdfDownloadStrategy = {
  id: 'nature-research-preferred',
  priority: 'preferred',
  matches(request) {
    return request.naturePdfCandidateUrls.length > 0;
  },
  async download(request) {
    return await downloadNatureResearchPdfWithFallbacks(request);
  },
};
