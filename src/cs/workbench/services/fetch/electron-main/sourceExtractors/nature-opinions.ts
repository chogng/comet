import { parseDateHintFromText } from 'cs/base/common/date';
import { cleanText } from 'cs/base/common/strings';
import {
  createNatureListingCandidateExtractor,
  evaluateNatureListingPaginationStop,
  findNatureListingNextPageUrl,
  isNatureListingPage,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-listing-shared';
import { normalizeListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
import type { ListingCandidateExtraction, ListingCandidateExtractor, ListingCandidateExtractorContext, ListingPaginationContext } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';

const NATURE_OPINION_LISTING_PAGE_PATH = '/opinion';
const NATURE_OPINION_CARD_SELECTOR = 'div.c-article-item__wrapper';
const NATURE_OPINION_LINK_SELECTOR = 'a[href*="/articles/"][data-track-label^="article card "]';
const NATURE_OPINION_TITLE_SELECTOR = 'h3.c-article-item__title';
const NATURE_OPINION_DESCRIPTION_SELECTOR = 'div.c-article-item__standfirst';
const NATURE_OPINION_FOOTER_SELECTOR = 'div.c-article-item__footer';
const NATURE_OPINION_ARTICLE_TYPE_SELECTOR = 'span.c-article-item__article-type';
const NATURE_OPINION_DATE_SELECTOR = 'span.c-article-item__date, time[datetime], [datetime], span, div';
const NATURE_OPINION_TRACK_LABEL_RE = /^article card\s+(\d+)$/i;
const NATURE_OPINION_SAMPLE_CARD_LIMIT = 5;

const fallbackNatureOpinionCandidateExtractor = createNatureListingCandidateExtractor({
  id: 'nature-opinion',
  matches: isNatureOpinionListingPage,
  findNextPageUrl: findNatureOpinionNextPageUrl,
});

function parseNatureOpinionDateValue(value: unknown) {
  return parseDateHintFromText(value);
}

function parseNatureOpinionTrackLabel(value: unknown) {
  const normalized = cleanText(value);
  if (!normalized) return null;

  const matched = normalized.match(NATURE_OPINION_TRACK_LABEL_RE);
  if (!matched) return null;

  const parsed = Number.parseInt(matched[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractNatureOpinionLink({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return $(root).find(NATURE_OPINION_LINK_SELECTOR).first();
}

function extractNatureOpinionHref({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText(extractNatureOpinionLink({ $, root }).attr('href'));
}

function extractNatureOpinionTitle({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_OPINION_TITLE_SELECTOR).first().text());
}

function extractNatureOpinionDescription({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_OPINION_DESCRIPTION_SELECTOR).first().text());
}

function extractNatureOpinionFooterText({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_OPINION_FOOTER_SELECTOR).first().text());
}

function extractNatureOpinionArticleType({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_OPINION_ARTICLE_TYPE_SELECTOR).first().text());
}

function extractNatureOpinionCardOrder({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const link = extractNatureOpinionLink({ $, root });
  const candidateValues = [
    link.attr('data-track-label'),
    link.closest('[data-track-label]').first().attr('data-track-label'),
    $(root).attr('data-track-label'),
  ];

  for (const value of candidateValues) {
    const parsed = parseNatureOpinionTrackLabel(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function extractNatureOpinionDateHint({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const scopedRoot = $(root).find(NATURE_OPINION_FOOTER_SELECTOR).first();
  const fallbackRoot = scopedRoot.length > 0 ? scopedRoot : $(root);

  const candidateNodes = fallbackRoot.find(NATURE_OPINION_DATE_SELECTOR).toArray();
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
      const parsed = parseNatureOpinionDateValue(value);
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
    const parsed = parseNatureOpinionDateValue(value);
    if (parsed) return parsed;
  }

  return null;
}

function extractNatureOpinionArticleCards(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  const { $, pageUrl } = context;
  const roots = $(NATURE_OPINION_CARD_SELECTOR).toArray();
  if (roots.length === 0) return null;

  let describedCardCount = 0;
  let footerCardCount = 0;
  let typedCardCount = 0;

  const articleTypeCounts: Record<string, number> = {};
  const sampleCards: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  const candidates = roots
    .map((root, index) => {
      const href = extractNatureOpinionHref({ $, root });
      const title = extractNatureOpinionTitle({ $, root });
      if (!href || !title) return null;

      const description = extractNatureOpinionDescription({ $, root });
      const footerText = extractNatureOpinionFooterText({ $, root });
      const articleType = extractNatureOpinionArticleType({ $, root });

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

      const order = extractNatureOpinionCardOrder({ $, root }) ?? index;
      const dateHint = extractNatureOpinionDateHint({ $, root });

      if (sampleCards.length < NATURE_OPINION_SAMPLE_CARD_LIMIT) {
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
      layoutSelector: NATURE_OPINION_CARD_SELECTOR,
      linkSelector: NATURE_OPINION_LINK_SELECTOR,
      titleSelector: NATURE_OPINION_TITLE_SELECTOR,
      descriptionSelector: NATURE_OPINION_DESCRIPTION_SELECTOR,
      footerSelector: NATURE_OPINION_FOOTER_SELECTOR,
      articleTypeSelector: NATURE_OPINION_ARTICLE_TYPE_SELECTOR,
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

function findNatureOpinionNextPageUrl(context: ListingPaginationContext) {
  if (!isNatureOpinionListingPage(context.page)) return null;
  return findNatureListingNextPageUrl(context);
}

export const natureOpinionCandidateExtractor: ListingCandidateExtractor = {
  id: 'nature-opinion',
  matches: isNatureOpinionListingPage,
  findNextPageUrl: findNatureOpinionNextPageUrl,
  evaluatePaginationStop: evaluateNatureListingPaginationStop,
  extract(context): ListingCandidateExtraction | null {
    const targeted = extractNatureOpinionArticleCards(context);
    if (targeted && targeted.candidates.length > 0) {
      return targeted;
    }

    return fallbackNatureOpinionCandidateExtractor.extract(context);
  },
};

export function isNatureOpinionListingPage(page: URL) {
  return isNatureListingPage(page, NATURE_OPINION_LISTING_PAGE_PATH);
}
