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
	AcademicEntity,
	AcademicGraphSnapshot,
	ClaimEntity,
	ClaimEvidenceRelation,
	EvidenceLink,
	ReferenceSnapshot,
} from 'cs/editor/common/model/academicGraph';
import {
	createDocumentIndex,
	type DocumentIndex,
} from 'cs/editor/common/model/documentIndex';
import type {
	BodyNode,
	ManuscriptNode,
	ParagraphNode,
} from 'cs/editor/common/model/manuscript';
import type { Operation } from 'cs/editor/common/model/operation';
import {
	consumeManuscriptOperationTransition,
	reduceManuscriptOperation,
	type IConsumedManuscriptOperationTransition,
} from 'cs/editor/common/model/operationReducer';
import { rebuildRevisionMerkleState } from 'cs/editor/common/model/revisionMerkleState';
import {
	getRevisionMerkleStateStorageWitness,
	PersistentRevisionMerkleMap,
} from 'cs/editor/common/model/revisionMerkleStateInternal';
import {
	updateRevisionMerkleStateCandidate,
	type IRevisionMerkleUpdaterInstrumentation,
} from 'cs/editor/common/model/revisionMerkleUpdater';
import {
	documentFormat,
	documentFormatVersion,
	manuscriptSchemaId,
	manuscriptSchemaVersion,
	type DocumentContent,
	type RevisionMerkleState,
} from 'cs/editor/common/model/snapshot';
import {
	maximumOperationWitness,
	wideParentLookupWitness,
} from 'cs/editor/test/common/performance/manuscriptProfiles';

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
	readonly revisionId: RevisionId;
	readonly content: DocumentContent;
	readonly index: DocumentIndex;
	readonly merkleState: RevisionMerkleState;
	readonly ids: IFixtureIds;
}

interface IWideParentAccessProbe {
	enabled: boolean;
	readonly directChildSlotReads: number[];
	readonly directChildPayloadReads: Set<NodeId>;
}

suite('incremental Revision Merkle updater', () => {
	test('matches a full rebuild for all fourteen Operation kinds', () => {
		const operations: readonly ((fixture: IFixture) => Operation)[] = [
			fixture => ({
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
						children: [{
							id: nodeId(22),
							type: 'text',
							value: 'inserted',
							marks: [],
						}],
					}],
				},
			}),
			fixture => ({
				id: operationId(402),
				type: 'delete-node',
				targetNodeId: fixture.ids.secondParagraph,
				expectedNodeHash: nodeHash(
					fixture,
					fixture.ids.secondParagraph,
				),
			}),
			fixture => ({
				id: operationId(403),
				type: 'move-node',
				targetNodeId: fixture.ids.firstParagraph,
				expectedNodeHash: nodeHash(
					fixture,
					fixture.ids.firstParagraph,
				),
				newParentNodeId: fixture.ids.body,
				expectedParentHash: nodeHash(fixture, fixture.ids.body),
				childIndex: 1,
			}),
			fixture => ({
				id: operationId(404),
				type: 'replace-text',
				textNodeId: fixture.ids.leftText,
				expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
				startUtf16Offset: offset(1),
				endUtf16Offset: offset(4),
				replacement: 'X',
			}),
			fixture => ({
				id: operationId(405),
				type: 'split-text',
				textNodeId: fixture.ids.leftText,
				expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
				splitUtf16Offset: offset(2),
				rightTextNodeId: nodeId(24),
			}),
			fixture => ({
				id: operationId(406),
				type: 'join-text',
				leftTextNodeId: fixture.ids.leftText,
				expectedLeftNodeHash: nodeHash(
					fixture,
					fixture.ids.leftText,
				),
				rightTextNodeId: fixture.ids.rightText,
				expectedRightNodeHash: nodeHash(
					fixture,
					fixture.ids.rightText,
				),
			}),
			fixture => ({
				id: operationId(407),
				type: 'set-node-attributes',
				nodeId: fixture.ids.firstParagraph,
				expectedNodeHash: nodeHash(
					fixture,
					fixture.ids.firstParagraph,
				),
				attributes: { alignment: 'center' },
			}),
			fixture => ({
				id: operationId(408),
				type: 'set-text-marks',
				textNodeId: fixture.ids.leftText,
				expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
				marks: [{ type: 'bold' }],
			}),
			() => ({
				id: operationId(409),
				type: 'create-academic-entity',
				entity: referenceSnapshot(entityId(104), 'Created'),
			}),
			fixture => ({
				id: operationId(410),
				type: 'replace-academic-entity',
				entityId: fixture.ids.reference,
				expectedEntityHash: entityHash(
					fixture,
					fixture.ids.reference,
				),
				replacement: referenceSnapshot(
					fixture.ids.reference,
					'Replaced',
				),
			}),
			fixture => ({
				id: operationId(411),
				type: 'delete-academic-entity',
				entityId: fixture.ids.reference,
				expectedEntityHash: entityHash(
					fixture,
					fixture.ids.reference,
				),
			}),
			fixture => ({
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
			fixture => ({
				id: operationId(413),
				type: 'set-metadata',
				expectedMetadataHash: fixture.merkleState.metadataHash,
				metadata: {
					title: 'Changed title',
					authors: [{
						id: entityId(501),
						name: 'Author One',
					}],
					abstract: 'Changed abstract',
					keywords: ['changed', 'incremental'],
				},
			}),
			fixture => ({
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
		];

		assert.equal(operations.length, 14);
		for (const createOperation of operations) {
			const fixture = createFixture();
			const operation = createOperation(fixture);
			const advanced = advanceIncrementally(fixture, operation);
			assertStateMatchesFullRebuild(
				advanced.merkleState,
				advanced.content,
				advanced.index,
				fixture.content,
			);
		}
	});

	test('rehashes cross-parent paths bottom-up through one shared LCA', () => {
		let fixture = createCrossParentFixture();
		const rehashed: NodeId[] = [];
		fixture = advanceIncrementally(
			fixture,
			{
				id: operationId(501),
				type: 'move-node',
				targetNodeId: fixture.ids.firstParagraph,
				expectedNodeHash: nodeHash(
					fixture,
					fixture.ids.firstParagraph,
				),
				newParentNodeId: fixture.ids.secondParagraph,
				expectedParentHash: nodeHash(
					fixture,
					fixture.ids.secondParagraph,
				),
				childIndex: 1,
			},
			{
				onAncestorRehash: nodeId => rehashed.push(nodeId),
			},
		);
		assertStateMatchesFullRebuild(
			fixture.merkleState,
			fixture.content,
			fixture.index,
		);
		assert.deepStrictEqual(rehashed, [
			fixture.ids.secondParagraph,
			fixture.ids.body,
			fixture.ids.root,
		]);
		assert.deepStrictEqual(
			fixture.index.getParentLocation(fixture.ids.firstParagraph),
			{
				parentNodeId: fixture.ids.secondParagraph,
				childIndex: 1,
			},
		);

		rehashed.length = 0;
		fixture = advanceIncrementally(
			fixture,
			{
				id: operationId(502),
				type: 'move-node',
				targetNodeId: fixture.ids.firstParagraph,
				expectedNodeHash: nodeHash(
					fixture,
					fixture.ids.firstParagraph,
				),
				newParentNodeId: fixture.ids.body,
				expectedParentHash: nodeHash(fixture, fixture.ids.body),
				childIndex: 0,
			},
			{
				onAncestorRehash: nodeId => rehashed.push(nodeId),
			},
		);
		assertStateMatchesFullRebuild(
			fixture.merkleState,
			fixture.content,
			fixture.index,
		);
		assert.deepStrictEqual(rehashed, [
			fixture.ids.secondParagraph,
			fixture.ids.body,
			fixture.ids.root,
		]);
	});

	test('moves an Academic Entity across collections with remove plus insert', () => {
		const fixture = createFixture();
		const replacement: ClaimEntity = {
			id: fixture.ids.reference,
			type: 'claim',
			anchor: {
				document: {
					resource: fixture.resource,
					revisionId: fixture.revisionId,
				},
				primary: {
					kind: 'text',
					textNodeId: fixture.ids.leftText,
					utf16Offset: offset(1),
					affinity: 'after',
				},
				targetNodeId: fixture.ids.firstParagraph,
			},
			textSnapshot: 'replacement claim',
		};
		const advanced = advanceIncrementally(fixture, {
			id: operationId(503),
			type: 'replace-academic-entity',
			entityId: fixture.ids.reference,
			expectedEntityHash: entityHash(
				fixture,
				fixture.ids.reference,
			),
			replacement,
		});
		assert.deepStrictEqual(
			advanced.content.academicGraph.referenceSnapshots,
			[],
		);
		assert.deepStrictEqual(
			advanced.content.academicGraph.claims.map(entity => entity.id),
			[fixture.ids.reference, fixture.ids.claim],
		);
		assertStateMatchesFullRebuild(
			advanced.merkleState,
			advanced.content,
			advanced.index,
			fixture.content,
		);
	});

	test('rejects a hostile state receiver before any Proxy trap', () => {
		const fixture = createFixture();
		const consumed = reduceAndConsume(fixture, {
			id: operationId(504),
			type: 'replace-text',
			textNodeId: fixture.ids.leftText,
			expectedNodeHash: nodeHash(fixture, fixture.ids.leftText),
			startUtf16Offset: offset(0),
			endUtf16Offset: offset(1),
			replacement: 'A',
		});
		let stateTraps = 0;
		let inputTraps = 0;
		const hostileState = new Proxy({} as RevisionMerkleState, {
			get: () => {
				stateTraps += 1;
				throw new Error('state trap');
			},
			getPrototypeOf: () => {
				stateTraps += 1;
				throw new Error('state prototype trap');
			},
			ownKeys: () => {
				stateTraps += 1;
				throw new Error('state ownKeys trap');
			},
		});
		const hostileInput = new Proxy({
			previousContent: consumed.previousContent,
			previousIndex: consumed.previousIndex,
			nextContent: consumed.nextContent,
			nextIndex: consumed.nextIndex,
			capture: consumed.capture,
			touchSet: consumed.touchSet,
		}, {
			get: (target, property, receiver) => {
				inputTraps += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		assert.throws(
			() => updateRevisionMerkleStateCandidate(
				hostileState,
				hostileInput,
			),
			TypeError,
		);
		assert.equal(stateTraps, 0);
		assert.equal(inputTraps, 0);
	});

	test('does bounded head/middle/tail edits at the profile-owned wide width', () => {
		for (
			const [caseIndex, editIndex] of
			wideParentLookupWitness.editIndices.entries()
		) {
			const { fixture, probe } = createObservedWideFixture(
				wideParentLookupWitness.directChildCount,
			);
			const target = nodeId(30_000 + editIndex);
			const consumed = reduceAndConsume(fixture, {
				id: operationId(505 + caseIndex),
				type: 'delete-node',
				targetNodeId: target,
				expectedNodeHash: nodeHash(fixture, target),
			});
			const counters = createInstrumentationCounters();
			probe.enabled = true;
			const candidate = updateRevisionMerkleStateCandidate(
				consumed.previousMerkleState,
				{
					previousContent: consumed.previousContent,
					previousIndex: consumed.previousIndex,
					nextContent: consumed.nextContent,
					nextIndex: consumed.nextIndex,
					capture: consumed.capture,
					touchSet: consumed.touchSet,
					instrumentation: counters.instrumentation,
				},
			);
			probe.enabled = false;
			assertStateMatchesFullRebuild(
				candidate,
				consumed.nextContent,
				consumed.nextIndex,
				consumed.previousContent,
			);

			const expectedSlots = [
				editIndex - 1,
				editIndex,
				editIndex + 1,
			].filter(index =>
				index >= 0
				&& index < wideParentLookupWitness.directChildCount);
			assert.deepStrictEqual(
				[...new Set(probe.directChildSlotReads)].sort(
					(left, right) => left - right,
				),
				expectedSlots,
			);
			const expectedPayloadIds = expectedSlots.map(
				index => nodeId(30_000 + index),
			);
			assert.deepStrictEqual(
				[...probe.directChildPayloadReads].sort(),
				expectedPayloadIds.sort(),
			);
			const unrelatedPayloadReads = [
				...probe.directChildPayloadReads,
			].filter(nodeId => !expectedPayloadIds.includes(nodeId)).length;
			assert.equal(
				unrelatedPayloadReads,
				wideParentLookupWitness
					.expectedShiftedLookupChildPayloadReads,
			);
			assert.equal(counters.ancestorRehashes, 2);
			assert.ok(counters.structuralTrieVisits < 400);
			assert.ok(counters.structuralTrieCopies < 200);
			assert.ok(counters.storeTrieVisits < 2_000);
			assert.ok(counters.storeTrieAllocatedSlots < 10_000);
			assert.deepStrictEqual(counters.latestCardinalities, {
				'node-hashes':
					wideParentLookupWitness.directChildCount + 1,
				'node-child-vectors':
					wideParentLookupWitness.directChildCount + 1,
				'entity-hashes': 0,
				'relation-hashes': 0,
			});
		}
	});

	test('accounts for structural neighbors in every structural update family', () => {
		const cases: readonly {
			readonly fixture: () => IFixture;
			readonly operation: (fixture: IFixture) => Operation;
		}[] = [
			{
				fixture: createFixture,
				operation: fixture => ({
					id: operationId(520),
					type: 'insert-node',
					parentNodeId: fixture.ids.body,
					expectedParentHash: nodeHash(
						fixture,
						fixture.ids.body,
					),
					childIndex: 1,
					node: {
						id: nodeId(520),
						type: 'paragraph',
						attrs: { alignment: 'start' },
						children: [],
					},
				}),
			},
			{
				fixture: createFixture,
				operation: fixture => ({
					id: operationId(521),
					type: 'delete-node',
					targetNodeId: fixture.ids.firstParagraph,
					expectedNodeHash: nodeHash(
						fixture,
						fixture.ids.firstParagraph,
					),
				}),
			},
			{
				fixture: createFixture,
				operation: fixture => ({
					id: operationId(522),
					type: 'move-node',
					targetNodeId: fixture.ids.firstParagraph,
					expectedNodeHash: nodeHash(
						fixture,
						fixture.ids.firstParagraph,
					),
					newParentNodeId: fixture.ids.body,
					expectedParentHash: nodeHash(
						fixture,
						fixture.ids.body,
					),
					childIndex: 1,
				}),
			},
			{
				fixture: createCrossParentFixture,
				operation: fixture => ({
					id: operationId(523),
					type: 'move-node',
					targetNodeId: fixture.ids.firstParagraph,
					expectedNodeHash: nodeHash(
						fixture,
						fixture.ids.firstParagraph,
					),
					newParentNodeId: fixture.ids.secondParagraph,
					expectedParentHash: nodeHash(
						fixture,
						fixture.ids.secondParagraph,
					),
					childIndex: 1,
				}),
			},
			{
				fixture: createFixture,
				operation: fixture => ({
					id: operationId(524),
					type: 'split-text',
					textNodeId: fixture.ids.leftText,
					expectedNodeHash: nodeHash(
						fixture,
						fixture.ids.leftText,
					),
					splitUtf16Offset: offset(2),
					rightTextNodeId: nodeId(524),
				}),
			},
			{
				fixture: createFixture,
				operation: fixture => ({
					id: operationId(525),
					type: 'join-text',
					leftTextNodeId: fixture.ids.leftText,
					expectedLeftNodeHash: nodeHash(
						fixture,
						fixture.ids.leftText,
					),
					rightTextNodeId: fixture.ids.rightText,
					expectedRightNodeHash: nodeHash(
						fixture,
						fixture.ids.rightText,
					),
				}),
			},
		];
		for (const operationCase of cases) {
			const fixture = operationCase.fixture();
			const counters = createInstrumentationCounters();
			advanceIncrementally(
				fixture,
				operationCase.operation(fixture),
				counters.instrumentation,
			);
			assert.ok(counters.structuralNeighborNodeReads > 0);
		}

		const fixture = createFixture();
		const counters = createInstrumentationCounters();
		advanceIncrementally(
			fixture,
			{
				id: operationId(526),
				type: 'create-academic-entity',
				entity: referenceSnapshot(entityId(104), 'Neighbor'),
			},
			counters.instrumentation,
		);
		assert.equal(counters.academicTargetReads, 1);
		assert.equal(counters.academicNeighborReads, 1);
	});

	test('keeps the maximum-operation successor chain flat', () => {
		let fixture = createFixture();
		const counters = createInstrumentationCounters();
		const temporaryTextId = nodeId(90_001);
		const temporaryEntityId = entityId(90_002);
		const initialNodeCount = fixture.merkleState.nodeCount;
		const initialEntityCount = fixture.merkleState.entityCount;
		const initialRelationCount = fixture.merkleState.relationCount;
		for (
			let step = 0;
			step < maximumOperationWitness.operationCount;
			step += 1
		) {
			const phase = step % 8;
			let operation: Operation;
			switch (phase) {
				case 0:
					operation = {
						id: operationId(10_000 + step),
						type: 'replace-text',
						textNodeId: fixture.ids.leftText,
						expectedNodeHash: nodeHash(
							fixture,
							fixture.ids.leftText,
						),
						startUtf16Offset: offset(0),
						endUtf16Offset: offset(1),
						replacement: step % 2 === 0 ? 'A' : 'B',
					};
					break;
				case 1:
					operation = {
						id: operationId(10_000 + step),
						type: 'split-text',
						textNodeId: fixture.ids.leftText,
						expectedNodeHash: nodeHash(
							fixture,
							fixture.ids.leftText,
						),
						splitUtf16Offset: offset(2),
						rightTextNodeId: temporaryTextId,
					};
					break;
				case 2:
					operation = {
						id: operationId(10_000 + step),
						type: 'join-text',
						leftTextNodeId: fixture.ids.leftText,
						expectedLeftNodeHash: nodeHash(
							fixture,
							fixture.ids.leftText,
						),
						rightTextNodeId: temporaryTextId,
						expectedRightNodeHash: nodeHash(
							fixture,
							temporaryTextId,
						),
					};
					break;
				case 3:
					operation = {
						id: operationId(10_000 + step),
						type: 'create-academic-entity',
						entity: referenceSnapshot(
							temporaryEntityId,
							`temporary-${step}`,
						),
					};
					break;
				case 4:
					operation = {
						id: operationId(10_000 + step),
						type: 'delete-academic-entity',
						entityId: temporaryEntityId,
						expectedEntityHash: entityHash(
							fixture,
							temporaryEntityId,
						),
					};
					break;
				case 5:
					operation = {
						id: operationId(10_000 + step),
						type: 'set-claim-evidence-relation',
						claimId: fixture.ids.claim,
						evidenceId: fixture.ids.evidence,
						expectedRelationHash: relationHash(
							fixture,
							fixture.ids.claim,
							fixture.ids.evidence,
						),
						replacement: null,
					};
					break;
				case 6:
					operation = {
						id: operationId(10_000 + step),
						type: 'set-claim-evidence-relation',
						claimId: fixture.ids.claim,
						evidenceId: fixture.ids.evidence,
						expectedRelationHash: null,
						replacement: relation(
							fixture.ids.claim,
							fixture.ids.evidence,
							'supports',
						),
					};
					break;
				default:
					operation = {
						id: operationId(10_000 + step),
						type: 'set-settings',
						expectedSettingsHash:
							fixture.merkleState.settingsHash,
						settings: {
							language: step % 16 === 7 ? 'en' : 'en-US',
							citationStyle: 'chicago-author-date',
							headingNumbering: step % 16 === 7,
							bibliographyEnabled: true,
						},
					};
					break;
			}
			fixture = advanceIncrementally(
				fixture,
				operation,
				counters.instrumentation,
			);
			assertStateMatchesFullRebuild(
				fixture.merkleState,
				fixture.content,
				fixture.index,
			);
			const storage = getRevisionMerkleStateStorageWitness(
				fixture.merkleState,
			);
			assert.equal(
				storage.authenticatedRecordKeyCount,
				storage.stores.length,
			);
			assert.equal(storage.predecessorReferenceCount, 0);
			assert.equal(
				storage.directStoreRootCount,
				storage.authenticatedRecordKeyCount,
			);
			assert.deepStrictEqual(
				storage.stores.map(store => store.keyNibbleDepth),
				[32, 32, 32, 64],
			);
			assert.equal(
				storage.stores[0]?.size,
				fixture.merkleState.nodeCount,
			);
			assert.ok(
				(storage.stores[1]?.size ?? Number.POSITIVE_INFINITY)
					<= fixture.merkleState.nodeCount,
			);
			assert.equal(
				storage.stores[2]?.size,
				fixture.merkleState.entityCount,
			);
			assert.equal(
				storage.stores[3]?.size,
				fixture.merkleState.relationCount,
			);
		}
		assert.equal(
			counters.cardinalityReports,
			maximumOperationWitness.expectedPendingTransitionCount
				* Object.keys(counters.latestCardinalities).length,
		);
		assert.equal(
			counters.ancestorRehashes
				< maximumOperationWitness.operationCount * 5,
			true,
		);
		assert.equal(
			counters.storeTrieVisits
				< maximumOperationWitness.operationCount * 2_000,
			true,
		);
		assert.equal(
			counters.storeTrieAllocatedSlots
				< maximumOperationWitness.operationCount * 10_000,
			true,
		);
		assert.deepStrictEqual(
			counters.observedCardinalities['node-hashes'],
			new Set([initialNodeCount, initialNodeCount + 1]),
		);
		assert.deepStrictEqual(
			counters.observedCardinalities['entity-hashes'],
			new Set([initialEntityCount, initialEntityCount + 1]),
		);
		assert.deepStrictEqual(
			counters.observedCardinalities['relation-hashes'],
			new Set([initialRelationCount - 1, initialRelationCount]),
		);
	});

	test('reports sparse trie copy allocations without undercounting extension', () => {
		const allocatedSlots: number[] = [];
		const key = 'f18f0000-0000-7000-8000-000000000001';
		const instrumentation = {
			onTrieNodeCopy: (
				_kind: Parameters<
					NonNullable<
						IRevisionMerkleUpdaterInstrumentation[
							'onTrieNodeCopy'
						]
					>
				>[0],
				slots: number,
			) => {
				allocatedSlots.push(slots);
			},
		};
		const inserted = PersistentRevisionMerkleMap.empty<string>().set(
			key,
			'value',
			'node-hashes',
			instrumentation,
		);
		assert.equal(inserted.size, 1);
		assert.equal(inserted.get(key), 'value');
		assert.equal(allocatedSlots[allocatedSlots.length - 1], 16);
		const deleted = inserted.unset(
			key,
			'node-hashes',
			instrumentation,
		);
		assert.equal(deleted.size, 0);
		assert.equal(deleted.get(key), undefined);
		const reinserted = deleted.set(
			key,
			'fresh',
			'node-hashes',
			instrumentation,
		);
		assert.equal(reinserted.size, 1);
		assert.equal(reinserted.get(key), 'fresh');
		assert.ok(allocatedSlots.every(slots => slots >= 1 && slots <= 16));
	});
});

function advanceIncrementally(
	fixture: IFixture,
	operation: Operation,
	instrumentation?: IRevisionMerkleUpdaterInstrumentation,
): IFixture {
	const consumed = reduceAndConsume(fixture, operation);
	const merkleState = updateRevisionMerkleStateCandidate(
		consumed.previousMerkleState,
		{
			previousContent: consumed.previousContent,
			previousIndex: consumed.previousIndex,
			nextContent: consumed.nextContent,
			nextIndex: consumed.nextIndex,
			capture: consumed.capture,
			touchSet: consumed.touchSet,
			instrumentation,
		},
	);
	assertStateMatchesFullRebuild(
		merkleState,
		consumed.nextContent,
		consumed.nextIndex,
		consumed.previousContent,
	);
	return {
		...fixture,
		content: consumed.nextContent,
		index: consumed.nextIndex,
		merkleState,
	};
}

function reduceAndConsume(
	fixture: IFixture,
	operation: Operation,
): IConsumedManuscriptOperationTransition {
	const result = reduceManuscriptOperation({
		resource: fixture.resource,
		generatedAgainstRevisionId: fixture.revisionId,
		content: fixture.content,
		index: fixture.index,
		merkleState: fixture.merkleState,
		operation,
	});
	if (result.type === 'error') {
		throw new Error(
			`Reducer rejected ${operation.type}: ${result.error.reason}.`,
		);
	}
	const consumed = consumeManuscriptOperationTransition(result.value);
	if (consumed === undefined) {
		throw new Error('Reducer transition was not consumable.');
	}
	return consumed;
}

function assertStateMatchesFullRebuild(
	actual: RevisionMerkleState,
	content: DocumentContent,
	index: DocumentIndex,
	previousContent?: DocumentContent,
): void {
	const expected = rebuildRevisionMerkleState(content);
	assert.equal(actual.documentHash, expected.documentHash);
	assert.equal(actual.metadataHash, expected.metadataHash);
	assert.equal(actual.rootNodeHash, expected.rootNodeHash);
	assert.equal(actual.academicGraphHash, expected.academicGraphHash);
	assert.equal(actual.settingsHash, expected.settingsHash);
	assert.equal(actual.titleHash, expected.titleHash);
	assert.equal(actual.abstractHash, expected.abstractHash);
	assert.equal(actual.nodeCount, expected.nodeCount);
	assert.equal(actual.entityCount, expected.entityCount);
	assert.equal(actual.relationCount, expected.relationCount);
	assertVectorEqual(
		actual.metadataAuthorsVector,
		expected.metadataAuthorsVector,
	);
	assertVectorEqual(
		actual.metadataKeywordsVector,
		expected.metadataKeywordsVector,
	);
	assertVectorEqual(
		actual.academicReferenceSnapshotsVector,
		expected.academicReferenceSnapshotsVector,
	);
	assertVectorEqual(
		actual.academicEvidenceLinksVector,
		expected.academicEvidenceLinksVector,
	);
	assertVectorEqual(
		actual.academicClaimsVector,
		expected.academicClaimsVector,
	);
	assertVectorEqual(
		actual.academicClaimEvidenceRelationsVector,
		expected.academicClaimEvidenceRelationsVector,
	);

	const nodeIds = new Set<NodeId>(index.preorderNodeIds);
	if (previousContent !== undefined) {
		const previousIndex = createDocumentIndex(previousContent.root);
		if (previousIndex.type === 'error') {
			throw new Error(previousIndex.error.reason);
		}
		for (const nodeId of previousIndex.value.preorderNodeIds) {
			nodeIds.add(nodeId);
		}
	}
	for (const nodeId of nodeIds) {
		assert.equal(actual.getNodeHash(nodeId), expected.getNodeHash(nodeId));
		const actualVector = actual.getNodeChildrenVector(nodeId);
		const expectedVector = expected.getNodeChildrenVector(nodeId);
		if (actualVector === undefined || expectedVector === undefined) {
			assert.equal(actualVector, expectedVector);
		} else {
			assertVectorEqual(actualVector, expectedVector);
		}
	}

	const entityIds = new Set<EntityId>();
	for (const entity of academicEntities(content.academicGraph)) {
		entityIds.add(entity.id);
	}
	if (previousContent !== undefined) {
		for (const entity of academicEntities(previousContent.academicGraph)) {
			entityIds.add(entity.id);
		}
	}
	for (const entityId of entityIds) {
		assert.equal(
			actual.getEntityHash(entityId),
			expected.getEntityHash(entityId),
		);
	}
	const relationKeys = new Map<string, readonly [EntityId, EntityId]>();
	for (
		const relation of [
			...content.academicGraph.claimEvidenceRelations,
			...(previousContent?.academicGraph.claimEvidenceRelations ?? []),
		]
	) {
		relationKeys.set(
			`${relation.claimId}\0${relation.evidenceId}`,
			[relation.claimId, relation.evidenceId],
		);
	}
	for (const [claimId, evidenceId] of relationKeys.values()) {
		assert.equal(
			actual.getRelationHash(claimId, evidenceId),
			expected.getRelationHash(claimId, evidenceId),
		);
	}
}

function assertVectorEqual(
	actual: RevisionMerkleState['metadataAuthorsVector'],
	expected: RevisionMerkleState['metadataAuthorsVector'],
): void {
	assert.equal(actual.role, expected.role);
	assert.equal(actual.count, expected.count);
	assert.equal(actual.level, expected.level);
	assert.equal(actual.rootHash, expected.rootHash);
}

function academicEntities(
	graph: AcademicGraphSnapshot,
): readonly AcademicEntity[] {
	return [
		...graph.referenceSnapshots,
		...graph.evidenceLinks,
		...graph.claims,
	];
}

function createFixture(): IFixture {
	const ids = fixtureIds();
	const resource = createManuscriptDraftResource(uuid(301));
	const root: ManuscriptNode = {
		id: ids.root,
		type: 'manuscript',
		attrs: {},
		children: [{
			id: ids.body,
			type: 'body',
			attrs: {},
			children: [
				{
					id: ids.firstParagraph,
					type: 'paragraph',
					attrs: { alignment: 'start' },
					children: [
						{
							id: ids.leftText,
							type: 'text',
							value: 'alpha',
							marks: [],
						},
						{
							id: ids.rightText,
							type: 'text',
							value: 'beta',
							marks: [],
						},
					],
				},
				{
					id: ids.secondParagraph,
					type: 'paragraph',
					attrs: { alignment: 'start' },
					children: [{
						id: ids.secondText,
						type: 'text',
						value: 'second',
						marks: [],
					}],
				},
			],
		}],
	};
	const evidence: EvidenceLink = {
		id: ids.evidence,
		type: 'evidence-link',
		sourceUri: URI.parse('https://example.test/evidence'),
		sourceContentHash: contentHash(11),
		locator: { kind: 'page', page: 7 },
		verificationStatus: 'verified',
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
		},
		textSnapshot: 'alpha',
	};
	return buildFixture(
		resource,
		root,
		{
			referenceSnapshots: [
				referenceSnapshot(ids.reference, 'Reference'),
			],
			evidenceLinks: [evidence],
			claims: [claim],
			claimEvidenceRelations: [
				relation(ids.claim, ids.evidence, 'supports'),
			],
		},
		ids,
	);
}

function createCrossParentFixture(): IFixture {
	const ids = fixtureIds();
	const root: ManuscriptNode = {
		id: ids.root,
		type: 'manuscript',
		attrs: {},
		children: [{
			id: ids.body,
			type: 'body',
			attrs: {},
			children: [
				{
					id: ids.firstParagraph,
					type: 'paragraph',
					attrs: { alignment: 'start' },
					children: [{
						id: ids.leftText,
						type: 'text',
						value: 'movable',
						marks: [],
					}],
				},
				{
					id: ids.secondParagraph,
					type: 'section',
					attrs: { level: 1 },
					children: [{
						id: ids.secondText,
						type: 'heading',
						attrs: { level: 1 },
						children: [{
							id: ids.rightText,
							type: 'text',
							value: 'Destination',
							marks: [],
						}],
					}],
				},
			],
		}],
	};
	return buildFixture(
		createManuscriptDraftResource(uuid(302)),
		root,
		emptyAcademicGraph(),
		ids,
	);
}

function createObservedWideFixture(
	width: number,
): {
	readonly fixture: IFixture;
	readonly probe: IWideParentAccessProbe;
} {
	const ids = fixtureIds();
	const probe: IWideParentAccessProbe = {
		enabled: false,
		directChildSlotReads: [],
		directChildPayloadReads: new Set(),
	};
	const paragraphs: ParagraphNode[] = [];
	for (let index = 0; index < width; index += 1) {
		const paragraph: ParagraphNode = Object.freeze({
			id: nodeId(30_000 + index),
			type: 'paragraph',
			attrs: Object.freeze({ alignment: 'start' }),
			children: Object.freeze([]),
		});
		paragraphs.push(new Proxy(paragraph, {
			get: (target, property, receiver) => {
				if (probe.enabled) {
					probe.directChildPayloadReads.add(target.id);
				}
				return Reflect.get(target, property, receiver);
			},
		}));
	}
	const observedChildren = new Proxy(
		Object.freeze(paragraphs) as readonly [
			ParagraphNode,
			...ParagraphNode[],
		],
		{
			get: (target, property, receiver) => {
				if (
					probe.enabled
					&& typeof property === 'string'
					&& /^(?:0|[1-9]\d*)$/u.test(property)
				) {
					probe.directChildSlotReads.push(Number(property));
				}
				return Reflect.get(target, property, receiver);
			},
		},
	);
	const body: BodyNode = {
		id: ids.body,
		type: 'body',
		attrs: {},
		children: observedChildren,
	};
	const root: ManuscriptNode = {
		id: ids.root,
		type: 'manuscript',
		attrs: {},
		children: [body],
	};
	return {
		fixture: buildFixture(
			createManuscriptDraftResource(uuid(303)),
			root,
			emptyAcademicGraph(),
			ids,
		),
		probe,
	};
}

function buildFixture(
	resource: URI,
	root: ManuscriptNode,
	academicGraph: AcademicGraphSnapshot,
	ids: IFixtureIds,
): IFixture {
	const content: DocumentContent = Object.freeze({
		format: documentFormat,
		formatVersion: documentFormatVersion,
		schemaId: manuscriptSchemaId,
		schemaVersion: manuscriptSchemaVersion,
		metadata: {
			title: 'Incremental fixture',
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
	});
	const indexResult = createDocumentIndex(root);
	if (indexResult.type === 'error') {
		throw new Error(indexResult.error.reason);
	}
	return {
		resource,
		revisionId: revisionId(201),
		content,
		index: indexResult.value,
		merkleState: rebuildRevisionMerkleState(content),
		ids,
	};
}

function fixtureIds(): IFixtureIds {
	return {
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
}

function emptyAcademicGraph(): AcademicGraphSnapshot {
	return {
		referenceSnapshots: [],
		evidenceLinks: [],
		claims: [],
		claimEvidenceRelations: [],
	};
}

function createInstrumentationCounters(): {
	readonly instrumentation: IRevisionMerkleUpdaterInstrumentation;
	ancestorRehashes: number;
	nodePayloadReads: number;
	structuralNeighborNodeReads: number;
	academicTargetReads: number;
	academicNeighborReads: number;
	structuralItemReads: number;
	structuralTrieVisits: number;
	structuralTrieCopies: number;
	storeTrieVisits: number;
	storeTrieAllocatedSlots: number;
	cardinalityReports: number;
	readonly latestCardinalities: Record<string, number>;
	readonly observedCardinalities: Record<string, Set<number>>;
} {
	const counters = {
		ancestorRehashes: 0,
		nodePayloadReads: 0,
		structuralNeighborNodeReads: 0,
		academicTargetReads: 0,
		academicNeighborReads: 0,
		structuralItemReads: 0,
		structuralTrieVisits: 0,
		structuralTrieCopies: 0,
		storeTrieVisits: 0,
		storeTrieAllocatedSlots: 0,
		cardinalityReports: 0,
		latestCardinalities: {} as Record<string, number>,
		observedCardinalities: {} as Record<string, Set<number>>,
	};
	return {
		...counters,
		get ancestorRehashes() {
			return counters.ancestorRehashes;
		},
		set ancestorRehashes(value: number) {
			counters.ancestorRehashes = value;
		},
		get nodePayloadReads() {
			return counters.nodePayloadReads;
		},
		set nodePayloadReads(value: number) {
			counters.nodePayloadReads = value;
		},
		get structuralNeighborNodeReads() {
			return counters.structuralNeighborNodeReads;
		},
		set structuralNeighborNodeReads(value: number) {
			counters.structuralNeighborNodeReads = value;
		},
		get academicTargetReads() {
			return counters.academicTargetReads;
		},
		set academicTargetReads(value: number) {
			counters.academicTargetReads = value;
		},
		get academicNeighborReads() {
			return counters.academicNeighborReads;
		},
		set academicNeighborReads(value: number) {
			counters.academicNeighborReads = value;
		},
		get structuralItemReads() {
			return counters.structuralItemReads;
		},
		set structuralItemReads(value: number) {
			counters.structuralItemReads = value;
		},
		get structuralTrieVisits() {
			return counters.structuralTrieVisits;
		},
		set structuralTrieVisits(value: number) {
			counters.structuralTrieVisits = value;
		},
		get structuralTrieCopies() {
			return counters.structuralTrieCopies;
		},
		set structuralTrieCopies(value: number) {
			counters.structuralTrieCopies = value;
		},
		get storeTrieVisits() {
			return counters.storeTrieVisits;
		},
		set storeTrieVisits(value: number) {
			counters.storeTrieVisits = value;
		},
		get storeTrieAllocatedSlots() {
			return counters.storeTrieAllocatedSlots;
		},
		set storeTrieAllocatedSlots(value: number) {
			counters.storeTrieAllocatedSlots = value;
		},
		get cardinalityReports() {
			return counters.cardinalityReports;
		},
		set cardinalityReports(value: number) {
			counters.cardinalityReports = value;
		},
		latestCardinalities: counters.latestCardinalities,
		observedCardinalities: counters.observedCardinalities,
		instrumentation: {
			onNodePayloadRead: (_nodeId, kind) => {
				counters.nodePayloadReads += 1;
				if (kind === 'structural-neighbor') {
					counters.structuralNeighborNodeReads += 1;
				}
			},
			onAcademicPayloadRead: (_role, kind) => {
				if (kind === 'structural-target') {
					counters.academicTargetReads += 1;
				} else {
					counters.academicNeighborReads += 1;
				}
			},
			onAncestorRehash: () => {
				counters.ancestorRehashes += 1;
			},
			onStructuralItemRead: () => {
				counters.structuralItemReads += 1;
			},
			onStructuralTrieNodeVisit: () => {
				counters.structuralTrieVisits += 1;
			},
			onStructuralTrieNodeCopy: () => {
				counters.structuralTrieCopies += 1;
			},
			onTrieNodeVisit: () => {
				counters.storeTrieVisits += 1;
			},
			onTrieNodeCopy: (_kind, allocatedSlots) => {
				counters.storeTrieAllocatedSlots += allocatedSlots;
			},
			onStoreCardinality: (kind, size) => {
				counters.cardinalityReports += 1;
				counters.latestCardinalities[kind] = size;
				const observed = counters.observedCardinalities[kind]
					?? new Set<number>();
				observed.add(size);
				counters.observedCardinalities[kind] = observed;
			},
		},
	};
}

function nodeHash(fixture: IFixture, id: NodeId): ContentHash {
	const hash = fixture.merkleState.getNodeHash(id);
	if (hash === undefined) {
		throw new Error(`Missing Node hash ${id}.`);
	}
	return hash;
}

function entityHash(fixture: IFixture, id: EntityId): ContentHash {
	const hash = fixture.merkleState.getEntityHash(id);
	if (hash === undefined) {
		throw new Error(`Missing Entity hash ${id}.`);
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
		throw new Error('Missing relation hash.');
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
		throw new Error('Invalid test Node ID.');
	}
	return parsed.value;
}

function entityId(sequence: number): EntityId {
	const parsed = parseEntityId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Invalid test Entity ID.');
	}
	return parsed.value;
}

function operationId(sequence: number): OperationId {
	const parsed = parseOperationId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Invalid test Operation ID.');
	}
	return parsed.value;
}

function revisionId(sequence: number): RevisionId {
	const parsed = parseRevisionId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Invalid test Revision ID.');
	}
	return parsed.value;
}

function contentHash(sequence: number): ContentHash {
	const parsed = parseContentHash(
		`sha256:${sequence.toString(16).padStart(64, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Invalid test Content hash.');
	}
	return parsed.value;
}

function offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Invalid test UTF-16 offset.');
	}
	return parsed.value;
}

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence
		.toString(16)
		.padStart(12, '0')}`;
}
