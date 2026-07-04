import { createMouseContextMenuAnchor } from 'cs/base/browser/contextmenu';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon, createLxLoadingIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { createContextMenuService } from 'app/cs/workbench/services/contextmenu/electron-browser/contextmenuService';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorOpenTypes';
import { $ } from 'cs/base/browser/dom';

const EDITOR_BROWSER_LIBRARY_STORAGE_KEY = 'cs.editor.browser.library.v1';
const MAX_RECENT_BROWSER_LIBRARY_ENTRIES = 25;
const MAX_FAVORITE_BROWSER_LIBRARY_ENTRIES = 25;
const MAX_FAVORITE_BROWSER_LIBRARY_FOLDERS = 25;
const EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS = 'comet-is-desktop-overlay';
const NATIVE_WEBCONTENT_ACTIVE_SELECTOR =
  '.comet-browser-frame-placeholder[data-webcontent-active="true"]';

type StoredBrowserLibraryFavoriteFolder = {
  id: string;
  name: string;
};

type StoredBrowserLibraryState = {
  recentUrls: string[];
  recentVisitedAtByUrl: Record<string, number>;
  favoriteUrls: string[];
  faviconByUrl: Record<string, string>;
  pageTitleByUrl: Record<string, string>;
  favoriteFolders: StoredBrowserLibraryFavoriteFolder[];
  favoriteFolderByUrl: Record<string, string>;
  favoriteCustomTitleByUrl: Record<string, string>;
};

type BrowserLibrarySectionKind = 'recent' | 'favorites';

type BrowserLibraryRecentBucket = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';

type BrowserLibraryListItem = {
  url: string;
  title: string;
  faviconUrl: string;
  sectionKind: BrowserLibrarySectionKind;
  favoriteFolderId: string;
  favoriteFolderName: string;
  recentVisitedAt: number;
};

export type EditorBrowserLibraryPanelLabels = {
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
  contextNewFolder?: string;
  contextRename?: string;
  contextRemoveFavorite?: string;
  deleteHistoryEntry?: string;
};

export type EditorBrowserLibraryPanelContext = {
  browserUrl: string;
  browserPageTitle?: string;
  browserFaviconUrl?: string;
  browserIsLoading?: boolean;
  browserTabTitle?: string;
  labels: EditorBrowserLibraryPanelLabels;
  onNavigateToUrl: (url: string) => void;
  onOpenEditor?: EditorOpenHandler;
  onRequestRenameFavorite?: (
    params: { url: string; title: string },
  ) => Promise<string | null> | string | null;
  onRequestCreateFavoriteFolder?: (
    params: { url: string; title: string },
  ) => Promise<string | null> | string | null;
};

type EditorBrowserLibraryPanelOptions = {
  isInteractionWithin?: (target: Node) => boolean;
  onDidChangeOpenState?: (isOpen: boolean) => void;
};

function normalizeBrowserLibraryUrl(url: string) {
  return String(url).trim();
}

function isTrackableBrowserLibraryUrl(url: string) {
  return Boolean(url) && url !== 'about:blank';
}

function toTrackableBrowserLibraryUrl(url: string) {
  const normalizedUrl = normalizeBrowserLibraryUrl(url);
  return isTrackableBrowserLibraryUrl(normalizedUrl) ? normalizedUrl : '';
}

function normalizeBrowserLibrarySearchValue(value: string | null) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function getBrowserLibrarySearchEngineId(url: URL) {
  const host = url.hostname.toLocaleLowerCase();
  const pathname = url.pathname.toLocaleLowerCase();
  const engineMatchers: Array<[string, string]> = [
    ['bing', 'bing.'],
    ['google', 'google.'],
    ['duckduckgo', 'duckduckgo.'],
    ['baidu', 'baidu.'],
    ['yahoo', 'yahoo.'],
    ['yandex', 'yandex.'],
  ];
  const matchedEngine = engineMatchers.find(([, marker]) => host.includes(marker));
  if (matchedEngine) {
    return matchedEngine[0];
  }
  return pathname.includes('search') ? host : '';
}

function createBrowserLibraryUrlMatchKey(url: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  if (!normalizedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    const protocol = parsedUrl.protocol.toLocaleLowerCase();
    const host = parsedUrl.host.toLocaleLowerCase();
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const searchParams = parsedUrl.searchParams;

    const searchEngineId = getBrowserLibrarySearchEngineId(parsedUrl);
    if (searchEngineId) {
      for (const searchKey of ['q', 'query', 'search', 'p', 'wd', 'text']) {
        const searchValue = normalizeBrowserLibrarySearchValue(
          searchParams.get(searchKey),
        );
        if (searchValue) {
          return `search:${searchEngineId}:${pathname}?${searchKey}=${searchValue}`;
        }
      }
    }

const stableParams = Array.from(searchParams.entries())
      .filter(([key, value]) => {
        const normalizedKey = key.toLocaleLowerCase();
        return (
          value &&
          !normalizedKey.startsWith('utm_') &&
          !['fbclid', 'gclid', 'msclkid', 'yclid', 'cvid', 'form'].includes(
            normalizedKey,
          )
        );
      })
      .map(([key, value]) => [
        key.toLocaleLowerCase(),
        normalizeBrowserLibrarySearchValue(value),
      ] as const)
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey === rightKey
          ? leftValue.localeCompare(rightValue)
          : leftKey.localeCompare(rightKey),
      );
    const stableSearch = stableParams
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    return stableSearch
      ? `${protocol}//${host}${pathname}?${stableSearch}`
      : `${protocol}//${host}${pathname}`;
  } catch {
    return normalizedUrl;
  }
}

function areBrowserLibraryUrlsEquivalent(leftUrl: string, rightUrl: string) {
  const leftNormalizedUrl = toTrackableBrowserLibraryUrl(leftUrl);
  const rightNormalizedUrl = toTrackableBrowserLibraryUrl(rightUrl);
  if (!leftNormalizedUrl || !rightNormalizedUrl) {
    return false;
  }
  if (leftNormalizedUrl === rightNormalizedUrl) {
    return true;
  }
  return createBrowserLibraryUrlMatchKey(leftNormalizedUrl) ===
    createBrowserLibraryUrlMatchKey(rightNormalizedUrl);
}

function findEquivalentBrowserLibraryUrl(
  urls: readonly string[],
  url: string,
) {
  return urls.find((entry) => areBrowserLibraryUrlsEquivalent(entry, url)) ?? '';
}

function dedupeUrlList(urls: string[]) {
  const normalizedUrls: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const normalizedUrl = normalizeBrowserLibraryUrl(url);
    const matchKey = createBrowserLibraryUrlMatchKey(normalizedUrl);
    if (!isTrackableBrowserLibraryUrl(normalizedUrl) || seen.has(matchKey)) {
      continue;
    }

    seen.add(matchKey);
    normalizedUrls.push(normalizedUrl);
  }

  return normalizedUrls;
}

function trimUrlList(urls: string[], maxCount: number) {
  return urls.slice(0, maxCount);
}

function createStoredBrowserLibraryState(): StoredBrowserLibraryState {
  return {
    recentUrls: [],
    recentVisitedAtByUrl: {},
    favoriteUrls: [],
    faviconByUrl: {},
    pageTitleByUrl: {},
    favoriteFolders: [],
    favoriteFolderByUrl: {},
    favoriteCustomTitleByUrl: {},
  };
}

function sanitizeBrowserLibraryFaviconUrl(value: unknown) {
  return String(value ?? '').trim();
}

function sanitizeBrowserLibraryFavoriteFolderId(value: unknown) {
  return String(value ?? '').trim();
}

function sanitizeBrowserLibraryFavoriteFolderName(value: unknown) {
  return String(value ?? '').trim();
}

function sanitizeBrowserLibraryPageTitle(value: unknown) {
  const normalizedPageTitle = String(value ?? '').trim();
  if (!normalizedPageTitle) {
    return '';
  }

  if (
    /^about:blank$/i.test(normalizedPageTitle) ||
    /^https?:\/\/about:blank$/i.test(normalizedPageTitle)
  ) {
    return '';
  }

  return normalizedPageTitle;
}

function sanitizeStoredBrowserLibraryFaviconByUrl(
  value: unknown,
  validUrls: Set<string>,
) {
  if (!value || typeof value !== 'object') {
    return {};
  }

const faviconByUrl: Record<string, string> = {};
  for (const [url, favicon] of Object.entries(value)) {
    const normalizedUrl = normalizeBrowserLibraryUrl(url);
    if (!validUrls.has(normalizedUrl)) {
      continue;
    }

const normalizedFavicon = sanitizeBrowserLibraryFaviconUrl(favicon);
    if (!normalizedFavicon) {
      continue;
    }
    faviconByUrl[normalizedUrl] = normalizedFavicon;
  }

  return faviconByUrl;
}

function sanitizeStoredBrowserLibraryFavoriteFolders(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

const favoriteFolders: StoredBrowserLibraryFavoriteFolder[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

const folderId = sanitizeBrowserLibraryFavoriteFolderId(
      (entry as { id?: unknown }).id,
    );
    const folderName = sanitizeBrowserLibraryFavoriteFolderName(
      (entry as { name?: unknown }).name,
    );
    if (!folderId || !folderName || seenIds.has(folderId)) {
      continue;
    }

    seenIds.add(folderId);
    favoriteFolders.push({
      id: folderId,
      name: folderName,
    });
  }

  return favoriteFolders.slice(0, MAX_FAVORITE_BROWSER_LIBRARY_FOLDERS);
}

function sanitizeStoredBrowserLibraryPageTitleByUrl(
  value: unknown,
  validUrls: Set<string>,
) {
  if (!value || typeof value !== 'object') {
    return {};
  }

const pageTitleByUrl: Record<string, string> = {};
  for (const [url, pageTitle] of Object.entries(value)) {
    const normalizedUrl = normalizeBrowserLibraryUrl(url);
    if (!validUrls.has(normalizedUrl)) {
      continue;
    }

const normalizedPageTitle = sanitizeBrowserLibraryPageTitle(pageTitle);
    if (!normalizedPageTitle) {
      continue;
    }
    pageTitleByUrl[normalizedUrl] = normalizedPageTitle;
  }

  return pageTitleByUrl;
}

function sanitizeStoredBrowserLibraryRecentVisitedAtByUrl(
  value: unknown,
  validUrls: Set<string>,
) {
  if (!value || typeof value !== 'object') {
    return {};
  }

const recentVisitedAtByUrl: Record<string, number> = {};
  for (const [url, visitedAt] of Object.entries(value)) {
    const normalizedUrl = normalizeBrowserLibraryUrl(url);
    if (!validUrls.has(normalizedUrl)) {
      continue;
    }

const normalizedVisitedAt =
      typeof visitedAt === 'number'
        ? visitedAt
        : Number.parseInt(String(visitedAt), 10);
    if (!Number.isFinite(normalizedVisitedAt) || normalizedVisitedAt <= 0) {
      continue;
    }

    recentVisitedAtByUrl[normalizedUrl] = normalizedVisitedAt;
  }

  return recentVisitedAtByUrl;
}

function sanitizeStoredBrowserLibraryFavoriteFolderByUrl(
  value: unknown,
  favoriteUrls: Set<string>,
  validFolderIds: Set<string>,
) {
  if (!value || typeof value !== 'object') {
    return {};
  }

const favoriteFolderByUrl: Record<string, string> = {};
  for (const [url, folderId] of Object.entries(value)) {
    const normalizedUrl = normalizeBrowserLibraryUrl(url);
    if (!favoriteUrls.has(normalizedUrl)) {
      continue;
    }

const normalizedFolderId = sanitizeBrowserLibraryFavoriteFolderId(folderId);
    if (!normalizedFolderId || !validFolderIds.has(normalizedFolderId)) {
      continue;
    }

    favoriteFolderByUrl[normalizedUrl] = normalizedFolderId;
  }

  return favoriteFolderByUrl;
}

function sanitizeStoredBrowserLibraryFavoriteCustomTitleByUrl(
  value: unknown,
  favoriteUrls: Set<string>,
) {
  if (!value || typeof value !== 'object') {
    return {};
  }

const favoriteCustomTitleByUrl: Record<string, string> = {};
  for (const [url, title] of Object.entries(value)) {
    const normalizedUrl = normalizeBrowserLibraryUrl(url);
    if (!favoriteUrls.has(normalizedUrl)) {
      continue;
    }

const normalizedTitle = sanitizeBrowserLibraryPageTitle(title);
    if (!normalizedTitle) {
      continue;
    }

    favoriteCustomTitleByUrl[normalizedUrl] = normalizedTitle;
  }

  return favoriteCustomTitleByUrl;
}

function areStoredBrowserLibraryRecordMapsEqual<T extends string | number>(
  left: Record<string, T>,
  right: Record<string, T>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function areStoredBrowserLibraryFavoriteFoldersEqual(
  left: readonly StoredBrowserLibraryFavoriteFolder[],
  right: readonly StoredBrowserLibraryFavoriteFolder[],
) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((folder, index) =>
    folder.id === right[index]?.id && folder.name === right[index]?.name);
}

function pruneStoredBrowserLibraryFavoriteFolders(
  favoriteFolders: readonly StoredBrowserLibraryFavoriteFolder[],
  favoriteFolderByUrl: Record<string, string>,
) {
  const usedFolderIds = new Set(Object.values(favoriteFolderByUrl));
  return favoriteFolders.filter((folder) => usedFolderIds.has(folder.id));
}

function sanitizeStoredBrowserLibraryState(
  value: Partial<StoredBrowserLibraryState> | null | undefined,
): StoredBrowserLibraryState {
  if (!value) {
    return createStoredBrowserLibraryState();
  }

const recentUrls = Array.isArray(value.recentUrls)
    ? value.recentUrls.map((url) => String(url))
    : [];
  const favoriteUrls = Array.isArray(value.favoriteUrls)
    ? value.favoriteUrls.map((url) => String(url))
    : [];
  const sanitizedRecentUrls = trimUrlList(
    dedupeUrlList(recentUrls),
    MAX_RECENT_BROWSER_LIBRARY_ENTRIES,
  );
  const sanitizedFavoriteUrls = trimUrlList(
    dedupeUrlList(favoriteUrls),
    MAX_FAVORITE_BROWSER_LIBRARY_ENTRIES,
  );
  const favoriteFolders = sanitizeStoredBrowserLibraryFavoriteFolders(
    (value as { favoriteFolders?: unknown }).favoriteFolders,
  );
  const validUrls = new Set<string>([
    ...sanitizedRecentUrls,
    ...sanitizedFavoriteUrls,
  ]);
  const favoriteUrlSet = new Set<string>(sanitizedFavoriteUrls);
  const favoriteFolderIdSet = new Set<string>(
    favoriteFolders.map((folder) => folder.id),
  );
  const favoriteFolderByUrl = sanitizeStoredBrowserLibraryFavoriteFolderByUrl(
    (value as { favoriteFolderByUrl?: unknown }).favoriteFolderByUrl,
    favoriteUrlSet,
    favoriteFolderIdSet,
  );
  const sanitizedFavoriteFolders = pruneStoredBrowserLibraryFavoriteFolders(
    favoriteFolders,
    favoriteFolderByUrl,
  );

  return {
    recentUrls: sanitizedRecentUrls,
    recentVisitedAtByUrl: sanitizeStoredBrowserLibraryRecentVisitedAtByUrl(
      (value as { recentVisitedAtByUrl?: unknown }).recentVisitedAtByUrl,
      new Set<string>(sanitizedRecentUrls),
    ),
    favoriteUrls: sanitizedFavoriteUrls,
    faviconByUrl: sanitizeStoredBrowserLibraryFaviconByUrl(
      (value as { faviconByUrl?: unknown }).faviconByUrl,
      validUrls,
    ),
    pageTitleByUrl: sanitizeStoredBrowserLibraryPageTitleByUrl(
      (value as { pageTitleByUrl?: unknown }).pageTitleByUrl,
      validUrls,
    ),
    favoriteFolders: sanitizedFavoriteFolders,
    favoriteFolderByUrl,
    favoriteCustomTitleByUrl: sanitizeStoredBrowserLibraryFavoriteCustomTitleByUrl(
      (value as { favoriteCustomTitleByUrl?: unknown }).favoriteCustomTitleByUrl,
      favoriteUrlSet,
    ),
  };
}

function getBrowserLibraryStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredBrowserLibraryStateFromStorage() {
  const storage = getBrowserLibraryStorage();
  if (!storage) {
    return createStoredBrowserLibraryState();
  }

  try {
    const serialized = storage.getItem(EDITOR_BROWSER_LIBRARY_STORAGE_KEY);
    if (!serialized) {
      return createStoredBrowserLibraryState();
    }

const parsed = JSON.parse(serialized) as Partial<StoredBrowserLibraryState>;
    return sanitizeStoredBrowserLibraryState(parsed);
  } catch {
    return createStoredBrowserLibraryState();
  }
}

function writeStoredBrowserLibraryStateToStorage(state: StoredBrowserLibraryState) {
  const storage = getBrowserLibraryStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      EDITOR_BROWSER_LIBRARY_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Storage can fail in restricted contexts; keep in-memory state only.
  }
}

let storedBrowserLibraryState = readStoredBrowserLibraryStateFromStorage();

function updateStoredBrowserLibraryState(
  reducer: (state: StoredBrowserLibraryState) => StoredBrowserLibraryState,
) {
  const nextState = sanitizeStoredBrowserLibraryState(reducer(storedBrowserLibraryState));
  if (
    nextState.recentUrls.length === storedBrowserLibraryState.recentUrls.length &&
    nextState.favoriteUrls.length === storedBrowserLibraryState.favoriteUrls.length &&
    nextState.recentUrls.every((url, index) => url === storedBrowserLibraryState.recentUrls[index]) &&
    nextState.favoriteUrls.every((url, index) => url === storedBrowserLibraryState.favoriteUrls[index]) &&
    areStoredBrowserLibraryFavoriteFoldersEqual(
      nextState.favoriteFolders,
      storedBrowserLibraryState.favoriteFolders,
    ) &&
    areStoredBrowserLibraryRecordMapsEqual(
      nextState.recentVisitedAtByUrl,
      storedBrowserLibraryState.recentVisitedAtByUrl,
    ) &&
    areStoredBrowserLibraryRecordMapsEqual(
      nextState.faviconByUrl,
      storedBrowserLibraryState.faviconByUrl,
    ) &&
    areStoredBrowserLibraryRecordMapsEqual(
      nextState.pageTitleByUrl,
      storedBrowserLibraryState.pageTitleByUrl,
    ) &&
    areStoredBrowserLibraryRecordMapsEqual(
      nextState.favoriteFolderByUrl,
      storedBrowserLibraryState.favoriteFolderByUrl,
    ) &&
    areStoredBrowserLibraryRecordMapsEqual(
      nextState.favoriteCustomTitleByUrl,
      storedBrowserLibraryState.favoriteCustomTitleByUrl,
    )
  ) {
    return false;
  }

  storedBrowserLibraryState = nextState;
  writeStoredBrowserLibraryStateToStorage(nextState);
  return true;
}

function recordBrowserLibraryEntryVisit({
  url,
  faviconUrl,
  pageTitle,
}: {
  url: string;
  faviconUrl?: string;
  pageTitle?: string;
}) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  if (!normalizedUrl) {
    return false;
  }

const normalizedFaviconUrl = sanitizeBrowserLibraryFaviconUrl(faviconUrl);
  const normalizedPageTitle = sanitizeBrowserLibraryPageTitle(pageTitle);
  const visitedAt = Date.now();

  return updateStoredBrowserLibraryState((state) => {
    const recentUrls = trimUrlList(
      [normalizedUrl, ...state.recentUrls.filter((entry) => entry !== normalizedUrl)],
      MAX_RECENT_BROWSER_LIBRARY_ENTRIES,
    );

    let faviconByUrl = state.faviconByUrl;
    if (normalizedFaviconUrl) {
      faviconByUrl = {
        ...faviconByUrl,
        [normalizedUrl]: normalizedFaviconUrl,
      };
    }

    let pageTitleByUrl = state.pageTitleByUrl;
    if (normalizedPageTitle) {
      pageTitleByUrl = {
        ...pageTitleByUrl,
        [normalizedUrl]: normalizedPageTitle,
      };
    }

    return {
      ...state,
      recentUrls,
      recentVisitedAtByUrl: {
        ...state.recentVisitedAtByUrl,
        [normalizedUrl]: visitedAt,
      },
      faviconByUrl,
      pageTitleByUrl,
    };
  });
}

function toggleFavoriteBrowserLibraryEntry(url: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  return updateStoredBrowserLibraryState((state) => {
    const existingFavoriteUrl = findEquivalentBrowserLibraryUrl(
      state.favoriteUrls,
      normalizedUrl,
    );
    const alreadyFavorite = Boolean(existingFavoriteUrl);
    const favoriteUrls = alreadyFavorite
      ? state.favoriteUrls.filter((entry) => entry !== existingFavoriteUrl)
      : trimUrlList(
        [
          normalizedUrl,
          ...state.favoriteUrls.filter(
            (entry) => !areBrowserLibraryUrlsEquivalent(entry, normalizedUrl),
          ),
        ],
        MAX_FAVORITE_BROWSER_LIBRARY_ENTRIES,
      );

    const recentUrls = trimUrlList(
      [
        normalizedUrl,
        ...state.recentUrls.filter(
          (entry) => !areBrowserLibraryUrlsEquivalent(entry, normalizedUrl),
        ),
      ],
      MAX_RECENT_BROWSER_LIBRARY_ENTRIES,
    );
    const favoriteFolderByUrl = { ...state.favoriteFolderByUrl };
    const favoriteCustomTitleByUrl = { ...state.favoriteCustomTitleByUrl };
    if (alreadyFavorite) {
      delete favoriteFolderByUrl[existingFavoriteUrl];
      delete favoriteCustomTitleByUrl[existingFavoriteUrl];
    }

    return {
      ...state,
      recentUrls,
      favoriteUrls,
      favoriteFolders: pruneStoredBrowserLibraryFavoriteFolders(
        state.favoriteFolders,
        favoriteFolderByUrl,
      ),
      favoriteFolderByUrl,
      favoriteCustomTitleByUrl,
    };
  });
}

function createBrowserLibraryFavoriteFolderId() {
  return `favorite-folder-${Math.random().toString(36).slice(2, 10)}`;
}

function removeFavoriteBrowserLibraryEntry(url: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  return updateStoredBrowserLibraryState((state) => {
    const existingFavoriteUrl = findEquivalentBrowserLibraryUrl(
      state.favoriteUrls,
      normalizedUrl,
    );
    if (!existingFavoriteUrl) {
      return state;
    }

const favoriteUrls = state.favoriteUrls.filter((entry) => entry !== existingFavoriteUrl);
    const recentUrls = trimUrlList(
      [
        normalizedUrl,
        ...state.recentUrls.filter(
          (entry) => !areBrowserLibraryUrlsEquivalent(entry, normalizedUrl),
        ),
      ],
      MAX_RECENT_BROWSER_LIBRARY_ENTRIES,
    );
    const favoriteFolderByUrl = { ...state.favoriteFolderByUrl };
    const favoriteCustomTitleByUrl = { ...state.favoriteCustomTitleByUrl };
    delete favoriteFolderByUrl[existingFavoriteUrl];
    delete favoriteCustomTitleByUrl[existingFavoriteUrl];

    return {
      ...state,
      recentUrls,
      favoriteUrls,
      favoriteFolders: pruneStoredBrowserLibraryFavoriteFolders(
        state.favoriteFolders,
        favoriteFolderByUrl,
      ),
      favoriteFolderByUrl,
      favoriteCustomTitleByUrl,
    };
  });
}

function renameFavoriteBrowserLibraryEntry(url: string, title: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  const normalizedTitle = sanitizeBrowserLibraryPageTitle(title);
  if (!normalizedUrl || !normalizedTitle) {
    return false;
  }

  return updateStoredBrowserLibraryState((state) => {
    if (!state.favoriteUrls.includes(normalizedUrl)) {
      return state;
    }

const favoriteCustomTitleByUrl = {
      ...state.favoriteCustomTitleByUrl,
    };
    favoriteCustomTitleByUrl[normalizedUrl] = normalizedTitle;

    return {
      ...state,
      favoriteCustomTitleByUrl,
    };
  });
}

function createFavoriteBrowserLibraryFolder(url: string, folderName: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  const normalizedFolderName = sanitizeBrowserLibraryFavoriteFolderName(folderName);
  if (!normalizedUrl || !normalizedFolderName) {
    return false;
  }

  return updateStoredBrowserLibraryState((state) => {
    if (!state.favoriteUrls.includes(normalizedUrl)) {
      return state;
    }

const nextFolderId = createBrowserLibraryFavoriteFolderId();
    const favoriteFolderByUrl = {
      ...state.favoriteFolderByUrl,
      [normalizedUrl]: nextFolderId,
    };

    return {
      ...state,
      favoriteFolders: pruneStoredBrowserLibraryFavoriteFolders(
        [
          ...state.favoriteFolders,
          {
            id: nextFolderId,
            name: normalizedFolderName,
          },
        ],
        favoriteFolderByUrl,
      ),
      favoriteFolderByUrl,
    };
  });
}

function clearRecentBrowserLibraryEntries() {
  return updateStoredBrowserLibraryState((state) => {
    const favoriteUrlSet = new Set(state.favoriteUrls);
    const nextFaviconByUrl: Record<string, string> = {};
    const nextPageTitleByUrl: Record<string, string> = {};
    for (const [url, faviconUrl] of Object.entries(state.faviconByUrl)) {
      if (favoriteUrlSet.has(url)) {
        nextFaviconByUrl[url] = faviconUrl;
      }
    }
    for (const [url, pageTitle] of Object.entries(state.pageTitleByUrl)) {
      if (favoriteUrlSet.has(url)) {
        nextPageTitleByUrl[url] = pageTitle;
      }
    }

    return {
      ...state,
      recentUrls: [],
      recentVisitedAtByUrl: {},
      faviconByUrl: nextFaviconByUrl,
      pageTitleByUrl: nextPageTitleByUrl,
    };
  });
}

function removeRecentBrowserLibraryEntry(url: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  return updateStoredBrowserLibraryState((state) => {
    if (!state.recentUrls.includes(normalizedUrl)) {
      return state;
    }

const recentUrls = state.recentUrls.filter((entry) => entry !== normalizedUrl);
    if (state.favoriteUrls.includes(normalizedUrl)) {
      return {
        ...state,
        recentUrls,
      };
    }

const faviconByUrl = { ...state.faviconByUrl };
    const pageTitleByUrl = { ...state.pageTitleByUrl };
    const recentVisitedAtByUrl = { ...state.recentVisitedAtByUrl };
    delete faviconByUrl[normalizedUrl];
    delete pageTitleByUrl[normalizedUrl];
    delete recentVisitedAtByUrl[normalizedUrl];

    return {
      ...state,
      recentUrls,
      recentVisitedAtByUrl,
      faviconByUrl,
      pageTitleByUrl,
    };
  });
}

function isFavoriteBrowserLibraryEntry(url: string) {
  const normalizedUrl = toTrackableBrowserLibraryUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  return Boolean(
    findEquivalentBrowserLibraryUrl(
      storedBrowserLibraryState.favoriteUrls,
      normalizedUrl,
    ),
  );
}

function getRecentBrowserLibraryEntries() {
  return [...storedBrowserLibraryState.recentUrls];
}

function getFavoriteBrowserLibraryEntries() {
  return [...storedBrowserLibraryState.favoriteUrls];
}

function getFavoriteBrowserLibraryFolders() {
  return storedBrowserLibraryState.favoriteFolders.map((folder) => ({ ...folder }));
}

function getBrowserLibraryEntryFavicon(url: string) {
  return storedBrowserLibraryState.faviconByUrl[url] ?? '';
}

function getBrowserLibraryEntryPageTitle(url: string) {
  return storedBrowserLibraryState.pageTitleByUrl[url] ?? '';
}

function getFavoriteBrowserLibraryEntryFolderId(url: string) {
  return storedBrowserLibraryState.favoriteFolderByUrl[url] ?? '';
}

function getRecentBrowserLibraryEntryVisitedAt(url: string) {
  return storedBrowserLibraryState.recentVisitedAtByUrl[url] ?? 0;
}

function getFavoriteBrowserLibraryEntryCustomTitle(url: string) {
  return storedBrowserLibraryState.favoriteCustomTitleByUrl[url] ?? '';
}

function resolveRecentBrowserLibraryBucket(
  visitedAt: number,
  now: Date = new Date(),
): BrowserLibraryRecentBucket {
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

function resolveBrowserLibraryTitle(url: string) {
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

export class EditorBrowserLibraryPanel {
  private context: EditorBrowserLibraryPanelContext;
  private isInteractionWithin?: (target: Node) => boolean;
  private onDidChangeOpenState?: (isOpen: boolean) => void;
  private onDidChangeState?: () => void;
  private readonly contextMenuService = createContextMenuService();
  private readonly backdropElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-panel-backdrop');
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-panel');
  private readonly desktopOverlayContainer = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-panel-overlay');
  private readonly headerElement = $<HTMLElementTagNameMap['header']>('header.comet-editor-browser-library-header');
  private readonly searchInputHost = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-search-host');
  private readonly bodyElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-body');
  private listElement: HTMLElement | null = null;
  private emptyStateElement: HTMLElement | null = null;
  private readonly searchInput: InputBox;
  private readonly panelId = `editor-browser-library-panel-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  private isOpen = false;
  private searchQuery = '';
  private isGlobalListenersBound = false;
  private hostElement: HTMLElement | null = null;
  private overlayPositionFrame = 0;
  private lastTrackedEntryUrl = '';
  private lastTrackedEntryPageTitle = '';

  constructor(
    context: EditorBrowserLibraryPanelContext,
    options: EditorBrowserLibraryPanelOptions = {},
  ) {
    this.context = context;
    this.isInteractionWithin = options.isInteractionWithin;
    this.onDidChangeOpenState = options.onDidChangeOpenState;
    this.searchInput = new InputBox(this.searchInputHost, undefined, {
      className: 'comet-editor-browser-library-search-input',
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
    this.trackCurrentBrowserLibraryEntry();
    this.render();
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

  setContext(context: EditorBrowserLibraryPanelContext) {
    const didEntryMetadataChange =
      toTrackableBrowserLibraryUrl(this.context.browserUrl) !==
        toTrackableBrowserLibraryUrl(context.browserUrl) ||
      sanitizeBrowserLibraryPageTitle(this.context.browserPageTitle) !==
        sanitizeBrowserLibraryPageTitle(context.browserPageTitle) ||
      sanitizeBrowserLibraryFaviconUrl(this.context.browserFaviconUrl) !==
        sanitizeBrowserLibraryFaviconUrl(context.browserFaviconUrl);
    this.context = context;
    if (didEntryMetadataChange) {
      this.trackCurrentBrowserLibraryEntry();
    }
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
    return Boolean(toTrackableBrowserLibraryUrl(this.context.browserUrl));
  }

  isCurrentBrowserUrlFavorited() {
    const libraryUrl = toTrackableBrowserLibraryUrl(this.context.browserUrl);
    return libraryUrl ? isFavoriteBrowserLibraryEntry(libraryUrl) : false;
  }

  isBrowserUrlFavorited(url: string) {
    const libraryUrl = toTrackableBrowserLibraryUrl(url);
    return libraryUrl ? isFavoriteBrowserLibraryEntry(libraryUrl) : false;
  }

  toggleCurrentBrowserUrlFavorite() {
    const libraryUrl = toTrackableBrowserLibraryUrl(this.context.browserUrl);
    if (!libraryUrl) {
      return false;
    }

const changed = toggleFavoriteBrowserLibraryEntry(libraryUrl);
    if (changed) {
      this.render();
      this.onDidChangeState?.();
    }
    return changed;
  }

  clearRecentLibraryEntries() {
    const changed = clearRecentBrowserLibraryEntries();
    if (changed) {
      this.render();
    }
    return changed;
  }

  dispose() {
    this.contextMenuService.dispose();
    this.unbindGlobalListeners();
    this.stopOverlayPositionSync();
    this.clearDesktopOverlayPosition();
    this.removeDesktopOverlayContainer();
    this.backdropElement.remove();
    this.element.classList.remove(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS);
    this.hostElement = null;
    this.searchInput.dispose();
    this.element.remove();
    this.element.replaceChildren();
  }

  private trackCurrentBrowserLibraryEntry() {
    const libraryUrl = toTrackableBrowserLibraryUrl(this.context.browserUrl);
    if (!libraryUrl) {
      return;
    }

const normalizedPageTitle = sanitizeBrowserLibraryPageTitle(
      this.context.browserPageTitle,
    );
    let nextPageTitleToPersist = normalizedPageTitle;

    // Ignore one-frame title carry-over when URL has switched but metadata still lags behind.
    if (
      normalizedPageTitle &&
      this.lastTrackedEntryUrl &&
      this.lastTrackedEntryUrl !== libraryUrl &&
      this.lastTrackedEntryPageTitle === normalizedPageTitle &&
      !sanitizeBrowserLibraryPageTitle(getBrowserLibraryEntryPageTitle(libraryUrl))
    ) {
      const fallbackTabTitle = sanitizeBrowserLibraryPageTitle(
        this.context.browserTabTitle,
      );
      nextPageTitleToPersist =
        fallbackTabTitle && fallbackTabTitle !== normalizedPageTitle
          ? fallbackTabTitle
          : '';
    }

    // Persist visit metadata in a single state update to avoid redundant storage writes.
    recordBrowserLibraryEntryVisit({
      url: libraryUrl,
      faviconUrl: this.context.browserFaviconUrl,
      pageTitle: nextPageTitleToPersist,
    });
    this.lastTrackedEntryUrl = libraryUrl;
    this.lastTrackedEntryPageTitle = normalizedPageTitle;
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

  private readonly handleLibraryItemClick = (url: string) => {
    this.context.onNavigateToUrl(url);
    this.setOpen(false);
  };

  private readonly handleLibraryItemDelete = (url: string) => {
    const changed = removeRecentBrowserLibraryEntry(url);
    if (!changed) {
      return;
    }

    this.renderLibraryList();
  };

  private readonly handleFavoriteItemOpenInNewTab = (url: string) => {
    if (!this.context.onOpenEditor) {
      return;
    }

    void this.context.onOpenEditor({
      kind: 'browser',
      disposition: 'new-tab',
      url,
    });
    this.setOpen(false);
  };

  private readonly handleFavoriteItemRemove = (url: string) => {
    const changed = removeFavoriteBrowserLibraryEntry(url);
    if (!changed) {
      return;
    }

    this.renderLibraryList();
    this.onDidChangeState?.();
  };

  private readonly handleFavoriteItemRename = async (
    itemState: BrowserLibraryListItem,
  ) => {
    const nextTitle =
      (await this.context.onRequestRenameFavorite?.({
        url: itemState.url,
        title: itemState.title,
      })) ?? '';
    if (!nextTitle.trim()) {
      return;
    }

const changed = renameFavoriteBrowserLibraryEntry(itemState.url, nextTitle);
    if (!changed) {
      return;
    }

    this.renderLibraryList();
  };

  private readonly handleFavoriteItemCreateFolder = async (
    itemState: BrowserLibraryListItem,
  ) => {
    const nextFolderName =
      (await this.context.onRequestCreateFavoriteFolder?.({
        url: itemState.url,
        title: itemState.title,
      })) ?? '';
    if (!nextFolderName.trim()) {
      return;
    }

const changed = createFavoriteBrowserLibraryFolder(
      itemState.url,
      nextFolderName,
    );
    if (!changed) {
      return;
    }

    this.renderLibraryList();
  };

  private readonly handleSearchInputChange = (value: string) => {
    this.searchQuery = value;
    this.renderLibraryList();
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

  private createLibraryListItems(): BrowserLibraryListItem[] {
    const favoriteUrls = getFavoriteBrowserLibraryEntries();
    const favoriteFolderNamesById = new Map(
      getFavoriteBrowserLibraryFolders().map((folder) => [folder.id, folder.name]),
    );
    const recentUrls = getRecentBrowserLibraryEntries();
    const listItems: BrowserLibraryListItem[] = [];

    const appendUrl = (url: string, sectionKind: BrowserLibrarySectionKind) => {
      if (!url) {
        return;
      }

const pageTitle = sanitizeBrowserLibraryPageTitle(
        getBrowserLibraryEntryPageTitle(url),
      );
      const favoriteFolderId =
        sectionKind === 'favorites'
          ? getFavoriteBrowserLibraryEntryFolderId(url)
          : '';
      const favoriteFolderName =
        favoriteFolderNamesById.get(favoriteFolderId) ?? '';
      const favoriteCustomTitle =
        sectionKind === 'favorites'
          ? sanitizeBrowserLibraryPageTitle(getFavoriteBrowserLibraryEntryCustomTitle(url))
          : '';
      listItems.push({
        url,
        title: favoriteCustomTitle || pageTitle || resolveBrowserLibraryTitle(url),
        faviconUrl: getBrowserLibraryEntryFavicon(url),
        sectionKind,
        favoriteFolderId,
        favoriteFolderName,
        recentVisitedAt:
          sectionKind === 'recent' ? getRecentBrowserLibraryEntryVisitedAt(url) : 0,
      });
    };

    for (const url of favoriteUrls) {
      appendUrl(url, 'favorites');
    }

    for (const url of recentUrls) {
      appendUrl(url, 'recent');
    }

    return listItems;
  }

  private getFilteredLibraryListItems() {
    const normalizedQuery = normalizeSearchQuery(this.searchQuery);
    const listItems = this.createLibraryListItems();
    if (!normalizedQuery) {
      return listItems;
    }

    return listItems.filter((item) => {
      const normalizedTitle = normalizeSearchQuery(item.title);
      const normalizedUrl = normalizeSearchQuery(item.url);
      const normalizedFolderName = normalizeSearchQuery(item.favoriteFolderName);
      return (
        normalizedTitle.includes(normalizedQuery) ||
        normalizedUrl.includes(normalizedQuery) ||
        normalizedFolderName.includes(normalizedQuery)
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
    this.renderLibraryList();
  }

  private mountElementToHost() {
    const hostElement = this.hostElement;
    if (!hostElement) {
      this.stopOverlayPositionSync();
      this.clearDesktopOverlayPosition();
      this.removeDesktopOverlayContainer();
      this.backdropElement.remove();
      this.element.classList.remove(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS);
      this.element.remove();
      return;
    }

const useDesktopOverlay = this.hasActiveNativeWebContent(hostElement);
    const mountAsDesktopOverlay = useDesktopOverlay;
    if (mountAsDesktopOverlay) {
      const overlayContainer = this.getOrCreateDesktopOverlayContainer();
      this.appendPanelSurface(overlayContainer);
      this.element.classList.add(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS);
      this.syncDesktopOverlayPosition();
      return;
    }

    this.removeDesktopOverlayContainer();
    this.appendPanelSurface(hostElement);
    this.element.classList.remove(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS);
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
      !this.element.classList.contains(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS) ||
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
      !this.element.classList.contains(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS)
    ) {
      return;
    }

const schedule = () => {
      this.overlayPositionFrame = window.requestAnimationFrame(() => {
        this.overlayPositionFrame = 0;
        if (
          !this.isOpen ||
          !this.element.classList.contains(EDITOR_BROWSER_LIBRARY_DESKTOP_OVERLAY_CLASS)
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

  private renderLibraryList() {
    const listItems = this.getFilteredLibraryListItems();
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
    const listItemsBySection: Record<BrowserLibrarySectionKind, BrowserLibraryListItem[]> = {
      favorites: [],
      recent: [],
    };
    for (const itemState of listItems) {
      listItemsBySection[itemState.sectionKind].push(itemState);
    }

const orderedSections: Array<{
      kind: BrowserLibrarySectionKind;
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

const sectionElement = $<HTMLElementTagNameMap['section']>('section.comet-editor-browser-library-section');
      const sectionTitleElement = $<HTMLElementTagNameMap['p']>('p.comet-editor-browser-library-section-title', undefined, section.title);
      const sectionListElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-section-list');
      sectionElement.append(sectionTitleElement, sectionListElement);

      if (section.kind === 'favorites') {
        this.renderFavoriteSectionItems(sectionListElement, sectionItems);
      } else {
        for (const itemState of sectionItems) {
          sectionListElement.append(this.createLibraryItemRow(itemState));
        }
      }

      fragment.append(sectionElement);
    }

const recentItems = listItemsBySection.recent;
    if (recentItems.length > 0) {
      const recentBuckets = this.groupRecentItemsByBucket(recentItems);
      const recentBucketOrder: BrowserLibraryRecentBucket[] = [
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

const sectionElement = $<HTMLElementTagNameMap['section']>('section.comet-editor-browser-library-section');
        const sectionTitleElement = $<HTMLElementTagNameMap['p']>('p.comet-editor-browser-library-section-title', undefined, this.getRecentBucketTitle(bucket));
        const sectionListElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-section-list');
        for (const itemState of sectionItems) {
          sectionListElement.append(this.createLibraryItemRow(itemState));
        }
        sectionElement.append(sectionTitleElement, sectionListElement);
        fragment.append(sectionElement);
      }
    }

    listElement.replaceChildren(fragment);
  }

  private groupRecentItemsByBucket(items: readonly BrowserLibraryListItem[]) {
    const groupedItems: Record<BrowserLibraryRecentBucket, BrowserLibraryListItem[]> = {
      today: [],
      yesterday: [],
      last7Days: [],
      last30Days: [],
      older: [],
    };

    for (const item of items) {
      groupedItems[resolveRecentBrowserLibraryBucket(item.recentVisitedAt)].push(item);
    }

    return groupedItems;
  }

  private getRecentBucketTitle(bucket: BrowserLibraryRecentBucket) {
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

  private createLibraryItemFaviconElement(faviconUrl: string, isLoading = false) {
    if (isLoading) {
      return createLxLoadingIcon(
        'comet-editor-browser-library-item-favicon comet-is-loading',
      );
    }

const normalizedFaviconUrl = sanitizeBrowserLibraryFaviconUrl(faviconUrl);
    if (!normalizedFaviconUrl) {
      return createLxIcon(
        'browser-1',
        'comet-editor-browser-library-item-favicon comet-is-fallback',
      );
    }

const image = $<HTMLElementTagNameMap['img']>('img.comet-editor-browser-library-item-favicon') as HTMLImageElement;
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
        'comet-editor-browser-library-item-favicon comet-is-fallback',
      );
      image.replaceWith(fallback);
    });
    return image;
  }

  private renderFavoriteSectionItems(
    container: HTMLElement,
    items: readonly BrowserLibraryListItem[],
  ) {
    const rootItems = items.filter((item) => !item.favoriteFolderId);
    for (const itemState of rootItems) {
      container.append(this.createLibraryItemRow(itemState));
    }

const itemsByFolderId = new Map<string, BrowserLibraryListItem[]>();
    for (const itemState of items) {
      if (!itemState.favoriteFolderId) {
        continue;
      }

const existingItems = itemsByFolderId.get(itemState.favoriteFolderId) ?? [];
      existingItems.push(itemState);
      itemsByFolderId.set(itemState.favoriteFolderId, existingItems);
    }

    for (const folder of getFavoriteBrowserLibraryFolders()) {
      const folderItems = itemsByFolderId.get(folder.id);
      if (!folderItems || folderItems.length === 0) {
        continue;
      }

const folderGroup = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-folder-group');
      const folderTitle = $<HTMLElementTagNameMap['p']>('p.comet-editor-browser-library-folder-title', undefined, folder.name);
      const folderList = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-folder-list');
      for (const itemState of folderItems) {
        folderList.append(this.createLibraryItemRow(itemState));
      }
      folderGroup.append(folderTitle, folderList);
      container.append(folderGroup);
    }
  }

  private createLibraryItemRow(itemState: BrowserLibraryListItem) {
    const { url, title, faviconUrl, sectionKind } = itemState;
    const canDeleteHistory = sectionKind === 'recent';
    const isCurrentLoading =
      Boolean(this.context.browserIsLoading) &&
      toTrackableBrowserLibraryUrl(this.context.browserUrl) ===
        toTrackableBrowserLibraryUrl(url);
    const itemRow = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-item-row');
    itemRow.classList.toggle('comet-is-deletable', canDeleteHistory);
    const item = $<HTMLElementTagNameMap['button']>('button.comet-editor-browser-library-item');
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
      this.handleLibraryItemClick(url);
    });
    const headerElement = $<HTMLElementTagNameMap['span']>('span.comet-editor-browser-library-item-header');
    const faviconElement = this.createLibraryItemFaviconElement(
      faviconUrl,
      isCurrentLoading,
    );
    const titleElement = $<HTMLElementTagNameMap['span']>('span.comet-editor-browser-library-item-title', undefined, title);
    headerElement.append(faviconElement, titleElement);
    item.append(headerElement);
    itemRow.append(item);
    if (canDeleteHistory) {
      const deleteButton = $<HTMLElementTagNameMap['button']>('button.comet-editor-browser-library-item-delete-btn.comet-btn-base.comet-btn-md') as HTMLButtonElement;
      const deleteLabel = this.getDeleteHistoryEntryLabel();
      deleteButton.type = 'button';
      deleteButton.title = deleteLabel;
      deleteButton.setAttribute('aria-label', deleteLabel);
      deleteButton.append(createLxIcon('trash'));
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleLibraryItemDelete(url);
      });
      itemRow.append(deleteButton);
    }
    return itemRow;
  }

  private openFavoriteItemContextMenu(
    event: MouseEvent,
    itemState: BrowserLibraryListItem,
  ) {
    this.contextMenuService.showContextMenu({
      getAnchor: () => createMouseContextMenuAnchor(event),
      getActions: () => [
        {
          value: 'open',
          label: String(this.context.labels.contextOpen ?? 'Open'),
        },
        {
          value: 'open-in-new-tab',
          label: String(this.context.labels.contextOpenInNewTab ?? 'Open in New Tab'),
          disabled: !this.context.onOpenEditor,
        },
        {
          value: 'new-folder',
          label: String(this.context.labels.contextNewFolder ?? 'New Folder'),
          disabled: !this.context.onRequestCreateFavoriteFolder,
        },
        {
          value: 'rename',
          label: String(this.context.labels.contextRename ?? 'Rename'),
          disabled: !this.context.onRequestRenameFavorite,
        },
        {
          value: 'remove-favorite',
          label: String(
            this.context.labels.contextRemoveFavorite ?? 'Remove Favorite',
          ),
        },
      ],
      getMenuData: () => 'editor-browser-library-favorite-item',
      alignment: 'start',
      onSelect: (value) => {
        switch (value) {
          case 'open':
            this.handleLibraryItemClick(itemState.url);
            break;
          case 'open-in-new-tab':
            this.handleFavoriteItemOpenInNewTab(itemState.url);
            break;
          case 'new-folder':
            void this.handleFavoriteItemCreateFolder(itemState);
            break;
          case 'rename':
            void this.handleFavoriteItemRename(itemState);
            break;
          case 'remove-favorite':
            this.handleFavoriteItemRemove(itemState.url);
            break;
        }
      },
    });
  }

  private getOrCreateListElement() {
    if (this.listElement) {
      return this.listElement;
    }

const listElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-list');
    this.listElement = listElement;
    this.bodyElement.append(listElement);
    return listElement;
  }

  private getOrCreateEmptyStateElement() {
    if (this.emptyStateElement) {
      return this.emptyStateElement;
    }

    this.emptyStateElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-browser-library-empty');
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

const emptyIconElement = createLxIcon(iconName, 'comet-editor-browser-library-empty-icon');
    const emptyLabelElement = $<HTMLElementTagNameMap['p']>('p.comet-editor-browser-library-empty-label', undefined, label);
    emptyStateElement.replaceChildren(emptyIconElement, emptyLabelElement);
    emptyStateElement.dataset.state = nextStateSignature;
  }
}
