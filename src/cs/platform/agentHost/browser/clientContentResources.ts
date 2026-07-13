/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellationError } from 'cs/base/common/async';
import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { generateUuid } from 'cs/base/common/uuid';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { IAgentHostContentReference } from 'cs/platform/agentHost/common/attachments';
import {
	type AgentContentTreeEntry,
	type IAgentContentBlobReadRequest,
	type IAgentContentBlobReadResult,
	type IAgentContentResourceLease,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentResourceReaderPort,
	type IAgentContentTreeEntryReadRequest,
	type IAgentContentTreePage,
	type IAgentContentTreePageRequest,
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResult,
	assertAgentContentResourceReaderOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources';
import {
	AgentContentLeaseId,
	AgentContentReferenceId,
	AgentHostClientConnectionId,
	createAgentContentDigest,
	createAgentContentLeaseId,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';

const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const normalizedTreePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\0]+$/;

export interface IClientContentResourceLimits {
	readonly maximumBlobBytes: number;
	readonly maximumTreeBytes: number;
	readonly maximumTreeEntries: number;
	readonly maximumTreeDepth: number;
	readonly maximumReadLength: number;
	readonly maximumOpenLeases: number;
	readonly maximumConcurrentOperations: number;
	readonly maximumTotalReadBytes: number;
	readonly maximumTreePageEntries: number;
	readonly maximumTreePages: number;
	readonly maximumLeaseDurationMilliseconds: number;
}

export interface IClientContentBlobPublication {
	readonly mediaType: string | null;
	readonly bytes: Uint8Array;
}

export interface IClientContentTreeFile {
	readonly path: string;
	readonly mediaType: string | null;
	readonly bytes: Uint8Array;
}

export interface IClientContentPublication {
	readonly content: IAgentHostContentReference;
	release(): void;
}

export const IClientContentResourceService =
	createDecorator<IClientContentResourceService>('clientContentResourceService');

export interface IClientContentResourceService extends IAgentContentResourceReaderPort {
	readonly _serviceBrand: undefined;
	readonly connection: AgentHostClientConnectionId;
	publishBlob(input: IClientContentBlobPublication): Promise<IClientContentPublication>;
	publishTree(files: readonly IClientContentTreeFile[]): Promise<IClientContentPublication>;
}

interface IBlobRecord {
	readonly kind: 'blob';
	readonly content: IAgentHostContentReference;
	readonly bytes: Uint8Array;
	boundContext?: string;
	releaseRequested: boolean;
	leaseCount: number;
}

interface ITreeFileRecord {
	readonly path: string;
	readonly mediaType: string | null;
	readonly bytes: Uint8Array;
	readonly entry: Extract<AgentContentTreeEntry, { readonly kind: 'file' }>;
}

interface ITreeRecord {
	readonly kind: 'tree';
	readonly content: IAgentHostContentReference;
	readonly entries: readonly AgentContentTreeEntry[];
	readonly files: ReadonlyMap<string, ITreeFileRecord>;
	boundContext?: string;
	releaseRequested: boolean;
	leaseCount: number;
}

type PublicationRecord = IBlobRecord | ITreeRecord;

interface ILeaseRecord {
	readonly publication: PublicationRecord;
	readonly limits: IAgentContentResourceReaderOpenRequest['limits'];
	totalReadBytes: number;
	treePages: number;
	activeOperations: number;
}

function assertPositiveInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${field} must be a positive safe integer.`);
	}
}

function validateLimits(limits: IClientContentResourceLimits): IClientContentResourceLimits {
	for (const [field, value] of Object.entries(limits)) {
		assertPositiveInteger(value, `Client content ${field}`);
	}
	return Object.freeze({ ...limits });
}

function assertMediaType(value: string, field: string): void {
	if (!mediaTypePattern.test(value)) {
		throw new TypeError(`${field} must be an exact media type.`);
	}
}

function assertBytes(value: Uint8Array, maximum: number, field: string): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength > maximum) {
		throw new RangeError(`${field} cannot exceed ${maximum} bytes.`);
	}
	return value.slice();
}

async function digestBytes(bytes: Uint8Array) {
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
	return createAgentContentDigest(
		`sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`,
	);
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const blockLength = 0x8000;
	for (let offset = 0; offset < bytes.byteLength; offset += blockLength) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + blockLength));
	}
	return globalThis.btoa(binary);
}

function contextKey(request: IAgentContentResourceReaderOpenRequest): string {
	return `${request.session}\0${request.chat}\0${request.turn}\0${request.attachment}`;
}

function assertSameContent(
	expected: IAgentHostContentReference,
	actual: IAgentHostContentReference,
): void {
	if (encodeAgentHostProtocolValue(expected) !== encodeAgentHostProtocolValue(actual)) {
		throw new Error(`Content reference '${actual.reference}' does not match its published immutable version.`);
	}
}

function normalizeTreePath(value: string): string {
	if (
		value.length === 0
		|| value.length > 4_096
		|| !normalizedTreePathPattern.test(value)
		|| value.endsWith('/')
	) {
		throw new TypeError(`Directory entry path '${value.slice(0, 256)}' is not a normalized relative file path.`);
	}
	return value;
}

function treeDepth(path: string): number {
	return path.split('/').length;
}

function assertReadRange(
	request: IAgentContentBlobReadRequest,
	byteLength: number,
	maximumReadLength: number,
): void {
	if (
		!Number.isSafeInteger(request.offset)
		|| request.offset < 0
		|| request.offset > byteLength
		|| !Number.isSafeInteger(request.length)
		|| request.length <= 0
		|| request.length > maximumReadLength
	) {
		throw new RangeError(`Content lease '${request.lease}' received an invalid read range.`);
	}
}

/** Owns immutable renderer-published bytes for one exact logical Host connection. */
export class ClientContentResourceService implements IClientContentResourceService {
	declare readonly _serviceBrand: undefined;
	private readonly limits: IClientContentResourceLimits;
	private readonly publications = new Map<AgentContentReferenceId, PublicationRecord>();
	private readonly leases = new Map<AgentContentLeaseId, ILeaseRecord>();
	private activeOperations = 0;

	constructor(
		readonly connection: AgentHostClientConnectionId,
		limits: IClientContentResourceLimits,
	) {
		createAgentHostClientConnectionId(connection);
		this.limits = validateLimits(limits);
	}

	async publishBlob(input: IClientContentBlobPublication): Promise<IClientContentPublication> {
		if (input.mediaType !== null) {
			assertMediaType(input.mediaType, 'Blob media type');
		}
		const bytes = assertBytes(input.bytes, this.limits.maximumBlobBytes, 'Blob publication');
		const digest = await digestBytes(bytes);
		const reference = createAgentContentReferenceId(`blob:${generateUuid()}`);
		const content: IAgentHostContentReference = Object.freeze({
			kind: 'reference',
			reference,
			owner: Object.freeze({ kind: 'client', connection: this.connection }),
			shape: 'blob',
			...(input.mediaType === null ? {} : { mediaType: input.mediaType }),
			bounds: Object.freeze({
				byteLength: bytes.byteLength,
				maximumReadLength: Math.min(bytes.byteLength, this.limits.maximumReadLength),
			}),
			version: createAgentContentVersion(digest),
			digest,
		});
		const record: IBlobRecord = {
			kind: 'blob',
			content,
			bytes,
			releaseRequested: false,
			leaseCount: 0,
		};
		this.publications.set(reference, record);
		return this.createPublication(record);
	}

	async publishTree(files: readonly IClientContentTreeFile[]): Promise<IClientContentPublication> {
		if (files.length === 0 || files.length > this.limits.maximumTreeEntries) {
			throw new RangeError(`Directory publication requires between 1 and ${this.limits.maximumTreeEntries} files.`);
		}
		const paths = new Set<string>();
		const directories = new Set<string>();
		const fileRecords: ITreeFileRecord[] = [];
		let totalBytes = 0;
		let maximumDepth = 0;
		for (const [index, file] of files.entries()) {
			const path = normalizeTreePath(file.path);
			if (paths.has(path)) {
				throw new Error(`Directory publication contains duplicate path '${path}'.`);
			}
			paths.add(path);
			if (file.mediaType !== null) {
				assertMediaType(file.mediaType, `Directory file ${index} media type`);
			}
			const bytes = assertBytes(file.bytes, this.limits.maximumBlobBytes, `Directory file '${path}'`);
			totalBytes += bytes.byteLength;
			if (!Number.isSafeInteger(totalBytes) || totalBytes > this.limits.maximumTreeBytes) {
				throw new RangeError(`Directory publication exceeds ${this.limits.maximumTreeBytes} bytes.`);
			}
			maximumDepth = Math.max(maximumDepth, treeDepth(path));
			if (maximumDepth > this.limits.maximumTreeDepth) {
				throw new RangeError(`Directory publication exceeds depth ${this.limits.maximumTreeDepth}.`);
			}
			const segments = path.split('/');
			for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
				directories.add(segments.slice(0, segmentIndex).join('/'));
			}
			const digest = await digestBytes(bytes);
			fileRecords.push({
				path,
				mediaType: file.mediaType,
				bytes,
				entry: Object.freeze({
					kind: 'file',
					path,
					mediaType: file.mediaType,
					byteLength: bytes.byteLength,
					version: createAgentContentVersion(digest),
					digest,
				}),
			});
		}
		const entries: AgentContentTreeEntry[] = [
			...[...directories].map(path => Object.freeze({ kind: 'directory' as const, path })),
			...fileRecords.map(file => file.entry),
		].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
		for (const directory of directories) {
			if (paths.has(directory)) {
				throw new Error(`Directory publication contains a file-directory collision at '${directory}'.`);
			}
		}
		if (entries.length > this.limits.maximumTreeEntries) {
			throw new RangeError(`Directory manifest exceeds ${this.limits.maximumTreeEntries} entries.`);
		}
		const manifest = new TextEncoder().encode(encodeAgentHostProtocolValue(entries));
		const digest = await digestBytes(manifest);
		const reference = createAgentContentReferenceId(`tree:${generateUuid()}`);
		const content: IAgentHostContentReference = Object.freeze({
			kind: 'reference',
			reference,
			owner: Object.freeze({ kind: 'client', connection: this.connection }),
			shape: 'tree',
			bounds: Object.freeze({
				byteLength: totalBytes,
				maximumReadLength: Math.min(totalBytes, this.limits.maximumReadLength),
				treeDepth: maximumDepth,
				treeEntryCount: entries.length,
			}),
			version: createAgentContentVersion(digest),
			digest,
		});
		const record: ITreeRecord = {
			kind: 'tree',
			content,
			entries: Object.freeze(entries),
			files: new Map(fileRecords.map(file => [file.path, file])),
			releaseRequested: false,
			leaseCount: 0,
		};
		this.publications.set(reference, record);
		return this.createPublication(record);
	}

	async open(
		request: IAgentContentResourceReaderOpenRequest,
		token: CancellationToken,
	): Promise<IAgentContentResourceLease> {
		assertAgentContentResourceReaderOpenRequest(request);
		return this.runOperation(token, undefined, () => {
			if (request.content.owner.kind !== 'client' || request.content.owner.connection !== this.connection) {
				throw new Error(`Content reference '${request.content.reference}' belongs to another owner.`);
			}
			const publication = this.publications.get(request.content.reference);
			if (publication === undefined) {
				throw new Error(`Content reference '${request.content.reference}' is unavailable.`);
			}
			assertSameContent(publication.content, request.content);
			this.assertRequestedLimits(request);
			const binding = contextKey(request);
			if (
				publication.releaseRequested
				&& (publication.leaseCount === 0 || publication.boundContext !== binding)
			) {
				throw new Error(`Content reference '${request.content.reference}' is unavailable.`);
			}
			if (publication.boundContext !== undefined && publication.boundContext !== binding) {
				throw new Error(`Content reference '${request.content.reference}' is already bound to another Turn.`);
			}
			if (this.leases.size >= this.limits.maximumOpenLeases) {
				throw new RangeError(`Client content lease count exceeds ${this.limits.maximumOpenLeases}.`);
			}
			publication.boundContext = binding;
			const lease = createAgentContentLeaseId(generateUuid());
			publication.leaseCount += 1;
			this.leases.set(lease, {
				publication,
				limits: Object.freeze({ ...request.limits }),
				totalReadBytes: 0,
				treePages: 0,
				activeOperations: 0,
			});
			return Object.freeze({ lease, content: publication.content });
		});
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentBlobReadRequest(request);
		const record = this.requireLease(request.lease);
		return this.runOperation(token, record, () => {
			if (record.publication.kind !== 'blob') {
				throw new Error(`Content lease '${request.lease}' is not a blob.`);
			}
			const result = this.readBytes(request, record.publication.bytes, record.limits.maximumReadLength);
			this.consumeReadBytes(record, result.byteLength);
			assertAgentContentBlobReadResult(result, request, record.publication.bytes.byteLength);
			return result;
		});
	}

	async readTreePage(
		request: IAgentContentTreePageRequest,
		token: CancellationToken,
	): Promise<IAgentContentTreePage> {
		assertAgentContentTreePageRequest(request);
		const record = this.requireLease(request.lease);
		return this.runOperation(token, record, () => {
			const publication = record.publication;
			if (publication.kind !== 'tree') {
				throw new Error(`Content lease '${request.lease}' is not a tree.`);
			}
			if (
				request.maximumEntries > record.limits.maximumTreePageEntries
				|| request.maximumEntries > this.limits.maximumTreePageEntries
			) {
				throw new RangeError(`Content lease '${request.lease}' received an invalid tree page limit.`);
			}
			record.treePages += 1;
			if (record.treePages > record.limits.maximumTreePages || record.treePages > this.limits.maximumTreePages) {
				throw new RangeError(`Content lease '${request.lease}' exceeded its tree page limit.`);
			}
			const offset = request.cursor === null ? 0 : Number(request.cursor);
			if (
				!Number.isSafeInteger(offset)
				|| offset < 0
				|| offset >= publication.entries.length
				|| (request.cursor !== null && String(offset) !== request.cursor)
			) {
				throw new Error(`Content lease '${request.lease}' received an invalid tree cursor.`);
			}
			const entries = publication.entries.slice(offset, offset + request.maximumEntries);
			const nextOffset = offset + entries.length;
			const result = Object.freeze({
				entries: Object.freeze(entries),
				nextCursor: nextOffset < publication.entries.length ? String(nextOffset) : null,
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
		const record = this.requireLease(request.lease);
		return this.runOperation(token, record, () => {
			const publication = record.publication;
			if (publication.kind !== 'tree') {
				throw new Error(`Content lease '${request.lease}' is not a tree.`);
			}
			const file = publication.files.get(normalizeTreePath(request.path));
			if (file === undefined) {
				throw new Error(`Tree content lease '${request.lease}' does not contain '${request.path}'.`);
			}
			const result = this.readBytes(request, file.bytes, record.limits.maximumReadLength);
			this.consumeReadBytes(record, result.byteLength);
			assertAgentContentBlobReadResult(result, request, file.bytes.byteLength);
			return result;
		});
	}

	async release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		createAgentContentLeaseId(lease);
		const record = this.requireLease(lease);
		if (record.activeOperations !== 0) {
			throw new Error(`Content lease '${lease}' still has an active operation.`);
		}
		await this.runOperation(token, record, () => {
			this.leases.delete(lease);
			record.publication.leaseCount -= 1;
			if (record.publication.leaseCount === 0 && !record.publication.releaseRequested) {
				record.publication.boundContext = undefined;
			}
			this.deleteReleasedPublication(record.publication);
		}, false);
	}

	private createPublication(record: PublicationRecord): IClientContentPublication {
		let released = false;
		return Object.freeze({
			content: record.content,
			release: () => {
				if (released) {
					throw new Error(`Content publication '${record.content.reference}' was already released.`);
				}
				released = true;
				record.releaseRequested = true;
				this.deleteReleasedPublication(record);
			},
		});
	}

	private deleteReleasedPublication(record: PublicationRecord): void {
		if (record.releaseRequested && record.leaseCount === 0) {
			this.publications.delete(record.content.reference);
		}
	}

	private requireLease(lease: AgentContentLeaseId): ILeaseRecord {
		const record = this.leases.get(lease);
		if (record === undefined) {
			throw new Error(`Content lease '${lease}' is unavailable.`);
		}
		return record;
	}

	private assertRequestedLimits(request: IAgentContentResourceReaderOpenRequest): void {
		const now = Date.now();
		const limits = request.limits;
		if (
			limits.deadline <= now
			|| limits.deadline - now > this.limits.maximumLeaseDurationMilliseconds
			|| limits.maximumReadLength > this.limits.maximumReadLength
			|| limits.maximumReadLength > request.content.bounds.maximumReadLength
			|| limits.maximumTotalReadBytes > this.limits.maximumTotalReadBytes
			|| limits.maximumTreePageEntries > this.limits.maximumTreePageEntries
			|| limits.maximumTreePages > this.limits.maximumTreePages
			|| limits.maximumConcurrentOperations > this.limits.maximumConcurrentOperations
		) {
			throw new RangeError(`Content reference '${request.content.reference}' requested unsupported read limits.`);
		}
	}

	private consumeReadBytes(record: ILeaseRecord, byteLength: number): void {
		const total = record.totalReadBytes + byteLength;
		if (!Number.isSafeInteger(total) || total > record.limits.maximumTotalReadBytes) {
			throw new RangeError('Content lease exceeded its total read-byte limit.');
		}
		record.totalReadBytes = total;
	}

	private async runOperation<TResult>(
		token: CancellationToken,
		record: ILeaseRecord | undefined,
		operation: () => TResult,
		enforceDeadline = true,
	): Promise<TResult> {
		if (
			token.isCancellationRequested
			|| (enforceDeadline && record !== undefined && Date.now() >= record.limits.deadline)
		) {
			throw new CancellationError();
		}
		if (
			this.activeOperations >= this.limits.maximumConcurrentOperations
			|| (record !== undefined && record.activeOperations >= record.limits.maximumConcurrentOperations)
		) {
			throw new RangeError('Client content operation concurrency limit was exceeded.');
		}
		this.activeOperations += 1;
		if (record !== undefined) {
			record.activeOperations += 1;
		}
		try {
			return await raceCancellationError(Promise.resolve().then(operation), token);
		} finally {
			this.activeOperations -= 1;
			if (record !== undefined) {
				record.activeOperations -= 1;
			}
		}
	}

	private readBytes(
		request: IAgentContentBlobReadRequest,
		bytes: Uint8Array,
		maximumReadLength: number,
	): IAgentContentBlobReadResult {
		assertReadRange(request, bytes.byteLength, maximumReadLength);
		const end = Math.min(bytes.byteLength, request.offset + request.length);
		const chunk = bytes.subarray(request.offset, end);
		return Object.freeze({
			offset: request.offset,
			byteLength: chunk.byteLength,
			data: toBase64(chunk),
			encoding: 'base64',
			endOfContent: end === bytes.byteLength,
		});
	}
}
