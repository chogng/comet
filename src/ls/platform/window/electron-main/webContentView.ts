import { BrowserWindow, session, WebContentsView } from 'electron';
import { normalizeListingCandidateSeed } from 'ls/code/electron-main/fetch/sourceExtractors/types';
import type { ListingCandidateExtraction, ListingCandidateSeed } from 'ls/code/electron-main/fetch/sourceExtractors/types';

import type {
  WebContentBounds,
  WebContentLayoutPhase,
  WebContentNavigationMode,
  WebContentSelectionSnapshot,
  WebContentState,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'ls/base/common/errors';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'ls/platform/native/electron-main/sharedWebSession';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'ls/workbench/services/webContent/webContentRetentionConfig';

const DEFAULT_WEB_CONTENT_TARGET_ID = '__shared__';
const RETAINED_WEB_CONTENT_TARGET_TTL_MS = 3 * 60 * 1000;
const DEFAULT_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1024, height: 768 };
const HIDDEN_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };

type WebContentTargetState = Pick<
  WebContentState,
  | 'url'
  | 'pageTitle'
  | 'faviconUrl'
  | 'canGoBack'
  | 'canGoForward'
  | 'isLoading'
>;

type WebContentTargetMetadataMachine = {
  comparableUrl: string;
  pendingPageTitle: string;
  pendingFaviconUrl: string;
};

type ManagedWebContentTarget = {
  cleanup: Array<() => void>;
  metadataMachine: WebContentTargetMetadataMachine;
  state: WebContentTargetState;
  targetId: string;
  view: WebContentsView;
};

type RetainedWebContentTarget = {
  releasedAt: number;
};

let webContentWindow: BrowserWindow | null = null;
let activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
let lastReportedWebContentState: WebContentState = createDefaultWebContentState();
let disposeWebContentWindowListeners: (() => void) | null = null;
let webContentBounds: WebContentBounds | null = null;
let webContentVisible = false;
let webContentLayoutPhase: WebContentLayoutPhase = 'hidden';
let webContentRetentionSweepTimer: ReturnType<typeof setTimeout> | null = null;
let browserTabKeepAliveLimit = defaultBrowserTabKeepAliveLimit;
const webContentTargets = new Map<string, ManagedWebContentTarget>();
const retainedWebContentTargets = new Map<string, RetainedWebContentTarget>();

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
  const isActiveTarget = normalizedTargetId === activeWebContentTargetId;
  return {
    ...createDefaultWebContentTargetState(),
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      activeWebContentTargetId === DEFAULT_WEB_CONTENT_TARGET_ID
        ? null
        : activeWebContentTargetId,
    ownership:
      isActiveTarget ? 'active' : 'inactive',
    layoutPhase: isActiveTarget ? webContentLayoutPhase : 'hidden',
    visible: isActiveTarget ? webContentVisible : false,
  };
}

function rememberReportedWebContentState(state: WebContentState) {
  lastReportedWebContentState = state;
  activeWebContentTargetId = normalizeWebContentTargetId(state.activeTargetId);
}

function getActiveWebContentTargetId() {
  return activeWebContentTargetId;
}

function createDefaultTargetMetadataMachine(): WebContentTargetMetadataMachine {
  return {
    comparableUrl: '',
    pendingPageTitle: '',
    pendingFaviconUrl: '',
  };
}

function sanitizeWebContentFaviconUrl(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeComparableWebContentUrl(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function coerceWebContentNavigationUrl(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  if (/^about:blank$/i.test(normalized) || /^https?:\/\/about:blank$/i.test(normalized)) {
    return 'about:blank';
  }

  return normalized;
}

function isWebContentFailureUrl(url: string) {
  return /^about:blank$/i.test(url) || /^chrome-error:\/\//i.test(url);
}

function sanitizeWebContentPageTitle(pageTitle: string, currentUrl: string) {
  const normalizedPageTitle = String(pageTitle ?? '').trim();
  if (!normalizedPageTitle) {
    return '';
  }

  if (
    /^about:blank$/i.test(normalizedPageTitle) ||
    /^https?:\/\/about:blank$/i.test(normalizedPageTitle)
  ) {
    return '';
  }

  return coerceWebContentNavigationUrl(currentUrl) === 'about:blank'
    ? ''
    : normalizedPageTitle;
}

function hasWebContentReachedStableDestination(
  currentUrl: string,
  targetUrl: string,
  initialUrl: string,
  isLoading: boolean,
) {
  if (!currentUrl || isWebContentFailureUrl(currentUrl)) {
    return false;
  }

  if (currentUrl === targetUrl) {
    return true;
  }

  if (isLoading) {
    return false;
  }

  return currentUrl !== initialUrl;
}

function hasWebContentReachedTarget(
  mode: WebContentNavigationMode,
  currentUrl: string,
  targetUrl: string,
  initialUrl: string,
  isLoading: boolean,
) {
  switch (mode) {
    case 'strict':
      return currentUrl === targetUrl;
    case 'browser':
    default:
      return hasWebContentReachedStableDestination(
        currentUrl,
        targetUrl,
        initialUrl,
        isLoading,
      );
  }
}

function isAbortLikeWebContentNavigationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\bERR_ABORTED\b/i.test(message) || /\(-3\)\s+loading\b/i.test(message);
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function areWebContentStatesEqual(previous: WebContentState, next: WebContentState) {
  return (
    previous.targetId === next.targetId &&
    previous.activeTargetId === next.activeTargetId &&
    previous.ownership === next.ownership &&
    previous.layoutPhase === next.layoutPhase &&
    previous.url === next.url &&
    (previous.pageTitle ?? '') === (next.pageTitle ?? '') &&
    (previous.faviconUrl ?? '') === (next.faviconUrl ?? '') &&
    previous.canGoBack === next.canGoBack &&
    previous.canGoForward === next.canGoForward &&
    previous.isLoading === next.isLoading &&
    previous.visible === next.visible
  );
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

type WebContentExecutionTimeoutResult = {
  __lsTimedOut: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWebContentLayoutPhase(value: unknown): value is WebContentLayoutPhase {
  return value === 'hidden' || value === 'measuring' || value === 'visible';
}

function isWebContentExecutionTimeoutResult(
  value: unknown,
): value is WebContentExecutionTimeoutResult {
  return isRecord(value) && value.__lsTimedOut === true;
}

function isValidWebContentBounds(bounds: WebContentBounds | null): bounds is WebContentBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0,
  );
}

function getWebContentOwnerWindow() {
  if (!webContentWindow || webContentWindow.isDestroyed()) {
    throw appError('PREVIEW_NOT_READY', {
      message: 'Desktop web content window is unavailable.',
    });
  }

  return webContentWindow;
}

function shouldShowActiveWebContentTarget() {
  return Boolean(
    webContentVisible &&
      webContentLayoutPhase === 'visible' &&
      isValidWebContentBounds(webContentBounds),
  );
}

function buildWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const target = webContentTargets.get(normalizedTargetId);
  const currentState = target?.state ?? createDefaultWebContentTargetState();
  const activeTargetId = getActiveWebContentTargetId();
  const isActiveTarget = normalizedTargetId === activeTargetId;

  return {
    ...currentState,
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      activeTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : activeTargetId,
    ownership: isActiveTarget ? 'active' : 'inactive',
    layoutPhase: isActiveTarget ? webContentLayoutPhase : 'hidden',
    visible: isActiveTarget && Boolean(target?.view.getVisible()),
  };
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
  const entry = webContentTargets.get(normalizeWebContentTargetId(targetId));
  if (!entry || entry.view.webContents.isDestroyed()) {
    return webContentDocumentSnapshotTimedOut;
  }

  try {
    const execution = entry.view.webContents.executeJavaScript(script, true) as Promise<T>;
    const result = timeoutMs > 0
      ? await Promise.race([
          execution,
          new Promise<WebContentExecutionTimeoutResult>((resolve) => {
            setTimeout(() => resolve({ __lsTimedOut: true }), timeoutMs);
          }),
        ])
      : await execution;
    if (isWebContentExecutionTimeoutResult(result) || result === null) {
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

function describeWebContentError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ensureWebContentView(window: BrowserWindow) {
  if (webContentWindow && webContentWindow !== window) {
    disposeWebContentView(webContentWindow);
  }

  disposeWebContentWindowListeners?.();
  webContentWindow = window;

  const handleDestroyed = () => {
    disposeWebContentView(window);
  };
  const handleRenderProcessGone = () => {
    applyWebContentLayout();
  };

  window.webContents.on('destroyed', handleDestroyed);
  window.webContents.on('render-process-gone', handleRenderProcessGone);
  disposeWebContentWindowListeners = () => {
    if (!window.isDestroyed()) {
      const currentWebContents = window.webContents;
      if (!currentWebContents.isDestroyed()) {
        currentWebContents.removeListener('destroyed', handleDestroyed);
        currentWebContents.removeListener('render-process-gone', handleRenderProcessGone);
      }
    }
    disposeWebContentWindowListeners = null;
  };

  applyWebContentLayout();
}

export function disposeWebContentView(window?: BrowserWindow | null) {
  if (window && webContentWindow && webContentWindow !== window) return;

  disposeWebContentWindowListeners?.();
  clearRetentionSweepTimer();
  for (const targetId of [...webContentTargets.keys()]) {
    disposeWebContentTargetEntry(targetId);
  }
  retainedWebContentTargets.clear();
  webContentBounds = null;
  webContentVisible = false;
  webContentLayoutPhase = 'hidden';
  activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
  lastReportedWebContentState = createDefaultWebContentState();
  webContentWindow = null;
}

function clearRetentionSweepTimer() {
  if (webContentRetentionSweepTimer === null) {
    return;
  }

  clearTimeout(webContentRetentionSweepTimer);
  webContentRetentionSweepTimer = null;
}

function scheduleRetentionSweep(nextSweepDelayMs: number | null) {
  clearRetentionSweepTimer();
  if (nextSweepDelayMs === null || retainedWebContentTargets.size === 0) {
    return;
  }

  webContentRetentionSweepTimer = setTimeout(() => {
    webContentRetentionSweepTimer = null;
    sweepReleasedWebContentTargets(Date.now());
  }, nextSweepDelayMs);
}

function markWebContentTargetAsRetained(targetId: string, now = Date.now()) {
  if (targetId === DEFAULT_WEB_CONTENT_TARGET_ID || !webContentTargets.has(targetId)) {
    retainedWebContentTargets.delete(targetId);
    return;
  }

  retainedWebContentTargets.set(targetId, { releasedAt: now });
}

function markWebContentTargetAsActive(targetId: string) {
  retainedWebContentTargets.delete(targetId);
}

function sweepReleasedWebContentTargets(now = Date.now()) {
  retainedWebContentTargets.delete(activeWebContentTargetId);

  for (const targetId of [...retainedWebContentTargets.keys()]) {
    if (!webContentTargets.has(targetId)) {
      retainedWebContentTargets.delete(targetId);
    }
  }

  const evictedTargetIds: string[] = [];
  for (const [targetId, retentionEntry] of retainedWebContentTargets) {
    if (now - retentionEntry.releasedAt >= RETAINED_WEB_CONTENT_TARGET_TTL_MS) {
      evictedTargetIds.push(targetId);
    }
  }

  if (retainedWebContentTargets.size - evictedTargetIds.length > browserTabKeepAliveLimit) {
    const overflowCount =
      retainedWebContentTargets.size -
      evictedTargetIds.length -
      browserTabKeepAliveLimit;
    const overflowEvictions = [...retainedWebContentTargets.entries()]
      .filter(([targetId]) => !evictedTargetIds.includes(targetId))
      .sort(([, left], [, right]) => left.releasedAt - right.releasedAt)
      .slice(0, Math.max(0, overflowCount))
      .map(([targetId]) => targetId);
    evictedTargetIds.push(...overflowEvictions);
  }

  for (const targetId of evictedTargetIds) {
    retainedWebContentTargets.delete(targetId);
    disposeWebContentTargetEntry(targetId);
  }

  let nextSweepDelayMs: number | null = null;
  for (const retentionEntry of retainedWebContentTargets.values()) {
    const delayMs = Math.max(
      0,
      retentionEntry.releasedAt + RETAINED_WEB_CONTENT_TARGET_TTL_MS - now,
    );
    nextSweepDelayMs =
      nextSweepDelayMs === null ? delayMs : Math.min(nextSweepDelayMs, delayMs);
  }

  scheduleRetentionSweep(nextSweepDelayMs);
  applyWebContentLayout();
}

function disposeWebContentTargetEntry(targetId: string) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  retainedWebContentTargets.delete(normalizedTargetId);
  const entry = webContentTargets.get(normalizedTargetId);
  if (!entry) {
    return;
  }

  webContentTargets.delete(normalizedTargetId);
  for (const cleanup of entry.cleanup) {
    cleanup();
  }

  try {
    entry.view.webContents.stop();
  } catch {
    // Ignore stop failures while tearing down a browser view.
  }

  try {
    webContentWindow?.contentView.removeChildView(entry.view);
  } catch {
    // Ignore content-view removal races during window teardown.
  }

  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close();
  }
}

type WebContentEmitter = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
};

function addWebContentTargetListener(
  entry: ManagedWebContentTarget,
  event: string,
  listener: (...args: unknown[]) => void,
) {
  const emitter = entry.view.webContents as unknown as WebContentEmitter;
  emitter.on(event, listener);
  entry.cleanup.push(() => {
    emitter.removeListener(event, listener);
  });
}

function resolveFaviconUrl(favicons: unknown) {
  if (!Array.isArray(favicons)) {
    return '';
  }

  for (const candidate of favicons) {
    const faviconUrl = sanitizeWebContentFaviconUrl(candidate);
    if (faviconUrl) {
      return faviconUrl;
    }
  }

  return '';
}

function createWebContentTarget(targetId: string) {
  const window = getWebContentOwnerWindow();
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(WORKBENCH_SHARED_WEB_PARTITION),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      plugins: true,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  view.setBounds(DEFAULT_WEB_CONTENT_BOUNDS);
  view.setVisible(false);
  window.contentView.addChildView(view);

  const entry: ManagedWebContentTarget = {
    cleanup: [],
    metadataMachine: createDefaultTargetMetadataMachine(),
    state: createDefaultWebContentTargetState(),
    targetId,
    view,
  };

  const syncState = () => {
    syncWebContentTargetState(targetId);
  };

  for (const event of [
    'did-start-loading',
    'did-stop-loading',
    'did-finish-load',
    'did-navigate',
    'did-navigate-in-page',
    'did-fail-load',
  ]) {
    addWebContentTargetListener(entry, event, syncState);
  }

  addWebContentTargetListener(entry, 'page-title-updated', (_event, title) => {
    const pageTitle = String(title ?? '').trim();
    if (!pageTitle) {
      return;
    }

    if (
      entry.metadataMachine.pendingPageTitle === pageTitle &&
      String(entry.state.pageTitle ?? '').trim() === pageTitle
    ) {
      return;
    }

    entry.metadataMachine = {
      ...entry.metadataMachine,
      pendingPageTitle: pageTitle,
    };
    syncWebContentTargetState(targetId);
  });

  addWebContentTargetListener(entry, 'page-favicon-updated', (_event, favicons) => {
    const faviconUrl = resolveFaviconUrl(favicons);
    if (!faviconUrl) {
      return;
    }

    if (
      entry.metadataMachine.pendingFaviconUrl === faviconUrl &&
      sanitizeWebContentFaviconUrl(entry.state.faviconUrl) === faviconUrl
    ) {
      return;
    }

    entry.metadataMachine = {
      ...entry.metadataMachine,
      pendingFaviconUrl: faviconUrl,
    };
    syncWebContentTargetState(targetId);
  });

  addWebContentTargetListener(entry, 'destroyed', () => {
    webContentTargets.delete(targetId);
    retainedWebContentTargets.delete(targetId);
    if (activeWebContentTargetId === targetId) {
      activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
    }
    reportActiveWebContentState();
  });

  view.webContents.setWindowOpenHandler((details) => {
    const url = coerceWebContentNavigationUrl(details.url);
    if (url) {
      void navigateWebContentTarget(url, targetId, 'browser').catch((error) => {
        console.warn('[web-content-view] failed to navigate popup url', describeWebContentError(error));
      });
    }
    return { action: 'deny' };
  });

  webContentTargets.set(targetId, entry);
  syncWebContentTargetState(targetId);
  applyWebContentLayout();
  return entry;
}

function ensureWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const existingEntry = webContentTargets.get(normalizedTargetId);
  if (existingEntry && !existingEntry.view.webContents.isDestroyed()) {
    return existingEntry;
  }

  if (existingEntry) {
    webContentTargets.delete(normalizedTargetId);
  }

  return createWebContentTarget(normalizedTargetId);
}

function readWebContentTargetState(entry: ManagedWebContentTarget): WebContentTargetState {
  try {
    const previousState = entry.state;
    const previousMetadataMachine = entry.metadataMachine;
    const webContents = entry.view.webContents;
    const nextUrl = String(webContents.getURL() ?? '').trim();
    const nextComparableUrl = normalizeComparableWebContentUrl(nextUrl);
    const nextIsLoading = webContents.isLoading();
    const isNavigationTargetChanged =
      nextComparableUrl !== previousMetadataMachine.comparableUrl;
    const pendingPageTitle = isNavigationTargetChanged
      ? ''
      : sanitizeWebContentPageTitle(
          previousMetadataMachine.pendingPageTitle,
          nextUrl,
        );
    const pendingFaviconUrl = isNavigationTargetChanged
      ? ''
      : sanitizeWebContentFaviconUrl(previousMetadataMachine.pendingFaviconUrl);
    const sampledPageTitle = sanitizeWebContentPageTitle(
      String(webContents.getTitle() ?? '').trim(),
      nextUrl,
    );
    const previousPageTitle = isNavigationTargetChanged
      ? ''
      : String(previousState.pageTitle ?? '').trim();
    const previousFaviconUrl = isNavigationTargetChanged
      ? ''
      : sanitizeWebContentFaviconUrl(previousState.faviconUrl);
    const canApplyPendingPageTitle =
      Boolean(pendingPageTitle) &&
      !nextIsLoading &&
      (!sampledPageTitle || sampledPageTitle === pendingPageTitle);
    const canApplyPendingFaviconUrl =
      Boolean(pendingFaviconUrl) &&
      !nextIsLoading;
    const resolvedPageTitle = canApplyPendingPageTitle
      ? pendingPageTitle
      : !nextIsLoading && sampledPageTitle
        ? sampledPageTitle
        : previousPageTitle;
    const resolvedFaviconUrl = canApplyPendingFaviconUrl
      ? pendingFaviconUrl
      : previousFaviconUrl;

    entry.metadataMachine = {
      comparableUrl: nextComparableUrl,
      pendingPageTitle: canApplyPendingPageTitle ? '' : pendingPageTitle,
      pendingFaviconUrl: canApplyPendingFaviconUrl ? '' : pendingFaviconUrl,
    };

    return {
      url: nextUrl,
      pageTitle: resolvedPageTitle,
      faviconUrl: resolvedFaviconUrl,
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      isLoading: nextIsLoading,
    };
  } catch {
    entry.metadataMachine = createDefaultTargetMetadataMachine();
    return createDefaultWebContentTargetState();
  }
}

function syncWebContentTargetState(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const entry = webContentTargets.get(normalizedTargetId);
  if (!entry) {
    return createDefaultWebContentTargetState();
  }

  entry.state = readWebContentTargetState(entry);
  if (normalizedTargetId === activeWebContentTargetId) {
    reportActiveWebContentState();
  }
  return entry.state;
}

function reportActiveWebContentState() {
  const nextState = buildWebContentState(activeWebContentTargetId);
  if (areWebContentStatesEqual(lastReportedWebContentState, nextState)) {
    return;
  }

  rememberReportedWebContentState(nextState);
  const window = webContentWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  window.webContents.send('app:web-content-state', nextState);
}

function applyWebContentLayout() {
  const activeTargetId = getActiveWebContentTargetId();
  const shouldShow = shouldShowActiveWebContentTarget();
  const visibleBounds = isValidWebContentBounds(webContentBounds)
    ? {
        x: Math.round(webContentBounds.x),
        y: Math.round(webContentBounds.y),
        width: Math.round(webContentBounds.width),
        height: Math.round(webContentBounds.height),
      }
    : HIDDEN_WEB_CONTENT_BOUNDS;

  for (const [targetId, entry] of webContentTargets) {
    const shouldShowTarget = shouldShow && targetId === activeTargetId;
    if (shouldShowTarget) {
      entry.view.setBounds(visibleBounds);
      entry.view.setVisible(true);
      continue;
    }

    if (entry.view.webContents.isFocused()) {
      webContentWindow?.webContents.focus();
    }
    entry.view.setVisible(false);
    entry.view.setBounds(HIDDEN_WEB_CONTENT_BOUNDS);
  }

  reportActiveWebContentState();
}

export function setWebContentBounds(bounds: WebContentBounds | null) {
  webContentBounds = isValidWebContentBounds(bounds)
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : null;
  applyWebContentLayout();
}

export function setWebContentVisible(visible: boolean) {
  webContentVisible = Boolean(visible);
  applyWebContentLayout();
}

export function setWebContentLayoutPhaseState(phase: WebContentLayoutPhase) {
  if (!isWebContentLayoutPhase(phase)) {
    return;
  }

  webContentLayoutPhase = phase;
  applyWebContentLayout();
}

export function setWebContentRetentionLimit(limit: unknown) {
  browserTabKeepAliveLimit = normalizeBrowserTabKeepAliveLimit(limit, browserTabKeepAliveLimit);
  sweepReleasedWebContentTargets(Date.now());
}

export function activateWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  activeWebContentTargetId = normalizedTargetId;
  syncWebContentTargetState(normalizedTargetId);
  applyWebContentLayout();
}

export function releaseWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
    return;
  }

  if (activeWebContentTargetId === normalizedTargetId) {
    activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
  }
  markWebContentTargetAsRetained(normalizedTargetId);
  sweepReleasedWebContentTargets(Date.now());
  applyWebContentLayout();
}

export function disposeWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
    return;
  }

  disposeWebContentTargetEntry(normalizedTargetId);
  if (activeWebContentTargetId === normalizedTargetId) {
    activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
  }
  applyWebContentLayout();
}

export function getWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (webContentTargets.has(normalizedTargetId)) {
    syncWebContentTargetState(normalizedTargetId);
  }

  return buildWebContentState(normalizedTargetId);
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
  await navigateWebContentTarget(url, getActiveWebContentTargetId(), mode);
}

export async function navigateWebContentTarget(
  url: string,
  targetId?: string | null,
  mode: WebContentNavigationMode = 'browser',
) {
  const resolvedUrl = coerceWebContentNavigationUrl(url);
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  activeWebContentTargetId = normalizedTargetId;
  applyWebContentLayout();
  syncWebContentTargetState(normalizedTargetId);

  try {
    if (!resolvedUrl) {
      return getWebContentState(normalizedTargetId);
    }

    const initialUrl = normalizeComparableWebContentUrl(getWebContentState(normalizedTargetId).url);
    const normalizedTargetUrl = normalizeComparableWebContentUrl(resolvedUrl);
    if (normalizedTargetUrl === 'about:blank') {
      await entry.view.webContents.loadURL('about:blank');
      entry.state = {
        ...createDefaultWebContentTargetState(),
        url: 'about:blank',
      };
      entry.metadataMachine = createDefaultTargetMetadataMachine();
      reportActiveWebContentState();
      return getWebContentState(normalizedTargetId);
    }

    let navigationFailure: unknown = null;
    void entry.view.webContents.loadURL(resolvedUrl).catch((error) => {
      if (isAbortLikeWebContentNavigationError(error)) {
        return;
      }
      navigationFailure = error;
    });

    const startedAt = Date.now();
    const timeoutMs = 12000;
    while (Date.now() - startedAt < timeoutMs) {
      if (navigationFailure) {
        throw navigationFailure;
      }

      const currentState = getWebContentState(normalizedTargetId);
      const currentUrl = normalizeComparableWebContentUrl(currentState.url);
      if (
        hasWebContentReachedTarget(
          mode,
          currentUrl,
          normalizedTargetUrl,
          initialUrl,
          currentState.isLoading,
        )
      ) {
        return currentState;
      }

      await delay(120);
    }

    throw new Error(
      mode === 'strict'
        ? 'Timed out while waiting for the web content URL to match the target exactly.'
        : 'Timed out while waiting for web content navigation to settle on a destination.',
    );
  } catch (error) {
    throw appError('PREVIEW_NOT_READY', {
      message: describeWebContentError(error),
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
    const entry = webContentTargets.get(getActiveWebContentTargetId());
    if (!entry || entry.view.webContents.isDestroyed()) {
      throw new Error('Browser view is unavailable.');
    }

    return await entry.view.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margins: {
        top: 0.4,
        bottom: 0.4,
        left: 0.4,
        right: 0.4,
      },
    });
  } catch (error) {
    throw appError('PREVIEW_NOT_READY', {
      message: describeWebContentError(error),
      currentUrl: getWebContentState().url,
    });
  }
}

export function reloadWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  entry.view.webContents.reload();
  syncWebContentTargetState(normalizedTargetId);
}

export function hardReloadWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  entry.view.webContents.reloadIgnoringCache();
  syncWebContentTargetState(normalizedTargetId);
}

export function clearWebContentHistory(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  entry.view.webContents.navigationHistory.clear();
  syncWebContentTargetState(normalizedTargetId);
  applyWebContentLayout();
}

export function goBackWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  if (entry.view.webContents.navigationHistory.canGoBack()) {
    entry.view.webContents.navigationHistory.goBack();
  }
  syncWebContentTargetState(normalizedTargetId);
}

export function goForwardWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  if (entry.view.webContents.navigationHistory.canGoForward()) {
    entry.view.webContents.navigationHistory.goForward();
  }
  syncWebContentTargetState(normalizedTargetId);
}
