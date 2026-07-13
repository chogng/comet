/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { IAgentHostContentReference, assertAgentHostContentReference } from './attachments.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	AgentAttachmentId,
	AgentChatId,
	AgentContentDigest,
	AgentContentLeaseId,
	AgentContentMaterializationId,
	AgentContentVersion,
	AgentSessionId,
	AgentTurnId,
	createAgentAttachmentId,
	createAgentChatId,
	createAgentContentDigest,
	createAgentContentLeaseId,
	createAgentContentMaterializationId,
	createAgentContentVersion,
	createAgentSessionId,
	createAgentTurnId,
} from './identities.js';
import { assertAgentHostProtocolValue, encodeAgentHostProtocolValue } from './protocolValues.js';

export interface IAgentContentResourceContext {
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly attachment: AgentAttachmentId;
}

export interface IAgentContentResourceOpenRequest extends IAgentContentResourceContext {
	readonly content: IAgentHostContentReference;
}

export interface IAgentContentResourceReadLimits {
	readonly maximumReadLength: number;
	readonly maximumTotalReadBytes: number;
	readonly maximumTreePageEntries: number;
	readonly maximumTreePages: number;
	readonly maximumConcurrentOperations: number;
	readonly deadline: number;
}

export interface IAgentContentResourceReaderOpenRequest extends IAgentContentResourceOpenRequest {
	readonly limits: IAgentContentResourceReadLimits;
}

export interface IAgentContentResourceLease {
	readonly lease: AgentContentLeaseId;
	readonly content: IAgentHostContentReference;
}

export interface IAgentContentBlobReadRequest {
	readonly lease: AgentContentLeaseId;
	readonly offset: number;
	readonly length: number;
}

export interface IAgentContentBlobReadResult {
	readonly offset: number;
	readonly byteLength: number;
	readonly data: string;
	readonly encoding: 'base64';
	readonly endOfContent: boolean;
}

export type AgentContentTreeEntry =
	| {
		readonly kind: 'directory';
		readonly path: string;
	}
	| {
		readonly kind: 'file';
		readonly path: string;
		readonly mediaType: string | null;
		readonly byteLength: number;
		readonly version: AgentContentVersion;
		readonly digest: AgentContentDigest;
	};

export interface IAgentContentTreePageRequest {
	readonly lease: AgentContentLeaseId;
	readonly cursor: string | null;
	readonly maximumEntries: number;
}

export interface IAgentContentTreePage {
	readonly entries: readonly AgentContentTreeEntry[];
	readonly nextCursor: string | null;
}

export interface IAgentContentTreeEntryReadRequest extends IAgentContentBlobReadRequest {
	readonly path: string;
}

export interface IAgentContentMaterializeRequest {
	readonly lease: AgentContentLeaseId;
}

export interface IAgentContentMaterialization {
	readonly id: AgentContentMaterializationId;
	readonly resource: string;
}

type ProtocolRecord = Readonly<Record<string, unknown>>;

const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const normalizedTreePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\0]+$/;

function invalidProtocol(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Agent content-resource protocol value',
		{ field, value: diagnostic },
	);
}

function requireRecord(value: unknown, field: string): ProtocolRecord {
	assertAgentHostProtocolValue(value);
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidProtocol(field, value);
	}
	return value as ProtocolRecord;
}

function requireExactKeys(
	record: ProtocolRecord,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidProtocol(`${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidProtocol(`${field}.${key}`, 'missing');
		}
	}
}

function requireSafeInteger(value: unknown, field: string, minimum: number, maximum: number): number {
	if (
		typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < minimum
		|| value > maximum
	) {
		return invalidProtocol(field, value);
	}
	return value;
}

function requireString(value: unknown, field: string, maximumLength: number, allowEmpty = false): string {
	if (
		typeof value !== 'string'
		|| (!allowEmpty && value.length === 0)
		|| value.length > maximumLength
	) {
		return invalidProtocol(field, value);
	}
	return value;
}

function requireLease(value: unknown, field: string): AgentContentLeaseId {
	return createAgentContentLeaseId(requireString(value, field, 128));
}

function assertContext(value: ProtocolRecord, field: string): void {
	createAgentSessionId(requireString(value.session, `${field}.session`, 128));
	createAgentChatId(requireString(value.chat, `${field}.chat`, 128));
	createAgentTurnId(requireString(value.turn, `${field}.turn`, 128));
	createAgentAttachmentId(requireString(value.attachment, `${field}.attachment`, 128));
}

export function assertAgentContentResourceOpenRequest(
	value: unknown,
): asserts value is IAgentContentResourceOpenRequest {
	const request = requireRecord(value, 'contentResource.open');
	requireExactKeys(
		request,
		['session', 'chat', 'turn', 'attachment', 'content'],
		[],
		'contentResource.open',
	);
	assertContext(request, 'contentResource.open');
	assertAgentHostContentReference(request.content);
}

export function assertAgentContentResourceReadLimits(
	value: unknown,
): asserts value is IAgentContentResourceReadLimits {
	const limits = requireRecord(value, 'contentResource.limits');
	requireExactKeys(limits, [
		'maximumReadLength',
		'maximumTotalReadBytes',
		'maximumTreePageEntries',
		'maximumTreePages',
		'maximumConcurrentOperations',
		'deadline',
	], [], 'contentResource.limits');
	requireSafeInteger(limits.maximumReadLength, 'contentResource.limits.maximumReadLength', 0, Number.MAX_SAFE_INTEGER);
	requireSafeInteger(limits.maximumTotalReadBytes, 'contentResource.limits.maximumTotalReadBytes', 0, Number.MAX_SAFE_INTEGER);
	requireSafeInteger(limits.maximumTreePageEntries, 'contentResource.limits.maximumTreePageEntries', 1, 1_000_000);
	requireSafeInteger(limits.maximumTreePages, 'contentResource.limits.maximumTreePages', 1, 1_000_000);
	requireSafeInteger(limits.maximumConcurrentOperations, 'contentResource.limits.maximumConcurrentOperations', 1, 1_024);
	requireSafeInteger(limits.deadline, 'contentResource.limits.deadline', 1, Number.MAX_SAFE_INTEGER);
}

export function assertAgentContentResourceReaderOpenRequest(
	value: unknown,
): asserts value is IAgentContentResourceReaderOpenRequest {
	const request = requireRecord(value, 'contentResource.readerOpen');
	requireExactKeys(
		request,
		['session', 'chat', 'turn', 'attachment', 'content', 'limits'],
		[],
		'contentResource.readerOpen',
	);
	assertContext(request, 'contentResource.readerOpen');
	assertAgentHostContentReference(request.content);
	assertAgentContentResourceReadLimits(request.limits);
}

export function assertAgentContentResourceLease(
	value: unknown,
	request?: IAgentContentResourceOpenRequest,
): asserts value is IAgentContentResourceLease {
	const lease = requireRecord(value, 'contentResource.lease');
	requireExactKeys(lease, ['lease', 'content'], [], 'contentResource.lease');
	createAgentContentLeaseId(requireString(lease.lease, 'contentResource.lease.lease', 128));
	assertAgentHostContentReference(lease.content);
	if (
		request !== undefined
		&& encodeAgentHostProtocolValue(request.content) !== encodeAgentHostProtocolValue(lease.content)
	) {
		invalidProtocol('contentResource.lease.content', lease.content.reference);
	}
}

export function assertAgentContentBlobReadRequest(
	value: unknown,
): asserts value is IAgentContentBlobReadRequest {
	const request = requireRecord(value, 'contentResource.readBlob');
	requireExactKeys(request, ['lease', 'offset', 'length'], [], 'contentResource.readBlob');
	requireLease(request.lease, 'contentResource.readBlob.lease');
	requireSafeInteger(request.offset, 'contentResource.readBlob.offset', 0, Number.MAX_SAFE_INTEGER);
	requireSafeInteger(request.length, 'contentResource.readBlob.length', 1, Number.MAX_SAFE_INTEGER);
}

function decodedBase64Length(value: string, field: string): number {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		return invalidProtocol(field, value);
	}
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	return (value.length / 4) * 3 - padding;
}

export function assertAgentContentBlobReadResult(
	value: unknown,
	request: IAgentContentBlobReadRequest,
	totalByteLength: number,
): asserts value is IAgentContentBlobReadResult {
	assertAgentContentBlobReadResultShape(value, request);
	const expectedLength = Math.min(request.length, totalByteLength - request.offset);
	if (expectedLength < 0 || value.byteLength !== expectedLength) {
		invalidProtocol('contentResource.blobResult.range', value.byteLength);
	}
	if (value.endOfContent !== (request.offset + expectedLength === totalByteLength)) {
		invalidProtocol('contentResource.blobResult.endOfContent', value.endOfContent);
	}
}

export function assertAgentContentBlobReadResultShape(
	value: unknown,
	request: IAgentContentBlobReadRequest,
): asserts value is IAgentContentBlobReadResult {
	const result = requireRecord(value, 'contentResource.blobResult');
	requireExactKeys(
		result,
		['offset', 'byteLength', 'data', 'encoding', 'endOfContent'],
		[],
		'contentResource.blobResult',
	);
	if (
		result.offset !== request.offset
		|| typeof result.byteLength !== 'number'
		|| !Number.isSafeInteger(result.byteLength)
		|| result.byteLength < 0
		|| result.byteLength > request.length
	) {
		invalidProtocol('contentResource.blobResult.range', result.byteLength);
	}
	const data = requireString(result.data, 'contentResource.blobResult.data', request.length * 2 + 4, true);
	if (result.encoding !== 'base64' || decodedBase64Length(data, 'contentResource.blobResult.data') !== result.byteLength) {
		invalidProtocol('contentResource.blobResult.encoding', result.encoding);
	}
	if (typeof result.endOfContent !== 'boolean') {
		invalidProtocol('contentResource.blobResult.endOfContent', result.endOfContent);
	}
}

export function assertAgentContentTreePath(value: unknown, field: string): asserts value is string {
	const path = requireString(value, field, 4_096);
	if (!normalizedTreePathPattern.test(path) || path.endsWith('/')) {
		invalidProtocol(field, path);
	}
}

export function assertAgentContentTreeEntry(
	value: unknown,
	field = 'contentResource.treeEntry',
): asserts value is AgentContentTreeEntry {
	const entry = requireRecord(value, field);
	if (entry.kind === 'directory') {
		requireExactKeys(entry, ['kind', 'path'], [], field);
		assertAgentContentTreePath(entry.path, `${field}.path`);
		return;
	}
	if (entry.kind === 'file') {
		requireExactKeys(entry, ['kind', 'path', 'mediaType', 'byteLength', 'version', 'digest'], [], field);
		assertAgentContentTreePath(entry.path, `${field}.path`);
		if (entry.mediaType !== null) {
			const mediaType = requireString(entry.mediaType, `${field}.mediaType`, 127);
			if (!mediaTypePattern.test(mediaType)) {
				invalidProtocol(`${field}.mediaType`, mediaType);
			}
		}
		requireSafeInteger(entry.byteLength, `${field}.byteLength`, 0, Number.MAX_SAFE_INTEGER);
		createAgentContentVersion(requireString(entry.version, `${field}.version`, 128));
		createAgentContentDigest(requireString(entry.digest, `${field}.digest`, 71));
		return;
	}
	invalidProtocol(`${field}.kind`, entry.kind);
}

export function assertAgentContentTreePageRequest(
	value: unknown,
): asserts value is IAgentContentTreePageRequest {
	const request = requireRecord(value, 'contentResource.readTreePage');
	requireExactKeys(request, ['lease', 'cursor', 'maximumEntries'], [], 'contentResource.readTreePage');
	requireLease(request.lease, 'contentResource.readTreePage.lease');
	if (request.cursor !== null) {
		requireString(request.cursor, 'contentResource.readTreePage.cursor', 512);
	}
	requireSafeInteger(request.maximumEntries, 'contentResource.readTreePage.maximumEntries', 1, 1_000_000);
}

export function assertAgentContentTreePage(
	value: unknown,
	request: IAgentContentTreePageRequest,
): asserts value is IAgentContentTreePage {
	const page = requireRecord(value, 'contentResource.treePage');
	requireExactKeys(page, ['entries', 'nextCursor'], [], 'contentResource.treePage');
	if (!Array.isArray(page.entries) || page.entries.length > request.maximumEntries) {
		invalidProtocol('contentResource.treePage.entries', page.entries);
	}
	const paths = new Set<string>();
	for (const [index, entry] of page.entries.entries()) {
		assertAgentContentTreeEntry(entry, `contentResource.treePage.entries.${index}`);
		if (paths.has(entry.path)) {
			invalidProtocol(`contentResource.treePage.entries.${index}.path`, entry.path);
		}
		paths.add(entry.path);
	}
	if (page.nextCursor !== null) {
		requireString(page.nextCursor, 'contentResource.treePage.nextCursor', 512);
		if (page.entries.length === 0 || page.nextCursor === request.cursor) {
			invalidProtocol('contentResource.treePage.nextCursor', page.nextCursor);
		}
	}
}

export function assertAgentContentTreeEntryReadRequest(
	value: unknown,
): asserts value is IAgentContentTreeEntryReadRequest {
	const request = requireRecord(value, 'contentResource.readTreeEntry');
	requireExactKeys(request, ['lease', 'offset', 'length', 'path'], [], 'contentResource.readTreeEntry');
	requireLease(request.lease, 'contentResource.readTreeEntry.lease');
	requireSafeInteger(request.offset, 'contentResource.readTreeEntry.offset', 0, Number.MAX_SAFE_INTEGER);
	requireSafeInteger(request.length, 'contentResource.readTreeEntry.length', 1, Number.MAX_SAFE_INTEGER);
	assertAgentContentTreePath(request.path, 'contentResource.readTreeEntry.path');
}

export function assertAgentContentMaterializeRequest(
	value: unknown,
): asserts value is IAgentContentMaterializeRequest {
	const request = requireRecord(value, 'contentResource.materialize');
	requireExactKeys(request, ['lease'], [], 'contentResource.materialize');
	requireLease(request.lease, 'contentResource.materialize.lease');
}

export function assertAgentContentMaterialization(
	value: unknown,
): asserts value is IAgentContentMaterialization {
	const materialization = requireRecord(value, 'contentResource.materialization');
	requireExactKeys(materialization, ['id', 'resource'], [], 'contentResource.materialization');
	createAgentContentMaterializationId(requireString(materialization.id, 'contentResource.materialization.id', 128));
	requireString(materialization.resource, 'contentResource.materialization.resource', 4_096);
}

/** Reads one immutable published content version at its owning endpoint. */
export interface IAgentContentResourceReaderPort {
	open(request: IAgentContentResourceReaderOpenRequest, token: CancellationToken): Promise<IAgentContentResourceLease>;
	readBlob(request: IAgentContentBlobReadRequest, token: CancellationToken): Promise<IAgentContentBlobReadResult>;
	readTreePage(request: IAgentContentTreePageRequest, token: CancellationToken): Promise<IAgentContentTreePage>;
	readTreeEntry(request: IAgentContentTreeEntryReadRequest, token: CancellationToken): Promise<IAgentContentBlobReadResult>;
	release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void>;
}

/** Host-side content boundary, including Host-owned materialization lifetime. */
export interface IAgentContentResourcePort {
	open(request: IAgentContentResourceOpenRequest, token: CancellationToken): Promise<IAgentContentResourceLease>;
	readBlob(request: IAgentContentBlobReadRequest, token: CancellationToken): Promise<IAgentContentBlobReadResult>;
	readTreePage(request: IAgentContentTreePageRequest, token: CancellationToken): Promise<IAgentContentTreePage>;
	readTreeEntry(request: IAgentContentTreeEntryReadRequest, token: CancellationToken): Promise<IAgentContentBlobReadResult>;
	release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void>;
	materialize(request: IAgentContentMaterializeRequest, token: CancellationToken): Promise<IAgentContentMaterialization>;
	releaseMaterialization(materialization: AgentContentMaterializationId, token: CancellationToken): Promise<void>;
}
