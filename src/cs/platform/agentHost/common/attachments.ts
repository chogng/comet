/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AgentAttachmentId,
	AgentAttachmentProducerTypeId,
	AgentAttachmentRepresentationSchemaId,
	AgentContentDigest,
	AgentContentReferenceId,
	AgentContentVersion,
	AgentHostClientConnectionId,
	AgentInteractionTargetId,
	AgentInteractionTargetOwnerId,
	AgentInteractionTargetRevision,
	AgentInteractionTargetTypeId,
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentContentDigest,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentHostClientConnectionId,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
} from './identities.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import { AgentHostProtocolValue, IAgentHostDisplayMetadata, IAgentHostMetadataEntry, assertAgentHostProtocolValue } from './protocolValues.js';

export interface IAgentHostAttachmentRepresentation {
	readonly schema: AgentAttachmentRepresentationSchemaId;
	readonly mediaType: string;
	readonly value: AgentHostProtocolValue;
}

export interface IAgentHostInlineContent {
	readonly kind: 'inline';
	readonly mediaType: string;
	readonly encoding: 'utf8' | 'base64';
	readonly data: string;
	readonly byteLength: number;
	readonly version: AgentContentVersion;
	readonly digest: AgentContentDigest;
}

export type AgentHostContentOwner =
	| { readonly kind: 'host' }
	| {
		readonly kind: 'client';
		readonly connection: AgentHostClientConnectionId;
	};

export interface IAgentHostContentBounds {
	readonly byteLength: number;
	readonly maximumReadLength: number;
	readonly treeDepth?: number;
	readonly treeEntryCount?: number;
}

export interface IAgentHostContentReference {
	readonly kind: 'reference';
	readonly reference: AgentContentReferenceId;
	readonly owner: AgentHostContentOwner;
	readonly shape: 'blob' | 'tree';
	readonly mediaType?: string;
	readonly bounds: IAgentHostContentBounds;
	readonly version: AgentContentVersion;
	readonly digest: AgentContentDigest;
}

export type AgentHostAttachmentContent = IAgentHostInlineContent | IAgentHostContentReference;

export interface IAgentHostAttachment {
	readonly envelopeVersion: 1;
	readonly id: AgentAttachmentId;
	readonly producerType: AgentAttachmentProducerTypeId;
	readonly display: IAgentHostDisplayMetadata;
	readonly representation: IAgentHostAttachmentRepresentation;
	readonly content?: AgentHostAttachmentContent;
	readonly metadata: readonly IAgentHostMetadataEntry[];
}

export type AgentHostInteractionTargetAuthority =
	| { readonly kind: 'host' }
	| {
		readonly kind: 'client';
		readonly connection: AgentHostClientConnectionId;
	};

export interface IAgentHostInteractionTarget {
	readonly id: AgentInteractionTargetId;
	readonly owner: AgentInteractionTargetOwnerId;
	readonly type: AgentInteractionTargetTypeId;
	readonly schemaVersion: number;
	readonly resource: string;
	readonly resourceVersion: string;
	readonly revision: AgentInteractionTargetRevision;
	readonly authority: AgentHostInteractionTargetAuthority;
	readonly availability: 'connection' | 'turn';
	readonly display: IAgentHostDisplayMetadata;
	readonly expiresAt?: number;
}

const maximumInlineContentBytes = 32 * 1024 * 1024;

function invalidProtocolValue(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Agent Host attachment protocol value',
		{ field, value: diagnostic },
	);
}

function asRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidProtocolValue(field, value);
	}

	return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidProtocolValue(`${field}.${key}`, key);
		}
	}

	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidProtocolValue(`${field}.${key}`, 'missing');
		}
	}
}

function assertString(value: unknown, field: string, maximumLength: number, allowEmpty = false): asserts value is string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximumLength) {
		invalidProtocolValue(field, value);
	}
}

function assertNonNegativeInteger(value: unknown, field: string, maximum: number): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
		invalidProtocolValue(field, value);
	}
}

function assertDisplayMetadata(value: unknown, field: string): void {
	const display = asRecord(value, field);
	assertExactKeys(display, ['label'], ['description'], field);
	assertString(display.label, `${field}.label`, 512);
	if (display.description !== undefined) {
		assertString(display.description, `${field}.description`, 2_048, true);
	}
}

function assertMediaType(value: unknown, field: string): asserts value is string {
	assertString(value, field, 127);
	if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)) {
		invalidProtocolValue(field, value);
	}
}

function decodedBase64Length(value: string, field: string): number {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		return invalidProtocolValue(field, value);
	}

	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	return (value.length / 4) * 3 - padding;
}

function assertContentOwner(value: unknown, field: string): void {
	const owner = asRecord(value, field);
	if (owner.kind === 'host') {
		assertExactKeys(owner, ['kind'], [], field);
		return;
	}

	if (owner.kind === 'client') {
		assertExactKeys(owner, ['kind', 'connection'], [], field);
		assertString(owner.connection, `${field}.connection`, 128);
		createAgentHostClientConnectionId(owner.connection);
		return;
	}

	invalidProtocolValue(`${field}.kind`, owner.kind);
}

function assertInlineContent(value: Readonly<Record<string, unknown>>, field: string): void {
	assertExactKeys(value, ['kind', 'mediaType', 'encoding', 'data', 'byteLength', 'version', 'digest'], [], field);
	assertMediaType(value.mediaType, `${field}.mediaType`);
	if (value.encoding !== 'utf8' && value.encoding !== 'base64') {
		invalidProtocolValue(`${field}.encoding`, value.encoding);
	}
	assertString(value.data, `${field}.data`, maximumInlineContentBytes * 2, true);
	assertNonNegativeInteger(value.byteLength, `${field}.byteLength`, maximumInlineContentBytes);
	const actualByteLength = value.encoding === 'utf8'
		? new TextEncoder().encode(value.data).byteLength
		: decodedBase64Length(value.data, `${field}.data`);
	if (actualByteLength !== value.byteLength) {
		invalidProtocolValue(`${field}.byteLength`, value.byteLength);
	}
	assertString(value.version, `${field}.version`, 128);
	createAgentContentVersion(value.version);
	assertString(value.digest, `${field}.digest`, 71);
	createAgentContentDigest(value.digest);
}

function assertContentReference(value: Readonly<Record<string, unknown>>, field: string): void {
	assertExactKeys(value, ['kind', 'reference', 'owner', 'shape', 'bounds', 'version', 'digest'], ['mediaType'], field);
	assertString(value.reference, `${field}.reference`, 128);
	createAgentContentReferenceId(value.reference);
	assertContentOwner(value.owner, `${field}.owner`);
	if (value.shape !== 'blob' && value.shape !== 'tree') {
		invalidProtocolValue(`${field}.shape`, value.shape);
	}
	if (value.mediaType !== undefined) {
		assertMediaType(value.mediaType, `${field}.mediaType`);
	}

	const bounds = asRecord(value.bounds, `${field}.bounds`);
	assertExactKeys(bounds, ['byteLength', 'maximumReadLength'], ['treeDepth', 'treeEntryCount'], `${field}.bounds`);
	assertNonNegativeInteger(bounds.byteLength, `${field}.bounds.byteLength`, Number.MAX_SAFE_INTEGER);
	assertNonNegativeInteger(bounds.maximumReadLength, `${field}.bounds.maximumReadLength`, bounds.byteLength);
	if (value.shape === 'tree') {
		assertNonNegativeInteger(bounds.treeDepth, `${field}.bounds.treeDepth`, 1_024);
		assertNonNegativeInteger(bounds.treeEntryCount, `${field}.bounds.treeEntryCount`, 1_000_000);
	} else if (bounds.treeDepth !== undefined || bounds.treeEntryCount !== undefined) {
		invalidProtocolValue(`${field}.bounds`, 'blob-with-tree-bounds');
	}

	assertString(value.version, `${field}.version`, 128);
	createAgentContentVersion(value.version);
	assertString(value.digest, `${field}.digest`, 71);
	createAgentContentDigest(value.digest);
}

export function assertAgentHostContentReference(value: unknown): asserts value is IAgentHostContentReference {
	assertAgentHostProtocolValue(value);
	const content = asRecord(value, 'contentReference');
	if (content.kind !== 'reference') {
		invalidProtocolValue('contentReference.kind', content.kind);
	}
	assertContentReference(content, 'contentReference');
}

export function assertAgentHostAttachment(value: unknown): asserts value is IAgentHostAttachment {
	assertAgentHostProtocolValue(value);
	const attachment = asRecord(value, 'attachment');
	assertExactKeys(
		attachment,
		['envelopeVersion', 'id', 'producerType', 'display', 'representation', 'metadata'],
		['content'],
		'attachment',
	);
	if (attachment.envelopeVersion !== 1) {
		invalidProtocolValue('attachment.envelopeVersion', attachment.envelopeVersion);
	}
	assertString(attachment.id, 'attachment.id', 128);
	createAgentAttachmentId(attachment.id);
	assertString(attachment.producerType, 'attachment.producerType', 128);
	createAgentAttachmentProducerTypeId(attachment.producerType);
	assertDisplayMetadata(attachment.display, 'attachment.display');

	const representation = asRecord(attachment.representation, 'attachment.representation');
	assertExactKeys(representation, ['schema', 'mediaType', 'value'], [], 'attachment.representation');
	assertString(representation.schema, 'attachment.representation.schema', 128);
	createAgentAttachmentRepresentationSchemaId(representation.schema);
	assertMediaType(representation.mediaType, 'attachment.representation.mediaType');
	assertAgentHostProtocolValue(representation.value);

	if (attachment.content !== undefined) {
		const content = asRecord(attachment.content, 'attachment.content');
		if (content.kind === 'inline') {
			assertInlineContent(content, 'attachment.content');
		} else if (content.kind === 'reference') {
			assertContentReference(content, 'attachment.content');
		} else {
			invalidProtocolValue('attachment.content.kind', content.kind);
		}
	}

	if (!Array.isArray(attachment.metadata) || attachment.metadata.length > 64) {
		invalidProtocolValue('attachment.metadata', attachment.metadata);
	}
	for (const [index, entryValue] of attachment.metadata.entries()) {
		const entry = asRecord(entryValue, `attachment.metadata.${index}`);
		assertExactKeys(entry, ['namespace', 'value'], [], `attachment.metadata.${index}`);
		assertString(entry.namespace, `attachment.metadata.${index}.namespace`, 128);
		if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(entry.namespace)) {
			invalidProtocolValue(`attachment.metadata.${index}.namespace`, entry.namespace);
		}
		assertAgentHostProtocolValue(entry.value);
	}
}

function assertTargetAuthority(value: unknown, field: string): void {
	assertContentOwner(value, field);
}

export function assertAgentHostInteractionTarget(value: unknown): asserts value is IAgentHostInteractionTarget {
	assertAgentHostProtocolValue(value);
	const target = asRecord(value, 'interactionTarget');
	assertExactKeys(
		target,
		['id', 'owner', 'type', 'schemaVersion', 'resource', 'resourceVersion', 'revision', 'authority', 'availability', 'display'],
		['expiresAt'],
		'interactionTarget',
	);
	assertString(target.id, 'interactionTarget.id', 128);
	createAgentInteractionTargetId(target.id);
	assertString(target.owner, 'interactionTarget.owner', 128);
	createAgentInteractionTargetOwnerId(target.owner);
	assertString(target.type, 'interactionTarget.type', 128);
	createAgentInteractionTargetTypeId(target.type);
	assertNonNegativeInteger(target.schemaVersion, 'interactionTarget.schemaVersion', 65_535);
	if (target.schemaVersion === 0) {
		invalidProtocolValue('interactionTarget.schemaVersion', target.schemaVersion);
	}
	assertString(target.resource, 'interactionTarget.resource', 4_096);
	assertString(target.resourceVersion, 'interactionTarget.resourceVersion', 256);
	assertString(target.revision, 'interactionTarget.revision', 128);
	createAgentInteractionTargetRevision(target.revision);
	assertTargetAuthority(target.authority, 'interactionTarget.authority');
	if (target.availability !== 'connection' && target.availability !== 'turn') {
		invalidProtocolValue('interactionTarget.availability', target.availability);
	}
	assertDisplayMetadata(target.display, 'interactionTarget.display');
	if (target.expiresAt !== undefined && (typeof target.expiresAt !== 'number' || !Number.isFinite(target.expiresAt) || target.expiresAt <= 0)) {
		invalidProtocolValue('interactionTarget.expiresAt', target.expiresAt);
	}
}
