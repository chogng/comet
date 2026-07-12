/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
	createBrowserViewStateCaptureScript,
	createBrowserViewStateRestoreScript,
	MAX_BROWSER_VIEW_STATE_DOCUMENT_ID_LENGTH,
	MAX_BROWSER_VIEW_STATE_URL_LENGTH,
	parseBrowserViewDocumentIdentity,
	parseBrowserViewScrollPosition,
	parseBrowserViewViewState,
	parseBrowserViewViewStateIpcPayload,
	resolveBrowserViewDocumentIpcEvent,
	resolveBrowserViewStateIpcEvent,
} from 'cs/platform/browserView/electron-main/browserViewViewState';

type ScriptWindow = {
	innerWidth: number;
	innerHeight: number;
	scrollX: number;
	scrollY: number;
	scrollTo(left: number, top: number): void;
};

function executeViewStateScript(
	script: string,
	options: {
		url: string;
		scrollWidth: number;
		scrollHeight: number;
		scrollX?: number;
		scrollY?: number;
	},
): { result: unknown; window: ScriptWindow } {
	const targetWindow: ScriptWindow = {
		innerWidth: 800,
		innerHeight: 600,
		scrollX: options.scrollX ?? 0,
		scrollY: options.scrollY ?? 0,
		scrollTo(left, top) {
			this.scrollX = left;
			this.scrollY = top;
		},
	};
	const result = runInNewContext(script, {
		location: { href: options.url },
		document: {
			scrollingElement: {
				scrollWidth: options.scrollWidth,
				scrollHeight: options.scrollHeight,
			},
		},
		window: targetWindow,
	});
	return { result, window: targetWindow };
}

test('Browser view-state parser accepts only the bounded exact wire payload', () => {
	assert.deepEqual(parseBrowserViewScrollPosition({ scrollX: 12, scrollY: 44 }), {
		scrollX: 12,
		scrollY: 44,
	});
	assert.equal(parseBrowserViewScrollPosition({ scrollX: 12.9, scrollY: 44 }), undefined);
	assert.equal(parseBrowserViewScrollPosition({ scrollX: Number.MAX_SAFE_INTEGER + 1, scrollY: 44 }), undefined);
	assert.equal(parseBrowserViewScrollPosition({ scrollX: 0, scrollY: 0, url: 'untrusted' }), undefined);
	assert.deepEqual(parseBrowserViewViewState({
		url: 'https://example.com',
		scrollX: 12,
		scrollY: 44,
	}), {
		url: 'https://example.com',
		scrollX: 12,
		scrollY: 44,
	});
	assert.equal(parseBrowserViewViewState({
		url: 'https://example.com',
		scrollX: 0,
		scrollY: 0,
		extra: true,
	}), undefined);
	assert.equal(parseBrowserViewViewState({ url: '', scrollX: 0, scrollY: 0 }), undefined);
	assert.equal(parseBrowserViewViewState({ url: 'https://example.com', scrollX: -1, scrollY: 0 }), undefined);
	assert.equal(parseBrowserViewViewState({ url: 'https://example.com', scrollX: 0, scrollY: Number.NaN }), undefined);
	assert.equal(parseBrowserViewViewState({
		url: 'x'.repeat(MAX_BROWSER_VIEW_STATE_URL_LENGTH + 1),
		scrollX: 0,
		scrollY: 0,
	}), undefined);
	assert.deepEqual(parseBrowserViewDocumentIdentity({
		documentId: 'document-1',
		url: 'https://example.com',
	}), {
		documentId: 'document-1',
		url: 'https://example.com',
	});
	assert.equal(parseBrowserViewDocumentIdentity({
		documentId: 'x'.repeat(MAX_BROWSER_VIEW_STATE_DOCUMENT_ID_LENGTH + 1),
		url: 'https://example.com',
	}), undefined);
	assert.deepEqual(parseBrowserViewViewStateIpcPayload({
		documentId: 'document-1',
		url: 'https://example.com',
		scrollX: 12,
		scrollY: 44,
	}), {
		documentId: 'document-1',
		url: 'https://example.com',
		scrollX: 12,
		scrollY: 44,
	});
	assert.equal(parseBrowserViewViewStateIpcPayload({
		documentId: 'document-1',
		url: 'https://example.com',
		scrollX: 0,
		scrollY: 0,
		extra: true,
	}), undefined);
});

test('Browser view-state IPC correlates the main-frame document before accepting coordinates', () => {
	const mainFrame = {};
	assert.deepEqual(resolveBrowserViewDocumentIpcEvent(
		mainFrame,
		mainFrame,
		'https://example.com/current',
		{ documentId: 'document-1', url: 'https://example.com/current' },
	), {
		documentId: 'document-1',
		url: 'https://example.com/current',
	});
	assert.equal(resolveBrowserViewDocumentIpcEvent(
		mainFrame,
		mainFrame,
		'https://example.com/current',
		{ documentId: 'document-1', url: 'https://example.com/previous' },
	), undefined);
	assert.deepEqual(resolveBrowserViewStateIpcEvent(
		mainFrame,
		mainFrame,
		'document-1',
		'https://example.com/current',
		{
			documentId: 'document-1',
			url: 'https://example.com/current',
			scrollX: 4,
			scrollY: 80,
		},
	), {
		url: 'https://example.com/current',
		scrollX: 4,
		scrollY: 80,
	});
	assert.equal(resolveBrowserViewStateIpcEvent(
		{},
		mainFrame,
		'document-1',
		'https://example.com/current',
		{ documentId: 'document-1', url: 'https://example.com/current', scrollX: 4, scrollY: 80 },
	), undefined);
	assert.equal(resolveBrowserViewStateIpcEvent(
		mainFrame,
		mainFrame,
		undefined,
		'https://example.com/current',
		{ documentId: 'document-1', url: 'https://example.com/current', scrollX: 4, scrollY: 80 },
	), undefined);
	assert.equal(resolveBrowserViewStateIpcEvent(
		mainFrame,
		mainFrame,
		'document-2',
		'https://example.com/current',
		{ documentId: 'document-1', url: 'https://example.com/current', scrollX: 4, scrollY: 80 },
	), undefined);
	assert.equal(resolveBrowserViewStateIpcEvent(
		mainFrame,
		mainFrame,
		'document-1',
		'https://example.com/current',
		{ documentId: 'document-1', url: 'https://example.com/previous', scrollX: 4, scrollY: 80 },
	), undefined);
});

test('Browser view-state scripts capture exact coordinates and never clamp an unreachable restore', () => {
	const captured = executeViewStateScript(createBrowserViewStateCaptureScript(), {
		url: 'https://example.com/article',
		scrollWidth: 1800,
		scrollHeight: 2400,
		scrollX: 25.8,
		scrollY: 960.9,
	});
	assert.deepEqual({ ...(captured.result as Record<string, unknown>) }, {
		url: 'https://example.com/article',
		scrollX: 25,
		scrollY: 960,
	});

	const viewState = { url: 'https://example.com/article', scrollX: 20, scrollY: 960 };
	const unreachable = executeViewStateScript(createBrowserViewStateRestoreScript(viewState), {
		url: viewState.url,
		scrollWidth: 820,
		scrollHeight: 900,
	});
	assert.equal(unreachable.result, false);
	assert.deepEqual({ x: unreachable.window.scrollX, y: unreachable.window.scrollY }, { x: 0, y: 0 });

	const restored = executeViewStateScript(createBrowserViewStateRestoreScript(viewState), {
		url: viewState.url,
		scrollWidth: 1800,
		scrollHeight: 2400,
	});
	assert.equal(restored.result, true);
	assert.deepEqual({ x: restored.window.scrollX, y: restored.window.scrollY }, { x: 20, y: 960 });
});
