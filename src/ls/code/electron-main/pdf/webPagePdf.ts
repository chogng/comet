import path from 'node:path';
import { promises as fs } from 'node:fs';

import type { PdfDownloadResult } from 'ls/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'ls/base/common/strings';
import { appError } from 'ls/base/common/errors';
import { isCompatFetchEnvEnabled } from 'ls/code/electron-main/fetchTiming';
import { buildPdfFileName } from 'ls/platform/download/common/pdfFileName';
import {
  getWebContentState,
  navigateWebContentForPrint,
  printCurrentWebContentToPdf,
  waitForWebContentPrintLayout,
} from 'ls/platform/browserView/electron-main/browserViewMainService';

const WEB_PAGE_PDF_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);
const WEB_PAGE_PDF_STABILIZE_MS = 1200;

function logWebPagePdf(stage: string, details: Record<string, unknown>) {
  if (!WEB_PAGE_PDF_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[web-page-pdf] ${stage} ${encodedDetails}`);
}

function normalizeComparableUrl(value: string) {
  const normalized = cleanText(value);
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return normalized;
  }
}

async function navigateWebContentForPdf(pageUrl: string) {
  await navigateWebContentForPrint(pageUrl);
  const currentWebContentUrl = cleanText(getWebContentState().url);
  if (normalizeComparableUrl(currentWebContentUrl) === normalizeComparableUrl(pageUrl)) {
    logWebPagePdf('web_content_navigate_abort_ignored', {
      pageUrl,
      currentWebContentUrl,
      message: 'Navigation gate accepted once web content URL and main content were ready.',
    });
  }
}

export async function printWebPageToPdf({
  pageUrl,
  articleTitle = '',
  downloadDir,
}: {
  pageUrl: string;
  articleTitle?: string;
  downloadDir: string;
}): Promise<PdfDownloadResult> {
  const startedAt = Date.now();
  try {
    await fs.mkdir(downloadDir, { recursive: true });

    const navigateStartedAt = Date.now();
    logWebPagePdf('web_content_navigate_start', {
      pageUrl,
      previousWebContentUrl: cleanText(getWebContentState().url),
      downloadDir,
    });

    if (cleanText(getWebContentState().url) !== pageUrl) {
      await navigateWebContentForPdf(pageUrl);
    }

    logWebPagePdf('web_content_navigate_done', {
      pageUrl,
      currentWebContentUrl: cleanText(getWebContentState().url),
      elapsedMs: Date.now() - navigateStartedAt,
    });

    const waitStartedAt = Date.now();
    await waitForWebContentPrintLayout(WEB_PAGE_PDF_STABILIZE_MS);
    logWebPagePdf('wait_main_ready_done', {
      pageUrl,
      currentWebContentUrl: cleanText(getWebContentState().url),
      elapsedMs: Date.now() - waitStartedAt,
    });

    const printStartedAt = Date.now();
    logWebPagePdf('before_print_to_pdf', {
      pageUrl,
      currentWebContentUrl: cleanText(getWebContentState().url),
    });

    const pdfBuffer = await printCurrentWebContentToPdf();
    logWebPagePdf('print_to_pdf_done', {
      pageUrl,
      currentWebContentUrl: cleanText(getWebContentState().url),
      elapsedMs: Date.now() - printStartedAt,
      pdfBytes: pdfBuffer.byteLength,
    });

    const targetUrl = cleanText(getWebContentState().url) || pageUrl;
    const fallbackName = (() => {
      try {
        return path.basename(new URL(targetUrl).pathname) || '';
      } catch {
        return '';
      }
    })();
    const fileName = buildPdfFileName(articleTitle, fallbackName);
    const filePath = path.join(downloadDir, fileName);
    const writeStartedAt = Date.now();
    await fs.writeFile(filePath, pdfBuffer);
    logWebPagePdf('file_write_done', {
      pageUrl,
      filePath,
      elapsedMs: Date.now() - writeStartedAt,
    });

    logWebPagePdf('print_success', {
      pageUrl,
      finalUrl: targetUrl,
      filePath,
      restoreWebContent: false,
      totalElapsedMs: Date.now() - startedAt,
    });

    return {
      filePath,
      sourceUrl: targetUrl,
    };
  } catch (error) {
    logWebPagePdf('print_failed', {
      pageUrl,
      currentWebContentUrl: cleanText(getWebContentState().url),
      message: error instanceof Error ? error.message : String(error),
    });
    throw appError('PDF_DOWNLOAD_FAILED', {
      status: 'PRINT_TO_PDF_FAILED',
      statusText: error instanceof Error ? error.message : String(error),
      pageUrl,
    });
  }
}
