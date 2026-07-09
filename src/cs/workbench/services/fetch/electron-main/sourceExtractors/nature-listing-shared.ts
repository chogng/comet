import { parseDateHintFromText } from 'cs/base/common/date';
import { cleanText } from 'cs/base/common/strings';
import { isNatureMainSiteUrl } from 'cs/base/common/url';
import { createDateSortedPaginationStopEvaluator } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/date-sorted-pagination';
import { normalizeListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
import type { ListingCandidateExtraction, ListingCandidateExtractor, ListingCandidateExtractorContext, ListingPaginationStopContext, ListingPaginationStopEvaluation, ListingCandidateRefinementContext, ListingPaginationContext } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';

const NATURE_LISTING_LAYOUT_SELECTORS = [
  'section.section__top-new > div.u-container',
  'div.u-container.c-component',
  'section[class*="section__top"] div.u-container',
  'section div.u-container',
] as const;
const NATURE_LISTING_PAGINATION_LINK_SELECTOR = 'nav a[href], a[href]';
const NATURE_LISTING_LINK_SELECTOR = 'a[href*="/articles/"]';
const NATURE_LISTING_TRACKED_LINK_SELECTOR = 'a[data-track-label]';
const NATURE_LISTING_DATE_SELECTOR =
  'time[datetime], [datetime], [itemprop="datePublished"], span, div';
const NATURE_LISTING_RANK_RE = /Rank:\((\d+)\)/i;
const NATURE_LISTING_TRACK_LABEL_RE = /^article card\s+(\d+)$/i;
export const evaluateNatureListingPaginationStop = createDateSortedPaginationStopEvaluator();

function parseNatureListingDateValue(value: unknown) {
  return parseDateHintFromText(value);
}

function countArticleLinksWithin({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return $(root).find(NATURE_LISTING_LINK_SELECTOR).length;
}

function extractNatureListingDateHint({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidateNodes = $(root).find(NATURE_LISTING_DATE_SELECTOR).toArray();
  for (const node of candidateNodes) {
    const dateNode = $(node);
    const candidateValues = [
      dateNode.attr('datetime'),
      dateNode.attr('content'),
      dateNode.attr('aria-label'),
      dateNode.attr('title'),
      dateNode.text(),
    ];
    for (const value of candidateValues) {
      const parsed = parseNatureListingDateValue(value);
      if (parsed) return parsed;
    }
  }

  return parseNatureListingDateValue($(root).text());
}

function extractNatureListingHref({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const link = $(root).find(NATURE_LISTING_LINK_SELECTOR).first();
  return cleanText(link.attr('href'));
}

function extractNatureListingTitle({
  $,
  root,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  return cleanText($(root).find('h3').first().text());
}

function parseNatureListingRankValue(value: unknown) {
  const normalized = cleanText(value);
  if (!normalized) return null;

  const matched = normalized.match(NATURE_LISTING_RANK_RE);
  if (!matched) return null;

  const rank = Number.parseInt(matched[1] ?? '', 10);
  return Number.isFinite(rank) ? rank : null;
}

function parseNatureListingTrackLabelValue(value: unknown) {
  const normalized = cleanText(value);
  if (!normalized) return null;

  const matched = normalized.match(NATURE_LISTING_TRACK_LABEL_RE);
  if (!matched) return null;

  const rank = Number.parseInt(matched[1] ?? '', 10);
  return Number.isFinite(rank) ? rank : null;
}

function parseNatureListingPageNumber(value: unknown, fallback = 1) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function extractNatureListingTrackAction({
  $,
  root,
  linkNode,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
  linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidates = [
    $(linkNode).attr('data-track-action'),
    $(linkNode).closest('[data-track-action]').first().attr('data-track-action'),
    $(root).attr('data-track-action'),
    $(root).find('[data-track-action]').first().attr('data-track-action'),
  ];

  for (const value of candidates) {
    const normalized = cleanText(value);
    if (normalized) return normalized;
  }

  return null;
}

function extractNatureListingTrackLabel({
  $,
  root,
  linkNode,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
  linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidates = [
    $(linkNode).attr('data-track-label'),
    $(linkNode).closest('[data-track-label]').first().attr('data-track-label'),
    $(root).attr('data-track-label'),
    $(root).find('[data-track-label]').first().attr('data-track-label'),
  ];

  for (const value of candidates) {
    const normalized = cleanText(value);
    if (normalized) return normalized;
  }

  return null;
}

function extractNatureListingRank({
  $,
  root,
  linkNode,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
  linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidateNodes = [
    $(linkNode),
    $(root).find('[data-track-action]').first(),
    $(root),
  ];

  for (const candidateNode of candidateNodes) {
    const parsed = parseNatureListingRankValue(candidateNode.attr('data-track-action'));
    if (parsed !== null) return parsed;
  }

  const descendants = $(root).find('[data-track-action]').toArray();
  for (const node of descendants) {
    const parsed = parseNatureListingRankValue($(node).attr('data-track-action'));
    if (parsed !== null) return parsed;
  }

  return null;
}

function extractNatureListingCardOrder({
  $,
  root,
  linkNode,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  root: Parameters<ListingCandidateExtractorContext['$']>[0];
  linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidateNodes = [
    $(linkNode),
    $(root).find('[data-track-label]').first(),
    $(root),
  ];

  for (const candidateNode of candidateNodes) {
    const parsed = parseNatureListingTrackLabelValue(candidateNode.attr('data-track-label'));
    if (parsed !== null) return parsed;
  }

  const descendants = $(root).find('[data-track-label]').toArray();
  for (const node of descendants) {
    const parsed = parseNatureListingTrackLabelValue($(node).attr('data-track-label'));
    if (parsed !== null) return parsed;
  }

  return null;
}

function computeNatureListingCandidateOrder({
  discoveryOrder,
  rank,
  cardOrder,
}: {
  discoveryOrder: number;
  rank: number | null;
  cardOrder: number | null;
}) {
  if (cardOrder !== null && cardOrder >= 0) {
    return cardOrder;
  }

  if (rank !== null && rank > 0) {
    return rank - 1;
  }

  return discoveryOrder;
}

function resolveNatureListingCandidateRoot({
  $,
  layoutRoot,
  linkNode,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  layoutRoot: Parameters<ListingCandidateExtractorContext['$']>[0];
  linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const layoutRootNode = $(layoutRoot).get(0);
  if (!layoutRootNode) return null;

  let current = $(linkNode).parent();
  let bestRoot: Parameters<ListingCandidateExtractorContext['$']>[0] | null = null;

  while (current.length > 0) {
    const currentNode = current.get(0);
    if (!currentNode) break;

    const title = extractNatureListingTitle({ $, root: currentNode });
    const linkCount = countArticleLinksWithin({ $, root: currentNode });
    if (linkCount === 1 && title) {
      bestRoot = currentNode;
    }

    if (currentNode === layoutRootNode) {
      break;
    }

    current = current.parent();
  }

  return bestRoot;
}

function resolveNatureListingFallbackRoot({
  $,
  linkNode,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
}) {
  const candidateRoot = $(linkNode)
    .closest('li, article, div.c-article-item__wrapper, div.c-article-item__container')
    .first();
  if (candidateRoot.length > 0) {
    return candidateRoot.get(0) ?? linkNode;
  }

  return $(linkNode).parent().get(0) ?? linkNode;
}

function collectNatureListingCandidateRoots({
  $,
}: Pick<ListingCandidateExtractorContext, '$'>) {
  const candidatesBySelector = NATURE_LISTING_LAYOUT_SELECTORS.map((selector) => {
    const matchedRoots = $(selector).toArray();
    return {
      selector,
      matchedRoots,
      articleLinkCount: matchedRoots.reduce((count, rootNode) => {
        return count + $(rootNode).find(NATURE_LISTING_LINK_SELECTOR).length;
      }, 0),
    };
  });

  const selected = candidatesBySelector
    .filter((item) => item.articleLinkCount > 0)
    .sort((a, b) => b.articleLinkCount - a.articleLinkCount)[0];

  const sectionNodes = $('section').toArray();

  if (!selected || selected.matchedRoots.length === 0) {
    const trackedLinkNodes = $(NATURE_LISTING_TRACKED_LINK_SELECTOR)
      .toArray()
      .filter((linkNode) => parseNatureListingTrackLabelValue($(linkNode).attr('data-track-label')) !== null);
    const candidateLinkNodes = trackedLinkNodes.length > 0 ? trackedLinkNodes : $(NATURE_LISTING_LINK_SELECTOR).toArray();
    const fallbackRoots = candidateLinkNodes.map((linkNode, discoveryOrder) => {
        const root = resolveNatureListingFallbackRoot({ $, linkNode });
        const sectionNode = $(root).closest('section').first().get(0) ?? null;
        const sectionIndex = sectionNode ? sectionNodes.findIndex((candidate) => candidate === sectionNode) : -1;
        return {
          root,
          linkNode,
          layoutSelector: 'document-link-order',
          sectionIndex,
          discoveryOrder,
        };
      });

    if (fallbackRoots.length === 0) {
      return null;
    }

    return {
      layoutSelector: 'document-link-order',
      layoutRootNodes: [],
      roots: fallbackRoots,
      candidateSelectors: candidatesBySelector.map((item) => ({
        selector: item.selector,
        matchedRootCount: item.matchedRoots.length,
        articleLinkCount: item.articleLinkCount,
      })),
    };
  }

  const roots = selected.matchedRoots
    .flatMap((layoutRootNode, layoutRootOrder) =>
      (
        (() => {
          const trackedLinks = $(layoutRootNode)
            .find(NATURE_LISTING_TRACKED_LINK_SELECTOR)
            .toArray()
            .filter((linkNode) => parseNatureListingTrackLabelValue($(linkNode).attr('data-track-label')) !== null);
          return trackedLinks.length > 0 ? trackedLinks : $(layoutRootNode).find(NATURE_LISTING_LINK_SELECTOR).toArray();
        })()
      )
        .map((linkNode, linkOrderInLayout) => {
          const root = resolveNatureListingCandidateRoot({ $, layoutRoot: layoutRootNode, linkNode });
          if (!root) return null;
          const sectionNode = $(root).closest('section').first().get(0) ?? null;
          const sectionIndex = sectionNode ? sectionNodes.findIndex((candidate) => candidate === sectionNode) : -1;
          return {
            root,
            linkNode,
            layoutSelector: selected.selector,
            sectionIndex,
            discoveryOrder: layoutRootOrder * 1000 + linkOrderInLayout,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    );

  return {
    layoutSelector: selected.selector,
    layoutRootNodes: selected.matchedRoots,
    roots,
    candidateSelectors: candidatesBySelector.map((item) => ({
      selector: item.selector,
      matchedRootCount: item.matchedRoots.length,
      articleLinkCount: item.articleLinkCount,
    })),
  };
}

function buildNatureListingDiagnostics({
  $,
  layoutSelector,
  layoutRootNodes,
  selectorCandidates,
  roots,
}: Pick<ListingCandidateExtractorContext, '$'> & {
  layoutSelector: string;
  layoutRootNodes: Array<Parameters<ListingCandidateExtractorContext['$']>[0]>;
  selectorCandidates: Array<{ selector: string; matchedRootCount: number; articleLinkCount: number }>;
  roots: Array<{
    root: Parameters<ListingCandidateExtractorContext['$']>[0];
    linkNode: Parameters<ListingCandidateExtractorContext['$']>[0];
    layoutSelector: string;
    sectionIndex: number;
    discoveryOrder: number;
  }>;
}) {
  const tagCounts = roots.reduce<Record<string, number>>((accumulator, item) => {
    const tagName = cleanText($(item.root).prop('tagName')).toLowerCase() || 'unknown';
    accumulator[tagName] = (accumulator[tagName] ?? 0) + 1;
    return accumulator;
  }, {});
  const ranks = roots
    .map((item) => extractNatureListingRank({ $, root: item.root, linkNode: item.linkNode }))
    .filter((rank): rank is number => rank !== null);
  const trackActionCounts = roots.reduce<Record<string, number>>((accumulator, item) => {
    const trackAction = extractNatureListingTrackAction({ $, root: item.root, linkNode: item.linkNode }) ?? 'none';
    accumulator[trackAction] = (accumulator[trackAction] ?? 0) + 1;
    return accumulator;
  }, {});
  const trackLabelCounts = roots.reduce<Record<string, number>>((accumulator, item) => {
    const trackLabel = extractNatureListingTrackLabel({ $, root: item.root, linkNode: item.linkNode }) ?? 'none';
    accumulator[trackLabel] = (accumulator[trackLabel] ?? 0) + 1;
    return accumulator;
  }, {});
  const sectionIndexSet = new Set(roots.map((item) => item.sectionIndex).filter((index) => index >= 0));
  const cardOrders = roots
    .map((item) => extractNatureListingCardOrder({ $, root: item.root, linkNode: item.linkNode }))
    .filter((order): order is number => order !== null);

  return {
    selectedLayoutSelector: layoutSelector,
    selectedLayoutRootCount: layoutRootNodes.length,
    selectorCandidates,
    articleLinkCount: layoutRootNodes.reduce((count, node) => {
      return count + $(node).find(NATURE_LISTING_LINK_SELECTOR).length;
    }, 0),
    resolvedRootCount: roots.length,
    rootTagCounts: tagCounts,
    trackActionCounts,
    trackLabelCounts,
    sectionCount: sectionIndexSet.size,
    rankedRootCount: ranks.length,
    rankMin: ranks.length > 0 ? Math.min(...ranks) : null,
    rankMax: ranks.length > 0 ? Math.max(...ranks) : null,
    cardOrderCount: cardOrders.length,
    cardOrderMin: cardOrders.length > 0 ? Math.min(...cardOrders) : null,
    cardOrderMax: cardOrders.length > 0 ? Math.max(...cardOrders) : null,
  };
}

export function createNatureListingCandidateExtractor({
  id,
  matches,
  findNextPageUrl,
  refineExtraction,
  evaluatePaginationStop = evaluateNatureListingPaginationStop,
}: {
  id: string;
  matches: (page: URL) => boolean;
  findNextPageUrl?: ListingCandidateExtractor['findNextPageUrl'];
  refineExtraction?: (
    context: ListingCandidateRefinementContext,
  ) => Promise<ListingCandidateExtraction | null> | ListingCandidateExtraction | null;
  evaluatePaginationStop?: (
    context: ListingPaginationStopContext,
  ) => ListingPaginationStopEvaluation | null;
}) {
  return {
    id,
    matches,
    findNextPageUrl,
    refineExtraction,
    evaluatePaginationStop,
    extract(context): ListingCandidateExtraction | null {
      const { $, pageUrl } = context;
      const resolvedRoots = collectNatureListingCandidateRoots({ $ });
      if (!resolvedRoots || resolvedRoots.roots.length === 0) {
        return null;
      }

      const seen = new Set<string>();
      const candidates = resolvedRoots.roots
        .map(({ root, linkNode, discoveryOrder }) => {
          const href = extractNatureListingHref({ $, root });
          const title = extractNatureListingTitle({ $, root });
          if (!href || !title) return null;

          let normalized = '';
          try {
            normalized = new URL(href, pageUrl).toString();
          } catch {
            return null;
          }

          if (seen.has(normalized)) return null;
          seen.add(normalized);

          const rank = extractNatureListingRank({ $, root, linkNode });
          const cardOrder = extractNatureListingCardOrder({ $, root, linkNode });
          const dateHint = extractNatureListingDateHint({ $, root });
          return normalizeListingCandidateSeed({
            href,
            order: computeNatureListingCandidateOrder({
              discoveryOrder,
              rank,
              cardOrder,
            }),
            dateHint,
            title,
            publishedAt: dateHint,
            scoreBoost: 100,
          });
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

      return {
        candidates,
        diagnostics: buildNatureListingDiagnostics({
          $,
          layoutSelector: resolvedRoots.layoutSelector,
          layoutRootNodes: resolvedRoots.layoutRootNodes,
          selectorCandidates: resolvedRoots.candidateSelectors,
          roots: resolvedRoots.roots,
        }),
      };
    },
  } satisfies ListingCandidateExtractor;
}

export function isNatureListingPage(page: URL, pathname: string) {
  return isNatureMainSiteUrl(page.toString()) && page.pathname.replace(/\/+$/, '') === pathname;
}

export function findNatureListingNextPageUrl({
  page,
  pageUrl,
  $,
  seenPageUrls,
}: ListingPaginationContext) {
  if (!isNatureMainSiteUrl(page.toString())) return null;

  const currentPathname = page.pathname.replace(/\/+$/, '');
  const currentPageNumber = parseNatureListingPageNumber(page.searchParams.get('page'), 1);
  const nextPageNumber = currentPageNumber + 1;
  let fallbackMatch: string | null = null;

  const linkNodes = $(NATURE_LISTING_PAGINATION_LINK_SELECTOR).toArray();
  for (const node of linkNodes) {
    const href = cleanText($(node).attr('href'));
    if (!href) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }

    const normalizedPathname = resolved.pathname.replace(/\/+$/, '');
    if (resolved.host !== page.host || normalizedPathname !== currentPathname) {
      continue;
    }

    const pageNumber = parseNatureListingPageNumber(resolved.searchParams.get('page'), 0);
    if (pageNumber !== nextPageNumber) continue;

    resolved.hash = '';
    const normalized = resolved.toString();
    if (seenPageUrls?.has(normalized)) continue;

    const linkText = cleanText($(node).text()).toLowerCase();
    const ariaLabel = cleanText($(node).attr('aria-label')).toLowerCase();
    const rel = cleanText($(node).attr('rel')).toLowerCase();
    if (linkText.includes('next') || ariaLabel.includes('next') || rel.includes('next')) {
      return normalized;
    }

    fallbackMatch = fallbackMatch ?? normalized;
  }

  return fallbackMatch;
}
