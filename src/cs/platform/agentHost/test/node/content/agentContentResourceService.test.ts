/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test, type TestContext } from 'node:test';

import { raceCancellationError } from 'cs/base/common/async';
import {
	CancellationTokenCancelled,
	CancellationTokenNone,
	isCancellationError,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { ClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import type { IAgentHostContentReference } from 'cs/platform/agentHost/common/attachments';
import type {
	IAgentContentBlobReadRequest,
	IAgentContentBlobReadResult,
	IAgentContentResourceLease,
	IAgentContentResourceReaderOpenRequest,
	IAgentContentResourceReaderPort,
	IAgentContentTreeEntryReadRequest,
	IAgentContentTreePage,
	IAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources';
import {
	createAgentAttachmentId,
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentSessionId,
	createAgentTurnId,
	type AgentContentLeaseId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentContentResourceService,
	type IAgentContentResourceHostLimits,
	type IAgentContentResourceScheduler,
} from 'cs/platform/agentHost/node/content/agentContentResourceService';

const connectionA = createAgentHostClientConnectionId('content-client-a');
const connectionB = createAgentHostClientConnectionId('content-client-b');

const hostLimits: IAgentContentResourceHostLimits = Object.freeze({
	maximumContentBytes: 32_768,
	maximumReadLength: 4,
	maximumTotalReadBytesPerLease: 32_768,
	maximumTreeEntries: 32,
	maximumTreeDepth: 8,
	maximumTreePageEntries: 4,
	maximumTreePages: 16,
	maximumOpenLeases: 8,
	maximumMaterializations: 4,
	maximumConcurrentOperations: 4,
	maximumConcurrentOperationsPerLease: 2,
	operationTimeoutMilliseconds: 2_000,
	leaseLifetimeMilliseconds: 10_000,
});

class TestScheduler implements IAgentContentResourceScheduler {
	private current = Date.now();
	private readonly timers = new Set<{
		readonly deadline: number;
		readonly callback: () => void;
	}>();

	now(): number {
		return this.current;
	}

	setTimeout(callback: () => void, delayMilliseconds: number): IDisposable {
		const timer = { deadline: this.current + delayMilliseconds, callback };
		this.timers.add(timer);
		return toDisposable(() => this.timers.delete(timer));
	}

	advance(milliseconds: number): void {
		this.current += milliseconds;
		for (const timer of [...this.timers]) {
			if (timer.deadline <= this.current && this.timers.delete(timer)) {
				timer.callback();
			}
		}
	}
}

function createClient(connection = connectionA): ClientContentResourceService {
	return new ClientContentResourceService(connection, {
		maximumBlobBytes: 32_768,
		maximumTreeBytes: 32_768,
		maximumTreeEntries: 32,
		maximumTreeDepth: 8,
		maximumReadLength: 4,
		maximumOpenLeases: 8,
		maximumConcurrentOperations: 2,
		maximumTotalReadBytes: 32_768,
		maximumTreePageEntries: 4,
		maximumTreePages: 16,
		maximumLeaseDurationMilliseconds: 10_000,
	});
}

function openRequest(content: IAgentHostContentReference) {
	return Object.freeze({
		session: createAgentSessionId('session'),
		chat: createAgentChatId('chat'),
		turn: createAgentTurnId('turn'),
		attachment: createAgentAttachmentId('attachment'),
		content,
	});
}

async function createHost(
	t: TestContext,
	limits: IAgentContentResourceHostLimits = hostLimits,
) {
	const parent = await mkdtemp(path.join(tmpdir(), 'comet-content-resource-'));
	const root = path.join(parent, 'materializations');
	const scheduler = new TestScheduler();
	const host = new AgentContentResourceService(root, limits, scheduler);
	t.after(async () => {
		host.dispose();
		await rm(parent, { recursive: true, force: true });
	});
	return { host, root, scheduler };
}

class CorruptingBlobReader implements IAgentContentResourceReaderPort {
	constructor(private readonly reader: IAgentContentResourceReaderPort) {}

	open(request: IAgentContentResourceReaderOpenRequest, token: CancellationToken): Promise<IAgentContentResourceLease> {
		return this.reader.open(request, token);
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		const result = await this.reader.readBlob(request, token);
		const bytes = Buffer.from(result.data, 'base64');
		if (bytes.byteLength > 0) {
			bytes[0] ^= 0xff;
		}
		return Object.freeze({ ...result, data: bytes.toString('base64') });
	}

	readTreePage(request: IAgentContentTreePageRequest, token: CancellationToken): Promise<IAgentContentTreePage> {
		return this.reader.readTreePage(request, token);
	}

	readTreeEntry(
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		return this.reader.readTreeEntry(request, token);
	}

	release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		return this.reader.release(lease, token);
	}
}

class BlockingBlobReader implements IAgentContentResourceReaderPort {
	private resolveStarted!: () => void;
	private resolveReads!: () => void;
	readonly started = new Promise<void>(resolve => { this.resolveStarted = resolve; });
	private readonly reads = new Promise<void>(resolve => { this.resolveReads = resolve; });

	constructor(private readonly reader: IAgentContentResourceReaderPort) {}

	open(request: IAgentContentResourceReaderOpenRequest, token: CancellationToken): Promise<IAgentContentResourceLease> {
		return this.reader.open(request, token);
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		this.resolveStarted();
		await raceCancellationError(this.reads, token);
		return this.reader.readBlob(request, token);
	}

	readTreePage(request: IAgentContentTreePageRequest, token: CancellationToken): Promise<IAgentContentTreePage> {
		return this.reader.readTreePage(request, token);
	}

	readTreeEntry(
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		return this.reader.readTreeEntry(request, token);
	}

	release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		return this.reader.release(lease, token);
	}

	completeReads(): void {
		this.resolveReads();
	}
}

suite('AgentContentResourceService', { concurrency: false }, () => {
	test('atomically materializes verified blob and tree copies under the Host root', async t => {
		const { host, root } = await createHost(t);
		const client = createClient();
		const binding = host.bindClientReader(connectionA, client);
		try {
			const blob = await client.publishBlob({
				mediaType: 'text/plain',
				bytes: new TextEncoder().encode('exact bytes'),
			});
			const blobLease = await host.open(openRequest(blob.content), CancellationTokenNone);
			const blobCopy = await host.materialize({ lease: blobLease.lease }, CancellationTokenNone);
			assert.equal(await readFile(blobCopy.resource, 'utf8'), 'exact bytes');
			assert.equal((await lstat(blobCopy.resource)).mode & 0o777, 0o600);
			assert.equal(path.relative(await realpath(root), blobCopy.resource).startsWith('..'), false);
			await host.releaseMaterialization(blobCopy.id, CancellationTokenNone);
			await assert.rejects(readFile(blobCopy.resource));
			await host.release(blobLease.lease, CancellationTokenNone);
			blob.release();

			const tree = await client.publishTree([
				{ path: 'a.txt', mediaType: 'text/plain', bytes: new TextEncoder().encode('alpha') },
				{ path: 'docs/b.bin', mediaType: null, bytes: new Uint8Array([1, 2, 3]) },
			]);
			const treeLease = await host.open(openRequest(tree.content), CancellationTokenNone);
			const treeCopy = await host.materialize({ lease: treeLease.lease }, CancellationTokenNone);
			assert.equal(await readFile(path.join(treeCopy.resource, 'a.txt'), 'utf8'), 'alpha');
			assert.deepEqual(await readFile(path.join(treeCopy.resource, 'docs/b.bin')), Buffer.from([1, 2, 3]));
			assert.equal((await lstat(path.join(treeCopy.resource, 'docs'))).isSymbolicLink(), false);
			await host.releaseMaterialization(treeCopy.id, CancellationTokenNone);
			await host.release(treeLease.lease, CancellationTokenNone);
			tree.release();
		} finally {
			binding.dispose();
		}
	});

	test('routes only the exact owner and invalidates old leases when its reader is replaced', async t => {
		const { host } = await createHost(t);
		const firstClient = createClient(connectionA);
		const otherClient = createClient(connectionB);
		const publication = await firstClient.publishBlob({ mediaType: null, bytes: new Uint8Array([1, 2, 3]) });
		const otherBinding = host.bindClientReader(connectionB, otherClient);
		await assert.rejects(host.open(openRequest(publication.content), CancellationTokenNone), /unavailable/);
		const firstBinding = host.bindClientReader(connectionA, firstClient);
		const lease = await host.open(openRequest(publication.content), CancellationTokenNone);
		firstBinding.dispose();
		await assert.rejects(
			host.readBlob({ lease: lease.lease, offset: 0, length: 1 }, CancellationTokenNone),
			/unavailable/,
		);

		const hostOwnedClaim = Object.freeze({
			...publication.content,
			owner: Object.freeze({ kind: 'host' as const }),
		});
		await assert.rejects(host.open(openRequest(hostOwnedClaim), CancellationTokenNone), /unavailable/);

		const replacement = createClient(connectionA);
		const replacementBinding = host.bindClientReader(connectionA, replacement);
		const replacementPublication = await replacement.publishBlob({ mediaType: null, bytes: new Uint8Array([4]) });
		const replacementLease = await host.open(openRequest(replacementPublication.content), CancellationTokenNone);
		assert.equal((await host.readBlob({ lease: replacementLease.lease, offset: 0, length: 1 }, CancellationTokenNone)).data, 'BA==');
		await host.release(replacementLease.lease, CancellationTokenNone);
		replacementPublication.release();
		replacementBinding.dispose();
		otherBinding.dispose();
		publication.release();
	});

	test('removes every staging path when verified bytes do not match the committed digest', async t => {
		const { host, root } = await createHost(t);
		const client = createClient();
		const publication = await client.publishBlob({
			mediaType: 'application/octet-stream',
			bytes: new Uint8Array([1, 2, 3, 4, 5]),
		});
		const binding = host.bindClientReader(connectionA, new CorruptingBlobReader(client));
		const lease = await host.open(openRequest(publication.content), CancellationTokenNone);
		await assert.rejects(host.materialize({ lease: lease.lease }, CancellationTokenNone), /Invalid Host content-resource value/);
		assert.deepEqual(await readdir(root), []);
		await host.release(lease.lease, CancellationTokenNone);
		publication.release();
		binding.dispose();
	});

	test('enforces cancellation, total-read bounds, and expiry while preserving exact release', async t => {
		const limits = Object.freeze({
			...hostLimits,
			maximumTotalReadBytesPerLease: 4,
		});
		const { host, scheduler } = await createHost(t, limits);
		const client = createClient();
		const binding = host.bindClientReader(connectionA, client);
		const publication = await client.publishBlob({ mediaType: null, bytes: new Uint8Array([1, 2, 3, 4, 5]) });
		await assert.rejects(host.open(openRequest(publication.content), CancellationTokenCancelled), isCancellationError);
		const lease = await host.open(openRequest(publication.content), CancellationTokenNone);
		await host.readBlob({ lease: lease.lease, offset: 0, length: 4 }, CancellationTokenNone);
		await assert.rejects(
			host.readBlob({ lease: lease.lease, offset: 4, length: 1 }, CancellationTokenNone),
			/total read-byte limit/,
		);
		scheduler.advance(hostLimits.leaseLifetimeMilliseconds);
		await assert.rejects(
			host.readBlob({ lease: lease.lease, offset: 0, length: 1 }, CancellationTokenNone),
			isCancellationError,
		);
		await host.release(lease.lease, CancellationTokenNone);
		publication.release();
		binding.dispose();
	});

	test('rejects concurrent operations on the same exact lease', async t => {
		const limits = Object.freeze({
			...hostLimits,
			maximumConcurrentOperationsPerLease: 1,
		});
		const { host } = await createHost(t, limits);
		const client = createClient();
		const reader = new BlockingBlobReader(client);
		const binding = host.bindClientReader(connectionA, reader);
		const publication = await client.publishBlob({ mediaType: null, bytes: new Uint8Array([1, 2]) });
		const lease = await host.open(openRequest(publication.content), CancellationTokenNone);
		const firstRead = host.readBlob({ lease: lease.lease, offset: 0, length: 1 }, CancellationTokenNone);
		await reader.started;
		await assert.rejects(
			host.readBlob({ lease: lease.lease, offset: 1, length: 1 }, CancellationTokenNone),
			/Invalid Host content-resource value/,
		);
		reader.completeReads();
		assert.equal((await firstRead).data, 'AQ==');
		await host.release(lease.lease, CancellationTokenNone);
		publication.release();
		binding.dispose();
	});
});
