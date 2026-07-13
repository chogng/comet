/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { ClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import type { IAgentHostContentReference } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentSessionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';

const connection = createAgentHostClientConnectionId('content-connection');
const context = Object.freeze({
	session: createAgentSessionId('session'),
	chat: createAgentChatId('chat'),
	turn: createAgentTurnId('turn'),
	attachment: createAgentAttachmentId('attachment'),
});

function createService() {
	return new ClientContentResourceService(connection, {
		maximumBlobBytes: 1024,
		maximumTreeBytes: 4096,
		maximumTreeEntries: 16,
		maximumTreeDepth: 4,
		maximumReadLength: 3,
		maximumOpenLeases: 4,
		maximumConcurrentOperations: 2,
		maximumTotalReadBytes: 4096,
		maximumTreePageEntries: 16,
		maximumTreePages: 16,
		maximumLeaseDurationMilliseconds: 60_000,
	});
}

function openRequest(content: IAgentHostContentReference) {
	return {
		...context,
		content,
		limits: Object.freeze({
			maximumReadLength: content.bounds.maximumReadLength,
			maximumTotalReadBytes: 4096,
			maximumTreePageEntries: 16,
			maximumTreePages: 16,
			maximumConcurrentOperations: 2,
			deadline: Date.now() + 30_000,
		}),
	};
}

suite('ClientContentResourceService', () => {
	test('publishes one immutable blob and binds it to one exact Turn', async () => {
		const service = createService();
		const source = new Uint8Array([1, 2, 3, 4]);
		const publication = await service.publishBlob({ mediaType: 'application/pdf', bytes: source });
		source[0] = 9;
		assert.equal(publication.content.owner.kind, 'client');
		assert.equal(publication.content.shape, 'blob');
		assert.equal(publication.content.bounds.maximumReadLength, 3);

		const lease = await service.open(openRequest(publication.content), CancellationTokenNone);
		assert.deepEqual(await service.readBlob({ lease: lease.lease, offset: 0, length: 3 }, CancellationTokenNone), {
			offset: 0,
			byteLength: 3,
			data: 'AQID',
			encoding: 'base64',
			endOfContent: false,
		});
		assert.deepEqual(await service.readBlob({ lease: lease.lease, offset: 3, length: 3 }, CancellationTokenNone), {
			offset: 3,
			byteLength: 1,
			data: 'BA==',
			encoding: 'base64',
			endOfContent: true,
		});

		publication.release();
		const acceptedLease = await service.open(openRequest(publication.content), CancellationTokenNone);
		await assert.rejects(service.open({
			...openRequest(publication.content),
			turn: createAgentTurnId('another-turn'),
		}, CancellationTokenNone), /unavailable/);
		assert.equal((await service.readBlob({ lease: lease.lease, offset: 0, length: 1 }, CancellationTokenNone)).data, 'AQ==');
		assert.equal((await service.readBlob({ lease: acceptedLease.lease, offset: 0, length: 1 }, CancellationTokenNone)).data, 'AQ==');
		await service.release(acceptedLease.lease, CancellationTokenNone);
		await service.release(lease.lease, CancellationTokenNone);
		await assert.rejects(service.readBlob({ lease: lease.lease, offset: 0, length: 1 }, CancellationTokenNone), /unavailable/);
		await assert.rejects(service.open(openRequest(publication.content), CancellationTokenNone), /unavailable/);
	});

	test('rejects another Turn and invalid read ranges for a bound publication', async () => {
		const service = createService();
		const publication = await service.publishBlob({
			mediaType: 'text/plain',
			bytes: new TextEncoder().encode('exact'),
		});
		const lease = await service.open(openRequest(publication.content), CancellationTokenNone);
		await assert.rejects(service.open({
			...openRequest(publication.content),
			turn: createAgentTurnId('another-turn'),
		}, CancellationTokenNone), /another Turn/);
		await assert.rejects(service.readBlob({ lease: lease.lease, offset: 0, length: 4 }, CancellationTokenNone), /invalid read range/);
		await service.release(lease.lease, CancellationTokenNone);
		const rebound = await service.open({
			...openRequest(publication.content),
			turn: createAgentTurnId('another-turn'),
		}, CancellationTokenNone);
		await service.release(rebound.lease, CancellationTokenNone);
		publication.release();
	});

	test('publishes a bounded sorted tree manifest and only committed file entries', async () => {
		const service = createService();
		const publication = await service.publishTree([
			{ path: 'docs/b.txt', mediaType: 'text/plain', bytes: new TextEncoder().encode('bbb') },
			{ path: 'a.txt', mediaType: 'text/plain', bytes: new TextEncoder().encode('aa') },
		]);
		assert.equal(publication.content.shape, 'tree');
		assert.deepEqual(publication.content.bounds, {
			byteLength: 5,
			maximumReadLength: 3,
			treeDepth: 2,
			treeEntryCount: 3,
		});
		const lease = await service.open(openRequest(publication.content), CancellationTokenNone);
		const first = await service.readTreePage({ lease: lease.lease, cursor: null, maximumEntries: 2 }, CancellationTokenNone);
		assert.deepEqual(first.entries.map(entry => [entry.kind, entry.path]), [
			['file', 'a.txt'],
			['directory', 'docs'],
		]);
		assert.equal(first.nextCursor, '2');
		const second = await service.readTreePage({ lease: lease.lease, cursor: first.nextCursor, maximumEntries: 2 }, CancellationTokenNone);
		assert.deepEqual(second.entries.map(entry => [entry.kind, entry.path]), [['file', 'docs/b.txt']]);
		assert.equal(second.nextCursor, null);
		assert.equal((await service.readTreeEntry({ lease: lease.lease, path: 'docs/b.txt', offset: 0, length: 3 }, CancellationTokenNone)).data, 'YmJi');
		await assert.rejects(
			service.readTreeEntry({ lease: lease.lease, path: 'docs/missing.txt', offset: 0, length: 1 }, CancellationTokenNone),
			/does not contain/,
		);
		await service.release(lease.lease, CancellationTokenNone);
		publication.release();
	});

	test('rejects traversal, duplicate paths, links-by-shape, and manifest overflow', async () => {
		const service = createService();
		await assert.rejects(service.publishTree([
			{ path: '../secret', mediaType: 'text/plain', bytes: new Uint8Array([1]) },
		]), /normalized relative/);
		await assert.rejects(service.publishTree([
			{ path: 'same', mediaType: 'text/plain', bytes: new Uint8Array([1]) },
			{ path: 'same', mediaType: 'text/plain', bytes: new Uint8Array([2]) },
		]), /duplicate path/);
		await assert.rejects(service.publishTree([
			{ path: 'file', mediaType: 'text/plain', bytes: new Uint8Array([1]) },
			{ path: 'file/child', mediaType: 'text/plain', bytes: new Uint8Array([2]) },
		]), /file-directory collision/);
		await assert.rejects(service.publishTree([
			{ path: 'a/b/c/d/e', mediaType: 'text/plain', bytes: new Uint8Array([1]) },
		]), /exceeds depth/);
		await assert.rejects(service.publishTree([]), /requires between/);
	});
});
