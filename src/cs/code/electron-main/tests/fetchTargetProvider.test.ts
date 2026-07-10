/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ConfiguredFetchTargetProvider,
} from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';

function createDocument(
	targetMode: FetchTargetDocument['targetMode'],
	pageUrl: string,
	targetId: string | null,
): FetchTargetDocument {
	return {
		targetMode,
		targetId,
		requestedUrl: pageUrl,
		finalUrl: pageUrl,
		statusCode: 200,
		html: '<html><body>ready</body></html>',
		documentReadyState: 'complete',
	};
}

test('configured target provider keeps background sources on the hidden target', async () => {
	const calls: string[] = [];
	const pageUrl = 'https://example.com/articles';
	const provider = new ConfiguredFetchTargetProvider({
		async loadBackground(url) {
			calls.push(`background:${url}`);
			return createDocument('background', url, null);
		},
		hasWebContentsViewTarget() {
			calls.push('has-web-contents-view');
			return false;
		},
		async navigateWebContentsView() {
			calls.push('navigate-web-contents-view');
		},
		async waitForWebContentsView() {
			calls.push('wait-web-contents-view');
			return createDocument('webContentsView', pageUrl, 'unexpected');
		},
	});
	const session = provider.createSession(
		{
			sourceId: 'background-source',
			pageUrl,
			fetchTarget: 'background',
		},
		{
			onWebContentsViewRequired() {
				calls.push('require-web-contents-view');
			},
		},
	);

	const document = await session.load(pageUrl, {
		timeoutMs: 1000,
		admitWebContentsViewDocument: () => true,
	});

	assert.equal(session.targetMode, 'background');
	assert.equal(session.targetId, null);
	assert.equal(document.targetMode, 'background');
	assert.deepEqual(calls, [`background:${pageUrl}`]);
});

test('configured target provider opens and reuses one explicit WebContentsView target', async () => {
	const calls: string[] = [];
	const pageUrl = 'https://www.science.org/toc/science/current';
	let targetExists = false;
	let requiredTargetId = '';
	const provider = new ConfiguredFetchTargetProvider({
		async loadBackground(url) {
			calls.push(`background:${url}`);
			return createDocument('background', url, null);
		},
		hasWebContentsViewTarget(targetId) {
			calls.push(`has:${targetId}`);
			return targetExists;
		},
		async navigateWebContentsView(targetId, url) {
			calls.push(`navigate:${targetId}:${url}`);
		},
		async waitForWebContentsView(targetId, requestedUrl, admit) {
			calls.push(`wait:${targetId}:${requestedUrl}`);
			const document = createDocument('webContentsView', requestedUrl, targetId);
			assert.equal(admit(document), true);
			return document;
		},
	});
	const session = provider.createSession(
		{
			sourceId: 'science',
			pageUrl,
			fetchTarget: 'webContentsView',
		},
		{
			onWebContentsViewRequired(targetId, url) {
				requiredTargetId = targetId;
				calls.push(`require:${targetId}:${url}`);
			},
		},
	);

	const firstDocument = await session.load(pageUrl, {
		timeoutMs: 1000,
		admitWebContentsViewDocument: () => true,
	});
	targetExists = true;
	const articleUrl = 'https://www.science.org/doi/10.1126/example';
	const secondDocument = await session.load(articleUrl, {
		timeoutMs: 1000,
		admitWebContentsViewDocument: () => true,
	});

	assert.equal(session.targetMode, 'webContentsView');
	assert.equal(session.targetId, requiredTargetId);
	assert.equal(firstDocument.targetId, requiredTargetId);
	assert.equal(secondDocument.targetId, requiredTargetId);
	assert.equal(calls.some(call => call.startsWith('background:')), false);
	assert.equal(calls.filter(call => call.startsWith('require:')).length, 1);
	assert.equal(calls.filter(call => call.startsWith('navigate:')).length, 1);
});

test('background target failure never switches to WebContentsView', async () => {
	let visibleTargetRequested = false;
	const provider = new ConfiguredFetchTargetProvider({
		async loadBackground() {
			throw new Error('background failed');
		},
		hasWebContentsViewTarget() {
			return false;
		},
		async navigateWebContentsView() {
			visibleTargetRequested = true;
		},
		async waitForWebContentsView() {
			visibleTargetRequested = true;
			return createDocument('webContentsView', 'https://example.com', 'unexpected');
		},
	});
	const session = provider.createSession(
		{
			sourceId: 'background-source',
			pageUrl: 'https://example.com',
			fetchTarget: 'background',
		},
		{
			onWebContentsViewRequired() {
				visibleTargetRequested = true;
			},
		},
	);

	await assert.rejects(() => session.load('https://example.com', {
		timeoutMs: 1000,
		admitWebContentsViewDocument: () => true,
	}), /background failed/);
	assert.equal(visibleTargetRequested, false);
});
