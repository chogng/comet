/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import { cloneCanonicalRuntimeUri } from 'cs/editor/common/core/canonicalUri';
import {
	parseContentHash,
	type ContentHash,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import { validateManuscriptResource } from 'cs/editor/common/core/manuscriptResource';
import type { AcademicGraphSnapshot } from 'cs/editor/common/model/academicGraph';
import type { DocumentIndex } from 'cs/editor/common/model/documentIndex';
import type {
	DocumentSemanticSettings,
	ManuscriptMetadata,
	ManuscriptNode,
} from 'cs/editor/common/model/manuscript';
import type { Operation } from 'cs/editor/common/model/operation';
import {
	consumeManuscriptOperationTransition,
	reduceManuscriptOperation,
	type IConsumedManuscriptOperationTransition,
	type IManuscriptOperationReducerFailure,
	type IManuscriptOperationReducerLimits,
	type IManuscriptOperationTouchSet,
	type ManuscriptOperationCapture,
} from 'cs/editor/common/model/operationReducer';
import type { PositionMapFragment } from 'cs/editor/common/model/positionMap';
import {
	createDocumentMerkleHashPayload,
	hashRevisionMerklePayload,
} from 'cs/editor/common/model/revisionHashPayload';
import { updateRevisionMerkleStateCandidate } from 'cs/editor/common/model/revisionMerkleUpdater';
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

export type ManuscriptDraftAdvanceFailure =
	| {
		readonly reason: 'invalid-draft';
	}
	| {
		readonly reason: 'draft-busy';
	}
	| {
		readonly reason: 'operation-rejected';
		readonly reducerFailure: IManuscriptOperationReducerFailure;
	}
	| {
		readonly reason: 'operation-evaluation-failed';
	}
	| {
		readonly reason: 'inconsistent-transition';
	}
	| {
		readonly reason: 'merkle-update-failed';
	};

export type AdvanceManuscriptDraftOperationResult =
	| {
		readonly type: 'ok';
		readonly value: ManuscriptDraft;
	}
	| {
		readonly type: 'error';
		readonly error: ManuscriptDraftAdvanceFailure;
	};

interface IManuscriptDraftCheckpoint {
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
	readonly documentHash: ContentHash;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
}

interface IManuscriptDraftOperationReceipt {
	readonly touchSet: IManuscriptOperationTouchSet;
	readonly capture: ManuscriptOperationCapture;
	readonly positionMapFragments: readonly PositionMapFragment[];
}

interface IManuscriptDraftPendingTransition {
	readonly previous: IManuscriptDraftPendingTransition | undefined;
	readonly receipt: IManuscriptDraftOperationReceipt;
}

interface IManuscriptDraftRecord {
	readonly resource: URI;
	readonly canonicalResource: string;
	readonly baseSnapshot: DocumentSnapshot;
	readonly generatedAgainstRevisionId: RevisionId;
	readonly checkpoint: IManuscriptDraftCheckpoint;
	readonly operationLimits: IManuscriptOperationReducerLimits;
	readonly pendingTransitionTail:
		IManuscriptDraftPendingTransition | undefined;
	readonly pendingTransitionCount: number;
}

const manuscriptDraftRecords = new WeakMap<
	ManuscriptDraft,
	IManuscriptDraftRecord
>();
const busyManuscriptDrafts = new WeakSet<ManuscriptDraft>();

const invalidDraftAdvanceResult: AdvanceManuscriptDraftOperationResult =
	Object.freeze({
		type: 'error',
		error: Object.freeze({
			reason: 'invalid-draft',
		}),
	});
const busyDraftAdvanceResult: AdvanceManuscriptDraftOperationResult =
	Object.freeze({
		type: 'error',
		error: Object.freeze({
			reason: 'draft-busy',
		}),
	});
const snapshotCodecLimitKeys = Object.freeze([
	'maximumDepth',
	'maximumValues',
	'maximumArrayLength',
	'maximumObjectProperties',
	'maximumCanonicalUtf8Bytes',
	'maximumNodes',
	'maximumNodeDepth',
	'maximumEntities',
	'maximumRelations',
	'maximumCollectionItems',
] as const);

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
	const capturedLimits = captureSnapshotCodecLimits(limits);
	if (capturedLimits === undefined) {
		return invalidDraftLimits();
	}

	const decoded = decodeDocumentSnapshot(
		value,
		validatedResource.resource,
		capturedLimits,
	);
	if (decoded.type === 'invalid') {
		return decoded;
	}

	const snapshot = decoded.value.snapshot;
	const operationLimits: IManuscriptOperationReducerLimits =
		Object.freeze({
			maximumNodes: capturedLimits.maximumNodes,
			maximumDepth: capturedLimits.maximumNodeDepth,
		});
	const content = decoded.value.content;
	const checkpoint = createDraftCheckpoint(
		content,
		decoded.value.index,
		decoded.value.merkleState,
	);
	if (
		checkpoint === undefined
		|| checkpoint.documentHash !== snapshot.documentHash
	) {
		return invalidDraftMerkleState();
	}
	const token = Object.freeze(
		Object.create(null) as ManuscriptDraft,
	);
	const record: IManuscriptDraftRecord = Object.freeze({
		resource: validatedResource.resource,
		canonicalResource: validatedResource.canonical,
		baseSnapshot: snapshot,
		generatedAgainstRevisionId: snapshot.revisionId,
		checkpoint,
		operationLimits,
		pendingTransitionTail: undefined,
		pendingTransitionCount: 0,
	});
	manuscriptDraftRecords.set(token, record);

	return Object.freeze({
		type: 'valid',
		value: token,
	});
}

/**
 * Applies one Operation to an exact draft authority and returns its sole
 * linear successor.
 *
 * Reducer and Merkle candidates remain private to this synchronous call. The
 * predecessor is invalidated only after the complete successor and public
 * result have been constructed.
 */
export function advanceManuscriptDraftOperation(
	draft: unknown,
	operation: Operation,
): AdvanceManuscriptDraftOperationResult {
	// Exact authority lookup is deliberately the first action. Invalid tokens,
	// Proxies, and lookalikes are rejected without reading the Operation.
	const record = manuscriptDraftRecords.get(draft as ManuscriptDraft);
	if (record === undefined) {
		return invalidDraftAdvanceResult;
	}
	const predecessor = draft as ManuscriptDraft;
	if (busyManuscriptDrafts.has(predecessor)) {
		return busyDraftAdvanceResult;
	}
	busyManuscriptDrafts.add(predecessor);

	let phase: 'operation' | 'merkle' = 'operation';
	let clearBusyInFinally = true;
	try {
		const checkpoint = record.checkpoint;
		const reduced = reduceManuscriptOperation({
			resource: record.resource,
			generatedAgainstRevisionId:
				record.generatedAgainstRevisionId,
			content: checkpoint.content,
			index: checkpoint.index,
			merkleState: checkpoint.merkleState,
			operation,
			limits: record.operationLimits,
		});
		if (reduced.type === 'error') {
			return operationRejected(reduced.error);
		}

		const transferred = consumeManuscriptOperationTransition(
			reduced.value,
		);
		if (
			transferred === undefined
			|| !matchesDraftCheckpoint(
				record,
				operation,
				transferred,
			)
		) {
			return advanceFailure('inconsistent-transition');
		}

		phase = 'merkle';
		const nextMerkleState = updateRevisionMerkleStateCandidate(
			checkpoint.merkleState,
			{
				previousContent: checkpoint.content,
				previousIndex: checkpoint.index,
				nextContent: transferred.nextContent,
				nextIndex: transferred.nextIndex,
				capture: transferred.capture,
				touchSet: transferred.touchSet,
			},
		);
		const nextCheckpoint = createDraftCheckpoint(
			transferred.nextContent,
			transferred.nextIndex,
			nextMerkleState,
		);
		if (nextCheckpoint === undefined) {
			return advanceFailure('merkle-update-failed');
		}

		const receipt: IManuscriptDraftOperationReceipt = Object.freeze({
			touchSet: transferred.touchSet,
			capture: transferred.capture,
			positionMapFragments:
				transferred.positionMapFragments,
		});
		const pendingTransitionTail:
			IManuscriptDraftPendingTransition = Object.freeze({
				previous: record.pendingTransitionTail,
				receipt,
			});
		const successor = Object.freeze(
			Object.create(null) as ManuscriptDraft,
		);
		const nextRecord: IManuscriptDraftRecord = Object.freeze({
			resource: record.resource,
			canonicalResource: record.canonicalResource,
			baseSnapshot: record.baseSnapshot,
			generatedAgainstRevisionId:
				record.generatedAgainstRevisionId,
			checkpoint: nextCheckpoint,
			operationLimits: record.operationLimits,
			pendingTransitionTail,
			pendingTransitionCount:
				record.pendingTransitionCount + 1,
		});
		const result: AdvanceManuscriptDraftOperationResult =
			Object.freeze({
				type: 'ok',
				value: successor,
			});

		busyManuscriptDrafts.delete(predecessor);
		clearBusyInFinally = false;
		manuscriptDraftRecords.set(successor, nextRecord);
		manuscriptDraftRecords.delete(predecessor);
		return result;
	} catch {
		return advanceFailure(
			phase === 'merkle'
				? 'merkle-update-failed'
				: 'operation-evaluation-failed',
		);
	} finally {
		if (clearBusyInFinally) {
			busyManuscriptDrafts.delete(predecessor);
		}
	}
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

	const checkpoint = record.checkpoint;
	const resource = cloneCanonicalRuntimeUri(record.resource);
	if (resource === undefined) {
		throw new TypeError('Stored manuscript resource lost canonical form.');
	}
	return Object.freeze({
		resource,
		canonicalResource: record.canonicalResource,
		generatedAgainstRevisionId: record.generatedAgainstRevisionId,
		documentHash: checkpoint.documentHash,
		format: checkpoint.format,
		formatVersion: checkpoint.formatVersion,
		schemaId: checkpoint.schemaId,
		schemaVersion: checkpoint.schemaVersion,
		nodeCount: checkpoint.nodeCount,
		entityCount: checkpoint.entityCount,
		relationCount: checkpoint.relationCount,
		pendingTransitionCount: record.pendingTransitionCount,
	});
}

function matchesDraftCheckpoint(
	record: IManuscriptDraftRecord,
	operation: Operation,
	transferred: IConsumedManuscriptOperationTransition,
): boolean {
	const checkpoint = record.checkpoint;
	const previousContent = transferred.previousContent;
	return transferred.canonicalResource === record.canonicalResource
		&& transferred.resource.toString() === record.canonicalResource
		&& transferred.generatedAgainstRevisionId
			=== record.generatedAgainstRevisionId
		&& transferred.operation === operation
		&& previousContent === checkpoint.content
		&& previousContent.format === checkpoint.format
		&& previousContent.formatVersion === checkpoint.formatVersion
		&& previousContent.schemaId === checkpoint.schemaId
		&& previousContent.schemaVersion === checkpoint.schemaVersion
		&& previousContent.metadata === checkpoint.metadata
		&& previousContent.root === checkpoint.root
		&& previousContent.academicGraph === checkpoint.academicGraph
		&& previousContent.settings === checkpoint.settings
		&& transferred.previousIndex === checkpoint.index
		&& transferred.previousMerkleState === checkpoint.merkleState
		&& transferred.limits === record.operationLimits;
}

function createDraftCheckpoint(
	content: DocumentContent,
	index: DocumentIndex,
	merkleState: RevisionMerkleState,
): IManuscriptDraftCheckpoint | undefined {
	const documentHash = parseContentHash(merkleState.documentHash);
	const rootNodeHash = parseContentHash(merkleState.rootNodeHash);
	const metadataHash = parseContentHash(merkleState.metadataHash);
	const academicGraphHash = parseContentHash(
		merkleState.academicGraphHash,
	);
	const settingsHash = parseContentHash(merkleState.settingsHash);
	const entityCount = countAcademicEntities(content.academicGraph);
	const relationCount =
		content.academicGraph.claimEvidenceRelations.length;
	if (
		!Object.isFrozen(content)
		|| content.format !== documentFormat
		|| content.formatVersion !== documentFormatVersion
		|| content.schemaId !== manuscriptSchemaId
		|| content.schemaVersion !== manuscriptSchemaVersion
		|| content.root.id !== index.rootNodeId
		|| index.getNode(content.root.id) !== content.root
		|| index.nodeCount !== merkleState.nodeCount
		|| merkleState.getNodeHash(content.root.id)
			!== merkleState.rootNodeHash
		|| entityCount !== merkleState.entityCount
		|| relationCount !== merkleState.relationCount
		|| documentHash.type === 'invalid'
		|| rootNodeHash.type === 'invalid'
		|| metadataHash.type === 'invalid'
		|| academicGraphHash.type === 'invalid'
		|| settingsHash.type === 'invalid'
	) {
		return undefined;
	}
	const expectedDocumentHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		createDocumentMerkleHashPayload({
			schemaId: content.schemaId,
			schemaVersion: content.schemaVersion,
			metadataHash: metadataHash.value,
			rootNodeHash: rootNodeHash.value,
			academicGraphHash: academicGraphHash.value,
			settingsHash: settingsHash.value,
		}),
	);
	if (expectedDocumentHash !== documentHash.value) {
		return undefined;
	}
	return Object.freeze({
		content,
		format: content.format,
		formatVersion: content.formatVersion,
		schemaId: content.schemaId,
		schemaVersion: content.schemaVersion,
		metadata: content.metadata,
		root: content.root,
		academicGraph: content.academicGraph,
		settings: content.settings,
		index,
		merkleState,
		documentHash: documentHash.value,
		nodeCount: index.nodeCount,
		entityCount,
		relationCount,
	});
}

function captureSnapshotCodecLimits(
	value: unknown,
): IDocumentSnapshotCodecLimits | undefined {
	try {
		if (
			value === null
			|| typeof value !== 'object'
			|| Array.isArray(value)
		) {
			return undefined;
		}
		const prototype = Reflect.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return undefined;
		}
		const keys = Reflect.ownKeys(value);
		if (
			keys.length !== snapshotCodecLimitKeys.length
			|| keys.some(key =>
				typeof key !== 'string'
					|| !snapshotCodecLimitKeys.includes(
						key as typeof snapshotCodecLimitKeys[number],
					)
			)
		) {
			return undefined;
		}
		const captured: Record<string, number> = Object.create(null);
		for (const key of snapshotCodecLimitKeys) {
			const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined
				|| !descriptor.enumerable
				|| !('value' in descriptor)
				|| typeof descriptor.value !== 'number'
				|| !Number.isSafeInteger(descriptor.value)
				|| descriptor.value < 0
			) {
				return undefined;
			}
			captured[key] = descriptor.value;
		}
		return Object.freeze({
			maximumDepth: captured['maximumDepth'] as number,
			maximumValues: captured['maximumValues'] as number,
			maximumArrayLength:
				captured['maximumArrayLength'] as number,
			maximumObjectProperties:
				captured['maximumObjectProperties'] as number,
			maximumCanonicalUtf8Bytes:
				captured['maximumCanonicalUtf8Bytes'] as number,
			maximumNodes: captured['maximumNodes'] as number,
			maximumNodeDepth:
				captured['maximumNodeDepth'] as number,
			maximumEntities: captured['maximumEntities'] as number,
			maximumRelations: captured['maximumRelations'] as number,
			maximumCollectionItems:
				captured['maximumCollectionItems'] as number,
		});
	} catch {
		return undefined;
	}
}

function countAcademicEntities(graph: AcademicGraphSnapshot): number {
	return graph.referenceSnapshots.length
		+ graph.evidenceLinks.length
		+ graph.claims.length;
}

function operationRejected(
	reducerFailure: IManuscriptOperationReducerFailure,
): AdvanceManuscriptDraftOperationResult {
	return Object.freeze({
		type: 'error',
		error: Object.freeze({
			reason: 'operation-rejected',
			reducerFailure,
		}),
	});
}

function advanceFailure(
	reason: Exclude<
		ManuscriptDraftAdvanceFailure['reason'],
		'operation-rejected'
	>,
): AdvanceManuscriptDraftOperationResult {
	return Object.freeze({
		type: 'error',
		error: Object.freeze({
			reason,
		}),
	});
}

function invalidDraftContext(): DocumentSnapshotCodecError {
	return Object.freeze({
		type: 'invalid',
		reason: 'invalid-context',
		path: '$context.resource',
	});
}

function invalidDraftLimits(): DocumentSnapshotCodecError {
	return Object.freeze({
		type: 'invalid',
		reason: 'invalid-limits',
		path: '$limits',
	});
}

function invalidDraftMerkleState(): DocumentSnapshotCodecError {
	return Object.freeze({
		type: 'invalid',
		reason: 'invalid-merkle-state',
		path: '$',
	});
}
