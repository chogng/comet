import { parseDateHintFromText } from 'cs/base/common/date';
import { cleanText } from 'cs/base/common/strings';
import { extractListingCardCandidates } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/listing-card-dom';
import {
  createNatureListingCandidateExtractor,
  evaluateNatureListingPaginationStop,
  findNatureListingNextPageUrl,
  isNatureListingPage,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-listing-shared';
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

function resolveNatureOpinionCardOrder({
  $,
  root,
  index,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
  index: number;
}) {
  const link = $(root).find(NATURE_OPINION_LINK_SELECTOR).first();
  const candidateValues = [
    link.attr('data-track-label'),
    link.closest('[data-track-label]').first().attr('data-track-label'),
    $(root).attr('data-track-label'),
  ];

  for (const value of candidateValues) {
    const parsed = parseNatureOpinionTrackLabel(value);
    if (parsed !== null) return parsed;
  }

  return index;
}

function extractNatureOpinionArticleCards(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  return extractListingCardCandidates(context, {
    cardSelectors: [NATURE_OPINION_CARD_SELECTOR],
    linkSelector: NATURE_OPINION_LINK_SELECTOR,
    titleSelector: NATURE_OPINION_TITLE_SELECTOR,
    descriptionSelector: NATURE_OPINION_DESCRIPTION_SELECTOR,
    articleTypeSelector: NATURE_OPINION_ARTICLE_TYPE_SELECTOR,
    extraTextSelectors: [
      {
        key: 'footerText',
        selector: NATURE_OPINION_FOOTER_SELECTOR,
        countDiagnosticKey: 'footerCardCount',
      },
    ],
    date: {
      selector: NATURE_OPINION_DATE_SELECTOR,
      parseValue: parseNatureOpinionDateValue,
      valueAttributes: ['datetime', 'content', 'aria-label', 'title'],
      rootValueAttributes: ['datetime', 'content', 'aria-label', 'title'],
      includeRootText: true,
      scopeSelector: NATURE_OPINION_FOOTER_SELECTOR,
    },
    scoreBoost: 140,
    resolveOrder: ({ $, root, index }) => resolveNatureOpinionCardOrder({ $, root, index }),
    buildDiagnostics: ({ selected, candidates, extraTextCounts }) => {
      const articleTypeCounts = candidates.reduce<Record<string, number>>((accumulator, candidate) => {
        if (candidate.articleType) {
          accumulator[candidate.articleType] = (accumulator[candidate.articleType] ?? 0) + 1;
        }
        return accumulator;
      }, {});

      return {
        layoutSelector: NATURE_OPINION_CARD_SELECTOR,
        linkSelector: NATURE_OPINION_LINK_SELECTOR,
        titleSelector: NATURE_OPINION_TITLE_SELECTOR,
        descriptionSelector: NATURE_OPINION_DESCRIPTION_SELECTOR,
        footerSelector: NATURE_OPINION_FOOTER_SELECTOR,
        articleTypeSelector: NATURE_OPINION_ARTICLE_TYPE_SELECTOR,
        cardCount: selected.roots.length,
        candidateCount: candidates.length,
        describedCardCount: candidates.filter(candidate => Boolean(candidate.descriptionText)).length,
        footerCardCount: extraTextCounts.footerCardCount ?? 0,
        typedCardCount: candidates.filter(candidate => Boolean(candidate.articleType)).length,
        datedCandidateCount: candidates.filter((candidate) => Boolean(candidate.dateHint)).length,
        articleTypeCounts,
        sampleCards: candidates.slice(0, NATURE_OPINION_SAMPLE_CARD_LIMIT).map(candidate => ({
          href: candidate.normalizedUrl,
          title: candidate.title,
          order: candidate.order,
          articleType: candidate.articleType,
          footerText: candidate.extraText.footerText || null,
          dateHint: candidate.dateHint,
        })),
      };
    },
  });
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
