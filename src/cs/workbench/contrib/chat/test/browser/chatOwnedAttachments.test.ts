/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeBase64 } from 'cs/base/common/buffer';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { URI } from 'cs/base/common/uri';
import {
	createAgentChatId,
	createAgentHostPayloadDigest,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostTurn } from 'cs/platform/agentHost/common/protocol';
import type { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import type { IQuickInputService } from 'cs/platform/quickinput/common/quickInput';
import { ChatBrowserPresentationService } from 'cs/workbench/contrib/chat/browser/chatBrowserPresentations';
import { ChatOwnedAttachmentsContribution } from 'cs/workbench/contrib/chat/browser/chatOwnedAttachments';
import { ChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { ChatTranscriptSelectionService } from 'cs/workbench/contrib/chat/browser/chatTranscriptSelections';
import { ChatListRenderer } from 'cs/workbench/contrib/chat/browser/widget/chatListRenderer';
import { maximumPendingChatAttachments } from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import type { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import type { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { locales } from 'language/locales';

const chatResource = URI.parse('chat:/owned-attachment-sources');
const pngBytes = decodeBase64(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK0YAAAAASUVORK5CYII=',
);

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function createContribution(textInput: string | undefined = undefined) {
	const chatService = new ChatService(createTestChatStorageService());
	const sources = new ChatComposerSourceService();
	const selections = new ChatTranscriptSelectionService();
	const quickInputService = {
		_serviceBrand: undefined,
		input: async () => textInput,
	} as IQuickInputService;
	const localeService = {
		_serviceBrand: undefined,
		getLocale: () => 'en' as const,
	} as IWorkbenchLocaleService;
	const languageService = {
		_serviceBrand: undefined,
		detectInitialLocale: () => 'en' as const,
		getLocaleMessages: () => locales.en,
		toDocumentLang: () => 'en',
	} as IWorkbenchLanguageService;
	const contribution = new ChatOwnedAttachmentsContribution(
		chatService,
		sources,
		selections,
		quickInputService,
		localeService,
		languageService,
	);
	const owner = chatService.createModel(chatResource, { input: 'Use exact attachments' });
	return { chatService, sources, selections, contribution, owner };
}

test('Chat-owned composer sources call the common addressed attachment API', async () => {
	const fixture = createContribution(' exact source text ');
	try {
		assert.deepEqual(fixture.sources.getSources().map(source => source.id), [
			'chat.text',
			'chat.image',
			'chat.selection',
		]);
		await fixture.sources.getSources()[0].addToComposer(chatResource);
		assert.deepEqual(
			(fixture.owner.object.getSnapshot().pendingAttachments[0].state as { readonly text: string }).text,
			' exact source text ',
		);
		fixture.chatService.clearPendingAttachments(chatResource);

		fixture.selections.setSelection(chatResource, [{
			message: 'turn-selected',
			role: 'assistant',
			text: 'selected response',
		}]);
		await fixture.sources.getSources()[2].addToComposer(chatResource);
		assert.deepEqual(fixture.owner.object.getSnapshot().pendingAttachments[0].state, {
			sourceChat: chatResource.toString(true),
			fragments: [{
				message: 'turn-selected',
				role: 'assistant',
				text: 'selected response',
			}],
		});
	} finally {
		fixture.owner.dispose();
		fixture.contribution.dispose();
	}
});

test('Chat image source keeps a mixed invalid batch atomic', async () => {
	const fixture = createContribution();
	try {
		const valid = new File([copyArrayBuffer(pngBytes.buffer)], 'pixel.png', { type: 'image/png' });
		const invalid = new File([new Uint8Array([1, 2, 3, 4]).buffer], 'broken.png', { type: 'image/png' });
		await assert.rejects(
			fixture.contribution.addImages(chatResource, [valid, invalid]),
			/not a valid PNG container/,
		);
		assert.equal(fixture.owner.object.getSnapshot().pendingAttachments.length, 0);
	} finally {
		fixture.owner.dispose();
		fixture.contribution.dispose();
	}
});

test('Chat image source checks remaining composer slots before reading selected files', async () => {
	const fixture = createContribution();
	try {
		fixture.contribution.addText(chatResource, 'Text', 'already pending');
		let readCount = 0;
		const unreadFile = {
			name: 'unread.png',
			type: 'image/png',
			size: pngBytes.byteLength,
			arrayBuffer: async () => {
				readCount += 1;
				return copyArrayBuffer(pngBytes.buffer);
			},
		} as File;
		await assert.rejects(
			fixture.contribution.addImages(
				chatResource,
				Array.from({ length: maximumPendingChatAttachments }, () => unreadFile),
			),
			/remaining 127 attachment slots/,
		);
		assert.equal(readCount, 0);
		assert.equal(fixture.owner.object.getSnapshot().pendingAttachments.length, 1);
	} finally {
		fixture.owner.dispose();
		fixture.contribution.dispose();
	}
});

test('Chat transcript renderer constructs ordered fragments only within its own selectable regions', () => {
	const renderer = new ChatListRenderer({
		markdownRendererService: { _serviceBrand: undefined } as IMarkdownRendererService,
		presentationService: new ChatBrowserPresentationService(),
	});
	const turn: IAgentHostTurn = {
		id: createAgentTurnId('turn-rendered'),
		submission: createAgentSubmissionId('submission-rendered'),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${'0'.repeat(64)}`),
		state: 'completed',
		user: {
			text: 'alpha beta',
			attachments: [],
			interactionTargets: [],
		},
		response: [{ kind: 'text', text: 'gamma delta' }],
	};
	const disposables = new DisposableStore();
	const host = document.createElement('div');
	document.body.append(host);
	try {
		renderer.beginRender();
		const rendered = renderer.renderHostTurn(
			chatResource,
			{ session: createAgentSessionId('session-rendered'), chat: createAgentChatId('chat-rendered') },
			turn,
			[],
			disposables,
			locales.en,
		);
		host.append(...rendered);
		const userText = host.querySelector('.comet-chat-message-user .comet-chat-message-text')?.firstChild;
		const assistantText = host.querySelector('.comet-chat-message-assistant .rendered-markdown p')?.firstChild;
		assert(userText);
		assert(assistantText);
		const range = document.createRange();
		range.setStart(userText, 6);
		range.setEnd(assistantText, 5);
		const selection = document.getSelection();
		assert(selection);
		selection.removeAllRanges();
		selection.addRange(range);
		assert.deepEqual(renderer.captureSelection(selection), [{
			message: 'submission-rendered',
			role: 'user',
			text: 'beta',
		}, {
			message: 'turn-rendered',
			role: 'assistant',
			text: 'gamma',
		}]);

		const foreign = document.createTextNode('foreign');
		host.append(foreign);
		const crossingRange = document.createRange();
		crossingRange.setStart(userText, 0);
		crossingRange.setEnd(foreign, foreign.textContent?.length ?? 0);
		selection.removeAllRanges();
		selection.addRange(crossingRange);
		assert.deepEqual(renderer.captureSelection(selection), []);
	} finally {
		document.getSelection()?.removeAllRanges();
		disposables.dispose();
		host.remove();
	}
});
