/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	parseNodeId,
	parseRevisionId,
	type NodeId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type INodeBoundaryPosition,
	type ITextPosition,
	type SemanticPosition,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import {
	createPositionMap,
	type IPositionMap,
	type MappingResult,
	type PositionMapFragment,
} from 'cs/editor/common/model/positionMap';

const resource = createManuscriptDraftResource(
	'018f0000-0000-7000-8000-000000000001',
);
const otherResource = createManuscriptDraftResource(
	'018f0000-0000-7000-8000-000000000002',
);
const revisionOne = revisionId(1);
const revisionTwo = revisionId(2);
const revisionThree = revisionId(3);
const revisionFour = revisionId(4);
const revisionFive = revisionId(5);
const textNodeId = nodeId(101);
const otherTextNodeId = nodeId(102);
const parentNodeId = nodeId(103);
const otherParentNodeId = nodeId(104);
const firstChildNodeId = nodeId(105);
const secondChildNodeId = nodeId(106);
const descendantNodeId = nodeId(107);
const rightTextNodeId = nodeId(108);
const aliasNodeId = nodeId(109);

function createMap(
	fragments: readonly [PositionMapFragment, ...PositionMapFragment[]],
	fromRevisionId = revisionOne,
	toRevisionId = revisionTwo,
): IPositionMap {
	return createPositionMap({
		resource,
		fromRevisionId,
		toRevisionId,
		fragments,
	});
}

function textPosition(
	utf16Offset: number,
	affinity: ITextPosition['affinity'],
	node = textNodeId,
): ITextPosition {
	return {
		kind: 'text',
		textNodeId: node,
		utf16Offset: offset(utf16Offset),
		affinity,
	};
}

function nodeBoundary(
	childIndex: number,
	affinity: INodeBoundaryPosition['affinity'],
	parent = parentNodeId,
): INodeBoundaryPosition {
	return {
		kind: 'node-boundary',
		parentNodeId: parent,
		childIndex,
		affinity,
	};
}

function mapped<TValue>(value: TValue): MappingResult<TValue> {
	return {
		status: 'mapped',
		value,
	};
}

function deleted<TValue>(nearest?: TValue): MappingResult<TValue> {
	return nearest === undefined
		? { status: 'deleted' }
		: { status: 'deleted', nearest };
}

function ambiguous<TValue>(
	candidates: readonly [TValue, ...TValue[]],
): MappingResult<TValue> {
	return {
		status: 'ambiguous',
		candidates,
	};
}

function offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test UTF-16 offset.');
	}
	return parsed.value;
}

function nodeId(sequence: number): NodeId {
	const parsed = parseNodeId(
		`018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function revisionId(sequence: number): RevisionId {
	const parsed = parseRevisionId(
		`018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Revision ID.');
	}
	return parsed.value;
}

class TestPositionMap implements IPositionMap {
	constructor(
		readonly resource: URI,
		readonly fromRevisionId: RevisionId,
		readonly toRevisionId: RevisionId,
		private readonly positionMapper: (
			position: SemanticPosition,
		) => MappingResult<SemanticPosition> = mapped,
		private readonly nodeMapper: (nodeId: NodeId) => MappingResult<NodeId> = mapped,
	) {}

	mapPosition(position: SemanticPosition): MappingResult<SemanticPosition> {
		return this.positionMapper(position);
	}

	mapNodeId(nodeId: NodeId): MappingResult<NodeId> {
		return this.nodeMapper(nodeId);
	}

	compose(): IPositionMap {
		throw new Error('Test maps are composed through a production map.');
	}
}

function identitySeed(): IPositionMap {
	return createMap(
		[{
			kind: 'text-replace',
			textNodeId: otherTextNodeId,
			startUtf16Offset: offset(0),
			endUtf16Offset: offset(0),
			replacementUtf16Length: 0,
		}],
		revisionOne,
		revisionTwo,
	);
}

function composePositionMappers(
	first: (position: SemanticPosition) => MappingResult<SemanticPosition>,
	next: (position: SemanticPosition) => MappingResult<SemanticPosition>,
): IPositionMap {
	return identitySeed()
		.compose(new TestPositionMap(
			resource,
			revisionTwo,
			revisionThree,
			first,
		))
		.compose(new TestPositionMap(
			resource,
			revisionThree,
			revisionFour,
			next,
		));
}

function composeNodeMappers(
	first: (nodeId: NodeId) => MappingResult<NodeId>,
	next: (nodeId: NodeId) => MappingResult<NodeId>,
): IPositionMap {
	return identitySeed()
		.compose(new TestPositionMap(
			resource,
			revisionTwo,
			revisionThree,
			mapped,
			first,
		))
		.compose(new TestPositionMap(
			resource,
			revisionThree,
			revisionFour,
			mapped,
			next,
		));
}

suite('PositionMap', () => {
	test('maps text replacement endpoints, affinities, deletion, and UTF-16 lengths', () => {
		const insertion = createMap([{
			kind: 'text-replace',
			textNodeId,
			startUtf16Offset: offset(3),
			endUtf16Offset: offset(3),
			replacementUtf16Length: '😀'.length,
		}]);

		assert.deepStrictEqual(
			insertion.mapPosition(textPosition(3, 'before')),
			mapped(textPosition(3, 'before')),
		);
		assert.deepStrictEqual(
			insertion.mapPosition(textPosition(3, 'after')),
			mapped(textPosition(5, 'after')),
		);
		assert.deepStrictEqual(
			insertion.mapPosition(textPosition(7, 'before')),
			mapped(textPosition(9, 'before')),
		);

		const replacement = createMap([{
			kind: 'text-replace',
			textNodeId,
			startUtf16Offset: offset(4),
			endUtf16Offset: offset(8),
			replacementUtf16Length: 2,
		}]);

		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(4, 'before')),
			mapped(textPosition(4, 'before')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(4, 'after')),
			mapped(textPosition(6, 'after')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(8, 'before')),
			mapped(textPosition(4, 'before')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(8, 'after')),
			mapped(textPosition(6, 'after')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(6, 'before')),
			deleted(textPosition(4, 'before')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(6, 'after')),
			deleted(textPosition(6, 'after')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(10, 'after')),
			mapped(textPosition(8, 'after')),
		);
		assert.deepStrictEqual(
			replacement.mapPosition(textPosition(10, 'after', otherTextNodeId)),
			mapped(textPosition(10, 'after', otherTextNodeId)),
		);
	});

	test('maps child insertion and deletion boundaries and subtree identities', () => {
		const insertion = createMap([{
			kind: 'child-insert',
			parentNodeId,
			childIndex: 2,
			insertedChildCount: 2,
			insertedNodeIds: [firstChildNodeId, secondChildNodeId, descendantNodeId],
		}]);

		assert.deepStrictEqual(
			insertion.mapPosition(nodeBoundary(2, 'before')),
			mapped(nodeBoundary(2, 'before')),
		);
		assert.deepStrictEqual(
			insertion.mapPosition(nodeBoundary(2, 'after')),
			mapped(nodeBoundary(4, 'after')),
		);
		assert.deepStrictEqual(
			insertion.mapPosition(nodeBoundary(5, 'before')),
			mapped(nodeBoundary(7, 'before')),
		);
		assert.deepStrictEqual(
			insertion.mapPosition(textPosition(0, 'after', descendantNodeId)),
			{ status: 'orphaned' },
		);
		assert.deepStrictEqual(
			insertion.mapNodeId(firstChildNodeId),
			{ status: 'orphaned' },
		);

		const deletion = createMap([{
			kind: 'child-delete',
			parentNodeId,
			childIndex: 1,
			deletedChildCount: 2,
			deletedNodeIds: [firstChildNodeId, secondChildNodeId, descendantNodeId],
		}]);

		assert.deepStrictEqual(
			deletion.mapPosition(nodeBoundary(1, 'after')),
			mapped(nodeBoundary(1, 'after')),
		);
		assert.deepStrictEqual(
			deletion.mapPosition(nodeBoundary(3, 'before')),
			mapped(nodeBoundary(1, 'before')),
		);
		assert.deepStrictEqual(
			deletion.mapPosition(nodeBoundary(2, 'before')),
			deleted(nodeBoundary(1, 'before')),
		);
		assert.deepStrictEqual(
			deletion.mapPosition(nodeBoundary(5, 'after')),
			mapped(nodeBoundary(3, 'after')),
		);
		assert.deepStrictEqual(
			deletion.mapPosition(textPosition(4, 'after', descendantNodeId)),
			deleted(nodeBoundary(1, 'after')),
		);
		assert.deepStrictEqual(deletion.mapNodeId(secondChildNodeId), deleted());
	});

	test('maps cross-parent and same-parent child moves without changing moved identities', () => {
		const crossParentMove = createMap([{
			kind: 'child-move',
			sourceParentNodeId: parentNodeId,
			sourceChildIndex: 2,
			destinationParentNodeId: otherParentNodeId,
			destinationChildIndexAfterRemoval: 1,
			movedChildCount: 2,
			movedNodeIds: [firstChildNodeId, secondChildNodeId, descendantNodeId],
		}]);

		assert.deepStrictEqual(
			crossParentMove.mapPosition(nodeBoundary(2, 'before')),
			mapped(nodeBoundary(2, 'before')),
		);
		assert.deepStrictEqual(
			crossParentMove.mapPosition(nodeBoundary(2, 'after')),
			mapped(nodeBoundary(1, 'after', otherParentNodeId)),
		);
		assert.deepStrictEqual(
			crossParentMove.mapPosition(nodeBoundary(3, 'before')),
			mapped(nodeBoundary(2, 'before', otherParentNodeId)),
		);
		assert.deepStrictEqual(
			crossParentMove.mapPosition(nodeBoundary(4, 'before')),
			mapped(nodeBoundary(3, 'before', otherParentNodeId)),
		);
		assert.deepStrictEqual(
			crossParentMove.mapPosition(nodeBoundary(4, 'after')),
			mapped(nodeBoundary(2, 'after')),
		);
		assert.deepStrictEqual(
			crossParentMove.mapPosition(nodeBoundary(1, 'after', otherParentNodeId)),
			mapped(nodeBoundary(3, 'after', otherParentNodeId)),
		);
		assert.deepStrictEqual(
			crossParentMove.mapPosition(textPosition(3, 'before', descendantNodeId)),
			mapped(textPosition(3, 'before', descendantNodeId)),
		);
		assert.deepStrictEqual(
			crossParentMove.mapNodeId(firstChildNodeId),
			mapped(firstChildNodeId),
		);

		const sameParentMove = createMap([{
			kind: 'child-move',
			sourceParentNodeId: parentNodeId,
			sourceChildIndex: 1,
			destinationParentNodeId: parentNodeId,
			destinationChildIndexAfterRemoval: 4,
			movedChildCount: 2,
			movedNodeIds: [firstChildNodeId, secondChildNodeId],
		}]);

		assert.deepStrictEqual(
			sameParentMove.mapPosition(nodeBoundary(1, 'before')),
			mapped(nodeBoundary(1, 'before')),
		);
		assert.deepStrictEqual(
			sameParentMove.mapPosition(nodeBoundary(1, 'after')),
			mapped(nodeBoundary(4, 'after')),
		);
		assert.deepStrictEqual(
			sameParentMove.mapPosition(nodeBoundary(3, 'before')),
			mapped(nodeBoundary(6, 'before')),
		);
		assert.deepStrictEqual(
			sameParentMove.mapPosition(nodeBoundary(3, 'after')),
			mapped(nodeBoundary(1, 'after')),
		);
		assert.deepStrictEqual(
			sameParentMove.mapPosition(nodeBoundary(6, 'after')),
			mapped(nodeBoundary(6, 'after')),
		);
	});

	test('maps text splits, joins, aliases, and tombstones', () => {
		const split = createMap([{
			kind: 'text-split',
			parentNodeId,
			childIndex: 2,
			leftTextNodeId: textNodeId,
			rightTextNodeId,
			splitUtf16Offset: offset(5),
		}]);

		assert.deepStrictEqual(
			split.mapPosition(textPosition(5, 'before')),
			mapped(textPosition(5, 'before')),
		);
		assert.deepStrictEqual(
			split.mapPosition(textPosition(5, 'after')),
			mapped(textPosition(0, 'after', rightTextNodeId)),
		);
		assert.deepStrictEqual(
			split.mapPosition(textPosition(8, 'before')),
			mapped(textPosition(3, 'before', rightTextNodeId)),
		);
		assert.deepStrictEqual(
			split.mapPosition(textPosition(0, 'before', rightTextNodeId)),
			{ status: 'orphaned' },
		);
		assert.deepStrictEqual(split.mapNodeId(rightTextNodeId), { status: 'orphaned' });
		assert.deepStrictEqual(split.mapNodeId(textNodeId), mapped(textNodeId));
		assert.deepStrictEqual(
			split.mapPosition(nodeBoundary(3, 'before')),
			mapped(nodeBoundary(4, 'before')),
		);

		const join = createMap([{
			kind: 'text-join',
			parentNodeId,
			leftChildIndex: 2,
			leftTextNodeId: textNodeId,
			rightTextNodeId,
			leftUtf16Length: 5,
		}]);

		assert.deepStrictEqual(
			join.mapPosition(textPosition(2, 'after', rightTextNodeId)),
			mapped(textPosition(7, 'after')),
		);
		assert.deepStrictEqual(join.mapNodeId(rightTextNodeId), mapped(textNodeId));
		assert.deepStrictEqual(
			join.mapPosition(nodeBoundary(3, 'before')),
			mapped(textPosition(5, 'before')),
		);
		assert.deepStrictEqual(
			join.mapPosition(nodeBoundary(4, 'after')),
			mapped(nodeBoundary(3, 'after')),
		);
		assert.deepStrictEqual(
			join.mapPosition(nodeBoundary(4, 'after', rightTextNodeId)),
			mapped(nodeBoundary(4, 'after', textNodeId)),
		);

		const composed = split.compose(createMap(
			[{
				kind: 'text-join',
				parentNodeId,
				leftChildIndex: 2,
				leftTextNodeId: textNodeId,
				rightTextNodeId,
				leftUtf16Length: 5,
			}],
			revisionTwo,
			revisionThree,
		));
		assert.deepStrictEqual(
			composed.mapPosition(textPosition(8, 'after')),
			mapped(textPosition(8, 'after')),
		);

		const aliasAndTombstone = createMap([
			{
				kind: 'node-alias',
				sourceNodeId: textNodeId,
				targetNodeId: aliasNodeId,
			},
			{
				kind: 'node-tombstone',
				nodeId: aliasNodeId,
				nearest: nodeBoundary(2, 'after'),
			},
		]);
		assert.deepStrictEqual(
			aliasAndTombstone.mapPosition(textPosition(1, 'after')),
			deleted(nodeBoundary(2, 'after')),
		);
		assert.deepStrictEqual(aliasAndTombstone.mapNodeId(textNodeId), deleted());
	});

	test('applies mixed fragments in their declared coordinate order', () => {
		const positionMap = createMap([
			{
				kind: 'text-replace',
				textNodeId,
				startUtf16Offset: offset(3),
				endUtf16Offset: offset(3),
				replacementUtf16Length: 2,
			},
			{
				kind: 'text-split',
				parentNodeId,
				childIndex: 0,
				leftTextNodeId: textNodeId,
				rightTextNodeId,
				splitUtf16Offset: offset(5),
			},
			{
				kind: 'node-alias',
				sourceNodeId: rightTextNodeId,
				targetNodeId: aliasNodeId,
			},
		]);

		assert.deepStrictEqual(
			positionMap.mapPosition(textPosition(3, 'after')),
			mapped(textPosition(0, 'after', aliasNodeId)),
		);
		assert.deepStrictEqual(
			positionMap.mapPosition(textPosition(8, 'before')),
			mapped(textPosition(5, 'before', aliasNodeId)),
		);
	});

	test('implements the complete position-result composition truth table', () => {
		const input = textPosition(0, 'before');
		const candidateA = textPosition(1, 'before');
		const candidateB = textPosition(2, 'after');
		const candidateC = textPosition(3, 'before');
		const candidateD = textPosition(4, 'after');

		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				() => mapped(candidateC),
			).mapPosition(input),
			mapped(candidateC),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				mapped,
			).mapPosition(input),
			ambiguous([candidateA, candidateB]),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				candidate => candidate === candidateA
					? mapped(candidateC)
					: deleted(candidateC),
			).mapPosition(input),
			ambiguous([candidateC]),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				() => deleted(candidateC),
			).mapPosition(input),
			deleted(candidateC),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				candidate => candidate === candidateA
					? deleted(candidateC)
					: deleted(candidateD),
			).mapPosition(input),
			deleted(),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				candidate => candidate === candidateA
					? deleted(candidateC)
					: { status: 'orphaned' },
			).mapPosition(input),
			{ status: 'orphaned' },
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => deleted(candidateA),
				() => mapped(candidateC),
			).mapPosition(input),
			deleted(candidateC),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => deleted(candidateA),
				() => ambiguous([candidateC, candidateD]),
			).mapPosition(input),
			deleted(),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ({ status: 'orphaned' }),
				() => mapped(candidateC),
			).mapPosition(input),
			{ status: 'orphaned' },
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA, candidateB]),
				candidate => candidate === candidateA
					? ambiguous([candidateC, candidateD])
					: mapped(candidateC),
			).mapPosition(input),
			ambiguous([candidateC, candidateD]),
		);
		assert.deepStrictEqual(
			composePositionMappers(
				() => ambiguous([candidateA]),
				() => mapped(candidateC),
			).mapPosition(input),
			mapped(candidateC),
		);

		const partiallyDeleted = composePositionMappers(
			() => ambiguous([candidateA, candidateB]),
			candidate => candidate === candidateA
				? mapped(candidateC)
				: deleted(candidateC),
		);
		assert.deepStrictEqual(
			partiallyDeleted.mapPosition(input),
			ambiguous([candidateC]),
		);
		assert.deepStrictEqual(
			partiallyDeleted
				.compose(new TestPositionMap(
					resource,
					revisionFour,
					revisionFive,
					() => mapped(candidateD),
				))
				.mapPosition(input),
			mapped(candidateD),
		);
	});

	test('uses the same composition truth table for node identities', () => {
		assert.deepStrictEqual(
			composeNodeMappers(
				() => ambiguous([firstChildNodeId, secondChildNodeId]),
				() => mapped(aliasNodeId),
			).mapNodeId(textNodeId),
			mapped(aliasNodeId),
		);
		assert.deepStrictEqual(
			composeNodeMappers(
				() => ambiguous([firstChildNodeId, secondChildNodeId]),
				node => node === firstChildNodeId
					? mapped(aliasNodeId)
					: deleted(aliasNodeId),
			).mapNodeId(textNodeId),
			ambiguous([aliasNodeId]),
		);
		assert.deepStrictEqual(
			composeNodeMappers(
				() => ambiguous([firstChildNodeId, secondChildNodeId]),
				() => deleted(aliasNodeId),
			).mapNodeId(textNodeId),
			deleted(aliasNodeId),
		);
		assert.deepStrictEqual(
			composeNodeMappers(
				() => deleted(firstChildNodeId),
				() => mapped(aliasNodeId),
			).mapNodeId(textNodeId),
			deleted(aliasNodeId),
		);
	});

	test('rejects composition across resources or revision gaps', () => {
		const first = identitySeed();
		const nonAdjacent = new TestPositionMap(
			resource,
			revisionThree,
			revisionFour,
		);
		assert.throws(
			() => first.compose(nonAdjacent),
			/Cannot compose position maps with non-adjacent revisions/u,
		);

		const otherResourceMap = new TestPositionMap(
			otherResource,
			revisionTwo,
			revisionThree,
		);
		assert.throws(
			() => first.compose(otherResourceMap),
			/Cannot compose position maps for different resources/u,
		);
	});

	test('maps 20,000 composed fragments without recursive stack growth', () => {
		const mapCount = 20_000;
		let composed = createMap(
			[{
				kind: 'text-replace',
				textNodeId,
				startUtf16Offset: offset(0),
				endUtf16Offset: offset(0),
				replacementUtf16Length: 1,
			}],
			revisionId(0),
			revisionId(1),
		);
		for (let index = 1; index < mapCount; index += 1) {
			composed = composed.compose(createMap(
				[{
					kind: 'text-replace',
					textNodeId,
					startUtf16Offset: offset(index),
					endUtf16Offset: offset(index),
					replacementUtf16Length: 1,
				}],
				revisionId(index),
				revisionId(index + 1),
			));
		}

		assert.equal(composed.fromRevisionId, revisionId(0));
		assert.equal(composed.toRevisionId, revisionId(mapCount));
		assert.deepStrictEqual(
			composed.mapPosition(textPosition(0, 'after')),
			mapped(textPosition(mapCount, 'after')),
		);
		assert.deepStrictEqual(
			composed.mapPosition(textPosition(7, 'after', otherTextNodeId)),
			mapped(textPosition(7, 'after', otherTextNodeId)),
		);
	});

	test('validates map metadata and fragment invariants', () => {
		const capturedResourceMap = identitySeed();
		assert.notEqual(capturedResourceMap.resource, resource);
		assert.equal(capturedResourceMap.resource.toString(), resource.toString());

		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [{
				resource: URI.parse('file:///tmp/manuscript'),
				fromRevisionId: revisionOne,
				toRevisionId: revisionTwo,
				fragments: [{
					kind: 'node-alias',
					sourceNodeId: textNodeId,
					targetNodeId: aliasNodeId,
				}],
			}]),
			/resource must be a canonical manuscript URI/u,
		);
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [{
				resource,
				fromRevisionId: 'revision-one',
				toRevisionId: revisionTwo,
				fragments: [{
					kind: 'node-alias',
					sourceNodeId: textNodeId,
					targetNodeId: aliasNodeId,
				}],
			}]),
			/revisions must be canonical UUIDv7/u,
		);
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [{
				resource,
				fromRevisionId: revisionOne,
				toRevisionId: revisionOne,
				fragments: [{
					kind: 'node-alias',
					sourceNodeId: textNodeId,
					targetNodeId: aliasNodeId,
				}],
			}]),
			/must advance to a distinct Revision/u,
		);
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [{
				resource,
				fromRevisionId: revisionOne,
				toRevisionId: revisionTwo,
				fragments: [],
			}]),
			/requires at least one fragment/u,
		);
		assert.throws(
			() => createMap([{
				kind: 'child-insert',
				parentNodeId,
				childIndex: 0,
				insertedChildCount: 2,
				insertedNodeIds: [firstChildNodeId],
			}]),
			/must not exceed the listed subtree identity count/u,
		);
		assert.throws(
			() => createMap([{
				kind: 'child-delete',
				parentNodeId,
				childIndex: 0,
				deletedChildCount: 1,
				deletedNodeIds: [firstChildNodeId, firstChildNodeId],
			}]),
			/must not contain duplicates/u,
		);
		assert.throws(
			() => createMap([{
				kind: 'child-insert',
				parentNodeId,
				childIndex: 0,
				insertedChildCount: 1,
				insertedNodeIds: [parentNodeId],
			}]),
			/must not include their parent/u,
		);
		assert.throws(
			() => createMap([{
				kind: 'node-alias',
				sourceNodeId: textNodeId,
				targetNodeId: textNodeId,
			}]),
			/identities must be distinct/u,
		);
		assert.throws(
			() => createMap([{
				kind: 'text-replace',
				textNodeId,
				startUtf16Offset: offset(1),
				endUtf16Offset: offset(1),
				replacementUtf16Length: Number.MAX_SAFE_INTEGER,
			}]),
			/Text replacement end must be a non-negative safe integer/u,
		);
		assert.deepStrictEqual(
			Reflect.apply(identitySeed().mapPosition, identitySeed(), [{
				kind: 'text',
				textNodeId: 'not-a-node-id',
				utf16Offset: 0,
				affinity: 'after',
			}]),
			{ status: 'orphaned' },
		);
	});

	test('accepts only exact closed-data fragment inputs without invoking accessors or map', () => {
		const options = (fragments: unknown) => ({
			resource,
			fromRevisionId: revisionOne,
			toRevisionId: revisionTwo,
			fragments,
		});
		const extraFieldFragment = {
			kind: 'node-alias',
			sourceNodeId: textNodeId,
			targetNodeId: aliasNodeId,
			extra: true,
		};
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([extraFieldFragment]),
			]),
			/must contain exactly the declared properties/u,
		);

		const symbolFragment = {
			kind: 'node-alias',
			sourceNodeId: textNodeId,
			targetNodeId: aliasNodeId,
		};
		Object.defineProperty(symbolFragment, Symbol('extra'), {
			enumerable: true,
			value: true,
		});
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([symbolFragment]),
			]),
			/must not contain symbol properties/u,
		);

		let getterCalls = 0;
		const accessorFragment = {
			kind: 'node-alias',
			sourceNodeId: textNodeId,
		};
		Object.defineProperty(accessorFragment, 'targetNodeId', {
			enumerable: true,
			get: () => {
				getterCalls += 1;
				return aliasNodeId;
			},
		});
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([accessorFragment]),
			]),
			/properties must be enumerable data properties/u,
		);
		assert.equal(getterCalls, 0);

		let mapCalls = 0;
		const mapPoisonedNodeIds = [firstChildNodeId, secondChildNodeId];
		Object.defineProperty(mapPoisonedNodeIds, 'map', {
			enumerable: true,
			value: () => {
				mapCalls += 1;
				throw new Error('The caller-owned map method must not run.');
			},
		});
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([{
					kind: 'child-insert',
					parentNodeId,
					childIndex: 0,
					insertedChildCount: 2,
					insertedNodeIds: mapPoisonedNodeIds,
				}]),
			]),
			/must be dense and contain no extra properties/u,
		);
		assert.equal(mapCalls, 0);
	});

	test('rejects revoked and active Proxy fragments and sparse node identity arrays', () => {
		const options = (fragments: unknown) => ({
			resource,
			fromRevisionId: revisionOne,
			toRevisionId: revisionTwo,
			fragments,
		});
		const revocable = Proxy.revocable({
			kind: 'node-alias',
			sourceNodeId: textNodeId,
			targetNodeId: aliasNodeId,
		}, {});
		revocable.revoke();
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([revocable.proxy]),
			]),
			/must be an inspectable closed-data object/u,
		);

		const activeProxy = new Proxy({
			kind: 'node-alias',
			sourceNodeId: textNodeId,
			targetNodeId: aliasNodeId,
		}, {});
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([activeProxy]),
			]),
			/must not contain a Proxy/u,
		);

		const sparseNodeIds = new Array<NodeId>(3);
		sparseNodeIds[0] = firstChildNodeId;
		sparseNodeIds[2] = secondChildNodeId;
		assert.throws(
			() => Reflect.apply(createPositionMap, undefined, [
				options([{
					kind: 'child-insert',
					parentNodeId,
					childIndex: 0,
					insertedChildCount: 2,
					insertedNodeIds: sparseNodeIds,
				}]),
			]),
			/must be dense and contain no extra properties/u,
		);
	});

	test('rejects tombstone nearest positions that reference the tombstoned node', () => {
		assert.throws(
			() => createMap([{
				kind: 'node-tombstone',
				nodeId: textNodeId,
				nearest: textPosition(0, 'before'),
			}]),
			/must not reference the tombstoned node/u,
		);
		assert.throws(
			() => createMap([{
				kind: 'node-tombstone',
				nodeId: parentNodeId,
				nearest: nodeBoundary(0, 'after'),
			}]),
			/must not reference the tombstoned node/u,
		);
	});

	test('copies and freezes fragment inputs before mapping', () => {
		const insertedNodeIds: [NodeId, NodeId] = [
			firstChildNodeId,
			secondChildNodeId,
		];
		const fragment = {
			kind: 'child-insert' as const,
			parentNodeId,
			childIndex: 2,
			insertedChildCount: 2,
			insertedNodeIds,
		};
		const fragments: PositionMapFragment[] = [fragment];
		const positionMap = createPositionMap({
			resource,
			fromRevisionId: revisionOne,
			toRevisionId: revisionTwo,
			fragments: fragments as [PositionMapFragment, ...PositionMapFragment[]],
		});

		fragment.childIndex = 8;
		insertedNodeIds[0] = aliasNodeId;
		fragments[0] = {
			kind: 'node-tombstone',
			nodeId: textNodeId,
		};

		assert.deepStrictEqual(
			positionMap.mapPosition(nodeBoundary(2, 'after')),
			mapped(nodeBoundary(4, 'after')),
		);
		assert.deepStrictEqual(
			positionMap.mapNodeId(firstChildNodeId),
			{ status: 'orphaned' },
		);
		assert.deepStrictEqual(
			positionMap.mapNodeId(aliasNodeId),
			mapped(aliasNodeId),
		);
	});
});
