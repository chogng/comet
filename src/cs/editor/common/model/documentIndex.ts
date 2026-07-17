/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	parseNodeId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import {
	getDocumentNodeChildren,
	type DocumentNode,
	type ManuscriptNode,
} from 'cs/editor/common/model/manuscript';

export interface IDocumentIndexLimits {
	readonly maximumNodes: number;
	readonly maximumDepth: number;
}

export const defaultDocumentIndexLimits: IDocumentIndexLimits = Object.freeze({
	maximumNodes: 100_000,
	maximumDepth: 256,
});

export interface IDocumentNodeParentLocation {
	readonly parentNodeId: NodeId;
	readonly childIndex: number;
}

export type DocumentIndexFailure =
	| {
		readonly reason: 'invalid-limits';
	}
	| {
		readonly reason: 'invalid-node-id';
		readonly nodeId?: string;
		readonly depth: number;
	}
	| {
		readonly reason: 'duplicate-node-id';
		readonly nodeId: NodeId;
		readonly depth: number;
	}
	| {
		readonly reason: 'cyclic-node-reference';
		readonly nodeId: NodeId;
		readonly depth: number;
	}
	| {
		readonly reason: 'node-budget-exceeded';
		readonly maximumNodes: number;
		readonly depth: number;
	}
	| {
		readonly reason: 'node-depth-exceeded';
		readonly maximumDepth: number;
		readonly depth: number;
	};

export type DocumentIndexResult =
	| {
		readonly type: 'ok';
		readonly value: DocumentIndex;
	}
	| {
		readonly type: 'error';
		readonly error: DocumentIndexFailure;
	};

/**
 * Immutable, revision-local document topology.
 *
 * This is a derived lookup index, not hash authority. The owning Snapshot keeps
 * ownership of node payloads; the index owns copies of all topology collections.
 */
export interface DocumentIndex {
	readonly rootNodeId: NodeId;
	readonly nodeCount: number;
	readonly preorderNodeIds: readonly NodeId[];

	hasNode(nodeId: NodeId): boolean;
	getNode(nodeId: NodeId): DocumentNode | undefined;
	getParentLocation(nodeId: NodeId): IDocumentNodeParentLocation | undefined;

	/** Iterates from the root through the requested node, including both. */
	iteratePath(nodeId: NodeId): IterableIterator<NodeId> | undefined;

	/** Iterates from the immediate parent toward the root. */
	iterateAncestors(nodeId: NodeId): IterableIterator<NodeId> | undefined;
}

type TraversalFrame =
	| {
		readonly kind: 'enter';
		readonly node: DocumentNode;
		readonly depth: number;
		readonly parent?: IDocumentNodeParentLocation;
	}
	| {
		readonly kind: 'exit';
		readonly node: DocumentNode;
	};

class ImmutableDocumentIndex implements DocumentIndex {
	readonly rootNodeId: NodeId;
	readonly nodeCount: number;
	readonly preorderNodeIds: readonly NodeId[];

	private readonly nodesById: ReadonlyMap<NodeId, DocumentNode>;
	private readonly parentsById: ReadonlyMap<NodeId, IDocumentNodeParentLocation>;

	constructor(
		rootNodeId: NodeId,
		nodesById: ReadonlyMap<NodeId, DocumentNode>,
		parentsById: ReadonlyMap<NodeId, IDocumentNodeParentLocation>,
		preorderNodeIds: readonly NodeId[],
	) {
		this.rootNodeId = rootNodeId;
		this.nodesById = new Map(nodesById);
		this.parentsById = new Map(parentsById);
		this.preorderNodeIds = Object.freeze([...preorderNodeIds]);
		this.nodeCount = this.preorderNodeIds.length;
		Object.freeze(this);
	}

	hasNode(nodeId: NodeId): boolean {
		return this.nodesById.has(nodeId);
	}

	getNode(nodeId: NodeId): DocumentNode | undefined {
		return this.nodesById.get(nodeId);
	}

	getParentLocation(nodeId: NodeId): IDocumentNodeParentLocation | undefined {
		return this.parentsById.get(nodeId);
	}

	iteratePath(nodeId: NodeId): IterableIterator<NodeId> | undefined {
		return this.nodesById.has(nodeId)
			? iteratePathFromRoot(nodeId, this.parentsById)
			: undefined;
	}

	iterateAncestors(nodeId: NodeId): IterableIterator<NodeId> | undefined {
		return this.nodesById.has(nodeId)
			? iterateNodeAncestors(nodeId, this.parentsById)
			: undefined;
	}
}

/**
 * Builds a revision-local index with iterative DFS and bounded traversal.
 *
 * Node payload validation belongs to the Snapshot decoder. This builder still
 * rechecks canonical Node IDs and rejects topology that cannot be indexed safely.
 */
export function createDocumentIndex(
	root: ManuscriptNode,
	limits: IDocumentIndexLimits = defaultDocumentIndexLimits,
): DocumentIndexResult {
	const copiedLimits = copyLimits(limits);
	if (copiedLimits === undefined) {
		return errorResult({
			reason: 'invalid-limits',
		});
	}

	const nodesById = new Map<NodeId, DocumentNode>();
	const parentsById = new Map<NodeId, IDocumentNodeParentLocation>();
	const preorderNodeIds: NodeId[] = [];
	const activeNodes = new Set<DocumentNode>();
	const pending: TraversalFrame[] = [{
		kind: 'enter',
		node: root,
		depth: 0,
	}];

	while (pending.length > 0) {
		const frame = pending.pop();
		if (frame === undefined) {
			break;
		}

		if (frame.kind === 'exit') {
			activeNodes.delete(frame.node);
			continue;
		}

		if (frame.depth > copiedLimits.maximumDepth) {
			return errorResult({
				reason: 'node-depth-exceeded',
				maximumDepth: copiedLimits.maximumDepth,
				depth: frame.depth,
			});
		}

		const rawNodeId: unknown = frame.node.id;
		if (activeNodes.has(frame.node)) {
			return errorResult({
				reason: 'cyclic-node-reference',
				nodeId: rawNodeId as NodeId,
				depth: frame.depth,
			});
		}

		const parsedNodeId = typeof rawNodeId === 'string'
			? parseNodeId(rawNodeId)
			: undefined;
		if (parsedNodeId === undefined || parsedNodeId.type === 'invalid') {
			return errorResult({
				reason: 'invalid-node-id',
				...(typeof rawNodeId === 'string' ? { nodeId: rawNodeId } : {}),
				depth: frame.depth,
			});
		}
		const nodeId = parsedNodeId.value;

		if (nodesById.has(nodeId)) {
			return errorResult({
				reason: 'duplicate-node-id',
				nodeId,
				depth: frame.depth,
			});
		}

		if (preorderNodeIds.length >= copiedLimits.maximumNodes) {
			return errorResult({
				reason: 'node-budget-exceeded',
				maximumNodes: copiedLimits.maximumNodes,
				depth: frame.depth,
			});
		}

		activeNodes.add(frame.node);
		nodesById.set(nodeId, frame.node);
		preorderNodeIds.push(nodeId);
		if (frame.parent !== undefined) {
			parentsById.set(nodeId, Object.freeze({
				parentNodeId: frame.parent.parentNodeId,
				childIndex: frame.parent.childIndex,
			}));
		}

		const children = [...getDocumentNodeChildren(frame.node)];
		pending.push({
			kind: 'exit',
			node: frame.node,
		});
		for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
			const child = children[childIndex];
			if (child !== undefined) {
				pending.push({
					kind: 'enter',
					node: child,
					depth: frame.depth + 1,
					parent: {
						parentNodeId: nodeId,
						childIndex,
					},
				});
			}
		}
	}

	const rootNodeId = preorderNodeIds[0];
	if (rootNodeId === undefined) {
		throw new Error('The document index traversal did not visit its root node.');
	}

	return Object.freeze({
		type: 'ok',
		value: new ImmutableDocumentIndex(
			rootNodeId,
			nodesById,
			parentsById,
			preorderNodeIds,
		),
	});
}

function copyLimits(
	limits: IDocumentIndexLimits,
): IDocumentIndexLimits | undefined {
	const maximumNodes = limits.maximumNodes;
	const maximumDepth = limits.maximumDepth;
	if (
		!Number.isSafeInteger(maximumNodes)
		|| maximumNodes < 0
		|| !Number.isSafeInteger(maximumDepth)
		|| maximumDepth < 0
	) {
		return undefined;
	}

	return {
		maximumNodes,
		maximumDepth,
	};
}

function* iteratePathFromRoot(
	nodeId: NodeId,
	parentsById: ReadonlyMap<NodeId, IDocumentNodeParentLocation>,
): IterableIterator<NodeId> {
	const reversedPath: NodeId[] = [nodeId];
	let current = parentsById.get(nodeId);
	while (current !== undefined) {
		reversedPath.push(current.parentNodeId);
		current = parentsById.get(current.parentNodeId);
	}

	for (let index = reversedPath.length - 1; index >= 0; index -= 1) {
		const currentNodeId = reversedPath[index];
		if (currentNodeId !== undefined) {
			yield currentNodeId;
		}
	}
}

function* iterateNodeAncestors(
	nodeId: NodeId,
	parentsById: ReadonlyMap<NodeId, IDocumentNodeParentLocation>,
): IterableIterator<NodeId> {
	let current = parentsById.get(nodeId);
	while (current !== undefined) {
		yield current.parentNodeId;
		current = parentsById.get(current.parentNodeId);
	}
}

function errorResult(
	error: DocumentIndexFailure,
): Extract<DocumentIndexResult, { readonly type: 'error' }> {
	return Object.freeze({
		type: 'error',
		error: Object.freeze(error),
	});
}
