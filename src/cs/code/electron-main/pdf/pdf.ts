import path from 'node:path';
import { promises as fs } from 'node:fs';
import { load } from 'cheerio';

import type { WebContentPdfDownloadPayload } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { buildPdfDirectoryName } from 'cs/platform/download/common/pdfFileName';
import { cleanText } from 'cs/base/common/strings';
import { normalizeUrl } from 'cs/base/common/url';
import { CancellationError, isCancellationError } from 'cs/base/common/errors';
import { PdfErrorCode, pdfError } from 'cs/platform/download/common/pdfErrors';
import { fetchHtml } from 'cs/platform/request/electron-main/fetchHtml';
import { isCompatFetchEnvEnabled } from 'cs/platform/fetch/node/fetchTiming';
import {
  buildNatureResearchPdfDownloadCandidates,
  extractNatureResearchPdfDownloadCandidatesFromHtml,
} from 'cs/code/electron-main/pdf/naturePdf';
import { persistDownloadedPdf, toAbsoluteHttpUrl, tryBrowserSessionDownloadCandidates, tryDownloadPdfCandidates } from 'cs/platform/download/electron-main/pdfDownload';
import type { PdfDownloadAttemptFailure } from 'cs/platform/download/electron-main/pdfDownload';

import { natureLatestNewsPdfStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/natureLatestNewsPdfStrategy';
import { naturePdfStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/naturePdfStrategy';
import { sciencePdfStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/sciencePdfStrategy';
import type { PdfDownloadContext, PdfDownloadStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/pdfStrategyTypes';
import { buildScienceDirectPdfDownloadCandidates } from 'cs/code/electron-main/pdf/sciencePdf';

const PDF_STRATEGY_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);

function logPdfStrategy(stage: string, details: Record<string, unknown>) {
  if (!PDF_STRATEGY_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[pdf-strategy] ${stage} ${encodedDetails}`);
}

function summarizeStrategyFailure(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancellationError();
  }
}

function pickMetaContent($: ReturnType<typeof load>, selectors: string[]) {
  for (const selector of selectors) {
    const value = cleanText($(selector).first().attr('content'));
    if (value) return value;
  }

  return '';
}

function scorePdfLinkCandidate(
  href: string,
  absoluteUrl: string,
  contextText: string,
  mimeType: string,
  rel: string,
  hasDownloadAttribute: boolean,
) {
  const hrefText = `${href} ${absoluteUrl}`.toLowerCase();
  const context = contextText.toLowerCase();
  const loweredMime = mimeType.toLowerCase();
  const loweredRel = rel.toLowerCase();

  let score = 0;

  if (/\.pdf(?:$|[?#])/i.test(hrefText)) score += 220;
  if (/\bapplication\/pdf\b/i.test(loweredMime)) score += 200;
  if (hasDownloadAttribute) score += 150;

  if (/(?:[?&](?:format|filetype|type|mime)=pdf(?:[&#]|$)|\/e?pdf(?:[/?#]|$))/i.test(hrefText)) {
    score += 140;
  }

  if (/\/doi\/epdf\//i.test(hrefText)) {
    score += 120;
  }

  if (/\b(download|fulltext|full-text|getpdf|viewpdf|pdfviewer)\b/i.test(hrefText)) {
    score += 70;
  }

  if (/\b(pdf|download\s*pdf|view\s*pdf|full\s*text)\b/i.test(context)) {
    score += 90;
  }

  if (/\b(?:btn-pdf|icon-pdf)\b/i.test(context)) {
    score += 60;
  }

  if (/\b(?:alternate|attachment)\b/i.test(loweredRel)) {
    score += 30;
  }

  if (/\b(citation|bibtex|endnote|ris|supplement|dataset|metadata|xml|fig(ure)?s?)\b/i.test(`${hrefText} ${context}`)) {
    score -= 140;
  }

  if (/\.(zip|csv|xml|json|docx?|pptx?|xlsx?)(?:$|[?#])/i.test(hrefText)) {
    score -= 260;
  }

  return score;
}

function extractPdfUrl(pageUrl: string, html: string) {
  const $ = load(html);
  const fromMeta = pickMetaContent($, [
    'meta[name="citation_pdf_url"]',
    'meta[property="citation_pdf_url"]',
    'meta[name="wkhealth_pdf_url"]',
    'meta[name="pdf_url"]',
    'meta[property="pdf_url"]',
  ]);
  if (fromMeta) {
    return toAbsoluteHttpUrl(fromMeta, pageUrl) ?? fromMeta;
  }

  const scoredCandidates = new Map<string, number>();
  const hrefNodes = $('a[href], link[href], area[href]').toArray();

  for (const node of hrefNodes) {
    const element = $(node);
    const href = cleanText(element.attr('href'));
    if (!href) continue;

    const absoluteUrl = toAbsoluteHttpUrl(href, pageUrl);
    if (!absoluteUrl) continue;

    const textParts = [
      cleanText(element.text()),
      cleanText(element.attr('title')),
      cleanText(element.attr('aria-label')),
      cleanText(element.attr('data-track-action')),
      cleanText(element.attr('data-track-label')),
      cleanText(element.attr('class')),
    ].filter(Boolean);

    const contextText = textParts.join(' ');
    const mimeType = cleanText(element.attr('type'));
    const rel = cleanText(element.attr('rel'));
    const hasDownloadAttribute = element.attr('download') !== undefined;

    const score = scorePdfLinkCandidate(
      href,
      absoluteUrl,
      contextText,
      mimeType,
      rel,
      hasDownloadAttribute,
    );
    const existingScore = scoredCandidates.get(absoluteUrl) ?? Number.NEGATIVE_INFINITY;
    if (score > existingScore) {
      scoredCandidates.set(absoluteUrl, score);
    }
  }

  if (scoredCandidates.size > 0) {
    const best = [...scoredCandidates.entries()].sort((left, right) => right[1] - left[1])[0];
    if (best && best[1] >= 100) {
      return best[0];
    }
  }

  const hrefCandidates = [...scoredCandidates.keys()];
  for (const href of hrefCandidates) {
    if (!/\.pdf(?:$|[?#])/i.test(href)) continue;
    return href;
  }

  const regexMatch = html.match(/https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/i);
  return regexMatch ? regexMatch[0] : null;
}

function buildPdfDownloadCandidates(pdfUrl: string, pageUrl: string) {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const addCandidate = (value: string) => {
    const absolute = toAbsoluteHttpUrl(value, pageUrl);
    if (!absolute || seen.has(absolute)) {
      return;
    }

    seen.add(absolute);
    candidates.push(absolute);
  };

  const absolutePdfUrl = toAbsoluteHttpUrl(pdfUrl, pageUrl) ?? pdfUrl;
  const natureCandidates = buildNatureResearchPdfDownloadCandidates(absolutePdfUrl);
  for (const natureCandidate of natureCandidates) {
    addCandidate(natureCandidate);
  }

  addCandidate(absolutePdfUrl);
  return candidates;
}

const pdfDownloadStrategies: readonly PdfDownloadStrategy[] = [
  sciencePdfStrategy,
  natureLatestNewsPdfStrategy,
  naturePdfStrategy,
];

function resolveMatchingPdfDownloadStrategies(request: PdfDownloadContext) {
  return pdfDownloadStrategies.filter((strategy) => strategy.matches(request));
}

async function previewDownloadPdfWithResolvedRequest(request: PdfDownloadContext) {
  throwIfAborted(request.abortSignal);
  const directCandidateUrls = [
    ...new Set([
      ...request.naturePdfCandidateUrls,
      request.requestedDownloadUrl,
    ].filter((value): value is string => Boolean(value))),
  ];

  const browserDownloadAttempt = await tryBrowserSessionDownloadCandidates(
    directCandidateUrls,
    request.pageUrl,
    request.downloadDir,
    request.articleTitle,
    request.abortSignal,
  );
  throwIfAborted(request.abortSignal);
  if (browserDownloadAttempt.downloaded) {
    logPdfStrategy('generic_browser_session_success', {
      pageUrl: request.pageUrl,
      sourceUrl: browserDownloadAttempt.downloaded.sourceUrl,
      filePath: browserDownloadAttempt.downloaded.filePath,
    });
    return browserDownloadAttempt.downloaded;
  }

  const directDownloadAttempt =
    directCandidateUrls.length > 0
      ? await tryDownloadPdfCandidates(directCandidateUrls, request.pageUrl, request.abortSignal)
      : { downloaded: null, failures: [] as PdfDownloadAttemptFailure[] };

  throwIfAborted(request.abortSignal);
  let downloaded = directDownloadAttempt.downloaded;
  const failures: PdfDownloadAttemptFailure[] = [
    ...browserDownloadAttempt.failures,
    ...directDownloadAttempt.failures,
  ];

  if (!downloaded) {
    let html =
      typeof request.webContentHtmlSnapshot === 'string' && request.webContentHtmlSnapshot.trim()
        ? request.webContentHtmlSnapshot
        : '';
    if (!html) {
      try {
        html = await fetchHtml(request.pageUrl, { signal: request.abortSignal });
      } catch (error) {
        throwIfAborted(request.abortSignal);
        if (failures.length > 0) {
          const latestFailure = failures[failures.length - 1];
          logPdfStrategy('generic_failed', {
            pageUrl: request.pageUrl,
            reason: 'page_fetch_failed_after_candidate_failures',
            failureCount: failures.length,
            latestFailure: latestFailure
              ? {
                  status: latestFailure.status,
                  statusText: latestFailure.statusText,
                  url: latestFailure.url,
                }
              : null,
          });
          throw pdfError(PdfErrorCode.DownloadFailed, {
            status: latestFailure?.status ?? 'NETWORK_ERROR',
            statusText: latestFailure?.statusText ?? 'Unable to download PDF from detected links',
            pageUrl: request.pageUrl,
            attemptedUrls: directCandidateUrls,
            failures,
            pageFetchError: error instanceof Error ? error.message : String(error),
          });
        }

        throw error;
      }
    }

    throwIfAborted(request.abortSignal);
    const pdfUrl = extractPdfUrl(request.pageUrl, html);
    if (!pdfUrl) {
      logPdfStrategy('generic_pdf_link_not_found', {
        pageUrl: request.pageUrl,
      });
      throw pdfError(PdfErrorCode.LinkNotFound, { pageUrl: request.pageUrl });
    }

    const resolvedCandidateUrls = buildPdfDownloadCandidates(pdfUrl, request.pageUrl);
    const resolvedDownloadAttempt = await tryDownloadPdfCandidates(
      resolvedCandidateUrls,
      request.pageUrl,
      request.abortSignal,
    );
    throwIfAborted(request.abortSignal);
    downloaded = resolvedDownloadAttempt.downloaded;
    failures.push(...resolvedDownloadAttempt.failures);

    if (!downloaded) {
      const latestFailure = failures[failures.length - 1];
      logPdfStrategy('generic_failed', {
        pageUrl: request.pageUrl,
        reason: 'resolved_candidates_failed',
        pdfUrl,
        failureCount: failures.length,
        latestFailure: latestFailure
          ? {
              status: latestFailure.status,
              statusText: latestFailure.statusText,
              url: latestFailure.url,
            }
          : null,
      });
      throw pdfError(PdfErrorCode.DownloadFailed, {
        status: latestFailure?.status ?? 'NETWORK_ERROR',
        statusText: latestFailure?.statusText ?? 'Unable to download PDF from detected links',
        pdfUrl,
        attemptedUrls: [...new Set([...directCandidateUrls, ...resolvedCandidateUrls])],
        failures,
      });
    }
  }

  logPdfStrategy('generic_success', {
    pageUrl: request.pageUrl,
    finalUrl: downloaded.finalUrl,
  });
  throwIfAborted(request.abortSignal);
  return await persistDownloadedPdf(downloaded, request.downloadDir, request.articleTitle);
}

function createPdfDownloadContext(
  payload: WebContentPdfDownloadPayload,
  defaultDownloadDir: string,
  webContentHtmlSnapshot: string | null,
  abortSignal?: AbortSignal,
): PdfDownloadContext {
  const pageUrl = normalizeUrl(payload.pageUrl ?? '');
  const requestedDownloadUrl =
    typeof payload.downloadUrl === 'string'
      ? toAbsoluteHttpUrl(payload.downloadUrl, pageUrl)
      : null;
  const doi = typeof payload.doi === 'string' ? cleanText(payload.doi) || null : null;
  const articleTitle =
    typeof payload.articleTitle === 'string' ? cleanText(payload.articleTitle) : '';
  const journalTitle =
    typeof payload.journalTitle === 'string' ? cleanText(payload.journalTitle) : '';
  const customDownloadDir =
    typeof payload.customDownloadDir === 'string' ? cleanText(payload.customDownloadDir) : '';
  const baseDownloadDir = customDownloadDir || defaultDownloadDir;
  const journalDirName = buildPdfDirectoryName(journalTitle);
  const downloadDir = journalDirName
    ? path.join(baseDownloadDir, journalDirName)
    : baseDownloadDir;

  return {
    pageUrl,
    requestedDownloadUrl,
    doi,
    articleTitle,
    journalTitle,
    downloadDir,
    webContentHtmlSnapshot,
    abortSignal,
    sciencePdfCandidateUrls: [
      ...new Set([
        ...buildScienceDirectPdfDownloadCandidates(pageUrl, doi),
        ...(requestedDownloadUrl
          ? buildScienceDirectPdfDownloadCandidates(requestedDownloadUrl, doi)
          : []),
      ]),
    ],
    naturePdfCandidateUrls: [
      ...new Set([
        ...extractNatureResearchPdfDownloadCandidatesFromHtml(pageUrl, webContentHtmlSnapshot ?? ''),
        ...buildNatureResearchPdfDownloadCandidates(pageUrl),
        ...(requestedDownloadUrl ? buildNatureResearchPdfDownloadCandidates(requestedDownloadUrl) : []),
      ]),
    ],
  };
}

export async function previewDownloadPdf(
  payload: WebContentPdfDownloadPayload = {},
  defaultDownloadDir: string,
  webContentHtmlSnapshot: string | null = null,
  abortSignal?: AbortSignal,
) {
  const request = createPdfDownloadContext(payload, defaultDownloadDir, webContentHtmlSnapshot, abortSignal);
  throwIfAborted(request.abortSignal);
  await fs.mkdir(request.downloadDir, { recursive: true });
  throwIfAborted(request.abortSignal);

  logPdfStrategy('request_built', {
    pageUrl: request.pageUrl,
    requestedDownloadUrl: request.requestedDownloadUrl,
    doi: request.doi,
    articleTitle: request.articleTitle,
    scienceCandidateCount: request.sciencePdfCandidateUrls.length,
    natureCandidateCount: request.naturePdfCandidateUrls.length,
  });

  const matchingStrategies = resolveMatchingPdfDownloadStrategies(request);
  logPdfStrategy('strategies_matched', {
    pageUrl: request.pageUrl,
    strategies: matchingStrategies.map((strategy) => ({
      id: strategy.id,
      priority: strategy.priority,
    })),
  });

  const exclusiveStrategy =
    matchingStrategies.find((strategy) => strategy.priority === 'exclusive') ?? null;
  if (exclusiveStrategy) {
    logPdfStrategy('exclusive_selected', {
      pageUrl: request.pageUrl,
      strategyId: exclusiveStrategy.id,
    });
    const result = await exclusiveStrategy.download(request);
    throwIfAborted(request.abortSignal);
    if (result) {
      return result;
    }
    logPdfStrategy('exclusive_skipped', {
      pageUrl: request.pageUrl,
      strategyId: exclusiveStrategy.id,
    });
  }

  const preferredStrategies = matchingStrategies.filter(
    (strategy) => strategy.priority === 'preferred',
  );
  for (const strategy of preferredStrategies) {
    logPdfStrategy('preferred_attempt', {
      pageUrl: request.pageUrl,
      strategyId: strategy.id,
    });
    try {
      throwIfAborted(request.abortSignal);
      const result = await strategy.download(request);
      throwIfAborted(request.abortSignal);
      if (!result) {
        logPdfStrategy('preferred_skipped', {
          pageUrl: request.pageUrl,
          strategyId: strategy.id,
        });
        continue;
      }
      logPdfStrategy('preferred_success', {
        pageUrl: request.pageUrl,
        strategyId: strategy.id,
        sourceUrl: result.sourceUrl,
      });
      return result;
    } catch (error) {
      if (isCancellationError(error)) {
        throw error;
      }
      logPdfStrategy('preferred_failed', {
        pageUrl: request.pageUrl,
        strategyId: strategy.id,
        failure: summarizeStrategyFailure(error),
      });
    }
  }

  logPdfStrategy('generic_fallback_start', {
    pageUrl: request.pageUrl,
  });
  return await previewDownloadPdfWithResolvedRequest(request);
}
