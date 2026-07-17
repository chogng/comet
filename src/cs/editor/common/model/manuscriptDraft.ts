/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import { cloneCanonicalRuntimeUri } from 'cs/editor/common/core/canonicalUri';
import type {
	ContentHash,
	RevisionId,
} from 'cs/editor/common/core/identifiers';
import { validateManuscriptResource } from 'cs/editor/common/core/manuscriptResource';
import type { AcademicGraphSnapshot } from 'cs/editor/common/model/academicGraph';
import type { DocumentIndex } from 'cs/editor/common/model/documentIndex';
import type {
	DocumentSemanticSettings,
	ManuscriptMetadata,
	ManuscriptNode,
} from 'cs/editor/common/model/manuscript';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	type DocumentContent,
	type DocumentSnapshot,
	type RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';
import {
	decodeDocumentSnapshot,
	type DocumentSnapshotCodecError,
	type IDocumentSnapshotCodecLimits,
} from 'cs/editor/common/model/snapshotDecoder';

declare const manuscriptDraftBrand: unique symbol;

/**
 * Exact, identity-bearing authority for one decoded manuscript draft.
 *
 * The brand is nominal only. Runtime authority is held exclusively by this
 * module's WeakMap and the token intentionally has no observable fields.
 */
export interface ManuscriptDraft {
	readonly [manuscriptDraftBrand]: never;
}

export interface IManuscriptDraftReadView {
	/** A fresh canonical clone on every read. */
	readonly resource: URI;
	readonly canonicalResource: string;
	readonly generatedAgainstRevisionId: RevisionId;
	readonly documentHash: ContentHash;
	readonly format: typeof documentFormat;
	readonly formatVersion: typeof documentFormatVersion;
	readonly schemaId: typeof manuscriptSchemaId;
	readonly schemaVersion: typeof manuscriptSchemaVersion;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly pendingTransitionCount: number;
}

export type DecodeManuscriptDraftResult =
	| {
		readonly type: 'valid';
		readonly value: ManuscriptDraft;
	}
	| DocumentSnapshotCodecError;

interface IManuscriptDraftRecord {
	readonly resource: URI;
	readonly canonicalResource: string;
	readonly baseSnapshot: DocumentSnapshot;
	readonly generatedAgainstRevisionId: RevisionId;
	readonly content: DocumentContent;
	readonly format: typeof documentFormat;
	readonly formatVersion: typeof documentFormatVersion;
	readonly schemaId: typeof manuscriptSchemaId;
	readonly schemaVersion: typeof manuscriptSchemaVersion;
	readonly metadata: ManuscriptMetadata;
	readonly root: ManuscriptNode;
	readonly academicGraph: AcademicGraphSnapshot;
	readonly settings: DocumentSemanticSettings;
	readonly index: DocumentIndex;
	readonly merkleState: RevisionMerkleState;
	readonly pendingTransitions: readonly never[];
	readonly documentHash: ContentHash;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly pendingTransitionCount: number;
}

const manuscriptDraftRecords = new WeakMap<
	ManuscriptDraft,
	IManuscriptDraftRecord
>();

/**
 * Establishes base draft provenance from a strict persisted Snapshot decode.
 *
 * This is deliberately the only public authority-producing entry point. There
 * is no adoption path for an existing Snapshot/index/Merkle triple.
 */
export function decodeManuscriptDraft(
	value: unknown,
	expectedResource: URI,
	limits: IDocumentSnapshotCodecLimits,
): DecodeManuscriptDraftResult {
	const validatedResource = validateManuscriptResource(expectedResource);
	if (validatedResource.type === 'invalid') {
		return invalidDraftContext();
	}

	const decoded = decodeDocumentSnapshot(
		value,
		validatedResource.resource,
		limits,
	);
	if (decoded.type === 'invalid') {
		return decoded;
	}

	const snapshot = decoded.value.snapshot;
	const content: DocumentContent = Object.freeze({
		format: snapshot.format,
		formatVersion: snapshot.formatVersion,
		schemaId: snapshot.schemaId,
		schemaVersion: snapshot.schemaVersion,
		metadata: snapshot.metadata,
		root: snapshot.root,
		academicGraph: snapshot.academicGraph,
		settings: snapshot.settings,
	});
	const token = Object.freeze(
		Object.create(null) as ManuscriptDraft,
	);
	const record: IManuscriptDraftRecord = Object.freeze({
		resource: validatedResource.resource,
		canonicalResource: validatedResource.canonical,
		baseSnapshot: snapshot,
		generatedAgainstRevisionId: snapshot.revisionId,
		content,
		format: content.format,
		formatVersion: content.formatVersion,
		schemaId: content.schemaId,
		schemaVersion: content.schemaVersion,
		metadata: content.metadata,
		root: content.root,
		academicGraph: content.academicGraph,
		settings: content.settings,
		index: decoded.value.index,
		merkleState: decoded.value.merkleState,
		pendingTransitions: Object.freeze([]),
		documentHash: snapshot.documentHash,
		nodeCount: decoded.value.index.nodeCount,
		entityCount: decoded.value.merkleState.entityCount,
		relationCount: decoded.value.merkleState.relationCount,
		pendingTransitionCount: 0,
	});
	manuscriptDraftRecords.set(token, record);

	return Object.freeze({
		type: 'valid',
		value: token,
	});
}

/**
 * Returns a non-authoritative primitive summary for a genuine draft token.
 *
 * The WeakMap lookup happens before inspecting the candidate, so Proxies,
 * accessors, prototype lookalikes, and token clones are rejected without
 * invoking caller code.
 */
export function getManuscriptDraftReadView(
	value: unknown,
): IManuscriptDraftReadView | undefined {
	const record = manuscriptDraftRecords.get(value as ManuscriptDraft);
	if (record === undefined) {
		return undefined;
	}

	const resource = cloneCanonicalRuntimeUri(record.resource);
	if (resource === undefined) {
		throw new TypeError('Stored manuscript resource lost canonical form.');
	}
	return Object.freeze({
		resource,
		canonicalResource: record.canonicalResource,
		generatedAgainstRevisionId: record.generatedAgainstRevisionId,
		documentHash: record.documentHash,
		format: record.format,
		formatVersion: record.formatVersion,
		schemaId: record.schemaId,
		schemaVersion: record.schemaVersion,
		nodeCount: record.nodeCount,
		entityCount: record.entityCount,
		relationCount: record.relationCount,
		pendingTransitionCount: record.pendingTransitionCount,
	});
}

function invalidDraftContext(): DocumentSnapshotCodecError {
	return Object.freeze({
		type: 'invalid',
		reason: 'invalid-context',
		path: '$context.resource',
	});
}
