/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { constants, rmSync } from 'node:fs';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	open,
	realpath,
	rename,
	rm,
} from 'node:fs/promises';
import path from 'node:path';

import { raceCancellationError } from 'cs/base/common/async';
import {
	CancellationError,
	CancellationTokenNone,
	CancellationTokenSource,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { IAgentHostContentReference } from 'cs/platform/agentHost/common/attachments';
import {
	type AgentContentTreeEntry,
	type IAgentContentBlobReadRequest,
	type IAgentContentBlobReadResult,
	type IAgentContentMaterialization,
	type IAgentContentMaterializeRequest,
	type IAgentContentResourceLease,
	type IAgentContentResourceOpenRequest,
	type IAgentContentResourcePort,
	type IAgentContentResourceReadLimits,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentResourceReaderPort,
	type IAgentContentTreeEntryReadRequest,
	type IAgentContentTreePage,
	type IAgentContentTreePageRequest,
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResult,
	assertAgentContentMaterialization,
	assertAgentContentMaterializeRequest,
	assertAgentContentResourceLease,
	assertAgentContentResourceOpenRequest,
	assertAgentContentTreeEntry,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
	assertAgentContentTreePath,
} from 'cs/platform/agentHost/common/contentResources';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	type AgentContentLeaseId,
	type AgentContentMaterializationId,
	type AgentContentReferenceId,
	type AgentHostClientConnectionId,
	createAgentContentLeaseId,
	createAgentContentMaterializationId,
	createAgentContentReferenceId,
	createAgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';

export interface IAgentContentResourceHostLimits {
	readonly maximumContentBytes: number;
	readonly maximumReadLength: number;
	readonly maximumTotalReadBytesPerLease: number;
	readonly maximumTreeEntries: number;
	readonly maximumTreeDepth: number;
	readonly maximumTreePageEntries: number;
	readonly maximumTreePages: number;
	readonly maximumOpenLeases: number;
	readonly maximumMaterializations: number;
	readonly maximumConcurrentOperations: number;
	readonly maximumConcurrentOperationsPerLease: number;
	readonly operationTimeoutMilliseconds: number;
	readonly leaseLifetimeMilliseconds: number;
}

export interface IAgentContentResourceScheduler {
	now(): number;
	setTimeout(callback: () => void, delayMilliseconds: number): IDisposable;
}

export interface IAgentContentResourceClientRouter {
	bindClientReader(
		connection: AgentHostClientConnectionId,
		reader: IAgentContentResourceReaderPort,
	): IDisposable;
}

interface IReaderBinding {
	readonly reader: IAgentContentResourceReaderPort;
	readonly owner: string;
	readonly cancellationSource: CancellationTokenSource;
	active: boolean;
}

interface IContentLeaseRecord {
	readonly lease: AgentContentLeaseId;
	readonly binding: IReaderBinding;
	readonly content: IAgentHostContentReference;
	readonly limits: IAgentContentResourceReadLimits;
	readonly deadline: number;
	readonly manifest: readonly AgentContentTreeEntry[] | undefined;
	readonly files: ReadonlyMap<string, Extract<AgentContentTreeEntry, { readonly kind: 'file' }>>;
	totalReadBytes: number;
	treePages: number;
	activeOperations: number;
	releasing: boolean;
	materializing: boolean;
	materialization: AgentContentMaterializationId | undefined;
}

interface IMaterializationRecord {
	readonly id: AgentContentMaterializationId;
	readonly root: string;
	readonly resource: string;
	releasing: boolean;
}

function invalidValue(field: string, value: unknown): AgentHostError {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	return new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Host content-resource value',
		{ field, value: diagnostic },
	);
}

function missingResource(kind: string, identity: string): AgentHostError {
	return new AgentHostError(
		AgentHostErrorCode.ResourceMissing,
		'Host content resource is unavailable',
		{ resource: `${kind}:${identity}` },
	);
}

function assertPositiveInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw invalidValue(field, value);
	}
}

function validateLimits(limits: IAgentContentResourceHostLimits): IAgentContentResourceHostLimits {
	for (const [field, value] of Object.entries(limits)) {
		assertPositiveInteger(value, `contentResources.limits.${field}`);
	}
	if (
		limits.maximumReadLength > limits.maximumContentBytes
		|| limits.maximumTreePageEntries > limits.maximumTreeEntries
		|| limits.operationTimeoutMilliseconds > limits.leaseLifetimeMilliseconds
	) {
		throw invalidValue('contentResources.limits', 'inconsistent');
	}
	return Object.freeze({ ...limits });
}

function digest(value: Uint8Array | string): string {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(Buffer.from(value, 'base64'));
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function pathDepth(value: string): number {
	return value.split('/').length;
}

function assertContainedPath(root: string, candidate: string): void {
	const relative = path.relative(root, candidate);
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw invalidValue('contentResources.materialization.path', candidate);
	}
}

/** Returns the production scheduler used for bounded content operations. */
export function createAgentContentResourceScheduler(): IAgentContentResourceScheduler {
	return Object.freeze({
		now: () => Date.now(),
		setTimeout: (callback: () => void, delayMilliseconds: number) => {
			const handle = setTimeout(callback, delayMilliseconds);
			return toDisposable(() => clearTimeout(handle));
		},
	});
}

/** Routes exact content owners and materializes verified copies in Host-controlled storage. */
export class AgentContentResourceService extends Disposable implements IAgentContentResourcePort, IAgentContentResourceClientRouter {
	private readonly limits: IAgentContentResourceHostLimits;
	private readonly clientReaders = new Map<AgentHostClientConnectionId, IReaderBinding>();
	private readonly hostReaders = new Map<AgentContentReferenceId, IReaderBinding>();
	private readonly leases = new Map<AgentContentLeaseId, IContentLeaseRecord>();
	private readonly materializations = new Map<AgentContentMaterializationId, IMaterializationRecord>();
	private rootPromise: Promise<string> | undefined;
	private activeOperations = 0;
	private openingLeases = 0;
	private activeMaterializations = 0;

	constructor(
		private readonly materializationRoot: string,
		limits: IAgentContentResourceHostLimits,
		private readonly scheduler: IAgentContentResourceScheduler,
	) {
		super();
		if (!path.isAbsolute(materializationRoot)) {
			throw invalidValue('contentResources.materializationRoot', materializationRoot);
		}
		this.limits = validateLimits(limits);
	}

	bindClientReader(
		connection: AgentHostClientConnectionId,
		reader: IAgentContentResourceReaderPort,
	): IDisposable {
		createAgentHostClientConnectionId(connection);
		if (this._store.isDisposed) {
			throw missingResource('contentResourceService', 'disposed');
		}
		if (this.clientReaders.has(connection)) {
			throw invalidValue('contentResources.clientReader.connection', connection);
		}
		const binding: IReaderBinding = {
			reader,
			owner: `client:${connection}`,
			cancellationSource: new CancellationTokenSource(),
			active: true,
		};
		this.clientReaders.set(connection, binding);
		return toDisposable(() => {
			if (this.clientReaders.get(connection) !== binding) {
				return;
			}
			this.invalidateBinding(binding);
		});
	}

	registerHostReader(
		reference: AgentContentReferenceId,
		reader: IAgentContentResourceReaderPort,
	): IDisposable {
		createAgentContentReferenceId(reference);
		if (this._store.isDisposed) {
			throw missingResource('contentResourceService', 'disposed');
		}
		if (this.hostReaders.has(reference)) {
			throw invalidValue('contentResources.hostReader.reference', reference);
		}
		const binding: IReaderBinding = {
			reader,
			owner: `host:${reference}`,
			cancellationSource: new CancellationTokenSource(),
			active: true,
		};
		this.hostReaders.set(reference, binding);
		return toDisposable(() => {
			if (this.hostReaders.get(reference) !== binding) {
				return;
			}
			this.invalidateBinding(binding);
		});
	}

	async open(
		request: IAgentContentResourceOpenRequest,
		token: CancellationToken,
	): Promise<IAgentContentResourceLease> {
		assertAgentContentResourceOpenRequest(request);
		this.assertContentBounds(request.content);
		if (this.leases.size + this.openingLeases >= this.limits.maximumOpenLeases) {
			throw invalidValue('contentResources.openLeases', this.leases.size + this.openingLeases);
		}
		const binding = this.resolveReader(request.content);
		const deadline = this.scheduler.now() + this.limits.leaseLifetimeMilliseconds;
		if (!Number.isSafeInteger(deadline)) {
			throw invalidValue('contentResources.deadline', deadline);
		}
		const readerRequest: IAgentContentResourceReaderOpenRequest = {
			...request,
			limits: Object.freeze({
				maximumReadLength: Math.min(
					request.content.bounds.maximumReadLength,
					this.limits.maximumReadLength,
				),
				maximumTotalReadBytes: this.limits.maximumTotalReadBytesPerLease,
				maximumTreePageEntries: this.limits.maximumTreePageEntries,
				maximumTreePages: this.limits.maximumTreePages,
				maximumConcurrentOperations: this.limits.maximumConcurrentOperationsPerLease,
				deadline,
			}),
		};
		this.openingLeases += 1;
		try {
			return await this.runOperation(token, deadline, binding, async operationToken => {
				this.assertBinding(binding);
				const result = await binding.reader.open(readerRequest, operationToken);
				assertAgentContentResourceLease(result, request);
				if (this.leases.has(result.lease)) {
					this.invalidateBinding(binding);
					throw invalidValue('contentResources.lease', result.lease);
				}
				let committed = false;
				try {
					const manifest = request.content.shape === 'tree'
						? await this.loadTreeManifest(binding, result.lease, request.content, readerRequest.limits, operationToken)
						: undefined;
					const files = new Map<string, Extract<AgentContentTreeEntry, { readonly kind: 'file' }>>();
					for (const entry of manifest ?? []) {
						if (entry.kind === 'file') {
							files.set(entry.path, entry);
						}
					}
					const record: IContentLeaseRecord = {
						lease: result.lease,
						binding,
						content: request.content,
						limits: readerRequest.limits,
						deadline,
						manifest,
						files,
						totalReadBytes: 0,
						treePages: 0,
						activeOperations: 0,
						releasing: false,
						materializing: false,
						materialization: undefined,
					};
					this.assertBinding(binding);
					if (operationToken.isCancellationRequested) {
						throw new CancellationError();
					}
					this.leases.set(record.lease, record);
					committed = true;
					return Object.freeze({ lease: record.lease, content: record.content });
				} catch (error) {
					if (committed) {
						throw error;
					}
					try {
						await binding.reader.release(result.lease, CancellationTokenNone);
					} catch (releaseError) {
						throw new AggregateError([error, releaseError], 'Content lease validation and cleanup failed');
					}
					throw error;
				}
			});
		} finally {
			this.openingLeases -= 1;
		}
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentBlobReadRequest(request);
		const lease = this.requireLease(request.lease);
		if (lease.content.shape !== 'blob') {
			throw invalidValue('contentResources.readBlob.shape', lease.content.shape);
		}
		return this.runLeaseOperation(lease, token, async operationToken => {
			const result = await this.readRemoteBytes(lease, request, lease.content.bounds.byteLength, operationToken);
			return result;
		});
	}

	async readTreePage(
		request: IAgentContentTreePageRequest,
		token: CancellationToken,
	): Promise<IAgentContentTreePage> {
		assertAgentContentTreePageRequest(request);
		const lease = this.requireLease(request.lease);
		if (lease.manifest === undefined) {
			throw invalidValue('contentResources.readTreePage.shape', lease.content.shape);
		}
		return this.runLeaseOperation(lease, token, async () => {
			if (request.maximumEntries > this.limits.maximumTreePageEntries) {
				throw invalidValue('contentResources.readTreePage.maximumEntries', request.maximumEntries);
			}
			lease.treePages += 1;
			if (lease.treePages > this.limits.maximumTreePages) {
				throw invalidValue('contentResources.readTreePage.pages', lease.treePages);
			}
			const offset = request.cursor === null ? 0 : Number(request.cursor);
			if (
				!Number.isSafeInteger(offset)
				|| offset < 0
				|| offset >= lease.manifest!.length
				|| (request.cursor !== null && String(offset) !== request.cursor)
			) {
				throw invalidValue('contentResources.readTreePage.cursor', request.cursor ?? 'null');
			}
			const entries = lease.manifest!.slice(offset, offset + request.maximumEntries);
			const nextOffset = offset + entries.length;
			const result: IAgentContentTreePage = Object.freeze({
				entries: Object.freeze(entries),
				nextCursor: nextOffset < lease.manifest!.length ? String(nextOffset) : null,
			});
			assertAgentContentTreePage(result, request);
			return result;
		});
	}

	async readTreeEntry(
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentTreeEntryReadRequest(request);
		const lease = this.requireLease(request.lease);
		const entry = lease.files.get(request.path);
		if (entry === undefined) {
			throw missingResource('contentTreeEntry', request.path);
		}
		return this.runLeaseOperation(lease, token, operationToken => (
			this.readRemoteTreeEntry(lease, entry, request, operationToken)
		));
	}

	async materialize(
		request: IAgentContentMaterializeRequest,
		token: CancellationToken,
	): Promise<IAgentContentMaterialization> {
		assertAgentContentMaterializeRequest(request);
		const lease = this.requireLease(request.lease);
		if (
			lease.materializing
			|| lease.materialization !== undefined
			|| this.materializations.size + this.activeMaterializations >= this.limits.maximumMaterializations
		) {
			throw invalidValue('contentResources.materialize.state', request.lease);
		}
		lease.materializing = true;
		this.activeMaterializations += 1;
		try {
			return await this.runLeaseOperation(lease, token, async operationToken => {
				const root = await this.ensureRoot();
				const staging = await mkdtemp(path.join(root, '.content-'));
				await chmod(staging, 0o700);
				let committedRoot: string | undefined;
				try {
					const materialization = createAgentContentMaterializationId(generateUuid());
					const finalRoot = path.join(root, materialization);
					assertContainedPath(root, finalRoot);
					const resource = lease.content.shape === 'blob'
						? await this.materializeBlob(lease, staging, operationToken)
						: await this.materializeTree(lease, staging, operationToken);
					if (operationToken.isCancellationRequested) {
						throw new CancellationError();
					}
					await rename(staging, finalRoot);
					committedRoot = finalRoot;
					const finalResource = path.join(finalRoot, path.relative(staging, resource));
					assertContainedPath(root, finalResource);
					if (operationToken.isCancellationRequested) {
						throw new CancellationError();
					}
					const record: IMaterializationRecord = {
						id: materialization,
						root: finalRoot,
						resource: finalResource,
						releasing: false,
					};
					this.materializations.set(materialization, record);
					lease.materialization = materialization;
					const result = Object.freeze({ id: materialization, resource: finalResource });
					assertAgentContentMaterialization(result);
					return result;
				} catch (error) {
					await rm(committedRoot ?? staging, { recursive: true, force: true });
					throw error;
				}
			});
		} finally {
			lease.materializing = false;
			this.activeMaterializations -= 1;
		}
	}

	async release(leaseId: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		createAgentContentLeaseId(leaseId);
		const lease = this.requireLease(leaseId, false);
		if (
			lease.releasing
			|| lease.activeOperations !== 0
			|| (lease.materialization !== undefined && this.materializations.has(lease.materialization))
		) {
			throw invalidValue('contentResources.release.state', leaseId);
		}
		lease.releasing = true;
		try {
			await this.runOperation(token, undefined, lease.binding, async operationToken => {
				this.assertBinding(lease.binding);
				await lease.binding.reader.release(lease.lease, operationToken);
				this.leases.delete(lease.lease);
			});
		} catch (error) {
			lease.releasing = false;
			throw error;
		}
	}

	async releaseMaterialization(
		materialization: AgentContentMaterializationId,
		token: CancellationToken,
	): Promise<void> {
		createAgentContentMaterializationId(materialization);
		const record = this.materializations.get(materialization);
		if (record === undefined) {
			throw missingResource('contentMaterialization', materialization);
		}
		if (record.releasing) {
			throw invalidValue('contentResources.releaseMaterialization.state', materialization);
		}
		record.releasing = true;
		try {
			await this.runOperation(token, undefined, undefined, async () => {
				await rm(record.root, { recursive: true, force: false });
				this.materializations.delete(materialization);
			});
		} catch (error) {
			record.releasing = false;
			throw error;
		}
	}

	private resolveReader(content: IAgentHostContentReference): IReaderBinding {
		if (content.owner.kind === 'client') {
			const reader = this.clientReaders.get(content.owner.connection);
			if (reader === undefined) {
				throw missingResource('contentClient', content.owner.connection);
			}
			return reader;
		}
		const reader = this.hostReaders.get(content.reference);
		if (reader === undefined) {
			throw missingResource('hostContent', content.reference);
		}
		return reader;
	}

	private assertContentBounds(content: IAgentHostContentReference): void {
		if (content.bounds.byteLength > this.limits.maximumContentBytes) {
			throw invalidValue('contentResources.content.bounds', content.bounds.byteLength);
		}
		if (content.shape === 'tree' && (
			content.bounds.treeEntryCount === undefined
			|| content.bounds.treeDepth === undefined
			|| content.bounds.treeEntryCount > this.limits.maximumTreeEntries
			|| content.bounds.treeDepth > this.limits.maximumTreeDepth
		)) {
			throw invalidValue('contentResources.content.treeBounds', content.bounds.byteLength);
		}
	}

	private async loadTreeManifest(
		binding: IReaderBinding,
		lease: AgentContentLeaseId,
		content: IAgentHostContentReference,
		limits: IAgentContentResourceReadLimits,
		token: CancellationToken,
	): Promise<readonly AgentContentTreeEntry[]> {
		const entries: AgentContentTreeEntry[] = [];
		const paths = new Set<string>();
		const cursors = new Set<string>();
		let cursor: string | null = null;
		let totalBytes = 0;
		let pages = 0;
		do {
			this.assertBinding(binding);
			pages += 1;
			if (pages > limits.maximumTreePages) {
				throw invalidValue('contentResources.manifest.pages', pages);
			}
			const request: IAgentContentTreePageRequest = {
				lease,
				cursor,
				maximumEntries: limits.maximumTreePageEntries,
			};
			const page = await binding.reader.readTreePage(request, token);
			assertAgentContentTreePage(page, request);
			for (const [index, entry] of page.entries.entries()) {
				assertAgentContentTreeEntry(entry, `contentResources.manifest.${entries.length + index}`);
				if (
					paths.has(entry.path)
					|| (entries.length > 0 && comparePaths(entries[entries.length - 1].path, entry.path) >= 0)
					|| pathDepth(entry.path) > this.limits.maximumTreeDepth
				) {
					throw invalidValue('contentResources.manifest.path', entry.path);
				}
				paths.add(entry.path);
				entries.push(Object.freeze({ ...entry }));
				if (entry.kind === 'file') {
					totalBytes += entry.byteLength;
					if (!Number.isSafeInteger(totalBytes) || totalBytes > content.bounds.byteLength) {
						throw invalidValue('contentResources.manifest.byteLength', totalBytes);
					}
				}
			}
			cursor = page.nextCursor;
			if (cursor !== null && cursors.has(cursor)) {
				throw invalidValue('contentResources.manifest.cursor', cursor);
			}
			if (cursor !== null) {
				cursors.add(cursor);
			}
		} while (cursor !== null);

		if (
			entries.length !== content.bounds.treeEntryCount
			|| totalBytes !== content.bounds.byteLength
			|| digest(encodeAgentHostProtocolValue(entries)) !== content.digest
		) {
			throw invalidValue('contentResources.manifest', content.reference);
		}
		const entriesByPath = new Map(entries.map(entry => [entry.path, entry]));
		for (const entry of entries) {
			const segments = entry.path.split('/');
			for (let index = 1; index < segments.length; index += 1) {
				const parent = segments.slice(0, index).join('/');
				const parentEntry = entriesByPath.get(parent);
				if (parentEntry?.kind !== 'directory') {
					throw invalidValue('contentResources.manifest.parent', parent);
				}
			}
		}
		return Object.freeze(entries);
	}

	private requireLease(lease: AgentContentLeaseId, enforceDeadline = true): IContentLeaseRecord {
		const record = this.leases.get(lease);
		if (record === undefined || !record.binding.active) {
			throw missingResource('contentLease', lease);
		}
		if (enforceDeadline && this.scheduler.now() >= record.deadline) {
			throw new CancellationError();
		}
		return record;
	}

	private async runLeaseOperation<TResult>(
		lease: IContentLeaseRecord,
		token: CancellationToken,
		operation: (token: CancellationToken) => Promise<TResult>,
	): Promise<TResult> {
		if (lease.releasing) {
			throw invalidValue('contentResources.lease.state', lease.lease);
		}
		if (lease.activeOperations >= this.limits.maximumConcurrentOperationsPerLease) {
			throw invalidValue('contentResources.lease.concurrentOperations', lease.activeOperations);
		}
		lease.activeOperations += 1;
		try {
			return await this.runOperation(token, lease.deadline, lease.binding, operation);
		} finally {
			lease.activeOperations -= 1;
		}
	}

	private async runOperation<TResult>(
		token: CancellationToken,
		deadline: number | undefined,
		binding: IReaderBinding | undefined,
		operation: (token: CancellationToken) => Promise<TResult>,
	): Promise<TResult> {
		if (this._store.isDisposed || token.isCancellationRequested) {
			throw new CancellationError();
		}
		if (this.activeOperations >= this.limits.maximumConcurrentOperations) {
			throw invalidValue('contentResources.concurrentOperations', this.activeOperations);
		}
		if (binding !== undefined) {
			this.assertBinding(binding);
		}
		const now = this.scheduler.now();
		const remaining = deadline === undefined
			? this.limits.operationTimeoutMilliseconds
			: Math.min(this.limits.operationTimeoutMilliseconds, deadline - now);
		if (remaining <= 0) {
			throw new CancellationError();
		}
		const source = new CancellationTokenSource();
		const parentCancellation = token.onCancellationRequested(() => source.cancel());
		const bindingCancellation = binding?.cancellationSource.token.onCancellationRequested(() => source.cancel());
		const timeout = this.scheduler.setTimeout(() => source.cancel(), remaining);
		this.activeOperations += 1;
		try {
			return await raceCancellationError(operation(source.token), source.token);
		} finally {
			this.activeOperations -= 1;
			timeout.dispose();
			parentCancellation.dispose();
			bindingCancellation?.dispose();
			source.dispose();
		}
	}

	private assertBinding(binding: IReaderBinding): void {
		if (!binding.active) {
			throw missingResource('contentReader', binding.owner);
		}
	}

	private consumeReadBytes(lease: IContentLeaseRecord, byteLength: number): void {
		const total = lease.totalReadBytes + byteLength;
		if (!Number.isSafeInteger(total) || total > lease.limits.maximumTotalReadBytes) {
			throw invalidValue('contentResources.totalReadBytes', total);
		}
		lease.totalReadBytes = total;
	}

	private async readRemoteBytes(
		lease: IContentLeaseRecord,
		request: IAgentContentBlobReadRequest,
		totalByteLength: number,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		if (
			request.length > lease.limits.maximumReadLength
			|| request.offset > totalByteLength
		) {
			throw invalidValue('contentResources.read.range', request.length);
		}
		this.assertBinding(lease.binding);
		const result = await lease.binding.reader.readBlob(request, token);
		assertAgentContentBlobReadResult(result, request, totalByteLength);
		this.consumeReadBytes(lease, result.byteLength);
		return Object.freeze({ ...result });
	}

	private async readRemoteTreeEntry(
		lease: IContentLeaseRecord,
		entry: Extract<AgentContentTreeEntry, { readonly kind: 'file' }>,
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		if (
			request.length > lease.limits.maximumReadLength
			|| request.offset > entry.byteLength
		) {
			throw invalidValue('contentResources.readTreeEntry.range', request.length);
		}
		this.assertBinding(lease.binding);
		const result = await lease.binding.reader.readTreeEntry(request, token);
		assertAgentContentBlobReadResult(result, request, entry.byteLength);
		this.consumeReadBytes(lease, result.byteLength);
		return Object.freeze({ ...result });
	}

	private async materializeBlob(
		lease: IContentLeaseRecord,
		staging: string,
		token: CancellationToken,
	): Promise<string> {
		const target = path.join(staging, 'content');
		await this.writeVerifiedFile(
			target,
			lease.content.bounds.byteLength,
			lease.content.digest,
			(offset, length) => this.readRemoteBytes(lease, {
				lease: lease.lease,
				offset,
				length,
			}, lease.content.bounds.byteLength, token),
			token,
		);
		return target;
	}

	private async materializeTree(
		lease: IContentLeaseRecord,
		staging: string,
		token: CancellationToken,
	): Promise<string> {
		if (lease.manifest === undefined) {
			throw invalidValue('contentResources.materializeTree.shape', lease.content.shape);
		}
		for (const entry of lease.manifest) {
			assertAgentContentTreePath(entry.path, 'contentResources.materializeTree.path');
			const target = path.resolve(staging, entry.path);
			assertContainedPath(staging, target);
			if (entry.kind === 'directory') {
				await mkdir(target, { recursive: false, mode: 0o700 });
				continue;
			}
			await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
			await this.writeVerifiedFile(
				target,
				entry.byteLength,
				entry.digest,
				(offset, length) => this.readRemoteTreeEntry(lease, entry, {
					lease: lease.lease,
					path: entry.path,
					offset,
					length,
				}, token),
				token,
			);
		}
		return staging;
	}

	private async writeVerifiedFile(
		target: string,
		byteLength: number,
		expectedDigest: string,
		read: (offset: number, length: number) => Promise<IAgentContentBlobReadResult>,
		token: CancellationToken,
	): Promise<void> {
		const handle = await open(
			target,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
			0o600,
		);
		const hash = createHash('sha256');
		let offset = 0;
		try {
			while (offset < byteLength) {
				if (token.isCancellationRequested) {
					throw new CancellationError();
				}
				const length = Math.min(this.limits.maximumReadLength, byteLength - offset);
				const result = await read(offset, length);
				const bytes = decodeBase64(result.data);
				let written = 0;
				while (written < bytes.byteLength) {
					const write = await handle.write(bytes, written, bytes.byteLength - written, offset + written);
					if (write.bytesWritten === 0) {
						throw invalidValue('contentResources.materialization.write', offset + written);
					}
					written += write.bytesWritten;
				}
				hash.update(bytes);
				offset += bytes.byteLength;
			}
			await handle.sync();
		} finally {
			await handle.close();
		}
		const receivedDigest = `sha256:${hash.digest('hex')}`;
		if (offset !== byteLength || receivedDigest !== expectedDigest) {
			throw invalidValue('contentResources.materialization.digest', receivedDigest);
		}
	}

	private async ensureRoot(): Promise<string> {
		this.rootPromise ??= (async () => {
			await mkdir(this.materializationRoot, { recursive: true, mode: 0o700 });
			const metadata = await lstat(this.materializationRoot);
			if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
				throw invalidValue('contentResources.materializationRoot', this.materializationRoot);
			}
			await chmod(this.materializationRoot, 0o700);
			return realpath(this.materializationRoot);
		})();
		return this.rootPromise;
	}

	private invalidateBindingLeases(binding: IReaderBinding): void {
		for (const [lease, record] of this.leases) {
			if (record.binding === binding) {
				this.leases.delete(lease);
			}
		}
	}

	private invalidateBinding(binding: IReaderBinding): void {
		if (!binding.active) {
			return;
		}
		binding.active = false;
		binding.cancellationSource.cancel();
		for (const [connection, candidate] of this.clientReaders) {
			if (candidate === binding) {
				this.clientReaders.delete(connection);
			}
		}
		for (const [reference, candidate] of this.hostReaders) {
			if (candidate === binding) {
				this.hostReaders.delete(reference);
			}
		}
		this.invalidateBindingLeases(binding);
		binding.cancellationSource.dispose();
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		for (const binding of [
			...this.clientReaders.values(),
			...this.hostReaders.values(),
		]) {
			this.invalidateBinding(binding);
		}
		this.clientReaders.clear();
		this.hostReaders.clear();
		this.leases.clear();
		const roots = [...this.materializations.values()].map(record => record.root);
		this.materializations.clear();
		super.dispose();
		for (const root of roots) {
			rmSync(root, { recursive: true, force: true });
		}
	}
}
