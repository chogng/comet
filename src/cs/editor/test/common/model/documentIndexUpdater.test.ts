/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	parseNodeId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import {
	createDocumentIndex,
	type DocumentIndex,
} from 'cs/editor/common/model/documentIndex';
import {
	createNormalizedDocumentIndex,
	type IDocumentIndexNormalizationParentChange,
} from 'cs/editor/common/model/documentIndexUpdater';
import type {
	BodyNode,
	ManuscriptNode,
	ParagraphNode,
	TextNode,
} from 'cs/editor/common/model/manuscript';

function nodeId(sequence: number): NodeId {
	const parsed = parseNodeId(
		`018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function text(sequence: number, value: string): TextNode {
	return Object.freeze({
		id: nodeId(sequence),
		type: 'text',
		value,
		marks: Object.freeze([]),
	});
}

function requireIndex(root: ManuscriptNode): DocumentIndex {
	const result = createDocumentIndex(root);
	if (result.type === 'error') {
		throw new Error(`Expected a document index, received ${result.error.reason}.`);
	}
	return result.value;
}

suite('Incremental document index updater', () => {
	test('applies one normalization removal/join batch without rebuilding the base index', () => {
		const left = text(4, 'left');
		const empty = text(5, '');
		const right = text(6, ' right');
		const trailing = text(7, 'tail');
		const previousChildren = Object.freeze([
			left,
			empty,
			right,
			trailing,
		]);
		const paragraph: ParagraphNode = Object.freeze({
			id: nodeId(3),
			type: 'paragraph',
			attrs: Object.freeze({ alignment: 'start' }),
			children: previousChildren,
		});
		const body: BodyNode = Object.freeze({
			id: nodeId(2),
			type: 'body',
			attrs: Object.freeze({}),
			children: Object.freeze([paragraph] as const),
		});
		const root: ManuscriptNode = Object.freeze({
			id: nodeId(1),
			type: 'manuscript',
			attrs: Object.freeze({}),
			children: Object.freeze([body] as const),
		});
		const base = requireIndex(root);

		const joinedLeft = text(4, 'left right');
		const normalizedChildren = Object.freeze([joinedLeft, trailing]);
		const normalizedParagraph: ParagraphNode = Object.freeze({
			...paragraph,
			children: normalizedChildren,
		});
		const normalizedBody: BodyNode = Object.freeze({
			...body,
			children: Object.freeze([normalizedParagraph] as const),
		});
		const normalizedRoot: ManuscriptNode = Object.freeze({
			...root,
			children: Object.freeze([normalizedBody] as const),
		});
		const changedParents = Object.freeze([Object.freeze({
			parentNodeId: paragraph.id,
			previousChildren,
			normalizedChildren,
		})]);
		const rehashNodeIds = Object.freeze([
			left.id,
			paragraph.id,
			body.id,
			root.id,
		]);
		let replayedEdits = 0;
		let visitedChunks = 0;
		const normalizedIndex = createNormalizedDocumentIndex({
			base,
			targetRoot: normalizedRoot,
			changedParents,
			rehashNodeIds,
			instrumentation: {
				onParentOrdinalEditsReplayed: (_parentNodeId, count) => {
					replayedEdits += count;
				},
				onParentOrdinalEditChunksVisited: (_parentNodeId, count) => {
					visitedChunks += count;
				},
			},
		});
		assert.notEqual(normalizedIndex, undefined);
		if (normalizedIndex === undefined) {
			throw new Error('Expected a normalized document index.');
		}

		assert.equal(normalizedIndex.nodeCount, base.nodeCount - 2);
		assert.equal(normalizedIndex.getNode(root.id), normalizedRoot);
		assert.equal(normalizedIndex.getNode(body.id), normalizedBody);
		assert.equal(normalizedIndex.getNode(paragraph.id), normalizedParagraph);
		assert.equal(normalizedIndex.getNode(left.id), joinedLeft);
		assert.equal(normalizedIndex.hasNode(empty.id), false);
		assert.equal(normalizedIndex.hasNode(right.id), false);
		assert.deepStrictEqual(
			normalizedIndex.getParentLocation(trailing.id),
			{
				parentNodeId: paragraph.id,
				childIndex: 1,
			},
		);
		assert.equal(replayedEdits, 2);
		assert.equal(visitedChunks, 1);
		assert.deepStrictEqual(normalizedIndex.preorderNodeIds, [
			root.id,
			body.id,
			paragraph.id,
			left.id,
			trailing.id,
		]);

		assert.equal(base.nodeCount, 7);
		assert.equal(base.getNode(root.id), root);
		assert.deepStrictEqual(base.getParentLocation(trailing.id), {
			parentNodeId: paragraph.id,
			childIndex: 3,
		});

		for (const invalidRehashNodeIds of [
			Object.freeze([paragraph.id, left.id, body.id, root.id]),
			Object.freeze([left.id, body.id, root.id]),
			Object.freeze([
				left.id,
				paragraph.id,
				paragraph.id,
				body.id,
				root.id,
			]),
		]) {
			assert.equal(createNormalizedDocumentIndex({
				base,
				targetRoot: normalizedRoot,
				changedParents,
				rehashNodeIds: invalidRehashNodeIds,
			}), undefined);
		}
	});

	test('rejects non-exact parent checkpoints and non-removal topology', () => {
		const first = text(13, 'first');
		const second = text(14, 'second');
		const previousChildren = Object.freeze([first, second]);
		const paragraph: ParagraphNode = Object.freeze({
			id: nodeId(12),
			type: 'paragraph',
			attrs: Object.freeze({ alignment: 'start' }),
			children: previousChildren,
		});
		const body: BodyNode = Object.freeze({
			id: nodeId(11),
			type: 'body',
			attrs: Object.freeze({}),
			children: Object.freeze([paragraph] as const),
		});
		const root: ManuscriptNode = Object.freeze({
			id: nodeId(10),
			type: 'manuscript',
			attrs: Object.freeze({}),
			children: Object.freeze([body] as const),
		});
		const base = requireIndex(root);
		const normalizedChildren = Object.freeze([first]);
		const normalizedParagraph: ParagraphNode = Object.freeze({
			...paragraph,
			children: normalizedChildren,
		});
		const normalizedBody: BodyNode = Object.freeze({
			...body,
			children: Object.freeze([normalizedParagraph] as const),
		});
		const normalizedRoot: ManuscriptNode = Object.freeze({
			...root,
			children: Object.freeze([normalizedBody] as const),
		});

		assert.equal(createNormalizedDocumentIndex({
			base,
			targetRoot: normalizedRoot,
			changedParents: Object.freeze([Object.freeze({
				parentNodeId: paragraph.id,
				previousChildren: Object.freeze([...previousChildren]),
				normalizedChildren,
			})]),
			rehashNodeIds: Object.freeze([
				paragraph.id,
				body.id,
				root.id,
			]),
		}), undefined);

		const inserted = text(15, 'inserted');
		const insertedChildren = Object.freeze([first, inserted]);
		const insertedParagraph: ParagraphNode = Object.freeze({
			...paragraph,
			children: insertedChildren,
		});
		const insertedBody: BodyNode = Object.freeze({
			...body,
			children: Object.freeze([insertedParagraph] as const),
		});
		const insertedRoot: ManuscriptNode = Object.freeze({
			...root,
			children: Object.freeze([insertedBody] as const),
		});
		assert.equal(createNormalizedDocumentIndex({
			base,
			targetRoot: insertedRoot,
			changedParents: Object.freeze([Object.freeze({
				parentNodeId: paragraph.id,
				previousChildren,
				normalizedChildren: insertedChildren,
			})]),
			rehashNodeIds: Object.freeze([
				paragraph.id,
				body.id,
				root.id,
			]),
		}), undefined);

		assert.equal(createNormalizedDocumentIndex({
			base,
			targetRoot: normalizedRoot,
			changedParents: [{
				parentNodeId: paragraph.id,
				previousChildren,
				normalizedChildren,
			}],
			rehashNodeIds: Object.freeze([
				paragraph.id,
				body.id,
				root.id,
			]),
		}), undefined);
		assert.equal(createNormalizedDocumentIndex({
			base,
			targetRoot: normalizedRoot,
			changedParents: Object.freeze([Object.freeze({
				parentNodeId: paragraph.id,
				previousChildren,
				normalizedChildren,
			})]),
			rehashNodeIds: [
				paragraph.id,
				body.id,
				root.id,
			],
		}), undefined);

		let parentNodeIdGetterCalls = 0;
		const hostileChange = Object.freeze(Object.defineProperties({}, {
			parentNodeId: {
				enumerable: true,
				get: () => {
					parentNodeIdGetterCalls += 1;
					return paragraph.id;
				},
			},
			previousChildren: {
				enumerable: true,
				value: previousChildren,
			},
			normalizedChildren: {
				enumerable: true,
				value: normalizedChildren,
			},
		}));
		assert.equal(createNormalizedDocumentIndex({
			base,
			targetRoot: normalizedRoot,
			changedParents: Object.freeze([
				hostileChange,
			]) as unknown as readonly IDocumentIndexNormalizationParentChange[],
			rehashNodeIds: Object.freeze([
				paragraph.id,
				body.id,
				root.id,
			]),
		}), undefined);
		assert.equal(parentNodeIdGetterCalls, 0);
	});
});
