/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, session, WebContentsView, type Session } from 'electron';
import { VSBuffer } from 'cs/base/common/buffer';
import { Emitter, type Event } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import { normalizeListingCandidateSeed } from 'cs/platform/browserView/common/listingCandidates';
import type { ListingCandidateExtraction, ListingCandidateSeed } from 'cs/platform/browserView/common/listingCandidates';

import {
  BrowserViewStorageScope,
  browserZoomDefaultIndex,
  browserZoomFactors,
  type IBrowserDeviceProfile,
  type IBrowserViewBounds,
  type IBrowserViewCaptureScreenshotOptions,
  type IBrowserViewCreatedEvent,
  type IBrowserViewCreateOptions,
  type IBrowserViewDevToolsStateEvent,
  type IBrowserViewFaviconChangeEvent,
  type IBrowserViewFindInPageOptions,
  type IBrowserViewFindInPageResult,
  type IBrowserViewFocusEvent,
  type IBrowserViewInfo,
  type IBrowserViewKeyDownEvent,
  type IBrowserViewLoadingEvent,
  type IBrowserViewNavigationEvent,
  type IBrowserViewOwner,
  type IBrowserViewPermissionRequestEvent,
  type IBrowserViewRect,
  type IBrowserViewService,
  type IBrowserViewState,
  type IBrowserViewTitleChangeEvent,
  type IBrowserViewVisibilityEvent,
  type IBrowserViewWindowConfiguration,
  type BrowserViewTargetPresentation,
  type IElementData,
  type WebContentBounds,
  type WebContentLayoutPhase,
  type WebContentNavigationMode,
  type WebContentSelectionSnapshot,
  type WebContentState,
} from 'cs/platform/browserView/common/browserView';
import type {
  IPermissionCategoryState,
  ISerializedBrowserPermissionsSnapshot,
} from 'cs/platform/browserView/common/browserPermissions';
import { BrowserViewErrorCode, browserViewError } from 'cs/platform/browserView/common/browserViewErrors';
import { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';

const DEFAULT_WEB_CONTENT_TARGET_ID = '__shared__';
const RETAINED_WEB_CONTENT_TARGET_TTL_MS = 3 * 60 * 1000;
const DEFAULT_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1024, height: 768 };
const BACKGROUND_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1280, height: 900 };
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

export interface BrowserViewMainContext {
  readonly id: string;
  readonly session: Session;
  readonly storageScope: BrowserViewStorageScope;
}

export interface BrowserViewMainTarget {
  readonly context: BrowserViewMainContext;
  readonly debuggerTransport: BrowserViewDebugger;
  readonly onDidClose: Event<void>;
  readonly owner: IBrowserViewOwner;
  readonly targetId: string;
  readonly view: WebContentsView;
}

type ManagedWebContentTarget = {
  cleanup: Array<() => void>;
  context: BrowserViewMainContext;
  debuggerTransport: BrowserViewDebugger;
  metadataMachine: WebContentTargetMetadataMachine;
  onDidClose?: Event<void>;
  owner?: IBrowserViewOwner;
  state: WebContentTargetState;
  statusCode: number | null;
  targetId: string;
  view: WebContentsView;
};

type BrowserViewTargetEvents = {
  readonly disposables: DisposableStore;
  readonly onDidNavigate: Emitter<IBrowserViewNavigationEvent>;
  readonly onDidChangeLoadingState: Emitter<IBrowserViewLoadingEvent>;
  readonly onDidChangeFocus: Emitter<IBrowserViewFocusEvent>;
  readonly onDidChangeVisibility: Emitter<IBrowserViewVisibilityEvent>;
  readonly onDidChangeDevToolsState: Emitter<IBrowserViewDevToolsStateEvent>;
  readonly onDidKeyCommand: Emitter<IBrowserViewKeyDownEvent>;
  readonly onDidChangeTitle: Emitter<IBrowserViewTitleChangeEvent>;
  readonly onDidChangeFavicon: Emitter<IBrowserViewFaviconChangeEvent>;
  readonly onDidFindInPage: Emitter<IBrowserViewFindInPageResult>;
  readonly onDidClose: Emitter<void>;
  readonly onDidSelectElement: Emitter<IElementData>;
  readonly onDidChangeElementSelectionActive: Emitter<boolean>;
  readonly onDidPickArea: Emitter<IBrowserViewRect | undefined>;
  readonly onDidChangeAreaSelectionActive: Emitter<boolean>;
  readonly onDidChangeDeviceEmulation: Emitter<IBrowserDeviceProfile | undefined>;
  readonly onDidChangeRemoteStatus: Emitter<boolean>;
  readonly onDidRequestPermission: Emitter<IBrowserViewPermissionRequestEvent>;
  readonly onDidChangePermissions: Emitter<ISerializedBrowserPermissionsSnapshot>;
};

type BrowserViewTargetMetadata = {
  readonly owner: IBrowserViewOwner;
  readonly storageScope: BrowserViewStorageScope;
  readonly events: BrowserViewTargetEvents;
  presentation: BrowserViewTargetPresentation;
  permissions: ISerializedBrowserPermissionsSnapshot;
  browserZoomIndex: number;
  device: IBrowserDeviceProfile | undefined;
  isElementSelectionActive: boolean;
  isAreaSelectionActive: boolean;
  visible: boolean;
  bounds: WebContentBounds | undefined;
  lastScreenshot: VSBuffer | undefined;
  readonly consoleLogs: string[];
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
const browserViewTargetMetadata = new Map<string, BrowserViewTargetMetadata>();
const browserViewWindowConfigurations = new Map<number, IBrowserViewWindowConfiguration>();
const browserViewCreatedEmitter = new Emitter<IBrowserViewCreatedEvent>();

function createBrowserViewTargetEvents(): BrowserViewTargetEvents {
  const disposables = new DisposableStore();
  return {
    disposables,
    onDidNavigate: disposables.add(new Emitter<IBrowserViewNavigationEvent>()),
    onDidChangeLoadingState: disposables.add(new Emitter<IBrowserViewLoadingEvent>()),
    onDidChangeFocus: disposables.add(new Emitter<IBrowserViewFocusEvent>()),
    onDidChangeVisibility: disposables.add(new Emitter<IBrowserViewVisibilityEvent>()),
    onDidChangeDevToolsState: disposables.add(new Emitter<IBrowserViewDevToolsStateEvent>()),
    onDidKeyCommand: disposables.add(new Emitter<IBrowserViewKeyDownEvent>()),
    onDidChangeTitle: disposables.add(new Emitter<IBrowserViewTitleChangeEvent>()),
    onDidChangeFavicon: disposables.add(new Emitter<IBrowserViewFaviconChangeEvent>()),
    onDidFindInPage: disposables.add(new Emitter<IBrowserViewFindInPageResult>()),
    onDidClose: disposables.add(new Emitter<void>()),
    onDidSelectElement: disposables.add(new Emitter<IElementData>()),
    onDidChangeElementSelectionActive: disposables.add(new Emitter<boolean>()),
    onDidPickArea: disposables.add(new Emitter<IBrowserViewRect | undefined>()),
    onDidChangeAreaSelectionActive: disposables.add(new Emitter<boolean>()),
    onDidChangeDeviceEmulation: disposables.add(new Emitter<IBrowserDeviceProfile | undefined>()),
    onDidChangeRemoteStatus: disposables.add(new Emitter<boolean>()),
    onDidRequestPermission: disposables.add(new Emitter<IBrowserViewPermissionRequestEvent>()),
    onDidChangePermissions: disposables.add(new Emitter<ISerializedBrowserPermissionsSnapshot>()),
  };
}

function createBrowserViewContext(
  targetId: string,
  storageScope: BrowserViewStorageScope,
): BrowserViewMainContext {
  switch (storageScope) {
    case BrowserViewStorageScope.Global:
      return {
        id: WORKBENCH_SHARED_WEB_PARTITION,
        session: session.fromPartition(WORKBENCH_SHARED_WEB_PARTITION),
        storageScope,
      };
    case BrowserViewStorageScope.Ephemeral:
      return {
        id: targetId,
        session: session.fromPartition(`comet-browser-view-${targetId}`),
        storageScope,
      };
    case BrowserViewStorageScope.Workspace:
      throw new Error('Workspace-scoped browser sessions require a workspace identifier.');
  }
}

function createBrowserViewTargetMetadata(
  options: IBrowserViewCreateOptions,
): BrowserViewTargetMetadata {
  const initialState = options.initialState;
  return {
    owner: options.owner,
    storageScope: options.sessionOptions.scope,
    events: createBrowserViewTargetEvents(),
    presentation: options.presentation,
    permissions: initialState?.permissions ?? { origins: {} },
    browserZoomIndex: normalizeBrowserZoomIndex(initialState?.browserZoomIndex),
    device: initialState?.device,
    isElementSelectionActive: initialState?.isElementSelectionActive ?? false,
    isAreaSelectionActive: initialState?.isAreaSelectionActive ?? false,
    visible: false,
    bounds: undefined,
    lastScreenshot: initialState?.lastScreenshot,
    consoleLogs: [],
  };
}

function getBrowserViewTargetMetadata(targetId: string) {
  const metadata = browserViewTargetMetadata.get(targetId);
  if (!metadata) {
    throw new Error(`Browser view '${targetId}' does not exist.`);
  }
  return metadata;
}

function disposeBrowserViewTargetMetadata(targetId: string) {
  const metadata = browserViewTargetMetadata.get(targetId);
  if (!metadata) {
    return;
  }

  metadata.events.onDidClose.fire();
  metadata.events.disposables.dispose();
  browserViewTargetMetadata.delete(targetId);
}

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
  statusCode: number | null;
  captureMs: number;
  isLoading: boolean;
	documentReadyState: string;
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
      case 'nature-npj2dmateriacs-research-articles':
        return collectNatureResearchArticlesExtraction('nature-npj2dmateriacs-research-articles');
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
  if (normalizedPathname === '/npj2dmateriacs/research-articles') {
    return collectNatureResearchArticlesExtraction('nature-npj2dmateriacs-research-articles');
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
  __csTimedOut: true;
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
  return isRecord(value) && value.__csTimedOut === true;
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
    throw browserViewError(BrowserViewErrorCode.PreviewNotReady, {
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
            setTimeout(() => resolve({ __csTimedOut: true }), timeoutMs);
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
  disposeBrowserViewTargetMetadata(normalizedTargetId);
  entry.debuggerTransport.dispose();
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

function emitBrowserViewStateChanges(
  targetId: string,
  previousState: WebContentTargetState,
  nextState: WebContentTargetState,
) {
  const metadata = browserViewTargetMetadata.get(targetId);
  if (!metadata) {
    return;
  }

  if (
    previousState.url !== nextState.url ||
    previousState.pageTitle !== nextState.pageTitle ||
    previousState.canGoBack !== nextState.canGoBack ||
    previousState.canGoForward !== nextState.canGoForward
  ) {
    metadata.events.onDidNavigate.fire({
      url: nextState.url,
      title: nextState.pageTitle ?? '',
      canGoBack: nextState.canGoBack,
      canGoForward: nextState.canGoForward,
      certificateError: undefined,
    });
  }
  if (previousState.isLoading !== nextState.isLoading) {
    metadata.events.onDidChangeLoadingState.fire({
      loading: nextState.isLoading,
    });
  }
  if (previousState.pageTitle !== nextState.pageTitle) {
    metadata.events.onDidChangeTitle.fire({
      title: nextState.pageTitle ?? '',
    });
  }
  if (previousState.faviconUrl !== nextState.faviconUrl) {
    metadata.events.onDidChangeFavicon.fire({
      favicon: nextState.faviconUrl || undefined,
    });
  }
}

function createWebContentTarget(
  targetId: string,
  context: BrowserViewMainContext = createBrowserViewContext(
    targetId,
    BrowserViewStorageScope.Global,
  ),
) {
  const window = getWebContentOwnerWindow();
  const view = new WebContentsView({
    webPreferences: {
      session: context.session,
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

  const metadata = browserViewTargetMetadata.get(targetId);

  const entry: ManagedWebContentTarget = {
    cleanup: [],
    context,
    debuggerTransport: new BrowserViewDebugger(view.webContents),
    metadataMachine: createDefaultTargetMetadataMachine(),
    onDidClose: metadata?.events.onDidClose.event,
    owner: metadata?.owner,
    state: createDefaultWebContentTargetState(),
    statusCode: null,
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

  addWebContentTargetListener(entry, 'did-start-navigation', (
    _event,
    _url,
    _isInPlace,
    isMainFrame,
  ) => {
    if (isMainFrame === true) {
      entry.statusCode = null;
    }
  });
  addWebContentTargetListener(entry, 'did-navigate', (
    _event,
    _url,
    httpResponseCode,
  ) => {
    const responseCode = Number(httpResponseCode);
    entry.statusCode = Number.isFinite(responseCode) && responseCode > 0
      ? responseCode
      : null;
  });

  addWebContentTargetListener(entry, 'focus', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeFocus.fire({ focused: true });
  });
  addWebContentTargetListener(entry, 'blur', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeFocus.fire({ focused: false });
  });
  addWebContentTargetListener(entry, 'devtools-opened', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeDevToolsState.fire({
      isDevToolsOpen: true,
    });
  });
  addWebContentTargetListener(entry, 'devtools-closed', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeDevToolsState.fire({
      isDevToolsOpen: false,
    });
  });
  addWebContentTargetListener(entry, 'found-in-page', (_event, result) => {
    if (!isRecord(result)) {
      return;
    }
    const selectionArea = isRecord(result.selectionArea)
      ? {
          x: Number(result.selectionArea.x) || 0,
          y: Number(result.selectionArea.y) || 0,
          width: Number(result.selectionArea.width) || 0,
          height: Number(result.selectionArea.height) || 0,
        }
      : undefined;
    browserViewTargetMetadata.get(targetId)?.events.onDidFindInPage.fire({
      activeMatchOrdinal: Number(result.activeMatchOrdinal) || 0,
      matches: Number(result.matches) || 0,
      selectionArea,
      finalUpdate: result.finalUpdate === true,
    });
  });
  addWebContentTargetListener(entry, 'before-input-event', (_event, input) => {
    if (!isRecord(input) || input.type !== 'keyDown') {
      return;
    }
    browserViewTargetMetadata.get(targetId)?.events.onDidKeyCommand.fire({
      key: String(input.key ?? ''),
      keyCode: 0,
      code: String(input.code ?? ''),
      ctrlKey: input.control === true,
      shiftKey: input.shift === true,
      altKey: input.alt === true,
      metaKey: input.meta === true,
      repeat: input.isAutoRepeat === true,
    });
  });
  addWebContentTargetListener(entry, 'console-message', (...args) => {
    const metadata = browserViewTargetMetadata.get(targetId);
    if (!metadata) {
      return;
    }
    const message = args
      .map(value => String(value ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (!message) {
      return;
    }
    metadata.consoleLogs.push(message);
    if (metadata.consoleLogs.length > 200) {
      metadata.consoleLogs.splice(0, metadata.consoleLogs.length - 200);
    }
  });

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
    entry.debuggerTransport.dispose();
    webContentTargets.delete(targetId);
    retainedWebContentTargets.delete(targetId);
    disposeBrowserViewTargetMetadata(targetId);
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

function ensureWebContentTarget(
  targetId?: string | null,
  context?: BrowserViewMainContext,
) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const existingEntry = webContentTargets.get(normalizedTargetId);
  if (existingEntry && !existingEntry.view.webContents.isDestroyed()) {
    return existingEntry;
  }

  if (existingEntry) {
    webContentTargets.delete(normalizedTargetId);
  }

  return createWebContentTarget(normalizedTargetId, context);
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

  const previousState = entry.state;
  const nextState = readWebContentTargetState(entry);
  entry.state = nextState;
  emitBrowserViewStateChanges(normalizedTargetId, previousState, nextState);
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
    const metadata = browserViewTargetMetadata.get(targetId);
    if (metadata && metadata.visible !== shouldShowTarget) {
      metadata.visible = shouldShowTarget;
      metadata.events.onDidChangeVisibility.fire({ visible: shouldShowTarget });
    }
    if (shouldShowTarget) {
      entry.view.setBounds(visibleBounds);
      entry.view.setVisible(true);
      continue;
    }

    if (entry.view.webContents.isFocused()) {
      webContentWindow?.webContents.focus();
    }
    entry.view.setVisible(false);
    entry.view.setBounds(
      metadata?.presentation === 'background'
        ? BACKGROUND_WEB_CONTENT_BOUNDS
        : HIDDEN_WEB_CONTENT_BOUNDS,
    );
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

export async function captureWebContentScreenshot(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const entry = webContentTargets.get(normalizedTargetId);
  if (!entry || entry.view.webContents.isDestroyed()) {
    return null;
  }

  const image = await entry.view.webContents.capturePage();
  if (image.isEmpty()) {
    return null;
  }

  return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
}

export async function getWebContentDocumentSnapshot(
	targetId: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<WebContentDocumentSnapshot | null> {
  const startedAt = Date.now();

  try {
    const snapshot = await executeWebContentScriptForTarget<{
		url?: unknown;
		html?: unknown;
		documentReadyState?: unknown;
	}>(
		targetId,
      `(() => {
        try {
          return {
			url: location.href,
			html: document.documentElement ? document.documentElement.outerHTML : '',
			documentReadyState: document.readyState,
		  };
        } catch {
		  return null;
        }
      })()`,
      options,
    );

    if (snapshot === webContentDocumentSnapshotTimedOut || !isRecord(snapshot)) {
      return null;
    }

	const url = typeof snapshot.url === 'string' ? snapshot.url.trim() : '';
	const html = typeof snapshot.html === 'string' ? snapshot.html : '';
	const documentReadyState = typeof snapshot.documentReadyState === 'string'
		? snapshot.documentReadyState
		: '';
    if (typeof html !== 'string' || !html.trim()) {
      return null;
    }

    return {
		  url,
	      html,
	      statusCode: webContentTargets.get(normalizeWebContentTargetId(targetId))?.statusCode ?? null,
      captureMs: Date.now() - startedAt,
	  isLoading: documentReadyState !== 'complete',
	  documentReadyState,
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

export async function getWebContentDocumentHtml(targetId: string) {
  const snapshot = await getWebContentDocumentSnapshot(targetId);
  return snapshot?.html ?? null;
}

export async function getWebContentListingCandidateSnapshot(
	targetId: string,
  options: WebContentListingCandidateSnapshotOptions = {},
): Promise<WebContentListingCandidateSnapshot | null> {
  const startedAt = Date.now();

  try {
    const result = await executeWebContentScriptForTarget<{
      webContentUrl?: unknown;
      extractorId?: unknown;
      extraction?: {
        candidates?: unknown;
        diagnostics?: unknown;
      };
      nextPageUrl?: unknown;
    }>(targetId, createWebContentListingCandidateExtractionScript(options.preferredExtractorId), options);

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
	  isLoading: getWebContentState(targetId).isLoading,
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
  syncWebContentTargetState(normalizedTargetId);

  try {
    if (!resolvedUrl) {
      return getWebContentState(normalizedTargetId);
    }

    const initialUrl = normalizeComparableWebContentUrl(getWebContentState(normalizedTargetId).url);
    const normalizedTargetUrl = normalizeComparableWebContentUrl(resolvedUrl);
    if (normalizedTargetUrl === 'about:blank') {
      if (normalizeComparableWebContentUrl(entry.view.webContents.getURL()) !== 'about:blank') {
        try {
          await entry.view.webContents.loadURL('about:blank');
        } catch (error) {
          if (!isAbortLikeWebContentNavigationError(error)) {
            throw error;
          }
        }
      }
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
    throw browserViewError(BrowserViewErrorCode.PreviewNotReady, {
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

  throw browserViewError(BrowserViewErrorCode.PreviewNotReady, {
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
    throw browserViewError(BrowserViewErrorCode.PreviewNotReady, {
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

function getBrowserViewTargetEntry(targetId: string) {
  getBrowserViewTargetMetadata(targetId);
  const entry = webContentTargets.get(targetId);
  if (!entry || entry.view.webContents.isDestroyed()) {
    throw new Error(`Browser view '${targetId}' is unavailable.`);
  }
  return entry;
}

function isBrowserViewMainTarget(
  entry: ManagedWebContentTarget,
): entry is ManagedWebContentTarget & BrowserViewMainTarget {
  return entry.owner !== undefined && entry.onDidClose !== undefined;
}

function toBrowserViewState(targetId: string): IBrowserViewState {
  const metadata = getBrowserViewTargetMetadata(targetId);
  const entry = getBrowserViewTargetEntry(targetId);
  syncWebContentTargetState(targetId);
  return {
    url: entry.state.url,
    title: entry.state.pageTitle ?? '',
    canGoBack: entry.state.canGoBack,
    canGoForward: entry.state.canGoForward,
    loading: entry.state.isLoading,
    focused: entry.view.webContents.isFocused(),
    visible: metadata.visible,
    isDevToolsOpen: entry.view.webContents.isDevToolsOpened(),
    lastScreenshot: metadata.lastScreenshot,
    lastFavicon: entry.state.faviconUrl || undefined,
    lastError: undefined,
    certificateError: undefined,
    storageScope: metadata.storageScope,
    storageKeys: {},
    permissions: metadata.permissions,
    browserZoomIndex: metadata.browserZoomIndex,
    isElementSelectionActive: metadata.isElementSelectionActive,
    isRemoteSession: false,
    isAreaSelectionActive: metadata.isAreaSelectionActive,
    device: metadata.device,
  };
}

function normalizeBrowserZoomIndex(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return browserZoomDefaultIndex;
  }
  return Math.max(0, Math.min(Math.trunc(value ?? browserZoomDefaultIndex), browserZoomFactors.length - 1));
}

export class BrowserViewMainService implements IBrowserViewService {
  readonly onDidCreateBrowserView = browserViewCreatedEmitter.event;

  onDynamicDidNavigate(id: string): Event<IBrowserViewNavigationEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidNavigate.event;
  }

  onDynamicDidChangeLoadingState(id: string): Event<IBrowserViewLoadingEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeLoadingState.event;
  }

  onDynamicDidChangeFocus(id: string): Event<IBrowserViewFocusEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeFocus.event;
  }

  onDynamicDidChangeVisibility(id: string): Event<IBrowserViewVisibilityEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeVisibility.event;
  }

  onDynamicDidChangeDevToolsState(id: string): Event<IBrowserViewDevToolsStateEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeDevToolsState.event;
  }

  onDynamicDidKeyCommand(id: string): Event<IBrowserViewKeyDownEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidKeyCommand.event;
  }

  onDynamicDidChangeTitle(id: string): Event<IBrowserViewTitleChangeEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeTitle.event;
  }

  onDynamicDidChangeFavicon(id: string): Event<IBrowserViewFaviconChangeEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeFavicon.event;
  }

  onDynamicDidFindInPage(id: string): Event<IBrowserViewFindInPageResult> {
    return getBrowserViewTargetMetadata(id).events.onDidFindInPage.event;
  }

  onDynamicDidClose(id: string): Event<void> {
    return getBrowserViewTargetMetadata(id).events.onDidClose.event;
  }

  onDynamicDidSelectElement(id: string): Event<IElementData> {
    return getBrowserViewTargetMetadata(id).events.onDidSelectElement.event;
  }

  onDynamicDidChangeElementSelectionActive(id: string): Event<boolean> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeElementSelectionActive.event;
  }

  onDynamicDidPickArea(id: string): Event<IBrowserViewRect | undefined> {
    return getBrowserViewTargetMetadata(id).events.onDidPickArea.event;
  }

  onDynamicDidChangeAreaSelectionActive(id: string): Event<boolean> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeAreaSelectionActive.event;
  }

  onDynamicDidChangeDeviceEmulation(id: string): Event<IBrowserDeviceProfile | undefined> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeDeviceEmulation.event;
  }

  onDynamicDidChangeRemoteStatus(id: string): Event<boolean> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeRemoteStatus.event;
  }

  onDynamicDidRequestPermission(id: string): Event<IBrowserViewPermissionRequestEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidRequestPermission.event;
  }

  onDynamicDidChangePermissions(id: string): Event<ISerializedBrowserPermissionsSnapshot> {
    return getBrowserViewTargetMetadata(id).events.onDidChangePermissions.event;
  }

  async getBrowserViews(windowId?: number): Promise<IBrowserViewInfo[]> {
    const result: IBrowserViewInfo[] = [];
    for (const [id, metadata] of browserViewTargetMetadata) {
      if (metadata.presentation !== 'editor') {
        continue;
      }
      if (windowId !== undefined && metadata.owner.mainWindowId !== windowId) {
        continue;
      }
      result.push({ id, owner: metadata.owner, state: toBrowserViewState(id) });
    }
    return result;
  }

  async getOrCreateBrowserView(
    id: string,
    options: IBrowserViewCreateOptions,
  ): Promise<IBrowserViewState> {
    const existingMetadata = browserViewTargetMetadata.get(id);
    if (existingMetadata) {
      if (
        options.presentation === 'editor' &&
        existingMetadata.presentation !== 'editor'
      ) {
        existingMetadata.presentation = 'editor';
        applyWebContentLayout();
      }
      return toBrowserViewState(id);
    }

    const initialState = options.initialState;
    const metadata = createBrowserViewTargetMetadata(options);
    browserViewTargetMetadata.set(id, metadata);

    try {
      const entry = ensureWebContentTarget(
        id,
        createBrowserViewContext(id, options.sessionOptions.scope),
      );
      if (initialState?.title) {
        entry.state.pageTitle = initialState.title;
      }
      if (initialState?.lastFavicon) {
        entry.state.faviconUrl = initialState.lastFavicon;
      }
      entry.view.webContents.setZoomFactor(browserZoomFactors[metadata.browserZoomIndex]);
      if (metadata.device) {
        await this.setDeviceEmulation(id, metadata.device);
      }
		if (initialState?.url) {
			void navigateWebContentTarget(initialState.url, id, 'browser').catch(error => {
				console.warn('[browser-view] initial navigation failed', describeWebContentError(error));
			});
		}
		return {
			...toBrowserViewState(id),
			...initialState,
		};
    } catch (error) {
      disposeWebContentTargetEntry(id);
      throw error;
    }
  }

  tryGetTarget(id: string): BrowserViewMainTarget | undefined {
    const entry = webContentTargets.get(id);
    if (
      !entry ||
      entry.view.webContents.isDestroyed() ||
      !browserViewTargetMetadata.has(id) ||
      !isBrowserViewMainTarget(entry)
    ) {
      return undefined;
    }
    return entry;
  }

  getTargetPresentation(id: string): BrowserViewTargetPresentation | undefined {
    return browserViewTargetMetadata.get(id)?.presentation;
  }

  async createTarget(
    url: string,
    owner: IBrowserViewOwner,
    context: BrowserViewMainContext,
  ): Promise<BrowserViewMainTarget> {
    const id = generateUuid();
    const options: IBrowserViewCreateOptions = {
      owner,
      sessionOptions: { scope: context.storageScope },
      presentation: 'editor',
      initialState: { url },
    };
    const metadata = createBrowserViewTargetMetadata(options);
    browserViewTargetMetadata.set(id, metadata);

    try {
      const entry = createWebContentTarget(id, context);
      if (!isBrowserViewMainTarget(entry)) {
        throw new Error(`Browser view '${id}' has no CDP target metadata.`);
      }
      if (url) {
        void navigateWebContentTarget(url, id, 'browser').catch(error => {
          console.warn('[browser-view] CDP target navigation failed', describeWebContentError(error));
        });
      }

      const state = toBrowserViewState(id);
      browserViewCreatedEmitter.fire({
        info: {
          id,
          owner,
          state: url ? { ...state, url } : state,
        },
        openOptions: { preserveFocus: true },
      });
      return entry;
    } catch (error) {
      disposeWebContentTargetEntry(id);
      throw error;
    }
  }

  async activateTarget(id: string): Promise<void> {
    getBrowserViewTargetEntry(id);
    activateWebContentTarget(id);
  }

  async destroyBrowserView(id: string): Promise<void> {
    disposeWebContentTargetEntry(id);
  }

  async getState(id: string): Promise<IBrowserViewState> {
    return toBrowserViewState(id);
  }

  async layout(id: string, bounds: IBrowserViewBounds): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    getBrowserViewTargetEntry(id);
    metadata.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    if (activeWebContentTargetId === id) {
      setWebContentBounds(metadata.bounds);
    }
  }

  async setVisible(id: string, visible: boolean): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    getBrowserViewTargetEntry(id);
    if (visible) {
      activeWebContentTargetId = id;
      webContentBounds = metadata.bounds ?? webContentBounds;
      webContentVisible = true;
      webContentLayoutPhase = 'visible';
      applyWebContentLayout();
      return;
    }

    if (activeWebContentTargetId === id) {
      webContentVisible = false;
      webContentLayoutPhase = 'hidden';
      applyWebContentLayout();
    }
  }

  async loadURL(id: string, url: string): Promise<void> {
    getBrowserViewTargetMetadata(id);
    await navigateWebContentTarget(url, id, 'browser');
  }

  async getURL(id: string): Promise<string> {
    return toBrowserViewState(id).url;
  }

  async goBack(id: string): Promise<void> {
    getBrowserViewTargetMetadata(id);
    goBackWebContent(id);
  }

  async goForward(id: string): Promise<void> {
    getBrowserViewTargetMetadata(id);
    goForwardWebContent(id);
  }

  async reload(id: string, hard?: boolean): Promise<void> {
    getBrowserViewTargetMetadata(id);
    if (hard) {
      hardReloadWebContent(id);
      return;
    }
    reloadWebContent(id);
  }

  async toggleDevTools(id: string): Promise<void> {
    const webContents = getBrowserViewTargetEntry(id).view.webContents;
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
      return;
    }
    webContents.openDevTools({ mode: 'detach' });
  }

  async canGoBack(id: string): Promise<boolean> {
    return toBrowserViewState(id).canGoBack;
  }

  async canGoForward(id: string): Promise<boolean> {
    return toBrowserViewState(id).canGoForward;
  }

  async captureScreenshot(
    id: string,
    options: IBrowserViewCaptureScreenshotOptions = {},
  ): Promise<VSBuffer> {
    const metadata = getBrowserViewTargetMetadata(id);
    const webContents = getBrowserViewTargetEntry(id).view.webContents;
    const captureRect = options.screenRect ?? options.pageRect;
    const image = await webContents.capturePage(captureRect ? {
      x: Math.round(captureRect.x),
      y: Math.round(captureRect.y),
      width: Math.max(1, Math.round(captureRect.width)),
      height: Math.max(1, Math.round(captureRect.height)),
    } : undefined);
    const bytes = options.format === 'png'
      ? image.toPNG()
      : image.toJPEG(Math.max(0, Math.min(100, Math.round(options.quality ?? 80))));
    const screenshot = VSBuffer.wrap(bytes);
    metadata.lastScreenshot = screenshot;
    return screenshot;
  }

  async focus(id: string, force?: boolean): Promise<void> {
    const entry = getBrowserViewTargetEntry(id);
    if (force) {
      webContentWindow?.focus();
    }
    entry.view.webContents.focus();
  }

  async findInPage(
    id: string,
    text: string,
    options: IBrowserViewFindInPageOptions = {},
  ): Promise<void> {
    getBrowserViewTargetEntry(id).view.webContents.findInPage(text, {
      forward: options.forward,
      findNext: options.recompute !== true,
      matchCase: options.matchCase,
    });
  }

  async stopFindInPage(id: string, keepSelection?: boolean): Promise<void> {
    getBrowserViewTargetEntry(id).view.webContents.stopFindInPage(
      keepSelection ? 'keepSelection' : 'clearSelection',
    );
  }

  async getSelectedText(id: string): Promise<string> {
    return (await getWebContentSelection(id))?.text ?? '';
  }

  async clearGlobalStorage(): Promise<void> {
    await session.fromPartition(WORKBENCH_SHARED_WEB_PARTITION).clearStorageData();
  }

  async clearWorkspaceStorage(_workspaceId: string): Promise<void> {
    throw new Error('Workspace-scoped browser storage is not supported.');
  }

  async clearStorage(id: string): Promise<void> {
    await getBrowserViewTargetEntry(id).view.webContents.session.clearStorageData();
  }

  async setBrowserZoomIndex(id: string, zoomIndex: number): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    metadata.browserZoomIndex = normalizeBrowserZoomIndex(zoomIndex);
    getBrowserViewTargetEntry(id).view.webContents.setZoomFactor(
      browserZoomFactors[metadata.browserZoomIndex],
    );
  }

  async setDeviceEmulation(
    id: string,
    device: IBrowserDeviceProfile | undefined,
  ): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    const webContents = getBrowserViewTargetEntry(id).view.webContents;
    metadata.device = device;
    if (!device) {
      webContents.disableDeviceEmulation();
      webContents.setUserAgent(webContents.session.getUserAgent());
      metadata.events.onDidChangeDeviceEmulation.fire(undefined);
      return;
    }

    const width = Math.max(1, Math.round(device.width ?? 1024));
    const height = Math.max(1, Math.round(device.height ?? 768));
    webContents.enableDeviceEmulation({
      screenPosition: device.mobile ? 'mobile' : 'desktop',
      screenSize: { width, height },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: Math.max(0, device.deviceScaleFactor ?? 1),
      viewSize: { width, height },
      scale: 1,
    });
    if (device.userAgent) {
      webContents.setUserAgent(device.userAgent);
    }
    metadata.events.onDidChangeDeviceEmulation.fire(device);
  }

  async trustCertificate(_id: string, _host: string, _fingerprint: string): Promise<void> {
    throw new Error('Integrated browser certificate exceptions are not supported.');
  }

  async untrustCertificate(_id: string, _host: string, _fingerprint: string): Promise<void> {
    throw new Error('Integrated browser certificate exceptions are not supported.');
  }

  async deleteBrowserHistory(id: string, _entryIds?: readonly number[]): Promise<void> {
    clearWebContentHistory(id);
  }

  async setPermissions(
    id: string,
    origin: string,
    grants: readonly IPermissionCategoryState[],
  ): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    const nextOrigin = { ...(metadata.permissions.origins[origin] ?? {}) };
    for (const grant of grants) {
      if (grant.state === null) {
        delete nextOrigin[grant.category];
      } else {
        nextOrigin[grant.category] = grant.state;
      }
    }
    metadata.permissions = {
      origins: {
        ...metadata.permissions.origins,
        [origin]: nextOrigin,
      },
    };
    metadata.events.onDidChangePermissions.fire(metadata.permissions);
  }

  async selectDevice(_id: string, _requestId: string, _deviceId: string | null): Promise<void> {
    throw new Error('Integrated browser device selection is not active.');
  }

  async getConsoleLogs(id: string): Promise<string> {
    return getBrowserViewTargetMetadata(id).consoleLogs.join('\n');
  }

  async toggleElementSelection(_id: string, _enabled?: boolean): Promise<void> {
    throw new Error('Integrated browser element selection is not active.');
  }

  async toggleAreaSelection(_id: string, _enabled?: boolean): Promise<void> {
    throw new Error('Integrated browser area selection is not active.');
  }

  async updateWindowConfiguration(
    windowId: number,
    config: IBrowserViewWindowConfiguration,
  ): Promise<void> {
    browserViewWindowConfigurations.set(windowId, config);
    if (typeof config.maxHistoryEntries === 'number') {
      setWebContentRetentionLimit(config.maxHistoryEntries);
    }
  }

  dispose(): void {
    for (const id of [...browserViewTargetMetadata.keys()]) {
      disposeWebContentTargetEntry(id);
    }
    browserViewWindowConfigurations.clear();
    browserViewCreatedEmitter.dispose();
  }
}
