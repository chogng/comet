import { load } from 'cheerio';

import type { PdfDownloadResult } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import { isNatureMainSiteUrl } from 'cs/base/common/url';
import { fetchHtml } from 'cs/code/electron-main/fetch/dispatch';
import { isCompatFetchEnvEnabled } from 'cs/code/electron-main/fetchTiming';
import type { PdfDownloadContext } from 'cs/code/electron-main/pdf/pdfStrategies/pdfStrategyTypes';
import { printWebPageToPdf } from 'cs/code/electron-main/pdf/webPagePdf';

const NATURE_LATEST_NEWS_PDF_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);

function logNatureLatestNewsPdf(stage: string, details: Record<string, unknown>) {
  if (!NATURE_LATEST_NEWS_PDF_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[nature-latest-news-pdf] ${stage} ${encodedDetails}`);
}

function matchesNatureLatestNewsArticleType(value: string) {
  const normalized = cleanText(value).toLowerCase();
  return normalized === 'news';
}

export function isLikelyNatureLatestNewsArticleUrl(pageUrl: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(pageUrl);
  } catch {
    parsed = null;
  }

  if (!parsed || !isNatureMainSiteUrl(parsed.toString())) {
    return false;
  }

  return /^\/articles\/d41586-\d{3}-/i.test(parsed.pathname);
}

export function isNatureLatestNewsArticlePage(pageUrl: string, html: string) {
  const normalizedHtml = typeof html === 'string' ? html : '';
  if (!normalizedHtml.trim()) {
    return false;
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(pageUrl);
  } catch {
    parsed = null;
  }

  if (!parsed || !isNatureMainSiteUrl(parsed.toString()) || !/^\/articles\/[^/]+\/?$/i.test(parsed.pathname)) {
    return false;
  }

  const $ = load(normalizedHtml);
  const metaArticleType = cleanText($('meta[name="citation_article_type"]').first().attr('content'));
  if (matchesNatureLatestNewsArticleType(metaArticleType)) {
    return true;
  }

  const sectionText = cleanText($('meta[property="article:section"]').first().attr('content'));
  if (matchesNatureLatestNewsArticleType(sectionText)) {
    return true;
  }

  const breadcrumbTrail = cleanText(
    $('nav[aria-label*="breadcrumb" i], ol[aria-label*="breadcrumb" i], .c-breadcrumb').first().text(),
  ).toLowerCase();
  if (/\bnature\b/.test(breadcrumbTrail) && /\bnews\b/.test(breadcrumbTrail) && /\barticle\b/.test(breadcrumbTrail)) {
    return true;
  }

  const pageCategory = cleanText($('[data-test="article-category"]').first().text());
  return matchesNatureLatestNewsArticleType(pageCategory);
}

async function resolveNatureLatestNewsHtml(request: PdfDownloadContext) {
  if (typeof request.webContentHtmlSnapshot === 'string' && request.webContentHtmlSnapshot.trim()) {
    return request.webContentHtmlSnapshot;
  }

  try {
    return await fetchHtml(request.pageUrl);
  } catch {
    return '';
  }
}

export async function tryDownloadNatureLatestNewsPdf(
  request: PdfDownloadContext,
): Promise<PdfDownloadResult | null> {
  const html = await resolveNatureLatestNewsHtml(request);
  if (!isNatureLatestNewsArticlePage(request.pageUrl, html)) {
    logNatureLatestNewsPdf('not_applicable', {
      pageUrl: request.pageUrl,
    });
    return null;
  }

  logNatureLatestNewsPdf('print_start', {
    pageUrl: request.pageUrl,
    downloadDir: request.downloadDir,
  });

  const result = await printWebPageToPdf({
    pageUrl: request.pageUrl,
    articleTitle: request.articleTitle,
    downloadDir: request.downloadDir,
  });

  logNatureLatestNewsPdf('print_success', {
    pageUrl: request.pageUrl,
    filePath: result.filePath,
    sourceUrl: result.sourceUrl,
  });

  return result;
}
