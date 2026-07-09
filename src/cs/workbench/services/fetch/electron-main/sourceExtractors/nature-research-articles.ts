import { parseDateHintFromText } from 'cs/base/common/date';
import { parseDateString } from 'cs/base/common/date';
import { cleanText } from 'cs/base/common/strings';
import { isNatureMainSiteUrl } from 'cs/base/common/url';
import { createDateSortedPaginationStopEvaluator } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/date-sorted-pagination';
import {
  createNatureListingCandidateExtractor,
  findNatureListingNextPageUrl,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-listing-shared';
import { normalizeListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
import type { ListingCandidateExtraction, ListingCandidateExtractor, ListingCandidateExtractorContext, ListingPaginationContext } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';

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

function resolveNatureResearchCardRoots({ $ }: Pick<ListingCandidateExtractorContext, '$'>) {
  for (const selector of NATURE_RESEARCH_CARD_SELECTORS) {
    const roots = $(selector).toArray();
    if (roots.length === 0) continue;

    const matchedCount = roots.reduce((count, root) => {
      const href = extractNatureResearchHref({ $, root });
      const title = extractNatureResearchTitle({ $, root });
      return href && title ? count + 1 : count;
    }, 0);

    if (matchedCount === 0) continue;
    return {
      selector,
      roots,
      matchedCount,
    };
  }

  return null;
}

function extractNatureResearchDateHint({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidateNodes = $(root).find(NATURE_RESEARCH_DATE_SELECTOR).toArray();
  for (const node of candidateNodes) {
    const dateNode = $(node);
    const values = [
      dateNode.attr('datetime'),
      dateNode.attr('content'),
      dateNode.attr('aria-label'),
      dateNode.attr('title'),
      dateNode.text(),
    ];
    for (const value of values) {
      const parsed = parseDateString(value) ?? parseDateHintFromText(value);
      if (parsed) return parsed;
    }
  }

  const fallbackValues = [$(root).attr('datetime'), $(root).attr('content'), $(root).text()];
  for (const value of fallbackValues) {
    const parsed = parseDateString(value) ?? parseDateHintFromText(value);
    if (parsed) return parsed;
  }

  return null;
}

function extractNatureResearchLink({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return $(root).find(NATURE_RESEARCH_LINK_SELECTOR).first();
}

function extractNatureResearchHref({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText(extractNatureResearchLink({ $, root }).attr('href'));
}

function extractNatureResearchTitle({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const titleFromHeading = cleanText($(root).find(NATURE_RESEARCH_TITLE_SELECTOR).first().text());
  if (titleFromHeading) return titleFromHeading;
  return cleanText(extractNatureResearchLink({ $, root }).text());
}

function extractNatureResearchDescription({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_RESEARCH_DESCRIPTION_SELECTOR).first().text());
}

function extractNatureResearchArticleType({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find(NATURE_RESEARCH_ARTICLE_TYPE_SELECTOR).first().text());
}

function extractNatureResearchArticleCards(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  const { $, pageUrl } = context;
  const selected = resolveNatureResearchCardRoots({ $ });
  if (!selected || selected.roots.length === 0) return null;

  let typedCandidateCount = 0;
  const articleTypeCounts: Record<string, number> = {};
  const seen = new Set<string>();

  const candidates = selected.roots
    .map((root, index) => {
      const href = extractNatureResearchHref({ $, root });
      const title = extractNatureResearchTitle({ $, root });
      if (!href || !title) return null;

      let normalized = '';
      try {
        normalized = new URL(href, pageUrl).toString();
      } catch {
        return null;
      }

      if (seen.has(normalized)) return null;
      seen.add(normalized);

      const articleType = extractNatureResearchArticleType({ $, root }) || null;
      const dateHint = extractNatureResearchDateHint({ $, root });
      if (articleType) {
        typedCandidateCount += 1;
        articleTypeCounts[articleType] = (articleTypeCounts[articleType] ?? 0) + 1;
      }
      const description = extractNatureResearchDescription({ $, root });

      return normalizeListingCandidateSeed({
        href,
        order: index,
        dateHint,
        articleType,
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
      cardSelector: selected.selector,
      cardSelectorCandidates: NATURE_RESEARCH_CARD_SELECTORS,
      cardCount: selected.roots.length,
      cardMatchedCount: selected.matchedCount,
      candidateCount: candidates.length,
      datedCandidateCount: candidates.filter((candidate) => Boolean(candidate.dateHint)).length,
      typedCandidateCount,
      articleTypeCounts,
    },
  };
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
