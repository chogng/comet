/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import type {
	ContentHash,
	EntityId,
	NodeId,
	OperationId,
} from 'cs/editor/common/core/identifiers';
import { isWellFormedUnicodeString } from 'cs/editor/common/core/canonicalJson';
import {
	parseManuscriptResource,
	validateManuscriptResource,
} from 'cs/editor/common/core/manuscriptResource';
import type { Utf16Offset } from 'cs/editor/common/core/semanticPosition';
import {
	decodeAcademicEntityV1,
	decodeClaimEvidenceRelationV1,
	encodeAcademicEntityV1,
	encodeClaimEvidenceRelationV1,
	type AcademicEntity,
	type AcademicGraphSnapshot,
	type ClaimEvidenceRelation,
} from 'cs/editor/common/model/academicGraph';
import {
	type DocumentIndex,
	type IDocumentNodeParentLocation,
	type IDocumentIndexLimits,
} from 'cs/editor/common/model/documentIndex';
import {
	getDocumentNodeChildren,
	type DocumentNode,
	type DocumentSemanticSettings,
	type InsertableNode,
	type ManuscriptMetadata,
	type ManuscriptNode,
	type Mark,
	type NodeKind,
	type TextNode,
} from 'cs/editor/common/model/manuscript';
import {
	decodeInsertableNodeV1,
	decodeMarksV1,
	decodeManuscriptMetadataV1,
	decodeDocumentSemanticSettingsV1,
	encodeInsertableNodeV1,
	encodeMarksV1,
	encodeManuscriptMetadataV1,
	encodeDocumentSemanticSettingsV1,
	maximumManuscriptTextUtf16Length,
	type SettableManuscriptNodeAttributes,
} from 'cs/editor/common/model/manuscriptSchema';
import {
	operationManuscriptTreeLimits,
	type Operation,
} from 'cs/editor/common/model/operation';
import type { PositionMapFragment } from 'cs/editor/common/model/positionMap';
import type {
	DocumentContent,
	DocumentSnapshot,
	RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';

export interface IManuscriptOperationReducerLimits extends IDocumentIndexLimits {
}

export type ManuscriptOperationReducerNodeReadKind =
	| 'affected-subtree'
	| 'changed-path'
	| 'changed-parent-lookup'
	| 'preorder-materialization';

export type ManuscriptOperationReducerShallowCopyKind =
	| 'document-child-slots'
	| 'academic-collection-slots'
	| 'index-node-overrides'
	| 'index-parent-overrides'
	| 'index-parent-versions';

export type ManuscriptOperationReducerIndexOverlayKind =
	| 'nodes'
	| 'parents'
	| 'parent-versions';

export interface IManuscriptOperationReducerInstrumentation {
	readonly onNodePayloadRead?: (
		nodeId: NodeId,
		kind: ManuscriptOperationReducerNodeReadKind,
	) => void;
	readonly onShallowCopy?: (
		kind: ManuscriptOperationReducerShallowCopyKind,
		copiedSlots: number,
	) => void;
	readonly onPreorderMaterialized?: (nodeCount: number) => void;
	readonly onIndexOverlayCardinality?: (
		kind: ManuscriptOperationReducerIndexOverlayKind,
		valueEntries: number,
		tombstoneEntries: number,
	) => void;
}

export const defaultManuscriptOperationReducerLimits: IManuscriptOperationReducerLimits =
	Object.freeze({
		maximumNodes: operationManuscriptTreeLimits.maximumNodes,
		maximumDepth: operationManuscriptTreeLimits.maximumDepth,
	});

export interface IReduceManuscriptOperationInput {
	readonly resource: URI;
	readonly snapshot: DocumentSnapshot;
	readonly index: DocumentIndex;
	readonly merkleState: RevisionMerkleState;
	readonly operation: Operation;
	readonly limits?: IManuscriptOperationReducerLimits;
	readonly instrumentation?: IManuscriptOperationReducerInstrumentation;
}

interface ICapturedReduceManuscriptOperationInput
	extends Omit<IReduceManuscriptOperationInput, 'limits'> {
	readonly limits: IManuscriptOperationReducerLimits;
}

export type ManuscriptOperationReducerFailureReason =
	| 'invalid-limits'
	| 'inconsistent-base'
	| 'node-not-found'
	| 'entity-not-found'
	| 'root-operation-forbidden'
	| 'hash-mismatch'
	| 'parent-does-not-own-children'
	| 'child-index-out-of-range'
	| 'duplicate-node-id'
	| 'duplicate-entity-id'
	| 'node-cycle'
	| 'invalid-parent-child'
	| 'invalid-node-kind'
	| 'invalid-text-target'
	| 'invalid-text-offset'
	| 'invalid-text-boundary'
	| 'text-marks-mismatch'
	| 'text-budget-exceeded'
	| 'node-budget-exceeded'
	| 'node-depth-exceeded'
	| 'relation-target-mismatch'
	| 'dangling-relation'
	| 'invalid-operation'
	| 'index-update-failed';

export interface IManuscriptOperationReducerFailure {
	readonly reason: ManuscriptOperationReducerFailureReason;
	readonly operationId: OperationId;
	readonly nodeId?: NodeId;
	readonly entityId?: EntityId;
	readonly claimId?: EntityId;
	readonly evidenceId?: EntityId;
	readonly expectedHash?: ContentHash | null;
	readonly actualHash?: ContentHash | null;
	readonly childIndex?: number;
}

export interface IOperationTouchedNodePath {
	readonly phase: 'before' | 'after';
	readonly path: readonly [NodeId, ...NodeId[]];
	readonly childIndexes: readonly number[];
}

export type AcademicCollectionName =
	| 'referenceSnapshots'
	| 'evidenceLinks'
	| 'claims'
	| 'claimEvidenceRelations';

export interface IOperationTouchedAcademicPath {
	readonly phase: 'before' | 'after';
	readonly collection: AcademicCollectionName;
	readonly index: number;
	readonly entityId?: EntityId;
	readonly claimId?: EntityId;
	readonly evidenceId?: EntityId;
}

export interface IManuscriptOperationTouchSet {
	readonly nodePaths: readonly IOperationTouchedNodePath[];
	readonly academicPaths: readonly IOperationTouchedAcademicPath[];
	readonly normalizationParentNodeIds: readonly NodeId[];
	readonly metadata: boolean;
	readonly settings: boolean;
}

interface IOperationCaptureBase {
	readonly operationId: OperationId;
	readonly type: Operation['type'];
}

export type ManuscriptOperationCapture =
	| (IOperationCaptureBase & {
		readonly type: 'insert-node';
		readonly parentNodeId: NodeId;
		readonly childIndex: number;
		readonly insertedNodeIds: readonly [NodeId, ...NodeId[]];
	})
	| (IOperationCaptureBase & {
		readonly type: 'delete-node';
		readonly parentNodeId: NodeId;
		readonly childIndex: number;
		readonly deletedNode: InsertableNode;
		readonly deletedNodeIds: readonly [NodeId, ...NodeId[]];
	})
	| (IOperationCaptureBase & {
		readonly type: 'move-node';
		readonly targetNodeId: NodeId;
		readonly sourceParentNodeId: NodeId;
		readonly sourceChildIndex: number;
		readonly destinationParentNodeId: NodeId;
		readonly destinationChildIndexAfterRemoval: number;
		readonly movedNodeIds: readonly [NodeId, ...NodeId[]];
	})
	| (IOperationCaptureBase & {
		readonly type: 'replace-text';
		readonly textNodeId: NodeId;
		readonly startUtf16Offset: Utf16Offset;
		readonly replacementUtf16Length: number;
		readonly replacedText: string;
	})
	| (IOperationCaptureBase & {
		readonly type: 'split-text';
		readonly parentNodeId: NodeId;
		readonly childIndex: number;
		readonly leftTextNodeId: NodeId;
		readonly rightTextNodeId: NodeId;
		readonly splitUtf16Offset: Utf16Offset;
	})
	| (IOperationCaptureBase & {
		readonly type: 'join-text';
		readonly parentNodeId: NodeId;
		readonly leftChildIndex: number;
		readonly leftBefore: TextNode;
		readonly rightBefore: TextNode;
	})
	| (IOperationCaptureBase & {
		readonly type: 'set-node-attributes';
		readonly nodeId: NodeId;
		readonly previousAttributes: SettableManuscriptNodeAttributes;
	})
	| (IOperationCaptureBase & {
		readonly type: 'set-text-marks';
		readonly textNodeId: NodeId;
		readonly previousMarks: readonly Mark[];
	})
	| (IOperationCaptureBase & {
		readonly type: 'create-academic-entity';
		readonly entityId: EntityId;
	})
	| (IOperationCaptureBase & {
		readonly type: 'replace-academic-entity';
		readonly previousEntity: AcademicEntity;
	})
	| (IOperationCaptureBase & {
		readonly type: 'delete-academic-entity';
		readonly deletedEntity: AcademicEntity;
	})
	| (IOperationCaptureBase & {
		readonly type: 'set-claim-evidence-relation';
		readonly claimId: EntityId;
		readonly evidenceId: EntityId;
		readonly previousRelation: ClaimEvidenceRelation | null;
	})
	| (IOperationCaptureBase & {
		readonly type: 'set-metadata';
		readonly previousMetadata: ManuscriptMetadata;
	})
	| (IOperationCaptureBase & {
		readonly type: 'set-settings';
		readonly previousSettings: DocumentSemanticSettings;
	});

declare const manuscriptOperationTransitionBrand: unique symbol;

/**
 * An opaque, reducer-owned record of one exact Operation transition.
 *
 * Runtime tokens deliberately have no own properties. Consumers may inspect a
 * token through {@link getManuscriptOperationTransitionView}, but only the token
 * itself carries the module-owned transition identity.
 */
export type ManuscriptOperationTransition = {
	readonly [manuscriptOperationTransitionBrand]:
		typeof manuscriptOperationTransitionBrand;
};

export interface IManuscriptOperationTransitionView {
	readonly resource: URI;
	readonly canonicalResource: string;
	readonly operationId: OperationId;
	readonly operationType: Operation['type'];
	readonly previousRevisionId: DocumentSnapshot['revisionId'];
	readonly previousDocumentHash: ContentHash;
	readonly limits: IManuscriptOperationReducerLimits;
	readonly touchSet: IManuscriptOperationTouchSet;
	readonly positionMapFragments: readonly PositionMapFragment[];
}

/**
 * Exact candidate values transferred out of a consumed transition.
 *
 * This structural result carries no provenance and is not accepted by an
 * installation boundary. The opaque transition is invalid after transfer.
 */
export interface IConsumedManuscriptOperationTransition {
	readonly resource: URI;
	readonly canonicalResource: string;
	readonly operation: Operation;
	readonly previousSnapshot: DocumentSnapshot;
	readonly previousIndex: DocumentIndex;
	readonly previousMerkleState: RevisionMerkleState;
	readonly limits: IManuscriptOperationReducerLimits;
	readonly nextContent: DocumentContent;
	readonly nextIndex: DocumentIndex;
	readonly touchSet: IManuscriptOperationTouchSet;
	readonly capture: ManuscriptOperationCapture;
	readonly positionMapFragments: readonly PositionMapFragment[];
}

export type ReduceManuscriptOperationResult =
	| {
		readonly type: 'ok';
		readonly value: ManuscriptOperationTransition;
	}
	| {
		readonly type: 'error';
		readonly error: IManuscriptOperationReducerFailure;
	};

interface IManuscriptOperationTransitionRecord
	extends IConsumedManuscriptOperationTransition {
	readonly summaryOperationId: OperationId;
	readonly summaryOperationType: Operation['type'];
	readonly summaryPreviousRevisionId: DocumentSnapshot['revisionId'];
	readonly summaryPreviousDocumentHash: ContentHash;
	/**
	 * This canonical clone remains private because URI maintains mutable lazy
	 * caches and TypeScript readonly fields are writable at runtime.
	 */
	readonly resource: URI;
}

const manuscriptOperationTransitionRecords = new WeakMap<
	ManuscriptOperationTransition,
	IManuscriptOperationTransitionRecord
>();

/**
 * Applies one decoded Operation to candidate revision-local state without allocating identity.
 *
 * This is an ordered-draft step, not the Transaction commit boundary. A successful
 * intermediate draft may be temporarily schema-invalid until later Operations and
 * touched-neighborhood normalization complete; the Transaction kernel owns the final
 * complete schema and academic-invariant validation before installation. The opaque
 * result binds the exact supplied base; it does not confer trust on that base. The
 * owning Transaction boundary validates base provenance before reduction.
 */
export function reduceManuscriptOperation(
	input: IReduceManuscriptOperationInput,
): ReduceManuscriptOperationResult {
	const resource = validateManuscriptResource(input.resource);
	if (resource.type === 'invalid') {
		return failure(input.operation, 'inconsistent-base');
	}
	const limits = captureLimits(input.limits);
	if (limits === undefined) {
		return failure(input.operation, 'invalid-limits');
	}
	const capturedInput: ICapturedReduceManuscriptOperationInput = {
		...input,
		resource: resource.resource,
		limits,
	};
	const baseFailure = validateBase(capturedInput, limits);
	if (baseFailure !== undefined) {
		return baseFailure;
	}

	switch (capturedInput.operation.type) {
		case 'insert-node':
			return reduceInsertNode({
				...capturedInput,
				operation: capturedInput.operation,
			}, limits);
		case 'delete-node':
			return reduceDeleteNode({
				...capturedInput,
				operation: capturedInput.operation,
			}, limits);
		case 'move-node':
			return reduceMoveNode({
				...capturedInput,
				operation: capturedInput.operation,
			}, limits);
		case 'replace-text':
			return reduceReplaceText({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'split-text':
			return reduceSplitText({
				...capturedInput,
				operation: capturedInput.operation,
			}, limits);
		case 'join-text':
			return reduceJoinText({
				...capturedInput,
				operation: capturedInput.operation,
			}, limits);
		case 'set-node-attributes':
			return reduceSetNodeAttributes({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'set-text-marks':
			return reduceSetTextMarks({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'create-academic-entity':
			return reduceCreateAcademicEntity({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'replace-academic-entity':
			return reduceReplaceAcademicEntity({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'delete-academic-entity':
			return reduceDeleteAcademicEntity({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'set-claim-evidence-relation':
			return reduceSetClaimEvidenceRelation({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'set-metadata':
			return reduceSetMetadata({
				...capturedInput,
				operation: capturedInput.operation,
			});
		case 'set-settings':
			return reduceSetSettings({
				...capturedInput,
				operation: capturedInput.operation,
			});
	}
}

export function getManuscriptOperationTransitionView(
	transition: unknown,
): IManuscriptOperationTransitionView | undefined {
	const record = getManuscriptOperationTransitionRecord(transition);
	if (record === undefined) {
		return undefined;
	}
	const resource = parseManuscriptResource(record.canonicalResource);
	if (resource.type === 'invalid') {
		throw new Error('A manuscript Operation transition lost its canonical resource.');
	}
	return Object.freeze({
		resource: resource.resource,
		canonicalResource: record.canonicalResource,
		operationId: record.summaryOperationId,
		operationType: record.summaryOperationType,
		previousRevisionId: record.summaryPreviousRevisionId,
		previousDocumentHash: record.summaryPreviousDocumentHash,
		limits: record.limits,
		touchSet: record.touchSet,
		positionMapFragments: record.positionMapFragments,
	});
}

/**
 * Destructively transfers one exact reducer candidate to its next owner.
 *
 * The returned structure is deliberately not authority: callers cannot feed it
 * back into this module, and the opaque transition can be consumed only once.
 */
export function consumeManuscriptOperationTransition(
	transition: unknown,
): IConsumedManuscriptOperationTransition | undefined {
	const record = getManuscriptOperationTransitionRecord(transition);
	if (record === undefined) {
		return undefined;
	}
	manuscriptOperationTransitionRecords.delete(
		transition as ManuscriptOperationTransition,
	);
	return record;
}

function getManuscriptOperationTransitionRecord(
	transition: unknown,
): IManuscriptOperationTransitionRecord | undefined {
	return (
		transition !== null
		&& typeof transition === 'object'
	)
		? manuscriptOperationTransitionRecords.get(
			transition as ManuscriptOperationTransition,
		)
		: undefined;
}

function reduceInsertNode(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'insert-node' }>;
	},
	limits: IManuscriptOperationReducerLimits,
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const parent = input.index.getNode(operation.parentNodeId);
	if (parent === undefined) {
		return failure(operation, 'node-not-found', {
			nodeId: operation.parentNodeId,
		});
	}
	const hashFailure = validateNodeHash(
		input,
		operation.parentNodeId,
		operation.expectedParentHash,
	);
	if (hashFailure !== undefined) {
		return hashFailure;
	}
	if (!nodeOwnsChildren(parent)) {
		return failure(operation, 'parent-does-not-own-children', {
			nodeId: operation.parentNodeId,
		});
	}
	if (operation.childIndex > parent.children.length) {
		return failure(operation, 'child-index-out-of-range', {
			nodeId: operation.parentNodeId,
			childIndex: operation.childIndex,
		});
	}

	const insertedNode = cloneInsertableNode(operation.node, limits);
	if (insertedNode === undefined) {
		return failure(operation, 'invalid-operation');
	}
	const insertedNodeIds = collectSubtreeNodeIds(insertedNode);
	if (input.index.nodeCount > limits.maximumNodes - insertedNodeIds.length) {
		return failure(operation, 'node-budget-exceeded');
	}
	for (const nodeId of insertedNodeIds) {
		if (input.index.hasNode(nodeId)) {
			return failure(operation, 'duplicate-node-id', { nodeId });
		}
	}
	const parentDepth = nodeDepth(input.index, parent.id);
	if (parentDepth === undefined) {
		return failure(operation, 'inconsistent-base', { nodeId: parent.id });
	}
	if (
		parentDepth + 1 + subtreeMaximumRelativeDepth(insertedNode)
		> limits.maximumDepth
	) {
		return failure(operation, 'node-depth-exceeded', {
			nodeId: insertedNode.id,
		});
	}

	const nextChildren = insertAt(
		parent.children as readonly DocumentNode[],
		operation.childIndex,
		insertedNode,
		input.instrumentation,
		'document-child-slots',
	);
	if (!hasLocallyValidChildSequence(parent.type, nextChildren)) {
		return failure(operation, 'invalid-parent-child', {
			nodeId: operation.parentNodeId,
			childIndex: operation.childIndex,
		});
	}
	const nextParent = cloneNodeWithChildren(parent, nextChildren);
	const nextRoot = replaceNodeAtPath(
		input.snapshot.root,
		input.index,
		parent.id,
		nextParent,
		input.instrumentation,
	);
	const nextIndex = createInsertedDocumentIndex(
		input.index,
		nextRoot,
		parent.id,
		operation.childIndex,
		insertedNode,
		insertedNodeIds,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(operation, 'index-update-failed');
	}
	const beforeParentPath = touchedNodePath('before', input.index, parent.id);
	const afterInsertedPath = touchedNodePath(
		'after',
		nextIndex,
		insertedNode.id,
	);
	if (beforeParentPath === undefined || afterInsertedPath === undefined) {
		return failure(operation, 'index-update-failed');
	}

	const capture = freezeOperationCapture({
		operationId: operation.id,
		type: operation.type,
		parentNodeId: parent.id,
		childIndex: operation.childIndex,
		insertedNodeIds,
	});
	const fragment: PositionMapFragment = Object.freeze({
		kind: 'child-insert',
		parentNodeId: parent.id,
		childIndex: operation.childIndex,
		insertedChildCount: 1,
		insertedNodeIds,
	});
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({
			nodePaths: [beforeParentPath, afterInsertedPath],
			normalizationParentNodeIds: [
				parent.id,
				...collectNormalizationParentNodeIds(insertedNode),
			],
		}),
		capture,
		[fragment],
	);
}

function reduceDeleteNode(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'delete-node' }>;
	},
	limits: IManuscriptOperationReducerLimits,
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const target = input.index.getNode(operation.targetNodeId);
	if (target === undefined) {
		return failure(operation, 'node-not-found', {
			nodeId: operation.targetNodeId,
		});
	}
	if (target.id === input.index.rootNodeId) {
		return failure(operation, 'root-operation-forbidden', {
			nodeId: target.id,
		});
	}
	const hashFailure = validateNodeHash(
		input,
		target.id,
		operation.expectedNodeHash,
	);
	if (hashFailure !== undefined) {
		return hashFailure;
	}
	const location = input.index.getParentLocation(target.id);
	if (location === undefined) {
		return failure(operation, 'inconsistent-base', { nodeId: target.id });
	}
	const parent = input.index.getNode(location.parentNodeId);
	if (parent === undefined || !nodeOwnsChildren(parent)) {
		return failure(operation, 'inconsistent-base', {
			nodeId: location.parentNodeId,
		});
	}
	const deletedNode = cloneInsertableNode(target as InsertableNode, limits);
	if (deletedNode === undefined) {
		return failure(operation, 'invalid-operation', { nodeId: target.id });
	}
	const deletedNodeIds = collectSubtreeNodeIds(deletedNode);
	const beforeTargetPath = touchedNodePath('before', input.index, target.id);
	if (beforeTargetPath === undefined) {
		return failure(operation, 'inconsistent-base', { nodeId: target.id });
	}

	const nextChildren = removeAt(
		parent.children as readonly DocumentNode[],
		location.childIndex,
		input.instrumentation,
		'document-child-slots',
	);
	const nextParent = cloneNodeWithChildren(parent, nextChildren);
	const nextRoot = replaceNodeAtPath(
		input.snapshot.root,
		input.index,
		parent.id,
		nextParent,
		input.instrumentation,
	);
	const nextIndex = createDeletedDocumentIndex(
		input.index,
		nextRoot,
		parent.id,
		deletedNodeIds,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(operation, 'index-update-failed');
	}
	const afterParentPath = touchedNodePath('after', nextIndex, parent.id);
	if (afterParentPath === undefined) {
		return failure(operation, 'index-update-failed');
	}

	const capture = freezeOperationCapture({
		operationId: operation.id,
		type: operation.type,
		parentNodeId: parent.id,
		childIndex: location.childIndex,
		deletedNode,
		deletedNodeIds,
	});
	const fragment: PositionMapFragment = Object.freeze({
		kind: 'child-delete',
		parentNodeId: parent.id,
		childIndex: location.childIndex,
		deletedChildCount: 1,
		deletedNodeIds,
	});
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({
			nodePaths: [beforeTargetPath, afterParentPath],
			normalizationParentNodeIds: [parent.id],
		}),
		capture,
		[fragment],
	);
}

function reduceMoveNode(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'move-node' }>;
	},
	limits: IManuscriptOperationReducerLimits,
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const target = input.index.getNode(operation.targetNodeId);
	if (target === undefined) {
		return failure(operation, 'node-not-found', {
			nodeId: operation.targetNodeId,
		});
	}
	if (target.id === input.index.rootNodeId) {
		return failure(operation, 'root-operation-forbidden', {
			nodeId: target.id,
		});
	}
	const targetHashFailure = validateNodeHash(
		input,
		target.id,
		operation.expectedNodeHash,
	);
	if (targetHashFailure !== undefined) {
		return targetHashFailure;
	}
	const destinationParent = input.index.getNode(operation.newParentNodeId);
	if (destinationParent === undefined) {
		return failure(operation, 'node-not-found', {
			nodeId: operation.newParentNodeId,
		});
	}
	const parentHashFailure = validateNodeHash(
		input,
		destinationParent.id,
		operation.expectedParentHash,
	);
	if (parentHashFailure !== undefined) {
		return parentHashFailure;
	}
	if (!nodeOwnsChildren(destinationParent)) {
		return failure(operation, 'parent-does-not-own-children', {
			nodeId: destinationParent.id,
		});
	}
	const sourceLocation = input.index.getParentLocation(target.id);
	if (sourceLocation === undefined) {
		return failure(operation, 'inconsistent-base', { nodeId: target.id });
	}
	if (target.id === destinationParent.id || isAncestor(
		input.index,
		target.id,
		destinationParent.id,
	)) {
		return failure(operation, 'node-cycle', { nodeId: target.id });
	}

	const sourceParent = input.index.getNode(sourceLocation.parentNodeId);
	if (sourceParent === undefined || !nodeOwnsChildren(sourceParent)) {
		return failure(operation, 'inconsistent-base', {
			nodeId: sourceLocation.parentNodeId,
		});
	}
	const sameParent = sourceParent.id === destinationParent.id;
	const destinationLengthAfterRemoval = sameParent
		? destinationParent.children.length - 1
		: destinationParent.children.length;
	if (operation.childIndex > destinationLengthAfterRemoval) {
		return failure(operation, 'child-index-out-of-range', {
			nodeId: destinationParent.id,
			childIndex: operation.childIndex,
		});
	}
	const movedNodeIds = collectSubtreeNodeIds(target);
	const beforeTargetPath = touchedNodePath('before', input.index, target.id);
	const beforeSourceParentPath = touchedNodePath(
		'before',
		input.index,
		sourceParent.id,
	);
	const beforeDestinationParentPath = sameParent
		? beforeSourceParentPath
		: touchedNodePath('before', input.index, destinationParent.id);
	if (
		beforeTargetPath === undefined
		|| beforeSourceParentPath === undefined
		|| beforeDestinationParentPath === undefined
	) {
		return failure(operation, 'inconsistent-base', { nodeId: target.id });
	}
	const destinationDepth = nodeDepth(input.index, destinationParent.id);
	if (destinationDepth === undefined) {
		return failure(operation, 'inconsistent-base', {
			nodeId: destinationParent.id,
		});
	}
	if (
		destinationDepth + 1 + subtreeMaximumRelativeDepth(target)
		> limits.maximumDepth
	) {
		return failure(operation, 'node-depth-exceeded', {
			nodeId: target.id,
		});
	}

	let nextRoot: ManuscriptNode;
	if (sameParent) {
		const removedChildren = removeAt(
			sourceParent.children as readonly DocumentNode[],
			sourceLocation.childIndex,
			input.instrumentation,
			'document-child-slots',
		);
		const nextChildren = insertAt(
			removedChildren,
			operation.childIndex,
			target,
			input.instrumentation,
			'document-child-slots',
		);
		if (!hasLocallyValidChildSequence(sourceParent.type, nextChildren)) {
			return failure(operation, 'invalid-parent-child', {
				nodeId: sourceParent.id,
				childIndex: operation.childIndex,
			});
		}
		const nextParent = cloneNodeWithChildren(sourceParent, nextChildren);
		nextRoot = replaceNodeAtPath(
			input.snapshot.root,
			input.index,
			sourceParent.id,
			nextParent,
			input.instrumentation,
		);
	} else {
		const sourceChildren = removeAt(
			sourceParent.children as readonly DocumentNode[],
			sourceLocation.childIndex,
			input.instrumentation,
			'document-child-slots',
		);
		const nextSourceParent = cloneNodeWithChildren(
			sourceParent,
			sourceChildren,
		);
		const rootAfterRemoval = replaceNodeAtPath(
			input.snapshot.root,
			input.index,
			sourceParent.id,
			nextSourceParent,
			input.instrumentation,
		);
		const currentDestinationParent = findNodeAtExistingPath(
			rootAfterRemoval,
			input.index,
			destinationParent.id,
			input.instrumentation,
		);
		if (
			currentDestinationParent === undefined
			|| !nodeOwnsChildren(currentDestinationParent)
		) {
			return failure(operation, 'index-update-failed', {
				nodeId: destinationParent.id,
			});
		}
		const destinationChildren = insertAt(
			currentDestinationParent.children as readonly DocumentNode[],
			operation.childIndex,
			target,
			input.instrumentation,
			'document-child-slots',
		);
		if (!hasLocallyValidChildSequence(
			currentDestinationParent.type,
			destinationChildren,
		)) {
			return failure(operation, 'invalid-parent-child', {
				nodeId: currentDestinationParent.id,
				childIndex: operation.childIndex,
			});
		}
		const nextDestinationParent = cloneNodeWithChildren(
			currentDestinationParent,
			destinationChildren,
		);
		const replacedRoot = replaceNodeAtExistingPath(
			rootAfterRemoval,
			input.index,
			currentDestinationParent.id,
			nextDestinationParent,
			input.instrumentation,
		);
		if (replacedRoot === undefined) {
			return failure(operation, 'index-update-failed', {
				nodeId: currentDestinationParent.id,
			});
		}
		nextRoot = replacedRoot;
	}
	const nextIndex = createMovedDocumentIndex(
		input.index,
		nextRoot,
		sourceParent.id,
		destinationParent.id,
		operation.childIndex,
		movedNodeIds,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(operation, 'index-update-failed', {
			nodeId: target.id,
		});
	}

	const afterTargetPath = touchedNodePath('after', nextIndex, target.id);
	const afterSourceParentPath = touchedNodePath(
		'after',
		nextIndex,
		sourceParent.id,
	);
	const afterDestinationParentPath = sameParent
		? afterSourceParentPath
		: touchedNodePath('after', nextIndex, destinationParent.id);
	if (
		afterTargetPath === undefined
		|| afterSourceParentPath === undefined
		|| afterDestinationParentPath === undefined
	) {
		return failure(operation, 'index-update-failed', {
			nodeId: target.id,
		});
	}
	const normalizationParents = sourceParent.id === destinationParent.id
		? [sourceParent.id]
		: [sourceParent.id, destinationParent.id];
	const capture = freezeOperationCapture({
		operationId: operation.id,
		type: operation.type,
		targetNodeId: target.id,
		sourceParentNodeId: sourceParent.id,
		sourceChildIndex: sourceLocation.childIndex,
		destinationParentNodeId: destinationParent.id,
		destinationChildIndexAfterRemoval: operation.childIndex,
		movedNodeIds,
	});
	const fragment: PositionMapFragment = Object.freeze({
		kind: 'child-move',
		sourceParentNodeId: sourceParent.id,
		sourceChildIndex: sourceLocation.childIndex,
		destinationParentNodeId: destinationParent.id,
		destinationChildIndexAfterRemoval: operation.childIndex,
		movedChildCount: 1,
		movedNodeIds,
	});
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({
			nodePaths: sameParent
				? [
					beforeTargetPath,
					beforeSourceParentPath,
					afterTargetPath,
					afterSourceParentPath,
				]
				: [
					beforeTargetPath,
					beforeSourceParentPath,
					beforeDestinationParentPath,
					afterTargetPath,
					afterSourceParentPath,
					afterDestinationParentPath,
				],
			normalizationParentNodeIds: normalizationParents,
		}),
		capture,
		[fragment],
	);
}

function reduceReplaceText(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'replace-text' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const targetResult = getTextTarget(
		input,
		operation.textNodeId,
		operation.expectedNodeHash,
	);
	if (targetResult.type === 'error') {
		return targetResult;
	}
	const target = targetResult.value;
	const offsetsFailure = validateTextRange(
		operation,
		target.value,
		operation.startUtf16Offset,
		operation.endUtf16Offset,
	);
	if (offsetsFailure !== undefined) {
		return offsetsFailure;
	}
	if (!isWellFormedUnicodeString(operation.replacement)) {
		return failure(operation, 'invalid-operation', {
			nodeId: target.id,
		});
	}
	const nextLength = target.value.length
		- (operation.endUtf16Offset - operation.startUtf16Offset)
		+ operation.replacement.length;
	if (nextLength > maximumManuscriptTextUtf16Length) {
		return failure(operation, 'text-budget-exceeded', {
			nodeId: target.id,
		});
	}
	const replacedText = target.value.slice(
		operation.startUtf16Offset,
		operation.endUtf16Offset,
	);
	const nextText = Object.freeze({
		id: target.id,
		type: target.type,
		value: target.value.slice(0, operation.startUtf16Offset)
			+ operation.replacement
			+ target.value.slice(operation.endUtf16Offset),
		marks: target.marks,
	}) satisfies TextNode;
	return replaceTextNode(
		input,
		target,
		nextText,
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			textNodeId: target.id,
			startUtf16Offset: operation.startUtf16Offset,
			replacementUtf16Length: operation.replacement.length,
			replacedText,
		}),
		[Object.freeze({
			kind: 'text-replace',
			textNodeId: target.id,
			startUtf16Offset: operation.startUtf16Offset,
			endUtf16Offset: operation.endUtf16Offset,
			replacementUtf16Length: operation.replacement.length,
		})],
		true,
	);
}

function reduceSplitText(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'split-text' }>;
	},
	limits: IManuscriptOperationReducerLimits,
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const targetResult = getTextTarget(
		input,
		operation.textNodeId,
		operation.expectedNodeHash,
	);
	if (targetResult.type === 'error') {
		return targetResult;
	}
	const target = targetResult.value;
	const offsetFailure = validateTextRange(
		operation,
		target.value,
		operation.splitUtf16Offset,
		operation.splitUtf16Offset,
	);
	if (offsetFailure !== undefined) {
		return offsetFailure;
	}
	if (input.index.hasNode(operation.rightTextNodeId)) {
		return failure(operation, 'duplicate-node-id', {
			nodeId: operation.rightTextNodeId,
		});
	}
	if (input.index.nodeCount >= limits.maximumNodes) {
		return failure(operation, 'node-budget-exceeded');
	}
	const location = input.index.getParentLocation(target.id);
	if (location === undefined) {
		return failure(operation, 'inconsistent-base', { nodeId: target.id });
	}
	const parent = input.index.getNode(location.parentNodeId);
	if (parent === undefined || !nodeOwnsChildren(parent)) {
		return failure(operation, 'inconsistent-base', {
			nodeId: location.parentNodeId,
		});
	}
	const marks = cloneMarks(target.marks);
	if (marks === undefined) {
		return failure(operation, 'invalid-operation', { nodeId: target.id });
	}
	const left = Object.freeze({
		id: target.id,
		type: target.type,
		value: target.value.slice(0, operation.splitUtf16Offset),
		marks,
	}) satisfies TextNode;
	const right = Object.freeze({
		id: operation.rightTextNodeId,
		type: target.type,
		value: target.value.slice(operation.splitUtf16Offset),
		marks,
	}) satisfies TextNode;
	const nextChildren = Object.freeze([
		...parent.children.slice(0, location.childIndex),
		left,
		right,
		...parent.children.slice(location.childIndex + 1),
	]);
	input.instrumentation?.onShallowCopy?.(
		'document-child-slots',
		nextChildren.length,
	);
	if (!hasLocallyValidChildSequence(parent.type, nextChildren)) {
		return failure(operation, 'invalid-parent-child', {
			nodeId: parent.id,
			childIndex: location.childIndex,
		});
	}
	const nextParent = cloneNodeWithChildren(parent, nextChildren);
	const nextRoot = replaceNodeAtPath(
		input.snapshot.root,
		input.index,
		parent.id,
		nextParent,
		input.instrumentation,
	);
	const nextIndex = createSplitDocumentIndex(
		input.index,
		nextRoot,
		parent.id,
		left,
		right,
		location.childIndex,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(operation, 'index-update-failed', {
			nodeId: target.id,
		});
	}
	const beforePath = touchedNodePath('before', input.index, target.id);
	const afterLeftPath = touchedNodePath('after', nextIndex, left.id);
	const afterRightPath = touchedNodePath('after', nextIndex, right.id);
	if (
		beforePath === undefined
		|| afterLeftPath === undefined
		|| afterRightPath === undefined
	) {
		return failure(operation, 'index-update-failed');
	}
	const capture = freezeOperationCapture({
		operationId: operation.id,
		type: operation.type,
		parentNodeId: parent.id,
		childIndex: location.childIndex,
		leftTextNodeId: left.id,
		rightTextNodeId: right.id,
		splitUtf16Offset: operation.splitUtf16Offset,
	});
	const fragment: PositionMapFragment = Object.freeze({
		kind: 'text-split',
		parentNodeId: parent.id,
		childIndex: location.childIndex,
		leftTextNodeId: left.id,
		rightTextNodeId: right.id,
		splitUtf16Offset: operation.splitUtf16Offset,
	});
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({
			nodePaths: [beforePath, afterLeftPath, afterRightPath],
			normalizationParentNodeIds: [parent.id],
		}),
		capture,
		[fragment],
	);
}

function reduceJoinText(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'join-text' }>;
	},
	_limits: IManuscriptOperationReducerLimits,
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const leftResult = getTextTarget(
		input,
		operation.leftTextNodeId,
		operation.expectedLeftNodeHash,
	);
	if (leftResult.type === 'error') {
		return leftResult;
	}
	const rightResult = getTextTarget(
		input,
		operation.rightTextNodeId,
		operation.expectedRightNodeHash,
	);
	if (rightResult.type === 'error') {
		return rightResult;
	}
	const left = leftResult.value;
	const right = rightResult.value;
	const leftLocation = input.index.getParentLocation(left.id);
	const rightLocation = input.index.getParentLocation(right.id);
	if (
		leftLocation === undefined
		|| rightLocation === undefined
		|| leftLocation.parentNodeId !== rightLocation.parentNodeId
		|| rightLocation.childIndex !== leftLocation.childIndex + 1
	) {
		return failure(operation, 'invalid-parent-child', {
			nodeId: left.id,
		});
	}
	if (!marksEqual(left.marks, right.marks)) {
		return failure(operation, 'text-marks-mismatch', {
			nodeId: right.id,
		});
	}
	if (
		left.value.length > maximumManuscriptTextUtf16Length - right.value.length
	) {
		return failure(operation, 'text-budget-exceeded', {
			nodeId: left.id,
		});
	}
	const parent = input.index.getNode(leftLocation.parentNodeId);
	if (parent === undefined || !nodeOwnsChildren(parent)) {
		return failure(operation, 'inconsistent-base', {
			nodeId: leftLocation.parentNodeId,
		});
	}
	const leftBefore = cloneTextNode(left);
	const rightBefore = cloneTextNode(right);
	if (leftBefore === undefined || rightBefore === undefined) {
		return failure(operation, 'invalid-operation');
	}
	const joined = Object.freeze({
		id: left.id,
		type: left.type,
		value: left.value + right.value,
		marks: left.marks,
	}) satisfies TextNode;
	const nextChildren = Object.freeze([
		...parent.children.slice(0, leftLocation.childIndex),
		joined,
		...parent.children.slice(rightLocation.childIndex + 1),
	]);
	input.instrumentation?.onShallowCopy?.(
		'document-child-slots',
		nextChildren.length,
	);
	const nextParent = cloneNodeWithChildren(parent, nextChildren);
	const nextRoot = replaceNodeAtPath(
		input.snapshot.root,
		input.index,
		parent.id,
		nextParent,
		input.instrumentation,
	);
	const nextIndex = createJoinDocumentIndex(
		input.index,
		nextRoot,
		parent.id,
		joined,
		right.id,
		leftLocation.childIndex,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(operation, 'index-update-failed', {
			nodeId: right.id,
		});
	}
	const beforeLeftPath = touchedNodePath('before', input.index, left.id);
	const beforeRightPath = touchedNodePath('before', input.index, right.id);
	const afterLeftPath = touchedNodePath('after', nextIndex, left.id);
	if (
		beforeLeftPath === undefined
		|| beforeRightPath === undefined
		|| afterLeftPath === undefined
	) {
		return failure(operation, 'index-update-failed');
	}
	const capture = freezeOperationCapture({
		operationId: operation.id,
		type: operation.type,
		parentNodeId: parent.id,
		leftChildIndex: leftLocation.childIndex,
		leftBefore,
		rightBefore,
	});
	const fragment: PositionMapFragment = Object.freeze({
		kind: 'text-join',
		parentNodeId: parent.id,
		leftChildIndex: leftLocation.childIndex,
		leftTextNodeId: left.id,
		rightTextNodeId: right.id,
		leftUtf16Length: left.value.length,
	});
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({
			nodePaths: [beforeLeftPath, beforeRightPath, afterLeftPath],
			normalizationParentNodeIds: [parent.id],
		}),
		capture,
		[fragment],
	);
}

function reduceSetNodeAttributes(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'set-node-attributes' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const target = input.index.getNode(operation.nodeId);
	if (target === undefined) {
		return failure(operation, 'node-not-found', {
			nodeId: operation.nodeId,
		});
	}
	if (target.type === 'text' || target.type === 'manuscript') {
		return failure(operation, 'invalid-node-kind', { nodeId: target.id });
	}
	const hashFailure = validateNodeHash(
		input,
		target.id,
		operation.expectedNodeHash,
	);
	if (hashFailure !== undefined) {
		return hashFailure;
	}
	if (!attributesMatchNodeType(target.type, operation.attributes)) {
		return failure(operation, 'invalid-node-kind', { nodeId: target.id });
	}
	const attributes = cloneNodeAttributes(operation.attributes);
	const previousAttributes = cloneNodeAttributes(
		target.attrs as SettableManuscriptNodeAttributes,
	);
	if (attributes === undefined || previousAttributes === undefined) {
		return failure(operation, 'invalid-operation', { nodeId: target.id });
	}
	const nextNode = cloneNodeWithAttributes(target, attributes);
	const nextRoot = replaceNodeAtPath(
		input.snapshot.root,
		input.index,
		target.id,
		nextNode,
		input.instrumentation,
	);
	const nextIndex = createPayloadUpdatedIndex(
		input.index,
		nextRoot,
		target.id,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(operation, 'index-update-failed', {
			nodeId: target.id,
		});
	}
	const beforePath = touchedNodePath('before', input.index, target.id);
	const afterPath = touchedNodePath('after', nextIndex, target.id);
	if (beforePath === undefined || afterPath === undefined) {
		return failure(operation, 'index-update-failed');
	}
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({ nodePaths: [beforePath, afterPath] }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			nodeId: target.id,
			previousAttributes,
		}),
		[],
	);
}

function reduceSetTextMarks(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'set-text-marks' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const targetResult = getTextTarget(
		input,
		operation.textNodeId,
		operation.expectedNodeHash,
	);
	if (targetResult.type === 'error') {
		return targetResult;
	}
	const target = targetResult.value;
	const marks = cloneMarks(operation.marks);
	const previousMarks = cloneMarks(target.marks);
	if (marks === undefined || previousMarks === undefined) {
		return failure(operation, 'invalid-operation', { nodeId: target.id });
	}
	const nextText = Object.freeze({
		id: target.id,
		type: target.type,
		value: target.value,
		marks,
	}) satisfies TextNode;
	return replaceTextNode(
		input,
		target,
		nextText,
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			textNodeId: target.id,
			previousMarks,
		}),
		[],
		true,
	);
}

function reduceCreateAcademicEntity(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'create-academic-entity' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const entity = cloneAcademicEntity(operation.entity, input.resource);
	if (entity === undefined) {
		return failure(operation, 'invalid-operation');
	}
	if (findAcademicEntity(input.snapshot.academicGraph, entity.id) !== undefined) {
		return failure(operation, 'duplicate-entity-id', {
			entityId: entity.id,
		});
	}
	const collection = academicEntityCollection(entity);
	const source = input.snapshot.academicGraph[collection] as readonly AcademicEntity[];
	const insertionIndex = findEntityInsertionIndex(source, entity.id);
	const nextCollection = insertAt(
		source,
		insertionIndex,
		entity,
		input.instrumentation,
		'academic-collection-slots',
	);
	const nextGraph = replaceAcademicCollection(
		input.snapshot.academicGraph,
		collection,
		nextCollection,
	);
	const academicPath: IOperationTouchedAcademicPath = Object.freeze({
		phase: 'after',
		collection,
		index: insertionIndex,
		entityId: entity.id,
	});
	return success(
		input,
		{ academicGraph: nextGraph },
		input.index,
		touchSet({ academicPaths: [academicPath] }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			entityId: entity.id,
		}),
		[],
	);
}

function reduceReplaceAcademicEntity(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'replace-academic-entity' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const replacement = cloneAcademicEntity(
		operation.replacement,
		input.resource,
	);
	if (replacement === undefined) {
		return failure(operation, 'invalid-operation', {
			entityId: operation.entityId,
		});
	}
	const located = findAcademicEntity(
		input.snapshot.academicGraph,
		operation.entityId,
	);
	if (located === undefined) {
		return failure(operation, 'entity-not-found', {
			entityId: operation.entityId,
		});
	}
	const hashFailure = validateEntityHash(
		input,
		operation.entityId,
		operation.expectedEntityHash,
	);
	if (hashFailure !== undefined) {
		return hashFailure;
	}
	if (replacement.id !== operation.entityId) {
		return failure(operation, 'invalid-operation', {
			entityId: operation.entityId,
		});
	}
	const source = input.snapshot.academicGraph[
		located.collection
	] as readonly AcademicEntity[];
	const replacementCollection = academicEntityCollection(replacement);
	let nextGraph: AcademicGraphSnapshot;
	let replacementIndex: number;
	if (replacementCollection === located.collection) {
		replacementIndex = located.index;
		const nextCollection = replaceAt(
			source,
			located.index,
			replacement,
			input.instrumentation,
			'academic-collection-slots',
		);
		nextGraph = replaceAcademicCollection(
			input.snapshot.academicGraph,
			located.collection,
			nextCollection,
		);
	} else {
		const graphAfterRemoval = replaceAcademicCollection(
			input.snapshot.academicGraph,
			located.collection,
			removeAt(
				source,
				located.index,
				input.instrumentation,
				'academic-collection-slots',
			),
		);
		const destination = graphAfterRemoval[
			replacementCollection
		] as readonly AcademicEntity[];
		replacementIndex = findEntityInsertionIndex(
			destination,
			replacement.id,
		);
		nextGraph = replaceAcademicCollection(
			graphAfterRemoval,
			replacementCollection,
			insertAt(
				destination,
				replacementIndex,
				replacement,
				input.instrumentation,
				'academic-collection-slots',
			),
		);
	}
	const beforePath: IOperationTouchedAcademicPath = Object.freeze({
		phase: 'before',
		collection: located.collection,
		index: located.index,
		entityId: located.entity.id,
	});
	const afterPath: IOperationTouchedAcademicPath = Object.freeze({
		phase: 'after',
		collection: replacementCollection,
		index: replacementIndex,
		entityId: replacement.id,
	});
	const previousEntity = cloneAcademicEntity(located.entity, input.resource);
	if (previousEntity === undefined) {
		return failure(operation, 'inconsistent-base', {
			entityId: located.entity.id,
		});
	}
	return success(
		input,
		{ academicGraph: nextGraph },
		input.index,
		touchSet({ academicPaths: [beforePath, afterPath] }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			previousEntity,
		}),
		[],
	);
}

function reduceDeleteAcademicEntity(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'delete-academic-entity' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const located = findAcademicEntity(
		input.snapshot.academicGraph,
		operation.entityId,
	);
	if (located === undefined) {
		return failure(operation, 'entity-not-found', {
			entityId: operation.entityId,
		});
	}
	const hashFailure = validateEntityHash(
		input,
		operation.entityId,
		operation.expectedEntityHash,
	);
	if (hashFailure !== undefined) {
		return hashFailure;
	}
	const source = input.snapshot.academicGraph[
		located.collection
	] as readonly AcademicEntity[];
	const nextCollection = removeAt(
		source,
		located.index,
		input.instrumentation,
		'academic-collection-slots',
	);
	const nextGraph = replaceAcademicCollection(
		input.snapshot.academicGraph,
		located.collection,
		nextCollection,
	);
	const beforePath: IOperationTouchedAcademicPath = Object.freeze({
		phase: 'before',
		collection: located.collection,
		index: located.index,
		entityId: located.entity.id,
	});
	const deletedEntity = cloneAcademicEntity(located.entity, input.resource);
	if (deletedEntity === undefined) {
		return failure(operation, 'inconsistent-base', {
			entityId: located.entity.id,
		});
	}
	return success(
		input,
		{ academicGraph: nextGraph },
		input.index,
		touchSet({ academicPaths: [beforePath] }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			deletedEntity,
		}),
		[],
	);
}

function reduceSetClaimEvidenceRelation(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<
			Operation,
			{ readonly type: 'set-claim-evidence-relation' }
		>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	const replacement = operation.replacement === null
		? null
		: cloneClaimEvidenceRelation(operation.replacement);
	if (replacement === undefined) {
		return failure(operation, 'invalid-operation', {
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		});
	}
	const relations = input.snapshot.academicGraph.claimEvidenceRelations;
	const relationIndex = findRelationIndex(
		relations,
		operation.claimId,
		operation.evidenceId,
	);
	const previousRelation = relationIndex.found
		? relations[relationIndex.index]
		: undefined;
	const actualHash = input.merkleState.getRelationHash(
		operation.claimId,
		operation.evidenceId,
	);
	if (
		(previousRelation === undefined) !== (actualHash === undefined)
	) {
		return failure(operation, 'inconsistent-base', {
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		});
	}
	if (
		(operation.expectedRelationHash === null && previousRelation !== undefined)
		|| (
			operation.expectedRelationHash !== null
			&& (
				previousRelation === undefined
				|| actualHash !== operation.expectedRelationHash
			)
		)
	) {
		return failure(operation, 'hash-mismatch', {
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
			expectedHash: operation.expectedRelationHash,
			actualHash: actualHash ?? null,
		});
	}
	if (
		replacement !== null
		&& (
			replacement.claimId !== operation.claimId
			|| replacement.evidenceId !== operation.evidenceId
		)
	) {
		return failure(operation, 'relation-target-mismatch', {
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		});
	}
	if (
		replacement !== null
		&& (
			findEntityIndex(
				input.snapshot.academicGraph.claims,
				operation.claimId,
			) < 0
			|| findEntityIndex(
				input.snapshot.academicGraph.evidenceLinks,
				operation.evidenceId,
			) < 0
		)
	) {
		return failure(operation, 'dangling-relation', {
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		});
	}

	let nextRelations: readonly ClaimEvidenceRelation[];
	if (replacement === null) {
		nextRelations = previousRelation === undefined
			? relations
			: removeAt(
				relations,
				relationIndex.index,
				input.instrumentation,
				'academic-collection-slots',
			);
	} else {
		nextRelations = previousRelation === undefined
			? insertAt(
				relations,
				relationIndex.index,
				replacement,
				input.instrumentation,
				'academic-collection-slots',
			)
			: replaceAt(
				relations,
				relationIndex.index,
				replacement,
				input.instrumentation,
				'academic-collection-slots',
			);
	}
	const nextGraph: AcademicGraphSnapshot = Object.freeze({
		referenceSnapshots: input.snapshot.academicGraph.referenceSnapshots,
		evidenceLinks: input.snapshot.academicGraph.evidenceLinks,
		claims: input.snapshot.academicGraph.claims,
		claimEvidenceRelations: nextRelations,
	});
	const academicPaths: IOperationTouchedAcademicPath[] = [];
	if (previousRelation !== undefined) {
		academicPaths.push(Object.freeze({
			phase: 'before',
			collection: 'claimEvidenceRelations',
			index: relationIndex.index,
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		}));
	}
	if (replacement !== null) {
		academicPaths.push(Object.freeze({
			phase: 'after',
			collection: 'claimEvidenceRelations',
			index: relationIndex.index,
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		}));
	}
	const capturedPreviousRelation = previousRelation === undefined
		? null
		: cloneClaimEvidenceRelation(previousRelation);
	if (capturedPreviousRelation === undefined) {
		return failure(operation, 'inconsistent-base', {
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
		});
	}
	return success(
		input,
		{ academicGraph: nextGraph },
		input.index,
		touchSet({ academicPaths }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			claimId: operation.claimId,
			evidenceId: operation.evidenceId,
			previousRelation: capturedPreviousRelation,
		}),
		[],
	);
}

function reduceSetMetadata(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'set-metadata' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	if (input.merkleState.metadataHash !== operation.expectedMetadataHash) {
		return failure(operation, 'hash-mismatch', {
			expectedHash: operation.expectedMetadataHash,
			actualHash: input.merkleState.metadataHash,
		});
	}
	const metadata = cloneMetadata(operation.metadata);
	const previousMetadata = cloneMetadata(input.snapshot.metadata);
	if (metadata === undefined || previousMetadata === undefined) {
		return failure(operation, 'invalid-operation');
	}
	return success(
		input,
		{ metadata },
		input.index,
		touchSet({ metadata: true }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			previousMetadata,
		}),
		[],
	);
}

function reduceSetSettings(
	input: ICapturedReduceManuscriptOperationInput & {
		readonly operation: Extract<Operation, { readonly type: 'set-settings' }>;
	},
): ReduceManuscriptOperationResult {
	const { operation } = input;
	if (input.merkleState.settingsHash !== operation.expectedSettingsHash) {
		return failure(operation, 'hash-mismatch', {
			expectedHash: operation.expectedSettingsHash,
			actualHash: input.merkleState.settingsHash,
		});
	}
	const settings = cloneSettings(operation.settings);
	const previousSettings = cloneSettings(input.snapshot.settings);
	if (settings === undefined || previousSettings === undefined) {
		return failure(operation, 'invalid-operation');
	}
	return success(
		input,
		{ settings },
		input.index,
		touchSet({ settings: true }),
		freezeOperationCapture({
			operationId: operation.id,
			type: operation.type,
			previousSettings,
		}),
		[],
	);
}

interface IDocumentContentChanges {
	readonly metadata?: ManuscriptMetadata;
	readonly root?: ManuscriptNode;
	readonly academicGraph?: AcademicGraphSnapshot;
	readonly settings?: DocumentSemanticSettings;
}

interface ITouchSetSource {
	readonly nodePaths?: readonly IOperationTouchedNodePath[];
	readonly academicPaths?: readonly IOperationTouchedAcademicPath[];
	readonly normalizationParentNodeIds?: readonly NodeId[];
	readonly metadata?: boolean;
	readonly settings?: boolean;
}

interface ILocatedAcademicEntity {
	readonly collection: Exclude<AcademicCollectionName, 'claimEvidenceRelations'>;
	readonly index: number;
	readonly entity: AcademicEntity;
}

interface IRelationIndex {
	readonly found: boolean;
	readonly index: number;
}

function success(
	input: ICapturedReduceManuscriptOperationInput,
	changes: IDocumentContentChanges,
	index: DocumentIndex,
	operationTouchSet: IManuscriptOperationTouchSet,
	capture: ManuscriptOperationCapture,
	positionMapFragments: readonly PositionMapFragment[],
): ReduceManuscriptOperationResult {
	const { snapshot } = input;
	const content: DocumentContent = Object.freeze({
		format: snapshot.format,
		formatVersion: snapshot.formatVersion,
		schemaId: snapshot.schemaId,
		schemaVersion: snapshot.schemaVersion,
		metadata: changes.metadata ?? snapshot.metadata,
		root: changes.root ?? snapshot.root,
		academicGraph: changes.academicGraph ?? snapshot.academicGraph,
		settings: changes.settings ?? snapshot.settings,
	});
	const frozenPositionMapFragments = Object.freeze([
		...positionMapFragments,
	]);
	const transition = Object.freeze(
		Object.create(null),
	) as ManuscriptOperationTransition;
	const record: IManuscriptOperationTransitionRecord = Object.freeze({
		resource: input.resource,
		canonicalResource: input.resource.toString(),
		summaryOperationId: input.operation.id,
		summaryOperationType: input.operation.type,
		summaryPreviousRevisionId: snapshot.revisionId,
		summaryPreviousDocumentHash: snapshot.documentHash,
		operation: input.operation,
		previousSnapshot: snapshot,
		previousIndex: input.index,
		previousMerkleState: input.merkleState,
		limits: input.limits,
		nextContent: content,
		nextIndex: index,
		touchSet: operationTouchSet,
		capture,
		positionMapFragments: frozenPositionMapFragments,
	});
	manuscriptOperationTransitionRecords.set(transition, record);
	return Object.freeze({
		type: 'ok',
		value: transition,
	});
}

function failure(
	operation: Operation,
	reason: ManuscriptOperationReducerFailureReason,
	data: Omit<
		IManuscriptOperationReducerFailure,
		'reason' | 'operationId'
	> = {},
): ReduceManuscriptOperationResult {
	return Object.freeze({
		type: 'error',
		error: Object.freeze({
			reason,
			operationId: operation.id,
			...data,
		}),
	});
}

function captureLimits(
	limits: IManuscriptOperationReducerLimits | undefined,
): IManuscriptOperationReducerLimits | undefined {
	const source = limits ?? defaultManuscriptOperationReducerLimits;
	return (
		Number.isSafeInteger(source.maximumNodes)
		&& source.maximumNodes >= 1
		&& Number.isSafeInteger(source.maximumDepth)
		&& source.maximumDepth >= 0
	)
		? Object.freeze({
			maximumNodes: source.maximumNodes,
			maximumDepth: source.maximumDepth,
		})
		: undefined;
}

function validateBase(
	input: IReduceManuscriptOperationInput,
	limits: IManuscriptOperationReducerLimits,
): ReduceManuscriptOperationResult | undefined {
	if (
		input.snapshot.documentHash !== input.merkleState.documentHash
		|| input.snapshot.root.id !== input.index.rootNodeId
		|| input.index.getNode(input.snapshot.root.id) !== input.snapshot.root
		|| input.index.nodeCount !== input.merkleState.nodeCount
		|| input.index.nodeCount > limits.maximumNodes
		|| countAcademicEntities(input.snapshot.academicGraph)
			!== input.merkleState.entityCount
		|| input.snapshot.academicGraph.claimEvidenceRelations.length
			!== input.merkleState.relationCount
	) {
		return failure(input.operation, 'inconsistent-base');
	}
	return undefined;
}

function validateNodeHash(
	input: IReduceManuscriptOperationInput,
	nodeId: NodeId,
	expectedHash: ContentHash,
): ReduceManuscriptOperationResult | undefined {
	const actualHash = input.merkleState.getNodeHash(nodeId);
	if (actualHash === undefined) {
		return failure(input.operation, 'inconsistent-base', { nodeId });
	}
	return actualHash === expectedHash
		? undefined
		: failure(input.operation, 'hash-mismatch', {
			nodeId,
			expectedHash,
			actualHash,
		});
}

function validateEntityHash(
	input: IReduceManuscriptOperationInput,
	entityId: EntityId,
	expectedHash: ContentHash,
): ReduceManuscriptOperationResult | undefined {
	const actualHash = input.merkleState.getEntityHash(entityId);
	if (actualHash === undefined) {
		return failure(input.operation, 'inconsistent-base', { entityId });
	}
	return actualHash === expectedHash
		? undefined
		: failure(input.operation, 'hash-mismatch', {
			entityId,
			expectedHash,
			actualHash,
		});
}

function getTextTarget(
	input: IReduceManuscriptOperationInput,
	nodeId: NodeId,
	expectedHash: ContentHash,
):
	| {
		readonly type: 'ok';
		readonly value: TextNode;
	}
	| Extract<ReduceManuscriptOperationResult, { readonly type: 'error' }> {
	const node = input.index.getNode(nodeId);
	if (node === undefined) {
		return failure(input.operation, 'node-not-found', {
			nodeId,
		}) as Extract<ReduceManuscriptOperationResult, { readonly type: 'error' }>;
	}
	if (node.type !== 'text') {
		return failure(input.operation, 'invalid-text-target', {
			nodeId,
		}) as Extract<ReduceManuscriptOperationResult, { readonly type: 'error' }>;
	}
	const hashFailure = validateNodeHash(input, nodeId, expectedHash);
	return hashFailure === undefined
		? { type: 'ok', value: node }
		: hashFailure as Extract<
			ReduceManuscriptOperationResult,
			{ readonly type: 'error' }
		>;
}

function validateTextRange(
	operation: Operation,
	value: string,
	start: number,
	end: number,
): ReduceManuscriptOperationResult | undefined {
	if (
		!Number.isSafeInteger(start)
		|| !Number.isSafeInteger(end)
		|| start < 0
		|| start > end
		|| end > value.length
	) {
		return failure(operation, 'invalid-text-offset');
	}
	if (!isUtf16Boundary(value, start) || !isUtf16Boundary(value, end)) {
		return failure(operation, 'invalid-text-boundary');
	}
	return undefined;
}

function isUtf16Boundary(value: string, offset: number): boolean {
	if (offset <= 0 || offset >= value.length) {
		return true;
	}
	const previous = value.charCodeAt(offset - 1);
	const next = value.charCodeAt(offset);
	return !(
		previous >= 0xD800
		&& previous <= 0xDBFF
		&& next >= 0xDC00
		&& next <= 0xDFFF
	);
}

function replaceTextNode(
	input: ICapturedReduceManuscriptOperationInput,
	before: TextNode,
	after: TextNode,
	capture: ManuscriptOperationCapture,
	fragments: readonly PositionMapFragment[],
	normalizeParent: boolean,
): ReduceManuscriptOperationResult {
	const nextRoot = replaceNodeAtPath(
		input.snapshot.root,
		input.index,
		before.id,
		after,
		input.instrumentation,
	);
	const nextIndex = createPayloadUpdatedIndex(
		input.index,
		nextRoot,
		before.id,
		input.instrumentation,
	);
	if (nextIndex === undefined) {
		return failure(input.operation, 'index-update-failed', {
			nodeId: before.id,
		});
	}
	const beforePath = touchedNodePath('before', input.index, before.id);
	const afterPath = touchedNodePath('after', nextIndex, after.id);
	if (beforePath === undefined || afterPath === undefined) {
		return failure(input.operation, 'index-update-failed', {
			nodeId: before.id,
		});
	}
	const parentLocation = input.index.getParentLocation(before.id);
	const normalizationParentNodeIds = (
		normalizeParent
		&& parentLocation !== undefined
	)
		? [parentLocation.parentNodeId]
		: [];
	return success(
		input,
		{ root: nextRoot },
		nextIndex,
		touchSet({
			nodePaths: [beforePath, afterPath],
			normalizationParentNodeIds,
		}),
		capture,
		fragments,
	);
}

type PersistentOverlayEntry<T> =
	| {
		readonly kind: 'value';
		readonly value: T;
	}
	| {
		readonly kind: 'deleted';
	};

interface IPersistentStringTrieNode<T> {
	readonly entry?: PersistentOverlayEntry<T>;
	readonly children: ReadonlyMap<string, IPersistentStringTrieNode<T>>;
}

const emptyPersistentStringTrieNode: IPersistentStringTrieNode<never> =
	Object.freeze({
		children: new Map(),
	});

class PersistentStringTrie<T> {
	private constructor(
		private readonly root: IPersistentStringTrieNode<T>,
		readonly valueEntryCount: number,
		readonly tombstoneEntryCount: number,
	) {
		Object.freeze(this);
	}

	static empty<T>(): PersistentStringTrie<T> {
		return new PersistentStringTrie<T>(
			emptyPersistentStringTrieNode as IPersistentStringTrieNode<T>,
			0,
			0,
		);
	}

	get(key: string): PersistentOverlayEntry<T> | undefined {
		let node = this.root;
		for (let index = 0; index < key.length; index += 1) {
			const character = key[index];
			if (character === undefined) {
				return undefined;
			}
			const child = node.children.get(character);
			if (child === undefined) {
				return undefined;
			}
			node = child;
		}
		return node.entry;
	}

	set(
		key: string,
		entry: PersistentOverlayEntry<T>,
		instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
		copyKind: ManuscriptOperationReducerShallowCopyKind,
	): PersistentStringTrie<T> {
		const previous = this.get(key);
		return new PersistentStringTrie(
			setPersistentStringTrieEntry(
				this.root,
				key,
				0,
				entry,
				instrumentation,
				copyKind,
			),
			this.valueEntryCount
				- (previous?.kind === 'value' ? 1 : 0)
				+ (entry.kind === 'value' ? 1 : 0),
			this.tombstoneEntryCount
				- (previous?.kind === 'deleted' ? 1 : 0)
				+ (entry.kind === 'deleted' ? 1 : 0),
		);
	}

	unset(
		key: string,
		instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
		copyKind: ManuscriptOperationReducerShallowCopyKind,
	): PersistentStringTrie<T> {
		const previous = this.get(key);
		if (previous === undefined) {
			return this;
		}
		return new PersistentStringTrie(
			unsetPersistentStringTrieEntry(
				this.root,
				key,
				0,
				instrumentation,
				copyKind,
			) ?? emptyPersistentStringTrieNode as IPersistentStringTrieNode<T>,
			this.valueEntryCount - (previous.kind === 'value' ? 1 : 0),
			this.tombstoneEntryCount - (previous.kind === 'deleted' ? 1 : 0),
		);
	}
}

function setPersistentStringTrieEntry<T>(
	node: IPersistentStringTrieNode<T>,
	key: string,
	index: number,
	entry: PersistentOverlayEntry<T>,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
	copyKind: ManuscriptOperationReducerShallowCopyKind,
): IPersistentStringTrieNode<T> {
	if (index === key.length) {
		return Object.freeze({
			entry,
			children: node.children,
		});
	}
	const character = key[index];
	if (character === undefined) {
		throw new Error('A persistent index trie received an invalid key.');
	}
	const child = node.children.get(character)
		?? emptyPersistentStringTrieNode as IPersistentStringTrieNode<T>;
	const nextChild = setPersistentStringTrieEntry(
		child,
		key,
		index + 1,
		entry,
		instrumentation,
		copyKind,
	);
	const children = new Map(node.children);
	instrumentation?.onShallowCopy?.(copyKind, node.children.size);
	children.set(character, nextChild);
	return Object.freeze({
		...(node.entry === undefined ? {} : { entry: node.entry }),
		children,
	});
}

function unsetPersistentStringTrieEntry<T>(
	node: IPersistentStringTrieNode<T>,
	key: string,
	index: number,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
	copyKind: ManuscriptOperationReducerShallowCopyKind,
): IPersistentStringTrieNode<T> | undefined {
	if (index === key.length) {
		if (node.entry === undefined) {
			return node;
		}
		if (node.children.size === 0) {
			return undefined;
		}
		return Object.freeze({
			children: node.children,
		});
	}
	const character = key[index];
	if (character === undefined) {
		throw new Error('A persistent index trie received an invalid key.');
	}
	const child = node.children.get(character);
	if (child === undefined) {
		return node;
	}
	const nextChild = unsetPersistentStringTrieEntry(
		child,
		key,
		index + 1,
		instrumentation,
		copyKind,
	);
	const children = new Map(node.children);
	instrumentation?.onShallowCopy?.(copyKind, node.children.size);
	if (nextChild === undefined) {
		children.delete(character);
	} else {
		children.set(character, nextChild);
	}
	if (node.entry === undefined && children.size === 0) {
		return undefined;
	}
	return Object.freeze({
		...(node.entry === undefined ? {} : { entry: node.entry }),
		children,
	});
}

function persistentValue<T>(value: T): PersistentOverlayEntry<T> {
	return Object.freeze({
		kind: 'value',
		value,
	});
}

const persistentDeleted: PersistentOverlayEntry<never> = Object.freeze({
	kind: 'deleted',
});

interface IVersionedParentLocation {
	readonly location: IDocumentNodeParentLocation;
	readonly parentVersion: number;
}

class LazyPreorderNodeIds {
	private value: readonly NodeId[] | undefined;

	constructor(
		private readonly root: ManuscriptNode | undefined,
		private readonly expectedNodeCount: number,
		private readonly instrumentation:
			| IManuscriptOperationReducerInstrumentation
			| undefined,
		private readonly source?: DocumentIndex,
	) {
	}

	get(): readonly NodeId[] {
		if (this.value !== undefined) {
			return this.value;
		}
		if (this.source !== undefined) {
			this.value = this.source.preorderNodeIds;
			return this.value;
		}
		if (this.root === undefined) {
			throw new Error('A lazy preorder index is missing its document root.');
		}
		const nodeIds: NodeId[] = [];
		const pending: DocumentNode[] = [this.root];
		while (pending.length > 0) {
			const node = pending.pop();
			if (node === undefined) {
				break;
			}
			this.instrumentation?.onNodePayloadRead?.(
				node.id,
				'preorder-materialization',
			);
			nodeIds.push(node.id);
			const children = getDocumentNodeChildren(node);
			for (
				let childIndex = children.length - 1;
				childIndex >= 0;
				childIndex -= 1
			) {
				const child = children[childIndex];
				if (child !== undefined) {
					pending.push(child);
				}
			}
		}
		if (nodeIds.length !== this.expectedNodeCount) {
			throw new Error('A lazy preorder index observed an inconsistent node count.');
		}
		this.value = Object.freeze(nodeIds);
		this.instrumentation?.onPreorderMaterialized?.(nodeIds.length);
		return this.value;
	}
}

class UpdatedDocumentIndex implements DocumentIndex {
	readonly rootNodeId: NodeId;
	readonly nodeCount: number;
	readonly ultimateBase: DocumentIndex;
	readonly nodeOverrides: PersistentStringTrie<DocumentNode>;
	readonly parentOverrides: PersistentStringTrie<IVersionedParentLocation>;
	readonly parentVersions: PersistentStringTrie<number>;
	readonly preorderProvider: LazyPreorderNodeIds;

	private readonly changedParentLocationCache = new Map<
		NodeId,
		ReadonlyMap<NodeId, IDocumentNodeParentLocation>
	>();

	constructor(options: {
		readonly ultimateBase: DocumentIndex;
		readonly nodeOverrides: PersistentStringTrie<DocumentNode>;
		readonly parentOverrides: PersistentStringTrie<IVersionedParentLocation>;
		readonly parentVersions: PersistentStringTrie<number>;
		readonly preorderProvider: LazyPreorderNodeIds;
		readonly nodeCount: number;
		readonly instrumentation?: IManuscriptOperationReducerInstrumentation;
	}) {
		this.ultimateBase = options.ultimateBase;
		this.nodeOverrides = options.nodeOverrides;
		this.parentOverrides = options.parentOverrides;
		this.parentVersions = options.parentVersions;
		this.preorderProvider = options.preorderProvider;
		this.rootNodeId = options.ultimateBase.rootNodeId;
		this.nodeCount = options.nodeCount;
		this.instrumentation = options.instrumentation;
		Object.freeze(this);
	}

	private readonly instrumentation:
		| IManuscriptOperationReducerInstrumentation
		| undefined;

	get preorderNodeIds(): readonly NodeId[] {
		return this.preorderProvider.get();
	}

	hasNode(nodeId: NodeId): boolean {
		const entry = this.nodeOverrides.get(nodeId);
		return entry === undefined
			? this.ultimateBase.hasNode(nodeId)
			: entry.kind === 'value';
	}

	getNode(nodeId: NodeId): DocumentNode | undefined {
		const entry = this.nodeOverrides.get(nodeId);
		return entry === undefined
			? this.ultimateBase.getNode(nodeId)
			: entry.kind === 'value'
				? entry.value
				: undefined;
	}

	getParentLocation(
		nodeId: NodeId,
	): IDocumentNodeParentLocation | undefined {
		if (nodeId === this.rootNodeId || !this.hasNode(nodeId)) {
			return undefined;
		}
		const overrideEntry = this.parentOverrides.get(nodeId);
		const override = overrideEntry?.kind === 'value'
			? overrideEntry.value
			: undefined;
		const baseLocation = this.ultimateBase.getParentLocation(nodeId);
		const parentNodeId = override?.location.parentNodeId
			?? baseLocation?.parentNodeId;
		if (parentNodeId === undefined) {
			return undefined;
		}
		const parentVersionEntry = this.parentVersions.get(parentNodeId);
		const parentVersion = parentVersionEntry?.kind === 'value'
			? parentVersionEntry.value
			: 0;
		if (
			override !== undefined
			&& override.parentVersion === parentVersion
		) {
			return override.location;
		}
		if (override === undefined && parentVersion === 0) {
			return baseLocation;
		}
		return this.getChangedParentLocations(parentNodeId).get(nodeId);
	}

	iteratePath(nodeId: NodeId): IterableIterator<NodeId> | undefined {
		const path = this.collectPath(nodeId);
		return path?.[Symbol.iterator]();
	}

	iterateAncestors(nodeId: NodeId): IterableIterator<NodeId> | undefined {
		const path = this.collectPath(nodeId);
		return path === undefined
			? undefined
			: path.slice(0, -1).reverse()[Symbol.iterator]();
	}

	private collectPath(nodeId: NodeId): readonly NodeId[] | undefined {
		if (!this.hasNode(nodeId)) {
			return undefined;
		}
		const reversed: NodeId[] = [];
		const seen = new Set<NodeId>();
		let currentNodeId = nodeId;
		while (true) {
			if (seen.has(currentNodeId) || reversed.length > this.nodeCount) {
				return undefined;
			}
			seen.add(currentNodeId);
			reversed.push(currentNodeId);
			if (currentNodeId === this.rootNodeId) {
				break;
			}
			const parentNodeId = this.getParentNodeId(currentNodeId);
			if (parentNodeId === undefined || !this.hasNode(parentNodeId)) {
				return undefined;
			}
			currentNodeId = parentNodeId;
		}
		reversed.reverse();
		return Object.freeze(reversed);
	}

	private getParentNodeId(nodeId: NodeId): NodeId | undefined {
		const entry = this.parentOverrides.get(nodeId);
		return (
			entry?.kind === 'value'
				? entry.value.location.parentNodeId
				: undefined
		) ?? this.ultimateBase.getParentLocation(nodeId)?.parentNodeId;
	}

	private getChangedParentLocations(
		parentNodeId: NodeId,
	): ReadonlyMap<NodeId, IDocumentNodeParentLocation> {
		const cached = this.changedParentLocationCache.get(parentNodeId);
		if (cached !== undefined) {
			return cached;
		}
		const locations = new Map<NodeId, IDocumentNodeParentLocation>();
		const parent = this.getNode(parentNodeId);
		if (parent !== undefined && nodeOwnsChildren(parent)) {
			for (
				let childIndex = 0;
				childIndex < parent.children.length;
				childIndex += 1
			) {
				const child = parent.children[childIndex];
				if (child !== undefined) {
					this.instrumentation?.onNodePayloadRead?.(
						child.id,
						'changed-parent-lookup',
					);
					locations.set(child.id, Object.freeze({
						parentNodeId,
						childIndex,
					}));
				}
			}
		}
		this.changedParentLocationCache.set(parentNodeId, locations);
		return locations;
	}
}

interface IDocumentIndexUpdate {
	readonly nodeOverrides: ReadonlyMap<NodeId, DocumentNode>;
	readonly parentLocations?: ReadonlyMap<
		NodeId,
		IDocumentNodeParentLocation
	>;
	readonly changedParentNodeIds?: readonly NodeId[];
	readonly removedNodeIds?: readonly NodeId[];
	readonly nodeCount: number;
	readonly topologyChanged: boolean;
}

function createUpdatedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	update: IDocumentIndexUpdate,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex {
	const previous = base instanceof UpdatedDocumentIndex ? base : undefined;
	const ultimateBase = previous?.ultimateBase ?? base;
	let nodeOverrides = previous?.nodeOverrides
		?? PersistentStringTrie.empty<DocumentNode>();
	let parentOverrides = previous?.parentOverrides
		?? PersistentStringTrie.empty<IVersionedParentLocation>();
	let parentVersions = previous?.parentVersions
		?? PersistentStringTrie.empty<number>();
	for (const nodeId of update.removedNodeIds ?? []) {
		if (ultimateBase.hasNode(nodeId)) {
			nodeOverrides = nodeOverrides.set(
				nodeId,
				persistentDeleted,
				instrumentation,
				'index-node-overrides',
			);
		} else {
			nodeOverrides = nodeOverrides.unset(
				nodeId,
				instrumentation,
				'index-node-overrides',
			);
			parentVersions = parentVersions.unset(
				nodeId,
				instrumentation,
				'index-parent-versions',
			);
		}
		parentOverrides = parentOverrides.unset(
			nodeId,
			instrumentation,
			'index-parent-overrides',
		);
	}
	for (const parentNodeId of update.changedParentNodeIds ?? []) {
		const currentEntry = parentVersions.get(parentNodeId);
		const currentVersion = currentEntry?.kind === 'value'
			? currentEntry.value
			: 0;
		parentVersions = parentVersions.set(
			parentNodeId,
			persistentValue(currentVersion + 1),
			instrumentation,
			'index-parent-versions',
		);
	}
	for (const [nodeId, node] of update.nodeOverrides) {
		nodeOverrides = nodeOverrides.set(
			nodeId,
			persistentValue(node),
			instrumentation,
			'index-node-overrides',
		);
	}
	for (const [nodeId, location] of update.parentLocations ?? []) {
		const parentVersionEntry = parentVersions.get(location.parentNodeId);
		const parentVersion = parentVersionEntry?.kind === 'value'
			? parentVersionEntry.value
			: 0;
		parentOverrides = parentOverrides.set(
			nodeId,
			persistentValue(Object.freeze({
				location: Object.freeze({
					parentNodeId: location.parentNodeId,
					childIndex: location.childIndex,
				}),
				parentVersion,
			})),
			instrumentation,
			'index-parent-overrides',
		);
	}
	instrumentation?.onIndexOverlayCardinality?.(
		'nodes',
		nodeOverrides.valueEntryCount,
		nodeOverrides.tombstoneEntryCount,
	);
	instrumentation?.onIndexOverlayCardinality?.(
		'parents',
		parentOverrides.valueEntryCount,
		parentOverrides.tombstoneEntryCount,
	);
	instrumentation?.onIndexOverlayCardinality?.(
		'parent-versions',
		parentVersions.valueEntryCount,
		parentVersions.tombstoneEntryCount,
	);
	const preorderProvider = update.topologyChanged
		? new LazyPreorderNodeIds(
			root,
			update.nodeCount,
			instrumentation,
		)
		: previous?.preorderProvider
			?? new LazyPreorderNodeIds(
				undefined,
				update.nodeCount,
				instrumentation,
				base,
			);
	return new UpdatedDocumentIndex({
		ultimateBase,
		nodeOverrides,
		parentOverrides,
		parentVersions,
		preorderProvider,
		nodeCount: update.nodeCount,
		instrumentation,
	});
}

function createInsertedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	childIndex: number,
	insertedNode: InsertableNode,
	insertedNodeIds: readonly [NodeId, ...NodeId[]],
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>();
	addInsertedSubtree(
		insertedNode,
		nodeOverrides,
		parentLocations,
		instrumentation,
	);
	parentLocations.set(insertedNode.id, Object.freeze({
		parentNodeId,
		childIndex,
	}));
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		changedParentNodeIds: [parentNodeId],
		nodeCount: base.nodeCount + insertedNodeIds.length,
		topologyChanged: true,
	}, instrumentation);
}

function createDeletedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	deletedNodeIds: readonly [NodeId, ...NodeId[]],
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		changedParentNodeIds: [parentNodeId],
		removedNodeIds: deletedNodeIds,
		nodeCount: base.nodeCount - deletedNodeIds.length,
		topologyChanged: true,
	}, instrumentation);
}

function createSplitDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	left: TextNode,
	right: TextNode,
	leftChildIndex: number,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	nodeOverrides.set(left.id, left);
	nodeOverrides.set(right.id, right);
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>([
		[left.id, Object.freeze({
			parentNodeId,
			childIndex: leftChildIndex,
		})],
		[right.id, Object.freeze({
			parentNodeId,
			childIndex: leftChildIndex + 1,
		})],
	]);
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		changedParentNodeIds: [parentNodeId],
		nodeCount: base.nodeCount + 1,
		topologyChanged: true,
	}, instrumentation);
}

function createJoinDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	parentNodeId: NodeId,
	left: TextNode,
	rightNodeId: NodeId,
	leftChildIndex: number,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[parentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	nodeOverrides.set(left.id, left);
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>([
		[left.id, Object.freeze({
			parentNodeId,
			childIndex: leftChildIndex,
		})],
	]);
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		changedParentNodeIds: [parentNodeId],
		removedNodeIds: [rightNodeId],
		nodeCount: base.nodeCount - 1,
		topologyChanged: true,
	}, instrumentation);
}

function createMovedDocumentIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	sourceParentNodeId: NodeId,
	destinationParentNodeId: NodeId,
	destinationChildIndexAfterRemoval: number,
	movedNodeIds: readonly [NodeId, ...NodeId[]],
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		sourceParentNodeId === destinationParentNodeId
			? [sourceParentNodeId]
			: [sourceParentNodeId, destinationParentNodeId],
		instrumentation,
	);
	if (nodeOverrides === undefined) {
		return undefined;
	}
	const finalDestinationParent = nodeOverrides.get(destinationParentNodeId);
	if (
		finalDestinationParent === undefined
		|| !nodeOwnsChildren(finalDestinationParent)
		|| finalDestinationParent.children[
			destinationChildIndexAfterRemoval
		]?.id !== movedNodeIds[0]
	) {
		return undefined;
	}
	const parentLocations = new Map<NodeId, IDocumentNodeParentLocation>([
		[movedNodeIds[0], Object.freeze({
			parentNodeId: destinationParentNodeId,
			childIndex: destinationChildIndexAfterRemoval,
		})],
	]);
	return createUpdatedDocumentIndex(base, root, {
		nodeOverrides,
		parentLocations,
		changedParentNodeIds: sourceParentNodeId === destinationParentNodeId
			? [sourceParentNodeId]
			: [sourceParentNodeId, destinationParentNodeId],
		nodeCount: base.nodeCount,
		topologyChanged: true,
	}, instrumentation);
}

function collectExistingPathOverrides(
	root: ManuscriptNode,
	base: DocumentIndex,
	nodeIds: readonly NodeId[],
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): Map<NodeId, DocumentNode> | undefined {
	const overrides = new Map<NodeId, DocumentNode>();
	for (const nodeId of nodeIds) {
		const pathIterator = base.iteratePath(nodeId);
		if (pathIterator === undefined) {
			return undefined;
		}
		const path = [...pathIterator];
		if (path.length === 0 || path[0] !== root.id) {
			return undefined;
		}
		let current: DocumentNode = root;
		for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
			const expectedNodeId = path[pathIndex];
			if (expectedNodeId === undefined || current.id !== expectedNodeId) {
				return undefined;
			}
			instrumentation?.onNodePayloadRead?.(current.id, 'changed-path');
			overrides.set(current.id, current);
			const nextNodeId = path[pathIndex + 1];
			if (nextNodeId === undefined) {
				continue;
			}
			const children = getDocumentNodeChildren(current);
			let nextNode: DocumentNode | undefined;
			for (const child of children) {
				instrumentation?.onNodePayloadRead?.(child.id, 'changed-path');
				if (child.id === nextNodeId) {
					nextNode = child;
					break;
				}
			}
			if (nextNode === undefined) {
				return undefined;
			}
			current = nextNode;
		}
	}
	return overrides;
}

function addInsertedSubtree(
	root: DocumentNode,
	nodeOverrides: Map<NodeId, DocumentNode>,
	parentLocations: Map<NodeId, IDocumentNodeParentLocation>,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): void {
	const pending: DocumentNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) {
			break;
		}
		instrumentation?.onNodePayloadRead?.(node.id, 'affected-subtree');
		nodeOverrides.set(node.id, node);
		const children = getDocumentNodeChildren(node);
		for (
			let childIndex = children.length - 1;
			childIndex >= 0;
			childIndex -= 1
		) {
			const child = children[childIndex];
			if (child !== undefined) {
				parentLocations.set(child.id, Object.freeze({
					parentNodeId: node.id,
					childIndex,
				}));
				pending.push(child);
			}
		}
	}
}

function subtreeMaximumRelativeDepth(root: DocumentNode): number {
	let maximumDepth = 0;
	const pending: {
		readonly node: DocumentNode;
		readonly depth: number;
	}[] = [{ node: root, depth: 0 }];
	while (pending.length > 0) {
		const item = pending.pop();
		if (item === undefined) {
			break;
		}
		maximumDepth = Math.max(maximumDepth, item.depth);
		const children = getDocumentNodeChildren(item.node);
		for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
			const child = children[childIndex];
			if (child !== undefined) {
				pending.push({
					node: child,
					depth: item.depth + 1,
				});
			}
		}
	}
	return maximumDepth;
}

function nodeDepth(index: DocumentIndex, nodeId: NodeId): number | undefined {
	const path = index.iteratePath(nodeId);
	if (path === undefined) {
		return undefined;
	}
	let count = 0;
	for (const _nodeId of path) {
		count += 1;
	}
	return count - 1;
}


function createPayloadUpdatedIndex(
	base: DocumentIndex,
	root: ManuscriptNode,
	targetNodeId: NodeId,
	instrumentation: IManuscriptOperationReducerInstrumentation | undefined,
): DocumentIndex | undefined {
	const nodeOverrides = collectExistingPathOverrides(
		root,
		base,
		[targetNodeId],
		instrumentation,
	);
	return nodeOverrides === undefined
		? undefined
		: createUpdatedDocumentIndex(base, root, {
			nodeOverrides,
			nodeCount: base.nodeCount,
			topologyChanged: false,
		}, instrumentation);
}

function replaceNodeAtPath(
	root: ManuscriptNode,
	index: DocumentIndex,
	nodeId: NodeId,
	replacement: DocumentNode,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
): ManuscriptNode {
	const pathIterator = index.iteratePath(nodeId);
	if (pathIterator === undefined) {
		throw new Error('Cannot replace a node outside the trusted DocumentIndex.');
	}
	const path = [...pathIterator];
	let current = replacement;
	for (let pathIndex = path.length - 2; pathIndex >= 0; pathIndex -= 1) {
		const parentId = path[pathIndex];
		const childId = path[pathIndex + 1];
		if (parentId === undefined || childId === undefined) {
			throw new Error('Cannot rebuild an incomplete document path.');
		}
		const parent = index.getNode(parentId);
		const location = index.getParentLocation(childId);
		if (
			parent === undefined
			|| !nodeOwnsChildren(parent)
			|| location === undefined
			|| location.parentNodeId !== parentId
		) {
			throw new Error('Cannot rebuild an inconsistent document path.');
		}
		current = cloneNodeWithChildren(
			parent,
			replaceAt(
				parent.children as readonly DocumentNode[],
					location.childIndex,
					current,
					instrumentation,
					'document-child-slots',
				),
		);
	}
	if (current.type !== 'manuscript' || current.id !== root.id) {
		throw new Error('Document path replacement did not produce its root.');
	}
	return current;
}

function findNodeAtExistingPath(
	root: ManuscriptNode,
	index: DocumentIndex,
	nodeId: NodeId,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
): DocumentNode | undefined {
	const nodes = collectNodesAtExistingPath(
		root,
		index,
		nodeId,
		instrumentation,
	);
	return nodes?.[nodes.length - 1];
}

function replaceNodeAtExistingPath(
	root: ManuscriptNode,
	index: DocumentIndex,
	nodeId: NodeId,
	replacement: DocumentNode,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
): ManuscriptNode | undefined {
	if (replacement.id !== nodeId) {
		return undefined;
	}
	const nodes = collectNodesAtExistingPath(
		root,
		index,
		nodeId,
		instrumentation,
	);
	if (nodes === undefined) {
		return undefined;
	}
	let current = replacement;
	for (let pathIndex = nodes.length - 2; pathIndex >= 0; pathIndex -= 1) {
		const parent = nodes[pathIndex];
		const child = nodes[pathIndex + 1];
		if (
			parent === undefined
			|| child === undefined
			|| !nodeOwnsChildren(parent)
		) {
			return undefined;
		}
		let childIndex = -1;
		for (let index = 0; index < parent.children.length; index += 1) {
			if (parent.children[index]?.id === child.id) {
				childIndex = index;
				break;
			}
		}
		if (childIndex < 0) {
			return undefined;
		}
		current = cloneNodeWithChildren(
			parent,
			replaceAt(
				parent.children as readonly DocumentNode[],
					childIndex,
					current,
					instrumentation,
					'document-child-slots',
				),
		);
	}
	return current.type === 'manuscript' && current.id === root.id
		? current
		: undefined;
}

function collectNodesAtExistingPath(
	root: ManuscriptNode,
	index: DocumentIndex,
	nodeId: NodeId,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
): readonly DocumentNode[] | undefined {
	const pathIterator = index.iteratePath(nodeId);
	if (pathIterator === undefined) {
		return undefined;
	}
	const path = [...pathIterator];
	if (path.length === 0 || path[0] !== root.id) {
		return undefined;
	}
	const nodes: DocumentNode[] = [root];
	instrumentation?.onNodePayloadRead?.(root.id, 'changed-path');
	let current: DocumentNode = root;
	for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
		const expectedNodeId = path[pathIndex];
		if (expectedNodeId === undefined) {
			return undefined;
		}
		const children = getDocumentNodeChildren(current);
		let next: DocumentNode | undefined;
		for (const child of children) {
			instrumentation?.onNodePayloadRead?.(child.id, 'changed-path');
			if (child.id === expectedNodeId) {
				next = child;
				break;
			}
		}
		if (next === undefined) {
			return undefined;
		}
		nodes.push(next);
		current = next;
	}
	return nodes;
}

function cloneNodeWithChildren(
	node: DocumentNode,
	children: readonly DocumentNode[],
): DocumentNode {
	if (!nodeOwnsChildren(node)) {
		throw new Error('Cannot attach children to a leaf Manuscript node.');
	}
	return Object.freeze({
		id: node.id,
		type: node.type,
		attrs: node.attrs,
		children,
	}) as DocumentNode;
}

function cloneNodeWithAttributes(
	node: Exclude<DocumentNode, TextNode | ManuscriptNode>,
	attributes: SettableManuscriptNodeAttributes,
): DocumentNode {
	return 'children' in node
		? Object.freeze({
			id: node.id,
			type: node.type,
			attrs: attributes,
			children: node.children,
		}) as DocumentNode
		: Object.freeze({
			id: node.id,
			type: node.type,
			attrs: attributes,
		}) as DocumentNode;
}

function nodeOwnsChildren(
	node: DocumentNode,
): node is Extract<DocumentNode, { readonly children: readonly DocumentNode[] }> {
	return 'children' in node;
}

function insertAt<T>(
	values: readonly T[],
	index: number,
	value: T,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
	copyKind?: ManuscriptOperationReducerShallowCopyKind,
): readonly T[] {
	const result = Object.freeze([
		...values.slice(0, index),
		value,
		...values.slice(index),
	]);
	if (copyKind !== undefined) {
		instrumentation?.onShallowCopy?.(copyKind, result.length);
	}
	return result;
}

function replaceAt<T>(
	values: readonly T[],
	index: number,
	value: T,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
	copyKind?: ManuscriptOperationReducerShallowCopyKind,
): readonly T[] {
	const result = Object.freeze([
		...values.slice(0, index),
		value,
		...values.slice(index + 1),
	]);
	if (copyKind !== undefined) {
		instrumentation?.onShallowCopy?.(copyKind, result.length);
	}
	return result;
}

function removeAt<T>(
	values: readonly T[],
	index: number,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
	copyKind?: ManuscriptOperationReducerShallowCopyKind,
): readonly T[] {
	const result = Object.freeze([
		...values.slice(0, index),
		...values.slice(index + 1),
	]);
	if (copyKind !== undefined) {
		instrumentation?.onShallowCopy?.(copyKind, result.length);
	}
	return result;
}

function collectSubtreeNodeIds(
	root: DocumentNode,
): readonly [NodeId, ...NodeId[]] {
	const nodeIds: NodeId[] = [];
	const pending: DocumentNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) {
			break;
		}
		nodeIds.push(node.id);
		const children = getDocumentNodeChildren(node);
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = children[index];
			if (child !== undefined) {
				pending.push(child);
			}
		}
	}
	if (nodeIds.length === 0) {
		throw new Error('A Manuscript subtree must contain its root.');
	}
	return Object.freeze(nodeIds) as readonly [NodeId, ...NodeId[]];
}

function collectNormalizationParentNodeIds(
	root: DocumentNode,
): readonly NodeId[] {
	const nodeIds: NodeId[] = [];
	const pending: DocumentNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) {
			break;
		}
		const children = getDocumentNodeChildren(node);
		if (children.some(child => child.type === 'text')) {
			nodeIds.push(node.id);
		}
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = children[index];
			if (child !== undefined) {
				pending.push(child);
			}
		}
	}
	return Object.freeze(nodeIds);
}

function isAncestor(
	index: DocumentIndex,
	possibleAncestorId: NodeId,
	nodeId: NodeId,
): boolean {
	const ancestors = index.iterateAncestors(nodeId);
	if (ancestors === undefined) {
		return false;
	}
	for (const ancestorId of ancestors) {
		if (ancestorId === possibleAncestorId) {
			return true;
		}
	}
	return false;
}

function hasLocallyValidChildSequence(
	parentType: NodeKind,
	children: readonly DocumentNode[],
): boolean {
	const types = children.map(child => child.type);
	switch (parentType) {
		case 'bibliographyPlaceholder':
		case 'citation':
		case 'crossReference':
		case 'displayEquation':
		case 'figureAsset':
		case 'footnoteReference':
		case 'hardBreak':
		case 'horizontalRule':
		case 'inlineEquation':
		case 'text':
			return false;
		case 'blockQuote':
		case 'body':
			return types.every(isBlockNodeType);
		case 'codeBlock':
			return types.length <= 1 && types.every(type => type === 'text');
		case 'figure':
			return (
				types.length <= 2
				&& types.every(
					(type, index) => type === (index === 0 ? 'figureAsset' : 'figureCaption'),
				)
			);
		case 'figureCaption':
		case 'heading':
		case 'paragraph':
		case 'tableCaption':
			return types.every(isInlineNodeType);
		case 'footnote':
			return types.every(isFootnoteBlockNodeType);
		case 'frontMatter':
			return types.length === 0;
		case 'list':
			return types.every(type => type === 'listItem');
		case 'listItem':
		case 'tableCell':
			return (
				types.length === 0
				|| (
					types[0] === 'paragraph'
					&& types.slice(1).every(isCellBlockNodeType)
				)
			);
		case 'manuscript':
			return isOrderedUniqueSubset(
				types,
				['frontMatter', 'body', 'bibliographyPlaceholder'],
			);
		case 'section': {
			let headingCount = 0;
			for (let index = 0; index < types.length; index += 1) {
				const type = types[index];
				if (type === 'heading') {
					headingCount += 1;
					if (index !== 0 || headingCount > 1) {
						return false;
					}
				} else if (type === undefined || !isSectionBodyNodeType(type)) {
					return false;
				}
			}
			return true;
		}
		case 'table':
			return types.every((type, index) =>
				type === 'tableRow' || (index === 0 && type === 'tableCaption'));
		case 'tableRow':
			return types.every(type => type === 'tableCell');
	}
}

function isBlockNodeType(type: NodeKind): boolean {
	return type === 'section'
		|| type === 'paragraph'
		|| type === 'heading'
		|| type === 'figure'
		|| type === 'table'
		|| type === 'displayEquation'
		|| type === 'blockQuote'
		|| type === 'codeBlock'
		|| type === 'list'
		|| type === 'horizontalRule'
		|| type === 'footnote';
}

function isSectionBodyNodeType(type: NodeKind): boolean {
	return isBlockNodeType(type) && type !== 'heading';
}

function isInlineNodeType(type: NodeKind): boolean {
	return type === 'text'
		|| type === 'citation'
		|| type === 'crossReference'
		|| type === 'inlineEquation'
		|| type === 'footnoteReference'
		|| type === 'hardBreak';
}

function isFootnoteBlockNodeType(type: NodeKind): boolean {
	return type === 'paragraph'
		|| type === 'blockQuote'
		|| type === 'codeBlock'
		|| type === 'list';
}

function isCellBlockNodeType(type: NodeKind): boolean {
	return type === 'paragraph' || isFootnoteBlockNodeType(type);
}

function isOrderedUniqueSubset(
	values: readonly NodeKind[],
	order: readonly NodeKind[],
): boolean {
	let previousRank = -1;
	for (const value of values) {
		const rank = order.indexOf(value);
		if (rank <= previousRank) {
			return false;
		}
		previousRank = rank;
	}
	return true;
}

function attributesMatchNodeType(
	type: Exclude<NodeKind, 'text' | 'manuscript'>,
	attributes: SettableManuscriptNodeAttributes,
): boolean {
	const record = attributes as Readonly<Record<string, unknown>>;
	const keys = Object.keys(record);
	switch (type) {
		case 'blockQuote':
		case 'body':
		case 'figureCaption':
		case 'frontMatter':
		case 'hardBreak':
		case 'horizontalRule':
		case 'listItem':
		case 'tableCaption':
		case 'tableCell':
		case 'tableRow':
			return keys.length === 0;
		case 'bibliographyPlaceholder':
			return hasExactKeys(record, ['heading'])
				&& isStringInRange(record['heading'], 0, 1_024);
		case 'citation':
			return isCitationAttributes(record);
		case 'codeBlock':
			return hasOnlyKeys(record, ['language'])
				&& (
					!Object.hasOwn(record, 'language')
					|| isStringInRange(record['language'], 0, 128)
				);
		case 'crossReference':
			return hasOnlyKeys(record, ['targetEntityId', 'label'])
				&& Object.hasOwn(record, 'targetEntityId')
				&& (
					!Object.hasOwn(record, 'label')
					|| isStringInRange(record['label'], 0, 1_024)
				);
		case 'displayEquation':
			return hasOnlyKeys(record, ['source', 'entityId', 'label'])
				&& Object.hasOwn(record, 'source')
				&& isStringInRange(
					record['source'],
					0,
					maximumManuscriptTextUtf16Length,
				)
				&& (
					!Object.hasOwn(record, 'label')
					|| isStringInRange(record['label'], 0, 256)
				);
		case 'figure':
		case 'table':
			return hasOnlyKeys(record, ['entityId', 'label'])
				&& (
					!Object.hasOwn(record, 'label')
					|| isStringInRange(record['label'], 0, 256)
				);
		case 'figureAsset':
			return hasExactKeys(record, ['uri', 'contentHash', 'altText'])
				&& isStringInRange(record['altText'], 0, 10_000);
		case 'footnote':
			return hasOnlyKeys(record, ['label'])
				&& (
					!Object.hasOwn(record, 'label')
					|| isStringInRange(record['label'], 0, 128)
				);
		case 'footnoteReference':
			return hasExactKeys(record, ['footnoteNodeId']);
		case 'heading':
		case 'section':
			return hasExactKeys(record, ['level'])
				&& typeof record['level'] === 'number'
				&& Number.isInteger(record['level'])
				&& record['level'] >= 1
				&& record['level'] <= 6;
		case 'inlineEquation':
			return hasExactKeys(record, ['source'])
				&& isStringInRange(
					record['source'],
					0,
					maximumManuscriptTextUtf16Length,
				);
		case 'list':
			return record['ordered'] === true
				? hasExactKeys(record, ['ordered', 'start'])
					&& typeof record['start'] === 'number'
					&& Number.isSafeInteger(record['start'])
					&& record['start'] >= 1
				: record['ordered'] === false
					&& hasExactKeys(record, ['ordered']);
		case 'paragraph':
			return hasExactKeys(record, ['alignment'])
				&& (
					record['alignment'] === 'start'
					|| record['alignment'] === 'center'
					|| record['alignment'] === 'end'
					|| record['alignment'] === 'justify'
				);
	}
}

function isCitationAttributes(
	attributes: Readonly<Record<string, unknown>>,
): boolean {
	return hasOnlyKeys(
		attributes,
		['citationId', 'referenceId', 'locator', 'prefix', 'suffix'],
	)
		&& Object.hasOwn(attributes, 'citationId')
		&& Object.hasOwn(attributes, 'referenceId')
		&& (
			!Object.hasOwn(attributes, 'prefix')
			|| isStringInRange(attributes['prefix'], 0, 10_000)
		)
		&& (
			!Object.hasOwn(attributes, 'suffix')
			|| isStringInRange(attributes['suffix'], 0, 10_000)
		);
}

function hasExactKeys(
	value: object,
	expected: readonly string[],
): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length
		&& expected.every(key => Object.hasOwn(value, key));
}

function hasOnlyKeys(
	value: object,
	allowed: readonly string[],
): boolean {
	return Object.keys(value).every(key => allowed.includes(key));
}

function isStringInRange(
	value: unknown,
	minimum: number,
	maximum: number,
): value is string {
	return typeof value === 'string'
		&& value.length >= minimum
		&& value.length <= maximum
		&& isWellFormedUnicodeString(value);
}

function cloneInsertableNode(
	node: InsertableNode,
	limits: IManuscriptOperationReducerLimits,
): InsertableNode | undefined {
	const treeLimits = {
		maximumNodes: limits.maximumNodes,
		maximumDepth: limits.maximumDepth,
		maximumCollectionItems:
			operationManuscriptTreeLimits.maximumCollectionItems,
	};
	const encoded = encodeInsertableNodeV1(node, treeLimits);
	if (encoded.type === 'error') {
		return undefined;
	}
	const decoded = decodeInsertableNodeV1(encoded.value, treeLimits);
	return decoded.type === 'ok' ? decoded.value.root : undefined;
}

function cloneAcademicEntity(
	entity: AcademicEntity,
	expectedResource: URI,
): AcademicEntity | undefined {
	const encoded = encodeAcademicEntityV1(entity, expectedResource);
	return encoded === undefined
		? undefined
		: decodeAcademicEntityV1(encoded, expectedResource);
}

function cloneClaimEvidenceRelation(
	relation: ClaimEvidenceRelation,
): ClaimEvidenceRelation | undefined {
	const encoded = encodeClaimEvidenceRelationV1(relation);
	return encoded === undefined
		? undefined
		: decodeClaimEvidenceRelationV1(encoded);
}

function cloneTextNode(node: TextNode): TextNode | undefined {
	const marks = cloneMarks(node.marks);
	return marks === undefined
		? undefined
		: Object.freeze({
			id: node.id,
			type: node.type,
			value: node.value,
			marks,
		});
}

function cloneMarks(marks: readonly Mark[]): readonly Mark[] | undefined {
	const encoded = encodeMarksV1(
		marks,
		operationManuscriptTreeLimits.maximumCollectionItems,
	);
	if (encoded.type === 'error') {
		return undefined;
	}
	const decoded = decodeMarksV1(
		encoded.value,
		operationManuscriptTreeLimits.maximumCollectionItems,
	);
	return decoded.type === 'ok' ? decoded.value : undefined;
}

function cloneNodeAttributes(
	attributes: SettableManuscriptNodeAttributes,
): SettableManuscriptNodeAttributes | undefined {
	const encoded = Object.freeze(cloneCanonicalRuntimeRecord(attributes));
	return encoded as SettableManuscriptNodeAttributes;
}

function cloneCanonicalRuntimeRecord(
	value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const result: Record<string, unknown> = Object.create(Object.prototype);
	for (const key of Object.keys(value)) {
		const item = value[key];
		Object.defineProperty(result, key, {
			value: (
				item !== null
				&& typeof item === 'object'
				&& !Array.isArray(item)
				&& !URI.isUri(item)
			)
				? cloneCanonicalRuntimeRecord(
					item as Readonly<Record<string, unknown>>,
				)
				: item,
			enumerable: true,
			configurable: false,
			writable: false,
		});
	}
	return Object.freeze(result);
}

function cloneMetadata(
	metadata: ManuscriptMetadata,
): ManuscriptMetadata | undefined {
	const encoded = encodeManuscriptMetadataV1(
		metadata,
		operationManuscriptTreeLimits.maximumCollectionItems,
	);
	if (encoded.type === 'error') {
		return undefined;
	}
	const decoded = decodeManuscriptMetadataV1(
		encoded.value,
		operationManuscriptTreeLimits.maximumCollectionItems,
	);
	return decoded.type === 'ok' ? decoded.value.metadata : undefined;
}

function cloneSettings(
	settings: DocumentSemanticSettings,
): DocumentSemanticSettings | undefined {
	const encoded = encodeDocumentSemanticSettingsV1(settings);
	if (encoded.type === 'error') {
		return undefined;
	}
	const decoded = decodeDocumentSemanticSettingsV1(encoded.value);
	return decoded.type === 'ok' ? decoded.value : undefined;
}

function marksEqual(
	left: readonly Mark[],
	right: readonly Mark[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		const leftMark = left[index];
		const rightMark = right[index];
		if (
			leftMark === undefined
			|| rightMark === undefined
			|| leftMark.type !== rightMark.type
		) {
			return false;
		}
		if (
			leftMark.type === 'link'
			&& (
				rightMark.type !== 'link'
				|| !isEqual(leftMark.href, rightMark.href)
				|| leftMark.title !== rightMark.title
			)
		) {
			return false;
		}
	}
	return true;
}

function countAcademicEntities(graph: AcademicGraphSnapshot): number {
	return graph.referenceSnapshots.length
		+ graph.evidenceLinks.length
		+ graph.claims.length;
}

function academicEntityCollection(
	entity: AcademicEntity,
): Exclude<AcademicCollectionName, 'claimEvidenceRelations'> {
	switch (entity.type) {
		case 'reference-snapshot':
			return 'referenceSnapshots';
		case 'evidence-link':
			return 'evidenceLinks';
		case 'claim':
			return 'claims';
	}
}

function findAcademicEntity(
	graph: AcademicGraphSnapshot,
	entityId: EntityId,
): ILocatedAcademicEntity | undefined {
	const referenceIndex = findEntityIndex(graph.referenceSnapshots, entityId);
	if (referenceIndex >= 0) {
		const entity = graph.referenceSnapshots[referenceIndex];
		return entity === undefined
			? undefined
			: {
				collection: 'referenceSnapshots',
				index: referenceIndex,
				entity,
			};
	}
	const evidenceIndex = findEntityIndex(graph.evidenceLinks, entityId);
	if (evidenceIndex >= 0) {
		const entity = graph.evidenceLinks[evidenceIndex];
		return entity === undefined
			? undefined
			: {
				collection: 'evidenceLinks',
				index: evidenceIndex,
				entity,
			};
	}
	const claimIndex = findEntityIndex(graph.claims, entityId);
	if (claimIndex >= 0) {
		const entity = graph.claims[claimIndex];
		return entity === undefined
			? undefined
			: {
				collection: 'claims',
				index: claimIndex,
				entity,
			};
	}
	return undefined;
}

function findEntityIndex(
	values: readonly AcademicEntity[],
	entityId: EntityId,
): number {
	const insertionIndex = findEntityInsertionIndex(values, entityId);
	return values[insertionIndex]?.id === entityId ? insertionIndex : -1;
}

function findEntityInsertionIndex(
	values: readonly AcademicEntity[],
	entityId: EntityId,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const middleId = values[middle]?.id;
		if (middleId !== undefined && middleId < entityId) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function replaceAcademicCollection(
	graph: AcademicGraphSnapshot,
	collection: Exclude<AcademicCollectionName, 'claimEvidenceRelations'>,
	values: readonly AcademicEntity[],
): AcademicGraphSnapshot {
	switch (collection) {
		case 'referenceSnapshots':
			return Object.freeze({
				referenceSnapshots: values as AcademicGraphSnapshot['referenceSnapshots'],
				evidenceLinks: graph.evidenceLinks,
				claims: graph.claims,
				claimEvidenceRelations: graph.claimEvidenceRelations,
			});
		case 'evidenceLinks':
			return Object.freeze({
				referenceSnapshots: graph.referenceSnapshots,
				evidenceLinks: values as AcademicGraphSnapshot['evidenceLinks'],
				claims: graph.claims,
				claimEvidenceRelations: graph.claimEvidenceRelations,
			});
		case 'claims':
			return Object.freeze({
				referenceSnapshots: graph.referenceSnapshots,
				evidenceLinks: graph.evidenceLinks,
				claims: values as AcademicGraphSnapshot['claims'],
				claimEvidenceRelations: graph.claimEvidenceRelations,
			});
	}
}

function findRelationIndex(
	values: readonly ClaimEvidenceRelation[],
	claimId: EntityId,
	evidenceId: EntityId,
): IRelationIndex {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const relation = values[middle];
		if (
			relation !== undefined
			&& compareRelationKey(
				relation.claimId,
				relation.evidenceId,
				claimId,
				evidenceId,
			) < 0
		) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	const relation = values[low];
	return Object.freeze({
		found: relation?.claimId === claimId && relation.evidenceId === evidenceId,
		index: low,
	});
}

function compareRelationKey(
	leftClaimId: EntityId,
	leftEvidenceId: EntityId,
	rightClaimId: EntityId,
	rightEvidenceId: EntityId,
): number {
	if (leftClaimId !== rightClaimId) {
		return leftClaimId < rightClaimId ? -1 : 1;
	}
	return leftEvidenceId === rightEvidenceId
		? 0
		: leftEvidenceId < rightEvidenceId
			? -1
			: 1;
}

function touchedNodePath(
	phase: IOperationTouchedNodePath['phase'],
	index: DocumentIndex,
	nodeId: NodeId,
): IOperationTouchedNodePath | undefined {
	const iterator = index.iteratePath(nodeId);
	if (iterator === undefined) {
		return undefined;
	}
	const path = [...iterator];
	if (path.length === 0) {
		return undefined;
	}
	const childIndexes: number[] = [];
	for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
		const nodeIdAtPath = path[pathIndex];
		const parentNodeIdAtPath = path[pathIndex - 1];
		if (nodeIdAtPath === undefined || parentNodeIdAtPath === undefined) {
			return undefined;
		}
		const location = index.getParentLocation(nodeIdAtPath);
		if (
			location === undefined
			|| location.parentNodeId !== parentNodeIdAtPath
		) {
			return undefined;
		}
		childIndexes.push(location.childIndex);
	}
	return Object.freeze({
		phase,
		path: Object.freeze(path) as readonly [NodeId, ...NodeId[]],
		childIndexes: Object.freeze(childIndexes),
	});
}

function touchSet(source: ITouchSetSource): IManuscriptOperationTouchSet {
	return Object.freeze({
		nodePaths: Object.freeze([...(source.nodePaths ?? [])]),
		academicPaths: Object.freeze([...(source.academicPaths ?? [])]),
		normalizationParentNodeIds: Object.freeze(
			stableUniqueNodeIds(source.normalizationParentNodeIds ?? []),
		),
		metadata: source.metadata === true,
		settings: source.settings === true,
	});
}

function stableUniqueNodeIds(nodeIds: readonly NodeId[]): readonly NodeId[] {
	const seen = new Set<NodeId>();
	const result: NodeId[] = [];
	for (const nodeId of nodeIds) {
		if (!seen.has(nodeId)) {
			seen.add(nodeId);
			result.push(nodeId);
		}
	}
	return result;
}

function freezeOperationCapture<TCapture extends ManuscriptOperationCapture>(
	capture: TCapture,
): TCapture {
	return Object.freeze(capture);
}
