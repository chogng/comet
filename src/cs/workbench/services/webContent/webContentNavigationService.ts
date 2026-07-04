import type { WebContentState } from 'cs/platform/browserView/common/browserView';
import { normalizeUrl } from 'cs/workbench/common/url';

export const EMPTY_WEB_CONTENT_STATE: WebContentState = {
  targetId: null,
  activeTargetId: null,
  ownership: 'inactive',
  layoutPhase: 'hidden',
  url: '',
  pageTitle: '',
  faviconUrl: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  visible: false,
};

export type WebContentNavigationResult =
  | { kind: 'invalid-url' }
  | { kind: 'content-runtime-unavailable'; normalizedUrl: string }
  | { kind: 'webcontents-content'; normalizedUrl: string };

export type WebContentRefreshMode =
  | 'content-runtime-unavailable'
  | 'webcontents-content';

export type WebContentStateUrlUpdate = {
  browserUrl: string;
  webUrl: string;
  fetchSeedUrl: string;
};

export function resolveWebContentNavigation(
  nextUrl: string,
  electronRuntime: boolean,
  webContentRuntime: boolean,
): WebContentNavigationResult {
  const normalizedUrl = normalizeUrl(nextUrl);
  if (!normalizedUrl) {
    return { kind: 'invalid-url' };
  }

  if (!electronRuntime || !webContentRuntime) {
    return {
      kind: 'content-runtime-unavailable',
      normalizedUrl,
    };
  }

  return {
    kind: 'webcontents-content',
    normalizedUrl,
  };
}

export function resolveWebContentRefreshMode(
  electronRuntime: boolean,
  webContentRuntime: boolean,
): WebContentRefreshMode {
  if (!electronRuntime || !webContentRuntime) {
    return 'content-runtime-unavailable';
  }

  return 'webcontents-content';
}

export function resolveWebContentStateUrlUpdate(
  webContentState: WebContentState,
): WebContentStateUrlUpdate | null {
  if (!webContentState.url) {
    return null;
  }

  return {
    browserUrl: webContentState.url,
    webUrl: webContentState.url,
    fetchSeedUrl: webContentState.url,
  };
}
