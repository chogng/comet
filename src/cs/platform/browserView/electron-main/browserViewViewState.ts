/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IBrowserViewViewStateEvent } from 'cs/platform/browserView/common/browserView';

export const MAX_BROWSER_VIEW_STATE_URL_LENGTH = 65_536;
export const MAX_BROWSER_VIEW_STATE_DOCUMENT_ID_LENGTH = 128;

export type BrowserViewScrollPosition = {
	readonly scrollX: number;
	readonly scrollY: number;
};

export type BrowserViewDocumentIdentity = {
	readonly documentId: string;
	readonly url: string;
};

export type BrowserViewViewStateIpcPayload = BrowserViewDocumentIdentity & BrowserViewScrollPosition;

export function parseBrowserViewDocumentIdentity(value: unknown): BrowserViewDocumentIdentity | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.length !== 2 ||
		!keys.includes('documentId') ||
		!keys.includes('url') ||
		typeof candidate.documentId !== 'string' ||
		candidate.documentId.length === 0 ||
		candidate.documentId.length > MAX_BROWSER_VIEW_STATE_DOCUMENT_ID_LENGTH ||
		typeof candidate.url !== 'string' ||
		candidate.url.length === 0 ||
		candidate.url.length > MAX_BROWSER_VIEW_STATE_URL_LENGTH
	) {
		return undefined;
	}
	return { documentId: candidate.documentId, url: candidate.url };
}

export function parseBrowserViewScrollPosition(value: unknown): BrowserViewScrollPosition | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.length !== 2 ||
		!keys.includes('scrollX') ||
		!keys.includes('scrollY') ||
		!Number.isSafeInteger(candidate.scrollX) ||
		!Number.isSafeInteger(candidate.scrollY) ||
		Number(candidate.scrollX) < 0 ||
		Number(candidate.scrollY) < 0
	) {
		return undefined;
	}
	return {
		scrollX: Number(candidate.scrollX),
		scrollY: Number(candidate.scrollY),
	};
}

export function parseBrowserViewViewState(value: unknown): IBrowserViewViewStateEvent | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.length !== 3 ||
		!keys.includes('url') ||
		!keys.includes('scrollX') ||
		!keys.includes('scrollY') ||
		typeof candidate.url !== 'string' ||
		candidate.url.length === 0 ||
		candidate.url.length > MAX_BROWSER_VIEW_STATE_URL_LENGTH
	) {
		return undefined;
	}
	const position = parseBrowserViewScrollPosition({
		scrollX: candidate.scrollX,
		scrollY: candidate.scrollY,
	});
	if (!position) {
		return undefined;
	}
	return { url: candidate.url, ...position };
}

export function parseBrowserViewViewStateIpcPayload(value: unknown): BrowserViewViewStateIpcPayload | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.length !== 4 ||
		!keys.includes('documentId') ||
		!keys.includes('url') ||
		!keys.includes('scrollX') ||
		!keys.includes('scrollY')
	) {
		return undefined;
	}
	const document = parseBrowserViewDocumentIdentity({
		documentId: candidate.documentId,
		url: candidate.url,
	});
	const position = parseBrowserViewScrollPosition({
		scrollX: candidate.scrollX,
		scrollY: candidate.scrollY,
	});
	return document && position ? { ...document, ...position } : undefined;
}

export function resolveBrowserViewDocumentIpcEvent(
	senderFrame: unknown,
	mainFrame: unknown,
	currentUrl: string,
	value: unknown,
): BrowserViewDocumentIdentity | undefined {
	if (senderFrame !== mainFrame) {
		return undefined;
	}
	const document = parseBrowserViewDocumentIdentity(value);
	return document?.url === currentUrl ? document : undefined;
}

export function resolveBrowserViewStateIpcEvent(
	senderFrame: unknown,
	mainFrame: unknown,
	expectedDocumentId: string | undefined,
	currentUrl: string,
	value: unknown,
): IBrowserViewViewStateEvent | undefined {
	if (senderFrame !== mainFrame || expectedDocumentId === undefined) {
		return undefined;
	}
	const payload = parseBrowserViewViewStateIpcPayload(value);
	if (!payload || payload.documentId !== expectedDocumentId || payload.url !== currentUrl) {
		return undefined;
	}
	return parseBrowserViewViewState({
		url: currentUrl,
		scrollX: payload.scrollX,
		scrollY: payload.scrollY,
	});
}

export function createBrowserViewStateCaptureScript(): string {
	return `(() => {
		const root = document.scrollingElement;
		if (!root) {
			throw new Error('The Browser document has no scrolling element.');
		}
		return {
			url: location.href,
			scrollX: Math.max(0, Math.trunc(window.scrollX)),
			scrollY: Math.max(0, Math.trunc(window.scrollY)),
		};
	})()`;
}

export function createBrowserViewStateRestoreScript(viewState: IBrowserViewViewStateEvent): string {
	return `(() => {
		const viewState = ${JSON.stringify(viewState)};
		if (location.href !== viewState.url) {
			return false;
		}
		const root = document.scrollingElement;
		if (!root) {
			throw new Error('The Browser document has no scrolling element.');
		}
		const maxLeft = Math.max(0, root.scrollWidth - window.innerWidth);
		const maxTop = Math.max(0, root.scrollHeight - window.innerHeight);
		if (maxLeft < viewState.scrollX || maxTop < viewState.scrollY) {
			return false;
		}
		window.scrollTo(viewState.scrollX, viewState.scrollY);
		return Math.abs(window.scrollX - viewState.scrollX) < 2
			&& Math.abs(window.scrollY - viewState.scrollY) < 2;
	})()`;
}
