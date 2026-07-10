/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { FetchErrorCode, getFetchErrorCode, getFetchErrorDetails } from 'cs/workbench/services/fetch/common/fetchErrors';
import { FetchArticleDetailService } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';
import { FetchPageSession } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import type { FetchPageSessionRuntime } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';

function createRuntime(calls: string[]) {
	let targetExists = false;
	let presentation: 'background' | 'editor' = 'background';
	let currentUri = URI.parse('https://example.com/');
	const runtime: FetchPageSessionRuntime & { showEditor(): void } = {
		hasTarget() {
			return targetExists;
		},
		async ensureTarget(resource) {
			targetExists = true;
			calls.push(`ensure:${BrowserViewUri.getId(resource)}`);
		},
		getPresentation() {
			return presentation;
		},
		async loadUri(_resource, uri) {
			currentUri = uri;
			calls.push(`load:${uri.toString(true)}`);
		},
		async getSnapshot() {
			return {
				url: currentUri.toString(true),
				html: '<html><body>ready</body></html>',
				statusCode: 200,
				captureMs: 1,
				isLoading: false,
				documentReadyState: 'complete',
			};
		},
		async destroyTarget(resource) {
			targetExists = false;
			calls.push(`destroy:${BrowserViewUri.getId(resource)}`);
		},
		showEditor() {
			presentation = 'editor';
		},
	};
	return runtime;
}

test('background PageSession owns, loads, and releases one hidden page target', async () => {
	const calls: string[] = [];
	const runtime = createRuntime(calls);
	const session = new FetchPageSession(runtime, 'background', {
		onBrowserEditorRequired() {
			calls.push('require-editor');
		},
	});
	const uri = URI.parse('https://example.com/articles');
	const snapshot = await session.load(uri, {
		timeoutMs: 1000,
		admitSnapshot: () => ({ ready: true }),
	});
	await session.dispose();

	assert.equal(snapshot.presentation, 'background');
	assert.equal(snapshot.requestedUri.toString(true), uri.toString(true));
	assert.equal(calls.includes('require-editor'), false);
	assert.deepEqual(calls.map(call => call.split(':')[0]), ['ensure', 'load', 'destroy']);
});

test('browser-editor PageSession requests presentation once and reuses the page target', async () => {
	const calls: string[] = [];
	const runtime = createRuntime(calls);
	const session = new FetchPageSession(runtime, 'browserEditor', {
		onBrowserEditorRequired(resource, uri) {
			calls.push(`require:${BrowserViewUri.getId(resource)}:${uri.toString(true)}`);
			runtime.showEditor();
		},
	});
	await session.load(URI.parse('https://www.science.org/toc/science/current'), {
		timeoutMs: 1000,
		admitSnapshot: () => ({ ready: true }),
	});
	await session.load(URI.parse('https://www.science.org/doi/10.1126/example'), {
		timeoutMs: 1000,
		admitSnapshot: () => ({ ready: true }),
	});
	await session.dispose();

	assert.equal(calls.filter(call => call.startsWith('require:')).length, 1);
	assert.equal(calls.filter(call => call.startsWith('load:')).length, 2);
	assert.equal(calls.some(call => call.startsWith('destroy:')), false);
});

test('background PageSession never requests browser-editor presentation', async () => {
	const calls: string[] = [];
	const runtime = createRuntime(calls);
	runtime.loadUri = async () => {
		throw new Error('navigation failed');
	};
	const session = new FetchPageSession(runtime, 'background', {
		onBrowserEditorRequired() {
			calls.push('require-editor');
		},
	});
	await assert.rejects(() => session.load(URI.parse('https://example.com'), {
		timeoutMs: 1000,
		admitSnapshot: () => ({ ready: true }),
	}));
	assert.equal(calls.includes('require-editor'), false);
});

test('PageSession waits for an admitted content fingerprint to remain stable', async () => {
	const calls: string[] = [];
	const runtime = createRuntime(calls);
	const snapshots = [
		'<html><body>loading</body></html>',
		'<html><body>accepted first section</body></html>',
		'<html><body>accepted first and second sections</body></html>',
		'<html><body>accepted first and second sections</body></html>',
	];
	let snapshotIndex = 0;
	runtime.getSnapshot = async () => ({
		url: 'https://example.com/article',
		html: snapshots[Math.min(snapshotIndex++, snapshots.length - 1)],
		statusCode: 200,
		documentReadyState: 'complete',
	});
	const session = new FetchPageSession(runtime, 'background', {
		onBrowserEditorRequired() {},
	});
	const snapshot = await session.load(URI.parse('https://example.com/article'), {
		timeoutMs: 2500,
		settleMs: 350,
		admitSnapshot: candidate => candidate.html.includes('accepted')
			? { ready: true, stabilityKey: candidate.html }
			: { ready: false, rejection: new Error('Article content is incomplete.') },
	});
	await session.dispose();

	assert.match(snapshot.html, /second sections/);
	assert.ok(snapshotIndex >= 4);
});

test('background article admission reports a bare access gate without waiting for parser structure', async () => {
	const calls: string[] = [];
	const runtime = createRuntime(calls);
	runtime.getSnapshot = async () => ({
		url: 'https://www.science.org/doi/10.1126/science.gated',
		html: '<html><body><div id="challenge-running">Checking your browser. Cloudflare Ray ID 123.</div><script src="/cdn-cgi/challenge-platform/test"></script></body></html>',
		statusCode: 403,
		documentReadyState: 'complete',
	});
	const session = new FetchPageSession(runtime, 'background', {
		onBrowserEditorRequired() {},
	});
	const service = new FetchArticleDetailService();
	await assert.rejects(
		() => service.fetchArticleDetail({
			sourceUri: URI.parse('https://www.science.org/doi/10.1126/science.gated'),
			pageSession: session,
			backgroundTimeoutMs: 2000,
			browserEditorTimeoutMs: 2000,
		}),
		(error) => {
			assert.equal(getFetchErrorCode(error), FetchErrorCode.ArticlePageRejected);
			assert.equal(
				(getFetchErrorDetails(error)?.proof as { accessGate?: unknown } | undefined)?.accessGate,
				'cloudflareChallenge',
			);
			return true;
		},
	);
	await session.dispose();
});

test('PageSession rejects loads after disposal without recreating its target', async () => {
	const calls: string[] = [];
	const runtime = createRuntime(calls);
	const session = new FetchPageSession(runtime, 'background', {
		onBrowserEditorRequired() {},
	});
	await session.load(URI.parse('https://example.com/first'), {
		timeoutMs: 1000,
		admitSnapshot: () => ({ ready: true }),
	});
	await session.dispose();
	await assert.rejects(
		() => session.load(URI.parse('https://example.com/after-dispose'), {
			timeoutMs: 1000,
			admitSnapshot: () => ({ ready: true }),
		}),
		(error) => getFetchErrorDetails(error)?.status === 'SESSION_DISPOSED',
	);
	assert.equal(calls.filter(call => call.startsWith('ensure:')).length, 1);
});
