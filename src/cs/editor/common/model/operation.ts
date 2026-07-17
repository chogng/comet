/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import {
	captureBoundedClosedJson,
	type BoundedClosedJsonLimit,
	type IBoundedClosedJsonLimits,
} from 'cs/editor/common/core/boundedClosedJson';
import {
	isWellFormedUnicodeString,
	type CanonicalJsonValue,
} from 'cs/editor/common/core/canonicalJson';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseOperationId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type OperationId,
} from 'cs/editor/common/core/identifiers';
import { validateManuscriptResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import {
	decodeAcademicEntityV1,
	decodeClaimEvidenceRelationV1,
	encodeAcademicEntityV1,
	encodeClaimEvidenceRelationV1,
	type AcademicEntity,
	type ClaimEvidenceRelation,
} from 'cs/editor/common/model/academicGraph';
import type {
	DocumentSemanticSettings,
	InsertableNode,
	ManuscriptMetadata,
	Mark,
	TextNode,
} from 'cs/editor/common/model/manuscript';
import {
	decodeDocumentSemanticSettingsV1,
	decodeInsertableNodeV1,
	decodeManuscriptMetadataV1,
	decodeMarksV1,
	decodeNodeAttributesV1,
	encodeDocumentSemanticSettingsV1,
	encodeInsertableNodeV1,
	encodeManuscriptMetadataV1,
	encodeMarksV1,
	encodeNodeAttributesV1,
	type IManuscriptTreeCodecLimits,
} from 'cs/editor/common/model/manuscriptSchema';

interface IOperationBase {
	readonly id: OperationId;
}

export interface InsertNodeOperation extends IOperationBase {
	readonly type: 'insert-node';
	readonly parentNodeId: NodeId;
	readonly expectedParentHash: ContentHash;
	readonly childIndex: number;
	readonly node: InsertableNode;
}

export interface DeleteNodeOperation extends IOperationBase {
	readonly type: 'delete-node';
	readonly targetNodeId: NodeId;
	readonly expectedNodeHash: ContentHash;
}

export interface MoveNodeOperation extends IOperationBase {
	readonly type: 'move-node';
	readonly targetNodeId: NodeId;
	readonly expectedNodeHash: ContentHash;
	readonly newParentNodeId: NodeId;
	readonly expectedParentHash: ContentHash;
	readonly childIndex: number;
}

export interface ReplaceTextOperation extends IOperationBase {
	readonly type: 'replace-text';
	readonly textNodeId: NodeId;
	readonly expectedNodeHash: ContentHash;
	readonly startUtf16Offset: Utf16Offset;
	readonly endUtf16Offset: Utf16Offset;
	readonly replacement: string;
}

export interface SplitTextOperation extends IOperationBase {
	readonly type: 'split-text';
	readonly textNodeId: NodeId;
	readonly expectedNodeHash: ContentHash;
	readonly splitUtf16Offset: Utf16Offset;
	readonly rightTextNodeId: NodeId;
}

export interface JoinTextOperation extends IOperationBase {
	readonly type: 'join-text';
	readonly leftTextNodeId: NodeId;
	readonly expectedLeftNodeHash: ContentHash;
	readonly rightTextNodeId: NodeId;
	readonly expectedRightNodeHash: ContentHash;
}

type SettableNodeAttributes = Exclude<InsertableNode, TextNode>['attrs'];

export interface SetNodeAttributesOperation extends IOperationBase {
	readonly type: 'set-node-attributes';
	readonly nodeId: NodeId;
	readonly expectedNodeHash: ContentHash;
	readonly attributes: SettableNodeAttributes;
}

export interface SetTextMarksOperation extends IOperationBase {
	readonly type: 'set-text-marks';
	readonly textNodeId: NodeId;
	readonly expectedNodeHash: ContentHash;
	readonly marks: readonly Mark[];
}

export interface CreateAcademicEntityOperation extends IOperationBase {
	readonly type: 'create-academic-entity';
	readonly entity: AcademicEntity;
}

export interface ReplaceAcademicEntityOperation extends IOperationBase {
	readonly type: 'replace-academic-entity';
	readonly entityId: EntityId;
	readonly expectedEntityHash: ContentHash;
	readonly replacement: AcademicEntity;
}

export interface DeleteAcademicEntityOperation extends IOperationBase {
	readonly type: 'delete-academic-entity';
	readonly entityId: EntityId;
	readonly expectedEntityHash: ContentHash;
}

export interface SetClaimEvidenceRelationOperation extends IOperationBase {
	readonly type: 'set-claim-evidence-relation';
	readonly claimId: EntityId;
	readonly evidenceId: EntityId;
	readonly expectedRelationHash: ContentHash | null;
	readonly replacement: ClaimEvidenceRelation | null;
}

export interface SetMetadataOperation extends IOperationBase {
	readonly type: 'set-metadata';
	readonly expectedMetadataHash: ContentHash;
	readonly metadata: ManuscriptMetadata;
}

export interface SetSettingsOperation extends IOperationBase {
	readonly type: 'set-settings';
	readonly expectedSettingsHash: ContentHash;
	readonly settings: DocumentSemanticSettings;
}

export type Operation =
	| InsertNodeOperation
	| DeleteNodeOperation
	| MoveNodeOperation
	| ReplaceTextOperation
	| SplitTextOperation
	| JoinTextOperation
	| SetNodeAttributesOperation
	| SetTextMarksOperation
	| CreateAcademicEntityOperation
	| ReplaceAcademicEntityOperation
	| DeleteAcademicEntityOperation
	| SetClaimEvidenceRelationOperation
	| SetMetadataOperation
	| SetSettingsOperation;

export type OperationKind = Operation['type'];

export const operationKinds = Object.freeze([
	'insert-node',
	'delete-node',
	'move-node',
	'replace-text',
	'split-text',
	'join-text',
	'set-node-attributes',
	'set-text-marks',
	'create-academic-entity',
	'replace-academic-entity',
	'delete-academic-entity',
	'set-claim-evidence-relation',
	'set-metadata',
	'set-settings',
] as const satisfies readonly OperationKind[]);

export const persistedOperationFormat = 'nireco-operation';
export const persistedOperationFormatVersion = 1;
export const persistedOperationJsonLimits: IBoundedClosedJsonLimits = Object.freeze({
	maximumDepth: 256,
	maximumValues: 262_144,
	maximumArrayLength: 131_072,
	maximumObjectProperties: 4_096,
	maximumCanonicalUtf8Bytes: 16 * 1024 * 1024,
});
export const operationManuscriptTreeLimits: IManuscriptTreeCodecLimits = Object.freeze({
	maximumNodes: 100_000,
	maximumDepth: 256,
	maximumCollectionItems: 100_000,
});

export interface IPersistedOperationV1 {
	readonly format: typeof persistedOperationFormat;
	readonly formatVersion: typeof persistedOperationFormatVersion;
	readonly operation: Readonly<Record<string, CanonicalJsonValue>>;
}

export type OperationCodecFailure =
	| 'invalid-envelope'
	| 'invalid-context'
	| 'unsupported-version'
	| 'invalid-operation'
	| 'inspection-failed'
	| 'resource-limit-exceeded';

export type EncodeOperationResult =
	| {
		readonly type: 'valid';
		readonly value: IPersistedOperationV1;
	}
	| IOperationCodecError;

export type DecodeOperationResult =
	| {
		readonly type: 'valid';
		readonly value: Operation;
	}
	| IOperationCodecError;

type IOperationCodecError =
	| {
		readonly type: 'invalid';
		readonly reason: Exclude<OperationCodecFailure, 'resource-limit-exceeded'>;
		readonly path: string;
	}
	| {
		readonly type: 'invalid';
		readonly reason: 'resource-limit-exceeded';
		readonly path: string;
		readonly limit: BoundedClosedJsonLimit;
	};

type ClosedRecord = Readonly<Record<string, unknown>>;
type CanonicalObject = Readonly<Record<string, CanonicalJsonValue>>;

const operationKindSet = new Set<string>(operationKinds);
export function encodePersistedOperationV1(
	operation: unknown,
	expectedResource: URI,
): EncodeOperationResult {
	try {
		const resource = validatedManuscriptResource(expectedResource);
		if (resource === undefined) {
			return invalidCodec('invalid-context', '$context.resource');
		}
		const record = readDataRecord(operation);
		if (record === undefined || !operationKindSet.has(String(record['type']))) {
			return invalidCodec('invalid-operation', '$.operation');
		}
		const encoded = encodeOperationRecord(record, resource);
		if (encoded === undefined) {
			return invalidCodec('invalid-operation', '$.operation');
		}
		const envelope: IPersistedOperationV1 = deepFreezeOwnedValue({
			format: persistedOperationFormat,
			formatVersion: persistedOperationFormatVersion,
			operation: encoded,
		});
		const decoded = decodePersistedOperationV1(envelope, resource);
		return decoded.type === 'invalid'
			? decoded
			: {
				type: 'valid',
				value: envelope,
			};
	} catch {
		return invalidCodec('inspection-failed', '$');
	}
}

export function decodePersistedOperationV1(
	value: unknown,
	expectedResource: URI,
): DecodeOperationResult {
	const resource = validatedManuscriptResource(expectedResource);
	if (resource === undefined) {
		return invalidCodec('invalid-context', '$context.resource');
	}
	const captured = capturePersistedValue(value);
	if (captured.type === 'invalid') {
		return captured;
	}
	const envelope = readDataRecord(captured.value);
	if (
		envelope === undefined
		|| !hasExactKeys(envelope, ['format', 'formatVersion', 'operation'])
		|| envelope['format'] !== persistedOperationFormat
	) {
		return invalidCodec('invalid-envelope', '$');
	}
	if (envelope['formatVersion'] !== persistedOperationFormatVersion) {
		return invalidCodec('unsupported-version', '$.formatVersion');
	}
	const operation = readDataRecord(envelope['operation']);
	if (operation === undefined || !operationKindSet.has(String(operation['type']))) {
		return invalidCodec('invalid-operation', '$.operation');
	}
	const decoded = decodeOperationRecord(operation, resource);
	return decoded === undefined
		? invalidCodec('invalid-operation', '$.operation')
		: {
			type: 'valid',
			value: deepFreezeOwnedValue(decoded),
		};
}

function capturePersistedValue(
	value: unknown,
): { readonly type: 'valid'; readonly value: unknown } | IOperationCodecError {
	const captured = captureBoundedClosedJson(value, persistedOperationJsonLimits);
	if (captured.type === 'invalid') {
		return captured.reason === 'resource-limit-exceeded'
			? {
				type: 'invalid',
				reason: captured.reason,
				path: captured.path,
				limit: captured.limit,
			}
			: invalidCodec('inspection-failed', captured.path);
	}
	return {
		type: 'valid',
		value: captured.value,
	};
}

function encodeOperationRecord(
	operation: ClosedRecord,
	expectedResource: URI,
): CanonicalObject | undefined {
	const type = operation['type'];
	switch (type) {
		case 'insert-node':
			return encodeInsertNode(operation);
		case 'delete-node':
			return cloneExactOperation(operation, [
				'id',
				'type',
				'targetNodeId',
				'expectedNodeHash',
			]);
		case 'move-node':
			return cloneExactOperation(operation, [
				'id',
				'type',
				'targetNodeId',
				'expectedNodeHash',
				'newParentNodeId',
				'expectedParentHash',
				'childIndex',
			]);
		case 'replace-text':
			return cloneExactOperation(operation, [
				'id',
				'type',
				'textNodeId',
				'expectedNodeHash',
				'startUtf16Offset',
				'endUtf16Offset',
				'replacement',
			]);
		case 'split-text':
			return cloneExactOperation(operation, [
				'id',
				'type',
				'textNodeId',
				'expectedNodeHash',
				'splitUtf16Offset',
				'rightTextNodeId',
			]);
		case 'join-text':
			return cloneExactOperation(operation, [
				'id',
				'type',
				'leftTextNodeId',
				'expectedLeftNodeHash',
				'rightTextNodeId',
				'expectedRightNodeHash',
			]);
		case 'set-node-attributes':
			return encodeSetNodeAttributes(operation);
		case 'set-text-marks':
			return encodeSetTextMarks(operation);
		case 'create-academic-entity':
			return encodeCreateAcademicEntity(operation, expectedResource);
		case 'replace-academic-entity':
			return encodeReplaceAcademicEntity(operation, expectedResource);
		case 'delete-academic-entity':
			return cloneExactOperation(operation, [
				'id',
				'type',
				'entityId',
				'expectedEntityHash',
			]);
		case 'set-claim-evidence-relation':
			return encodeSetClaimEvidenceRelation(operation);
		case 'set-metadata':
			return encodeSetMetadata(operation);
		case 'set-settings':
			return encodeSetSettings(operation);
		default:
			return undefined;
	}
}

function decodeOperationRecord(
	operation: ClosedRecord,
	expectedResource: URI,
): Operation | undefined {
	switch (operation['type']) {
		case 'insert-node':
			return decodeInsertNode(operation);
		case 'delete-node':
			return decodeDeleteNode(operation);
		case 'move-node':
			return decodeMoveNode(operation);
		case 'replace-text':
			return decodeReplaceText(operation);
		case 'split-text':
			return decodeSplitText(operation);
		case 'join-text':
			return decodeJoinText(operation);
		case 'set-node-attributes':
			return decodeSetNodeAttributes(operation);
		case 'set-text-marks':
			return decodeSetTextMarks(operation);
		case 'create-academic-entity':
			return decodeCreateAcademicEntity(operation, expectedResource);
		case 'replace-academic-entity':
			return decodeReplaceAcademicEntity(operation, expectedResource);
		case 'delete-academic-entity':
			return decodeDeleteAcademicEntity(operation);
		case 'set-claim-evidence-relation':
			return decodeSetClaimEvidenceRelation(operation);
		case 'set-metadata':
			return decodeSetMetadata(operation);
		case 'set-settings':
			return decodeSetSettings(operation);
		default:
			return undefined;
	}
}

function cloneExactOperation(
	operation: ClosedRecord,
	keys: readonly string[],
): CanonicalObject | undefined {
	if (!hasExactKeys(operation, keys)) {
		return undefined;
	}
	const result: Record<string, CanonicalJsonValue> = {};
	for (const key of keys) {
		const value = operation[key];
		if (!isCanonicalPrimitive(value)) {
			return undefined;
		}
		result[key] = value;
	}
	return result;
}

function encodeInsertNode(operation: ClosedRecord): CanonicalObject | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'parentNodeId',
		'expectedParentHash',
		'childIndex',
		'node',
	])) {
		return undefined;
	}
	const node = encodeInsertableNodeV1(
		operation['node'],
		operationManuscriptTreeLimits,
		'$.operation.node',
	);
	return node.type === 'error'
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'insert-node',
			parentNodeId: operation['parentNodeId'] as CanonicalJsonValue,
			expectedParentHash: operation['expectedParentHash'] as CanonicalJsonValue,
			childIndex: operation['childIndex'] as CanonicalJsonValue,
			node: node.value,
		};
}

function encodeSetNodeAttributes(operation: ClosedRecord): CanonicalObject | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'nodeId',
		'expectedNodeHash',
		'attributes',
	])) {
		return undefined;
	}
	const attributes = encodeNodeAttributesV1(
		operation['attributes'],
		'$.operation.attributes',
	);
	return attributes.type === 'error'
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'set-node-attributes',
			nodeId: operation['nodeId'] as CanonicalJsonValue,
			expectedNodeHash: operation['expectedNodeHash'] as CanonicalJsonValue,
			attributes: attributes.value,
		};
}

function encodeSetTextMarks(operation: ClosedRecord): CanonicalObject | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'textNodeId',
		'expectedNodeHash',
		'marks',
	])) {
		return undefined;
	}
	const marks = encodeMarksV1(
		operation['marks'],
		operationManuscriptTreeLimits.maximumCollectionItems,
		'$.operation.marks',
	);
	return marks.type === 'error'
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'set-text-marks',
			textNodeId: operation['textNodeId'] as CanonicalJsonValue,
			expectedNodeHash: operation['expectedNodeHash'] as CanonicalJsonValue,
			marks: marks.value,
		};
}

function encodeCreateAcademicEntity(
	operation: ClosedRecord,
	expectedResource: URI,
): CanonicalObject | undefined {
	if (!hasExactKeys(operation, ['id', 'type', 'entity'])) {
		return undefined;
	}
	const entity = encodeAcademicEntityV1(operation['entity'], expectedResource);
	return entity === undefined
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'create-academic-entity',
			entity,
		};
}

function encodeReplaceAcademicEntity(
	operation: ClosedRecord,
	expectedResource: URI,
): CanonicalObject | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'entityId',
		'expectedEntityHash',
		'replacement',
	])) {
		return undefined;
	}
	const replacement = encodeAcademicEntityV1(operation['replacement'], expectedResource);
	return replacement === undefined
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'replace-academic-entity',
			entityId: operation['entityId'] as CanonicalJsonValue,
			expectedEntityHash: operation['expectedEntityHash'] as CanonicalJsonValue,
			replacement,
		};
}

function encodeSetClaimEvidenceRelation(operation: ClosedRecord): CanonicalObject | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'claimId',
		'evidenceId',
		'expectedRelationHash',
		'replacement',
	])) {
		return undefined;
	}
	const replacement = operation['replacement'] === null
		? null
		: encodeClaimEvidenceRelationV1(operation['replacement']);
	if (replacement === undefined) {
		return undefined;
	}
	return {
		id: operation['id'] as CanonicalJsonValue,
		type: 'set-claim-evidence-relation',
		claimId: operation['claimId'] as CanonicalJsonValue,
		evidenceId: operation['evidenceId'] as CanonicalJsonValue,
		expectedRelationHash: operation['expectedRelationHash'] as CanonicalJsonValue,
		replacement,
	};
}

function encodeSetMetadata(operation: ClosedRecord): CanonicalObject | undefined {
	if (!hasExactKeys(operation, ['id', 'type', 'expectedMetadataHash', 'metadata'])) {
		return undefined;
	}
	const metadata = encodeManuscriptMetadataV1(
		operation['metadata'],
		operationManuscriptTreeLimits.maximumCollectionItems,
		'$.operation.metadata',
	);
	return metadata.type === 'error'
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'set-metadata',
			expectedMetadataHash: operation['expectedMetadataHash'] as CanonicalJsonValue,
			metadata: metadata.value,
		};
}

function encodeSetSettings(operation: ClosedRecord): CanonicalObject | undefined {
	if (!hasExactKeys(operation, ['id', 'type', 'expectedSettingsHash', 'settings'])) {
		return undefined;
	}
	const settings = encodeDocumentSemanticSettingsV1(
		operation['settings'],
		'$.operation.settings',
	);
	return settings.type === 'error'
		? undefined
		: {
			id: operation['id'] as CanonicalJsonValue,
			type: 'set-settings',
			expectedSettingsHash: operation['expectedSettingsHash'] as CanonicalJsonValue,
			settings: settings.value,
		};
}

function decodeInsertNode(operation: ClosedRecord): InsertNodeOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'parentNodeId',
		'expectedParentHash',
		'childIndex',
		'node',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const parentNodeId = nodeId(operation['parentNodeId']);
	const expectedParentHash = contentHash(operation['expectedParentHash']);
	const childIndex = nonnegativeInteger(operation['childIndex']);
	const node = decodeInsertableNodeV1(
		operation['node'] as CanonicalJsonValue,
		operationManuscriptTreeLimits,
		'$.operation.node',
	);
	return (
		id === undefined
		|| parentNodeId === undefined
		|| expectedParentHash === undefined
		|| childIndex === undefined
		|| node.type === 'error'
	)
		? undefined
		: {
			id,
			type: 'insert-node',
			parentNodeId,
			expectedParentHash,
			childIndex,
			node: node.value.root,
		};
}

function decodeDeleteNode(operation: ClosedRecord): DeleteNodeOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'targetNodeId',
		'expectedNodeHash',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const targetNodeId = nodeId(operation['targetNodeId']);
	const expectedNodeHash = contentHash(operation['expectedNodeHash']);
	return id === undefined || targetNodeId === undefined || expectedNodeHash === undefined
		? undefined
		: {
			id,
			type: 'delete-node',
			targetNodeId,
			expectedNodeHash,
		};
}

function decodeMoveNode(operation: ClosedRecord): MoveNodeOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'targetNodeId',
		'expectedNodeHash',
		'newParentNodeId',
		'expectedParentHash',
		'childIndex',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const targetNodeId = nodeId(operation['targetNodeId']);
	const expectedNodeHash = contentHash(operation['expectedNodeHash']);
	const newParentNodeId = nodeId(operation['newParentNodeId']);
	const expectedParentHash = contentHash(operation['expectedParentHash']);
	const childIndex = nonnegativeInteger(operation['childIndex']);
	return (
		id === undefined
		|| targetNodeId === undefined
		|| expectedNodeHash === undefined
		|| newParentNodeId === undefined
		|| expectedParentHash === undefined
		|| childIndex === undefined
		|| targetNodeId === newParentNodeId
	)
		? undefined
		: {
			id,
			type: 'move-node',
			targetNodeId,
			expectedNodeHash,
			newParentNodeId,
			expectedParentHash,
			childIndex,
		};
}

function decodeReplaceText(operation: ClosedRecord): ReplaceTextOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'textNodeId',
		'expectedNodeHash',
		'startUtf16Offset',
		'endUtf16Offset',
		'replacement',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const textNodeId = nodeId(operation['textNodeId']);
	const expectedNodeHash = contentHash(operation['expectedNodeHash']);
	const startUtf16Offset = utf16Offset(operation['startUtf16Offset']);
	const endUtf16Offset = utf16Offset(operation['endUtf16Offset']);
	const replacement = operation['replacement'];
	return (
		id === undefined
		|| textNodeId === undefined
		|| expectedNodeHash === undefined
		|| startUtf16Offset === undefined
		|| endUtf16Offset === undefined
		|| startUtf16Offset > endUtf16Offset
		|| !isBoundedString(replacement, 0, 8 * 1024 * 1024)
	)
		? undefined
		: {
			id,
			type: 'replace-text',
			textNodeId,
			expectedNodeHash,
			startUtf16Offset,
			endUtf16Offset,
			replacement,
		};
}

function decodeSplitText(operation: ClosedRecord): SplitTextOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'textNodeId',
		'expectedNodeHash',
		'splitUtf16Offset',
		'rightTextNodeId',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const textNodeId = nodeId(operation['textNodeId']);
	const expectedNodeHash = contentHash(operation['expectedNodeHash']);
	const splitUtf16Offset = utf16Offset(operation['splitUtf16Offset']);
	const rightTextNodeId = nodeId(operation['rightTextNodeId']);
	return (
		id === undefined
		|| textNodeId === undefined
		|| expectedNodeHash === undefined
		|| splitUtf16Offset === undefined
		|| rightTextNodeId === undefined
		|| textNodeId === rightTextNodeId
	)
		? undefined
		: {
			id,
			type: 'split-text',
			textNodeId,
			expectedNodeHash,
			splitUtf16Offset,
			rightTextNodeId,
		};
}

function decodeJoinText(operation: ClosedRecord): JoinTextOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'leftTextNodeId',
		'expectedLeftNodeHash',
		'rightTextNodeId',
		'expectedRightNodeHash',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const leftTextNodeId = nodeId(operation['leftTextNodeId']);
	const expectedLeftNodeHash = contentHash(operation['expectedLeftNodeHash']);
	const rightTextNodeId = nodeId(operation['rightTextNodeId']);
	const expectedRightNodeHash = contentHash(operation['expectedRightNodeHash']);
	return (
		id === undefined
		|| leftTextNodeId === undefined
		|| expectedLeftNodeHash === undefined
		|| rightTextNodeId === undefined
		|| expectedRightNodeHash === undefined
		|| leftTextNodeId === rightTextNodeId
	)
		? undefined
		: {
			id,
			type: 'join-text',
			leftTextNodeId,
			expectedLeftNodeHash,
			rightTextNodeId,
			expectedRightNodeHash,
		};
}

function decodeSetNodeAttributes(
	operation: ClosedRecord,
): SetNodeAttributesOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'nodeId',
		'expectedNodeHash',
		'attributes',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const targetNodeId = nodeId(operation['nodeId']);
	const expectedNodeHash = contentHash(operation['expectedNodeHash']);
	const attributes = decodeNodeAttributesV1(
		operation['attributes'] as CanonicalJsonValue,
		'$.operation.attributes',
	);
	return (
		id === undefined
		|| targetNodeId === undefined
		|| expectedNodeHash === undefined
		|| attributes.type === 'error'
	)
		? undefined
		: {
			id,
			type: 'set-node-attributes',
			nodeId: targetNodeId,
			expectedNodeHash,
			attributes: attributes.value,
		};
}

function decodeSetTextMarks(operation: ClosedRecord): SetTextMarksOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'textNodeId',
		'expectedNodeHash',
		'marks',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const textNodeId = nodeId(operation['textNodeId']);
	const expectedNodeHash = contentHash(operation['expectedNodeHash']);
	const marks = decodeMarksV1(
		operation['marks'] as CanonicalJsonValue,
		operationManuscriptTreeLimits.maximumCollectionItems,
		'$.operation.marks',
	);
	return (
		id === undefined
		|| textNodeId === undefined
		|| expectedNodeHash === undefined
		|| marks.type === 'error'
	)
		? undefined
		: {
			id,
			type: 'set-text-marks',
			textNodeId,
			expectedNodeHash,
			marks: marks.value,
		};
}

function decodeCreateAcademicEntity(
	operation: ClosedRecord,
	expectedResource: URI,
): CreateAcademicEntityOperation | undefined {
	if (!hasExactKeys(operation, ['id', 'type', 'entity'])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const entity = decodeAcademicEntityV1(operation['entity'], expectedResource);
	return id === undefined || entity === undefined
		? undefined
		: {
			id,
			type: 'create-academic-entity',
			entity,
		};
}

function decodeReplaceAcademicEntity(
	operation: ClosedRecord,
	expectedResource: URI,
): ReplaceAcademicEntityOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'entityId',
		'expectedEntityHash',
		'replacement',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const targetEntityId = entityId(operation['entityId']);
	const expectedEntityHash = contentHash(operation['expectedEntityHash']);
	const replacement = decodeAcademicEntityV1(operation['replacement'], expectedResource);
	return (
		id === undefined
		|| targetEntityId === undefined
		|| expectedEntityHash === undefined
		|| replacement === undefined
		|| targetEntityId !== replacement.id
	)
		? undefined
		: {
			id,
			type: 'replace-academic-entity',
			entityId: targetEntityId,
			expectedEntityHash,
			replacement,
		};
}

function decodeDeleteAcademicEntity(
	operation: ClosedRecord,
): DeleteAcademicEntityOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'entityId',
		'expectedEntityHash',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const targetEntityId = entityId(operation['entityId']);
	const expectedEntityHash = contentHash(operation['expectedEntityHash']);
	return id === undefined || targetEntityId === undefined || expectedEntityHash === undefined
		? undefined
		: {
			id,
			type: 'delete-academic-entity',
			entityId: targetEntityId,
			expectedEntityHash,
		};
}

function decodeSetClaimEvidenceRelation(
	operation: ClosedRecord,
): SetClaimEvidenceRelationOperation | undefined {
	if (!hasExactKeys(operation, [
		'id',
		'type',
		'claimId',
		'evidenceId',
		'expectedRelationHash',
		'replacement',
	])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const claimId = entityId(operation['claimId']);
	const evidenceId = entityId(operation['evidenceId']);
	const expectedRelationHash = operation['expectedRelationHash'] === null
		? null
		: contentHash(operation['expectedRelationHash']);
	const replacement = operation['replacement'] === null
		? null
		: decodeClaimEvidenceRelationV1(operation['replacement']);
	return (
		id === undefined
		|| claimId === undefined
		|| evidenceId === undefined
		|| expectedRelationHash === undefined
		|| replacement === undefined
		|| (
			replacement !== null
			&& (
				replacement.claimId !== claimId
				|| replacement.evidenceId !== evidenceId
			)
		)
	)
		? undefined
		: {
			id,
			type: 'set-claim-evidence-relation',
			claimId,
			evidenceId,
			expectedRelationHash,
			replacement,
		};
}

function decodeSetMetadata(operation: ClosedRecord): SetMetadataOperation | undefined {
	if (!hasExactKeys(operation, ['id', 'type', 'expectedMetadataHash', 'metadata'])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const expectedMetadataHash = contentHash(operation['expectedMetadataHash']);
	const metadata = decodeManuscriptMetadataV1(
		operation['metadata'] as CanonicalJsonValue,
		operationManuscriptTreeLimits.maximumCollectionItems,
		'$.operation.metadata',
	);
	return (
		id === undefined
		|| expectedMetadataHash === undefined
		|| metadata.type === 'error'
	)
		? undefined
		: {
			id,
			type: 'set-metadata',
			expectedMetadataHash,
			metadata: metadata.value.metadata,
		};
}

function decodeSetSettings(operation: ClosedRecord): SetSettingsOperation | undefined {
	if (!hasExactKeys(operation, ['id', 'type', 'expectedSettingsHash', 'settings'])) {
		return undefined;
	}
	const id = operationId(operation['id']);
	const expectedSettingsHash = contentHash(operation['expectedSettingsHash']);
	const settings = decodeDocumentSemanticSettingsV1(
		operation['settings'] as CanonicalJsonValue,
		'$.operation.settings',
	);
	return (
		id === undefined
		|| expectedSettingsHash === undefined
		|| settings.type === 'error'
	)
		? undefined
		: {
			id,
			type: 'set-settings',
			expectedSettingsHash,
			settings: settings.value,
		};
}

function readDataRecord(value: unknown): ClosedRecord | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return undefined;
	}
	const keys = Reflect.ownKeys(value);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of keys) {
		if (typeof key !== 'string') {
			return undefined;
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			return undefined;
		}
		result[key] = descriptor.value;
	}
	return result;
}

function hasExactKeys(
	record: ClosedRecord,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): boolean {
	const required = new Set(requiredKeys);
	const allowed = new Set([...requiredKeys, ...optionalKeys]);
	const keys = Object.keys(record);
	return (
		keys.every(key => allowed.has(key))
		&& requiredKeys.every(key => Object.hasOwn(record, key))
		&& required.size === requiredKeys.length
	);
}

function isCanonicalPrimitive(value: unknown): value is CanonicalJsonValue {
	return (
		value === null
		|| typeof value === 'boolean'
		|| (
			typeof value === 'number'
			&& Number.isFinite(value)
		)
		|| (
			typeof value === 'string'
			&& isWellFormedUnicodeString(value)
		)
	);
}

function isBoundedString(
	value: unknown,
	minimumLength: number,
	maximumLength: number,
): value is string {
	return (
		typeof value === 'string'
		&& value.length >= minimumLength
		&& value.length <= maximumLength
		&& isWellFormedUnicodeString(value)
	);
}

function operationId(value: unknown): OperationId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseOperationId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function nodeId(value: unknown): NodeId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseNodeId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function entityId(value: unknown): EntityId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseEntityId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function contentHash(value: unknown): ContentHash | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseContentHash(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function utf16Offset(value: unknown): Utf16Offset | undefined {
	if (typeof value !== 'number') {
		return undefined;
	}
	const parsed = parseUtf16Offset(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
	return Number.isSafeInteger(value) && (value as number) >= 0
		? value as number
		: undefined;
}

function validatedManuscriptResource(value: unknown): URI | undefined {
	if (!(value instanceof URI)) {
		return undefined;
	}
	const validated = validateManuscriptResource(value);
	return validated.type === 'valid' ? validated.resource : undefined;
}

function deepFreezeOwnedValue<T>(value: T): T {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	const stack: object[] = [value];
	const seen = new Set<object>();
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current) || current instanceof URI) {
			continue;
		}
		seen.add(current);
		for (const key of Reflect.ownKeys(current)) {
			const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
			if (
				descriptor !== undefined
				&& 'value' in descriptor
				&& descriptor.value !== null
				&& typeof descriptor.value === 'object'
			) {
				stack.push(descriptor.value);
			}
		}
		Object.freeze(current);
	}
	return value;
}

function invalidCodec(
	reason: Exclude<OperationCodecFailure, 'resource-limit-exceeded'>,
	path: string,
): IOperationCodecError {
	return {
		type: 'invalid',
		reason,
		path,
	};
}
