/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import { createAgentHostClientConnectionId } from 'cs/platform/agentHost/common/identities';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { DesktopChatArticleBrowserService } from 'cs/sessions/contrib/browserView/electron-browser/chatArticleBrowserService';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import type { IBrowserViewLoadingEvent } from 'cs/platform/browserView/common/browserView';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import type { IUntypedEditorInput } from 'cs/workbench/common/editor';

function createBrowserInput(model: IBrowserViewModel): BrowserEditorInput {
	const input = Object.create(BrowserEditorInput.prototype) as BrowserEditorInput;
	Object.defineProperty(input, 'resolve', { value: async () => model });
	return input;
}

test('Chat Article Browser binds the exact originating Chat to the committed Browser document epoch', async () => {
	const loadingEmitter = new Emitter<IBrowserViewLoadingEvent>();
	const closeEmitter = new Emitter<void>();
	const disposeEmitter = new Emitter<void>();
	let loading = true;
	let captureCount = 0;
	const model = {
		id: 'browser-article-exact',
		get loading() { return loading; },
		error: undefined,
		onDidChangeLoadingState: loadingEmitter.event,
		onDidClose: closeEmitter.event,
		onWillDispose: disposeEmitter.event,
		captureDocumentIdentity: async () => {
			captureCount += 1;
			return {
				documentEpoch: 'article-document-epoch-1',
				url: 'https://example.com/articles/exact',
			};
		},
	} as unknown as IBrowserViewModel;
	const browserInput = createBrowserInput(model);
	const openedInputs: IUntypedEditorInput[] = [];
	const acquiredChats: URI[] = [];
	const targetBatches: Array<{ resource: URI; targets: readonly IAgentHostInteractionTarget[] }> = [];
	const service = new DesktopChatArticleBrowserService(
		{
			acquireModel: (resource: URI) => {
				acquiredChats.push(resource);
				return { dispose() {} };
			},
			addInteractionTargets: (resource: URI, targets: readonly IAgentHostInteractionTarget[]) => {
				targetBatches.push({ resource, targets });
			},
		} as never,
		{
			openEditor: async (input: IUntypedEditorInput) => {
				openedInputs.push(input);
				return browserInput;
			},
		} as never,
		{
			connection: createAgentHostClientConnectionId('article-browser-client'),
		} as never,
	);
	const chatResource = URI.parse('chat:/article-origin');
	const opening = service.open({
		chatResource,
		articleId: 'article:exact',
		uri: URI.parse('https://example.com/articles/exact'),
	});
	await Promise.resolve();
	assert.equal(captureCount, 0);

	loading = false;
	loadingEmitter.fire({ loading: false });
	await opening;

	assert.deepEqual(acquiredChats, [chatResource]);
	assert.equal(openedInputs.length, 1);
	assert.equal(openedInputs[0]?.options?.viewState?.url, 'https://example.com/articles/exact');
	assert.ok(openedInputs[0]?.resource && BrowserViewUri.getId(openedInputs[0].resource));
	assert.equal(captureCount, 1);
	assert.deepEqual(targetBatches.map(batch => batch.resource), [chatResource]);
	const target = targetBatches.at(0)?.targets.at(0);
	assert.equal(target?.resource, 'browser-article-exact');
	assert.equal(target?.resourceVersion, 'article-document-epoch-1');
	assert.equal(target?.authority.kind, 'client');
	assert.equal(
		target?.authority.kind === 'client' ? target.authority.connection : undefined,
		'article-browser-client',
	);
	loadingEmitter.dispose();
	closeEmitter.dispose();
	disposeEmitter.dispose();
});

test('Chat Article Browser fails a closed loading document without publishing a target', async () => {
	const loadingEmitter = new Emitter<IBrowserViewLoadingEvent>();
	const closeEmitter = new Emitter<void>();
	const disposeEmitter = new Emitter<void>();
	let markCloseSubscription!: () => void;
	const closeSubscribed = new Promise<void>(resolve => { markCloseSubscription = resolve; });
	const model = {
		id: 'browser-article-closed',
		loading: true,
		error: undefined,
		onDidChangeLoadingState: loadingEmitter.event,
		onDidClose: (listener: () => unknown) => {
			markCloseSubscription();
			return closeEmitter.event(listener);
		},
		onWillDispose: disposeEmitter.event,
		captureDocumentIdentity: async () => {
			throw new Error('A closed Browser document must not be captured.');
		},
	} as unknown as IBrowserViewModel;
	const targetBatches: IAgentHostInteractionTarget[][] = [];
	const service = new DesktopChatArticleBrowserService(
		{
			acquireModel: () => ({ dispose() {} }),
			addInteractionTargets: (_resource: URI, targets: readonly IAgentHostInteractionTarget[]) => {
				targetBatches.push([...targets]);
			},
		} as never,
		{ openEditor: async () => createBrowserInput(model) } as never,
		{ connection: createAgentHostClientConnectionId('article-browser-client') } as never,
	);
	const opening = service.open({
		chatResource: URI.parse('chat:/article-origin'),
		articleId: 'article:closed',
		uri: URI.parse('https://example.com/articles/closed'),
	});
	await closeSubscribed;
	closeEmitter.fire();
	await assert.rejects(opening, /closed before its document committed/);
	assert.deepEqual(targetBatches, []);
	loadingEmitter.dispose();
	closeEmitter.dispose();
	disposeEmitter.dispose();
});

test('Chat Article Browser rejects a non-Browser result without publishing a target', async () => {
	const targetBatches: IAgentHostInteractionTarget[][] = [];
	const service = new DesktopChatArticleBrowserService(
		{
			acquireModel: () => ({ dispose() {} }),
			addInteractionTargets: (_resource: URI, targets: readonly IAgentHostInteractionTarget[]) => {
				targetBatches.push([...targets]);
			},
		} as never,
		{ openEditor: async () => ({}) } as never,
		{ connection: createAgentHostClientConnectionId('article-browser-client') } as never,
	);
	await assert.rejects(service.open({
		chatResource: URI.parse('chat:/article-origin'),
		articleId: 'article:wrong-editor',
		uri: URI.parse('https://example.com/articles/wrong-editor'),
	}), /did not open in a Browser Editor/);
	assert.deepEqual(targetBatches, []);
});
