import { parseDateHintFromText } from 'cs/base/common/date';
import { parseDateString } from 'cs/base/common/date';
import { cleanText } from 'cs/base/common/strings';

import {
  createNatureListingCandidateExtractor,
  evaluateNatureListingPaginationStop,
  findNatureListingNextPageUrl,
  isNatureListingPage,
} from 'cs/code/electron-main/fetch/sourceExtractors/nature-listing-shared';
import { shortenForLog, timingLog } from 'cs/code/electron-main/fetchTiming';
import { normalizeListingCandidateSeed } from 'cs/code/electron-main/fetch/sourceExtractors/types';
import type { ListingCandidateExtraction, ListingCandidateExtractor, ListingCandidateExtractorContext, ListingCandidateRefinementContext, ListingPaginationContext, ListingCandidateSeed } from 'cs/code/electron-main/fetch/sourceExtractors/types';

const NATURE_LATEST_NEWS_LISTING_PAGE_PATH = '/latest-news';
const NATURE_LATEST_NEWS_RSS_URL = 'https://www.nature.com/nature.rss';
const NATURE_LATEST_NEWS_RSS_HINT_TTL_MS = 5 * 60 * 1000;

const NATURE_LATEST_NEWS_CARD_SELECTOR = 'div.c-article-item__wrapper';
const NATURE_LATEST_NEWS_LINK_SELECTOR = 'a[href*="/articles/"][data-track-label^="article card "]';
const NATURE_LATEST_NEWS_TITLE_SELECTOR = 'h3.c-article-item__title';
const NATURE_LATEST_NEWS_DESCRIPTION_SELECTOR = 'div.c-article-item__standfirst';
const NATURE_LATEST_NEWS_FOOTER_SELECTOR = 'div.c-article-item__footer';
const NATURE_LATEST_NEWS_ARTICLE_TYPE_SELECTOR = 'span.c-article-item__article-type';
const NATURE_LATEST_NEWS_DATE_SELECTOR = 'span.c-article-item__date, time[datetime], [datetime], span, div';
const NATURE_LATEST_NEWS_TRACK_LABEL_RE = /^article card\s+(\d+)$/i;
const NATURE_LATEST_NEWS_SAMPLE_CARD_LIMIT = 5;
const natureLatestNewsRssHintCache = new Map<string, { expiresAt: number; hints: Map<string, string> }>();

const fallbackNatureLatestNewsCandidateExtractor = createNatureListingCandidateExtractor({
  id: 'nature-latest-news',
  matches: isNatureLatestNewsListingPage,
  findNextPageUrl: findNatureLatestNewsNextPageUrl,
  refineExtraction: refineNatureLatestNewsExtraction,
});

function parseNatureLatestNewsDateValue(value: unknown) {
  return parseDateHintFromText(value);
}

function parseNatureLatestNewsTrackLabel(value: unknown) {
  const normalized = cleanText(value);
  if (!normalized) return null;

  const matched = normalized.match(NATURE_LATEST_NEWS_TRACK_LABEL_RE);
  if (!matched) return null;

  const parsed = Number.parseInt(matched[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractNatureLatestNewsLink({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return $(root).find(NATURE_LATEST_NEWS_LINK_SELECTOR).first();
}

function extractNatureLatestNewsHref({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText(extractNatureLatestNewsLink({ $, root }).attr('href'));
}

function extractNatureLatestNewsTitle({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_LATEST_NEWS_TITLE_SELECTOR).first().text());
}

function extractNatureLatestNewsDescription({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_LATEST_NEWS_DESCRIPTION_SELECTOR).first().text());
}

function extractNatureLatestNewsFooterText({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_LATEST_NEWS_FOOTER_SELECTOR).first().text());
}

function extractNatureLatestNewsArticleType({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_LATEST_NEWS_ARTICLE_TYPE_SELECTOR).first().text());
}

function extractNatureLatestNewsCardOrder({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const link = extractNatureLatestNewsLink({ $, root });
  const candidateValues = [
    link.attr('data-track-label'),
    link.closest('[data-track-label]').first().attr('data-track-label'),
    $(root).attr('data-track-label'),
  ];

  for (const value of candidateValues) {
    const parsed = parseNatureLatestNewsTrackLabel(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function extractNatureLatestNewsDateHint({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const scopedRoot = $(root).find(NATURE_LATEST_NEWS_FOOTER_SELECTOR).first();
  const fallbackRoot = scopedRoot.length > 0 ? scopedRoot : $(root);

  const candidateNodes = fallbackRoot.find(NATURE_LATEST_NEWS_DATE_SELECTOR).toArray();
  for (const node of candidateNodes) {
    const element = $(node);
    const candidateValues = [
      element.attr('datetime'),
      element.attr('content'),
      element.attr('aria-label'),
      element.attr('title'),
      element.text(),
    ];
    for (const value of candidateValues) {
      const parsed = parseNatureLatestNewsDateValue(value);
      if (parsed) return parsed;
    }
  }

  const fallbackValues = [
    fallbackRoot.attr('datetime'),
    fallbackRoot.attr('content'),
    fallbackRoot.attr('aria-label'),
    fallbackRoot.attr('title'),
    fallbackRoot.text(),
  ];
  for (const value of fallbackValues) {
    const parsed = parseNatureLatestNewsDateValue(value);
    if (parsed) return parsed;
  }

  return null;
}

function extractNatureLatestNewsArticleCards(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  const { $, pageUrl } = context;
  const roots = $(NATURE_LATEST_NEWS_CARD_SELECTOR).toArray();
  if (roots.length === 0) return null;

  let describedCardCount = 0;
  let footerCardCount = 0;
  let typedCardCount = 0;

  const articleTypeCounts: Record<string, number> = {};
  const sampleCards: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  const candidates = roots
    .map((root, index) => {
      const href = extractNatureLatestNewsHref({ $, root });
      const title = extractNatureLatestNewsTitle({ $, root });
      if (!href || !title) return null;

      const description = extractNatureLatestNewsDescription({ $, root });
      const footerText = extractNatureLatestNewsFooterText({ $, root });
      const articleType = extractNatureLatestNewsArticleType({ $, root });

      if (description) describedCardCount += 1;
      if (footerText) footerCardCount += 1;
      if (articleType) {
        typedCardCount += 1;
        articleTypeCounts[articleType] = (articleTypeCounts[articleType] ?? 0) + 1;
      }

      let normalized = '';
      try {
        normalized = new URL(href, pageUrl).toString();
      } catch {
        return null;
      }

      if (seen.has(normalized)) return null;
      seen.add(normalized);

      const order = extractNatureLatestNewsCardOrder({ $, root }) ?? index;
      const dateHint = extractNatureLatestNewsDateHint({ $, root });

      if (sampleCards.length < NATURE_LATEST_NEWS_SAMPLE_CARD_LIMIT) {
        sampleCards.push({
          href: normalized,
          title,
          order,
          articleType: articleType || null,
          footerText: footerText || null,
          dateHint,
        });
      }

      return normalizeListingCandidateSeed({
        href,
        order,
        dateHint,
        articleType: articleType || null,
        title,
        descriptionText: description || null,
        publishedAt: dateHint,
        scoreBoost: 140,
      });
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (candidates.length === 0) return null;

  return {
    candidates,
    diagnostics: {
      layoutSelector: NATURE_LATEST_NEWS_CARD_SELECTOR,
      linkSelector: NATURE_LATEST_NEWS_LINK_SELECTOR,
      titleSelector: NATURE_LATEST_NEWS_TITLE_SELECTOR,
      descriptionSelector: NATURE_LATEST_NEWS_DESCRIPTION_SELECTOR,
      footerSelector: NATURE_LATEST_NEWS_FOOTER_SELECTOR,
      articleTypeSelector: NATURE_LATEST_NEWS_ARTICLE_TYPE_SELECTOR,
      cardCount: roots.length,
      candidateCount: candidates.length,
      describedCardCount,
      footerCardCount,
      typedCardCount,
      datedCandidateCount: candidates.filter((candidate) => Boolean(candidate.dateHint)).length,
      articleTypeCounts,
      sampleCards,
    },
  };
}

export const natureLatestNewsCandidateExtractor: ListingCandidateExtractor = {
  id: 'nature-latest-news',
  matches: isNatureLatestNewsListingPage,
  findNextPageUrl: findNatureLatestNewsNextPageUrl,
  refineExtraction: refineNatureLatestNewsExtraction,
  evaluatePaginationStop: evaluateNatureListingPaginationStop,
  extract(context): ListingCandidateExtraction | null {
    const targeted = extractNatureLatestNewsArticleCards(context);
    if (targeted && targeted.candidates.length > 0) {
      return targeted;
    }

    return fallbackNatureLatestNewsCandidateExtractor.extract(context);
  },
};

export function isNatureLatestNewsListingPage(page: URL) {
  return isNatureListingPage(page, NATURE_LATEST_NEWS_LISTING_PAGE_PATH);
}

function parseNatureLatestNewsRssDateHints(xml: string) {
  const hints = new Map<string, string>();
  const itemRegex = /<item\s+rdf:about="([^"]+)"[\s\S]*?<dc:date>([^<]+)<\/dc:date>/gi;
  for (const match of xml.matchAll(itemRegex)) {
    const urlValue = cleanText(match[1]);
    const dateValue = parseDateString(match[2]);
    if (!urlValue || !dateValue) continue;
    try {
      hints.set(new URL(urlValue).toString(), dateValue);
    } catch {
      continue;
    }
  }
  return hints;
}

async function fetchNatureLatestNewsRssDateHints({
  traceId,
  fetchHtml,
}: Pick<ListingCandidateRefinementContext, 'traceId' | 'fetchHtml'>) {
  const cacheKey = NATURE_LATEST_NEWS_RSS_URL;
  const now = Date.now();
  const cached = natureLatestNewsRssHintCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.hints;
  }

  try {
    const xml = await fetchHtml(NATURE_LATEST_NEWS_RSS_URL, {
      timeoutMs: 12000,
      traceId,
      stage: 'source_nature_latest_news_rss',
    });
    const hints = parseNatureLatestNewsRssDateHints(xml);
    natureLatestNewsRssHintCache.set(cacheKey, {
      hints,
      expiresAt: now + NATURE_LATEST_NEWS_RSS_HINT_TTL_MS,
    });
    return hints;
  } catch (error) {
    timingLog(traceId, 'source_nature_latest_news_rss:failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return new Map<string, string>();
  }
}

async function refineNatureLatestNewsExtraction({
  page,
  pageUrl,
  pageNumber,
  traceId,
  extraction,
  fetchHtml,
}: ListingCandidateRefinementContext) {
  if (!isNatureLatestNewsListingPage(page)) {
    return extraction;
  }

  if (extraction.candidates.length === 0) {
    return extraction;
  }

  const rssHints = await fetchNatureLatestNewsRssDateHints({
    traceId,
    fetchHtml,
  });
  if (rssHints.size === 0) {
    return extraction;
  }

  let rssHintApplied = 0;
  const candidates: ListingCandidateSeed[] = extraction.candidates.map((candidate) => {
    if (candidate.dateHint) {
      return candidate;
    }

    try {
      const normalizedUrl = new URL(candidate.href, pageUrl).toString();
      const rssDateHint = rssHints.get(normalizedUrl) ?? null;
      if (!rssDateHint) {
        return candidate;
      }

      rssHintApplied += 1;
      return {
        ...candidate,
        dateHint: rssDateHint,
      };
    } catch {
      return candidate;
    }
  });

  if (rssHintApplied === 0) {
    return extraction;
  }

  timingLog(traceId, 'source:candidate_rss_hint_applied', {
    pageNumber,
    rssHintCount: rssHints.size,
    rssHintApplied,
    pageUrl: shortenForLog(pageUrl),
  });

  return {
    ...extraction,
    candidates,
    diagnostics: {
      ...(extraction.diagnostics ?? {}),
      rssHintCount: rssHints.size,
      rssHintApplied,
    },
  };
}

function findNatureLatestNewsNextPageUrl({
  page,
  pageUrl,
  $,
  seenPageUrls,
}: ListingPaginationContext) {
  if (!isNatureLatestNewsListingPage(page)) return null;
  return findNatureListingNextPageUrl({
    page,
    pageUrl,
    $,
    seenPageUrls,
  });
}

