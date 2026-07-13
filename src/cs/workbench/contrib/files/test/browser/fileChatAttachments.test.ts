/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import { ClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import {
	createAgentAttachmentId,
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { ChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import {
	DirectoryAttachmentProducerType,
	FileAttachmentProducerType,
	FileChatAttachmentsContribution,
} from 'cs/workbench/contrib/files/browser/fileChatAttachments';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';

const chatResource = URI.parse('chat:/file-attachments');

function createFixture() {
	const chatService = new ChatService(createTestChatStorageService());
	const contentService = new ClientContentResourceService(
		createAgentHostClientConnectionId('file-test-connection'),
		{
			maximumBlobBytes: 1024,
			maximumTreeBytes: 4096,
			maximumTreeEntries: 16,
			maximumTreeDepth: 4,
			maximumReadLength: 1024,
			maximumOpenLeases: 4,
			maximumConcurrentOperations: 2,
			maximumTotalReadBytes: 4096,
			maximumTreePageEntries: 16,
			maximumTreePages: 16,
			maximumLeaseDurationMilliseconds: 60_000,
		},
	);
	const sources = new ChatComposerSourceService();
	const contribution = new FileChatAttachmentsContribution(chatService, contentService, sources);
	const owner = chatService.createModel(chatResource, { input: 'Inspect exact content' });
	return { chatService, contentService, sources, contribution, owner };
}

function withRelativePath(file: File, path: string): File {
	Object.defineProperty(file, 'webkitRelativePath', { configurable: false, value: path });
	return file;
}

suite('FileChatAttachmentsContribution', () => {
	test('publishes each File as one retry-stable immutable blob and releases it only after acceptance', async () => {
		const fixture = createFixture();
		try {
			await fixture.contribution.attachFiles(chatResource, [
				new File(['exact bytes'], 'notes.txt', { type: 'text/plain' }),
			]);
			const pending = fixture.owner.object.getSnapshot().pendingAttachments;
			assert.equal(pending.length, 1);
			assert.equal(pending[0].producerType, FileAttachmentProducerType);

			const first = await fixture.chatService.prepareSubmission(
				chatResource,
				createAgentSubmissionId('file-rejected'),
				CancellationTokenNone,
			);
			const content = first.attachments[0].content;
			assert.equal(content?.kind, 'reference');
			assert.equal(content?.shape, 'blob');
			assert.deepEqual(first.attachments[0].representation.value, {
				name: 'notes.txt',
				mediaType: 'text/plain',
			});
			await first.reject();

			const retry = await fixture.chatService.prepareSubmission(
				chatResource,
				createAgentSubmissionId('file-accepted'),
				CancellationTokenNone,
			);
			assert.deepEqual(retry.attachments[0].content, content);
			await retry.accept();
			assert.equal(fixture.owner.object.getSnapshot().pendingAttachments.length, 0);
			assert.ok(content?.kind === 'reference');
			await assert.rejects(fixture.contentService.open({
				session: createAgentSessionId('session'),
				chat: createAgentChatId('chat'),
				turn: createAgentTurnId('turn'),
				attachment: createAgentAttachmentId('attachment'),
				content,
				limits: {
					maximumReadLength: content.bounds.maximumReadLength,
					maximumTotalReadBytes: 4096,
					maximumTreePageEntries: 16,
					maximumTreePages: 16,
					maximumConcurrentOperations: 2,
					deadline: Date.now() + 30_000,
				},
			}, CancellationTokenNone), /unavailable/);
		} finally {
			fixture.owner.dispose();
			fixture.contribution.dispose();
		}
	});

	test('publishes one Directory as an explicit bounded tree without a client-local root path', async () => {
		const fixture = createFixture();
		try {
			await fixture.contribution.attachDirectory(chatResource, [
				withRelativePath(new File(['alpha'], 'a.txt', { type: 'text/plain' }), 'project/a.txt'),
				withRelativePath(new File(['beta'], 'b.bin'), 'project/docs/b.bin'),
			]);
			const pending = fixture.owner.object.getSnapshot().pendingAttachments;
			assert.equal(pending.length, 1);
			assert.equal(pending[0].producerType, DirectoryAttachmentProducerType);

			const prepared = await fixture.chatService.prepareSubmission(
				chatResource,
				createAgentSubmissionId('directory-submission'),
				CancellationTokenNone,
			);
			const attachment = prepared.attachments[0];
			assert.deepEqual(attachment.representation.value, { name: 'project' });
			assert.equal(JSON.stringify(attachment).includes('project/'), false);
			assert.ok(attachment.content?.kind === 'reference');
			assert.equal(attachment.content.shape, 'tree');
			const lease = await fixture.contentService.open({
				session: createAgentSessionId('session'),
				chat: createAgentChatId('chat'),
				turn: createAgentTurnId('turn'),
				attachment: attachment.id,
				content: attachment.content,
				limits: {
					maximumReadLength: attachment.content.bounds.maximumReadLength,
					maximumTotalReadBytes: 4096,
					maximumTreePageEntries: 16,
					maximumTreePages: 16,
					maximumConcurrentOperations: 2,
					deadline: Date.now() + 30_000,
				},
			}, CancellationTokenNone);
			const page = await fixture.contentService.readTreePage({
				lease: lease.lease,
				cursor: null,
				maximumEntries: 16,
			}, CancellationTokenNone);
			assert.deepEqual(page.entries.map(entry => [entry.kind, entry.path, 'mediaType' in entry ? entry.mediaType : undefined]), [
				['file', 'a.txt', 'text/plain'],
				['directory', 'docs', undefined],
				['file', 'docs/b.bin', null],
			]);
			await fixture.contentService.release(lease.lease, CancellationTokenNone);
			await prepared.reject();
			fixture.chatService.clearPendingAttachments(chatResource);
			await assert.rejects(fixture.contentService.open({
				session: createAgentSessionId('session'),
				chat: createAgentChatId('chat'),
				turn: createAgentTurnId('turn'),
				attachment: attachment.id,
				content: attachment.content,
				limits: {
					maximumReadLength: attachment.content.bounds.maximumReadLength,
					maximumTotalReadBytes: 4096,
					maximumTreePageEntries: 16,
					maximumTreePages: 16,
					maximumConcurrentOperations: 2,
					deadline: Date.now() + 30_000,
				},
			}, CancellationTokenNone), /unavailable/);
			assert.deepEqual(fixture.sources.getSources().map(source => source.id), [
				'files.file',
				'files.directory',
			]);
		} finally {
			fixture.owner.dispose();
			fixture.contribution.dispose();
		}
	});
});
