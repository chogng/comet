/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ContentHash,
	NodeId,
} from 'cs/editor/common/core/identifiers';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import type {
	AcademicEntity,
	AcademicGraphSnapshot,
	ClaimEvidenceRelation,
} from 'cs/editor/common/model/academicGraph';
import type { DocumentIndex } from 'cs/editor/common/model/documentIndex';
import {
	getDocumentNodeChildren,
	type DocumentNode,
	type DocumentSemanticSettings,
	type ManuscriptMetadata,
} from 'cs/editor/common/model/manuscript';
import {
	ManuscriptMerkleVector,
	manuscriptMerkleVectorRoles,
	type IManuscriptStructuralMerkleInstrumentation,
	type ManuscriptMerkleVectorHashCallObserver,
	type ManuscriptMerkleVectorRole,
} from 'cs/editor/common/model/merkleVector';
import type {
	AcademicCollectionName,
	IManuscriptOperationTouchSet,
	IOperationTouchedAcademicPath,
	ManuscriptOperationCapture,
} from 'cs/editor/common/model/operationReducer';
import {
	createAcademicClaimHashPayload,
	createAcademicEvidenceHashPayload,
	createAcademicGraphHashPayload,
	createAcademicReferenceHashPayload,
	createAcademicRelationHashPayload,
	createDocumentMerkleHashPayload,
	createDocumentNodeHashPayload,
	createMerkleVectorDescriptor,
	createMetadataAuthorHashPayload,
	createMetadataKeywordHashPayload,
	createMetadataRootHashPayload,
	createMetadataTextHashPayload,
	createSettingsHashPayload,
	hashRevisionMerklePayload,
	type AcademicEntityHashPayload,
	type RevisionMerkleHashCallObserver,
} from 'cs/editor/common/model/revisionHashPayload';
import {
	createRevisionMerkleState,
	relationStoreKey,
	requireRevisionMerkleStateStores,
	type IRevisionMerkleStateStores,
	type IRevisionMerkleStoreInstrumentation,
	type RevisionMerkleStoreKind,
} from 'cs/editor/common/model/revisionMerkleStateInternal';
import type {
	DocumentContent,
	RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';

export type RevisionMerkleUpdaterNodeReadKind =
	| 'changed-path'
	| 'inserted-subtree'
	| 'deleted-subtree'
	| 'structural-neighbor';

export type RevisionMerkleUpdaterAcademicReadKind =
	| 'structural-target'
	| 'structural-neighbor';

export interface IRevisionMerkleUpdaterInstrumentation
	extends IRevisionMerkleStoreInstrumentation {
	readonly onHashCall?: RevisionMerkleHashCallObserver;
	readonly onNodePayloadRead?: (
		nodeId: NodeId,
		kind: RevisionMerkleUpdaterNodeReadKind,
	) => void;
	/**
	 * Reports direct Academic Graph array payload reads. Merkle-vector Patricia
	 * reads remain reported separately through onStructuralItemRead.
	 */
	readonly onAcademicPayloadRead?: (
		role: ManuscriptMerkleVectorRole,
		kind: RevisionMerkleUpdaterAcademicReadKind,
	) => void;
	readonly onAncestorRehash?: (nodeId: NodeId) => void;
	readonly onStructuralItemRead?: (role: ManuscriptMerkleVectorRole) => void;
	readonly onStructuralTrieNodeVisit?: (
		role: ManuscriptMerkleVectorRole,
	) => void;
	readonly onStructuralTrieNodeCopy?: (
		role: ManuscriptMerkleVectorRole,
	) => void;
	readonly onStoreCardinality?: (
		kind: RevisionMerkleStoreKind,
		size: number,
	) => void;
}

export interface IUpdateRevisionMerkleStateCandidateInput {
	readonly previousContent: DocumentContent;
	readonly previousIndex: DocumentIndex;
	readonly nextContent: DocumentContent;
	readonly nextIndex: DocumentIndex;
	readonly capture: ManuscriptOperationCapture;
	readonly touchSet: IManuscriptOperationTouchSet;
	readonly instrumentation?: IRevisionMerkleUpdaterInstrumentation;
}

interface INodeUpdateContext {
	readonly previousContent: DocumentContent;
	readonly previousIndex: DocumentIndex;
	readonly previousState: RevisionMerkleState;
	readonly nextContent: DocumentContent;
	readonly nextIndex: DocumentIndex;
	readonly capture: ManuscriptOperationCapture;
	readonly touchSet: IManuscriptOperationTouchSet;
	readonly instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined;
	nodeHashes: IRevisionMerkleStateStores['nodeHashes'];
	nodeChildVectors: IRevisionMerkleStateStores['nodeChildVectors'];
}

/**
 * Computes one exact incremental Merkle candidate.
 *
 * The returned state is a derived candidate, not provenance or an installation
 * credential. The caller must first consume a genuine reducer transition and
 * retain the owning draft authority separately.
 */
export function updateRevisionMerkleStateCandidate(
	previousState: RevisionMerkleState,
	input: IUpdateRevisionMerkleStateCandidateInput,
): RevisionMerkleState {
	// State authentication is deliberately the first operation. In particular,
	// a hostile Proxy cannot trigger one of its traps before this WeakMap lookup.
	const previousStores = requireRevisionMerkleStateStores(previousState);
	const previousContent = input.previousContent;
	const previousIndex = input.previousIndex;
	const nextContent = input.nextContent;
	const nextIndex = input.nextIndex;
	const capture = input.capture;
	const touchSet = input.touchSet;
	const instrumentation = input.instrumentation;

	validateCandidateUpdateInput(
		previousState,
		previousStores,
		previousContent,
		previousIndex,
		nextContent,
		nextIndex,
		capture,
		touchSet,
	);

	let nodeHashes = previousStores.nodeHashes;
	let nodeChildVectors = previousStores.nodeChildVectors;
	let entityHashes = previousStores.entityHashes;
	let relationHashes = previousStores.relationHashes;
	let metadata = previousMetadataParts(previousState);
	let settingsHash = previousState.settingsHash;
	let academic = previousAcademicParts(previousState);

	if (isNodeOperation(capture)) {
		const nodeContext: INodeUpdateContext = {
			previousContent,
			previousIndex,
			previousState,
			nextContent,
			nextIndex,
			capture,
			touchSet,
			instrumentation,
			nodeHashes,
			nodeChildVectors,
		};
		updateNodeMerkleState(nodeContext);
		nodeHashes = nodeContext.nodeHashes;
		nodeChildVectors = nodeContext.nodeChildVectors;
	} else if (isAcademicOperation(capture)) {
		const updated = updateAcademicMerkleState(
			previousContent.academicGraph,
			nextContent.academicGraph,
			previousState,
			entityHashes,
			relationHashes,
			capture,
			touchSet,
			instrumentation,
		);
		entityHashes = updated.entityHashes;
		relationHashes = updated.relationHashes;
		academic = updated.academic;
	} else if (capture.type === 'set-metadata') {
		metadata = rebuildMetadataParts(nextContent.metadata, instrumentation);
	} else {
		settingsHash = hashSettings(nextContent.settings, instrumentation);
	}

	const rootNodeHash = requireStoreValue(
		nodeHashes.get(
			nextContent.root.id,
			'node-hashes',
			instrumentation,
		),
		`Missing final root Node hash for ${nextContent.root.id}.`,
	);
	const documentHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		createDocumentMerkleHashPayload({
			schemaId: nextContent.schemaId,
			schemaVersion: nextContent.schemaVersion,
			metadataHash: metadata.metadataHash,
			rootNodeHash,
			academicGraphHash: academic.academicGraphHash,
			settingsHash,
		}),
		instrumentation?.onHashCall,
	);
	const stores: IRevisionMerkleStateStores = {
		nodeHashes,
		nodeChildVectors,
		entityHashes,
		relationHashes,
	};
	validateFinalStoreCardinality(stores, nextContent, nextIndex);
	emitStoreCardinality(stores, instrumentation);
	return createRevisionMerkleState(
		{
			documentHash,
			metadataHash: metadata.metadataHash,
			rootNodeHash,
			academicGraphHash: academic.academicGraphHash,
			settingsHash,
			titleHash: metadata.titleHash,
			abstractHash: metadata.abstractHash,
			metadataAuthorsVector: metadata.authorsVector,
			metadataKeywordsVector: metadata.keywordsVector,
			academicReferenceSnapshotsVector:
				academic.referenceSnapshotsVector,
			academicEvidenceLinksVector: academic.evidenceLinksVector,
			academicClaimsVector: academic.claimsVector,
			academicClaimEvidenceRelationsVector:
				academic.claimEvidenceRelationsVector,
		},
		stores,
	);
}

function validateCandidateUpdateInput(
	previousState: RevisionMerkleState,
	previousStores: IRevisionMerkleStateStores,
	previousContent: DocumentContent,
	previousIndex: DocumentIndex,
	nextContent: DocumentContent,
	nextIndex: DocumentIndex,
	capture: ManuscriptOperationCapture,
	touchSet: IManuscriptOperationTouchSet,
): void {
	const previousEntityCount = previousContent.academicGraph
		.referenceSnapshots.length
		+ previousContent.academicGraph.evidenceLinks.length
		+ previousContent.academicGraph.claims.length;
	const previousRelationCount =
		previousContent.academicGraph.claimEvidenceRelations.length;
	if (
		!Object.isFrozen(capture)
		|| !Object.isFrozen(touchSet)
		|| !Object.isFrozen(touchSet.nodePaths)
		|| !Object.isFrozen(touchSet.academicPaths)
		|| !Object.isFrozen(touchSet.normalizationParentNodeIds)
		|| touchSet.nodePaths.some(path =>
			!Object.isFrozen(path)
			|| !Object.isFrozen(path.path)
			|| !Object.isFrozen(path.childIndexes))
		|| touchSet.academicPaths.some(path => !Object.isFrozen(path))
		|| previousIndex.nodeCount !== previousState.nodeCount
		|| previousStores.nodeHashes.size !== previousIndex.nodeCount
		|| previousStores.nodeChildVectors.size
			> previousStores.nodeHashes.size
		|| previousStores.entityHashes.size !== previousEntityCount
		|| previousStores.relationHashes.size !== previousRelationCount
		|| previousIndex.rootNodeId !== previousContent.root.id
		|| nextIndex.rootNodeId !== nextContent.root.id
		|| previousIndex.getNode(previousContent.root.id)
			!== previousContent.root
		|| nextIndex.getNode(nextContent.root.id) !== nextContent.root
		|| previousState.getNodeHash(previousContent.root.id)
			!== previousState.rootNodeHash
		|| previousState.metadataAuthorsVector.count
			!== previousContent.metadata.authors.length
		|| previousState.metadataKeywordsVector.count
			!== previousContent.metadata.keywords.length
		|| previousState.academicReferenceSnapshotsVector.count
			!== previousContent.academicGraph.referenceSnapshots.length
		|| previousState.academicEvidenceLinksVector.count
			!== previousContent.academicGraph.evidenceLinks.length
		|| previousState.academicClaimsVector.count
			!== previousContent.academicGraph.claims.length
		|| previousState.academicClaimEvidenceRelationsVector.count
			!== previousRelationCount
		|| previousContent.format !== nextContent.format
		|| previousContent.formatVersion !== nextContent.formatVersion
		|| previousContent.schemaId !== nextContent.schemaId
		|| previousContent.schemaVersion !== nextContent.schemaVersion
	) {
		throw new TypeError('Inconsistent incremental Revision Merkle input.');
	}
	const nodeOperation = isNodeOperation(capture);
	const academicOperation = isAcademicOperation(capture);
	if (
		nodeOperation
			? (
				previousContent.metadata !== nextContent.metadata
				|| previousContent.academicGraph !== nextContent.academicGraph
				|| previousContent.settings !== nextContent.settings
				|| touchSet.nodePaths.length === 0
				|| touchSet.academicPaths.length !== 0
				|| touchSet.metadata
				|| touchSet.settings
			)
			: academicOperation
				? (
					previousContent.root !== nextContent.root
					|| previousIndex !== nextIndex
					|| previousContent.metadata !== nextContent.metadata
					|| previousContent.settings !== nextContent.settings
					|| touchSet.nodePaths.length !== 0
					|| touchSet.normalizationParentNodeIds.length !== 0
					|| touchSet.metadata
					|| touchSet.settings
					|| !academicGraphDeltaMatchesTouchSet(
						previousContent.academicGraph,
						nextContent.academicGraph,
						touchSet,
					)
				)
				: capture.type === 'set-metadata'
					? (
						previousContent.root !== nextContent.root
						|| previousIndex !== nextIndex
						|| previousContent.academicGraph
							!== nextContent.academicGraph
						|| previousContent.settings !== nextContent.settings
						|| !touchSet.metadata
						|| touchSet.settings
						|| touchSet.nodePaths.length !== 0
						|| touchSet.academicPaths.length !== 0
						|| touchSet.normalizationParentNodeIds.length !== 0
					)
					: (
						previousContent.root !== nextContent.root
						|| previousIndex !== nextIndex
						|| previousContent.academicGraph
							!== nextContent.academicGraph
						|| previousContent.metadata !== nextContent.metadata
						|| !touchSet.settings
						|| touchSet.metadata
						|| touchSet.nodePaths.length !== 0
						|| touchSet.academicPaths.length !== 0
						|| touchSet.normalizationParentNodeIds.length !== 0
					)
	) {
		throw new TypeError('The Merkle capture does not match its content delta.');
	}
}

function academicGraphDeltaMatchesTouchSet(
	previousGraph: AcademicGraphSnapshot,
	nextGraph: AcademicGraphSnapshot,
	touchSet: IManuscriptOperationTouchSet,
): boolean {
	const touchedCollections = new Set(
		touchSet.academicPaths.map(path => path.collection),
	);
	const collections: readonly AcademicCollectionName[] = [
		'referenceSnapshots',
		'evidenceLinks',
		'claims',
		'claimEvidenceRelations',
	];
	return collections.every(collection =>
		touchedCollections.has(collection)
			|| previousGraph[collection] === nextGraph[collection]);
}

function isNodeOperation(
	capture: ManuscriptOperationCapture,
): capture is Extract<
	ManuscriptOperationCapture,
	{
		readonly type:
			| 'insert-node'
			| 'delete-node'
			| 'move-node'
			| 'replace-text'
			| 'split-text'
			| 'join-text'
			| 'set-node-attributes'
			| 'set-text-marks';
	}
> {
	return capture.type === 'insert-node'
		|| capture.type === 'delete-node'
		|| capture.type === 'move-node'
		|| capture.type === 'replace-text'
		|| capture.type === 'split-text'
		|| capture.type === 'join-text'
		|| capture.type === 'set-node-attributes'
		|| capture.type === 'set-text-marks';
}

function isAcademicOperation(
	capture: ManuscriptOperationCapture,
): capture is Extract<
	ManuscriptOperationCapture,
	{
		readonly type:
			| 'create-academic-entity'
			| 'replace-academic-entity'
			| 'delete-academic-entity'
			| 'set-claim-evidence-relation';
	}
> {
	return capture.type === 'create-academic-entity'
		|| capture.type === 'replace-academic-entity'
		|| capture.type === 'delete-academic-entity'
		|| capture.type === 'set-claim-evidence-relation';
}

function updateNodeMerkleState(context: INodeUpdateContext): void {
	const workingVectors = new Map<NodeId, ManuscriptMerkleVector>();
	const precomputedNodeIds = new Set<NodeId>();
	const { capture } = context;
	switch (capture.type) {
		case 'insert-node':
			prepareInsertedNodeUpdate(
				context,
				capture,
				workingVectors,
				precomputedNodeIds,
			);
			break;
		case 'delete-node':
			prepareDeletedNodeUpdate(context, capture, workingVectors);
			break;
		case 'move-node':
			prepareMovedNodeUpdate(context, capture, workingVectors);
			precomputedNodeIds.add(capture.targetNodeId);
			break;
		case 'split-text':
			prepareSplitTextUpdate(
				context,
				capture,
				workingVectors,
				precomputedNodeIds,
			);
			break;
		case 'join-text':
			prepareJoinTextUpdate(
				context,
				capture,
				workingVectors,
				precomputedNodeIds,
			);
			break;
		case 'replace-text':
		case 'set-node-attributes':
		case 'set-text-marks':
			break;
		default:
			throw new TypeError('Expected a Node Operation capture.');
	}

	const affectedDepths = collectAfterTouchDepths(context);
	for (const nodeId of precomputedNodeIds) {
		affectedDepths.delete(nodeId);
	}
	const affected = [...affectedDepths].sort(
		(left, right) => right[1] - left[1],
	);
	for (const [nodeId] of affected) {
		const node = requireIndexNode(context.nextIndex, nodeId);
		const vector = workingVectors.get(nodeId)
			?? getNodeChildVector(context, nodeId);
		const hash = hashDocumentNode(node, vector, context.instrumentation);
		context.nodeHashes = context.nodeHashes.set(
			nodeId,
			hash,
			'node-hashes',
			context.instrumentation,
		);
		if (workingVectors.has(nodeId)) {
			if (vector === undefined) {
				throw new TypeError(
					`A changed container Node is missing its vector: ${nodeId}.`,
				);
			}
			context.nodeChildVectors = context.nodeChildVectors.set(
				nodeId,
				vector,
				'node-child-vectors',
				context.instrumentation,
			);
		}
		context.instrumentation?.onNodePayloadRead?.(nodeId, 'changed-path');
		context.instrumentation?.onAncestorRehash?.(nodeId);

		const parentLocation = context.nextIndex.getParentLocation(nodeId);
		if (parentLocation === undefined) {
			continue;
		}
		const parentVector = workingVectors.get(parentLocation.parentNodeId)
			?? getNodeChildVector(context, parentLocation.parentNodeId);
		if (parentVector === undefined) {
			throw new TypeError(
				`A changed Node parent is missing its vector: ${nodeId}.`,
			);
		}
		workingVectors.set(
			parentLocation.parentNodeId,
			parentVector.replaceStructuralItem(
				node,
				hash,
				vectorInstrumentation(
					manuscriptMerkleVectorRoles.nodeChildren,
					context.instrumentation,
				),
			),
		);
	}
}

function prepareInsertedNodeUpdate(
	context: INodeUpdateContext,
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'insert-node' }
	>,
	workingVectors: Map<NodeId, ManuscriptMerkleVector>,
	precomputedNodeIds: Set<NodeId>,
): void {
	const nextParent = requireContainerNode(
		context.nextIndex,
		capture.parentNodeId,
	);
	const inserted = requireChildAt(
		nextParent,
		capture.childIndex,
		context.instrumentation,
	);
	if (inserted.id !== capture.insertedNodeIds[0]) {
		throw new TypeError('The inserted subtree root does not match its capture.');
	}
	const insertedIds = buildInsertedSubtree(
		context,
		inserted,
		precomputedNodeIds,
	);
	assertSameNodeIds(insertedIds, capture.insertedNodeIds);
	const insertedHash = getNodeHash(context, inserted.id);
	const previousParent = requireContainerNode(
		context.previousIndex,
		capture.parentNodeId,
	);
	const previousVector = requireNodeChildVector(
		context,
		previousParent.id,
	);
	workingVectors.set(
		previousParent.id,
		previousVector.insertStructuralItem(
			inserted,
			insertedHash,
			childAt(
				nextParent,
				capture.childIndex - 1,
				context.instrumentation,
			),
			childAt(
				nextParent,
				capture.childIndex + 1,
				context.instrumentation,
			),
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.nodeChildren,
				context.instrumentation,
			),
		),
	);
}

function prepareDeletedNodeUpdate(
	context: INodeUpdateContext,
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'delete-node' }
	>,
	workingVectors: Map<NodeId, ManuscriptMerkleVector>,
): void {
	const previousParent = requireContainerNode(
		context.previousIndex,
		capture.parentNodeId,
	);
	const target = requireChildAt(
		previousParent,
		capture.childIndex,
		context.instrumentation,
	);
	if (target.id !== capture.deletedNode.id) {
		throw new TypeError('The deleted subtree root does not match its capture.');
	}
	const previousVector = requireNodeChildVector(context, previousParent.id);
	workingVectors.set(
		previousParent.id,
		previousVector.removeStructuralItem(
			target,
			childAt(
				previousParent,
				capture.childIndex - 1,
				context.instrumentation,
			),
			childAt(
				previousParent,
				capture.childIndex + 1,
				context.instrumentation,
			),
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.nodeChildren,
				context.instrumentation,
			),
		),
	);
	const deletedIds = unsetDeletedSubtree(context, capture.deletedNode);
	assertSameNodeIds(deletedIds, capture.deletedNodeIds);
}

function prepareMovedNodeUpdate(
	context: INodeUpdateContext,
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'move-node' }
	>,
	workingVectors: Map<NodeId, ManuscriptMerkleVector>,
): void {
	const previousSourceParent = requireContainerNode(
		context.previousIndex,
		capture.sourceParentNodeId,
	);
	const target = requireChildAt(
		previousSourceParent,
		capture.sourceChildIndex,
		context.instrumentation,
	);
	if (
		target.id !== capture.targetNodeId
		|| capture.movedNodeIds[0] !== target.id
	) {
		throw new TypeError('The moved subtree root does not match its capture.');
	}
	const nextDestinationParent = requireContainerNode(
		context.nextIndex,
		capture.destinationParentNodeId,
	);
	const movedAfter = requireChildAt(
		nextDestinationParent,
		capture.destinationChildIndexAfterRemoval,
		context.instrumentation,
	);
	if (movedAfter.id !== target.id) {
		throw new TypeError('The moved subtree destination does not match.');
	}
	if (capture.sourceParentNodeId === capture.destinationParentNodeId) {
		const vector = requireNodeChildVector(
			context,
			capture.sourceParentNodeId,
		);
		workingVectors.set(
			capture.sourceParentNodeId,
			vector.moveStructuralItem(
				target,
				childAt(
					previousSourceParent,
					capture.sourceChildIndex - 1,
					context.instrumentation,
				),
				childAt(
					previousSourceParent,
					capture.sourceChildIndex + 1,
					context.instrumentation,
				),
				childAt(
					nextDestinationParent,
					capture.destinationChildIndexAfterRemoval - 1,
					context.instrumentation,
				),
				childAt(
					nextDestinationParent,
					capture.destinationChildIndexAfterRemoval + 1,
					context.instrumentation,
				),
				vectorInstrumentation(
					manuscriptMerkleVectorRoles.nodeChildren,
					context.instrumentation,
				),
			),
		);
		return;
	}
	const sourceVector = requireNodeChildVector(
		context,
		capture.sourceParentNodeId,
	);
	workingVectors.set(
		capture.sourceParentNodeId,
		sourceVector.removeStructuralItem(
			target,
			childAt(
				previousSourceParent,
				capture.sourceChildIndex - 1,
				context.instrumentation,
			),
			childAt(
				previousSourceParent,
				capture.sourceChildIndex + 1,
				context.instrumentation,
			),
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.nodeChildren,
				context.instrumentation,
			),
		),
	);
	const destinationVector = requireNodeChildVector(
		context,
		capture.destinationParentNodeId,
	);
	workingVectors.set(
		capture.destinationParentNodeId,
		destinationVector.insertStructuralItem(
			target,
			getNodeHash(context, target.id),
			childAt(
				nextDestinationParent,
				capture.destinationChildIndexAfterRemoval - 1,
				context.instrumentation,
			),
			childAt(
				nextDestinationParent,
				capture.destinationChildIndexAfterRemoval + 1,
				context.instrumentation,
			),
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.nodeChildren,
				context.instrumentation,
			),
		),
	);
}

function prepareSplitTextUpdate(
	context: INodeUpdateContext,
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'split-text' }
	>,
	workingVectors: Map<NodeId, ManuscriptMerkleVector>,
	precomputedNodeIds: Set<NodeId>,
): void {
	const previousParent = requireContainerNode(
		context.previousIndex,
		capture.parentNodeId,
	);
	const nextParent = requireContainerNode(
		context.nextIndex,
		capture.parentNodeId,
	);
	const left = requireChildAt(
		nextParent,
		capture.childIndex,
		context.instrumentation,
	);
	const right = requireChildAt(
		nextParent,
		capture.childIndex + 1,
		context.instrumentation,
	);
	if (
		left.id !== capture.leftTextNodeId
		|| right.id !== capture.rightTextNodeId
		|| left.type !== 'text'
		|| right.type !== 'text'
	) {
		throw new TypeError('The split Text capture does not match final content.');
	}
	const leftHash = hashDocumentNode(left, undefined, context.instrumentation);
	const rightHash = hashDocumentNode(right, undefined, context.instrumentation);
	setPrecomputedNodeHash(context, left.id, leftHash, precomputedNodeIds);
	setPrecomputedNodeHash(context, right.id, rightHash, precomputedNodeIds);
	const previousVector = requireNodeChildVector(context, previousParent.id);
	const replaced = previousVector.replaceStructuralItem(
		left,
		leftHash,
		vectorInstrumentation(
			manuscriptMerkleVectorRoles.nodeChildren,
			context.instrumentation,
		),
	);
	workingVectors.set(
		nextParent.id,
		replaced.insertStructuralItem(
			right,
			rightHash,
			left,
			childAt(
				nextParent,
				capture.childIndex + 2,
				context.instrumentation,
			),
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.nodeChildren,
				context.instrumentation,
			),
		),
	);
}

function prepareJoinTextUpdate(
	context: INodeUpdateContext,
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'join-text' }
	>,
	workingVectors: Map<NodeId, ManuscriptMerkleVector>,
	precomputedNodeIds: Set<NodeId>,
): void {
	const previousParent = requireContainerNode(
		context.previousIndex,
		capture.parentNodeId,
	);
	const nextParent = requireContainerNode(
		context.nextIndex,
		capture.parentNodeId,
	);
	const joined = requireChildAt(
		nextParent,
		capture.leftChildIndex,
		context.instrumentation,
	);
	if (
		joined.id !== capture.leftBefore.id
		|| joined.type !== 'text'
		|| requireChildAt(
			previousParent,
			capture.leftChildIndex + 1,
			context.instrumentation,
		).id !== capture.rightBefore.id
	) {
		throw new TypeError('The joined Text capture does not match final content.');
	}
	const joinedHash = hashDocumentNode(
		joined,
		undefined,
		context.instrumentation,
	);
	setPrecomputedNodeHash(
		context,
		joined.id,
		joinedHash,
		precomputedNodeIds,
	);
	context.nodeHashes = context.nodeHashes.unset(
		capture.rightBefore.id,
		'node-hashes',
		context.instrumentation,
	);
	context.nodeChildVectors = context.nodeChildVectors.unset(
		capture.rightBefore.id,
		'node-child-vectors',
		context.instrumentation,
	);
	const previousVector = requireNodeChildVector(context, previousParent.id);
	const removed = previousVector.removeStructuralItem(
		capture.rightBefore,
		capture.leftBefore,
		childAt(
			previousParent,
			capture.leftChildIndex + 2,
			context.instrumentation,
		),
		vectorInstrumentation(
			manuscriptMerkleVectorRoles.nodeChildren,
			context.instrumentation,
		),
	);
	workingVectors.set(
		nextParent.id,
		removed.replaceStructuralItem(
			joined,
			joinedHash,
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.nodeChildren,
				context.instrumentation,
			),
		),
	);
}

function buildInsertedSubtree(
	context: INodeUpdateContext,
	root: DocumentNode,
	precomputedNodeIds: Set<NodeId>,
): readonly NodeId[] {
	type Frame =
		| { readonly kind: 'enter'; readonly node: DocumentNode }
		| { readonly kind: 'exit'; readonly node: DocumentNode };
	const preorder: NodeId[] = [];
	const pending: Frame[] = [{ kind: 'enter', node: root }];
	while (pending.length > 0) {
		const frame = pending.pop();
		if (frame === undefined) {
			break;
		}
		if (frame.kind === 'enter') {
			preorder.push(frame.node.id);
			context.instrumentation?.onNodePayloadRead?.(
				frame.node.id,
				'inserted-subtree',
			);
			pending.push({ kind: 'exit', node: frame.node });
			const children = getDocumentNodeChildren(frame.node);
			for (let index = children.length - 1; index >= 0; index -= 1) {
				const child = children[index];
				if (child !== undefined) {
					pending.push({ kind: 'enter', node: child });
				}
			}
			continue;
		}
		const children = getDocumentNodeChildren(frame.node);
		let vector: ManuscriptMerkleVector | undefined;
		if ('children' in frame.node) {
			vector = ManuscriptMerkleVector.createStructural(
				manuscriptMerkleVectorRoles.nodeChildren,
				children.map(child => Object.freeze({
					item: child,
					hash: getNodeHash(context, child.id),
				})),
				vectorInstrumentation(
					manuscriptMerkleVectorRoles.nodeChildren,
					context.instrumentation,
				),
			);
			context.nodeChildVectors = context.nodeChildVectors.set(
				frame.node.id,
				vector,
				'node-child-vectors',
				context.instrumentation,
			);
		}
		const hash = hashDocumentNode(
			frame.node,
			vector,
			context.instrumentation,
		);
		context.nodeHashes = context.nodeHashes.set(
			frame.node.id,
			hash,
			'node-hashes',
			context.instrumentation,
		);
		precomputedNodeIds.add(frame.node.id);
	}
	return Object.freeze(preorder);
}

function unsetDeletedSubtree(
	context: INodeUpdateContext,
	root: DocumentNode,
): readonly NodeId[] {
	const deletedIds: NodeId[] = [];
	const pending: DocumentNode[] = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) {
			break;
		}
		deletedIds.push(node.id);
		context.instrumentation?.onNodePayloadRead?.(
			node.id,
			'deleted-subtree',
		);
		context.nodeHashes = context.nodeHashes.unset(
			node.id,
			'node-hashes',
			context.instrumentation,
		);
		context.nodeChildVectors = context.nodeChildVectors.unset(
			node.id,
			'node-child-vectors',
			context.instrumentation,
		);
		const children = getDocumentNodeChildren(node);
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = children[index];
			if (child !== undefined) {
				pending.push(child);
			}
		}
	}
	return Object.freeze(deletedIds);
}

function collectAfterTouchDepths(
	context: INodeUpdateContext,
): Map<NodeId, number> {
	const depths = new Map<NodeId, number>();
	let afterPathCount = 0;
	for (const touched of context.touchSet.nodePaths) {
		if (touched.phase !== 'after') {
			continue;
		}
		afterPathCount += 1;
		if (
			touched.path[0] !== context.nextContent.root.id
			|| touched.childIndexes.length !== touched.path.length - 1
		) {
			throw new TypeError('An after touch path is malformed.');
		}
		for (let depth = 0; depth < touched.path.length; depth += 1) {
			const nodeId = touched.path[depth];
			if (nodeId === undefined) {
				throw new TypeError('An after touch path is incomplete.');
			}
			if (depth > 0) {
				const location = context.nextIndex.getParentLocation(nodeId);
				if (
					location === undefined
					|| location.parentNodeId !== touched.path[depth - 1]
					|| location.childIndex !== touched.childIndexes[depth - 1]
				) {
					throw new TypeError(
						'An after touch path disagrees with the final index.',
					);
				}
			}
			depths.set(nodeId, Math.max(depths.get(nodeId) ?? -1, depth));
		}
	}
	if (afterPathCount === 0) {
		throw new TypeError('A Node update requires an after touch path.');
	}
	return depths;
}

function getNodeHash(
	context: INodeUpdateContext,
	nodeId: NodeId,
): ContentHash {
	return requireStoreValue(
		context.nodeHashes.get(
			nodeId,
			'node-hashes',
			context.instrumentation,
		),
		`Missing Node hash for ${nodeId}.`,
	);
}

function getNodeChildVector(
	context: INodeUpdateContext,
	nodeId: NodeId,
): ManuscriptMerkleVector | undefined {
	return context.nodeChildVectors.get(
		nodeId,
		'node-child-vectors',
		context.instrumentation,
	);
}

function requireNodeChildVector(
	context: INodeUpdateContext,
	nodeId: NodeId,
): ManuscriptMerkleVector {
	return requireStoreValue(
		getNodeChildVector(context, nodeId),
		`Missing child vector for container Node ${nodeId}.`,
	);
}

function setPrecomputedNodeHash(
	context: INodeUpdateContext,
	nodeId: NodeId,
	hash: ContentHash,
	precomputedNodeIds: Set<NodeId>,
): void {
	context.nodeHashes = context.nodeHashes.set(
		nodeId,
		hash,
		'node-hashes',
		context.instrumentation,
	);
	precomputedNodeIds.add(nodeId);
}

function hashDocumentNode(
	node: DocumentNode,
	vector: ManuscriptMerkleVector | undefined,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): ContentHash {
	if (('children' in node) !== (vector !== undefined)) {
		throw new TypeError(
			`Node child vector ownership mismatch for ${node.id}.`,
		);
	}
	const payload = node.type === 'text'
		? createDocumentNodeHashPayload(node)
		: 'children' in node
			? createDocumentNodeHashPayload(
				node,
				createMerkleVectorDescriptor(
					requireStoreValue(
						vector,
						`Missing child vector for Node ${node.id}.`,
					),
				),
			)
			: createDocumentNodeHashPayload(node);
	return hashRevisionMerklePayload(
		manuscriptHashDomains.node,
		payload,
		instrumentation?.onHashCall,
	);
}

function requireIndexNode(
	index: DocumentIndex,
	nodeId: NodeId,
): DocumentNode {
	return requireStoreValue(
		index.getNode(nodeId),
		`Missing indexed Node ${nodeId}.`,
	);
}

function requireContainerNode(
	index: DocumentIndex,
	nodeId: NodeId,
): DocumentNode & { readonly children: readonly DocumentNode[] } {
	const node = requireIndexNode(index, nodeId);
	if (!('children' in node)) {
		throw new TypeError(`Node ${nodeId} does not own children.`);
	}
	return node;
}

function requireChildAt(
	parent: DocumentNode & { readonly children: readonly DocumentNode[] },
	index: number,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): DocumentNode {
	const child = childAt(parent, index, instrumentation);
	if (child === undefined) {
		throw new TypeError(
			`Missing structural child ${index} under Node ${parent.id}.`,
		);
	}
	return child;
}

function childAt(
	parent: DocumentNode & { readonly children: readonly DocumentNode[] },
	index: number,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): DocumentNode | undefined {
	const child = index < 0 || index >= parent.children.length
		? undefined
		: parent.children[index];
	if (child !== undefined) {
		instrumentation?.onNodePayloadRead?.(
			child.id,
			'structural-neighbor',
		);
	}
	return child;
}

function assertSameNodeIds(
	actual: readonly NodeId[],
	expected: readonly NodeId[],
): void {
	if (
		actual.length !== expected.length
		|| actual.some((nodeId, index) => nodeId !== expected[index])
	) {
		throw new TypeError('A captured subtree Node ID sequence is inconsistent.');
	}
}

function vectorInstrumentation(
	role: ManuscriptMerkleVectorRole,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): IManuscriptStructuralMerkleInstrumentation | undefined {
	if (instrumentation === undefined) {
		return undefined;
	}
	return {
		onHashCall: instrumentation.onHashCall as
			| ManuscriptMerkleVectorHashCallObserver
			| undefined,
		onItemRead: () => instrumentation.onStructuralItemRead?.(role),
		onTrieNodeVisit: () =>
			instrumentation.onStructuralTrieNodeVisit?.(role),
		onTrieNodeCopy: () =>
			instrumentation.onStructuralTrieNodeCopy?.(role),
	};
}

interface IMetadataParts {
	readonly metadataHash: ContentHash;
	readonly titleHash: ContentHash;
	readonly abstractHash: ContentHash;
	readonly authorsVector: ManuscriptMerkleVector;
	readonly keywordsVector: ManuscriptMerkleVector;
}

interface IAcademicParts {
	readonly academicGraphHash: ContentHash;
	readonly referenceSnapshotsVector: ManuscriptMerkleVector;
	readonly evidenceLinksVector: ManuscriptMerkleVector;
	readonly claimsVector: ManuscriptMerkleVector;
	readonly claimEvidenceRelationsVector: ManuscriptMerkleVector;
}

interface IAcademicUpdate {
	readonly entityHashes: IRevisionMerkleStateStores['entityHashes'];
	readonly relationHashes: IRevisionMerkleStateStores['relationHashes'];
	readonly academic: IAcademicParts;
}

function previousMetadataParts(
	state: RevisionMerkleState,
): IMetadataParts {
	return {
		metadataHash: state.metadataHash,
		titleHash: state.titleHash,
		abstractHash: state.abstractHash,
		authorsVector: state.metadataAuthorsVector,
		keywordsVector: state.metadataKeywordsVector,
	};
}

function previousAcademicParts(
	state: RevisionMerkleState,
): IAcademicParts {
	return {
		academicGraphHash: state.academicGraphHash,
		referenceSnapshotsVector: state.academicReferenceSnapshotsVector,
		evidenceLinksVector: state.academicEvidenceLinksVector,
		claimsVector: state.academicClaimsVector,
		claimEvidenceRelationsVector:
			state.academicClaimEvidenceRelationsVector,
	};
}

function rebuildMetadataParts(
	metadata: ManuscriptMetadata,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): IMetadataParts {
	const titleHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		createMetadataTextHashPayload('title', metadata.title),
		instrumentation?.onHashCall,
	);
	const authorHashes = metadata.authors.map(author =>
		hashRevisionMerklePayload(
			manuscriptHashDomains.documentContent,
			createMetadataAuthorHashPayload(author),
			instrumentation?.onHashCall,
		));
	const authorsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.metadataAuthors,
		authorHashes,
		instrumentation?.onHashCall as
			| ManuscriptMerkleVectorHashCallObserver
			| undefined,
	);
	const abstractHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		createMetadataTextHashPayload('abstract', metadata.abstract),
		instrumentation?.onHashCall,
	);
	const keywordHashes = metadata.keywords.map(keyword =>
		hashRevisionMerklePayload(
			manuscriptHashDomains.documentContent,
			createMetadataKeywordHashPayload(keyword),
			instrumentation?.onHashCall,
		));
	const keywordsVector = ManuscriptMerkleVector.create(
		manuscriptMerkleVectorRoles.metadataKeywords,
		keywordHashes,
		instrumentation?.onHashCall as
			| ManuscriptMerkleVectorHashCallObserver
			| undefined,
	);
	const metadataHash = hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		createMetadataRootHashPayload(
			titleHash,
			createMerkleVectorDescriptor(authorsVector),
			abstractHash,
			createMerkleVectorDescriptor(keywordsVector),
		),
		instrumentation?.onHashCall,
	);
	return {
		metadataHash,
		titleHash,
		abstractHash,
		authorsVector,
		keywordsVector,
	};
}

function hashSettings(
	settings: DocumentSemanticSettings,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): ContentHash {
	return hashRevisionMerklePayload(
		manuscriptHashDomains.documentContent,
		createSettingsHashPayload(settings),
		instrumentation?.onHashCall,
	);
}

function updateAcademicMerkleState(
	previousGraph: AcademicGraphSnapshot,
	nextGraph: AcademicGraphSnapshot,
	previousState: RevisionMerkleState,
	initialEntityHashes: IRevisionMerkleStateStores['entityHashes'],
	initialRelationHashes: IRevisionMerkleStateStores['relationHashes'],
	capture: Extract<
		ManuscriptOperationCapture,
		{
			readonly type:
				| 'create-academic-entity'
				| 'replace-academic-entity'
				| 'delete-academic-entity'
				| 'set-claim-evidence-relation';
		}
	>,
	touchSet: IManuscriptOperationTouchSet,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): IAcademicUpdate {
	let entityHashes = initialEntityHashes;
	let relationHashes = initialRelationHashes;
	let academic = previousAcademicParts(previousState);
	if (capture.type === 'set-claim-evidence-relation') {
		const relation = updateRelationMerkleState(
			previousGraph,
			nextGraph,
			academic,
			relationHashes,
			capture,
			touchSet,
			instrumentation,
		);
		relationHashes = relation.relationHashes;
		academic = relation.academic;
	} else {
		const entity = updateEntityMerkleState(
			previousGraph,
			nextGraph,
			academic,
			entityHashes,
			capture,
			touchSet,
			instrumentation,
		);
		entityHashes = entity.entityHashes;
		academic = entity.academic;
	}
	return { entityHashes, relationHashes, academic };
}

function updateEntityMerkleState(
	previousGraph: AcademicGraphSnapshot,
	nextGraph: AcademicGraphSnapshot,
	initialAcademic: IAcademicParts,
	initialEntityHashes: IRevisionMerkleStateStores['entityHashes'],
	capture: Extract<
		ManuscriptOperationCapture,
		{
			readonly type:
				| 'create-academic-entity'
				| 'replace-academic-entity'
				| 'delete-academic-entity';
		}
	>,
	touchSet: IManuscriptOperationTouchSet,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): {
	readonly entityHashes: IRevisionMerkleStateStores['entityHashes'];
	readonly academic: IAcademicParts;
} {
	let entityHashes = initialEntityHashes;
	let academic = initialAcademic;
	const beforeTouch = findAcademicTouchPath(touchSet, 'before');
	const afterTouch = findAcademicTouchPath(touchSet, 'after');
	const beforePath = beforeTouch === undefined
		? undefined
		: requireAcademicEntityTouchPath(beforeTouch);
	const afterPath = afterTouch === undefined
		? undefined
		: requireAcademicEntityTouchPath(afterTouch);
	if (capture.type === 'create-academic-entity') {
		if (beforePath !== undefined || afterPath === undefined) {
			throw new TypeError('Create Academic Entity touch paths are invalid.');
		}
		const item = requireAcademicEntityAt(
			nextGraph,
			afterPath,
			instrumentation,
		);
		if (item.id !== capture.entityId) {
			throw new TypeError('Created Academic Entity ID does not match.');
		}
		const hash = hashAcademicEntity(item, instrumentation);
		const vector = academicVector(academic, afterPath.collection);
		academic = replaceAcademicVector(
			academic,
			afterPath.collection,
			vector.insertStructuralItem(
				item,
				hash,
				academicEntityAt(
					nextGraph,
					afterPath.collection,
					afterPath.index - 1,
					instrumentation,
					'structural-neighbor',
				),
				academicEntityAt(
					nextGraph,
					afterPath.collection,
					afterPath.index + 1,
					instrumentation,
					'structural-neighbor',
				),
				vectorInstrumentation(
					academicVectorRole(afterPath.collection),
					instrumentation,
				),
			),
			instrumentation,
		);
		entityHashes = entityHashes.set(
			item.id,
			hash,
			'entity-hashes',
			instrumentation,
		);
		return { entityHashes, academic };
	}
	if (capture.type === 'delete-academic-entity') {
		if (beforePath === undefined || afterPath !== undefined) {
			throw new TypeError('Delete Academic Entity touch paths are invalid.');
		}
		const item = requireAcademicEntityAt(
			previousGraph,
			beforePath,
			instrumentation,
		);
		if (item.id !== capture.deletedEntity.id) {
			throw new TypeError('Deleted Academic Entity ID does not match.');
		}
		const vector = academicVector(academic, beforePath.collection);
		academic = replaceAcademicVector(
			academic,
			beforePath.collection,
			vector.removeStructuralItem(
				item,
				academicEntityAt(
					previousGraph,
					beforePath.collection,
					beforePath.index - 1,
					instrumentation,
					'structural-neighbor',
				),
				academicEntityAt(
					previousGraph,
					beforePath.collection,
					beforePath.index + 1,
					instrumentation,
					'structural-neighbor',
				),
				vectorInstrumentation(
					academicVectorRole(beforePath.collection),
					instrumentation,
				),
			),
			instrumentation,
		);
		entityHashes = entityHashes.unset(
			item.id,
			'entity-hashes',
			instrumentation,
		);
		return { entityHashes, academic };
	}
	if (beforePath === undefined || afterPath === undefined) {
		throw new TypeError('Replace Academic Entity touch paths are invalid.');
	}
	const previous = requireAcademicEntityAt(
		previousGraph,
		beforePath,
		instrumentation,
	);
	const replacement = requireAcademicEntityAt(
		nextGraph,
		afterPath,
		instrumentation,
	);
	if (
		previous.id !== capture.previousEntity.id
		|| replacement.id !== previous.id
	) {
		throw new TypeError('Replaced Academic Entity ID does not match.');
	}
	const replacementHash = hashAcademicEntity(replacement, instrumentation);
	if (beforePath.collection === afterPath.collection) {
		academic = replaceAcademicVector(
			academic,
			afterPath.collection,
			academicVector(academic, afterPath.collection).replaceStructuralItem(
				replacement,
				replacementHash,
				vectorInstrumentation(
					academicVectorRole(afterPath.collection),
					instrumentation,
				),
			),
			instrumentation,
		);
	} else {
		academic = replaceAcademicVector(
			academic,
			beforePath.collection,
				academicVector(academic, beforePath.collection).removeStructuralItem(
					previous,
					academicEntityAt(
						previousGraph,
						beforePath.collection,
						beforePath.index - 1,
						instrumentation,
						'structural-neighbor',
					),
					academicEntityAt(
						previousGraph,
						beforePath.collection,
						beforePath.index + 1,
						instrumentation,
						'structural-neighbor',
					),
				vectorInstrumentation(
					academicVectorRole(beforePath.collection),
					instrumentation,
				),
			),
			instrumentation,
		);
		academic = replaceAcademicVector(
			academic,
			afterPath.collection,
				academicVector(academic, afterPath.collection).insertStructuralItem(
					replacement,
					replacementHash,
					academicEntityAt(
						nextGraph,
						afterPath.collection,
						afterPath.index - 1,
						instrumentation,
						'structural-neighbor',
					),
					academicEntityAt(
						nextGraph,
						afterPath.collection,
						afterPath.index + 1,
						instrumentation,
						'structural-neighbor',
					),
				vectorInstrumentation(
					academicVectorRole(afterPath.collection),
					instrumentation,
				),
			),
			instrumentation,
		);
	}
	entityHashes = entityHashes.set(
		replacement.id,
		replacementHash,
		'entity-hashes',
		instrumentation,
	);
	return { entityHashes, academic };
}

function updateRelationMerkleState(
	previousGraph: AcademicGraphSnapshot,
	nextGraph: AcademicGraphSnapshot,
	initialAcademic: IAcademicParts,
	initialRelationHashes: IRevisionMerkleStateStores['relationHashes'],
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'set-claim-evidence-relation' }
	>,
	touchSet: IManuscriptOperationTouchSet,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): {
	readonly relationHashes: IRevisionMerkleStateStores['relationHashes'];
	readonly academic: IAcademicParts;
} {
	const beforePath = findAcademicTouchPath(touchSet, 'before');
	const afterPath = findAcademicTouchPath(touchSet, 'after');
	const relationKey = relationStoreKey(capture.claimId, capture.evidenceId);
	const vector = initialAcademic.claimEvidenceRelationsVector;
	let relationHashes = initialRelationHashes;
	let nextVector = vector;

	if (capture.previousRelation === null) {
		if (beforePath !== undefined) {
			throw new TypeError('An absent relation cannot have a before path.');
		}
		if (afterPath === undefined) {
			if (
				previousGraph.claimEvidenceRelations
					!== nextGraph.claimEvidenceRelations
				|| relationHashes.get(
					relationKey,
					'relation-hashes',
					instrumentation,
				) !== undefined
			) {
				throw new TypeError('An absent relation no-op is inconsistent.');
			}
			return {
				relationHashes,
				academic: initialAcademic,
			};
		}
		const replacement = requireAcademicRelationAt(
			nextGraph,
			afterPath,
			instrumentation,
		);
		assertRelationCaptureTarget(replacement, capture);
		const hash = hashAcademicRelation(replacement, instrumentation);
		nextVector = vector.insertStructuralItem(
			replacement,
			hash,
			academicRelationAt(
				nextGraph,
				afterPath.index - 1,
				instrumentation,
				'structural-neighbor',
			),
			academicRelationAt(
				nextGraph,
				afterPath.index + 1,
				instrumentation,
				'structural-neighbor',
			),
			vectorInstrumentation(
				manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
				instrumentation,
			),
		);
		relationHashes = relationHashes.set(
			relationKey,
			hash,
			'relation-hashes',
			instrumentation,
		);
	} else {
		if (beforePath === undefined) {
			throw new TypeError('An existing relation requires a before path.');
		}
		const previous = requireAcademicRelationAt(
			previousGraph,
			beforePath,
			instrumentation,
		);
		assertRelationCaptureTarget(previous, capture);
		assertRelationCaptureTarget(capture.previousRelation, capture);
		if (afterPath === undefined) {
			nextVector = vector.removeStructuralItem(
				previous,
				academicRelationAt(
					previousGraph,
					beforePath.index - 1,
					instrumentation,
					'structural-neighbor',
				),
				academicRelationAt(
					previousGraph,
					beforePath.index + 1,
					instrumentation,
					'structural-neighbor',
				),
				vectorInstrumentation(
					manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
					instrumentation,
				),
			);
			relationHashes = relationHashes.unset(
				relationKey,
				'relation-hashes',
				instrumentation,
			);
		} else {
			if (beforePath.index !== afterPath.index) {
				throw new TypeError('A relation replacement changed its key order.');
			}
			const replacement = requireAcademicRelationAt(
				nextGraph,
				afterPath,
				instrumentation,
			);
			assertRelationCaptureTarget(replacement, capture);
			const hash = hashAcademicRelation(replacement, instrumentation);
			nextVector = vector.replaceStructuralItem(
				replacement,
				hash,
				vectorInstrumentation(
					manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
					instrumentation,
				),
			);
			relationHashes = relationHashes.set(
				relationKey,
				hash,
				'relation-hashes',
				instrumentation,
			);
		}
	}

	return {
		relationHashes,
		academic: replaceAcademicVector(
			initialAcademic,
			'claimEvidenceRelations',
			nextVector,
			instrumentation,
		),
	};
}

function findAcademicTouchPath(
	touchSet: IManuscriptOperationTouchSet,
	phase: IOperationTouchedAcademicPath['phase'],
): IOperationTouchedAcademicPath | undefined {
	let found: IOperationTouchedAcademicPath | undefined;
	for (const path of touchSet.academicPaths) {
		if (!Object.isFrozen(path) || path.phase !== phase) {
			continue;
		}
		if (found !== undefined) {
			throw new TypeError(`Duplicate Academic ${phase} touch path.`);
		}
		found = path;
	}
	return found;
}

type AcademicEntityCollectionName = Exclude<
	AcademicCollectionName,
	'claimEvidenceRelations'
>;

type IOperationTouchedAcademicEntityPath =
	IOperationTouchedAcademicPath & {
		readonly collection: AcademicEntityCollectionName;
		readonly entityId: NonNullable<
			IOperationTouchedAcademicPath['entityId']
		>;
		readonly claimId?: never;
		readonly evidenceId?: never;
	};

function requireAcademicEntityTouchPath(
	path: IOperationTouchedAcademicPath,
): IOperationTouchedAcademicEntityPath {
	if (
		path.collection === 'claimEvidenceRelations'
		|| path.entityId === undefined
		|| path.claimId !== undefined
		|| path.evidenceId !== undefined
	) {
		throw new TypeError('An Academic Entity touch path is malformed.');
	}
	return path as IOperationTouchedAcademicEntityPath;
}

function requireAcademicEntityAt(
	graph: AcademicGraphSnapshot,
	path: IOperationTouchedAcademicEntityPath,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): AcademicEntity {
	const entity = academicEntityAt(
		graph,
		path.collection,
		path.index,
		instrumentation,
		'structural-target',
	);
	if (entity === undefined || entity.id !== path.entityId) {
		throw new TypeError('An Academic Entity touch path is inconsistent.');
	}
	return entity;
}

function academicEntityAt(
	graph: AcademicGraphSnapshot,
	collection: AcademicEntityCollectionName,
	index: number,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
	kind: RevisionMerkleUpdaterAcademicReadKind,
): AcademicEntity | undefined {
	if (!Number.isInteger(index) || index < 0) {
		return undefined;
	}
	const entity = graph[collection][index];
	if (entity !== undefined) {
		instrumentation?.onAcademicPayloadRead?.(
			academicVectorRole(collection),
			kind,
		);
	}
	return entity;
}

function requireAcademicRelationAt(
	graph: AcademicGraphSnapshot,
	path: IOperationTouchedAcademicPath,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): ClaimEvidenceRelation {
	if (
		path.collection !== 'claimEvidenceRelations'
		|| path.entityId !== undefined
		|| path.claimId === undefined
		|| path.evidenceId === undefined
	) {
		throw new TypeError('A relation touch path is malformed.');
	}
	const relation = academicRelationAt(
		graph,
		path.index,
		instrumentation,
		'structural-target',
	);
	if (
		relation === undefined
		|| relation.claimId !== path.claimId
		|| relation.evidenceId !== path.evidenceId
	) {
		throw new TypeError('A relation touch path is inconsistent.');
	}
	return relation;
}

function academicRelationAt(
	graph: AcademicGraphSnapshot,
	index: number,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
	kind: RevisionMerkleUpdaterAcademicReadKind,
): ClaimEvidenceRelation | undefined {
	if (!Number.isInteger(index) || index < 0) {
		return undefined;
	}
	const relation = graph.claimEvidenceRelations[index];
	if (relation !== undefined) {
		instrumentation?.onAcademicPayloadRead?.(
			manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
			kind,
		);
	}
	return relation;
}

function academicVector(
	academic: IAcademicParts,
	collection: AcademicEntityCollectionName,
): ManuscriptMerkleVector {
	switch (collection) {
		case 'referenceSnapshots':
			return academic.referenceSnapshotsVector;
		case 'evidenceLinks':
			return academic.evidenceLinksVector;
		case 'claims':
			return academic.claimsVector;
	}
}

function academicVectorRole(
	collection: AcademicEntityCollectionName,
): ManuscriptMerkleVectorRole {
	switch (collection) {
		case 'referenceSnapshots':
			return manuscriptMerkleVectorRoles.academicReferenceSnapshots;
		case 'evidenceLinks':
			return manuscriptMerkleVectorRoles.academicEvidenceLinks;
		case 'claims':
			return manuscriptMerkleVectorRoles.academicClaims;
	}
}

function replaceAcademicVector(
	academic: IAcademicParts,
	collection: AcademicCollectionName,
	vector: ManuscriptMerkleVector,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): IAcademicParts {
	const updated = {
		referenceSnapshotsVector: collection === 'referenceSnapshots'
			? vector
			: academic.referenceSnapshotsVector,
		evidenceLinksVector: collection === 'evidenceLinks'
			? vector
			: academic.evidenceLinksVector,
		claimsVector: collection === 'claims'
			? vector
			: academic.claimsVector,
		claimEvidenceRelationsVector:
			collection === 'claimEvidenceRelations'
				? vector
				: academic.claimEvidenceRelationsVector,
	};
	return {
		...updated,
		academicGraphHash: hashRevisionMerklePayload(
			manuscriptHashDomains.documentContent,
			createAcademicGraphHashPayload(
				createMerkleVectorDescriptor(updated.referenceSnapshotsVector),
				createMerkleVectorDescriptor(updated.evidenceLinksVector),
				createMerkleVectorDescriptor(updated.claimsVector),
				createMerkleVectorDescriptor(
					updated.claimEvidenceRelationsVector,
				),
			),
			instrumentation?.onHashCall,
		),
	};
}

function hashAcademicEntity(
	entity: AcademicEntity,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): ContentHash {
	let payload: AcademicEntityHashPayload;
	switch (entity.type) {
		case 'reference-snapshot':
			payload = createAcademicReferenceHashPayload(entity);
			break;
		case 'evidence-link':
			payload = createAcademicEvidenceHashPayload(entity);
			break;
		case 'claim':
			payload = createAcademicClaimHashPayload(entity);
			break;
	}
	return hashRevisionMerklePayload(
		manuscriptHashDomains.academicEntity,
		payload,
		instrumentation?.onHashCall,
	);
}

function hashAcademicRelation(
	relation: ClaimEvidenceRelation,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): ContentHash {
	return hashRevisionMerklePayload(
		manuscriptHashDomains.academicEntity,
		createAcademicRelationHashPayload(relation),
		instrumentation?.onHashCall,
	);
}

function assertRelationCaptureTarget(
	relation: ClaimEvidenceRelation,
	capture: Extract<
		ManuscriptOperationCapture,
		{ readonly type: 'set-claim-evidence-relation' }
	>,
): void {
	if (
		relation.claimId !== capture.claimId
		|| relation.evidenceId !== capture.evidenceId
	) {
		throw new TypeError('A relation does not match its captured target.');
	}
}

function validateFinalStoreCardinality(
	stores: IRevisionMerkleStateStores,
	content: DocumentContent,
	index: DocumentIndex,
): void {
	const entityCount = content.academicGraph.referenceSnapshots.length
		+ content.academicGraph.evidenceLinks.length
		+ content.academicGraph.claims.length;
	const relationCount =
		content.academicGraph.claimEvidenceRelations.length;
	if (
		stores.nodeHashes.size !== index.nodeCount
		|| stores.nodeChildVectors.size > stores.nodeHashes.size
		|| stores.entityHashes.size !== entityCount
		|| stores.relationHashes.size !== relationCount
	) {
		throw new TypeError('Incremental Revision Merkle stores are incomplete.');
	}
}

function emitStoreCardinality(
	stores: IRevisionMerkleStateStores,
	instrumentation: IRevisionMerkleUpdaterInstrumentation | undefined,
): void {
	instrumentation?.onStoreCardinality?.(
		'node-hashes',
		stores.nodeHashes.size,
	);
	instrumentation?.onStoreCardinality?.(
		'node-child-vectors',
		stores.nodeChildVectors.size,
	);
	instrumentation?.onStoreCardinality?.(
		'entity-hashes',
		stores.entityHashes.size,
	);
	instrumentation?.onStoreCardinality?.(
		'relation-hashes',
		stores.relationHashes.size,
	);
}

function requireStoreValue<T>(
	value: T | undefined,
	message: string,
): T {
	if (value === undefined) {
		throw new TypeError(message);
	}
	return value;
}
