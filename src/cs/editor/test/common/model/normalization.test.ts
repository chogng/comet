/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	parseNodeId,
	parseRevisionId,
	type NodeId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import {
	createDocumentIndex,
	type DocumentIndex,
	type DocumentIndexResult,
} from 'cs/editor/common/model/documentIndex';
import {
	type BlockNode,
	type BodyNode,
	type HardBreakNode,
	type ListItemNode,
	type ListNode,
	type ManuscriptNode,
	type Mark,
	type ParagraphNode,
	type TextNode,
} from 'cs/editor/common/model/manuscript';
import {
	decodeManuscriptRootV1,
	encodeManuscriptRootV1,
	maximumManuscriptTextUtf16Length,
	type IManuscriptTreeCodecLimits,
	type ManuscriptSchemaResult,
} from 'cs/editor/common/model/manuscriptSchema';
import {
	isTrustedManuscriptNormalizationDelta,
	normalizeManuscriptRoot,
	restoreManuscriptNormalization,
	type IManuscriptNormalizationDelta,
	type IManuscriptNormalizationValue,
	type IRestoreManuscriptNormalizationOptions,
	type ManuscriptNormalizationResult,
} from 'cs/editor/common/model/normalization';
import {
	createPositionMap,
	type PositionMapFragment,
} from 'cs/editor/common/model/positionMap';

const revisionOne = revisionId(1);
const revisionTwo = revisionId(2);
const resource = createManuscriptDraftResource(uuid(900));
const generousTreeLimits: IManuscriptTreeCodecLimits = Object.freeze({
	maximumNodes: 100_000,
	maximumDepth: 30_000,
	maximumCollectionItems: 100_000,
});

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function nodeId(sequence: number): NodeId {
	const parsed = parseNodeId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function revisionId(sequence: number): RevisionId {
	const parsed = parseRevisionId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Revision ID.');
	}
	return parsed.value;
}

function utf16Offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid UTF-16 offset.');
	}
	return parsed.value;
}

function freezeMarks(marks: readonly Mark[]): readonly Mark[] {
	return Object.freeze(marks.map(mark => Object.freeze({ ...mark })));
}

function text(
	sequence: number,
	value: string,
	marks: readonly Mark[] = [],
): TextNode {
	return Object.freeze({
		id: nodeId(sequence),
		type: 'text',
		value,
		marks: freezeMarks(marks),
	});
}

function paragraph(
	sequence: number,
	children: ParagraphNode['children'],
): ParagraphNode {
	return Object.freeze({
		id: nodeId(sequence),
		type: 'paragraph',
		attrs: Object.freeze({
			alignment: 'start',
		}),
		children: Object.freeze([...children]),
	});
}

function manuscript(
	sequence: number,
	bodySequence: number,
	blocks: readonly [BlockNode, ...BlockNode[]],
): ManuscriptNode {
	const body: BodyNode = Object.freeze({
		id: nodeId(bodySequence),
		type: 'body',
		attrs: Object.freeze({}),
		children: Object.freeze([...blocks]) as readonly [BlockNode, ...BlockNode[]],
	});
	return Object.freeze({
		id: nodeId(sequence),
		type: 'manuscript',
		attrs: Object.freeze({}),
		children: Object.freeze([body]) as readonly [BodyNode],
	});
}

function requireIndex(
	result: DocumentIndexResult,
): DocumentIndex {
	if (result.type === 'error') {
		throw new Error(`Expected an index, received ${result.error.reason}.`);
	}
	return result.value;
}

function requireNormalized(
	result: ManuscriptNormalizationResult,
): IManuscriptNormalizationValue {
	if (result.type === 'error') {
		throw new Error(`Expected normalization success, received ${result.error.reason}.`);
	}
	return result.value;
}

function requireSchemaValue<TValue>(
	result: ManuscriptSchemaResult<TValue>,
): TValue {
	if (result.type === 'error') {
		throw new Error(`Expected schema success, received ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

suite('Touched-neighborhood manuscript normalization', () => {
	test('validates canonical Marks, normalizes Text, maps UTF-16, and restores by parent snapshot', () => {
		const canonicalMarks: readonly Mark[] = [
			{ type: 'bold' },
			{ type: 'italic' },
		];
		const left = text(1, 'e\u0301😀', canonicalMarks);
		const empty = text(2, '');
		const right = text(3, '雪', canonicalMarks);
		const hardBreak: HardBreakNode = Object.freeze({
			id: nodeId(4),
			type: 'hardBreak',
			attrs: Object.freeze({}),
		});
		const afterBoundary = text(5, 'after', canonicalMarks);
		const touchedParagraph = paragraph(
			6,
			[left, empty, right, hardBreak, afterBoundary],
		);
		const unrelatedText = text(7, 'unrelated');
		const unrelatedParagraph = paragraph(8, [unrelatedText]);
		const root = manuscript(10, 9, [touchedParagraph, unrelatedParagraph]);
		const index = requireIndex(createDocumentIndex(root));
		const visited: NodeId[] = [];
		const scheduled: NodeId[] = [];
		const copied: { readonly parentNodeId: NodeId; readonly count: number }[] = [];

		const normalized = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [touchedParagraph.id],
			touchedNodeIds: [left.id],
			maximumDeltaEntries: 2,
			instrumentation: {
				onVisitNode: nodeId => visited.push(nodeId),
				onScheduleRehash: nodeId => scheduled.push(nodeId),
				onCopyChildSlots: (parentNodeId, count) => {
					copied.push({ parentNodeId, count });
				},
			},
		}));
		const body = normalized.root.children[0];
		assert.equal(body.type, 'body');
		const normalizedParagraph = body.children[0];
		assert.equal(normalizedParagraph?.type, 'paragraph');
		if (normalizedParagraph?.type !== 'paragraph') {
			throw new Error('Expected the normalized Paragraph.');
		}
		const joined = normalizedParagraph.children[0];
		assert.equal(joined?.type, 'text');
		if (joined?.type !== 'text') {
			throw new Error('Expected joined Text.');
		}

		assert.equal(joined.id, left.id);
		assert.equal(joined.value, 'e\u0301😀雪');
		assert.deepStrictEqual(joined.marks.map(mark => mark.type), ['bold', 'italic']);
		assert.equal(normalizedParagraph.children[1], hardBreak);
		assert.equal(normalizedParagraph.children[2], afterBoundary);
		assert.equal(body.children[1], unrelatedParagraph);
		assert.deepStrictEqual(visited, [
			touchedParagraph.id,
			left.id,
			empty.id,
			right.id,
			hardBreak.id,
			afterBoundary.id,
		]);
		assert.deepStrictEqual(scheduled, [
			touchedParagraph.id,
			body.id,
			root.id,
		]);
		assert.deepStrictEqual(normalized.rehashNodeIds, scheduled);
		assert.equal(visited.includes(unrelatedParagraph.id), false);
		assert.equal(scheduled.includes(unrelatedParagraph.id), false);
		assert.deepStrictEqual(copied, [
			{ parentNodeId: touchedParagraph.id, count: 1 },
			{ parentNodeId: touchedParagraph.id, count: 1 },
			{ parentNodeId: touchedParagraph.id, count: 1 },
			{ parentNodeId: touchedParagraph.id, count: 5 },
			{ parentNodeId: body.id, count: 2 },
			{ parentNodeId: root.id, count: 1 },
		]);

		assert.deepStrictEqual(normalized.fragments, [
			{
				kind: 'child-delete',
				parentNodeId: touchedParagraph.id,
				childIndex: 1,
				deletedChildCount: 1,
				deletedNodeIds: [empty.id],
			},
			{
				kind: 'node-tombstone',
				nodeId: empty.id,
			},
			{
				kind: 'text-join',
				parentNodeId: touchedParagraph.id,
				leftChildIndex: 0,
				leftTextNodeId: left.id,
				rightTextNodeId: right.id,
				leftUtf16Length: 4,
			},
			{
				kind: 'node-alias',
				sourceNodeId: right.id,
				targetNodeId: left.id,
			},
		]);
		assert.deepStrictEqual(
			normalized.delta.entries.map(entry => entry.kind),
			['remove-empty-text', 'join-adjacent-text'],
		);
		assert.equal(normalized.delta.parents.length, 1);
		const parentDelta = normalized.delta.parents[0];
		assert.equal(parentDelta?.parentNodeId, touchedParagraph.id);
		assert.notEqual(parentDelta?.previousChildren, touchedParagraph.children);
		assert.deepStrictEqual(parentDelta?.previousChildren, touchedParagraph.children);
		assert.equal(parentDelta?.normalizedChildren, normalizedParagraph.children);
		assert.equal(Object.isFrozen(normalized), true);
		assert.equal(Object.isFrozen(normalized.fragments), true);
		assert.equal(Object.isFrozen(normalized.delta), true);
		assert.equal(Object.isFrozen(normalized.delta.entries), true);
		assert.equal(Object.isFrozen(normalized.delta.parents), true);
		assert.equal(Object.isFrozen(parentDelta), true);
		assert.equal(Object.isFrozen(parentDelta?.previousChildren), true);
		assert.equal(Object.isFrozen(parentDelta?.normalizedChildren), true);
		assert.equal(isTrustedManuscriptNormalizationDelta(normalized.delta), true);

		const map = createPositionMap({
			resource,
			fromRevisionId: revisionOne,
			toRevisionId: revisionTwo,
			fragments: normalized.fragments as unknown as readonly [
				PositionMapFragment,
				...PositionMapFragment[],
			],
		});
		assert.deepStrictEqual(map.mapNodeId(empty.id), { status: 'deleted' });
		assert.deepStrictEqual(map.mapNodeId(right.id), {
			status: 'mapped',
			value: left.id,
		});
		assert.deepStrictEqual(map.mapPosition({
			kind: 'text',
			textNodeId: right.id,
			utf16Offset: utf16Offset(1),
			affinity: 'after',
		}), {
			status: 'mapped',
			value: {
				kind: 'text',
				textNodeId: left.id,
				utf16Offset: utf16Offset(5),
				affinity: 'after',
			},
		});

		const encoded = requireSchemaValue(
			encodeManuscriptRootV1(normalized.root, generousTreeLimits),
		);
		const decoded = requireSchemaValue(
			decodeManuscriptRootV1(encoded, generousTreeLimits),
		);
		assert.equal(decoded.root.children[0].type, 'body');

		const restoredCopies: { readonly parentNodeId: NodeId; readonly count: number }[] = [];
		const normalizedIndex = requireIndex(createDocumentIndex(normalized.root));
		const restored = restoreManuscriptNormalization({
			root: normalized.root,
			index: normalizedIndex,
			delta: normalized.delta,
			instrumentation: {
				onCopyChildSlots: (parentNodeId, count) => {
					restoredCopies.push({ parentNodeId, count });
				},
			},
		});
		if (restored.type === 'error') {
			throw new Error('Expected normalization restoration.');
		}
		assert.deepStrictEqual(restored.value.root, root);
		const restoredBody = restored.value.root.children[0];
		assert.equal(restoredBody.type, 'body');
		assert.equal(restoredBody.children[1], unrelatedParagraph);
		assert.deepStrictEqual(restoredCopies, [
			{ parentNodeId: touchedParagraph.id, count: 5 },
			{ parentNodeId: body.id, count: 2 },
			{ parentNodeId: root.id, count: 1 },
		]);

		const secondIndex = requireIndex(createDocumentIndex(normalized.root));
		const second = requireNormalized(normalizeManuscriptRoot({
			root: normalized.root,
			index: secondIndex,
			touchedParentNodeIds: [touchedParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 0,
		}));
		assert.equal(second.root, normalized.root);
		assert.deepStrictEqual(second.fragments, []);
		assert.deepStrictEqual(second.delta.entries, []);
		assert.deepStrictEqual(second.delta.parents, []);
		assert.deepStrictEqual(second.rehashNodeIds, []);
		assert.equal(isTrustedManuscriptNormalizationDelta(second.delta), true);
	});

	test('rejects non-canonical, duplicate, and incompatible Marks without repairing them', () => {
		for (const [sequence, marks, reason] of [
			[
				20,
				[{ type: 'italic' }, { type: 'bold' }],
				'invalid-marks',
			],
			[
				30,
				[{ type: 'bold' }, { type: 'bold' }],
				'invalid-marks',
			],
			[
				40,
				[{ type: 'subscript' }, { type: 'superscript' }],
				'incompatible-script-marks',
			],
		] as const) {
			const invalidText = text(sequence, 'invalid', marks);
			const invalidParagraph = paragraph(sequence + 1, [invalidText]);
			const root = manuscript(sequence + 3, sequence + 2, [invalidParagraph]);
			const normalized = normalizeManuscriptRoot({
				root,
				index: requireIndex(createDocumentIndex(root)),
				touchedParentNodeIds: [invalidParagraph.id],
				touchedNodeIds: [],
				maximumDeltaEntries: 10,
			});
			assert.deepStrictEqual(normalized, {
				type: 'error',
				error: {
					reason,
					nodeId: invalidText.id,
				},
			});
		}
	});

	test('enforces the exact inverse-operation budget before every remove or join', () => {
		const empty = text(50, '');
		const left = text(51, 'left');
		const right = text(52, 'right');
		const touchedParagraph = paragraph(53, [empty, left, right]);
		const root = manuscript(55, 54, [touchedParagraph]);
		const index = requireIndex(createDocumentIndex(root));

		for (const maximumDeltaEntries of [
			-1,
			1.5,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			assert.deepStrictEqual(normalizeManuscriptRoot({
				root,
				index,
				touchedParentNodeIds: [touchedParagraph.id],
				touchedNodeIds: [],
				maximumDeltaEntries,
			}), {
				type: 'error',
				error: {
					reason: 'invalid-normalization-budget',
				},
			});
		}
		const failedCopies: {
			readonly parentNodeId: NodeId;
			readonly count: number;
		}[] = [];
		assert.deepStrictEqual(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [touchedParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
			instrumentation: {
				onCopyChildSlots: (parentNodeId, count) => {
					failedCopies.push({ parentNodeId, count });
				},
			},
		}), {
			type: 'error',
			error: {
				reason: 'normalization-budget-exceeded',
				nodeId: right.id,
				maximumDeltaEntries: 1,
			},
		});
		assert.deepStrictEqual(failedCopies, [
			{ parentNodeId: touchedParagraph.id, count: 0 },
			{ parentNodeId: touchedParagraph.id, count: 1 },
		]);
		const exact = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [touchedParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 2,
		}));
		assert.equal(exact.delta.entries.length, 2);
	});

	test('rejects forged deltas before inspecting their structure', () => {
		const onlyText = text(60, 'stable');
		const onlyParagraph = paragraph(61, [onlyText]);
		const root = manuscript(63, 62, [onlyParagraph]);
		const index = requireIndex(createDocumentIndex(root));
		const forged = Object.freeze({
			entries: Object.freeze([]),
			parents: Object.freeze([]),
		}) as IManuscriptNormalizationDelta;

		assert.equal(isTrustedManuscriptNormalizationDelta(forged), false);
		assert.deepStrictEqual(restoreManuscriptNormalization({
			root,
			index,
			delta: forged,
		}), {
			type: 'error',
			error: {
				reason: 'untrusted-normalization-delta',
			},
		});
	});

	test('captures restore options once without invoking a swapping delta getter', () => {
		const empty = text(64, '');
		const originalParagraph = paragraph(65, [empty]);
		const root = manuscript(67, 66, [originalParagraph]);
		const normalized = requireNormalized(normalizeManuscriptRoot({
			root,
			index: requireIndex(createDocumentIndex(root)),
			touchedParentNodeIds: [originalParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}));
		const normalizedBody = normalized.root.children[0];
		assert.equal(normalizedBody.type, 'body');
		const normalizedParagraph = normalizedBody.children[0];
		assert.equal(normalizedParagraph?.type, 'paragraph');
		if (normalizedParagraph?.type !== 'paragraph') {
			throw new Error('Expected a normalized Paragraph fixture.');
		}

		const forged = Object.freeze({
			entries: normalized.delta.entries,
			parents: Object.freeze([
				Object.freeze({
					parentNodeId: normalizedParagraph.id,
					previousChildren: Object.freeze([text(68, 'EVIL')]),
					normalizedChildren: normalizedParagraph.children,
				}),
			]),
		}) as IManuscriptNormalizationDelta;
		let getterCalls = 0;
		const swappingOptions = {
			root: normalized.root,
			index: requireIndex(createDocumentIndex(normalized.root)),
		} as Omit<IRestoreManuscriptNormalizationOptions, 'delta'> & {
			readonly delta?: IManuscriptNormalizationDelta;
		};
		Object.defineProperty(swappingOptions, 'delta', {
			enumerable: true,
			get: () => {
				getterCalls += 1;
				return getterCalls === 1 ? normalized.delta : forged;
			},
		});

		assert.deepStrictEqual(
			restoreManuscriptNormalization(
				swappingOptions as IRestoreManuscriptNormalizationOptions,
			),
			{
				type: 'error',
				error: {
					reason: 'invalid-options',
				},
			},
		);
		assert.equal(getterCalls, 0);
	});

	test('captures nested touched ID arrays without getters or iterators', () => {
		const left = text(69, 'left');
		const right = text(70, 'right');
		const touchedParagraph = paragraph(71, [left, right]);
		const root = manuscript(73, 72, [touchedParagraph]);
		const index = requireIndex(createDocumentIndex(root));

		let elementGetterCalls = 0;
		const accessorIds: NodeId[] = [];
		Object.defineProperty(accessorIds, '0', {
			enumerable: true,
			get: () => {
				elementGetterCalls += 1;
				return touchedParagraph.id;
			},
		});
		accessorIds.length = 1;
		assert.deepStrictEqual(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: accessorIds,
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}), {
			type: 'error',
			error: {
				reason: 'invalid-options',
			},
		});
		assert.equal(elementGetterCalls, 0);

		const revoked = Proxy.revocable([touchedParagraph.id], {});
		revoked.revoke();
		assert.deepStrictEqual(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: revoked.proxy,
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}), {
			type: 'error',
			error: {
				reason: 'inspection-failed',
			},
		});

		let iteratorReads = 0;
		const proxiedIds = new Proxy([touchedParagraph.id], {
			get: (target, property, receiver) => {
				if (property === Symbol.iterator) {
					iteratorReads += 1;
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const normalized = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: proxiedIds,
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}));
		assert.equal(normalized.delta.entries.length, 1);
		assert.equal(iteratorReads, 0);
	});

	test('rejects an oversized join and accepts the exact shared Text UTF-16 bound', () => {
		const oversizedLeft = text(
			70,
			'x'.repeat(maximumManuscriptTextUtf16Length),
		);
		const oversizedRight = text(71, 'y');
		const oversizedParagraph = paragraph(72, [oversizedLeft, oversizedRight]);
		const oversizedRoot = manuscript(74, 73, [oversizedParagraph]);
		assert.deepStrictEqual(normalizeManuscriptRoot({
			root: oversizedRoot,
			index: requireIndex(createDocumentIndex(oversizedRoot)),
			touchedParentNodeIds: [oversizedParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}), {
			type: 'error',
			error: {
				reason: 'text-utf16-limit-exceeded',
				nodeId: oversizedLeft.id,
				maximumUtf16Length: maximumManuscriptTextUtf16Length,
			},
		});

		const boundedLeft = text(
			75,
			'x'.repeat(maximumManuscriptTextUtf16Length - 1),
		);
		const boundedRight = text(76, 'y');
		const boundedParagraph = paragraph(77, [boundedLeft, boundedRight]);
		const boundedRoot = manuscript(79, 78, [boundedParagraph]);
		const bounded = requireNormalized(normalizeManuscriptRoot({
			root: boundedRoot,
			index: requireIndex(createDocumentIndex(boundedRoot)),
			touchedParentNodeIds: [boundedParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}));
		const boundedBody = bounded.root.children[0];
		assert.equal(boundedBody.type, 'body');
		const joined = boundedBody.children[0];
		assert.equal(joined?.type, 'paragraph');
		if (joined?.type !== 'paragraph') {
			throw new Error('Expected a bounded Paragraph.');
		}
		assert.equal(joined.children[0]?.type, 'text');
		assert.equal(
			joined.children[0]?.type === 'text'
				? joined.children[0].value.length
				: undefined,
			maximumManuscriptTextUtf16Length,
		);
		const encoded = requireSchemaValue(
			encodeManuscriptRootV1(bounded.root, generousTreeLimits),
		);
		requireSchemaValue(decodeManuscriptRootV1(encoded, generousTreeLimits));
	});

	test('orders independent touched neighborhoods deterministically', () => {
		const firstParagraph = paragraph(82, [
			text(80, 'a'),
			text(81, 'b'),
		]);
		const secondParagraph = paragraph(85, [
			text(83, 'c'),
			text(84, 'd'),
		]);
		const root = manuscript(87, 86, [firstParagraph, secondParagraph]);
		const index = requireIndex(createDocumentIndex(root));
		const forward = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [firstParagraph.id, secondParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 2,
		}));
		const reversed = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [secondParagraph.id, firstParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 2,
		}));

		assert.deepStrictEqual(reversed.root, forward.root);
		assert.deepStrictEqual(reversed.fragments, forward.fragments);
		assert.deepStrictEqual(reversed.delta.entries, forward.delta.entries);
		assert.deepStrictEqual(reversed.delta.parents, forward.delta.parents);
		assert.deepStrictEqual(reversed.rehashNodeIds, forward.rehashNodeIds);
	});

	test('rebuilds a 20k-deep path by indexed child slots without reading unrelated subtree IDs', () => {
		const left = text(100, '深');
		const right = text(101, '度');
		const deepestParagraph = paragraph(102, [left, right]);
		const unrelatedText = text(103, 'side');
		const unrelatedParagraph = paragraph(104, [unrelatedText]);
		let nested: ParagraphNode | ListNode = deepestParagraph;
		let sequence = 105;
		for (let depth = 0; depth < 10_000; depth += 1) {
			const item: ListItemNode = Object.freeze({
				id: nodeId(sequence++),
				type: 'listItem',
				attrs: Object.freeze({}),
				children: Object.freeze([nested]) as ListItemNode['children'],
			});
			nested = Object.freeze({
				id: nodeId(sequence++),
				type: 'list',
				attrs: Object.freeze({
					ordered: false,
				}),
				children: Object.freeze([item]) as readonly [ListItemNode],
			});
		}
		const root = manuscript(
			sequence++,
			sequence++,
			[nested, unrelatedParagraph],
		);
		const index = requireIndex(createDocumentIndex(root, {
			maximumNodes: 25_000,
			maximumDepth: 25_000,
		}));
		const visited: NodeId[] = [];
		const scheduled: NodeId[] = [];
		const copied: { readonly parentNodeId: NodeId; readonly count: number }[] = [];

		const normalized = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [deepestParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
			instrumentation: {
				onVisitNode: nodeId => visited.push(nodeId),
				onScheduleRehash: nodeId => scheduled.push(nodeId),
				onCopyChildSlots: (parentNodeId, count) => {
					copied.push({ parentNodeId, count });
				},
			},
		}));
		assert.deepStrictEqual(visited, [
			deepestParagraph.id,
			left.id,
			right.id,
		]);
		assert.equal(scheduled.length > 20_000, true);
		assert.equal(scheduled[0], deepestParagraph.id);
		assert.equal(scheduled[scheduled.length - 1], root.id);
		assert.equal(scheduled.includes(unrelatedParagraph.id), false);
		assert.deepStrictEqual(normalized.rehashNodeIds, scheduled);
		assert.equal(
			copied.some(event => event.parentNodeId === unrelatedParagraph.id),
			false,
		);
		assert.equal(
			copied.find(event => event.parentNodeId === root.children[0].id)?.count,
			2,
		);
		assert.equal(
			copied.reduce((total, event) => total + event.count, 0) > 20_000,
			true,
		);

		const normalizedBody = normalized.root.children[0];
		assert.equal(normalizedBody.type, 'body');
		assert.equal(normalizedBody.children[1], unrelatedParagraph);
		assert.notEqual(normalizedBody.children[0], nested);
		assert.equal(normalized.fragments[0]?.kind, 'text-join');
		assert.equal(normalized.fragments[1]?.kind, 'node-alias');
	});

	test('restores a 50k-entry delta with one validation and one replacement per parent', () => {
		const childCount = 50_000;
		const emptyChildren: TextNode[] = [];
		for (let index = 0; index < childCount; index += 1) {
			emptyChildren.push(text(30_000 + index, ''));
		}
		const largeParagraph = paragraph(80_001, emptyChildren);
		const root = manuscript(80_003, 80_002, [largeParagraph]);
		const index = requireIndex(createDocumentIndex(root, {
			maximumNodes: 60_000,
			maximumDepth: 10,
		}));
		const normalized = requireNormalized(normalizeManuscriptRoot({
			root,
			index,
			touchedParentNodeIds: [largeParagraph.id],
			touchedNodeIds: [],
			maximumDeltaEntries: childCount,
		}));
		assert.equal(normalized.delta.entries.length, childCount);
		assert.equal(normalized.delta.parents.length, 1);
		const normalizedBody = normalized.root.children[0];
		assert.equal(normalizedBody.type, 'body');
		const emptied = normalizedBody.children[0];
		assert.equal(emptied?.type, 'paragraph');
		assert.deepStrictEqual(
			emptied?.type === 'paragraph' ? emptied.children : undefined,
			[],
		);

		const visited: NodeId[] = [];
		const copied: { readonly parentNodeId: NodeId; readonly count: number }[] = [];
		const restored = restoreManuscriptNormalization({
			root: normalized.root,
			index: requireIndex(createDocumentIndex(normalized.root)),
			delta: normalized.delta,
			instrumentation: {
				onVisitNode: nodeId => visited.push(nodeId),
				onCopyChildSlots: (parentNodeId, count) => {
					copied.push({ parentNodeId, count });
				},
			},
		});
		if (restored.type === 'error') {
			throw new Error(`Expected large restoration, received ${restored.error.reason}.`);
		}
		assert.deepStrictEqual(restored.value.root, root);
		assert.deepStrictEqual(visited, [largeParagraph.id]);
		assert.deepStrictEqual(
			copied.filter(event => event.parentNodeId === largeParagraph.id),
			[{ parentNodeId: largeParagraph.id, count: childCount }],
		);
	});
});
