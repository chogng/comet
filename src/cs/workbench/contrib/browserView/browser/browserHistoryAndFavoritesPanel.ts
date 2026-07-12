/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMouseContextMenuAnchor } from 'cs/base/browser/contextmenu';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon, createLxLoadingIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { createContextMenuService } from 'app/cs/workbench/services/contextmenu/electron-browser/contextmenuService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { $ } from 'cs/base/browser/dom';
import { toAction } from 'cs/base/common/actions';
import type { Event } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';

const BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS = 'comet-is-desktop-overlay';
const NATIVE_WEBCONTENT_ACTIVE_SELECTOR =
  '.comet-browser-frame-placeholder[data-webcontent-active="true"]';

type BrowserHistoryAndFavoritesSectionKind = 'recent' | 'favorites';
type BrowserHistoryAndFavoritesRecentBucket = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';

export interface BrowserHistoryPanelEntry {
  readonly id: number;
  readonly url: string;
  readonly time: number;
  readonly title: string;
}

export interface BrowserHistoryPanelFeature {
  readonly onDidChange: Event<void>;
  readonly entries: readonly BrowserHistoryPanelEntry[];
  getFavicon(entry: BrowserHistoryPanelEntry): string;
  removeEntry(entryId: number): boolean;
  clear(): void;
}

export interface BrowserFavoritesPanelFeature {
  readonly onDidChange: Event<void>;
  readonly favorites: readonly string[];
  isFavorite(url: string): boolean;
  toggle(url: string): void;
  remove(url: string): void;
}

export interface BrowserHistoryAndFavoritesPanelFeatures {
  readonly history: BrowserHistoryPanelFeature;
  readonly favorites: BrowserFavoritesPanelFeature;
}

type BrowserHistoryAndFavoritesListItem = {
  readonly historyEntryId?: number;
  readonly url: string;
  readonly title: string;
  readonly faviconUrl: string;
  readonly sectionKind: BrowserHistoryAndFavoritesSectionKind;
  readonly recentVisitedAt: number;
};

export type BrowserHistoryAndFavoritesPanelLabels = {
  title: string;
  recentTitle: string;
  recentTodayTitle: string;
  recentYesterdayTitle: string;
  recentLast7DaysTitle: string;
  recentLast30DaysTitle: string;
  recentOlderTitle: string;
  favoritesTitle: string;
  emptyState: string;
  contextOpen?: string;
  contextOpenInNewTab?: string;
  contextRemoveFavorite?: string;
  deleteHistoryEntry?: string;
};

export type BrowserHistoryAndFavoritesPanelContext = {
  browserUrl: string;
  browserIsLoading?: boolean;
  labels: BrowserHistoryAndFavoritesPanelLabels;
  onNavigateToUrl: (url: string) => void;
};

type BrowserHistoryAndFavoritesPanelOptions = {
  isInteractionWithin?: (target: Node) => boolean;
  onDidChangeOpenState?: (isOpen: boolean) => void;
};

function sanitizeBrowserHistoryAndFavoritesPageTitle(value: unknown) {
  const title = String(value ?? '').trim();
  return title && !/^about:blank$/i.test(title) ? title : '';
}

function sanitizeBrowserHistoryAndFavoritesFaviconUrl(value: unknown) {
  return String(value ?? '').trim();
}

function toTrackableBrowserHistoryAndFavoritesUrl(url: string) {
  const normalizedUrl = String(url).trim();
  return normalizedUrl && normalizedUrl !== 'about:blank' ? normalizedUrl : '';
}

function resolveRecentBrowserHistoryAndFavoritesBucket(
  visitedAt: number,
  now: Date = new Date(),
): BrowserHistoryAndFavoritesRecentBucket {
  if (!Number.isFinite(visitedAt) || visitedAt <= 0) {
    return 'older';
  }

const visitedAtDate = new Date(visitedAt);
  if (Number.isNaN(visitedAtDate.getTime())) {
    return 'older';
  }

const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const visitedDayStart = new Date(
    visitedAtDate.getFullYear(),
    visitedAtDate.getMonth(),
    visitedAtDate.getDate(),
  );
  const DAY_MS = 24 * 60 * 60 * 1000;
  const diffInDays = Math.floor(
    (todayStart.getTime() - visitedDayStart.getTime()) / DAY_MS,
  );

  if (diffInDays <= 0) {
    return 'today';
  }
  if (diffInDays === 1) {
    return 'yesterday';
  }
  if (diffInDays <= 6) {
    return 'last7Days';
  }
  if (diffInDays <= 29) {
    return 'last30Days';
  }
  return 'older';
}

function resolveBrowserHistoryAndFavoritesTitle(url: string) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    const search = parsed.search || '';
    const hash = parsed.hash || '';
    const suffix = `${pathname}${search}${hash}`;
    return suffix ? `${parsed.hostname}${suffix}` : parsed.hostname;
  } catch {
    return url;
  }
}

function normalizeSearchQuery(query: string) {
  return String(query).trim().toLowerCase();
}

export class BrowserHistoryAndFavoritesPanel {
  private context: BrowserHistoryAndFavoritesPanelContext;
  private isInteractionWithin?: (target: Node) => boolean;
  private onDidChangeOpenState?: (isOpen: boolean) => void;
  private onDidChangeState?: () => void;
  private readonly contextMenuService = createContextMenuService();
  private readonly featureListeners = new DisposableStore();
  private features: BrowserHistoryAndFavoritesPanelFeatures | undefined;
  private readonly backdropElement = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-panel-backdrop');
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-panel');
  private readonly desktopOverlayContainer = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-panel-overlay');
  private readonly headerElement = $<HTMLElementTagNameMap['header']>('header.comet-browser-history-and-favorites-header');
  private readonly searchInputHost = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-search-host');
  private readonly bodyElement = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-body');
  private listElement: HTMLElement | null = null;
  private emptyStateElement: HTMLElement | null = null;
  private readonly searchInput: InputBox;
  private readonly panelId = `browser-history-and-favorites-panel-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  private isOpen = false;
  private searchQuery = '';
  private isGlobalListenersBound = false;
  private hostElement: HTMLElement | null = null;
  private overlayPositionFrame = 0;

  constructor(
    context: BrowserHistoryAndFavoritesPanelContext,
		options: BrowserHistoryAndFavoritesPanelOptions,
		@IEditorService private readonly editorService: IEditorService,
  ) {
    this.context = context;
		this.isInteractionWithin = options.isInteractionWithin;
		this.onDidChangeOpenState = options.onDidChangeOpenState;
    this.searchInput = new InputBox(this.searchInputHost, undefined, {
      className: 'comet-browser-history-and-favorites-search-input',
      type: 'text',
      value: '',
      placeholder: 'Search',
      ariaLabel: '',
    });
    this.searchInput.onDidChange(this.handleSearchInputChange);
    this.backdropElement.setAttribute('aria-hidden', 'true');
    this.element.id = this.panelId;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.setAttribute('aria-label', this.context.labels.title);
    this.headerElement.append(this.searchInputHost);
    this.element.append(this.headerElement, this.bodyElement);
    this.render();
  }

  setFeatures(features: BrowserHistoryAndFavoritesPanelFeatures | undefined) {
    if (this.features === features) {
      return;
    }
    this.featureListeners.clear();
    this.features = features;
    if (features) {
      this.featureListeners.add(features.history.onDidChange(() => this.handleFeatureChange()));
      this.featureListeners.add(features.favorites.onDidChange(() => this.handleFeatureChange()));
    }
    this.render();
    this.onDidChangeState?.();
  }

  getElement() {
    return this.element;
  }

  mountTo(hostElement: HTMLElement | null) {
    if (this.hostElement === hostElement) {
      this.mountElementToHost();
      return;
    }

    this.hostElement = hostElement;
    this.mountElementToHost();
  }

  setInteractionBoundaryResolver(
    resolver: ((target: Node) => boolean) | undefined,
  ) {
    this.isInteractionWithin = resolver;
  }

  setOnDidChangeOpenState(listener: ((isOpen: boolean) => void) | undefined) {
    this.onDidChangeOpenState = listener;
  }

  setOnDidChangeState(listener: (() => void) | undefined) {
    this.onDidChangeState = listener;
  }

  getPanelId() {
    return this.panelId;
  }

  getToggleButtonAttributes() {
    return {
      'aria-haspopup': 'dialog',
      'aria-expanded': String(this.isOpen),
      'aria-controls': this.panelId,
    };
  }

  getIsOpen() {
    return this.isOpen;
  }

  setContext(context: BrowserHistoryAndFavoritesPanelContext) {
    this.context = context;
    this.render();
  }

  setOpen(isOpen: boolean) {
    if (this.isOpen === isOpen) {
      return;
    }

    this.isOpen = isOpen;
    if (isOpen) {
      this.bindGlobalListeners();
      queueMicrotask(() => {
        if (!this.isOpen) {
          return;
        }
        this.searchInput.focus();
      });
    } else {
      this.contextMenuService.hideContextMenu();
      this.unbindGlobalListeners();
      this.resetSearchQuery();
    }
    this.render();
    this.onDidChangeOpenState?.(this.isOpen);
  }

  toggleOpen() {
    this.setOpen(!this.isOpen);
  }

  close() {
    this.setOpen(false);
  }

  canToggleCurrentBrowserUrlFavorite() {
    return Boolean(this.features && this.context.browserUrl && this.context.browserUrl !== 'about:blank');
  }

  isCurrentBrowserUrlFavorited() {
    return this.isBrowserUrlFavorited(this.context.browserUrl);
  }

  isBrowserUrlFavorited(url: string) {
    return this.features?.favorites.isFavorite(url) ?? false;
  }

  toggleCurrentBrowserUrlFavorite() {
    if (!this.features || !this.canToggleCurrentBrowserUrlFavorite()) {
      return false;
    }

    this.features.favorites.toggle(this.context.browserUrl);
    return true;
  }

  clearRecentEntries() {
    if (!this.features) {
      return false;
    }
    this.features.history.clear();
    return true;
  }

  dispose() {
    this.contextMenuService.dispose();
    this.featureListeners.dispose();
    this.unbindGlobalListeners();
    this.stopOverlayPositionSync();
    this.clearDesktopOverlayPosition();
    this.removeDesktopOverlayContainer();
    this.backdropElement.remove();
    this.element.classList.remove(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS);
    this.hostElement = null;
    this.searchInput.dispose();
    this.element.remove();
    this.element.replaceChildren();
  }

  private handleFeatureChange() {
    this.render();
    this.onDidChangeState?.();
  }

  private bindGlobalListeners() {
    if (this.isGlobalListenersBound || typeof document === 'undefined') {
      return;
    }

    document.addEventListener('pointerdown', this.handleGlobalPointerDown, true);
    document.addEventListener('keydown', this.handleGlobalKeyDown, true);
    this.isGlobalListenersBound = true;
  }

  private unbindGlobalListeners() {
    if (!this.isGlobalListenersBound || typeof document === 'undefined') {
      return;
    }

    document.removeEventListener('pointerdown', this.handleGlobalPointerDown, true);
    document.removeEventListener('keydown', this.handleGlobalKeyDown, true);
    this.isGlobalListenersBound = false;
  }

  private readonly handleGlobalPointerDown = (event: PointerEvent) => {
    if (!this.isOpen) {
      return;
    }

    if (!this.element.isConnected) {
      this.setOpen(false);
      return;
    }

    if (!(event.target instanceof Node)) {
      return;
    }

    if (this.element.contains(event.target)) {
      return;
    }

    if (this.isInteractionWithin?.(event.target)) {
      return;
    }

    this.setOpen(false);
  };

  private readonly handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (!this.isOpen || event.key !== 'Escape') {
      return;
    }

    event.stopPropagation();
    this.setOpen(false);
  };

  private readonly handleEntryClick = (url: string) => {
    this.context.onNavigateToUrl(url);
    this.setOpen(false);
  };

  private readonly handleEntryDelete = (entryId: number) => {
    const changed = this.features?.history.removeEntry(entryId) ?? false;
    if (!changed) {
      return;
    }

    this.renderEntries();
  };

  private readonly handleFavoriteItemOpenInNewTab = (url: string) => {
		void this.editorService.openEditor({
      resource: BrowserViewUri.forId(generateUuid()),
      options: {
        viewState: {
          url,
        },
      },
    });
    this.setOpen(false);
  };

  private readonly handleFavoriteItemRemove = (url: string) => {
    if (!this.features?.favorites.isFavorite(url)) {
      return;
    }

    this.features.favorites.remove(url);
  };

  private readonly handleSearchInputChange = (value: string) => {
    this.searchQuery = value;
    this.renderEntries();
  };

  private getDeleteHistoryEntryLabel() {
    const configuredLabel = String(this.context.labels.deleteHistoryEntry ?? '').trim();
    return configuredLabel || 'Delete history entry';
  }

  private resetSearchQuery() {
    if (!this.searchQuery && this.searchInput.value.length === 0) {
      return;
    }

    this.searchQuery = '';
    this.searchInput.value = '';
  }

  private createEntries(): BrowserHistoryAndFavoritesListItem[] {
    if (!this.features) {
      return [];
    }
    const historyByUrl = new Map<string, BrowserHistoryPanelEntry>();
    for (const entry of this.features.history.entries) {
      historyByUrl.set(entry.url, entry);
    }
    const listItems: BrowserHistoryAndFavoritesListItem[] = [];

    for (const url of this.features.favorites.favorites) {
      const entry = historyByUrl.get(url);
      listItems.push({
        url,
        title: sanitizeBrowserHistoryAndFavoritesPageTitle(entry?.title) || resolveBrowserHistoryAndFavoritesTitle(url),
        faviconUrl: entry ? this.features.history.getFavicon(entry) : '',
        sectionKind: 'favorites',
        recentVisitedAt: 0,
      });
    }

    for (const entry of [...this.features.history.entries].reverse()) {
      listItems.push({
        historyEntryId: entry.id,
        url: entry.url,
        title: sanitizeBrowserHistoryAndFavoritesPageTitle(entry.title) || resolveBrowserHistoryAndFavoritesTitle(entry.url),
        faviconUrl: this.features.history.getFavicon(entry),
        sectionKind: 'recent',
        recentVisitedAt: entry.time,
      });
    }

    return listItems;
  }

  private getFilteredEntries() {
    const normalizedQuery = normalizeSearchQuery(this.searchQuery);
    const listItems = this.createEntries();
    if (!normalizedQuery) {
      return listItems;
    }

    return listItems.filter((item) => {
      const normalizedTitle = normalizeSearchQuery(item.title);
      const normalizedUrl = normalizeSearchQuery(item.url);
      return (
        normalizedTitle.includes(normalizedQuery) ||
        normalizedUrl.includes(normalizedQuery)
      );
    });
  }

  private render() {
    this.mountElementToHost();
    this.backdropElement.classList.toggle('comet-is-open', this.isOpen);
    this.element.classList.toggle('comet-is-open', this.isOpen);
    this.element.setAttribute('aria-hidden', String(!this.isOpen));
    this.element.setAttribute('aria-label', this.context.labels.title);
    this.searchInput.inputElement.setAttribute('aria-label', this.context.labels.title);
    this.searchInput.setPlaceHolder('Search');
    if (this.isOpen) {
      this.startOverlayPositionSync();
    } else {
      this.stopOverlayPositionSync();
    }
    this.renderEntries();
  }

  private mountElementToHost() {
    const hostElement = this.hostElement;
    if (!hostElement) {
      this.stopOverlayPositionSync();
      this.clearDesktopOverlayPosition();
      this.removeDesktopOverlayContainer();
      this.backdropElement.remove();
      this.element.classList.remove(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS);
      this.element.remove();
      return;
    }

const useDesktopOverlay = this.hasActiveNativeWebContent(hostElement);
    const mountAsDesktopOverlay = useDesktopOverlay;
    if (mountAsDesktopOverlay) {
      const overlayContainer = this.getOrCreateDesktopOverlayContainer();
      this.appendPanelSurface(overlayContainer);
      this.element.classList.add(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS);
      this.syncDesktopOverlayPosition();
      return;
    }

    this.removeDesktopOverlayContainer();
    this.appendPanelSurface(hostElement);
    this.element.classList.remove(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS);
    this.stopOverlayPositionSync();
    this.clearDesktopOverlayPosition();
  }

  private appendPanelSurface(target: HTMLElement) {
    target.append(this.backdropElement);
    target.append(this.element);
  }

  private getOrCreateDesktopOverlayContainer() {
    if (typeof document === 'undefined') {
      return this.desktopOverlayContainer;
    }

    if (this.desktopOverlayContainer.parentElement !== document.body) {
      document.body.append(this.desktopOverlayContainer);
    }
    return this.desktopOverlayContainer;
  }

  private removeDesktopOverlayContainer() {
    this.desktopOverlayContainer.remove();
  }

  private hasActiveNativeWebContent(hostElement: HTMLElement) {
    return Boolean(hostElement.querySelector(NATIVE_WEBCONTENT_ACTIVE_SELECTOR));
  }

  private syncDesktopOverlayPosition() {
    if (
      !this.hostElement ||
      !this.element.classList.contains(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS) ||
      this.element.parentElement !== this.desktopOverlayContainer
    ) {
      return;
    }

const hostRect = this.hostElement.getBoundingClientRect();
    this.desktopOverlayContainer.style.left = `${Math.round(hostRect.left)}px`;
    this.desktopOverlayContainer.style.top = `${Math.round(hostRect.top)}px`;
    this.desktopOverlayContainer.style.width = `${Math.max(0, Math.round(hostRect.width))}px`;
    this.desktopOverlayContainer.style.height = `${Math.max(0, Math.round(hostRect.height))}px`;
  }

  private clearDesktopOverlayPosition() {
    this.desktopOverlayContainer.style.removeProperty('left');
    this.desktopOverlayContainer.style.removeProperty('top');
    this.desktopOverlayContainer.style.removeProperty('width');
    this.desktopOverlayContainer.style.removeProperty('height');
    this.element.style.removeProperty('left');
    this.element.style.removeProperty('top');
    this.element.style.removeProperty('height');
  }

  private startOverlayPositionSync() {
    if (
      this.overlayPositionFrame ||
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function' ||
      !this.element.classList.contains(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS)
    ) {
      return;
    }

const schedule = () => {
      this.overlayPositionFrame = window.requestAnimationFrame(() => {
        this.overlayPositionFrame = 0;
        if (
          !this.isOpen ||
          !this.element.classList.contains(BROWSER_HISTORY_AND_FAVORITES_DESKTOP_OVERLAY_CLASS)
        ) {
          return;
        }
        this.syncDesktopOverlayPosition();
        schedule();
      });
    };

    schedule();
  }

  private stopOverlayPositionSync() {
    if (
      !this.overlayPositionFrame ||
      typeof window === 'undefined' ||
      typeof window.cancelAnimationFrame !== 'function'
    ) {
      this.overlayPositionFrame = 0;
      return;
    }

    window.cancelAnimationFrame(this.overlayPositionFrame);
    this.overlayPositionFrame = 0;
  }

  private renderEntries() {
    const listItems = this.getFilteredEntries();
    if (listItems.length === 0) {
      if (this.listElement) {
        this.listElement.remove();
        this.listElement = null;
      }
      this.renderEmptyState(normalizeSearchQuery(this.searchQuery).length > 0);
      return;
    }

    if (this.emptyStateElement) {
      this.emptyStateElement.remove();
      this.emptyStateElement = null;
    }

const listElement = this.getOrCreateListElement();
    const fragment = document.createDocumentFragment();
    const listItemsBySection: Record<BrowserHistoryAndFavoritesSectionKind, BrowserHistoryAndFavoritesListItem[]> = {
      favorites: [],
      recent: [],
    };
    for (const itemState of listItems) {
      listItemsBySection[itemState.sectionKind].push(itemState);
    }

const orderedSections: Array<{
      kind: BrowserHistoryAndFavoritesSectionKind;
      title: string;
    }> = [
      {
        kind: 'favorites',
        title: this.context.labels.favoritesTitle,
      },
    ];

    for (const section of orderedSections) {
      const sectionItems = listItemsBySection[section.kind];
      if (!sectionItems || sectionItems.length === 0) {
        continue;
      }

const sectionElement = $<HTMLElementTagNameMap['section']>('section.comet-browser-history-and-favorites-section');
      const sectionTitleElement = $<HTMLElementTagNameMap['p']>('p.comet-browser-history-and-favorites-section-title', undefined, section.title);
      const sectionListElement = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-section-list');
      sectionElement.append(sectionTitleElement, sectionListElement);

      if (section.kind === 'favorites') {
        this.renderFavoriteSectionItems(sectionListElement, sectionItems);
      } else {
        for (const itemState of sectionItems) {
          sectionListElement.append(this.createEntryRow(itemState));
        }
      }

      fragment.append(sectionElement);
    }

const recentItems = listItemsBySection.recent;
    if (recentItems.length > 0) {
      const recentBuckets = this.groupRecentItemsByBucket(recentItems);
      const recentBucketOrder: BrowserHistoryAndFavoritesRecentBucket[] = [
        'today',
        'yesterday',
        'last7Days',
        'last30Days',
        'older',
      ];

      for (const bucket of recentBucketOrder) {
        const sectionItems = recentBuckets[bucket];
        if (!sectionItems || sectionItems.length === 0) {
          continue;
        }

const sectionElement = $<HTMLElementTagNameMap['section']>('section.comet-browser-history-and-favorites-section');
        const sectionTitleElement = $<HTMLElementTagNameMap['p']>('p.comet-browser-history-and-favorites-section-title', undefined, this.getRecentBucketTitle(bucket));
        const sectionListElement = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-section-list');
        for (const itemState of sectionItems) {
          sectionListElement.append(this.createEntryRow(itemState));
        }
        sectionElement.append(sectionTitleElement, sectionListElement);
        fragment.append(sectionElement);
      }
    }

    listElement.replaceChildren(fragment);
  }

  private groupRecentItemsByBucket(items: readonly BrowserHistoryAndFavoritesListItem[]) {
    const groupedItems: Record<BrowserHistoryAndFavoritesRecentBucket, BrowserHistoryAndFavoritesListItem[]> = {
      today: [],
      yesterday: [],
      last7Days: [],
      last30Days: [],
      older: [],
    };

    for (const item of items) {
      groupedItems[resolveRecentBrowserHistoryAndFavoritesBucket(item.recentVisitedAt)].push(item);
    }

    return groupedItems;
  }

  private getRecentBucketTitle(bucket: BrowserHistoryAndFavoritesRecentBucket) {
    switch (bucket) {
      case 'today':
        return this.context.labels.recentTodayTitle;
      case 'yesterday':
        return this.context.labels.recentYesterdayTitle;
      case 'last7Days':
        return this.context.labels.recentLast7DaysTitle;
      case 'last30Days':
        return this.context.labels.recentLast30DaysTitle;
      case 'older':
        return this.context.labels.recentOlderTitle;
    }
  }

  private createEntryFaviconElement(faviconUrl: string, isLoading = false) {
    if (isLoading) {
      return createLxLoadingIcon(
        'comet-browser-history-and-favorites-item-favicon comet-is-loading',
      );
    }

const normalizedFaviconUrl = sanitizeBrowserHistoryAndFavoritesFaviconUrl(faviconUrl);
    if (!normalizedFaviconUrl) {
      return createLxIcon(
        'browser-1',
        'comet-browser-history-and-favorites-item-favicon comet-is-fallback',
      );
    }

const image = $<HTMLElementTagNameMap['img']>('img.comet-browser-history-and-favorites-item-favicon') as HTMLImageElement;
    image.alt = '';
    image.src = normalizedFaviconUrl;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      if (!image.parentElement) {
        return;
      }

const fallback = createLxIcon(
        'browser-1',
        'comet-browser-history-and-favorites-item-favicon comet-is-fallback',
      );
      image.replaceWith(fallback);
    });
    return image;
  }

  private renderFavoriteSectionItems(
    container: HTMLElement,
    items: readonly BrowserHistoryAndFavoritesListItem[],
  ) {
    for (const itemState of items) {
      container.append(this.createEntryRow(itemState));
    }
  }

  private createEntryRow(itemState: BrowserHistoryAndFavoritesListItem) {
    const { url, title, faviconUrl, sectionKind } = itemState;
    const canDeleteHistory = sectionKind === 'recent';
    const isCurrentLoading =
      Boolean(this.context.browserIsLoading) &&
      toTrackableBrowserHistoryAndFavoritesUrl(this.context.browserUrl) ===
        toTrackableBrowserHistoryAndFavoritesUrl(url);
    const itemRow = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-item-row');
    itemRow.classList.toggle('comet-is-deletable', canDeleteHistory);
    const item = $<HTMLElementTagNameMap['button']>('button.comet-browser-history-and-favorites-item');
    item.type = 'button';
    item.title = url;
    if (sectionKind === 'favorites') {
      item.classList.add('comet-is-favorite');
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openFavoriteItemContextMenu(event, itemState);
      });
    }
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handleEntryClick(url);
    });
    const headerElement = $<HTMLElementTagNameMap['span']>('span.comet-browser-history-and-favorites-item-header');
    const faviconElement = this.createEntryFaviconElement(
      faviconUrl,
      isCurrentLoading,
    );
    const titleElement = $<HTMLElementTagNameMap['span']>('span.comet-browser-history-and-favorites-item-title', undefined, title);
    headerElement.append(faviconElement, titleElement);
    item.append(headerElement);
    itemRow.append(item);
    if (canDeleteHistory && itemState.historyEntryId !== undefined) {
      const deleteButton = $<HTMLElementTagNameMap['button']>('button.comet-browser-history-and-favorites-item-delete-btn.comet-btn-base.comet-btn-md') as HTMLButtonElement;
      const deleteLabel = this.getDeleteHistoryEntryLabel();
      deleteButton.type = 'button';
      deleteButton.title = deleteLabel;
      deleteButton.setAttribute('aria-label', deleteLabel);
      deleteButton.append(createLxIcon('trash'));
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleEntryDelete(itemState.historyEntryId!);
      });
      itemRow.append(deleteButton);
    }
    return itemRow;
  }

  private openFavoriteItemContextMenu(
    event: MouseEvent,
    itemState: BrowserHistoryAndFavoritesListItem,
  ) {
    this.contextMenuService.showContextMenu({
      getAnchor: () => createMouseContextMenuAnchor(event),
      getActions: () => [
        toAction({
          id: 'open',
          label: String(this.context.labels.contextOpen ?? 'Open'),
          run: () => {
            this.handleEntryClick(itemState.url);
          },
        }),
        toAction({
          id: 'open-in-new-tab',
          label: String(this.context.labels.contextOpenInNewTab ?? 'Open in New Tab'),
          run: () => {
            this.handleFavoriteItemOpenInNewTab(itemState.url);
          },
        }),
        toAction({
          id: 'remove-favorite',
          label: String(
            this.context.labels.contextRemoveFavorite ?? 'Remove Favorite',
          ),
          run: () => {
            this.handleFavoriteItemRemove(itemState.url);
          },
        }),
      ],
      getMenuData: () => 'browser-history-and-favorites-favorite-item',
      alignment: 'start',
    });
  }

  private getOrCreateListElement() {
    if (this.listElement) {
      return this.listElement;
    }

const listElement = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-list');
    this.listElement = listElement;
    this.bodyElement.append(listElement);
    return listElement;
  }

  private getOrCreateEmptyStateElement() {
    if (this.emptyStateElement) {
      return this.emptyStateElement;
    }

    this.emptyStateElement = $<HTMLElementTagNameMap['div']>('div.comet-browser-history-and-favorites-empty');
    this.bodyElement.append(this.emptyStateElement);
    return this.emptyStateElement;
  }

  private renderEmptyState(isNoMatch: boolean) {
    const emptyStateElement = this.getOrCreateEmptyStateElement();
    const query = this.searchQuery.trim();
    const iconName = isNoMatch ? 'search' : 'favorite';
    const label = isNoMatch
      ? `No matches for "${query}"`
      : this.context.labels.emptyState;

    const nextStateSignature = `${iconName}:${label}`;
    if (emptyStateElement.dataset.state === nextStateSignature) {
      return;
    }

const emptyIconElement = createLxIcon(iconName, 'comet-browser-history-and-favorites-empty-icon');
    const emptyLabelElement = $<HTMLElementTagNameMap['p']>('p.comet-browser-history-and-favorites-empty-label', undefined, label);
    emptyStateElement.replaceChildren(emptyIconElement, emptyLabelElement);
    emptyStateElement.dataset.state = nextStateSignature;
  }
}
