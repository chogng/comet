import { BrowserWindow } from 'electron';
import {
  getWebContentDocumentSnapshot,
  getWebContentListingCandidateSnapshot,
  getWebContentState,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import { createAuxiliaryWindow } from 'cs/platform/windows/electron-main/windows';
import { appError, isAppError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import {
  SCIENCE_DOWNLOAD_CONTROL_SELECTORS,
  SCIENCE_VALIDATION_ACCEPT,
  SCIENCE_VALIDATION_ACCEPT_LANGUAGE,
  SCIENCE_VALIDATION_BOOT_TIMEOUT_MS,
  SCIENCE_VALIDATION_HTML_SCRIPT,
  SCIENCE_VALIDATION_LOG_ENABLED,
  SCIENCE_VALIDATION_POLL_MS,
  SCIENCE_VALIDATION_PROGRESS_LOG_INTERVAL_MS,
  SCIENCE_VALIDATION_REVEAL_DELAY_MS,
  SCIENCE_VALIDATION_STATE_SCRIPT,
  SCIENCE_VALIDATION_TIMEOUT_MS,
  SCIENCE_VALIDATION_USER_AGENT,
} from 'cs/platform/window/electron-main/scienceValidationShared';
import { buildScienceValidationStateSignature, extractTitleFromHtml, isScienceChallengeHtml, isScienceHostUrl, isScienceSeriesListingPageUrl, isScienceValidationReadyState, isScienceValidationStableReadyState, matchesScienceComparableUrl, matchesScienceNavigationComparableUrl, summarizeScienceValidationHtml } from 'cs/code/electron-main/fetch/scienceValidationRules';
import type { ScienceValidationResult, ScienceValidationWindowState } from 'cs/code/electron-main/fetch/scienceValidationRules';

// This module owns the auxiliary validation window lifecycle.
// Site-specific readiness/challenge decisions live in code/electron-main/fetch.
export {
  getScienceChallengeSignal,
  isScienceChallengeHtml,
  isScienceHostUrl,
  isScienceSeriesListingPageUrl,
  shouldAllowScienceWebContentWhileLoading,
  shouldUseScienceValidationRenderFallback,
} from 'cs/code/electron-main/fetch/scienceValidationRules';

function logScienceValidation(stage: string, details: Record<string, unknown>) {
  if (!SCIENCE_VALIDATION_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[science-validation] ${stage} ${encodedDetails}`);
}

let scienceValidationWindow: BrowserWindow | null = null;
const scienceValidationPromiseByUrl = new Map<string, Promise<ScienceValidationResult>>();
const sciencePageValidationPromiseByUrl = new Map<string, Promise<ScienceValidationResult>>();
const SCIENCE_VALIDATION_WINDOW_CLOSED_STATUS_TEXT =
  'Science validation window was closed before verification completed.';

async function tryUseExistingScienceWebContent(pageUrl: string): Promise<ScienceValidationResult | null> {
  const webContentState = getWebContentState();
  const webContentUrl = cleanText(webContentState.url);
  if (!webContentUrl || !matchesScienceComparableUrl(webContentUrl, pageUrl)) {
    return null;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < SCIENCE_VALIDATION_TIMEOUT_MS) {
    const currentState = getWebContentState();
    const currentWebContentUrl = cleanText(currentState.url);
    if (!currentWebContentUrl || !matchesScienceComparableUrl(currentWebContentUrl, pageUrl)) {
      return null;
    }

    const [extraction, snapshot] = await Promise.all([
      getWebContentListingCandidateSnapshot({
        timeoutMs: Math.min(1200, SCIENCE_VALIDATION_POLL_MS * 2),
      }),
      getWebContentDocumentSnapshot({
        timeoutMs: Math.min(1200, SCIENCE_VALIDATION_POLL_MS * 2),
      }),
    ]);

    const extractionUrl = cleanText(extraction?.webContentUrl);
    const snapshotUrl = cleanText(snapshot?.url);
    const matchesExtraction = extractionUrl && matchesScienceComparableUrl(extractionUrl, pageUrl);
    const matchesSnapshot = snapshotUrl && matchesScienceComparableUrl(snapshotUrl, pageUrl);
    const html = matchesSnapshot ? String(snapshot?.html ?? '') : '';
    const title = matchesSnapshot ? extractTitleFromHtml(html) : '';
    const diagnostics = extraction?.extraction?.diagnostics;
    const sectionCount =
      matchesExtraction && diagnostics && typeof diagnostics === 'object'
        ? Number((diagnostics as Record<string, unknown>).sectionCount) || 0
        : 0;

    if (
      matchesExtraction &&
      matchesSnapshot &&
      sectionCount > 0 &&
      cleanText(html) &&
      !isScienceChallengeHtml(html)
    ) {
      return {
        finalUrl: snapshotUrl || extractionUrl || pageUrl,
        html,
        sectionCount,
        title,
        readyMs: Date.now() - startedAt,
        navigationMode: 'web-content-existing',
        source: 'web-content',
      };
    }

    await new Promise((resolve) => setTimeout(resolve, SCIENCE_VALIDATION_POLL_MS));
  }

  return null;
}

function applyWindowChrome(window: BrowserWindow) {
  if (typeof window.removeMenu === 'function') {
    window.removeMenu();
  } else {
    window.setMenuBarVisibility(false);
  }
}

function applyScienceValidationUserAgent(window: BrowserWindow) {
  if (process.env.SCIENCE_VALIDATION_USER_AGENT_MODE !== 'override') {
    return;
  }

  try {
    window.webContents.setUserAgent?.(SCIENCE_VALIDATION_USER_AGENT);
  } catch {
    // Ignore user-agent override failures and continue with the default agent.
  }
}

function createScienceValidationWindow() {
  if (scienceValidationWindow && !scienceValidationWindow.isDestroyed()) {
    return scienceValidationWindow;
  }

  scienceValidationWindow = createAuxiliaryWindow({
    modal: false,
    show: false,
    skipTaskbar: false,
    width: 1180,
    height: 880,
    minWidth: 980,
    minHeight: 720,
    title: 'Science Validation',
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fb',
    webPreferences: {
      partition: WORKBENCH_SHARED_WEB_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  applyWindowChrome(scienceValidationWindow);
  applyScienceValidationUserAgent(scienceValidationWindow);
  scienceValidationWindow.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  scienceValidationWindow.on('closed', () => {
    scienceValidationWindow = null;
  });

  return scienceValidationWindow;
}

function revealScienceValidationWindow(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
}

type ScienceValidationScriptOptions = {
  abortSignal?: AbortSignal;
  pageUrl?: string;
};

function isScienceValidationClosedError(error: unknown) {
  if (!isAppError(error) || error.code !== 'HTTP_REQUEST_FAILED') {
    return false;
  }

  const status = cleanText(String(error.details?.status ?? '')).toUpperCase();
  const statusText = cleanText(String(error.details?.statusText ?? ''));
  return (
    status === 'SCIENCE_VALIDATION_REQUIRED' &&
    statusText === SCIENCE_VALIDATION_WINDOW_CLOSED_STATUS_TEXT
  );
}

async function executeScienceValidationScript(
  window: BrowserWindow,
  script: string,
  options: ScienceValidationScriptOptions = {},
) {
  const { abortSignal, pageUrl = '' } = options;
  if (abortSignal?.aborted || window.isDestroyed() || window.webContents.isDestroyed()) {
    throw toScienceValidationClosedError(pageUrl);
  }

  const frame = window.webContents.mainFrame;
  if (!frame || frame.isDestroyed()) {
    if (abortSignal?.aborted || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw toScienceValidationClosedError(pageUrl);
    }
    return null;
  }

  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (!window.isDestroyed()) {
        window.removeListener('closed', handleClosed);
      }
      abortSignal?.removeEventListener('abort', handleAbort);
    };

    const resolveOnce = (value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleClosed = () => {
      rejectOnce(toScienceValidationClosedError(pageUrl));
    };

    const handleAbort = () => {
      rejectOnce(toScienceValidationClosedError(pageUrl));
    };

    window.on('closed', handleClosed);
    abortSignal?.addEventListener('abort', handleAbort, { once: true });

    if (abortSignal?.aborted || window.isDestroyed() || window.webContents.isDestroyed()) {
      handleAbort();
      return;
    }

    frame.executeJavaScript(script, true).then(resolveOnce, rejectOnce);
  });
}

function buildScienceDownloadTriggerScript(downloadUrl: string) {
  const serializedDownloadUrl = JSON.stringify(downloadUrl);
  return `(() => {
    const resolvedUrl = new URL(${serializedDownloadUrl}, location.href).toString();
    const normalizeComparableUrl = (value) => {
      try {
        const parsed = new URL(String(value ?? ''), location.href);
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return '';
      }
    };
    const expectedUrl = normalizeComparableUrl(resolvedUrl);
    const preferredSelectors = ${JSON.stringify(SCIENCE_DOWNLOAD_CONTROL_SELECTORS)};
    const preferredAnchors = preferredSelectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)),
    );
    const matchedAnchor =
      preferredAnchors.find((candidate) => normalizeComparableUrl(candidate.href) === expectedUrl) ||
      preferredAnchors[0] ||
      null;
    if (matchedAnchor) {
      matchedAnchor.scrollIntoView?.({ block: 'center', inline: 'center' });
      matchedAnchor.click();
      return matchedAnchor.href;
    }

    const root = document.body || document.documentElement;
    if (!root) {
      throw new Error('Science download page is not ready.');
    }

    const anchor = document.createElement('a');
    anchor.href = resolvedUrl;
    anchor.target = '_self';
    anchor.rel = 'noopener';
    anchor.style.position = 'fixed';
    anchor.style.left = '-9999px';
    anchor.style.top = '-9999px';
    anchor.style.width = '1px';
    anchor.style.height = '1px';
    anchor.style.opacity = '0';
    root.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
    }, 1000);

    return anchor.href;
  })()`;
}

export async function triggerSciencePdfDownloadInValidationWindow(
  window: BrowserWindow,
  downloadUrl: string,
  options: ScienceValidationScriptOptions = {},
) {
  return await executeScienceValidationScript(
    window,
    buildScienceDownloadTriggerScript(downloadUrl),
    options,
  );
}

async function inspectScienceValidationWindow(
  window: BrowserWindow,
  options: ScienceValidationScriptOptions = {},
) {
  try {
    const state = await executeScienceValidationScript(
      window,
      SCIENCE_VALIDATION_STATE_SCRIPT,
      options,
    );
    if (!state || typeof state !== 'object') {
      return null;
    }

    const current = state as Record<string, unknown>;
    return {
      currentUrl: cleanText(current.currentUrl),
      title: cleanText(current.title),
      documentReadyState: cleanText(current.documentReadyState),
      visibilityState: cleanText(current.visibilityState),
      bodyTextSample: cleanText(current.bodyTextSample),
      sectionCount: Number(current.sectionCount) || 0,
      hasChallengeIndicators: Boolean(current.hasChallengeIndicators),
      hasDownloadControls: Boolean(current.hasDownloadControls),
      hasPdfEmbed: Boolean(current.hasPdfEmbed),
      hasRecaptchaIndicators: Boolean(current.hasRecaptchaIndicators),
      lastMutationAtMs: Number(current.lastMutationAtMs) || 0,
      hasStableReadyForListing: Boolean(current.hasStableReadyForListing),
      hasStableReadyForPage: Boolean(current.hasStableReadyForPage),
    } satisfies ScienceValidationWindowState;
  } catch (error) {
    if (isScienceValidationClosedError(error)) {
      throw error;
    }
    return null;
  }
}

async function readScienceValidationHtml(
  window: BrowserWindow,
  options: ScienceValidationScriptOptions = {},
) {
  try {
    const resolvedHtml = await executeScienceValidationScript(
      window,
      SCIENCE_VALIDATION_HTML_SCRIPT,
      options,
    );
    return typeof resolvedHtml === 'string' ? resolvedHtml : '';
  } catch (error) {
    if (isScienceValidationClosedError(error)) {
      throw error;
    }
    return '';
  }
}

function toScienceValidationClosedError(pageUrl: string) {
  return appError('HTTP_REQUEST_FAILED', {
    status: 'SCIENCE_VALIDATION_REQUIRED',
    statusText: SCIENCE_VALIDATION_WINDOW_CLOSED_STATUS_TEXT,
    url: pageUrl,
  });
}

async function waitForAbortableDelay(timeoutMs: number, abortSignal?: AbortSignal, pageUrl = '') {
  if (!abortSignal) {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return;
  }

  if (abortSignal.aborted) {
    throw toScienceValidationClosedError(pageUrl);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      abortSignal.removeEventListener('abort', handleAbort);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleAbort = () => {
      rejectOnce(toScienceValidationClosedError(pageUrl));
    };

    timeoutId = setTimeout(resolveOnce, Math.max(0, timeoutMs));
    abortSignal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function waitForScienceValidationBoot(
  window: BrowserWindow,
  pageUrl: string,
  abortSignal?: AbortSignal,
) {
  return await new Promise<'dom-ready' | 'load-finished' | 'boot-timeout'>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const webContents = window.webContents as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
    };

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (!window.isDestroyed()) {
        if (!window.webContents.isDestroyed()) {
          webContents.removeListener('dom-ready', handleDomReady);
          webContents.removeListener('did-fail-load', handleDidFailLoad);
        }
        window.removeListener('closed', handleClosed);
      }
      abortSignal?.removeEventListener('abort', handleAbort);
    };

    const resolveOnce = (mode: 'dom-ready' | 'load-finished' | 'boot-timeout') => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(mode);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleDomReady = () => {
      resolveOnce('dom-ready');
    };

    const handleDidFailLoad = (...args: unknown[]) => {
      const [, errorCodeValue, errorDescriptionValue, validatedURLValue, isMainFrameValue] = args;
      const errorCode = Number(errorCodeValue);
      const errorDescription = cleanText(errorDescriptionValue);
      const validatedURL = cleanText(validatedURLValue);
      const isMainFrame = Boolean(isMainFrameValue);
      if (!isMainFrame) return;

      rejectOnce(
        appError('HTTP_REQUEST_FAILED', {
          status: 'NETWORK_ERROR',
          statusText: `Science validation page failed to load (${errorCode}: ${errorDescription})`,
          url: validatedURL || pageUrl,
        }),
      );
    };

    const handleClosed = () => {
      rejectOnce(toScienceValidationClosedError(pageUrl));
    };

    const handleAbort = () => {
      rejectOnce(toScienceValidationClosedError(pageUrl));
    };

    timeoutId = setTimeout(() => {
      resolveOnce('boot-timeout');
    }, SCIENCE_VALIDATION_BOOT_TIMEOUT_MS);

    webContents.on('dom-ready', handleDomReady);
    webContents.on('did-fail-load', handleDidFailLoad);
    window.on('closed', handleClosed);
    abortSignal?.addEventListener('abort', handleAbort, { once: true });

    if (abortSignal?.aborted) {
      handleAbort();
      return;
    }

    applyScienceValidationUserAgent(window);
    void window.webContents.loadURL(pageUrl, {
      userAgent:
        process.env.SCIENCE_VALIDATION_USER_AGENT_MODE === 'override'
          ? SCIENCE_VALIDATION_USER_AGENT
          : undefined,
      extraHeaders:
        `accept: ${SCIENCE_VALIDATION_ACCEPT}\n` +
        `accept-language: ${SCIENCE_VALIDATION_ACCEPT_LANGUAGE}\n`,
    }).then(
      () => resolveOnce('load-finished'),
      (error) => rejectOnce(error),
    );
  });
}

export async function ensureScienceValidationWindow(pageUrl: string): Promise<ScienceValidationResult> {
  if (!isScienceSeriesListingPageUrl(pageUrl)) {
    throw appError('HTTP_REQUEST_FAILED', {
      status: 'SCIENCE_VALIDATION_UNSUPPORTED',
      statusText: 'Science validation window is only available for Science TOC pages.',
      url: pageUrl,
    });
  }

  const existing = scienceValidationPromiseByUrl.get(pageUrl);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const existingWebContentResult = await tryUseExistingScienceWebContent(pageUrl);
    if (existingWebContentResult) {
      return existingWebContentResult;
    }

    const window = createScienceValidationWindow();
    let windowClosed = false;
    const handleClosed = () => {
      windowClosed = true;
    };
    window.once('closed', handleClosed);

    try {
      const startedAt = Date.now();
      const navigationMode = await waitForScienceValidationBoot(window, pageUrl);

      while (Date.now() - startedAt < SCIENCE_VALIDATION_TIMEOUT_MS) {
        if (windowClosed || window.isDestroyed() || window.webContents.isDestroyed()) {
          throw appError('HTTP_REQUEST_FAILED', {
            status: 'SCIENCE_VALIDATION_REQUIRED',
            statusText: 'Science validation window was closed before verification completed.',
            url: pageUrl,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, SCIENCE_VALIDATION_POLL_MS));
        const state = await inspectScienceValidationWindow(window);
        if (!state) {
          continue;
        }

        const elapsed = Date.now() - startedAt;
        if (state.hasChallengeIndicators && elapsed >= SCIENCE_VALIDATION_REVEAL_DELAY_MS) {
          revealScienceValidationWindow(window);
        }

        if (!isScienceValidationReadyState(state, true)) {
          continue;
        }
        if (!isScienceValidationStableReadyState(state, true)) {
          continue;
        }

        if (state.sectionCount > 0 && !state.hasChallengeIndicators) {
          let html = '';
          try {
            const resolvedHtml = await executeScienceValidationScript(window, SCIENCE_VALIDATION_HTML_SCRIPT);
            html = typeof resolvedHtml === 'string' ? resolvedHtml : '';
          } catch {
            continue;
          }
          const normalizedHtml = html;
          if (!normalizedHtml.trim() || isScienceChallengeHtml(normalizedHtml)) {
            continue;
          }

          const result: ScienceValidationResult = {
            finalUrl: state.currentUrl || pageUrl,
            html: normalizedHtml,
            sectionCount: state.sectionCount,
            title: state.title,
            readyMs: Date.now() - startedAt,
            navigationMode,
            source: 'window',
          };

          if (!window.isDestroyed()) {
            window.webContents.stop();
            window.close();
          }

          return result;
        }
      }

      throw appError('HTTP_REQUEST_FAILED', {
        status: 'SCIENCE_VALIDATION_REQUIRED',
        statusText: 'Complete the Science verification window to continue fetching.',
        url: pageUrl,
      });
    } finally {
      if (!window.isDestroyed()) {
        window.removeListener('closed', handleClosed);
      }
    }
  })();

  scienceValidationPromiseByUrl.set(pageUrl, task);
  try {
    return await task;
  } finally {
    scienceValidationPromiseByUrl.delete(pageUrl);
  }
}

export async function ensureSciencePageValidationWindow(pageUrl: string): Promise<ScienceValidationResult> {
  if (!isScienceHostUrl(pageUrl)) {
    throw appError('HTTP_REQUEST_FAILED', {
      status: 'SCIENCE_VALIDATION_UNSUPPORTED',
      statusText: 'Science validation window is only available for Science pages.',
      url: pageUrl,
    });
  }

  if (isScienceSeriesListingPageUrl(pageUrl)) {
    return ensureScienceValidationWindow(pageUrl);
  }

  const existing = sciencePageValidationPromiseByUrl.get(pageUrl);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const window = createScienceValidationWindow();
    let windowClosed = false;
    const handleClosed = () => {
      windowClosed = true;
    };
    window.once('closed', handleClosed);

    try {
      const startedAt = Date.now();
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
      const navigationMode = await waitForScienceValidationBoot(window, pageUrl);

      while (Date.now() - startedAt < SCIENCE_VALIDATION_TIMEOUT_MS) {
        if (windowClosed || window.isDestroyed() || window.webContents.isDestroyed()) {
          throw appError('HTTP_REQUEST_FAILED', {
            status: 'SCIENCE_VALIDATION_REQUIRED',
            statusText: 'Science validation window was closed before verification completed.',
            url: pageUrl,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, SCIENCE_VALIDATION_POLL_MS));
        const state = await inspectScienceValidationWindow(window);
        if (!state) {
          continue;
        }

        const html = await readScienceValidationHtml(window);
        const hasChallenge =
          !html.trim() || isScienceChallengeHtml(html) || state.hasChallengeIndicators;
        if (hasChallenge) {
          continue;
        }
        if (!isScienceValidationReadyState(state, false)) {
          continue;
        }
        if (!isScienceValidationStableReadyState(state, false)) {
          continue;
        }

        const result: ScienceValidationResult = {
          finalUrl: state.currentUrl || pageUrl,
          html,
          sectionCount: state.sectionCount,
          title: state.title,
          readyMs: Date.now() - startedAt,
          navigationMode,
          source: 'window',
        };

        if (!window.isDestroyed()) {
          window.webContents.stop();
          window.close();
        }

        return result;
      }

      throw appError('HTTP_REQUEST_FAILED', {
        status: 'SCIENCE_VALIDATION_REQUIRED',
        statusText: 'Complete the Science verification window to continue downloading.',
        url: pageUrl,
      });
    } finally {
      if (!window.isDestroyed()) {
        window.removeListener('closed', handleClosed);
      }
    }
  })();

  sciencePageValidationPromiseByUrl.set(pageUrl, task);
  try {
    return await task;
  } finally {
    sciencePageValidationPromiseByUrl.delete(pageUrl);
  }
}

export async function withValidatedSciencePageWindow<T>(
  pageUrl: string,
  handler: (window: BrowserWindow, validation: ScienceValidationResult) => Promise<T>,
): Promise<T> {
  if (!isScienceHostUrl(pageUrl)) {
    throw appError('HTTP_REQUEST_FAILED', {
      status: 'SCIENCE_VALIDATION_UNSUPPORTED',
      statusText: 'Science validation window is only available for Science pages.',
      url: pageUrl,
    });
  }

  const requireListingContent = isScienceSeriesListingPageUrl(pageUrl);
  const pendingStatusText = requireListingContent
    ? 'Complete the Science verification window to continue fetching.'
    : 'Complete the Science verification window to continue downloading.';
  const window = createScienceValidationWindow();
  let windowClosed = false;
  let challengeRevealed = false;
  let keepWindowOpen = false;
  let lastLoggedStateSignature = '';
  let lastProgressLogAt = 0;
  let lastKnownWindowUrl =
    typeof window.webContents.getURL === 'function' ? cleanText(window.webContents.getURL()) : '';
  const closeAbortController = new AbortController();
  const handleClosed = () => {
    logScienceValidation('window_closed_abort_requested', {
      pageUrl,
      currentUrl: lastKnownWindowUrl,
    });
    windowClosed = true;
    closeAbortController.abort();
  };
  window.once('closed', handleClosed);

  try {
    const startedAt = Date.now();
    logScienceValidation('start', {
      pageUrl,
      requireListingContent,
      userAgentMode: process.env.SCIENCE_VALIDATION_USER_AGENT_MODE === 'override' ? 'override' : 'inherit',
      userAgent:
        typeof window.webContents.getUserAgent === 'function'
          ? cleanText(window.webContents.getUserAgent())
          : SCIENCE_VALIDATION_USER_AGENT,
    });
    if (!window.isDestroyed() && !requireListingContent) {
      revealScienceValidationWindow(window);
    }
      const currentWindowUrl =
        typeof window.webContents.getURL === 'function' ? cleanText(window.webContents.getURL()) : '';
      lastKnownWindowUrl = currentWindowUrl || lastKnownWindowUrl;
      const navigationMode =
        currentWindowUrl && matchesScienceNavigationComparableUrl(currentWindowUrl, pageUrl)
          ? 'reuse-existing'
        : await waitForScienceValidationBoot(window, pageUrl, closeAbortController.signal);
    if (navigationMode === 'reuse-existing') {
      logScienceValidation('reuse_existing_window', {
        pageUrl,
        currentUrl: currentWindowUrl,
      });
    }

    while (Date.now() - startedAt < SCIENCE_VALIDATION_TIMEOUT_MS) {
      if (windowClosed || window.isDestroyed() || window.webContents.isDestroyed()) {
        logScienceValidation('closed_before_ready', {
          pageUrl,
          elapsedMs: Date.now() - startedAt,
        });
        throw toScienceValidationClosedError(pageUrl);
      }

      await waitForAbortableDelay(
        SCIENCE_VALIDATION_POLL_MS,
        closeAbortController.signal,
        pageUrl,
      );
      if (windowClosed || window.isDestroyed() || window.webContents.isDestroyed()) {
        logScienceValidation('closed_before_ready', {
          pageUrl,
          elapsedMs: Date.now() - startedAt,
        });
        throw toScienceValidationClosedError(pageUrl);
      }
      const state = await inspectScienceValidationWindow(window, {
        abortSignal: closeAbortController.signal,
        pageUrl,
      });
      if (!state) {
        continue;
      }
      lastKnownWindowUrl = state.currentUrl || lastKnownWindowUrl;

      const html = await readScienceValidationHtml(window, {
        abortSignal: closeAbortController.signal,
        pageUrl,
      });
      const elapsed = Date.now() - startedAt;
      const now = Date.now();
      const stateSignature = buildScienceValidationStateSignature(state);
      if (
        stateSignature !== lastLoggedStateSignature ||
        now - lastProgressLogAt >= SCIENCE_VALIDATION_PROGRESS_LOG_INTERVAL_MS
      ) {
        lastLoggedStateSignature = stateSignature;
        lastProgressLogAt = now;
        logScienceValidation('poll_state', {
          pageUrl,
          elapsedMs: elapsed,
          currentUrl: state.currentUrl || pageUrl,
          title: state.title,
          documentReadyState: state.documentReadyState,
          visibilityState: state.visibilityState,
          sectionCount: state.sectionCount,
          hasChallengeIndicators: state.hasChallengeIndicators,
          hasDownloadControls: state.hasDownloadControls,
          hasPdfEmbed: state.hasPdfEmbed,
          hasRecaptchaIndicators: state.hasRecaptchaIndicators,
          hasStableReadyForListing: state.hasStableReadyForListing,
          hasStableReadyForPage: state.hasStableReadyForPage,
          idleForMs: state.lastMutationAtMs > 0 ? now - state.lastMutationAtMs : null,
          bodyTextSample: state.bodyTextSample,
          windowVisible: window.isVisible(),
          windowFocused: window.isFocused(),
        });
      }
      const hasChallenge = !html.trim() || isScienceChallengeHtml(html) || state.hasChallengeIndicators;
      if (hasChallenge) {
        if (elapsed >= SCIENCE_VALIDATION_REVEAL_DELAY_MS) {
          if (!challengeRevealed) {
            challengeRevealed = true;
            logScienceValidation('challenge_visible', {
              pageUrl,
              currentUrl: state.currentUrl || pageUrl,
              title: state.title,
              elapsedMs: elapsed,
              hasRecaptchaIndicators: state.hasRecaptchaIndicators,
            });
          }
          revealScienceValidationWindow(window);
        }
        continue;
      }

      if (!isScienceValidationReadyState(state, requireListingContent)) {
        continue;
      }

      if (!isScienceValidationStableReadyState(state, requireListingContent)) {
        continue;
      }

      const validation: ScienceValidationResult = {
        finalUrl: state.currentUrl || pageUrl,
        html,
        sectionCount: state.sectionCount,
        title: state.title,
        readyMs: Date.now() - startedAt,
        navigationMode,
        source: 'window',
      };

      logScienceValidation('ready', {
        pageUrl,
        finalUrl: validation.finalUrl,
        title: validation.title,
        sectionCount: validation.sectionCount,
        hasDownloadControls: state.hasDownloadControls,
        hasPdfEmbed: state.hasPdfEmbed,
        readyMs: validation.readyMs,
        navigationMode: validation.navigationMode,
      });
      return await handler(window, validation);
    }

    logScienceValidation('timeout', {
      pageUrl,
      timeoutMs: SCIENCE_VALIDATION_TIMEOUT_MS,
      requireListingContent,
      lastKnownState: await inspectScienceValidationWindow(window),
      htmlSummary: summarizeScienceValidationHtml(await readScienceValidationHtml(window)),
    });
    keepWindowOpen = true;
    logScienceValidation('manual_completion_pending', {
      pageUrl,
      currentUrl: typeof window.webContents.getURL === 'function' ? cleanText(window.webContents.getURL()) : '',
    });
    throw appError('HTTP_REQUEST_FAILED', {
      status: 'SCIENCE_VALIDATION_REQUIRED',
      statusText: `${pendingStatusText} Keep the Science window open, finish verification, then retry.`,
      url: pageUrl,
    });
  } finally {
    if (!window.isDestroyed()) {
      window.removeListener('closed', handleClosed);
      if (!keepWindowOpen) {
        window.webContents.stop();
        window.close();
      }
    }
  }
}
