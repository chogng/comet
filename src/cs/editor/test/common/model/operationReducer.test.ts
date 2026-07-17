/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseOperationId,
	parseRevisionId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type OperationId,
	type RevisionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import type {
	AcademicGraphSnapshot,
	ClaimEntity,
	ClaimEvidenceRelation,
	EvidenceLink,
	ReferenceSnapshot,
} from 'cs/editor/common/model/academicGraph';
import { createDocumentIndex, type DocumentIndex } from 'cs/editor/common/model/documentIndex';
import type {
	BodyNode,
	ManuscriptNode,
	ParagraphNode,
	TextNode,
} from 'cs/editor/common/model/manuscript';
import { maximumManuscriptTextUtf16Length } from 'cs/editor/common/model/manuscriptSchema';
import { normalizeManuscriptRoot } from 'cs/editor/common/model/normalization';
import type { Operation } from 'cs/editor/common/model/operation';
import {
	isTrustedManuscriptOperationCapture,
	isTrustedManuscriptOperationTouchSet,
	isTrustedManuscriptOperationTransition,
	reduceManuscriptOperation,
	type IManuscriptOperationReducerInstrumentation,
	type IReducedManuscriptOperation,
	type ReduceManuscriptOperationResult,
} from 'cs/editor/common/model/operationReducer';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	rebuildRevisionMerkleState,
	type DocumentSnapshot,
	type RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';

interface IFixtureIds {
	readonly root: NodeId;
	readonly body: NodeId;
	readonly firstParagraph: NodeId;
	readonly leftText: NodeId;
	readonly rightText: NodeId;
	readonly secondParagraph: NodeId;
	readonly secondText: NodeId;
	readonly reference: EntityId;
	readonly evidence: EntityId;
	readonly claim: EntityId;
}

interface IFixture {
	readonly resource: URI;
	readonly snapshot: DocumentSnapshot;
	readonly index: DocumentIndex;
	readonly merkleState: RevisionMerkleState;
	readonly ids: IFixtureIds;
}

interface IFixtureOptions {
	readonly leftValue?: string;
	readonly leftMarks?: TextNode['marks'];
	readonly rightValue?: string;
	readonly rightMarks?: TextNode['marks'];
}

interface INodePayloadAccessProbe {
	enabled: boolean;
	readonly visitedNodeIds: Set<NodeId>;
}

suite('Manuscript Operation reducer', () => {
	test('applies all fourteen Operation kinds with trusted captures', () => {
		const cases: readonly {
			readonly type: Operation['type'];
			readonly create: (fixture: IFixture) => Operation;
			readonly verify: (
				fixture: IFixture,
				reduced: IReducedManuscriptOperation,
			) => void;
		}[] = [
			{
				type: 'insert-node',
				create: fixture => ({
					id: operationId(401),
					type: 'insert-node',
					parentNodeId: fixture.ids.body,
					expectedParentHash: nodeHash(fixture, fixture.ids.body),
					childIndex: 2,
					node: {
						id: nodeId(20),
						type: 'blockQuote',
						attrs: {},
						children: [{
							id: nodeId(21),
							type: 'paragraph',
							attrs: { alignment: 'start' },
							children: [
								{
									id: nodeId(22),
									type: 'text',
									value: '',
									marks: [],
								},
								{
									id: nodeId(23),
									type: 'text',
									value: 'inserted',
									marks: [],
								},
							],
						}],
					},
				}),
				verify: (fixture, reduced) => {
					const body = reduced.index.getNode(fixture.ids.body);
					assert.equal(body?.type, 'body');
					assert.equal(body?.children.length, 3);
					assert.deepStrictEqual(
						reduced.touchSet.normalizationParentNodeIds,
						[fixture.ids.body, nodeId(21)],
					);
					const normalized = normalizeManuscriptRoot({
						root: reduced.content.root,
						index: reduced.index,
						touchedParentNodeIds:
							reduced.touchSet.normalizationParentNodeIds,
						touchedNodeIds: [],
						maximumDeltaEntries: 1_024,
					});
					if (normalized.type === 'error') {
						throw new Error(normalized.error.reason);
					}
					assert.equal(normalized.type, 'ok');
					const normalizedIndex = createDocumentIndex(normalized.value.root);
					if (normalizedIndex.type === 'error') {
						throw new Error(normalizedIndex.error.reason);
					}
					assert.equal(normalizedIndex.type, 'ok');
					const insertedParagraph = normalizedIndex.value.getNode(nodeId(21));
					assert.equal(insertedParagraph?.type, 'paragraph');
					assert.deepStrictEqual(
						insertedParagraph?.children.map(child => child.id),
						[nodeId(23)],
					);
					assert.equal(reduced.positionMapFragments[0]?.kind, 'child-insert');
				},
			},
			{
				type: 'delete-node',
				create: fixture => ({
					id: operationId(402),
					type: 'delete-node',
					targetNodeId: fixture.ids.secondParagraph,
					expectedNodeHash: nodeHash(fixture, fixture.ids.secondParagraph),
				}),
				verify: (fixture, reduced) => {
					assert.equal(reduced.index.hasNode(fixture.ids.secondParagraph), false);
					assert.equal(reduced.positionMapFragments[0]?.kind, 'child-delete');
				},
			},
			{
				type: 'move-node',
				create: fixture => ({
					id: operationId(403),
					type: 'move-node',
					targetNodeId: fixture.ids.firstParagraph,
					expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
					newParentNodeId: fixture.ids.body,
					expectedParentHash: nodeHash(fixture, fixture.ids.body),
					childIndex: 1,
				}),
				verify: (fixture, reduced) => {
					const body = reduced.index.getNode(fixture.ids.body);
					assert.equal(body?.type, 'body');
					assert.deepStrictEqual(
						body?.children.map(child => child.id),
						[fixture.ids.secondParagraph, fixture.ids.firstParagraph],
					);
						assert.deepStrictEqual(
							reduced.touchSet.nodePaths.map(item => item.childIndexes),
							[[0, 0], [0], [0, 1], [0]],
					);
					assert.deepStrictEqual(
						reduced.positionMapFragments[0],
						{
							kind: 'child-move',
							sourceParentNodeId: fixture.ids.body,
							sourceChildIndex: 0,
							destinationParentNodeId: fixture.ids.body,
							destinationChildIndexAfterRemoval: 1,
							movedChildCount: 1,
							movedNodeIds: [
								fixture.ids.firstParagraph,
								fixture.ids.leftText,
								fixture.ids.rightText,
							],
						},
					);
				},
			},
			{
				type: 'replace-text',
				create: fixture => ({
					id: operationId(404),
					type: 'replace-text',
					textNodeId: fixture.ids.leftText,
					expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
					startUtf16Offset: offset(1),
					endUtf16Offset: offset(4),
					replacement: 'X',
				}),
				verify: (fixture, reduced) => {
					const text = reduced.index.getNode(fixture.ids.leftText);
					assert.equal(text?.type, 'text');
					assert.equal(text?.value, 'aXa');
					assert.equal(reduced.positionMapFragments[0]?.kind, 'text-replace');
				},
			},
			{
				type: 'split-text',
				create: fixture => ({
					id: operationId(405),
					type: 'split-text',
					textNodeId: fixture.ids.leftText,
					expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
					splitUtf16Offset: offset(2),
					rightTextNodeId: nodeId(24),
				}),
				verify: (fixture, reduced) => {
					const left = reduced.index.getNode(fixture.ids.leftText);
					const right = reduced.index.getNode(nodeId(24));
					assert.equal(left?.type, 'text');
					assert.equal(right?.type, 'text');
					assert.equal(left?.value, 'al');
					assert.equal(right?.value, 'pha');
					assert.equal(reduced.positionMapFragments[0]?.kind, 'text-split');
				},
			},
			{
				type: 'join-text',
				create: fixture => ({
					id: operationId(406),
					type: 'join-text',
					leftTextNodeId: fixture.ids.leftText,
					expectedLeftNodeHash: nodeHash(fixture, fixture.ids.leftText),
					rightTextNodeId: fixture.ids.rightText,
					expectedRightNodeHash: nodeHash(fixture, fixture.ids.rightText),
				}),
				verify: (fixture, reduced) => {
					const left = reduced.index.getNode(fixture.ids.leftText);
					assert.equal(left?.type, 'text');
					assert.equal(left?.value, 'alphabeta');
					assert.equal(reduced.index.hasNode(fixture.ids.rightText), false);
					assert.equal(reduced.positionMapFragments[0]?.kind, 'text-join');
				},
			},
			{
				type: 'set-node-attributes',
				create: fixture => ({
					id: operationId(407),
					type: 'set-node-attributes',
					nodeId: fixture.ids.firstParagraph,
					expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
					attributes: { alignment: 'center' },
				}),
				verify: (fixture, reduced) => {
					const paragraph = reduced.index.getNode(fixture.ids.firstParagraph);
					assert.equal(paragraph?.type, 'paragraph');
					assert.equal(paragraph?.attrs.alignment, 'center');
				},
			},
			{
				type: 'set-text-marks',
				create: fixture => ({
					id: operationId(408),
					type: 'set-text-marks',
					textNodeId: fixture.ids.leftText,
					expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
					marks: [{ type: 'bold' }],
				}),
				verify: (fixture, reduced) => {
					const text = reduced.index.getNode(fixture.ids.leftText);
					assert.equal(text?.type, 'text');
					assert.deepStrictEqual(text?.marks, [{ type: 'bold' }]);
				},
			},
			{
				type: 'create-academic-entity',
				create: () => ({
					id: operationId(409),
					type: 'create-academic-entity',
					entity: referenceSnapshot(entityId(104), 'Created'),
				}),
				verify: (_fixture, reduced) => {
					assert.deepStrictEqual(
						reduced.content.academicGraph.referenceSnapshots.map(item => item.id),
						[entityId(101), entityId(104)],
					);
				},
			},
			{
				type: 'replace-academic-entity',
				create: fixture => ({
					id: operationId(410),
					type: 'replace-academic-entity',
					entityId: fixture.ids.reference,
					expectedEntityHash: entityHash(fixture, fixture.ids.reference),
					replacement: referenceSnapshot(fixture.ids.reference, 'Replaced'),
				}),
				verify: (_fixture, reduced) => {
					assert.deepStrictEqual(
						reduced.content.academicGraph.referenceSnapshots[0]?.cslJson,
						{ title: 'Replaced' },
					);
				},
			},
			{
				type: 'delete-academic-entity',
				create: fixture => ({
					id: operationId(411),
					type: 'delete-academic-entity',
					entityId: fixture.ids.reference,
					expectedEntityHash: entityHash(fixture, fixture.ids.reference),
				}),
				verify: (_fixture, reduced) => {
					assert.equal(
						reduced.content.academicGraph.referenceSnapshots.length,
						0,
					);
				},
			},
			{
				type: 'set-claim-evidence-relation',
				create: fixture => ({
					id: operationId(412),
					type: 'set-claim-evidence-relation',
					claimId: fixture.ids.claim,
					evidenceId: fixture.ids.evidence,
					expectedRelationHash: relationHash(
						fixture,
						fixture.ids.claim,
						fixture.ids.evidence,
					),
					replacement: relation(
						fixture.ids.claim,
						fixture.ids.evidence,
						'contradicts',
					),
				}),
				verify: (_fixture, reduced) => {
					assert.equal(
						reduced.content.academicGraph.claimEvidenceRelations[0]?.relation,
						'contradicts',
					);
				},
			},
			{
				type: 'set-metadata',
				create: fixture => ({
					id: operationId(413),
					type: 'set-metadata',
					expectedMetadataHash: fixture.merkleState.metadataHash,
					metadata: {
						title: 'Changed title',
						authors: [],
						abstract: 'Changed abstract',
						keywords: ['changed'],
					},
				}),
				verify: (_fixture, reduced) => {
					assert.equal(reduced.content.metadata.title, 'Changed title');
					assert.equal(reduced.touchSet.metadata, true);
				},
			},
			{
				type: 'set-settings',
				create: fixture => ({
					id: operationId(414),
					type: 'set-settings',
					expectedSettingsHash: fixture.merkleState.settingsHash,
					settings: {
						language: 'zh-Hans',
						citationStyle: 'apa',
						headingNumbering: true,
						bibliographyEnabled: false,
					},
				}),
				verify: (_fixture, reduced) => {
					assert.equal(reduced.content.settings.language, 'zh-Hans');
					assert.equal(reduced.touchSet.settings, true);
				},
			},
		];

		assert.equal(cases.length, 14);
		for (const operationCase of cases) {
			const fixture = createFixture();
			const originalRoot = fixture.snapshot.root;
			const originalGraph = fixture.snapshot.academicGraph;
			const operation = operationCase.create(fixture);
			assert.equal(operation.type, operationCase.type);
			const reduced = expectOk(reduce(fixture, operation));
			assert.equal(reduced.capture.type, operation.type);
			assert.equal(isTrustedManuscriptOperationCapture(reduced.capture), true);
			assert.equal(
				isTrustedManuscriptOperationCapture({ ...reduced.capture }),
				false,
			);
			assert.equal(
				isTrustedManuscriptOperationTouchSet(reduced.touchSet),
				true,
			);
			assert.equal(
				isTrustedManuscriptOperationTouchSet({ ...reduced.touchSet }),
				false,
			);
			assert.equal(
				isTrustedManuscriptOperationTransition(
					reduced.touchSet,
					fixture.snapshot,
					reduced.content,
				),
				true,
			);
			assert.equal(
				isTrustedManuscriptOperationTransition(
					reduced.touchSet,
					{ ...fixture.snapshot },
					reduced.content,
				),
				false,
			);
			assert.equal(
				isTrustedManuscriptOperationTransition(
					reduced.touchSet,
					fixture.snapshot,
					{ ...reduced.content },
				),
				false,
			);
			assert.equal(
				isTrustedManuscriptOperationTransition(
					{ ...reduced.touchSet },
					fixture.snapshot,
					reduced.content,
				),
				false,
			);
			assert.equal(Object.isFrozen(reduced.content), true);
			assert.equal(Object.isFrozen(reduced.touchSet), true);
			assert.equal(Object.isFrozen(reduced.touchSet.nodePaths), true);
			assert.equal(Object.isFrozen(reduced.positionMapFragments), true);
			for (const nodePath of reduced.touchSet.nodePaths) {
				assert.equal(
					nodePath.childIndexes.length,
					nodePath.path.length - 1,
				);
				assert.equal(Object.isFrozen(nodePath.childIndexes), true);
			}
			assert.strictEqual(fixture.snapshot.root, originalRoot);
			assert.strictEqual(fixture.snapshot.academicGraph, originalGraph);
			operationCase.verify(fixture, reduced);
			assertIndexMatchesRoot(reduced.content.root, reduced.index);
		}
	});

	test('rejects step-local hash conflicts without changing the trusted base', () => {
		const fixture = createFixture();
		const failures: readonly Operation[] = [
			{
				id: operationId(420),
				type: 'replace-text',
				textNodeId: fixture.ids.leftText,
				expectedNodeHash: contentHash(999),
				startUtf16Offset: offset(0),
				endUtf16Offset: offset(1),
				replacement: 'x',
			},
			{
				id: operationId(421),
				type: 'move-node',
				targetNodeId: fixture.ids.firstParagraph,
				expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
				newParentNodeId: fixture.ids.body,
				expectedParentHash: contentHash(998),
				childIndex: 1,
			},
			{
				id: operationId(422),
				type: 'replace-academic-entity',
				entityId: fixture.ids.reference,
				expectedEntityHash: contentHash(997),
				replacement: referenceSnapshot(fixture.ids.reference, 'No change'),
			},
			{
				id: operationId(423),
				type: 'set-claim-evidence-relation',
				claimId: fixture.ids.claim,
				evidenceId: fixture.ids.evidence,
				expectedRelationHash: null,
				replacement: null,
			},
			{
				id: operationId(424),
				type: 'set-metadata',
				expectedMetadataHash: contentHash(996),
				metadata: fixture.snapshot.metadata,
			},
			{
				id: operationId(425),
				type: 'set-settings',
				expectedSettingsHash: contentHash(995),
				settings: fixture.snapshot.settings,
			},
		];
		for (const operation of failures) {
			const result = reduce(fixture, operation);
			assert.equal(result.type, 'error');
			if (result.type === 'error') {
				assert.equal(result.error.reason, 'hash-mismatch');
			}
			const leftText = fixture.index.getNode(fixture.ids.leftText);
			assert.equal(
				leftText?.type === 'text'
					? leftText.value
					: undefined,
				'alpha',
			);
		}
	});

	test('enforces node identity, parent structure, cycles, and reducer budgets', () => {
		const fixture = createFixture();
		const duplicate = reduce(fixture, {
			id: operationId(430),
			type: 'insert-node',
			parentNodeId: fixture.ids.body,
			expectedParentHash: nodeHash(fixture, fixture.ids.body),
			childIndex: 0,
			node: {
				id: fixture.ids.leftText,
				type: 'paragraph',
				attrs: { alignment: 'start' },
				children: [],
			},
		});
		expectFailure(duplicate, 'duplicate-node-id');

		const invalidParent = reduce(fixture, {
			id: operationId(431),
			type: 'insert-node',
			parentNodeId: fixture.ids.firstParagraph,
			expectedParentHash: nodeHash(fixture, fixture.ids.firstParagraph),
			childIndex: 0,
			node: {
				id: nodeId(30),
				type: 'paragraph',
				attrs: { alignment: 'start' },
				children: [],
			},
		});
		expectFailure(invalidParent, 'invalid-parent-child');

		const deleteRoot = reduce(fixture, {
			id: operationId(432),
			type: 'delete-node',
			targetNodeId: fixture.ids.root,
			expectedNodeHash: nodeHash(fixture, fixture.ids.root),
		});
		expectFailure(deleteRoot, 'root-operation-forbidden');

		const cycle = reduce(fixture, {
			id: operationId(433),
			type: 'move-node',
			targetNodeId: fixture.ids.body,
			expectedNodeHash: nodeHash(fixture, fixture.ids.body),
			newParentNodeId: fixture.ids.firstParagraph,
			expectedParentHash: nodeHash(fixture, fixture.ids.firstParagraph),
			childIndex: 0,
		});
		expectFailure(cycle, 'node-cycle');

			const splitBudget = reduceManuscriptOperation({
				resource: fixture.resource,
				snapshot: fixture.snapshot,
			index: fixture.index,
			merkleState: fixture.merkleState,
			limits: {
				maximumNodes: fixture.index.nodeCount,
				maximumDepth: 256,
			},
			operation: {
				id: operationId(434),
				type: 'split-text',
				textNodeId: fixture.ids.leftText,
				expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
				splitUtf16Offset: offset(2),
				rightTextNodeId: nodeId(31),
			},
		});
		expectFailure(splitBudget, 'node-budget-exceeded');
	});

	test('uses removal-relative same-parent Move coordinates', () => {
		const fixture = createFixture();
		const keepPosition = expectOk(reduce(fixture, {
			id: operationId(440),
			type: 'move-node',
			targetNodeId: fixture.ids.firstParagraph,
			expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
			newParentNodeId: fixture.ids.body,
			expectedParentHash: nodeHash(fixture, fixture.ids.body),
			childIndex: 0,
		}));
		const keptBody = keepPosition.index.getNode(fixture.ids.body);
		assert.equal(keptBody?.type, 'body');
		assert.deepStrictEqual(
			keptBody?.children.map(child => child.id),
			[fixture.ids.firstParagraph, fixture.ids.secondParagraph],
		);

		const moveToEnd = expectOk(reduce(fixture, {
			id: operationId(441),
			type: 'move-node',
			targetNodeId: fixture.ids.firstParagraph,
			expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
			newParentNodeId: fixture.ids.body,
			expectedParentHash: nodeHash(fixture, fixture.ids.body),
			childIndex: 1,
		}));
		const movedBody = moveToEnd.index.getNode(fixture.ids.body);
		assert.equal(movedBody?.type, 'body');
		assert.deepStrictEqual(
			movedBody?.children.map(child => child.id),
			[fixture.ids.secondParagraph, fixture.ids.firstParagraph],
		);

		const outOfRange = reduce(fixture, {
			id: operationId(442),
			type: 'move-node',
			targetNodeId: fixture.ids.firstParagraph,
			expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
			newParentNodeId: fixture.ids.body,
			expectedParentHash: nodeHash(fixture, fixture.ids.body),
			childIndex: 2,
		});
		expectFailure(outOfRange, 'child-index-out-of-range');
	});

	test('moves a subtree between parents without losing either changed path', () => {
		const fixture = createFixture();
		const reduced = expectOk(reduce(fixture, {
			id: operationId(443),
			type: 'move-node',
			targetNodeId: fixture.ids.rightText,
			expectedNodeHash: nodeHash(fixture, fixture.ids.rightText),
			newParentNodeId: fixture.ids.secondParagraph,
			expectedParentHash: nodeHash(fixture, fixture.ids.secondParagraph),
			childIndex: 1,
		}));
		const first = reduced.index.getNode(fixture.ids.firstParagraph);
		const second = reduced.index.getNode(fixture.ids.secondParagraph);
		assert.equal(first?.type, 'paragraph');
		assert.equal(second?.type, 'paragraph');
		assert.deepStrictEqual(
			first?.children.map(child => child.id),
			[fixture.ids.leftText],
		);
		assert.deepStrictEqual(
			second?.children.map(child => child.id),
			[fixture.ids.secondText, fixture.ids.rightText],
		);
		assert.deepStrictEqual(
			reduced.touchSet.normalizationParentNodeIds,
			[fixture.ids.firstParagraph, fixture.ids.secondParagraph],
		);
		assert.equal(reduced.touchSet.nodePaths.length, 6);
		assert.deepStrictEqual(
			reduced.touchSet.nodePaths.map(path => [
				path.phase,
				path.path[path.path.length - 1],
			]),
			[
				['before', fixture.ids.rightText],
				['before', fixture.ids.firstParagraph],
				['before', fixture.ids.secondParagraph],
				['after', fixture.ids.rightText],
				['after', fixture.ids.firstParagraph],
				['after', fixture.ids.secondParagraph],
			],
		);
	});

	test('validates UTF-16 boundaries and Text schema length', () => {
		const surrogateFixture = createFixture({
			leftValue: 'A😀B',
		});
		const surrogateSplit = reduce(surrogateFixture, {
			id: operationId(450),
			type: 'split-text',
			textNodeId: surrogateFixture.ids.leftText,
			expectedNodeHash: nodeHash(
				surrogateFixture,
				surrogateFixture.ids.leftText,
			),
			splitUtf16Offset: offset(2),
			rightTextNodeId: nodeId(40),
		});
		expectFailure(surrogateSplit, 'invalid-text-boundary');

		const offsetPastEnd = reduce(surrogateFixture, {
			id: operationId(451),
			type: 'replace-text',
			textNodeId: surrogateFixture.ids.leftText,
			expectedNodeHash: nodeHash(
				surrogateFixture,
				surrogateFixture.ids.leftText,
			),
			startUtf16Offset: offset(0),
			endUtf16Offset: offset(5),
			replacement: '',
		});
		expectFailure(offsetPastEnd, 'invalid-text-offset');

		const overflowReplace = reduce(surrogateFixture, {
			id: operationId(452),
			type: 'replace-text',
			textNodeId: surrogateFixture.ids.leftText,
			expectedNodeHash: nodeHash(
				surrogateFixture,
				surrogateFixture.ids.leftText,
			),
			startUtf16Offset: offset(0),
			endUtf16Offset: offset(0),
			replacement: 'x'.repeat(maximumManuscriptTextUtf16Length),
		});
		expectFailure(overflowReplace, 'text-budget-exceeded');
	});

	test('JoinText requires adjacent Text with identical canonical marks', () => {
		const mismatched = createFixture({
			leftMarks: [{ type: 'bold' }],
			rightMarks: [{ type: 'italic' }],
		});
		const marksResult = reduce(mismatched, {
			id: operationId(460),
			type: 'join-text',
			leftTextNodeId: mismatched.ids.leftText,
			expectedLeftNodeHash: nodeHash(mismatched, mismatched.ids.leftText),
			rightTextNodeId: mismatched.ids.rightText,
			expectedRightNodeHash: nodeHash(mismatched, mismatched.ids.rightText),
		});
		expectFailure(marksResult, 'text-marks-mismatch');

		const oversize = createFixture({
			leftValue: 'a'.repeat(600_000),
			rightValue: 'b'.repeat(400_001),
		});
		const lengthResult = reduce(oversize, {
			id: operationId(461),
			type: 'join-text',
			leftTextNodeId: oversize.ids.leftText,
			expectedLeftNodeHash: nodeHash(oversize, oversize.ids.leftText),
			rightTextNodeId: oversize.ids.rightText,
			expectedRightNodeHash: nodeHash(oversize, oversize.ids.rightText),
		});
		expectFailure(lengthResult, 'text-budget-exceeded');
	});

	test('rejects attribute-kind changes and dangling relations', () => {
		const fixture = createFixture();
		const attributes = reduce(fixture, {
			id: operationId(470),
			type: 'set-node-attributes',
			nodeId: fixture.ids.firstParagraph,
			expectedNodeHash: nodeHash(fixture, fixture.ids.firstParagraph),
			attributes: { level: 2 },
		});
		expectFailure(attributes, 'invalid-node-kind');

		const dangling = reduce(fixture, {
			id: operationId(472),
			type: 'set-claim-evidence-relation',
			claimId: entityId(199),
			evidenceId: fixture.ids.evidence,
			expectedRelationHash: null,
			replacement: relation(
				entityId(199),
				fixture.ids.evidence,
				'supports',
			),
		});
		expectFailure(dangling, 'dangling-relation');
	});

	test('owns academic payloads, supports cross-kind replacement, and binds Claim resources', () => {
		const fixture = createFixture();
		const sourceUri = URI.parse('https://example.test/owned-evidence');
		const locator = { kind: 'page' as const, page: 3, pageLabel: 'p. 3' };
		const verifiedBy = { type: 'human' as const, id: 'owner-before' };
		const reduced = expectOk(reduce(fixture, {
			id: operationId(471),
			type: 'replace-academic-entity',
			entityId: fixture.ids.reference,
			expectedEntityHash: entityHash(fixture, fixture.ids.reference),
			replacement: {
				id: fixture.ids.reference,
				type: 'evidence-link',
				sourceUri,
				sourceContentHash: contentHash(100),
				locator,
				verificationStatus: 'verified',
				verifiedBy,
				verifiedAt: '2026-07-17T00:00:00.000Z',
			},
		}));
		assert.equal(
			reduced.content.academicGraph.referenceSnapshots.length,
			0,
		);
		const ownedEvidence = reduced.content.academicGraph.evidenceLinks.find(
			entity => entity.id === fixture.ids.reference,
		);
		assert.equal(ownedEvidence?.locator.kind, 'page');
		assert.equal(
			ownedEvidence?.locator.kind === 'page'
				? ownedEvidence.locator.page
				: undefined,
			3,
		);
		assert.equal(ownedEvidence?.verifiedBy?.id, 'owner-before');
		assert.notStrictEqual(ownedEvidence?.sourceUri, sourceUri);
		assert.deepStrictEqual(
			reduced.touchSet.academicPaths.map(path => [
				path.phase,
				path.collection,
			]),
			[
				['before', 'referenceSnapshots'],
				['after', 'evidenceLinks'],
			],
		);

		locator.page = 99;
		verifiedBy.id = 'owner-after';
		Object.defineProperty(sourceUri, 'path', {
			value: '/mutated-after-reduce',
		});
		assert.equal(
			ownedEvidence?.locator.kind === 'page'
				? ownedEvidence.locator.page
				: undefined,
			3,
		);
		assert.equal(ownedEvidence?.verifiedBy?.id, 'owner-before');
		assert.equal(ownedEvidence?.sourceUri.path, '/owned-evidence');
		assert.equal(Object.isFrozen(ownedEvidence?.locator), true);
		assert.equal(Object.isFrozen(ownedEvidence?.verifiedBy), true);

		const relationActor = {
			type: 'system' as const,
			id: 'relation-before',
			role: 'validator' as const,
		};
		const relationReplacement: ClaimEvidenceRelation = {
			type: 'claim-evidence-relation',
			claimId: fixture.ids.claim,
			evidenceId: fixture.ids.evidence,
			relation: 'partially-supports',
			assessedBy: relationActor,
			confidence: 0.75,
		};
		const relationReduced = expectOk(reduce(fixture, {
			id: operationId(472),
			type: 'set-claim-evidence-relation',
			claimId: fixture.ids.claim,
			evidenceId: fixture.ids.evidence,
			expectedRelationHash: relationHash(
				fixture,
				fixture.ids.claim,
				fixture.ids.evidence,
			),
			replacement: relationReplacement,
		}));
		relationActor.id = 'relation-after';
		assert.equal(
			relationReduced.content.academicGraph
				.claimEvidenceRelations[0]?.assessedBy.id,
			'relation-before',
		);
		assert.equal(
			Object.isFrozen(
				relationReduced.content.academicGraph
					.claimEvidenceRelations[0]?.assessedBy,
			),
			true,
		);

		const otherResource = createManuscriptDraftResource(uuid(399));
		const mismatchedClaim = reduce(fixture, {
			id: operationId(473),
			type: 'create-academic-entity',
			entity: {
				id: entityId(199),
				type: 'claim',
				anchor: {
					document: {
						resource: otherResource,
						revisionId: revisionId(200),
					},
					primary: {
						kind: 'text',
						textNodeId: fixture.ids.leftText,
						utf16Offset: offset(0),
						affinity: 'after',
					},
				},
				textSnapshot: 'mismatch',
			},
		});
		expectFailure(mismatchedClaim, 'invalid-operation');
	});

	test('updates a 20k-wide tree without recursive traversal overflow', () => {
		const fixture = createWideFixture(20_000);
		const targetId = nodeId(30_000 + 19_999);
		const reduced = expectOk(reduce(fixture, {
			id: operationId(480),
			type: 'set-node-attributes',
			nodeId: targetId,
			expectedNodeHash: nodeHash(fixture, targetId),
			attributes: { alignment: 'end' },
		}));
		const target = reduced.index.getNode(targetId);
		assert.equal(target?.type, 'paragraph');
		assert.equal(target?.attrs.alignment, 'end');
		assert.equal(reduced.index.nodeCount, fixture.index.nodeCount);
		assert.strictEqual(
			reduced.index.preorderNodeIds,
			fixture.index.preorderNodeIds,
		);
		assert.strictEqual(
			reduced.index.getNode(nodeId(30_000)),
			fixture.index.getNode(nodeId(30_000)),
		);
	});

	test('updates a 20k-wide structural index without visiting unrelated payload descendants', () => {
		const { fixture, probe } = createInstrumentedWideFixture(20_000);
		const insertedNodeId = nodeId(90_000);
		const shiftedNodeId = nodeId(30_000 + 10_000);
		const untouchedTextNodeId = nodeId(60_000 + 10_000);
		let documentChildSlotsCopied = 0;
		let indexTrieSlotsCopied = 0;
		let changedParentReads = 0;
		let preorderNodeReads = 0;
		let preorderMaterializations = 0;
		const instrumentation: IManuscriptOperationReducerInstrumentation = {
			onNodePayloadRead: (_nodeId, kind) => {
				if (kind === 'changed-parent-lookup') {
					changedParentReads += 1;
				} else if (kind === 'preorder-materialization') {
					preorderNodeReads += 1;
				}
			},
			onShallowCopy: (kind, copiedSlots) => {
				if (kind === 'document-child-slots') {
					documentChildSlotsCopied += copiedSlots;
				} else if (kind.startsWith('index-')) {
					indexTrieSlotsCopied += copiedSlots;
				}
			},
			onPreorderMaterialized: () => {
				preorderMaterializations += 1;
			},
		};
		probe.enabled = true;
		const reduced = expectOk(reduce(fixture, {
			id: operationId(481),
			type: 'insert-node',
			parentNodeId: fixture.ids.body,
			expectedParentHash: nodeHash(fixture, fixture.ids.body),
			childIndex: 10_000,
			node: {
				id: insertedNodeId,
				type: 'paragraph',
				attrs: { alignment: 'start' },
				children: [],
			},
		}, instrumentation));

		assert.deepStrictEqual([...probe.visitedNodeIds], []);
		assert.equal(documentChildSlotsCopied, 20_002);
		assert.equal(indexTrieSlotsCopied < 1_000, true);
		assert.equal(changedParentReads, 0);
		assert.equal(preorderNodeReads, 0);
		assert.equal(preorderMaterializations, 0);
		assert.equal(reduced.index.nodeCount, fixture.index.nodeCount + 1);
		assert.deepStrictEqual(
			reduced.index.getParentLocation(insertedNodeId),
			{ parentNodeId: fixture.ids.body, childIndex: 10_000 },
		);
		assert.equal(changedParentReads, 0);
		assert.deepStrictEqual(
			reduced.index.getParentLocation(shiftedNodeId),
			{ parentNodeId: fixture.ids.body, childIndex: 10_001 },
		);
		assert.equal(changedParentReads, 20_001);
		assert.strictEqual(
			reduced.index.getNode(untouchedTextNodeId),
			fixture.index.getNode(untouchedTextNodeId),
		);
		probe.enabled = false;
		assert.equal(
			reduced.index.preorderNodeIds.indexOf(insertedNodeId),
			2 + (10_000 * 2),
		);
		assert.equal(preorderNodeReads, 40_003);
		assert.equal(preorderMaterializations, 1);
	});

	test('keeps 1024 structural overlays flat and oracle-equivalent', () => {
		let fixture = createFixture();
		let indexTriePathCopies = 0;
		let changedParentReads = 0;
		let preorderMaterializations = 0;
		let nodeOverlayValues = -1;
		let nodeOverlayTombstones = -1;
		let parentOverlayValues = -1;
		let parentOverlayTombstones = -1;
		let parentVersionValues = -1;
		let parentVersionTombstones = -1;
		const instrumentation: IManuscriptOperationReducerInstrumentation = {
			onNodePayloadRead: (_nodeId, kind) => {
				if (kind === 'changed-parent-lookup') {
					changedParentReads += 1;
				}
			},
			onShallowCopy: kind => {
				if (kind.startsWith('index-')) {
					indexTriePathCopies += 1;
				}
			},
			onPreorderMaterialized: () => {
				preorderMaterializations += 1;
			},
			onIndexOverlayCardinality: (
				kind,
				valueEntries,
				tombstoneEntries,
			) => {
				switch (kind) {
					case 'nodes':
						nodeOverlayValues = valueEntries;
						nodeOverlayTombstones = tombstoneEntries;
						break;
					case 'parents':
						parentOverlayValues = valueEntries;
						parentOverlayTombstones = tombstoneEntries;
						break;
					case 'parent-versions':
						parentVersionValues = valueEntries;
						parentVersionTombstones = tombstoneEntries;
						break;
				}
			},
		};

		for (let pair = 0; pair < 512; pair += 1) {
			const rightTextNodeId = nodeId(1_000 + pair);
			indexTriePathCopies = 0;
			changedParentReads = 0;
			fixture = advanceFixture(fixture, {
				id: operationId(1_000 + (pair * 2)),
				type: 'split-text',
				textNodeId: fixture.ids.leftText,
				expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
				splitUtf16Offset: offset(2),
				rightTextNodeId,
			}, instrumentation);
			assert.equal(indexTriePathCopies <= 400, true);
			assert.equal(changedParentReads, 0);

			indexTriePathCopies = 0;
			changedParentReads = 0;
			fixture = advanceFixture(fixture, {
				id: operationId(1_001 + (pair * 2)),
				type: 'join-text',
				leftTextNodeId: fixture.ids.leftText,
				expectedLeftNodeHash: nodeHash(fixture, fixture.ids.leftText),
				rightTextNodeId,
				expectedRightNodeHash: nodeHash(fixture, rightTextNodeId),
			}, instrumentation);
			assert.equal(indexTriePathCopies <= 400, true);
			assert.equal(changedParentReads, 0);
			assert.equal(preorderMaterializations, 0);
			assert.deepStrictEqual(
				[
					nodeOverlayValues,
					nodeOverlayTombstones,
					parentOverlayValues,
					parentOverlayTombstones,
					parentVersionValues,
					parentVersionTombstones,
				],
				[4, 0, 1, 0, 1, 0],
			);
		}

		assert.equal(fixture.index.nodeCount, 7);
		assertIndexMatchesRoot(fixture.snapshot.root, fixture.index);
		assert.equal(preorderMaterializations, 1);
	});

	test('prunes a removed temporary parent and its index version', () => {
		let fixture = createFixture();
		let cardinalities: readonly number[] = [];
		const observed = new Map<string, readonly [number, number]>();
		const instrumentation: IManuscriptOperationReducerInstrumentation = {
			onIndexOverlayCardinality: (
				kind,
				valueEntries,
				tombstoneEntries,
			) => {
				observed.set(kind, [valueEntries, tombstoneEntries]);
				cardinalities = [
					...(observed.get('nodes') ?? [-1, -1]),
					...(observed.get('parents') ?? [-1, -1]),
					...(observed.get('parent-versions') ?? [-1, -1]),
				];
			},
		};
		const temporaryParagraphId = nodeId(2_500);
		const temporaryTextId = nodeId(2_501);
		const temporaryRightTextId = nodeId(2_502);

		fixture = advanceFixture(fixture, {
			id: operationId(2_500),
			type: 'insert-node',
			parentNodeId: fixture.ids.body,
			expectedParentHash: nodeHash(fixture, fixture.ids.body),
			childIndex: 2,
			node: {
				id: temporaryParagraphId,
				type: 'paragraph',
				attrs: { alignment: 'start' },
				children: [{
					id: temporaryTextId,
					type: 'text',
					value: 'temporary',
					marks: [],
				}],
			},
		}, instrumentation);
		fixture = advanceFixture(fixture, {
			id: operationId(2_501),
			type: 'split-text',
			textNodeId: temporaryTextId,
			expectedNodeHash: nodeHash(fixture, temporaryTextId),
			splitUtf16Offset: offset(4),
			rightTextNodeId: temporaryRightTextId,
		}, instrumentation);
		assert.deepStrictEqual(cardinalities, [5, 0, 3, 0, 2, 0]);

		fixture = advanceFixture(fixture, {
			id: operationId(2_502),
			type: 'delete-node',
			targetNodeId: temporaryParagraphId,
			expectedNodeHash: nodeHash(fixture, temporaryParagraphId),
		}, instrumentation);

		assert.deepStrictEqual(cardinalities, [2, 0, 0, 0, 1, 0]);
		assert.equal(fixture.index.hasNode(temporaryParagraphId), false);
		assert.equal(fixture.index.hasNode(temporaryTextId), false);
		assert.equal(fixture.index.hasNode(temporaryRightTextId), false);
		assertIndexMatchesRoot(fixture.snapshot.root, fixture.index);
	});
});

function createFixture(options: IFixtureOptions = {}): IFixture {
	const ids: IFixtureIds = {
		root: nodeId(1),
		body: nodeId(2),
		firstParagraph: nodeId(3),
		leftText: nodeId(4),
		rightText: nodeId(5),
		secondParagraph: nodeId(6),
		secondText: nodeId(7),
		reference: entityId(101),
		evidence: entityId(102),
		claim: entityId(103),
	};
	const resource = createManuscriptDraftResource(uuid(301));
	const left: TextNode = {
		id: ids.leftText,
		type: 'text',
		value: options.leftValue ?? 'alpha',
		marks: options.leftMarks ?? [],
	};
	const right: TextNode = {
		id: ids.rightText,
		type: 'text',
		value: options.rightValue ?? 'beta',
		marks: options.rightMarks ?? [],
	};
	const firstParagraph: ParagraphNode = {
		id: ids.firstParagraph,
		type: 'paragraph',
		attrs: { alignment: 'start' },
		children: [left, right],
	};
	const secondParagraph: ParagraphNode = {
		id: ids.secondParagraph,
		type: 'paragraph',
		attrs: { alignment: 'start' },
		children: [{
			id: ids.secondText,
			type: 'text',
			value: 'second',
			marks: [],
		}],
	};
	const body: BodyNode = {
		id: ids.body,
		type: 'body',
		attrs: {},
		children: [firstParagraph, secondParagraph],
	};
	const root: ManuscriptNode = {
		id: ids.root,
		type: 'manuscript',
		attrs: {},
		children: [body],
	};
	const reference = referenceSnapshot(ids.reference, 'Reference');
	const evidence: EvidenceLink = {
		id: ids.evidence,
		type: 'evidence-link',
		sourceUri: URI.parse('https://example.test/evidence'),
		sourceContentHash: contentHash(11),
		locator: {
			kind: 'page',
			page: 7,
		},
		verificationStatus: 'verified',
		verifiedBy: {
			type: 'human',
			id: 'reviewer-1',
		},
		verifiedAt: '2026-07-17T00:00:00.000Z',
	};
	const claim: ClaimEntity = {
		id: ids.claim,
		type: 'claim',
		anchor: {
			document: {
				resource,
				revisionId: revisionId(200),
			},
			primary: {
				kind: 'text',
				textNodeId: ids.leftText,
				utf16Offset: offset(0),
				affinity: 'after',
			},
			targetNodeId: ids.firstParagraph,
			pathHint: [
				ids.root,
				ids.body,
				ids.firstParagraph,
				ids.leftText,
			],
		},
		textSnapshot: left.value,
	};
	const graph: AcademicGraphSnapshot = {
		referenceSnapshots: [reference],
		evidenceLinks: [evidence],
		claims: [claim],
		claimEvidenceRelations: [
			relation(ids.claim, ids.evidence, 'supports'),
		],
	};
	return buildFixture(resource, root, graph, ids);
}

function createWideFixture(width: number): IFixture {
	const ids: IFixtureIds = {
		root: nodeId(1),
		body: nodeId(2),
		firstParagraph: nodeId(30_000),
		leftText: nodeId(4),
		rightText: nodeId(5),
		secondParagraph: nodeId(30_001),
		secondText: nodeId(7),
		reference: entityId(101),
		evidence: entityId(102),
		claim: entityId(103),
	};
	const paragraphs: ParagraphNode[] = [];
	for (let index = 0; index < width; index += 1) {
		paragraphs.push({
			id: nodeId(30_000 + index),
			type: 'paragraph',
			attrs: { alignment: 'start' },
			children: [],
		});
	}
	const body: BodyNode = {
		id: ids.body,
		type: 'body',
		attrs: {},
		children: paragraphs as [ParagraphNode, ...ParagraphNode[]],
	};
	const root: ManuscriptNode = {
		id: ids.root,
		type: 'manuscript',
		attrs: {},
		children: [body],
	};
	return buildFixture(
		createManuscriptDraftResource(uuid(302)),
		root,
		{
			referenceSnapshots: [],
			evidenceLinks: [],
			claims: [],
			claimEvidenceRelations: [],
		},
		ids,
	);
}

function createInstrumentedWideFixture(
	width: number,
): {
	readonly fixture: IFixture;
	readonly probe: INodePayloadAccessProbe;
} {
	const ids: IFixtureIds = {
		root: nodeId(1),
		body: nodeId(2),
		firstParagraph: nodeId(30_000),
		leftText: nodeId(60_000),
		rightText: nodeId(60_001),
		secondParagraph: nodeId(30_001),
		secondText: nodeId(60_001),
		reference: entityId(101),
		evidence: entityId(102),
		claim: entityId(103),
	};
	const probe: INodePayloadAccessProbe = {
		enabled: false,
		visitedNodeIds: new Set(),
	};
	const paragraphs: ParagraphNode[] = [];
	for (let index = 0; index < width; index += 1) {
		const textNode = Object.freeze({
			id: nodeId(60_000 + index),
			type: 'text',
			value: `payload-${index}`,
			marks: Object.freeze([]),
		}) satisfies TextNode;
		const observedTextNode = new Proxy(textNode, {
			get: (target, property, receiver) => {
				if (probe.enabled) {
					probe.visitedNodeIds.add(target.id);
				}
				return Reflect.get(target, property, receiver);
			},
		});
		paragraphs.push({
			id: nodeId(30_000 + index),
			type: 'paragraph',
			attrs: { alignment: 'start' },
			children: [observedTextNode],
		});
	}
	const body: BodyNode = {
		id: ids.body,
		type: 'body',
		attrs: {},
		children: paragraphs as [ParagraphNode, ...ParagraphNode[]],
	};
	const root: ManuscriptNode = {
		id: ids.root,
		type: 'manuscript',
		attrs: {},
		children: [body],
	};
	const fixture = buildFixture(
		createManuscriptDraftResource(uuid(303)),
		root,
		{
			referenceSnapshots: [],
			evidenceLinks: [],
			claims: [],
			claimEvidenceRelations: [],
		},
		ids,
	);
	return { fixture, probe };
}

function buildFixture(
	resource: URI,
	root: ManuscriptNode,
	academicGraph: AcademicGraphSnapshot,
	ids: IFixtureIds,
): IFixture {
	const content = {
		format: documentFormat,
		formatVersion: documentFormatVersion,
		schemaId: manuscriptSchemaId,
		schemaVersion: manuscriptSchemaVersion,
		metadata: {
			title: 'Reducer fixture',
			authors: [],
			abstract: '',
			keywords: [],
		},
		root,
		academicGraph,
		settings: {
			language: 'en',
			citationStyle: 'chicago-author-date',
			headingNumbering: false,
			bibliographyEnabled: true,
		},
	} as const;
	const merkleState = rebuildRevisionMerkleState(content);
	const snapshot: DocumentSnapshot = {
		...content,
		revisionId: revisionId(201),
		documentHash: merkleState.documentHash,
	};
	const indexResult = createDocumentIndex(root);
	if (indexResult.type === 'error') {
		throw new Error(`Fixture index failed: ${indexResult.error.reason}.`);
	}
	return {
		resource,
		snapshot,
		index: indexResult.value,
		merkleState,
		ids,
	};
}

function reduce(
	fixture: IFixture,
	operation: Operation,
	instrumentation?: IManuscriptOperationReducerInstrumentation,
): ReduceManuscriptOperationResult {
	return reduceManuscriptOperation({
		resource: fixture.resource,
		snapshot: fixture.snapshot,
		index: fixture.index,
		merkleState: fixture.merkleState,
		operation,
		instrumentation,
	});
}

function advanceFixture(
	fixture: IFixture,
	operation: Operation,
	instrumentation: IManuscriptOperationReducerInstrumentation,
): IFixture {
	const reduced = expectOk(reduce(fixture, operation, instrumentation));
	const merkleState = rebuildRevisionMerkleState(reduced.content);
	return {
		...fixture,
		snapshot: {
			...reduced.content,
			revisionId: fixture.snapshot.revisionId,
			documentHash: merkleState.documentHash,
		},
		index: reduced.index,
		merkleState,
	};
}

function expectOk(result: ReduceManuscriptOperationResult): IReducedManuscriptOperation {
	if (result.type === 'error') {
		throw new Error(`Expected reducer success, received ${result.error.reason}.`);
	}
	assert.equal(result.type, 'ok');
	return result.value;
}

function expectFailure(
	result: ReduceManuscriptOperationResult,
	reason: Extract<
		ReduceManuscriptOperationResult,
		{ readonly type: 'error' }
	>['error']['reason'],
): void {
	if (result.type === 'ok') {
		throw new Error('Expected reducer failure.');
	}
	assert.equal(result.type, 'error');
	assert.equal(result.error.reason, reason);
}

function assertIndexMatchesRoot(
	root: ManuscriptNode,
	actual: DocumentIndex,
): void {
	const expectedResult = createDocumentIndex(root);
	if (expectedResult.type === 'error') {
		throw new Error(`Oracle index failed: ${expectedResult.error.reason}.`);
	}
	const expected = expectedResult.value;
	assert.equal(actual.nodeCount, expected.nodeCount);
	assert.deepStrictEqual(actual.preorderNodeIds, expected.preorderNodeIds);
	for (const id of expected.preorderNodeIds) {
		assert.strictEqual(actual.getNode(id), expected.getNode(id));
		assert.deepStrictEqual(
			actual.getParentLocation(id),
			expected.getParentLocation(id),
		);
		assert.deepStrictEqual(
			[...(actual.iteratePath(id) ?? [])],
			[...(expected.iteratePath(id) ?? [])],
		);
		assert.deepStrictEqual(
			[...(actual.iterateAncestors(id) ?? [])],
			[...(expected.iterateAncestors(id) ?? [])],
		);
	}
}

function nodeHash(fixture: IFixture, id: NodeId): ContentHash {
	const hash = fixture.merkleState.getNodeHash(id);
	if (hash === undefined) {
		throw new Error(`Missing test Node hash for ${id}.`);
	}
	return hash;
}

function entityHash(fixture: IFixture, id: EntityId): ContentHash {
	const hash = fixture.merkleState.getEntityHash(id);
	if (hash === undefined) {
		throw new Error(`Missing test Entity hash for ${id}.`);
	}
	return hash;
}

function relationHash(
	fixture: IFixture,
	claimId: EntityId,
	evidenceId: EntityId,
): ContentHash {
	const hash = fixture.merkleState.getRelationHash(claimId, evidenceId);
	if (hash === undefined) {
		throw new Error('Missing test Claim-Evidence relation hash.');
	}
	return hash;
}

function referenceSnapshot(id: EntityId, title: string): ReferenceSnapshot {
	return {
		id,
		type: 'reference-snapshot',
		cslJson: { title },
		capturedAt: '2026-07-17T00:00:00.000Z',
	};
}

function relation(
	claimId: EntityId,
	evidenceId: EntityId,
	value: ClaimEvidenceRelation['relation'],
): ClaimEvidenceRelation {
	return {
		type: 'claim-evidence-relation',
		claimId,
		evidenceId,
		relation: value,
		assessedBy: {
			type: 'system',
			id: 'validator-1',
			role: 'validator',
		},
	};
}

function nodeId(sequence: number): NodeId {
	const parsed = parseNodeId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Node ID.');
	}
	return parsed.value;
}

function entityId(sequence: number): EntityId {
	const parsed = parseEntityId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Entity ID.');
	}
	return parsed.value;
}

function operationId(sequence: number): OperationId {
	const parsed = parseOperationId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Operation ID.');
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

function contentHash(sequence: number): ContentHash {
	const parsed = parseContentHash(
		`sha256:${sequence.toString(16).padStart(64, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Content hash.');
	}
	return parsed.value;
}

function offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test UTF-16 offset.');
	}
	return parsed.value;
}

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`;
}
