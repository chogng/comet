import type { INativeHostService } from 'cs/platform/native/common/native';

export type ContentEditorPaneViewState = {
  url: string;
  scrollX: number;
  scrollY: number;
};

export const WEB_CONTENT_VIEW_STATE_CAPTURE_SCRIPT_MARKER =
  'cs-web-content-view-state:capture';
export const WEB_CONTENT_VIEW_STATE_RESTORE_SCRIPT_MARKER =
  'cs-web-content-view-state:restore';

const CAPTURE_WEB_CONTENT_VIEW_STATE_SCRIPT = String.raw`(() => {
  /* cs-web-content-view-state:capture */
  try {
    const root =
      document.scrollingElement ??
      document.documentElement ??
      document.body;
    const scrollX = Math.max(
      0,
      Number(window.scrollX) ||
        Number(root?.scrollLeft) ||
        0,
    );
    const scrollY = Math.max(
      0,
      Number(window.scrollY) ||
        Number(root?.scrollTop) ||
        0,
    );

    return {
      url: String(location.href ?? ''),
      scrollX,
      scrollY,
    };
  } catch {
    return null;
  }
})()`;

function isContentEditorPaneViewState(
  value: unknown,
): value is ContentEditorPaneViewState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ContentEditorPaneViewState>;
  return (
    typeof candidate.url === 'string' &&
    Number.isFinite(candidate.scrollX) &&
    Number.isFinite(candidate.scrollY)
  );
}

function normalizeContentEditorPaneViewState(
  value: ContentEditorPaneViewState,
): ContentEditorPaneViewState {
  return {
    url: value.url.trim(),
    scrollX: Math.max(0, Math.trunc(value.scrollX)),
    scrollY: Math.max(0, Math.trunc(value.scrollY)),
  };
}

function createRestoreWebContentViewStateScript(
  viewState: ContentEditorPaneViewState,
) {
  const normalizedViewState = normalizeContentEditorPaneViewState(viewState);
  return `(() => {
    /* ${WEB_CONTENT_VIEW_STATE_RESTORE_SCRIPT_MARKER} */
    try {
      const viewState = ${JSON.stringify(normalizedViewState)};
      const currentUrl = String(location.href ?? '');
      if (viewState.url && currentUrl && currentUrl !== viewState.url) {
        return false;
      }

      const left = Math.max(0, Number(viewState.scrollX) || 0);
      const top = Math.max(0, Number(viewState.scrollY) || 0);
      const root =
        document.scrollingElement ??
        document.documentElement ??
        document.body;

      window.scrollTo(left, top);
      if (root) {
        root.scrollLeft = left;
        root.scrollTop = top;
      }

      const actualLeft = Math.max(
        0,
        Number(window.scrollX) ||
          Number(root?.scrollLeft) ||
          0,
      );
      const actualTop = Math.max(
        0,
        Number(window.scrollY) ||
          Number(root?.scrollTop) ||
          0,
      );

      return Math.abs(actualLeft - left) < 2 && Math.abs(actualTop - top) < 2;
    } catch {
      return false;
    }
  })()`;
}

export async function captureContentEditorPaneViewState(
  targetId: string | null | undefined,
  nativeHost: INativeHostService,
) {
  const executeJavaScript = nativeHost.webContent?.executeJavaScript;
  if (typeof executeJavaScript !== 'function') {
    return undefined;
  }

  try {
    const capturedState = await executeJavaScript(
      targetId,
      CAPTURE_WEB_CONTENT_VIEW_STATE_SCRIPT,
      500,
    );
    return isContentEditorPaneViewState(capturedState)
      ? normalizeContentEditorPaneViewState(capturedState)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function restoreContentEditorPaneViewState(
  targetId: string | null | undefined,
  viewState: ContentEditorPaneViewState | undefined,
  nativeHost: INativeHostService,
) {
  const executeJavaScript = nativeHost.webContent?.executeJavaScript;
  if (!viewState || typeof executeJavaScript !== 'function') {
    return false;
  }

  try {
    return (
      (await executeJavaScript<boolean>(
        targetId,
        createRestoreWebContentViewStateScript(viewState),
        500,
      )) === true
    );
  } catch {
    return false;
  }
}
