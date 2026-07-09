import { parseDateHintFromText } from 'cs/base/common/date';
import { cleanText, uniq } from 'cs/base/common/strings';
import { extractScienceDoiFromPathLike } from 'cs/base/common/url';
import { normalizeListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
import type { ListingCandidateExtractorContext, ListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';

export const TOC_BODY_SELECTORS = [
  'div.toc > div.toc__body > div.toc__body',
  'div.toc__body > div.toc__body',
  'div.toc__body',
] as const;
export const SECTION_SELECTOR = 'section.toc__section';
export const SECTION_HEADING_SELECTOR = 'h4';
export const SUBSECTION_HEADING_SELECTOR = 'h5';
export const CARD_SELECTOR = 'div.card';
export const LINK_SELECTOR =
  'h3.article-title a[href*="/doi/"], h3.article-title a[href], a[href*="/doi/"]';
export const TITLE_SELECTOR = 'h3.article-title';
export const DATE_SELECTOR = '.card-meta time, time[datetime], [datetime]';
export const ABSTRACT_SELECTOR = '.accordion__content, div.card-body';
export const AUTHORS_SELECTOR = 'ul[title="list of authors"] li span';

type Node = Parameters<ListingCandidateExtractorContext['$']>[0];

type TocRoot = {
  root: Node;
  selector: string;
  matchedRootCount: number;
};

type ParsedCard = {
  normalizedUrl: string;
  seed: ListingCandidateSeed;
  hasDateHint: boolean;
  hasAbstractText: boolean;
};

export function normalizeScienceHeading(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function resolveTocRoot({ $ }: Pick<ListingCandidateExtractorContext, '$'>): TocRoot | null {
  for (const selector of TOC_BODY_SELECTORS) {
    const roots = $(selector).toArray();
    const matchedRoot = roots.find((root) => $(root).children(SECTION_SELECTOR).length > 0);
    if (!matchedRoot) continue;

    return {
      root: matchedRoot,
      selector,
      matchedRootCount: roots.length,
    };
  }

  return null;
}

function extractScienceCardLink({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Node;
}) {
  return $(root).find(LINK_SELECTOR).first();
}

function extractScienceCardHref({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Node;
}) {
  return cleanText(extractScienceCardLink({ $, root }).attr('href'));
}

function extractScienceCardTitle({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Node;
}) {
  const title = cleanText($(root).find(TITLE_SELECTOR).first().text());
  if (title) return title;
  return cleanText(extractScienceCardLink({ $, root }).text());
}

function extractScienceCardDateHint({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Node;
}) {
  const dateNodes = $(root).find(DATE_SELECTOR).toArray();
  for (const node of dateNodes) {
    const current = $(node);
    const values = [
      current.attr('datetime'),
      current.attr('content'),
      current.attr('aria-label'),
      current.attr('title'),
      current.text(),
    ];
    for (const value of values) {
      const parsed = parseDateHintFromText(value);
      if (parsed) return parsed;
    }
  }

  return parseDateHintFromText($(root).text());
}

function extractScienceCardAuthors({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Node;
}) {
  const authors = $(root)
    .find(AUTHORS_SELECTOR)
    .map((_, node) => cleanText($(node).text()))
    .get()
    .filter(Boolean);

  return uniq(authors);
}

export function parseScienceCard({
  $,
  root,
  pageUrl,
  order,
  articleType,
  scoreBoost,
}: Pick<ListingCandidateExtractorContext, '$' | 'pageUrl'> & {
  root: Node;
  order: number;
  articleType: string | null;
  scoreBoost: number;
}): ParsedCard | null {
  const href = extractScienceCardHref({ $, root });
  const title = extractScienceCardTitle({ $, root });
  if (!href || !title) return null;

  let normalizedUrl = '';
  try {
    normalizedUrl = new URL(href, pageUrl).toString();
  } catch {
    return null;
  }

  const dateHint = extractScienceCardDateHint({ $, root });
  const abstractText = cleanText($(root).find(ABSTRACT_SELECTOR).first().text()) || null;
  const seed = normalizeListingCandidateSeed({
    href,
    order,
    dateHint,
    articleType,
    title,
    doi: extractScienceDoiFromPathLike(href),
    authors: extractScienceCardAuthors({ $, root }),
    abstractText,
    publishedAt: dateHint ?? null,
    scoreBoost,
  });
  if (!seed) return null;

  return {
    normalizedUrl,
    seed,
    hasDateHint: Boolean(dateHint),
    hasAbstractText: Boolean(abstractText),
  };
}
