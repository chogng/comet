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
	type IDocumentIndexLimits,
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
	maximumManuscriptTextUtf16Length,
} from 'cs/editor/common/model/manuscriptSchema';
import {
	consumeManuscriptNormalizationForwardTransition,
	createManuscriptNormalizationForwardTransition,
	restoreManuscriptNormalization,
	type IConsumedManuscriptNormalizationForwardTransition,
	type IManuscriptNormalizationInstrumentation,
	type ManuscriptNormalizationForwardTransition,
	type ManuscriptNormalizationRestoreReceipt,
	type ManuscriptNormalizationResult,
} from 'cs/editor/common/model/normalization';
import {
	createPositionMap,
	type PositionMapFragment,
} from 'cs/editor/common/model/positionMap';
import {
	rebuildRevisionMerkleState,
} from 'cs/editor/common/model/revisionMerkleState';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	type DocumentContent,
	type RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';

interface ICheckpoint {
	readonly content: DocumentContent;
	readonly index: DocumentIndex;
	readonly merkleState: RevisionMerkleState;
}

const revisionOne = revisionId(1);
const revisionTwo = revisionId(2);
const resource = createManuscriptDraftResource(uuid(900));
const generousIndexLimits: IDocumentIndexLimits = Object.freeze({
	maximumNodes: 100_000,
	maximumDepth: 30_000,
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

function requireIndex(result: DocumentIndexResult): DocumentIndex {
	if (result.type === 'error') {
		throw new Error(`Expected an index, received ${result.error.reason}.`);
	}
	return result.value;
}

function checkpoint(
	root: ManuscriptNode,
	limits: IDocumentIndexLimits = generousIndexLimits,
): ICheckpoint {
	const content: DocumentContent = Object.freeze({
		format: documentFormat,
		formatVersion: documentFormatVersion,
		schemaId: manuscriptSchemaId,
		schemaVersion: manuscriptSchemaVersion,
		metadata: Object.freeze({
			title: 'Normalization fixture',
			authors: Object.freeze([]),
			abstract: '',
			keywords: Object.freeze([]),
		}),
		root,
		academicGraph: Object.freeze({
			referenceSnapshots: Object.freeze([]),
			evidenceLinks: Object.freeze([]),
			claims: Object.freeze([]),
			claimEvidenceRelations: Object.freeze([]),
		}),
		settings: Object.freeze({
			language: 'en',
			citationStyle: 'apa',
			headingNumbering: true,
			bibliographyEnabled: true,
		}),
	});
	const index = requireIndex(createDocumentIndex(root, limits));
	return Object.freeze({
		content,
		index,
		merkleState: rebuildRevisionMerkleState(
			content,
			undefined,
			limits,
			index,
		),
	});
}

function checkpointFromCandidate(
	consumed: IConsumedManuscriptNormalizationForwardTransition,
): ICheckpoint {
	return Object.freeze({
		content: consumed.targetContent,
		index: consumed.targetIndex,
		merkleState: consumed.targetMerkleState,
	});
}

function requireForward(
	result: ManuscriptNormalizationResult,
): ManuscriptNormalizationForwardTransition {
	if (result.type === 'error') {
		throw new Error(
			`Expected normalization success, received ${result.error.reason}.`,
		);
	}
	return result.value;
}

function createForward(
	source: ICheckpoint,
	touchedParentNodeIds: readonly NodeId[],
	touchedNodeIds: readonly NodeId[],
	maximumDeltaEntries: number,
	instrumentation?: IManuscriptNormalizationInstrumentation,
): ManuscriptNormalizationResult {
	return createManuscriptNormalizationForwardTransition({
		canonicalResource: resource.toString(),
		generatedAgainstRevisionId: revisionOne,
		sourceContent: source.content,
		sourceIndex: source.index,
		sourceMerkleState: source.merkleState,
		touchedParentNodeIds,
		touchedNodeIds,
		maximumDeltaEntries,
		...(instrumentation === undefined ? {} : { instrumentation }),
	});
}

function requireConsumed(
	transition: ManuscriptNormalizationForwardTransition,
	source: ICheckpoint,
): IConsumedManuscriptNormalizationForwardTransition {
	const consumed = consumeManuscriptNormalizationForwardTransition(
		transition,
		resource.toString(),
		revisionOne,
		source.content,
		source.index,
		source.merkleState,
	);
	if (consumed.type === 'error') {
		throw new Error(
			`Expected forward consumption, received ${consumed.error.reason}.`,
		);
	}
	return consumed.value;
}

function requireReceipt(
	consumed: IConsumedManuscriptNormalizationForwardTransition,
): ManuscriptNormalizationRestoreReceipt {
	return consumed.restoreReceipt;
}

suite('Touched-neighborhood manuscript normalization', () => {
	test('normalizes touched Text, emits an opaque transition, and restores exact provenance', () => {
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
		const source = checkpoint(root);
		const visited: NodeId[] = [];
		const scheduled: NodeId[] = [];
		const copied: { readonly parentNodeId: NodeId; readonly count: number }[] = [];

		const transition = requireForward(createForward(
			source,
			[touchedParagraph.id],
			[left.id],
			2,
			{
				onVisitNode: id => visited.push(id),
				onScheduleRehash: id => scheduled.push(id),
				onCopyChildSlots: (parentNodeId, count) => {
					copied.push({ parentNodeId, count });
				},
			},
		));
		assert.equal(Object.getPrototypeOf(transition), null);
		assert.equal(Object.isFrozen(transition), true);
		assert.deepStrictEqual(Reflect.ownKeys(transition), []);

		const normalized = requireConsumed(transition, source);
		const body = normalized.targetContent.root.children[0];
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
		assert.deepStrictEqual(
			joined.marks.map(mark => mark.type),
			['bold', 'italic'],
		);
		assert.equal(normalizedParagraph.children[1], hardBreak);
		assert.equal(normalizedParagraph.children[2], afterBoundary);
		assert.equal(body.children[1], unrelatedParagraph);
		assert.equal(
			normalized.targetIndex.getNode(root.id),
			normalized.targetContent.root,
		);
		assert.equal(normalized.targetIndex.getNode(left.id), joined);
		assert.equal(normalized.targetIndex.getNode(empty.id), undefined);
		assert.equal(normalized.targetIndex.getNode(right.id), undefined);
		assert.equal(
			normalized.targetMerkleState.nodeCount,
			source.merkleState.nodeCount - 2,
		);
		assert.equal(
			normalized.targetMerkleState.getNodeHash(empty.id),
			undefined,
		);
		assert.equal(
			normalized.targetMerkleState.getNodeHash(right.id),
			undefined,
		);
		assert.deepStrictEqual(visited, [
			touchedParagraph.id,
			left.id,
			empty.id,
			right.id,
			hardBreak.id,
			afterBoundary.id,
		]);
		assert.deepStrictEqual(scheduled, [
			left.id,
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

		const target = checkpointFromCandidate(normalized);
		assert.equal(
			normalized.targetMerkleState.documentHash,
			rebuildRevisionMerkleState(normalized.targetContent).documentHash,
		);
		const receipt = requireReceipt(normalized);
		assert.equal(receipt, transition);
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				transition,
				resource.toString(),
				revisionOne,
				source.content,
				source.index,
				source.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'invalid-forward-transition' },
			},
		);
		const restored = restoreManuscriptNormalization(receipt);
		assert.equal(restored.type, 'ok');
		assert.equal(restored.value.sourceContent, source.content);
		assert.equal(restored.value.sourceIndex, source.index);
		assert.equal(restored.value.sourceMerkleState, source.merkleState);
		assert.deepStrictEqual(restoreManuscriptNormalization(receipt), {
			type: 'error',
			error: { reason: 'invalid-restore-receipt' },
		});

		const second = requireConsumed(
			requireForward(createForward(
				target,
				[touchedParagraph.id],
				[],
				0,
			)),
			target,
		);
		assert.equal(second.targetContent.root, target.content.root);
		assert.equal(second.targetIndex, target.index);
		assert.equal(second.targetMerkleState, target.merkleState);
		assert.deepStrictEqual(second.fragments, []);
		assert.deepStrictEqual(second.rehashNodeIds, []);
	});

	test('rejects non-canonical, duplicate, and incompatible Marks without repairing them', () => {
		for (const [sequence, marks, reason] of [
			[20, [{ type: 'italic' }, { type: 'bold' }], 'invalid-marks'],
			[30, [{ type: 'bold' }, { type: 'bold' }], 'invalid-marks'],
			[
				40,
				[{ type: 'subscript' }, { type: 'superscript' }],
				'incompatible-script-marks',
			],
		] as const) {
			const invalidText = text(sequence, 'invalid', marks);
			const invalidParagraph = paragraph(sequence + 1, [invalidText]);
			const source = checkpoint(
				manuscript(sequence + 3, sequence + 2, [invalidParagraph]),
			);
			assert.deepStrictEqual(
				createForward(source, [invalidParagraph.id], [], 10),
				{
					type: 'error',
					error: {
						reason,
						nodeId: invalidText.id,
					},
				},
			);
		}
	});

	test('enforces the exact inverse-operation budget before every remove or join', () => {
		const empty = text(50, '');
		const left = text(51, 'left');
		const right = text(52, 'right');
		const touchedParagraph = paragraph(53, [empty, left, right]);
		const source = checkpoint(manuscript(55, 54, [touchedParagraph]));

		for (const maximumDeltaEntries of [
			-1,
			1.5,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			assert.deepStrictEqual(
				createForward(
					source,
					[touchedParagraph.id],
					[],
					maximumDeltaEntries,
				),
				{
					type: 'error',
					error: { reason: 'invalid-normalization-budget' },
				},
			);
		}
		assert.deepStrictEqual(
			createForward(source, [touchedParagraph.id], [], 1),
			{
				type: 'error',
				error: {
					reason: 'normalization-budget-exceeded',
					nodeId: right.id,
					maximumDeltaEntries: 1,
				},
			},
		);
		const exact = requireConsumed(
			requireForward(createForward(
				source,
				[touchedParagraph.id],
				[],
				2,
			)),
			source,
		);
		assert.equal(exact.fragments.length, 4);
	});

	test('captures nested touched ID arrays without getters or iterators', () => {
		const left = text(69, 'left');
		const right = text(70, 'right');
		const touchedParagraph = paragraph(71, [left, right]);
		const source = checkpoint(manuscript(73, 72, [touchedParagraph]));

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
		assert.deepStrictEqual(createManuscriptNormalizationForwardTransition({
			canonicalResource: resource.toString(),
			generatedAgainstRevisionId: revisionOne,
			sourceContent: source.content,
			sourceIndex: source.index,
			sourceMerkleState: source.merkleState,
			touchedParentNodeIds: accessorIds,
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}), {
			type: 'error',
			error: { reason: 'invalid-options' },
		});
		assert.equal(elementGetterCalls, 0);

		const revoked = Proxy.revocable([touchedParagraph.id], {});
		revoked.revoke();
		assert.deepStrictEqual(createManuscriptNormalizationForwardTransition({
			canonicalResource: resource.toString(),
			generatedAgainstRevisionId: revisionOne,
			sourceContent: source.content,
			sourceIndex: source.index,
			sourceMerkleState: source.merkleState,
			touchedParentNodeIds: revoked.proxy,
			touchedNodeIds: [],
			maximumDeltaEntries: 1,
		}), {
			type: 'error',
			error: { reason: 'inspection-failed' },
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
		const normalized = requireConsumed(
			requireForward(createManuscriptNormalizationForwardTransition({
				canonicalResource: resource.toString(),
				generatedAgainstRevisionId: revisionOne,
				sourceContent: source.content,
				sourceIndex: source.index,
				sourceMerkleState: source.merkleState,
				touchedParentNodeIds: proxiedIds,
				touchedNodeIds: [],
				maximumDeltaEntries: 1,
			})),
			source,
		);
		assert.equal(normalized.fragments.length, 2);
		assert.equal(iteratorReads, 0);
	});

	test('rejects an oversized join and accepts the exact shared Text UTF-16 bound', () => {
		const oversizedLeft = text(
			75,
			'x'.repeat(maximumManuscriptTextUtf16Length),
		);
		const oversizedRight = text(76, 'y');
		const oversizedParagraph = paragraph(77, [
			oversizedLeft,
			oversizedRight,
		]);
		const oversized = checkpoint(manuscript(79, 78, [oversizedParagraph]));
		assert.deepStrictEqual(
			createForward(oversized, [oversizedParagraph.id], [], 1),
			{
				type: 'error',
				error: {
					reason: 'text-utf16-limit-exceeded',
					nodeId: oversizedLeft.id,
					maximumUtf16Length: maximumManuscriptTextUtf16Length,
				},
			},
		);

		const boundedLeft = text(
			80,
			'x'.repeat(maximumManuscriptTextUtf16Length - 1),
		);
		const boundedRight = text(81, 'y');
		const boundedParagraph = paragraph(82, [boundedLeft, boundedRight]);
		const bounded = checkpoint(manuscript(84, 83, [boundedParagraph]));
		const normalized = requireConsumed(
			requireForward(createForward(
				bounded,
				[boundedParagraph.id],
				[],
				1,
			)),
			bounded,
		);
		const normalizedBody = normalized.targetContent.root.children[0];
		const joined = normalizedBody.children[0];
		assert.equal(joined?.type, 'paragraph');
		assert.equal(
			joined?.type === 'paragraph' && joined.children[0]?.type === 'text'
				? joined.children[0].value.length
				: undefined,
			maximumManuscriptTextUtf16Length,
		);
	});

	test('orders independent touched neighborhoods deterministically', () => {
		const firstParagraph = paragraph(92, [text(90, 'a'), text(91, 'b')]);
		const secondParagraph = paragraph(95, [text(93, 'c'), text(94, 'd')]);
		const source = checkpoint(
			manuscript(97, 96, [firstParagraph, secondParagraph]),
		);
		const forward = requireConsumed(
			requireForward(createForward(
				source,
				[firstParagraph.id, secondParagraph.id],
				[],
				2,
			)),
			source,
		);
		const reversed = requireConsumed(
			requireForward(createForward(
				source,
				[secondParagraph.id, firstParagraph.id],
				[],
				2,
			)),
			source,
		);
		assert.deepStrictEqual(
			reversed.targetContent.root,
			forward.targetContent.root,
		);
		assert.deepStrictEqual(reversed.fragments, forward.fragments);
		assert.deepStrictEqual(reversed.rehashNodeIds, forward.rehashNodeIds);
	});

	test('rebuilds a deep changed path without reading an unrelated subtree', () => {
		const left = text(100, '深');
		const right = text(101, '度');
		const deepestParagraph = paragraph(102, [left, right]);
		const unrelatedParagraph = paragraph(104, [text(103, 'side')]);
		let nested: ParagraphNode | ListNode = deepestParagraph;
		let sequence = 105;
		for (let depth = 0; depth < 2_000; depth += 1) {
			const item: ListItemNode = Object.freeze({
				id: nodeId(sequence++),
				type: 'listItem',
				attrs: Object.freeze({}),
				children: Object.freeze([nested]) as ListItemNode['children'],
			});
			nested = Object.freeze({
				id: nodeId(sequence++),
				type: 'list',
				attrs: Object.freeze({ ordered: false }),
				children: Object.freeze([item]) as readonly [ListItemNode],
			});
		}
		const root = manuscript(sequence++, sequence++, [
			nested,
			unrelatedParagraph,
		]);
		const limits = Object.freeze({
			maximumNodes: 5_000,
			maximumDepth: 5_000,
		});
		const source = checkpoint(root, limits);
		const visited: NodeId[] = [];
		const scheduled: NodeId[] = [];
		const normalized = requireConsumed(
			requireForward(createForward(
				source,
				[deepestParagraph.id],
				[],
				1,
				{
					onVisitNode: id => visited.push(id),
					onScheduleRehash: id => scheduled.push(id),
				},
			)),
			source,
		);
		assert.deepStrictEqual(visited, [
			deepestParagraph.id,
			left.id,
			right.id,
		]);
		assert.equal(scheduled.length > 4_000, true);
		assert.equal(scheduled[0], left.id);
		assert.equal(scheduled[1], deepestParagraph.id);
		assert.equal(scheduled[scheduled.length - 1], root.id);
		assert.equal(scheduled.includes(unrelatedParagraph.id), false);
		assert.deepStrictEqual(normalized.rehashNodeIds, scheduled);
		assert.equal(
			normalized.targetContent.root.children[0].children[1],
			unrelatedParagraph,
		);
	});

	test('rejects clone, Proxy, repeat, and cross-transition splicing by identity', () => {
		const firstParagraph = paragraph(201, [text(200, 'a'), text(202, 'b')]);
		const secondParagraph = paragraph(211, [text(210, 'c'), text(212, 'd')]);
		const first = checkpoint(manuscript(204, 203, [firstParagraph]));
		const second = checkpoint(manuscript(214, 213, [secondParagraph]));
		const firstTransition = requireForward(createForward(
			first,
			[firstParagraph.id],
			[],
			1,
		));
		let transitionProxyTrapCount = 0;
		const proxy = new Proxy(firstTransition, {
			get: (target, property, receiver) => {
				transitionProxyTrapCount += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				proxy,
				resource.toString(),
				revisionOne,
				first.content,
				first.index,
				first.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'invalid-forward-transition' },
			},
		);
		assert.equal(transitionProxyTrapCount, 0);
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				0,
				resource.toString(),
				revisionOne,
				first.content,
				first.index,
				first.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'invalid-forward-transition' },
			},
		);
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				Object.freeze(Object.create(null)),
				resource.toString(),
				revisionOne,
				first.content,
				first.index,
				first.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'invalid-forward-transition' },
			},
		);
		const contextTransition = requireForward(createForward(
			first,
			[firstParagraph.id],
			[],
			1,
		));
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				contextTransition,
				resource.toString(),
				revisionTwo,
				first.content,
				first.index,
				first.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'forward-source-mismatch' },
			},
		);
		assert.deepStrictEqual(
			restoreManuscriptNormalization(contextTransition),
			{
				type: 'error',
				error: { reason: 'invalid-restore-receipt' },
			},
		);
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				firstTransition,
				resource.toString(),
				revisionOne,
				second.content,
				second.index,
				second.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'forward-source-mismatch' },
			},
		);
		assert.deepStrictEqual(
			consumeManuscriptNormalizationForwardTransition(
				firstTransition,
				resource.toString(),
				revisionOne,
				first.content,
				first.index,
				first.merkleState,
			),
			{
				type: 'error',
				error: { reason: 'invalid-forward-transition' },
			},
		);
		assert.deepStrictEqual(
			restoreManuscriptNormalization(firstTransition),
			{
				type: 'error',
				error: { reason: 'invalid-restore-receipt' },
			},
		);

		const firstValid = requireConsumed(
			requireForward(createForward(first, [firstParagraph.id], [], 1)),
			first,
		);
		const secondValid = requireConsumed(
			requireForward(createForward(second, [secondParagraph.id], [], 1)),
			second,
		);
		assert.equal(firstValid.sourceContent, first.content);
		assert.equal(firstValid.sourceIndex, first.index);
		assert.equal(firstValid.sourceMerkleState, first.merkleState);
		assert.equal(firstValid.canonicalResource, resource.toString());
		assert.equal(firstValid.generatedAgainstRevisionId, revisionOne);
		assert.equal(firstValid.entryCount, 1);
		assert.equal(firstValid.maximumDeltaEntries, 1);
		assert.deepStrictEqual(
			restoreManuscriptNormalization(new Proxy(
				firstValid.restoreReceipt,
				{},
			)),
			{
				type: 'error',
				error: { reason: 'invalid-restore-receipt' },
			},
		);
		assert.deepStrictEqual(
			restoreManuscriptNormalization(
				Object.freeze(Object.create(null)),
			),
			{
				type: 'error',
				error: { reason: 'invalid-restore-receipt' },
			},
		);
		assert.deepStrictEqual(restoreManuscriptNormalization(0), {
			type: 'error',
			error: { reason: 'invalid-restore-receipt' },
		});
		const restoreWithIgnoredStructure = restoreManuscriptNormalization as (
			receipt: unknown,
			...extra: readonly unknown[]
		) => ReturnType<typeof restoreManuscriptNormalization>;
		const restoredFirst = restoreWithIgnoredStructure(
			firstValid.restoreReceipt,
			{
				root: second.content.root,
				index: second.index,
				delta: Object.freeze({}),
			},
		);
		assert.equal(restoredFirst.type, 'ok');
		assert.equal(restoredFirst.value.sourceContent, first.content);
		assert.equal(restoredFirst.value.sourceIndex, first.index);
		assert.equal(restoredFirst.value.sourceMerkleState, first.merkleState);
		assert.equal(restoredFirst.value.targetContent, firstValid.targetContent);
		assert.equal(restoredFirst.value.targetIndex, firstValid.targetIndex);
		assert.equal(
			restoredFirst.value.targetMerkleState,
			firstValid.targetMerkleState,
		);
		assert.deepStrictEqual(
			restoreManuscriptNormalization(firstValid.restoreReceipt),
			{
				type: 'error',
				error: { reason: 'invalid-restore-receipt' },
			},
		);
		assert.equal(
			restoreManuscriptNormalization(secondValid.restoreReceipt).type,
			'ok',
		);
	});

	test('authenticates the source Merkle state before scanning or instrumentation', () => {
		const touchedParagraph = paragraph(301, [
			text(300, 'left'),
			text(302, 'right'),
		]);
		const source = checkpoint(manuscript(304, 303, [touchedParagraph]));
		let stateTrapCount = 0;
		const proxiedState = new Proxy(source.merkleState, {
			get: (target, property, receiver) => {
				stateTrapCount += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		let visited = 0;
		const result = createForward(
			Object.freeze({
				content: source.content,
				index: source.index,
				merkleState: proxiedState,
			}),
			[touchedParagraph.id],
			[],
			1,
			{
				onVisitNode: () => {
					visited += 1;
				},
			},
		);
		assert.deepStrictEqual(result, {
			type: 'error',
			error: { reason: 'normalization-candidate-failed' },
		});
		assert.equal(stateTrapCount, 0);
		assert.equal(visited, 0);
	});
});
