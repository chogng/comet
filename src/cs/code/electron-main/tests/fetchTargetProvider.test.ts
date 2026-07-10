/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { URI } from 'cs/base/common/uri';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import {
	ConfiguredFetchTargetProvider,
} from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';

function createDocument(
	resource: URI,
	targetMode: FetchTargetDocument['targetMode'],
	pageUrl: string,
): FetchTargetDocument {
	return {
		resource,
		targetMode,
		requestedUrl: pageUrl,
		finalUrl: pageUrl,
		statusCode: 200,
		html: '<html><body>ready</body></html>',
		documentReadyState: 'complete',
	};
}

test('configured target provider loads background sources through a hidden Browser target', async () => {
	const calls: string[] = [];
	const pageUrl = 'https://example.com/articles';
	let targetExists = false;
	const provider = new ConfiguredFetchTargetProvider({
		hasTarget() {
			return targetExists;
		},
		async ensureTarget(resource) {
			targetExists = true;
			calls.push(`ensure:background:${BrowserViewUri.getId(resource)}`);
		},
		async waitForEditorTarget() {
			calls.push('wait-for-editor');
		},
		async load(resource, targetMode, url, admit) {
			calls.push(`load:${targetMode}:${url}`);
			const document = createDocument(resource, targetMode, url);
			assert.equal(admit(document), true);
			return document;
		},
		async destroyTarget(resource) {
			targetExists = false;
			calls.push(`destroy:${BrowserViewUri.getId(resource)}`);
		},
	});
	const session = provider.createSession(
		{
			sourceId: 'background-source',
			pageUrl,
			fetchTarget: 'background',
		},
		{
			onBrowserTargetRequired() {
				calls.push('require-visible-target');
			},
		},
	);

	const document = await session.load(pageUrl, {
		timeoutMs: 1000,
		admitDocument: () => true,
	});
	await session.dispose();

	assert.equal(session.targetMode, 'background');
	assert.equal(BrowserViewUri.getId(session.resource), session.targetId);
	assert.equal(document.resource.toString(), session.resource.toString());
	assert.equal(document.targetMode, 'background');
	assert.equal(calls.some(call => call === 'require-visible-target'), false);
	assert.deepEqual(calls.map(call => call.split(':')[0]), ['ensure', 'load', 'destroy']);
});

test('configured target provider opens and reuses one visible Browser target', async () => {
	const calls: string[] = [];
	const pageUrl = 'https://www.science.org/toc/science/current';
	let targetExists = false;
	let editorReady = false;
	let requiredResource: URI | undefined;
	const provider = new ConfiguredFetchTargetProvider({
		hasTarget() {
			return targetExists;
		},
		async ensureTarget(resource) {
			targetExists = true;
			calls.push(`ensure:background:${BrowserViewUri.getId(resource)}`);
		},
		async waitForEditorTarget() {
			assert.equal(editorReady, true);
			calls.push('wait-for-editor');
		},
		async load(resource, targetMode, requestedUrl, admit) {
			calls.push(`load:${targetMode}:${requestedUrl}`);
			const document = createDocument(resource, targetMode, requestedUrl);
			assert.equal(admit(document), true);
			return document;
		},
		async destroyTarget() {
			calls.push(editorReady ? 'preserve-editor' : 'destroy');
		},
	});
	const session = provider.createSession(
		{
			sourceId: 'science',
			pageUrl,
			fetchTarget: 'webContentsView',
		},
		{
			onBrowserTargetRequired(resource, url) {
				requiredResource = resource;
				editorReady = true;
				calls.push(`require:${BrowserViewUri.getId(resource)}:${url}`);
			},
		},
	);

	const firstDocument = await session.load(pageUrl, {
		timeoutMs: 1000,
		admitDocument: () => true,
	});
	const articleUrl = 'https://www.science.org/doi/10.1126/example';
	const secondDocument = await session.load(articleUrl, {
		timeoutMs: 1000,
		admitDocument: () => true,
	});
	await session.dispose();

	assert.equal(session.targetMode, 'webContentsView');
	assert.equal(requiredResource?.toString(), session.resource.toString());
	assert.equal(firstDocument.resource.toString(), session.resource.toString());
	assert.equal(secondDocument.resource.toString(), session.resource.toString());
	assert.equal(calls.filter(call => call.startsWith('require:')).length, 1);
	assert.equal(calls.filter(call => call === 'wait-for-editor').length, 2);
	assert.equal(calls.filter(call => call.startsWith('load:')).length, 2);
	assert.equal(calls.includes('preserve-editor'), true);
});

test('background target failure never requests visible presentation', async () => {
	let visibleTargetRequested = false;
	const provider = new ConfiguredFetchTargetProvider({
		hasTarget() {
			return false;
		},
		async ensureTarget() {},
		async waitForEditorTarget() {},
		async load() {
			throw new Error('background failed');
		},
		async destroyTarget() {},
	});
	const session = provider.createSession(
		{
			sourceId: 'background-source',
			pageUrl: 'https://example.com',
			fetchTarget: 'background',
		},
		{
			onBrowserTargetRequired() {
				visibleTargetRequested = true;
			},
		},
	);

	await assert.rejects(() => session.load('https://example.com', {
		timeoutMs: 1000,
		admitDocument: () => true,
	}), /background failed/);
	assert.equal(visibleTargetRequested, false);
});
