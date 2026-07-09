/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { INativeHostService } from 'cs/platform/native/common/native';

export type BrowserEditorViewState = {
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

function isBrowserEditorViewState(
	value: unknown,
): value is BrowserEditorViewState {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<BrowserEditorViewState>;
	return (
		typeof candidate.url === 'string' &&
		Number.isFinite(candidate.scrollX) &&
		Number.isFinite(candidate.scrollY)
	);
}

function normalizeBrowserEditorViewState(
	value: BrowserEditorViewState,
): BrowserEditorViewState {
	return {
		url: value.url.trim(),
		scrollX: Math.max(0, Math.trunc(value.scrollX)),
		scrollY: Math.max(0, Math.trunc(value.scrollY)),
	};
}

function createRestoreWebContentViewStateScript(
	viewState: BrowserEditorViewState,
) {
	const normalizedViewState = normalizeBrowserEditorViewState(viewState);
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

export async function captureBrowserEditorViewState(
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
		return isBrowserEditorViewState(capturedState)
			? normalizeBrowserEditorViewState(capturedState)
			: undefined;
	} catch {
		return undefined;
	}
}

export async function restoreBrowserEditorViewState(
	targetId: string | null | undefined,
	viewState: BrowserEditorViewState | undefined,
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
