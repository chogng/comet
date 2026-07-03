import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import { normalizeListingCandidateSeed } from 'ls/code/electron-main/fetch/sourceExtractors/types';
import type { ListingCandidateExtraction, ListingCandidateSeed } from 'ls/code/electron-main/fetch/sourceExtractors/types';

import type {
  WebContentBounds,
  WebContentBridgeMethod,
  WebContentBridgeResponse,
  WebContentLayoutPhase,
  WebContentNavigationMode,
  WebContentSelectionSnapshot,
  WebContentState,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'ls/base/common/errors';

const DEFAULT_WEB_CONTENT_TARGET_ID = '__shared__';
const WEB_CONTENT_BRIDGE_KEY = '__lsWebContentBridge';
const WEB_CONTENT_BRIDGE_UNAVAILABLE_MESSAGE = 'Desktop web content bridge is unavailable.';
const WEB_CONTENT_BRIDGE_REQUEST_TIMEOUT_MS = 15000;

type WebContentTargetState = Pick<
  WebContentState,
  | 'url'
  | 'pageTitle'
  | 'faviconUrl'
  | 'canGoBack'
  | 'canGoForward'
  | 'isLoading'
>;

type PendingRendererBridgeRequest = {
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type RendererBridgeReadyWaiter = {
  reject: (error: unknown) => void;
  resolve: () => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let webContentWindow: BrowserWindow | null = null;
let activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
let lastReportedWebContentState: WebContentState = createDefaultWebContentState();
let rendererBridgeReady = false;
let rendererBridgeRequestIdPool = 0;
let disposeWebContentWindowListeners: (() => void) | null = null;
const pendingRendererBridgeRequests = new Map<string, PendingRendererBridgeRequest>();
const rendererBridgeReadyWaiters = new Set<RendererBridgeReadyWaiter>();

function createDefaultWebContentTargetState(): WebContentTargetState {
  return {
    url: '',
    pageTitle: '',
    faviconUrl: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  };
}

function normalizeWebContentTargetId(targetId?: string | null) {
  const normalized = String(targetId ?? '').trim();
  return normalized || DEFAULT_WEB_CONTENT_TARGET_ID;
}

function createDefaultWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  return {
    ...createDefaultWebContentTargetState(),
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      activeWebContentTargetId === DEFAULT_WEB_CONTENT_TARGET_ID
        ? null
        : activeWebContentTargetId,
    ownership:
      normalizedTargetId === activeWebContentTargetId ? 'active' : 'inactive',
    layoutPhase: normalizedTargetId === activeWebContentTargetId ? 'hidden' : 'hidden',
    visible: false,
  };
}

function rememberReportedWebContentState(state: WebContentState) {
  lastReportedWebContentState = state;
  activeWebContentTargetId = normalizeWebContentTargetId(state.activeTargetId);
}

function getActiveWebContentTargetId() {
  return activeWebContentTargetId;
}

export type WebContentDocumentSnapshot = {
  url: string;
  html: string;
  captureMs: number;
  isLoading: boolean;
};

export type WebContentListingCandidateSnapshot = {
  webContentUrl: string;
  extractorId: string;
  extraction: ListingCandidateExtraction;
  nextPageUrl: string | null;
  captureMs: number;
  isLoading: boolean;
};

type WebContentDocumentSnapshotOptions = {
  timeoutMs?: number;
};

type WebContentListingCandidateSnapshotOptions = WebContentDocumentSnapshotOptions & {
  preferredExtractorId?: string | null;
};

const webContentDocumentSnapshotTimedOut = Symbol('webContentDocumentSnapshotTimedOut');
const PREVIEW_LISTING_CANDIDATE_EXTRACTION_SCRIPT = String.raw`((preferredExtractorId) => {
  const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizePathname = (value) => {
    const normalized = String(value ?? '').replace(/\/+$/, '');
    return normalized || '/';
  };
  const parseInteger = (value) => {
    const parsed = Number.parseInt(cleanText(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const monthNameToIndex = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };
  const normalizeMonthName = (value) => String(value ?? '').toLowerCase().replace(/\.+$/, '');
  const toUtcIsoDate = (year, month, day) => {
    const date = new Date(Date.UTC(year, month, day));
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date.toISOString().slice(0, 10);
  };
  const parseDateString = (value) => {
    const source = cleanText(value);
    if (!source) return null;
    const isoDateMatch = source.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (isoDateMatch) {
      const year = Number.parseInt(isoDateMatch[1], 10);
      const month = Number.parseInt(isoDateMatch[2], 10);
      const day = Number.parseInt(isoDateMatch[3], 10);
      return toUtcIsoDate(year, month - 1, day);
    }
    const dayMonthNameMatch = source.match(/\b(\d{1,2})\s+([A-Za-z.]+)\s+(\d{4})\b/);
    if (dayMonthNameMatch) {
      const day = Number.parseInt(dayMonthNameMatch[1], 10);
      const month = monthNameToIndex[normalizeMonthName(dayMonthNameMatch[2])];
      const year = Number.parseInt(dayMonthNameMatch[3], 10);
      if (month !== undefined) {
        return toUtcIsoDate(year, month, day);
      }
    }
    const monthNameDayMatch = source.match(/\b([A-Za-z.]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (monthNameDayMatch) {
      const month = monthNameToIndex[normalizeMonthName(monthNameDayMatch[1])];
      const day = Number.parseInt(monthNameDayMatch[2], 10);
      const year = Number.parseInt(monthNameDayMatch[3], 10);
      if (month !== undefined) {
        return toUtcIsoDate(year, month, day);
      }
    }
    const parsed = new Date(source);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return null;
  };
  const parseDateHintFromText = (value) => {
    const normalized = cleanText(value);
    if (!normalized) return null;
    const direct = parseDateString(normalized);
    if (direct) return direct;
    const patterns = [
      /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/i,
      /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b/i,
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i,
    ];
    for (const pattern of patterns) {
      const matched = normalized.match(pattern);
      if (!matched) continue;
      const parsed = parseDateString(matched[0]);
      if (parsed) return parsed;
    }
    return null;
  };
  const resolveUrl = (href) => {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return '';
    }
  };
  const parseTrackLabel = (value) => {
    const matched = cleanText(value).match(/^article card\s+(\d+)$/i);
    return matched ? parseInteger(matched[1]) : null;
  };
  const parseRankValue = (value) => {
    const matched = cleanText(value).match(/Rank:\((\d+)\)/i);
    return matched ? parseInteger(matched[1]) : null;
  };
  const parsePageNumber = (value, fallback = 1) => {
    const parsed = parseInteger(value);
    return parsed && parsed > 0 ? parsed : fallback;
  };
  const buildNatureListingNextPageUrl = () => {
    const currentUrl = new URL(location.href);
    const currentPathname = normalizePathname(currentUrl.pathname);
    const currentPageNumber = parsePageNumber(currentUrl.searchParams.get('page'), 1);
    const nextPageNumber = currentPageNumber + 1;
    let fallbackMatch = null;
    for (const node of Array.from(document.querySelectorAll('nav a[href], a[href]'))) {
      const href = cleanText(node.getAttribute('href'));
      if (!href) continue;
      let resolved = null;
      try {
        resolved = new URL(href, location.href);
      } catch {
        resolved = null;
      }
      if (!resolved) continue;
      if (resolved.host !== currentUrl.host || normalizePathname(resolved.pathname) !== currentPathname) {
        continue;
      }
      const pageNumber = parsePageNumber(resolved.searchParams.get('page'), 0);
      if (pageNumber !== nextPageNumber) continue;
      resolved.hash = '';
      const normalized = resolved.toString();
      const linkText = cleanText(node.textContent).toLowerCase();
      const ariaLabel = cleanText(node.getAttribute('aria-label')).toLowerCase();
      const rel = cleanText(node.getAttribute('rel')).toLowerCase();
      if (linkText.includes('next') || ariaLabel.includes('next') || rel.includes('next')) {
        return normalized;
      }
      fallbackMatch = fallbackMatch || normalized;
    }
    return fallbackMatch;
  };
  const extractLatestNewsDateHint = (root) => {
    const footerRoot = root.querySelector('div.c-article-item__footer');
    const fallbackRoot = footerRoot || root;
    for (const node of Array.from(fallbackRoot.querySelectorAll('span.c-article-item__date, time[datetime], [datetime], span, div'))) {
      for (const value of [
        node.getAttribute('datetime'),
        node.getAttribute('content'),
        node.getAttribute('aria-label'),
        node.getAttribute('title'),
        node.textContent,
      ]) {
        const parsed = parseDateHintFromText(value);
        if (parsed) return parsed;
      }
    }
    for (const value of [
      fallbackRoot.getAttribute('datetime'),
      fallbackRoot.getAttribute('content'),
      fallbackRoot.getAttribute('aria-label'),
      fallbackRoot.getAttribute('title'),
      fallbackRoot.textContent,
    ]) {
      const parsed = parseDateHintFromText(value);
      if (parsed) return parsed;
    }
    return null;
  };
  const extractLatestNewsCardOrder = (root) => {
    const link = root.querySelector('a[href*="/articles/"][data-track-label^="article card "]');
    const candidates = [
      link?.getAttribute('data-track-label'),
      link?.closest('[data-track-label]')?.getAttribute('data-track-label'),
      root.getAttribute('data-track-label'),
    ];
    for (const value of candidates) {
      const parsed = parseTrackLabel(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const collectLatestNewsExtraction = () => {
    const roots = Array.from(document.querySelectorAll('div.c-article-item__wrapper'));
    if (roots.length === 0) return null;
    let describedCardCount = 0;
    let footerCardCount = 0;
    let typedCardCount = 0;
    const articleTypeCounts = {};
    const sampleCards = [];
    const seen = new Set();
    const candidates = roots.map((root, index) => {
      const link = root.querySelector('a[href*="/articles/"][data-track-label^="article card "]');
      const href = cleanText(link?.getAttribute('href'));
      const title = cleanText(root.querySelector('h3.c-article-item__title')?.textContent);
      if (!href || !title) return null;
      const normalized = resolveUrl(href);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      const description = cleanText(root.querySelector('div.c-article-item__standfirst')?.textContent);
      const footerText = cleanText(root.querySelector('div.c-article-item__footer')?.textContent);
      const articleType = cleanText(root.querySelector('span.c-article-item__article-type')?.textContent);
      if (description) describedCardCount += 1;
      if (footerText) footerCardCount += 1;
      if (articleType) {
        typedCardCount += 1;
        articleTypeCounts[articleType] = (articleTypeCounts[articleType] || 0) + 1;
      }
      const order = extractLatestNewsCardOrder(root) ?? index;
      const dateHint = extractLatestNewsDateHint(root);
      if (sampleCards.length < 5) {
        sampleCards.push({
          href: normalized,
          title,
          order,
          articleType: articleType || null,
          footerText: footerText || null,
          dateHint,
        });
      }
      return {
        href,
        order,
        dateHint,
        articleType: articleType || null,
        title,
        descriptionText: description || null,
        publishedAt: dateHint,
        scoreBoost: 140,
      };
    }).filter(Boolean);
    if (candidates.length === 0) return null;
    return {
      webContentUrl: location.href,
      extractorId: 'nature-latest-news',
      extraction: {
        candidates,
        diagnostics: {
          layoutSelector: 'div.c-article-item__wrapper',
          linkSelector: 'a[href*="/articles/"][data-track-label^="article card "]',
          titleSelector: 'h3.c-article-item__title',
          descriptionSelector: 'div.c-article-item__standfirst',
          footerSelector: 'div.c-article-item__footer',
          articleTypeSelector: 'span.c-article-item__article-type',
          cardCount: roots.length,
          candidateCount: candidates.length,
          describedCardCount,
          footerCardCount,
          typedCardCount,
          datedCandidateCount: candidates.filter((candidate) => Boolean(candidate.dateHint)).length,
          articleTypeCounts,
          sampleCards,
        },
      },
      nextPageUrl: buildNatureListingNextPageUrl(),
    };
  };
  const collectOpinionExtraction = () => {
    const targeted = collectLatestNewsExtraction();
    if (targeted) {
      return {
        ...targeted,
        extractorId: 'nature-opinion',
      };
    }

    return collectNatureListingExtraction('nature-opinion');
  };
  const natureListingLayoutSelectors = [
    'section.section__top-new > div.u-container',
    'div.u-container.c-component',
    'section[class*="section__top"] div.u-container',
    'section div.u-container',
  ];
  const natureListingLinkSelector = 'a[href*="/articles/"]';
  const natureListingTrackedLinkSelector = 'a[data-track-label]';
  const natureListingDateSelector = 'time[datetime], [datetime], [itemprop="datePublished"], span, div';
  const extractNatureListingTitle = (root) => cleanText(root.querySelector('h3')?.textContent);
  const countNatureListingLinksWithin = (root) => root.querySelectorAll(natureListingLinkSelector).length;
  const extractNatureListingDateHint = (root) => {
    for (const node of Array.from(root.querySelectorAll(natureListingDateSelector))) {
      for (const value of [
        node.getAttribute('datetime'),
        node.getAttribute('content'),
        node.getAttribute('aria-label'),
        node.getAttribute('title'),
        node.textContent,
      ]) {
        const parsed = parseDateHintFromText(value);
        if (parsed) return parsed;
      }
    }
    return parseDateHintFromText(root.textContent);
  };
  const extractNatureListingHref = (root) => cleanText(root.querySelector(natureListingLinkSelector)?.getAttribute('href'));
  const extractNatureListingRank = (root, linkNode) => {
    const candidateNodes = [
      linkNode,
      root.querySelector('[data-track-action]'),
      root,
    ].filter(Boolean);
    for (const node of candidateNodes) {
      const parsed = parseRankValue(node.getAttribute('data-track-action'));
      if (parsed !== null) return parsed;
    }
    for (const node of Array.from(root.querySelectorAll('[data-track-action]'))) {
      const parsed = parseRankValue(node.getAttribute('data-track-action'));
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const extractNatureListingCardOrder = (root, linkNode) => {
    const candidateNodes = [
      linkNode,
      root.querySelector('[data-track-label]'),
      root,
    ].filter(Boolean);
    for (const node of candidateNodes) {
      const parsed = parseTrackLabel(node.getAttribute('data-track-label'));
      if (parsed !== null) return parsed;
    }
    for (const node of Array.from(root.querySelectorAll('[data-track-label]'))) {
      const parsed = parseTrackLabel(node.getAttribute('data-track-label'));
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const computeNatureListingCandidateOrder = ({ discoveryOrder, rank, cardOrder }) => {
    if (cardOrder !== null && cardOrder >= 0) return cardOrder;
    if (rank !== null && rank > 0) return rank - 1;
    return discoveryOrder;
  };
  const resolveNatureListingCandidateRoot = (layoutRoot, linkNode) => {
    let current = linkNode.parentElement;
    let bestRoot = null;
    while (current) {
      const title = extractNatureListingTitle(current);
      const linkCount = countNatureListingLinksWithin(current);
      if (linkCount === 1 && title) {
        bestRoot = current;
      }
      if (current === layoutRoot) {
        break;
      }
      current = current.parentElement;
    }
    return bestRoot;
  };
  const resolveNatureListingFallbackRoot = (linkNode) =>
    linkNode.closest('li, article, div.c-article-item__wrapper, div.c-article-item__container') ||
    linkNode.parentElement ||
    linkNode;
  const collectNatureListingRoots = () => {
    const candidateSelectors = natureListingLayoutSelectors.map((selector) => {
      const matchedRoots = Array.from(document.querySelectorAll(selector));
      return {
        selector,
        matchedRoots,
        articleLinkCount: matchedRoots.reduce((count, root) => count + root.querySelectorAll(natureListingLinkSelector).length, 0),
      };
    });
    const selected = candidateSelectors
      .filter((item) => item.articleLinkCount > 0)
      .sort((a, b) => b.articleLinkCount - a.articleLinkCount)[0];
    const sectionNodes = Array.from(document.querySelectorAll('section'));
    if (!selected || selected.matchedRoots.length === 0) {
      const trackedLinkNodes = Array.from(document.querySelectorAll(natureListingTrackedLinkSelector))
        .filter((linkNode) => parseTrackLabel(linkNode.getAttribute('data-track-label')) !== null);
      const candidateLinkNodes = trackedLinkNodes.length > 0 ? trackedLinkNodes : Array.from(document.querySelectorAll(natureListingLinkSelector));
      const roots = candidateLinkNodes.map((linkNode, discoveryOrder) => {
        const root = resolveNatureListingFallbackRoot(linkNode);
        const sectionNode = root.closest('section');
        return {
          root,
          linkNode,
          discoveryOrder,
          sectionIndex: sectionNode ? sectionNodes.indexOf(sectionNode) : -1,
        };
      });
      if (roots.length === 0) return null;
      return {
        layoutSelector: 'document-link-order',
        layoutRootNodes: [],
        candidateSelectors: candidateSelectors.map((item) => ({
          selector: item.selector,
          matchedRootCount: item.matchedRoots.length,
          articleLinkCount: item.articleLinkCount,
        })),
        roots,
      };
    }
    const roots = selected.matchedRoots.flatMap((layoutRootNode, layoutRootOrder) => {
      const trackedLinks = Array.from(layoutRootNode.querySelectorAll(natureListingTrackedLinkSelector))
        .filter((linkNode) => parseTrackLabel(linkNode.getAttribute('data-track-label')) !== null);
      const candidateLinkNodes = trackedLinks.length > 0 ? trackedLinks : Array.from(layoutRootNode.querySelectorAll(natureListingLinkSelector));
      return candidateLinkNodes.map((linkNode, linkOrderInLayout) => {
        const root = resolveNatureListingCandidateRoot(layoutRootNode, linkNode);
        if (!root) return null;
        const sectionNode = root.closest('section');
        return {
          root,
          linkNode,
          discoveryOrder: layoutRootOrder * 1000 + linkOrderInLayout,
          sectionIndex: sectionNode ? sectionNodes.indexOf(sectionNode) : -1,
        };
      }).filter(Boolean);
    });
    return {
      layoutSelector: selected.selector,
      layoutRootNodes: selected.matchedRoots,
      candidateSelectors: candidateSelectors.map((item) => ({
        selector: item.selector,
        matchedRootCount: item.matchedRoots.length,
        articleLinkCount: item.articleLinkCount,
      })),
      roots,
    };
  };
  const buildNatureListingDiagnostics = ({ layoutSelector, layoutRootNodes, candidateSelectors, roots }) => {
    const rootTagCounts = {};
    const trackActionCounts = {};
    const trackLabelCounts = {};
    const rankValues = [];
    const cardOrderValues = [];
    const sectionIndexSet = new Set();
    for (const item of roots) {
      const tagName = cleanText(item.root.tagName).toLowerCase() || 'unknown';
      rootTagCounts[tagName] = (rootTagCounts[tagName] || 0) + 1;
      const trackAction =
        cleanText(item.linkNode.getAttribute('data-track-action')) ||
        cleanText(item.root.querySelector('[data-track-action]')?.getAttribute('data-track-action')) ||
        cleanText(item.root.getAttribute('data-track-action')) ||
        'none';
      trackActionCounts[trackAction] = (trackActionCounts[trackAction] || 0) + 1;
      const trackLabel =
        cleanText(item.linkNode.getAttribute('data-track-label')) ||
        cleanText(item.root.querySelector('[data-track-label]')?.getAttribute('data-track-label')) ||
        cleanText(item.root.getAttribute('data-track-label')) ||
        'none';
      trackLabelCounts[trackLabel] = (trackLabelCounts[trackLabel] || 0) + 1;
      const rank = extractNatureListingRank(item.root, item.linkNode);
      if (rank !== null) rankValues.push(rank);
      const cardOrder = extractNatureListingCardOrder(item.root, item.linkNode);
      if (cardOrder !== null) cardOrderValues.push(cardOrder);
      if (item.sectionIndex >= 0) {
        sectionIndexSet.add(item.sectionIndex);
      }
    }
    return {
      selectedLayoutSelector: layoutSelector,
      selectedLayoutRootCount: layoutRootNodes.length,
      selectorCandidates: candidateSelectors,
      articleLinkCount: layoutRootNodes.reduce((count, node) => count + node.querySelectorAll(natureListingLinkSelector).length, 0),
      resolvedRootCount: roots.length,
      rootTagCounts,
      trackActionCounts,
      trackLabelCounts,
      sectionCount: sectionIndexSet.size,
      rankedRootCount: rankValues.length,
      rankMin: rankValues.length > 0 ? Math.min(...rankValues) : null,
      rankMax: rankValues.length > 0 ? Math.max(...rankValues) : null,
      cardOrderCount: cardOrderValues.length,
      cardOrderMin: cardOrderValues.length > 0 ? Math.min(...cardOrderValues) : null,
      cardOrderMax: cardOrderValues.length > 0 ? Math.max(...cardOrderValues) : null,
    };
  };
  const collectNatureListingExtraction = (extractorId) => {
    const resolvedRoots = collectNatureListingRoots();
    if (!resolvedRoots || resolvedRoots.roots.length === 0) return null;
    const seen = new Set();
    const candidates = resolvedRoots.roots.map((item) => {
      const href = extractNatureListingHref(item.root);
      const title = extractNatureListingTitle(item.root);
      if (!href || !title) return null;
      const normalized = resolveUrl(href);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      const rank = extractNatureListingRank(item.root, item.linkNode);
      const cardOrder = extractNatureListingCardOrder(item.root, item.linkNode);
      return {
        href,
        order: computeNatureListingCandidateOrder({
          discoveryOrder: item.discoveryOrder,
          rank,
          cardOrder,
        }),
        dateHint: extractNatureListingDateHint(item.root),
        title,
        publishedAt: extractNatureListingDateHint(item.root),
        scoreBoost: 100,
      };
    }).filter(Boolean);
    if (candidates.length === 0) return null;
    return {
      webContentUrl: location.href,
      extractorId,
      extraction: {
        candidates,
        diagnostics: buildNatureListingDiagnostics(resolvedRoots),
      },
      nextPageUrl: buildNatureListingNextPageUrl(),
    };
  };
  const collectNatureResearchArticlesExtraction = (extractorId = 'nature-research-articles') => {
    const cardSelectors = [
      'section#new-article-list li.app-article-list-row__item article.c-card',
      'section#new-article-list article.c-card',
      'main li.app-article-list-row__item article',
      'main li article',
    ];
    const linkSelector =
      'h3.c-card__title a[href*="/articles/"], h3 a[href*="/articles/"], a.c-card__link[href*="/articles/"], a[href*="/articles/"]';
    const titleSelector = 'h3.c-card__title, h3';
    const articleTypeSelector =
      'div.c-card__section.c-meta [data-test="article.type"] .c-meta__type, div.c-card__section.c-meta [data-test="article.type"], [data-test="article.type"] .c-meta__type';
    const dateSelector =
      'time[datetime], .c-meta time[datetime], [itemprop="datePublished"], [datetime], span, div';
    const selected = (() => {
      for (const selector of cardSelectors) {
        const roots = Array.from(document.querySelectorAll(selector));
        if (roots.length === 0) continue;
        let matchedCount = 0;
        for (const root of roots) {
          const link = root.querySelector(linkSelector);
          const href = cleanText(link?.getAttribute('href'));
          const title = cleanText(root.querySelector(titleSelector)?.textContent) || cleanText(link?.textContent);
          if (href && title) {
            matchedCount += 1;
          }
        }
        if (matchedCount > 0) {
          return {
            selector,
            roots,
            matchedCount,
          };
        }
      }
      return null;
    })();
    if (!selected || selected.roots.length === 0) return null;

    let typedCandidateCount = 0;
    const articleTypeCounts = {};
    const seen = new Set();
    const candidates = selected.roots.map((root, index) => {
      const link = root.querySelector(linkSelector);
      const href = cleanText(link?.getAttribute('href'));
      const title = cleanText(root.querySelector(titleSelector)?.textContent) || cleanText(link?.textContent);
      if (!href || !title) return null;
      const normalized = resolveUrl(href);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      const articleType = cleanText(root.querySelector(articleTypeSelector)?.textContent) || null;
      if (articleType) {
        typedCandidateCount += 1;
        articleTypeCounts[articleType] = (articleTypeCounts[articleType] || 0) + 1;
      }

      let dateHint = null;
      for (const node of Array.from(root.querySelectorAll(dateSelector))) {
        const values = [
          node.getAttribute('datetime'),
          node.getAttribute('content'),
          node.getAttribute('aria-label'),
          node.getAttribute('title'),
          node.textContent,
        ];
        for (const value of values) {
          const parsed = parseDateString(value) || parseDateHintFromText(value);
          if (parsed) {
            dateHint = parsed;
            break;
          }
        }
        if (dateHint) break;
      }
      if (!dateHint) {
        const fallbackValues = [
          root.getAttribute('datetime'),
          root.getAttribute('content'),
          root.textContent,
        ];
        for (const value of fallbackValues) {
          const parsed = parseDateString(value) || parseDateHintFromText(value);
          if (parsed) {
            dateHint = parsed;
            break;
          }
        }
      }

      const descriptionText = cleanText(
        root.querySelector('div[data-test="article-description"] p, div.c-card__summary p, [itemprop="description"] p')
          ?.textContent,
      );

      return {
        href,
        order: index,
        dateHint,
        articleType,
        title,
        descriptionText: descriptionText || null,
        publishedAt: dateHint,
        scoreBoost: 140,
      };
    }).filter(Boolean);
    if (candidates.length === 0) return null;
    return {
      webContentUrl: location.href,
      extractorId,
      extraction: {
        candidates,
        diagnostics: {
          cardSelector: selected.selector,
          cardSelectorCandidates: cardSelectors,
          cardCount: selected.roots.length,
          cardMatchedCount: selected.matchedCount,
          candidateCount: candidates.length,
          datedCandidateCount: candidates.filter((candidate) => Boolean(candidate.dateHint)).length,
          typedCandidateCount,
          articleTypeCounts,
        },
      },
      nextPageUrl: buildNatureListingNextPageUrl(),
    };
  };
  const scienceTocBodySelectors = [
    'div.toc > div.toc__body > div.toc__body',
    'div.toc__body > div.toc__body',
    'div.toc__body',
  ];
  const scienceSectionSelector = 'section.toc__section';
  const scienceHeadingSelector = 'h4';
  const scienceSubheadingSelector = 'h5';
  const scienceCardSelector = 'div.card';
  const scienceLinkSelector = 'h3.article-title a[href*="/doi/"], h3.article-title a[href], a[href*="/doi/"]';
  const scienceTitleSelector = 'h3.article-title';
  const scienceDateSelector = '.card-meta time, time[datetime], [datetime]';
  const scienceAbstractSelector = '.accordion__content, div.card-body';
  const scienceAuthorsSelector = 'ul[title="list of authors"] li span';
  const scienceDoiPathRe = /\/doi\/(?:abs\/|epdf\/|pdf\/)?(10\.\d{4,9}\/[^?#]+)/i;
  const normalizeScienceHeading = (value) => cleanText(value).toLowerCase();
  const resolveScienceTocBody = () => {
    for (const selector of scienceTocBodySelectors) {
      const roots = Array.from(document.querySelectorAll(selector));
      const matchedRoot = roots.find((root) => root.querySelector(':scope > section.toc__section'));
      if (!matchedRoot) continue;
      return {
        root: matchedRoot,
        selector,
        matchedRootCount: roots.length,
      };
    }
    return null;
  };
  const extractScienceCardDateHint = (card) => {
    for (const node of Array.from(card.querySelectorAll(scienceDateSelector))) {
      const values = [
        node.getAttribute('datetime'),
        node.getAttribute('content'),
        node.getAttribute('aria-label'),
        node.getAttribute('title'),
        node.textContent,
      ];
      for (const value of values) {
        const parsed = parseDateHintFromText(value);
        if (parsed) return parsed;
      }
    }
    return parseDateHintFromText(card.textContent);
  };
  const extractScienceCardAuthors = (card) =>
    Array.from(
      new Set(
        Array.from(card.querySelectorAll(scienceAuthorsSelector))
          .map((node) => cleanText(node.textContent))
          .filter(Boolean),
      ),
    );
  const extractScienceCardDoi = (href) => {
    const matched = cleanText(href).match(scienceDoiPathRe);
    if (!matched?.[1]) return null;
    try {
      return decodeURIComponent(matched[1]);
    } catch {
      return matched[1];
    }
  };
  const collectScienceAdvPhysicalMaterialsExtraction = () => {
    const targetHeading = 'physical and materials sciences';
    const fixedSectionIndex = 3;
    const tocBody = resolveScienceTocBody();
    if (!tocBody) return null;

    const sections = Array.from(tocBody.root.querySelectorAll(':scope > section.toc__section'));
    if (sections.length === 0) return null;

    let sectionIndex = -1;
    let selectedBy = '';
    const fixedSection = sections[fixedSectionIndex];
    const fixedHeading = normalizeScienceHeading(
      fixedSection?.querySelector(scienceHeadingSelector)?.textContent,
    );
    if (fixedSection && (fixedHeading === targetHeading || fixedHeading.includes(targetHeading))) {
      sectionIndex = fixedSectionIndex;
      selectedBy = 'toc-body-fixed-index';
    } else {
      sectionIndex = sections.findIndex((section) => {
        const heading = normalizeScienceHeading(section.querySelector(scienceHeadingSelector)?.textContent);
        return heading === targetHeading || heading.includes(targetHeading);
      });
      selectedBy = 'toc-body-heading-fallback';
    }
    if (sectionIndex < 0) return null;

    const selectedSection = sections[sectionIndex];
    if (!selectedSection) return null;

    const sectionHeading = cleanText(selectedSection.querySelector(scienceHeadingSelector)?.textContent);
    const cards = Array.from(selectedSection.querySelectorAll(scienceCardSelector));
    if (cards.length === 0) return null;

    const seen = new Set();
    let datedCandidateCount = 0;
    let summarizedCandidateCount = 0;
    const candidates = cards
      .map((card, index) => {
        const link = card.querySelector(scienceLinkSelector);
        const href = cleanText(link?.getAttribute('href'));
        const title = cleanText(card.querySelector(scienceTitleSelector)?.textContent) || cleanText(link?.textContent);
        if (!href || !title) return null;

        const normalized = resolveUrl(href);
        if (!normalized || seen.has(normalized)) return null;
        seen.add(normalized);

        const dateHint = extractScienceCardDateHint(card);
        const abstractText = cleanText(card.querySelector(scienceAbstractSelector)?.textContent) || null;
        const authors = extractScienceCardAuthors(card);
        const doi = extractScienceCardDoi(href);
        if (dateHint) datedCandidateCount += 1;
        if (abstractText) summarizedCandidateCount += 1;

        return {
          href,
          order: index,
          dateHint,
          articleType: 'Physical and Materials Sciences',
          title,
          doi,
          authors,
          abstractText,
          publishedAt: dateHint,
          scoreBoost: 180,
        };
      })
      .filter(Boolean);
    if (candidates.length === 0) return null;

    return {
      webContentUrl: location.href,
      extractorId: 'science-sciadv-current-physical-materials',
      extraction: {
        candidates,
        diagnostics: {
          tocBodySelectors: scienceTocBodySelectors,
          tocBodySelector: tocBody.selector,
          tocBodyMatchedRootCount: tocBody.matchedRootCount,
          sectionSelector: scienceSectionSelector,
          headingSelector: scienceHeadingSelector,
          targetHeading,
          fixedSectionIndex,
          selectedSectionIndex: sectionIndex,
          selectedBy,
          sectionCount: sections.length,
          selectedSectionHeading: sectionHeading || null,
          cardSelector: scienceCardSelector,
          linkSelector: scienceLinkSelector,
          titleSelector: scienceTitleSelector,
          dateSelector: scienceDateSelector,
          abstractSelector: scienceAbstractSelector,
          authorsSelector: scienceAuthorsSelector,
          cardCount: cards.length,
          candidateCount: candidates.length,
          datedCandidateCount,
          summarizedCandidateCount,
        },
      },
      nextPageUrl: null,
    };
  };
  const collectScienceCurrentNewsInDepthResearchArticlesExtraction = () => {
    const tocBody = resolveScienceTocBody();
    if (!tocBody) return null;

    const sections = Array.from(tocBody.root.querySelectorAll(':scope > section.toc__section'));
    if (sections.length === 0) return null;

    const targetSubsections = [
      {
        sectionHeading: 'news',
        subsectionHeading: 'in depth',
        articleType: 'In Depth',
      },
      {
        sectionHeading: 'research',
        subsectionHeading: 'research articles',
        articleType: 'Research Articles',
      },
    ];
    const buildTargetKey = (sectionHeading, subsectionHeading) =>
      cleanText(sectionHeading).toLowerCase() + '::' + cleanText(subsectionHeading).toLowerCase();
    const targetState = new Map(
      targetSubsections.map((target) => [
        buildTargetKey(target.sectionHeading, target.subsectionHeading),
        {
          ...target,
          matched: false,
          sectionIndex: null,
          sectionHeadingText: '',
          subsectionHeadingText: '',
          cardCount: 0,
          candidateCount: 0,
        },
      ]),
    );
    const seen = new Set();
    const candidates = [];
    let datedCandidateCount = 0;
    let summarizedCandidateCount = 0;
    let totalCardCount = 0;
    let order = 0;

    for (const [sectionIndex, section] of sections.entries()) {
      const sectionHeading = cleanText(section.querySelector(':scope > h4')?.textContent);
      let currentSubheading = '';

      for (const child of Array.from(section.children)) {
        if (child.matches(scienceSubheadingSelector)) {
          currentSubheading = cleanText(child.textContent);
          const targetKey = buildTargetKey(sectionHeading, currentSubheading);
          const target = targetState.get(targetKey);
          if (target) {
            target.matched = true;
            target.sectionIndex = sectionIndex;
            target.sectionHeadingText = sectionHeading;
            target.subsectionHeadingText = currentSubheading;
          }
          continue;
        }

        if (!child.matches(scienceCardSelector)) {
          continue;
        }

        const target = targetState.get(buildTargetKey(sectionHeading, currentSubheading));
        if (!target) {
          continue;
        }

        target.cardCount += 1;
        totalCardCount += 1;

        const link = child.querySelector(scienceLinkSelector);
        const href = cleanText(link?.getAttribute('href'));
        const title = cleanText(child.querySelector(scienceTitleSelector)?.textContent) || cleanText(link?.textContent);
        if (!href || !title) continue;

        const normalized = resolveUrl(href);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);

        const dateHint = extractScienceCardDateHint(child);
        const abstractText = cleanText(child.querySelector(scienceAbstractSelector)?.textContent) || null;
        const authors = extractScienceCardAuthors(child);
        const doi = extractScienceCardDoi(href);

        if (dateHint) datedCandidateCount += 1;
        if (abstractText) summarizedCandidateCount += 1;

        candidates.push({
          href,
          order,
          dateHint,
          articleType: target.articleType,
          title,
          doi,
          authors,
          abstractText,
          publishedAt: dateHint,
          scoreBoost: 180,
        });
        order += 1;
        target.candidateCount += 1;
      }
    }

    const targetSummaries = [...targetState.values()].map((target) => ({
      sectionHeading: target.sectionHeadingText || target.sectionHeading,
      subsectionHeading: target.subsectionHeadingText || target.subsectionHeading,
      matched: target.matched,
      sectionIndex: target.sectionIndex,
      cardCount: target.cardCount,
      candidateCount: target.candidateCount,
      articleType: target.articleType,
    }));
    const allTargetsReady = targetSummaries.every((target) => target.matched && target.candidateCount > 0);
    if (!allTargetsReady || candidates.length === 0) return null;

    const selectedSectionIndices = targetSummaries
      .map((target) => target.sectionIndex)
      .filter((value) => Number.isInteger(value));

    return {
      webContentUrl: location.href,
      extractorId: 'science-current-news-in-depth-research-articles',
      extraction: {
        candidates,
        diagnostics: {
          tocBodySelectors: scienceTocBodySelectors,
          tocBodySelector: tocBody.selector,
          tocBodyMatchedRootCount: tocBody.matchedRootCount,
          sectionSelector: scienceSectionSelector,
          headingSelector: scienceHeadingSelector,
          subsectionHeadingSelector: scienceSubheadingSelector,
          selectedSectionIndex:
            selectedSectionIndices.length > 0 ? Math.max(...selectedSectionIndices) : null,
          selectedSectionIndices,
          selectedBy: 'toc-body-target-section-subsection-pairs',
          sectionCount: sections.length,
          targetSubsections: targetSummaries,
          targetSubsectionCount: targetSummaries.length,
          matchedTargetSubsectionCount: targetSummaries.filter((target) => target.matched).length,
          cardSelector: scienceCardSelector,
          linkSelector: scienceLinkSelector,
          titleSelector: scienceTitleSelector,
          dateSelector: scienceDateSelector,
          abstractSelector: scienceAbstractSelector,
          authorsSelector: scienceAuthorsSelector,
          cardCount: totalCardCount,
          candidateCount: candidates.length,
          datedCandidateCount,
          summarizedCandidateCount,
        },
      },
      nextPageUrl: null,
    };
  };
  const collectExtractionByPreferredExtractorId = (value) => {
    switch (cleanText(value)) {
      case 'science-sciadv-current-physical-materials':
        return collectScienceAdvPhysicalMaterialsExtraction();
      case 'science-current-news-in-depth-research-articles':
        return collectScienceCurrentNewsInDepthResearchArticlesExtraction();
      case 'nature-latest-news':
        return collectLatestNewsExtraction();
      case 'nature-opinion':
        return collectOpinionExtraction();
      case 'nature-natelectron-research-articles':
        return collectNatureResearchArticlesExtraction('nature-natelectron-research-articles');
      case 'nature-ncomms-research-articles':
        return collectNatureResearchArticlesExtraction('nature-ncomms-research-articles');
      case 'nature-natmachintell-research-articles':
        return collectNatureResearchArticlesExtraction('nature-natmachintell-research-articles');
      case 'nature-nmat-research-articles':
        return collectNatureResearchArticlesExtraction('nature-nmat-research-articles');
      case 'nature-nnano-research-articles':
        return collectNatureResearchArticlesExtraction('nature-nnano-research-articles');
      case 'nature-npj2dmaterials-research-articles':
        return collectNatureResearchArticlesExtraction('nature-npj2dmaterials-research-articles');
      case 'nature-nphoton-research-articles':
        return collectNatureResearchArticlesExtraction('nature-nphoton-research-articles');
      case 'nature-nphys-research-articles':
        return collectNatureResearchArticlesExtraction('nature-nphys-research-articles');
      case 'nature-natsynth-research-articles':
        return collectNatureResearchArticlesExtraction('nature-natsynth-research-articles');
      case 'nature-natrevmats-reviews-and-analysis':
        return collectNatureResearchArticlesExtraction('nature-natrevmats-reviews-and-analysis');
      case 'nature-natrevphys-reviews-and-analysis':
        return collectNatureResearchArticlesExtraction('nature-natrevphys-reviews-and-analysis');
      case 'nature-natrevelectreng-reviews-and-analysis':
        return collectNatureResearchArticlesExtraction('nature-natrevelectreng-reviews-and-analysis');
      case 'nature-research-articles':
        return collectNatureResearchArticlesExtraction();
      default:
        return null;
    }
  };
  const preferredExtraction = collectExtractionByPreferredExtractorId(preferredExtractorId);
  if (preferredExtraction) {
    return preferredExtraction;
  }
  const normalizedPathname = normalizePathname(location.pathname);
  const normalizedHost = String(location.host || '').toLowerCase();
  if (
    (normalizedHost === 'www.science.org' || normalizedHost === 'science.org') &&
    normalizedPathname === '/toc/sciadv/current'
  ) {
    return collectScienceAdvPhysicalMaterialsExtraction();
  }
  if (
    (normalizedHost === 'www.science.org' || normalizedHost === 'science.org') &&
    normalizedPathname === '/toc/science/current'
  ) {
    return collectScienceCurrentNewsInDepthResearchArticlesExtraction();
  }
  if (normalizedHost !== 'www.nature.com') return null;
  if (normalizedPathname === '/latest-news') {
    return collectLatestNewsExtraction();
  }
  if (normalizedPathname === '/opinion') {
    return collectOpinionExtraction();
  }
  if (normalizedPathname === '/natelectron/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-natelectron-research-articles');
  }
  if (normalizedPathname === '/ncomms/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-ncomms-research-articles');
  }
  if (normalizedPathname === '/natmachintell/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-natmachintell-research-articles');
  }
  if (normalizedPathname === '/nmat/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-nmat-research-articles');
  }
  if (normalizedPathname === '/nnano/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-nnano-research-articles');
  }
  if (normalizedPathname === '/npj2dmaterials/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-npj2dmaterials-research-articles');
  }
  if (normalizedPathname === '/nphoton/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-nphoton-research-articles');
  }
  if (normalizedPathname === '/nphys/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-nphys-research-articles');
  }
  if (normalizedPathname === '/natsynth/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-natsynth-research-articles');
  }
  if (normalizedPathname === '/natrevmats/reviews-and-analysis') {
    return collectNatureResearchArticlesExtraction('nature-natrevmats-reviews-and-analysis');
  }
  if (normalizedPathname === '/natrevphys/reviews-and-analysis') {
    return collectNatureResearchArticlesExtraction('nature-natrevphys-reviews-and-analysis');
  }
  if (normalizedPathname === '/natrevelectreng/reviews-and-analysis') {
    return collectNatureResearchArticlesExtraction('nature-natrevelectreng-reviews-and-analysis');
  }
  if (/^\/[^/]+\/research-articles\/?$/i.test(location.pathname)) {
    return collectNatureResearchArticlesExtraction();
  }
  if (/^\/[^/]+\/reviews-and-analysis\/?$/i.test(location.pathname)) {
    return collectNatureResearchArticlesExtraction();
  }
  return null;
})`;

function createWebContentListingCandidateExtractionScript(preferredExtractorId?: string | null) {
  const normalizedPreferredExtractorId = String(preferredExtractorId ?? '').trim();
  return `(${PREVIEW_LISTING_CANDIDATE_EXTRACTION_SCRIPT})(${JSON.stringify(normalizedPreferredExtractorId)})`;
}

type WebContentBridgeTimeoutResult = {
  __lsTimedOut: true;
};

const cachedWebContentTargetStatesByTargetId = new Map<string, WebContentTargetState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWebContentLayoutPhase(value: unknown): value is WebContentLayoutPhase {
  return value === 'hidden' || value === 'measuring' || value === 'visible';
}

function isWebContentBridgeTimeoutResult(
  value: unknown,
): value is WebContentBridgeTimeoutResult {
  return isRecord(value) && value.__lsTimedOut === true;
}

function buildCachedWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const currentState =
    cachedWebContentTargetStatesByTargetId.get(normalizedTargetId) ??
    createDefaultWebContentTargetState();
  const activeTargetId = getActiveWebContentTargetId();
  const isActiveTarget = normalizedTargetId === activeTargetId;

  return {
    ...currentState,
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      activeTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : activeTargetId,
    ownership: isActiveTarget ? 'active' : 'inactive',
    layoutPhase: isActiveTarget
      ? (isWebContentLayoutPhase(lastReportedWebContentState.layoutPhase)
          ? lastReportedWebContentState.layoutPhase
          : 'hidden')
      : 'hidden',
    visible: isActiveTarget ? Boolean(lastReportedWebContentState.visible) : false,
  };
}

function coerceWebContentState(value: unknown, targetId?: string | null): WebContentState {
  const fallback = buildCachedWebContentState(targetId);
  if (!isRecord(value)) {
    return fallback;
  }

  const normalizedTargetId = normalizeWebContentTargetId(
    typeof value.targetId === 'string' || value.targetId == null
      ? value.targetId
      : targetId,
  );
  const normalizedActiveTargetId = normalizeWebContentTargetId(
    typeof value.activeTargetId === 'string' || value.activeTargetId == null
      ? value.activeTargetId
      : fallback.activeTargetId,
  );
  const isActiveTarget = normalizedTargetId === normalizedActiveTargetId;

  return {
    url: typeof value.url === 'string' ? value.url : fallback.url,
    pageTitle:
      typeof value.pageTitle === 'string'
        ? value.pageTitle
        : (fallback.pageTitle ?? ''),
    faviconUrl:
      typeof value.faviconUrl === 'string'
        ? value.faviconUrl
        : (fallback.faviconUrl ?? ''),
    canGoBack:
      typeof value.canGoBack === 'boolean' ? value.canGoBack : fallback.canGoBack,
    canGoForward:
      typeof value.canGoForward === 'boolean'
        ? value.canGoForward
        : fallback.canGoForward,
    isLoading:
      typeof value.isLoading === 'boolean' ? value.isLoading : fallback.isLoading,
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      normalizedActiveTargetId === DEFAULT_WEB_CONTENT_TARGET_ID
        ? null
        : normalizedActiveTargetId,
    ownership:
      value.ownership === 'active' || value.ownership === 'inactive'
        ? value.ownership
        : isActiveTarget
          ? 'active'
          : 'inactive',
    layoutPhase: isWebContentLayoutPhase(value.layoutPhase)
      ? value.layoutPhase
      : isActiveTarget
        ? fallback.layoutPhase
        : 'hidden',
    visible:
      typeof value.visible === 'boolean'
        ? value.visible
        : isActiveTarget
          ? fallback.visible
          : false,
  };
}

function rememberWebContentState(state: WebContentState) {
  const normalizedTargetId = normalizeWebContentTargetId(
    state.targetId ?? state.activeTargetId,
  );
  cachedWebContentTargetStatesByTargetId.set(normalizedTargetId, {
    url: state.url,
    pageTitle: String(state.pageTitle ?? '').trim(),
    faviconUrl: String(state.faviconUrl ?? '').trim(),
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    isLoading: state.isLoading,
  });
  rememberReportedWebContentState(state);
}

export function reportWebContentState(state: WebContentState) {
  rememberWebContentState(coerceWebContentState(state, state.targetId ?? state.activeTargetId));
}

function createRendererBridgeUnavailableError() {
  return new Error(WEB_CONTENT_BRIDGE_UNAVAILABLE_MESSAGE);
}

function rejectPendingRendererBridgeRequests(error: unknown = createRendererBridgeUnavailableError()) {
  for (const [requestId, pendingRequest] of pendingRendererBridgeRequests) {
    clearTimeout(pendingRequest.timeoutId);
    pendingRendererBridgeRequests.delete(requestId);
    pendingRequest.reject(error);
  }
}

function rejectRendererBridgeReadyWaiters(error: unknown = createRendererBridgeUnavailableError()) {
  for (const waiter of rendererBridgeReadyWaiters) {
    clearTimeout(waiter.timeoutId);
    rendererBridgeReadyWaiters.delete(waiter);
    waiter.reject(error);
  }
}

function resetRendererBridgeState() {
  rendererBridgeReady = false;
  rejectPendingRendererBridgeRequests();
  rejectRendererBridgeReadyWaiters();
}

function markRendererBridgeReady() {
  rendererBridgeReady = true;
  for (const waiter of rendererBridgeReadyWaiters) {
    clearTimeout(waiter.timeoutId);
    waiter.resolve();
  }
  rendererBridgeReadyWaiters.clear();
}

function getRendererBridgeWebContents() {
  if (!webContentWindow || webContentWindow.isDestroyed()) {
    throw createRendererBridgeUnavailableError();
  }

  const { webContents } = webContentWindow;
  if (!webContents || webContents.isDestroyed()) {
    throw createRendererBridgeUnavailableError();
  }

  return webContents;
}

async function waitForRendererBridge(timeoutMs = 4000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const webContents = getRendererBridgeWebContents();
    if (rendererBridgeReady) {
      return;
    }

    try {
      const bridgeAvailable = await webContents.executeJavaScript(
        `(() => {
          const bridge = window[${JSON.stringify(WEB_CONTENT_BRIDGE_KEY)}];
          if (!bridge) {
            return false;
          }

          try {
            window.electronAPI?.webContent?.reportBridgeReady?.();
          } catch {
            // Ignore recovery signaling failures here; the bridge presence is enough.
          }

          return true;
        })()`,
        true,
      );
      if (bridgeAvailable === true) {
        markRendererBridgeReady();
        return;
      }
    } catch {
      // Ignore transient renderer bootstrap failures and keep waiting.
    }

    await new Promise<void>((resolve, reject) => {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      const waitBudgetMs = Math.max(0, Math.min(remainingMs, 150));
      if (waitBudgetMs <= 0) {
        resolve();
        return;
      }

      const waiter: RendererBridgeReadyWaiter = {
        resolve: () => {
          rendererBridgeReadyWaiters.delete(waiter);
          resolve();
        },
        reject: (error) => {
          rendererBridgeReadyWaiters.delete(waiter);
          reject(error);
        },
        timeoutId: setTimeout(() => {
          rendererBridgeReadyWaiters.delete(waiter);
          resolve();
        }, waitBudgetMs),
      };
      rendererBridgeReadyWaiters.add(waiter);

      if (rendererBridgeReady) {
        clearTimeout(waiter.timeoutId);
        rendererBridgeReadyWaiters.delete(waiter);
        resolve();
      }
    });

    if (rendererBridgeReady) {
      return;
    }
  }

  try {
    const probe = await getRendererBridgeWebContents().executeJavaScript(
      `(() => ({
        hasBridge: Boolean(window[${JSON.stringify(WEB_CONTENT_BRIDGE_KEY)}]),
        hasElectronApi: Boolean(window.electronAPI?.webContent?.navigate),
        readyState: document.readyState,
        location: window.location.href,
      }))()`,
      true,
    );
    console.warn('[web-content-bridge] renderer unavailable after timeout', probe);
  } catch (error) {
    console.warn('[web-content-bridge] renderer probe failed', describeBridgeError(error));
  }

  throw createRendererBridgeUnavailableError();
}

async function invokeRendererWebContentBridge<T>(
  method: WebContentBridgeMethod,
  args: unknown[] = [],
): Promise<T> {
  await waitForRendererBridge();
  const webContents = getRendererBridgeWebContents();
  const requestId = `web-content-bridge-${rendererBridgeRequestIdPool++}`;

  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRendererBridgeRequests.delete(requestId);
      reject(new Error(`Desktop web content bridge command timed out (${method}).`));
    }, WEB_CONTENT_BRIDGE_REQUEST_TIMEOUT_MS);

    pendingRendererBridgeRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      timeoutId,
    });

    try {
      webContents.send('app:web-content-bridge-command', {
        requestId,
        method,
        args,
      });
    } catch (error) {
      const pendingRequest = pendingRendererBridgeRequests.get(requestId);
      if (pendingRequest) {
        pendingRendererBridgeRequests.delete(requestId);
        clearTimeout(pendingRequest.timeoutId);
      }
      reject(error);
    }
  });
}

function normalizeWebContentTimeoutMs(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(Number(value) || 0)) : 0;
}

async function executeWebContentScriptForTarget<T>(
  targetId: string | null | undefined,
  script: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<T | typeof webContentDocumentSnapshotTimedOut> {
  const timeoutMs = normalizeWebContentTimeoutMs(options.timeoutMs);

  try {
    const result = await invokeRendererWebContentBridge<
      T | WebContentBridgeTimeoutResult | null
    >('executeJavaScript', [
      normalizeWebContentTargetId(targetId),
      script,
      timeoutMs,
    ]);
    if (isWebContentBridgeTimeoutResult(result) || result === null) {
      return webContentDocumentSnapshotTimedOut;
    }
    return result as T;
  } catch {
    return webContentDocumentSnapshotTimedOut;
  }
}

async function executeWebContentScript<T>(
  script: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<T | typeof webContentDocumentSnapshotTimedOut> {
  return await executeWebContentScriptForTarget<T>(
    getActiveWebContentTargetId(),
    script,
    options,
  );
}

export async function executeWebContentTargetScript<T>(
  targetId: string | null | undefined,
  script: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<T | null> {
  const result = await executeWebContentScriptForTarget<T>(targetId, script, options);
  return result === webContentDocumentSnapshotTimedOut ? null : result;
}

function normalizeWebContentListingCandidateSeeds(value: unknown): ListingCandidateSeed[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((candidate) => {
      if (!isRecord(candidate)) return null;

      return normalizeListingCandidateSeed({
        href: candidate.href,
        order: candidate.order,
        dateHint: candidate.dateHint,
        articleType: candidate.articleType,
        title: candidate.title,
        doi: candidate.doi,
        authors: candidate.authors,
        abstractText: candidate.abstractText,
        descriptionText: candidate.descriptionText,
        publishedAt: candidate.publishedAt,
        scoreBoost: candidate.scoreBoost,
      });
    })
    .filter((candidate): candidate is ListingCandidateSeed => Boolean(candidate));
}

function describeBridgeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function reportWebContentRendererReady(sender: WebContents) {
  if (!webContentWindow || webContentWindow.isDestroyed()) {
    return;
  }

  const currentWebContents = webContentWindow.webContents;
  if (!currentWebContents || currentWebContents.isDestroyed()) {
    return;
  }

  if (sender.id !== currentWebContents.id) {
    return;
  }

  markRendererBridgeReady();
}

export function resolveWebContentBridgeResponse(
  sender: WebContents,
  response: WebContentBridgeResponse,
) {
  if (!response?.requestId) {
    return;
  }

  if (!webContentWindow || webContentWindow.isDestroyed()) {
    return;
  }

  const currentWebContents = webContentWindow.webContents;
  if (!currentWebContents || currentWebContents.isDestroyed() || sender.id !== currentWebContents.id) {
    return;
  }

  const pendingRequest = pendingRendererBridgeRequests.get(response.requestId);
  if (!pendingRequest) {
    return;
  }

  pendingRendererBridgeRequests.delete(response.requestId);
  if (response.ok) {
    pendingRequest.resolve(response.result);
    return;
  }

  pendingRequest.reject(new Error(String(response.error ?? WEB_CONTENT_BRIDGE_UNAVAILABLE_MESSAGE)));
}

export function ensureWebContentView(window: BrowserWindow) {
  disposeWebContentWindowListeners?.();
  webContentWindow = window;
  resetRendererBridgeState();

  const handleDidStartNavigation = (
    _event: Electron.Event,
    _url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ) => {
    if (!isMainFrame || isInPlace) {
      return;
    }

    resetRendererBridgeState();
  };
  const handleDestroyed = () => {
    resetRendererBridgeState();
  };
  const handleRenderProcessGone = () => {
    resetRendererBridgeState();
  };

  window.webContents.on('did-start-navigation', handleDidStartNavigation);
  window.webContents.on('destroyed', handleDestroyed);
  window.webContents.on('render-process-gone', handleRenderProcessGone);
  disposeWebContentWindowListeners = () => {
    if (!window.isDestroyed()) {
      const currentWebContents = window.webContents;
      if (!currentWebContents.isDestroyed()) {
        currentWebContents.removeListener('did-start-navigation', handleDidStartNavigation);
        currentWebContents.removeListener('destroyed', handleDestroyed);
        currentWebContents.removeListener('render-process-gone', handleRenderProcessGone);
      }
    }
    disposeWebContentWindowListeners = null;
  };
}

export function disposeWebContentView(window?: BrowserWindow | null) {
  if (window && webContentWindow && webContentWindow !== window) return;

  disposeWebContentWindowListeners?.();
  resetRendererBridgeState();
  cachedWebContentTargetStatesByTargetId.clear();
  activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
  lastReportedWebContentState = createDefaultWebContentState();
  webContentWindow = null;
}

export function setWebContentBounds(_bounds: WebContentBounds | null) {}

export function setWebContentVisible(_visible: boolean) {}

export function setWebContentLayoutPhaseState(_phase: WebContentLayoutPhase) {}

export function activateWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  activeWebContentTargetId = normalizedTargetId;

  void invokeRendererWebContentBridge<unknown>('activateTarget', [normalizedTargetId])
    .then((state) => {
      rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
    })
    .catch(() => {
      // Ignore fire-and-forget activation failures; the next state request will surface them.
    });
}

export function releaseWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
    return;
  }

  void invokeRendererWebContentBridge<void>('releaseTarget', [normalizedTargetId]).catch(() => {
    // Ignore fire-and-forget release failures.
  });
}

export function disposeWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
    return;
  }

  cachedWebContentTargetStatesByTargetId.delete(normalizedTargetId);
  if (activeWebContentTargetId === normalizedTargetId) {
    activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
    lastReportedWebContentState = createDefaultWebContentState();
  }

  void invokeRendererWebContentBridge<void>('disposeTarget', [normalizedTargetId]).catch(() => {
    // Ignore fire-and-forget dispose failures.
  });
}

export function getWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const normalizedReportedTargetId = normalizeWebContentTargetId(
    lastReportedWebContentState.targetId ?? lastReportedWebContentState.activeTargetId,
  );

  if (normalizedReportedTargetId === normalizedTargetId) {
    return coerceWebContentState(lastReportedWebContentState, normalizedTargetId);
  }

  return buildCachedWebContentState(normalizedTargetId);
}

export async function getWebContentDocumentSnapshot(
  options: WebContentDocumentSnapshotOptions = {},
): Promise<WebContentDocumentSnapshot | null> {
  const startedAt = Date.now();
  const state = getWebContentState();

  try {
    const html = await executeWebContentScript<string>(
      `(() => {
        try {
          return document.documentElement ? document.documentElement.outerHTML : '';
        } catch {
          return '';
        }
      })()`,
      options,
    );

    if (html === webContentDocumentSnapshotTimedOut) {
      return null;
    }

    if (typeof html !== 'string' || !html.trim()) {
      return null;
    }

    return {
      url: state.url,
      html,
      captureMs: Date.now() - startedAt,
      isLoading: state.isLoading,
    };
  } catch {
    return null;
  }
}

export async function getWebContentSelection(
  targetId?: string | null,
): Promise<WebContentSelectionSnapshot | null> {
  const selection = await executeWebContentScriptForTarget<{
    text?: unknown;
    rects?: unknown;
  }>(
    targetId,
    `(() => {
      try {
        const toRect = (rect) => ({
          x: Number(rect.left) || 0,
          y: Number(rect.top) || 0,
          width: Number(rect.width) || 0,
          height: Number(rect.height) || 0,
        });

        const readSelection = (doc) => {
          try {
            const selection = doc.getSelection?.();
            if (!selection || selection.rangeCount === 0) {
              return null;
            }

            const text = String(selection.toString() || '').trim();
            if (!text) {
              return null;
            }

            const range = selection.getRangeAt(0);
            const rects = Array.from(range.getClientRects?.() || []).map(toRect);
            return { text, rects };
          } catch {
            return null;
          }
        };

        const direct = readSelection(document);
        if (direct) {
          return direct;
        }

        const frames = Array.from(document.querySelectorAll('iframe'));
        for (const frame of frames) {
          try {
            const frameDocument = frame.contentDocument;
            if (!frameDocument) {
              continue;
            }
            const nested = readSelection(frameDocument);
            if (nested) {
              return nested;
            }
          } catch {
            // Ignore cross-origin or inaccessible frames.
          }
        }

        return null;
      } catch {
        return null;
      }
    })()`,
    { timeoutMs: 3000 },
  );

  if (
    selection === webContentDocumentSnapshotTimedOut ||
    !selection ||
    !isRecord(selection) ||
    typeof selection.text !== 'string' ||
    !Array.isArray(selection.rects)
  ) {
    return null;
  }

  const rects = selection.rects
    .filter((rect) => isRecord(rect))
    .map((rect) => ({
      x: typeof rect.x === 'number' ? rect.x : 0,
      y: typeof rect.y === 'number' ? rect.y : 0,
      width: typeof rect.width === 'number' ? rect.width : 0,
      height: typeof rect.height === 'number' ? rect.height : 0,
    }));

  return {
    text: selection.text,
    rects,
  };
}

export async function getWebContentDocumentHtml() {
  const snapshot = await getWebContentDocumentSnapshot();
  return snapshot?.html ?? null;
}

export async function getWebContentListingCandidateSnapshot(
  options: WebContentListingCandidateSnapshotOptions = {},
): Promise<WebContentListingCandidateSnapshot | null> {
  const startedAt = Date.now();
  const state = getWebContentState();

  try {
    const result = await executeWebContentScript<{
      webContentUrl?: unknown;
      extractorId?: unknown;
      extraction?: {
        candidates?: unknown;
        diagnostics?: unknown;
      };
      nextPageUrl?: unknown;
    }>(createWebContentListingCandidateExtractionScript(options.preferredExtractorId), options);

    if (result === webContentDocumentSnapshotTimedOut || !isRecord(result)) {
      return null;
    }

    const webContentUrl = String(result.webContentUrl ?? '').trim();
    const extractorId = String(result.extractorId ?? '').trim();
    const candidates = normalizeWebContentListingCandidateSeeds(result.extraction?.candidates);
    if (!webContentUrl || !extractorId || candidates.length === 0) {
      return null;
    }

    return {
      webContentUrl,
      extractorId,
      extraction: {
        candidates,
        diagnostics: isRecord(result.extraction?.diagnostics)
          ? result.extraction.diagnostics
          : undefined,
      },
      nextPageUrl: String(result.nextPageUrl ?? '').trim() || null,
      captureMs: Date.now() - startedAt,
      isLoading: state.isLoading,
    };
  } catch {
    return null;
  }
}

export async function navigateWebContent(
  url: string,
  mode: WebContentNavigationMode = 'browser',
) {
  const normalizedTargetId = getActiveWebContentTargetId();

  try {
    const state = await invokeRendererWebContentBridge<unknown>('navigateTo', [
      url,
      normalizedTargetId,
      mode,
    ]);
    rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
  } catch (error) {
    throw appError('PREVIEW_NOT_READY', {
      message: describeBridgeError(error),
      targetUrl: url,
      currentUrl: getWebContentState().url,
      navigationMode: mode,
    });
  }
}

export async function navigateWebContentTarget(
  url: string,
  targetId?: string | null,
  mode: WebContentNavigationMode = 'browser',
) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  activeWebContentTargetId = normalizedTargetId;

  try {
    const state = await invokeRendererWebContentBridge<unknown>('navigateTo', [
      url,
      normalizedTargetId,
      mode,
    ]);
    const coercedState = coerceWebContentState(state, normalizedTargetId);
    rememberWebContentState(coercedState);
    return coercedState;
  } catch (error) {
    throw appError('PREVIEW_NOT_READY', {
      message: describeBridgeError(error),
      targetUrl: url,
      currentUrl: getWebContentState(normalizedTargetId).url,
      navigationMode: mode,
    });
  }
}

export async function navigateWebContentForPrint(url: string, timeoutMs = 12000) {
  await navigateWebContentTarget(url, getActiveWebContentTargetId(), 'strict');

  const startedAt = Date.now();
  while (Date.now() - startedAt < Math.max(1000, timeoutMs)) {
    const mainReady = await executeWebContentScript<boolean>(
      `(() => {
        const main = document.querySelector('main#content');
        if (!main) return false;
        const title = (main.querySelector('h1')?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const text = (main.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const rect = main.getBoundingClientRect();
        return Boolean(title) && text.length >= 120 && rect.height > 120;
      })()`,
      { timeoutMs: 800 },
    );
    if (mainReady === true) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw appError('PREVIEW_NOT_READY', {
    message: 'Timed out while waiting for web content main content to become printable.',
    targetUrl: url,
    currentUrl: getWebContentState().url,
  });
}

export async function waitForWebContentPrintLayout(stabilizeMs = 1200) {
  const result = await executeWebContentScript<void>(
    `(() => {
      const maxWaitMs = Math.max(1800, ${Math.max(0, Math.trunc(stabilizeMs))} + 1800);
      const settleMs = Math.max(250, Math.min(600, ${Math.max(0, Math.trunc(stabilizeMs))}));
      const startedAt = Date.now();

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const readMainSignature = () => {
        const main = document.querySelector('main#content');
        if (!main) {
          return { ready: false, signature: 'missing-main' };
        }

        const titleNode = main.querySelector('h1');
        const titleText = normalizeText(titleNode?.textContent ?? '');
        const textSample = normalizeText(main.textContent ?? '').slice(0, 1500);
        const mainRect = main.getBoundingClientRect();
        const images = Array.from(main.querySelectorAll('img')).filter((image) => {
          const rect = image.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          return rect.top < Math.max(window.innerHeight * 1.5, 1400);
        });
        const imageCount = images.length;
        const loadedImageCount = images.filter((image) => image.complete && image.naturalWidth > 0).length;
        const hasMeaningfulLayout = mainRect.height > 240 || textSample.length > 400;
        const ready = Boolean(titleText) && Boolean(textSample) && hasMeaningfulLayout;
        const imagesReady = imageCount === 0 || imageCount === loadedImageCount;

        return {
          ready: ready && imagesReady,
          signature: JSON.stringify({
            titleText,
            textSample,
            imageCount,
            loadedImageCount,
          }),
        };
      };

      return new Promise((resolve) => {
        let lastStableSignature = '';
        let stableSince = 0;

        const tick = async () => {
          const snapshot = readMainSignature();
          const now = Date.now();

          if (snapshot.ready) {
            if (snapshot.signature === lastStableSignature) {
              if (!stableSince) {
                stableSince = now;
              }
              if (now - stableSince >= settleMs) {
                resolve(undefined);
                return;
              }
            } else {
              lastStableSignature = snapshot.signature;
              stableSince = now;
            }
          }

          if (now - startedAt >= maxWaitMs) {
            resolve(undefined);
            return;
          }

          await sleep(150);
          tick();
        };

        void tick();
      });
    })()`,
    { timeoutMs: Math.max(1800, Math.max(0, Math.trunc(stabilizeMs)) + 2400) },
  );

  if (result === webContentDocumentSnapshotTimedOut) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.trunc(stabilizeMs))));
  }
}

export async function printCurrentWebContentToPdf() {
  try {
    const base64Pdf = await invokeRendererWebContentBridge<string>('printToPDF', [
      getActiveWebContentTargetId(),
      {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        margins: {
          top: 0.4,
          bottom: 0.4,
          left: 0.4,
          right: 0.4,
        },
      },
    ]);
    return Buffer.from(base64Pdf, 'base64');
  } catch (error) {
    throw appError('PREVIEW_NOT_READY', {
      message: describeBridgeError(error),
      currentUrl: getWebContentState().url,
    });
  }
}

export function reloadWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  void invokeRendererWebContentBridge<unknown>('reload', [normalizedTargetId])
    .then((state) => {
      rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
    })
    .catch(() => {
      // Ignore fire-and-forget navigation button failures.
    });
}

export function hardReloadWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  void invokeRendererWebContentBridge<unknown>('hardReload', [normalizedTargetId])
    .then((state) => {
      rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
    })
    .catch(() => {
      // Ignore fire-and-forget navigation button failures.
    });
}

export function clearWebContentHistory(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  void invokeRendererWebContentBridge<unknown>('clearHistory', [normalizedTargetId])
    .then((state) => {
      rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
    })
    .catch(() => {
      // Ignore fire-and-forget navigation button failures.
    });
}

export function goBackWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  void invokeRendererWebContentBridge<unknown>('goBack', [normalizedTargetId])
    .then((state) => {
      rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
    })
    .catch(() => {
      // Ignore fire-and-forget navigation button failures.
    });
}

export function goForwardWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  void invokeRendererWebContentBridge<unknown>('goForward', [normalizedTargetId])
    .then((state) => {
      rememberWebContentState(coerceWebContentState(state, normalizedTargetId));
    })
    .catch(() => {
      // Ignore fire-and-forget navigation button failures.
    });
}
