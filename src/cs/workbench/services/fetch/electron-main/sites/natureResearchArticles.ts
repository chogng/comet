/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateHintFromText } from 'cs/base/common/date';
import { parseDateString } from 'cs/base/common/date';
import { isNatureMainSiteUrl } from 'cs/base/common/url';
import { createDateSortedPaginationStopEvaluator } from 'cs/workbench/services/fetch/electron-main/sites/dateSortedPagination';
import { extractListingCardCandidates } from 'cs/workbench/services/fetch/electron-main/sites/listingCardDom';
import {
  createNatureListingCandidateExtractor,
  findNatureListingNextPageUrl,
} from 'cs/workbench/services/fetch/electron-main/sites/natureListingShared';
import type { ListingCandidateExtraction, ListingCandidateExtractor, ListingCandidateExtractorContext, ListingPaginationContext } from 'cs/workbench/services/fetch/electron-main/sites/types';

const NATURE_RESEARCH_ARTICLES_PATH_RE = /^\/[^/]+\/research-articles\/?$/i;
const NATURE_RESEARCH_CARD_SELECTORS = [
  'section#new-article-list li.app-article-list-row__item article.c-card',
  'section#new-article-list article.c-card',
  'main li.app-article-list-row__item article',
  'main li article',
] as const;
const NATURE_RESEARCH_LINK_SELECTOR =
  'h3.c-card__title a[href*="/articles/"], h3 a[href*="/articles/"], a.c-card__link[href*="/articles/"], a[href*="/articles/"]';
const NATURE_RESEARCH_TITLE_SELECTOR = 'h3.c-card__title, h3';
const NATURE_RESEARCH_DESCRIPTION_SELECTOR =
  'div[data-test="article-description"] p, div.c-card__summary p, [itemprop="description"] p';
const NATURE_RESEARCH_ARTICLE_TYPE_SELECTOR =
  'div.c-card__section.c-meta [data-test="article.type"] .c-meta__type, div.c-card__section.c-meta [data-test="article.type"], [data-test="article.type"] .c-meta__type';
const NATURE_RESEARCH_DATE_SELECTOR =
  'time[datetime], .c-meta time[datetime], [itemprop="datePublished"], [datetime], span, div';
const evaluateNatureResearchPaginationStop = createDateSortedPaginationStopEvaluator();
type NatureResearchArticlesListingPageMatcher = (page: URL) => boolean;

function parseNatureResearchDateValue(value: unknown) {
  return parseDateString(value) ?? parseDateHintFromText(value);
}

function extractNatureResearchArticleCards(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  return extractListingCardCandidates(context, {
    cardSelectors: NATURE_RESEARCH_CARD_SELECTORS,
    linkSelector: NATURE_RESEARCH_LINK_SELECTOR,
    titleSelector: NATURE_RESEARCH_TITLE_SELECTOR,
    descriptionSelector: NATURE_RESEARCH_DESCRIPTION_SELECTOR,
    articleTypeSelector: NATURE_RESEARCH_ARTICLE_TYPE_SELECTOR,
    date: {
      selector: NATURE_RESEARCH_DATE_SELECTOR,
      parseValue: parseNatureResearchDateValue,
      valueAttributes: ['datetime', 'content', 'aria-label', 'title'],
      rootValueAttributes: ['datetime', 'content'],
      includeRootText: true,
    },
    scoreBoost: 140,
    resolveOrder: ({ index }) => index,
  });
}

function createNatureResearchArticlesNextPageUrlResolver(
  matches: NatureResearchArticlesListingPageMatcher,
) {
  return function findNatureResearchArticlesNextPageUrl({
    page,
    pageUrl,
    $,
    seenPageUrls,
  }: ListingPaginationContext) {
    if (!matches(page)) return null;
    return findNatureListingNextPageUrl({
      page,
      pageUrl,
      $,
      seenPageUrls,
    });
  };
}

export function createNatureResearchArticlesCandidateExtractor({
  id,
  matches,
}: {
  id: string;
  matches: NatureResearchArticlesListingPageMatcher;
}): ListingCandidateExtractor {
  const findNextPageUrl = createNatureResearchArticlesNextPageUrlResolver(matches);
  const fallbackNatureResearchCandidateExtractor = createNatureListingCandidateExtractor({
    id,
    matches,
    findNextPageUrl,
    evaluatePaginationStop: evaluateNatureResearchPaginationStop,
  });

  return {
    id,
    matches,
    findNextPageUrl,
    evaluatePaginationStop: evaluateNatureResearchPaginationStop,
    extract(context): ListingCandidateExtraction | null {
      const targeted = extractNatureResearchArticleCards(context);
      if (targeted && targeted.candidates.length > 0) {
        return targeted;
      }

      return fallbackNatureResearchCandidateExtractor.extract(context);
    },
  };
}

export const natureResearchArticlesCandidateExtractor = createNatureResearchArticlesCandidateExtractor({
  id: 'nature-research-articles',
  matches: isNatureResearchArticlesListingPage,
});

export function isNatureResearchArticlesListingPage(page: URL) {
  return isNatureMainSiteUrl(page.toString()) && NATURE_RESEARCH_ARTICLES_PATH_RE.test(page.pathname);
}
