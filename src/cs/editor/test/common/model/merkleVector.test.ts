/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'node:test';

import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	type ContentHash,
	type EntityId,
	type NodeId,
} from 'cs/editor/common/core/identifiers';
import {
	manuscriptHashDomains,
	manuscriptHashPreimagePrefix,
} from 'cs/editor/common/core/hashPreimage';
import {
	ManuscriptMerkleVector,
	manuscriptMerkleVectorAlgorithm,
	manuscriptMerkleVectorFanout,
	manuscriptMerkleVectorRoles,
	manuscriptStructuralMerkleSequenceAlgorithm,
	type ManuscriptMerkleVectorHashCall,
	type ManuscriptMerkleVectorHashCallObserver,
} from 'cs/editor/common/model/merkleVector';
import type {
	AcademicEntity,
	ClaimEvidenceRelation,
} from 'cs/editor/common/model/academicGraph';
import type { TextNode } from 'cs/editor/common/model/manuscript';

function contentHash(sequence: number): ContentHash {
	const parsed = parseContentHash(
		`sha256:${sequence.toString(16).padStart(64, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test content hash.');
	}
	return parsed.value;
}

function hashes(count: number): ContentHash[] {
	return Array.from({ length: count }, (_, index) => contentHash(index + 1));
}

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

function entityId(sequence: number): EntityId {
	const parsed = parseEntityId(uuid(sequence));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid test Entity ID.');
	}
	return parsed.value;
}

function textNode(sequence: number): TextNode {
	return Object.freeze({
		id: nodeId(sequence),
		type: 'text',
		value: `text-${sequence}`,
		marks: Object.freeze([]),
	});
}

function referenceEntity(sequence: number): AcademicEntity {
	return Object.freeze({
		id: entityId(sequence),
		type: 'reference-snapshot',
		cslJson: Object.freeze({}),
		capturedAt: '2026-01-01T00:00:00.000Z',
	});
}

function relation(
	claimSequence: number,
	evidenceSequence: number,
): ClaimEvidenceRelation {
	return Object.freeze({
		type: 'claim-evidence-relation',
		claimId: entityId(claimSequence),
		evidenceId: entityId(evidenceSequence),
		relation: 'supports',
		assessedBy: Object.freeze({
			type: 'human',
			id: 'test',
		}) as ClaimEvidenceRelation['assessedBy'],
	});
}

function recordHashCalls(
	calls: ManuscriptMerkleVectorHashCall[],
): ManuscriptMerkleVectorHashCallObserver {
	return call => calls.push(call);
}

function oracleHash(canonicalJson: string): string {
	const preimage =
		`${manuscriptHashPreimagePrefix}${manuscriptHashDomains.documentContent}\0${canonicalJson}`;
	return `sha256:${createHash('sha256').update(preimage).digest('hex')}`;
}

function assertHashCalls(calls: readonly ManuscriptMerkleVectorHashCall[]): void {
	for (const call of calls) {
		assert.equal(call.domain, manuscriptHashDomains.documentContent);
		assert.equal(call.hash, oracleHash(call.canonicalJson));
		assert.equal(Object.isFrozen(call), true);
		assert.equal(Object.isFrozen(call.payload), true);
		if (call.payload.kind === 'leaf') {
			assert.equal(Object.isFrozen(call.payload.items), true);
		} else if (call.payload.kind === 'branch') {
			assert.equal(Object.isFrozen(call.payload.children), true);
			assert.equal(
				call.payload.children.every(child => Object.isFrozen(child)),
				true,
			);
		}
	}
}

suite('Manuscript Merkle vector', () => {
	test('freezes the exact algorithm, fanout, and roles', () => {
		assert.equal(manuscriptMerkleVectorAlgorithm, 'nireco-merkle-vector-1');
		assert.equal(manuscriptMerkleVectorFanout, 32);
		assert.equal(Object.isFrozen(manuscriptMerkleVectorRoles), true);
		assert.deepStrictEqual(manuscriptMerkleVectorRoles, {
			nodeChildren: 'manuscript-node-children',
			metadataAuthors: 'metadata-authors',
			metadataKeywords: 'metadata-keywords',
			academicReferenceSnapshots: 'academic-reference-snapshots',
			academicEvidenceLinks: 'academic-evidence-links',
			academicClaims: 'academic-claims',
			academicClaimEvidenceRelations: 'academic-claim-evidence-relations',
		});
	});

	test('hashes the exact empty payload with the document-content domain', () => {
		const calls: ManuscriptMerkleVectorHashCall[] = [];
		const vector = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			[],
			recordHashCalls(calls),
		);

		assert.equal(vector.count, 0);
		assert.equal(vector.level, 0);
		assert.equal(
			vector.rootHash,
			'sha256:c7916acb73770990fc92212d6ac2d675fe9ad35d8f3877ba2b2b2b61674e92eb',
		);
		assert.equal(Object.isFrozen(vector), true);
		assert.deepStrictEqual(calls, [{
			domain: manuscriptHashDomains.documentContent,
			payload: {
				algorithm: manuscriptMerkleVectorAlgorithm,
				fanout: manuscriptMerkleVectorFanout,
				kind: 'empty',
				role: manuscriptMerkleVectorRoles.metadataAuthors,
				count: 0,
			},
			canonicalJson:
				'{"algorithm":"nireco-merkle-vector-1","count":0,"fanout":32,"kind":"empty","role":"metadata-authors"}',
			hash:
				'sha256:c7916acb73770990fc92212d6ac2d675fe9ad35d8f3877ba2b2b2b61674e92eb',
		}]);
		assertHashCalls(calls);
	});

	test('hashes the exact leaf payload and owns a copy of source items', () => {
		const source = [contentHash(1)];
		const calls: ManuscriptMerkleVectorHashCall[] = [];
		const vector = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			source,
			recordHashCalls(calls),
		);
		source[0] = contentHash(2);

		assert.equal(vector.count, 1);
		assert.equal(vector.level, 0);
		assert.equal(vector.getItemHash(0), contentHash(1));
		assert.equal(
			vector.rootHash,
			'sha256:99df427471fb69de46329ace56647265420aab2624063313e39cf9c86c481f8e',
		);
		assert.deepStrictEqual(calls[0]?.payload, {
			algorithm: manuscriptMerkleVectorAlgorithm,
			fanout: manuscriptMerkleVectorFanout,
			kind: 'leaf',
			role: manuscriptMerkleVectorRoles.metadataAuthors,
			level: 0,
			count: 1,
			items: [contentHash(1)],
		});
		assert.equal(
			calls[0]?.canonicalJson,
			'{"algorithm":"nireco-merkle-vector-1","count":1,"fanout":32,"items":["sha256:0000000000000000000000000000000000000000000000000000000000000001"],"kind":"leaf","level":0,"role":"metadata-authors"}',
		);
		assertHashCalls(calls);
	});

	test('builds deterministic left-to-right fanout levels at every boundary', () => {
		const boundaries = [
			{ count: 32, level: 0, hashCalls: 1 },
			{ count: 33, level: 1, hashCalls: 3 },
			{ count: 1_024, level: 1, hashCalls: 33 },
			{ count: 1_025, level: 2, hashCalls: 36 },
		] as const;

		for (const boundary of boundaries) {
			const items = hashes(boundary.count);
			const calls: ManuscriptMerkleVectorHashCall[] = [];
			const vector = ManuscriptMerkleVector.create(
				manuscriptMerkleVectorRoles.metadataAuthors,
				items,
				recordHashCalls(calls),
			);

			assert.equal(vector.count, boundary.count);
			assert.equal(vector.level, boundary.level);
			assert.equal(calls.length, boundary.hashCalls);
			assert.equal(vector.getItemHash(0), items[0]);
			assert.equal(vector.getItemHash(boundary.count - 1), items.at(-1));
			assert.equal(calls.at(-1)?.hash, vector.rootHash);
			assertHashCalls(calls);
		}
	});

	test('commits exact child counts and hashes in a branch payload', () => {
		const calls: ManuscriptMerkleVectorHashCall[] = [];
		ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			hashes(33),
			recordHashCalls(calls),
		);
		const firstLeaf = calls[0];
		const secondLeaf = calls[1];
		const branch = calls[2];

		assert.equal(firstLeaf?.payload.kind, 'leaf');
		assert.equal(secondLeaf?.payload.kind, 'leaf');
		assert.deepStrictEqual(branch?.payload, {
			algorithm: manuscriptMerkleVectorAlgorithm,
			fanout: manuscriptMerkleVectorFanout,
			kind: 'branch',
			role: manuscriptMerkleVectorRoles.metadataAuthors,
			level: 1,
			count: 33,
			children: [
				{
					count: 32,
					hash: firstLeaf?.hash,
				},
				{
					count: 1,
					hash: secondLeaf?.hash,
				},
			],
		});
		assertHashCalls(calls);
	});

	test('replaces one item through only its copy-on-write hash path', () => {
		const items = hashes(1_025);
		const buildCalls: ManuscriptMerkleVectorHashCall[] = [];
		const original = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			items,
			recordHashCalls(buildCalls),
		);
		const replacement = contentHash(65_535);
		const replaceCalls: ManuscriptMerkleVectorHashCall[] = [];
		const replaced = original.replaceItem(
			512,
			replacement,
			recordHashCalls(replaceCalls),
		);

		assert.equal(buildCalls.length, 36);
		assert.equal(replaceCalls.length, 3);
		assert.deepStrictEqual(
			replaceCalls.map(call => ({
				kind: call.payload.kind,
				level: 'level' in call.payload ? call.payload.level : 0,
			})),
			[
				{ kind: 'leaf', level: 0 },
				{ kind: 'branch', level: 1 },
				{ kind: 'branch', level: 2 },
			],
		);
		assert.notStrictEqual(replaced, original);
		assert.notEqual(replaced.rootHash, original.rootHash);
		assert.equal(replaced.count, original.count);
		assert.equal(replaced.level, original.level);
		assert.equal(original.getItemHash(512), items[512]);
		assert.equal(replaced.getItemHash(512), replacement);
		assert.equal(replaced.getItemHash(511), original.getItemHash(511));
		assert.equal(replaced.getItemHash(513), original.getItemHash(513));

		const rebuiltItems = [...items];
		rebuiltItems[512] = replacement;
		const rebuildCalls: ManuscriptMerkleVectorHashCall[] = [];
		const rebuilt = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			rebuiltItems,
			recordHashCalls(rebuildCalls),
		);
		assert.equal(rebuilt.rootHash, replaced.rootHash);
		assert.equal(rebuildCalls.length, 36);
		assertHashCalls(replaceCalls);
	});

	test('returns the source vector without hashing for an identical replacement', () => {
		const vector = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			hashes(64),
		);
		const calls: ManuscriptMerkleVectorHashCall[] = [];
		const unchanged = vector.replaceItem(
			31,
			vector.getItemHash(31),
			recordHashCalls(calls),
		);

		assert.strictEqual(unchanged, vector);
		assert.equal(calls.length, 0);
	});

	test('binds otherwise identical vectors to their exact role', () => {
		const items = hashes(3);
		const authors = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			items,
		);
		const keywords = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataKeywords,
			items,
		);

		assert.notEqual(authors.rootHash, keywords.rootHash);
	});

	test('commits the exact keyed structural empty and singleton grammar', () => {
		assert.equal(
			manuscriptStructuralMerkleSequenceAlgorithm,
			'nireco-structural-merkle-sequence-1',
		);
		const emptyCalls: ManuscriptMerkleVectorHashCall[] = [];
		const empty = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			[],
			{ onHashCall: recordHashCalls(emptyCalls) },
		);
		assert.equal(empty.count, 0);
		assert.equal(empty.level, 0);
		assert.equal(
			empty.rootHash,
			'sha256:a7f8b134b5476d30274f1c03f851f1205ac168b275a71f629d3e83e5c3cc45cc',
		);
		assert.equal(emptyCalls.length, 1);
		assert.deepStrictEqual(emptyCalls[0]?.payload, {
			algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
			kind: 'root',
			role: manuscriptMerkleVectorRoles.nodeChildren,
			count: 0,
			headKey: null,
			patriciaRootHash: null,
		});
		assert.equal(
			emptyCalls[0]?.canonicalJson,
			'{"algorithm":"nireco-structural-merkle-sequence-1","count":0,"headKey":null,"kind":"root","patriciaRootHash":null,"role":"manuscript-node-children"}',
		);

		const node = textNode(10);
		const source = [{ item: node, hash: contentHash(1) }];
		const calls: ManuscriptMerkleVectorHashCall[] = [];
		let itemReads = 0;
		let trieNodeCopies = 0;
		const singleton = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			source,
			{
				onHashCall: recordHashCalls(calls),
				onItemRead: () => {
					itemReads += 1;
				},
				onTrieNodeCopy: () => {
					trieNodeCopies += 1;
				},
			},
		);
		source[0] = { item: textNode(11), hash: contentHash(2) };
		const key = {
			kind: 'node',
			nodeId: node.id,
		} as const;
		assert.equal(singleton.count, 1);
		assert.equal(singleton.getStructuralItemHash(node), contentHash(1));
		assert.equal(itemReads, 1);
		assert.equal(trieNodeCopies, 1);
		assert.equal(calls.length, 3);
		assert.deepStrictEqual(
			calls.map(call => call.hash),
			[
				'sha256:0c4cbf7d25fa6f249054e62e897786b441834f06093ce6de1414b99120e4fac8',
				'sha256:6450b2f30777a4887c6075cb32bba64013ffb40e9c3e24d6a60253f65a183865',
				'sha256:c07868924d85e78f3b9125abf6a0c2915d71482c9dc0ae55451a50737e21eb1d',
			],
		);
		assert.equal(singleton.rootHash, calls[2]?.hash);
		assert.deepStrictEqual(calls[0]?.payload, {
			algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
			kind: 'entry',
			role: manuscriptMerkleVectorRoles.nodeChildren,
			key,
			itemHash: contentHash(1),
			nextKey: null,
		});
		assert.deepStrictEqual(calls[1]?.payload, {
			algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
			kind: 'patricia-leaf',
			role: manuscriptMerkleVectorRoles.nodeChildren,
			pathSuffix: '018f000000007000800000000000000a',
			key,
			entryHash: calls[0]?.hash,
		});
		assert.deepStrictEqual(calls[2]?.payload, {
			algorithm: manuscriptStructuralMerkleSequenceAlgorithm,
			kind: 'root',
			role: manuscriptMerkleVectorRoles.nodeChildren,
			count: 1,
			headKey: key,
			patriciaRootHash: calls[1]?.hash,
		});
		assertHashCalls([...emptyCalls, ...calls]);
	});

	test('path-copies keyed insert, remove, replace, and move canonically', () => {
		const first = textNode(10);
		const second = textNode(11);
		const third = textNode(12);
		const ordered = [
			{ item: first, hash: contentHash(1) },
			{ item: second, hash: contentHash(2) },
			{ item: third, hash: contentHash(3) },
		];
		const full = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			ordered,
		);
		let history = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			[],
		);
		history = history.insertStructuralItem(
			first,
			contentHash(1),
			undefined,
			undefined,
		);
		history = history.insertStructuralItem(
			second,
			contentHash(2),
			first,
			undefined,
		);
		history = history.insertStructuralItem(
			third,
			contentHash(3),
			second,
			undefined,
		);
		assert.equal(history.rootHash, full.rootHash);

		const removed = history.removeStructuralItem(
			second,
			first,
			third,
		);
		const reinserted = removed.insertStructuralItem(
			second,
			contentHash(2),
			first,
			third,
		);
		assert.equal(reinserted.rootHash, full.rootHash);

		const moved = full.moveStructuralItem(
			second,
			first,
			third,
			third,
			undefined,
		);
		const movedFull = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			[ordered[0]!, ordered[2]!, ordered[1]!],
		);
		assert.equal(moved.rootHash, movedFull.rootHash);
		assert.notEqual(moved.rootHash, full.rootHash);
		assert.equal(
			full.moveStructuralItem(
				second,
				first,
				third,
				first,
				third,
			),
			full,
		);
		assert.throws(
			() => full.moveStructuralItem(
				second,
				undefined,
				undefined,
				undefined,
				undefined,
			),
			RangeError,
		);
		assert.throws(
			() => full.moveStructuralItem(
				textNode(99),
				undefined,
				undefined,
				undefined,
				undefined,
			),
			RangeError,
		);
		const positional = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			[contentHash(1)],
		);
		assert.throws(
			() => positional.moveStructuralItem(
				second,
				undefined,
				undefined,
				undefined,
				undefined,
			),
			TypeError,
		);
		assert.equal(
			moved.moveStructuralItem(
				second,
				third,
				undefined,
				first,
				third,
			).rootHash,
			full.rootHash,
		);

		const replaced = full.replaceStructuralItem(second, contentHash(20));
		assert.equal(
			replaced.rootHash,
			ManuscriptMerkleVector.createStructural(
				manuscriptMerkleVectorRoles.nodeChildren,
				[
					ordered[0]!,
					{ item: second, hash: contentHash(20) },
					ordered[2]!,
				],
			).rootHash,
		);
		assert.equal(full.getStructuralItemHash(second), contentHash(2));
		assert.throws(
			() => full.removeStructuralItem(second, third, undefined),
			RangeError,
		);
	});

	test('uses all 64 relation-key nibbles and converges after split and merge', () => {
		const first = relation(100, 200);
		const second = relation(100, 201);
		const third = relation(101, 200);
		const items = [
			{ item: first, hash: contentHash(1) },
			{ item: second, hash: contentHash(2) },
			{ item: third, hash: contentHash(3) },
		];
		const full = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
			items,
		);
		const merged = full.removeStructuralItem(second, first, third);
		const split = merged.insertStructuralItem(
			second,
			contentHash(2),
			first,
			third,
		);
		assert.equal(split.rootHash, full.rootHash);
		assert.equal(full.getStructuralItemHash(third), contentHash(3));
		const moved = full.moveStructuralItem(
			second,
			first,
			third,
			third,
			undefined,
		);
		assert.equal(
			moved.rootHash,
			ManuscriptMerkleVector.createStructural(
				manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
				[items[0]!, items[2]!, items[1]!],
			).rootHash,
		);
		assert.equal(
			moved.moveStructuralItem(
				second,
				third,
				undefined,
				first,
				third,
			).rootHash,
			full.rootHash,
		);
		assert.notEqual(
			full.rootHash,
			ManuscriptMerkleVector.createStructural(
				manuscriptMerkleVectorRoles.academicClaimEvidenceRelations,
				[items[2]!, items[0]!, items[1]!],
			).rootHash,
		);
	});

	test('full-builds 20k keyed entries with one read and bounded radix work per item', () => {
		const count = 20_000;
		const items = Array.from({ length: count }, (_, index) => ({
			item: textNode(index + 1),
			hash: contentHash(index + 1),
		}));
		let itemReads = 0;
		let trieNodeVisits = 0;
		let trieNodeCopies = 0;
		let hashCalls = 0;
		const vector = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			items,
			{
				onItemRead: () => {
					itemReads += 1;
				},
				onTrieNodeCopy: () => {
					trieNodeCopies += 1;
				},
				onTrieNodeVisit: () => {
					trieNodeVisits += 1;
				},
				onHashCall: () => {
					hashCalls += 1;
				},
			},
		);
		assert.equal(vector.count, count);
		assert.equal(itemReads, count);
		assert.equal(trieNodeVisits, 0);
		assert.ok(trieNodeCopies >= count);
		assert.ok(trieNodeCopies < count * 2);
		assert.ok(hashCalls > count * 2);
		assert.ok(hashCalls < count * 3 + 1);
		assert.equal(
			vector.getStructuralItemHash(items[12_345]!.item),
			items[12_345]!.hash,
		);

		const targetIndex = 12_345;
		const target = items[targetIndex]!.item;
		const previous = items[targetIndex - 1]!.item;
		const next = items[targetIndex + 1]!.item;
		const inserted = textNode(count + 1);
		const boundedInstrumentation = () => {
			const counts = {
				visits: 0,
				copies: 0,
				hashes: 0,
			};
			return {
				counts,
				instrumentation: {
					onTrieNodeVisit: () => {
						counts.visits += 1;
					},
					onTrieNodeCopy: () => {
						counts.copies += 1;
					},
					onHashCall: () => {
						counts.hashes += 1;
					},
				},
			};
		};

		const replacementWork = boundedInstrumentation();
		vector.replaceStructuralItem(
			target,
			contentHash(count + 2),
			replacementWork.instrumentation,
		);
		assert.ok(replacementWork.counts.visits > 0);
		assert.ok(replacementWork.counts.visits <= 64);
		assert.ok(replacementWork.counts.copies <= 64);
		assert.ok(replacementWork.counts.hashes <= 66);

		const insertionWork = boundedInstrumentation();
		const withInsert = vector.insertStructuralItem(
			inserted,
			contentHash(count + 1),
			target,
			next,
			insertionWork.instrumentation,
		);
		assert.ok(insertionWork.counts.visits > 0);
		assert.ok(insertionWork.counts.visits <= 128);
		assert.ok(insertionWork.counts.copies <= 128);
		assert.ok(insertionWork.counts.hashes <= 132);

		const removalWork = boundedInstrumentation();
		assert.equal(
			withInsert.removeStructuralItem(
				inserted,
				target,
				next,
				removalWork.instrumentation,
			).rootHash,
			vector.rootHash,
		);
		assert.ok(removalWork.counts.visits > 0);
		assert.ok(removalWork.counts.visits <= 160);
		assert.ok(removalWork.counts.copies <= 128);
		assert.ok(removalWork.counts.hashes <= 132);

		const moveWork = boundedInstrumentation();
		vector.moveStructuralItem(
			target,
			previous,
			next,
			items[targetIndex + 10]!.item,
			items[targetIndex + 11]!.item,
			moveWork.instrumentation,
		);
		assert.ok(moveWork.counts.visits > 0);
		assert.ok(moveWork.counts.visits <= 320);
		assert.ok(moveWork.counts.copies <= 256);
		assert.ok(moveWork.counts.hashes <= 264);
	});

	test('separates positional and structural authority and rejects constructor forgery', () => {
		const positional = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			[],
		);
		const structural = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			[],
		);
		const entity = referenceEntity(1);
		const entityVector = ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.academicReferenceSnapshots,
			[{ item: entity, hash: contentHash(1) }],
		);
		assert.equal(entityVector.getStructuralItemHash(entity), contentHash(1));
		assert.equal(Object.isFrozen(ManuscriptMerkleVector), true);
		assert.equal(Object.isFrozen(ManuscriptMerkleVector.prototype), true);
		assert.deepStrictEqual(
			Reflect.ownKeys(structural).sort(),
			['count', 'level', 'role', 'rootHash'],
		);
		assert.throws(
			() => Reflect.construct(
				ManuscriptMerkleVector as unknown as Function,
				[
					Object.freeze({}),
					manuscriptMerkleVectorRoles.nodeChildren,
					Object.freeze({}),
				],
			),
			TypeError,
		);
		assert.throws(
			() => ManuscriptMerkleVector.create(
				manuscriptMerkleVectorRoles.nodeChildren as never,
				[],
			),
			TypeError,
		);
		assert.throws(
			() => ManuscriptMerkleVector.createStructural(
				manuscriptMerkleVectorRoles.metadataAuthors as never,
				[],
			),
			TypeError,
		);
		assert.throws(() => positional.getStructuralItemHash(textNode(1)), TypeError);
		assert.throws(() => structural.getItemHash(0), TypeError);
	});

	test('rejects unsupported roles, invalid hashes, and invalid item indexes', () => {
		assert.throws(
			() => ManuscriptMerkleVector.create(
				'unsupported-role' as never,
				[],
			),
			TypeError,
		);
		assert.throws(
			() => ManuscriptMerkleVector.create(
				manuscriptMerkleVectorRoles.metadataAuthors,
				['sha256:INVALID' as ContentHash],
			),
			TypeError,
		);

		const empty = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			[],
		);
		const vector = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			hashes(2),
		);
		assert.throws(() => empty.getItemHash(0), RangeError);
		assert.throws(() => empty.replaceItem(0, contentHash(1)), RangeError);
		assert.throws(() => vector.getItemHash(-1), RangeError);
		assert.throws(() => vector.getItemHash(2), RangeError);
		assert.throws(() => vector.replaceItem(0.5, contentHash(1)), RangeError);
		assert.throws(
			() => vector.replaceItem(0, 'sha256:INVALID' as ContentHash),
			TypeError,
		);
	});
});
