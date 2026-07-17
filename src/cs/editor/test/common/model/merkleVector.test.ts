/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'node:test';

import {
	parseContentHash,
	type ContentHash,
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
	type ManuscriptMerkleVectorHashCall,
	type ManuscriptMerkleVectorHashCallObserver,
	type ManuscriptMerkleVectorRole,
} from 'cs/editor/common/model/merkleVector';

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
			manuscriptMerkleVectorRoles.nodeChildren,
			[],
			recordHashCalls(calls),
		);

		assert.equal(vector.count, 0);
		assert.equal(vector.level, 0);
		assert.equal(
			vector.rootHash,
			'sha256:010566c331fbd633dc358ff7c3e997f44311bb768ce02fb70e0050e76da7319f',
		);
		assert.equal(Object.isFrozen(vector), true);
		assert.deepStrictEqual(calls, [{
			domain: manuscriptHashDomains.documentContent,
			payload: {
				algorithm: manuscriptMerkleVectorAlgorithm,
				fanout: manuscriptMerkleVectorFanout,
				kind: 'empty',
				role: manuscriptMerkleVectorRoles.nodeChildren,
				count: 0,
			},
			canonicalJson:
				'{"algorithm":"nireco-merkle-vector-1","count":0,"fanout":32,"kind":"empty","role":"manuscript-node-children"}',
			hash:
				'sha256:010566c331fbd633dc358ff7c3e997f44311bb768ce02fb70e0050e76da7319f',
		}]);
		assertHashCalls(calls);
	});

	test('hashes the exact leaf payload and owns a copy of source items', () => {
		const source = [contentHash(1)];
		const calls: ManuscriptMerkleVectorHashCall[] = [];
		const vector = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.nodeChildren,
			source,
			recordHashCalls(calls),
		);
		source[0] = contentHash(2);

		assert.equal(vector.count, 1);
		assert.equal(vector.level, 0);
		assert.equal(vector.getItemHash(0), contentHash(1));
		assert.equal(
			vector.rootHash,
			'sha256:9cb63253d8cd5e9749943f7d9a54d73ec8b4e30e5779bc454bf3666b93ce6d4b',
		);
		assert.deepStrictEqual(calls[0]?.payload, {
			algorithm: manuscriptMerkleVectorAlgorithm,
			fanout: manuscriptMerkleVectorFanout,
			kind: 'leaf',
			role: manuscriptMerkleVectorRoles.nodeChildren,
			level: 0,
			count: 1,
			items: [contentHash(1)],
		});
		assert.equal(
			calls[0]?.canonicalJson,
			'{"algorithm":"nireco-merkle-vector-1","count":1,"fanout":32,"items":["sha256:0000000000000000000000000000000000000000000000000000000000000001"],"kind":"leaf","level":0,"role":"manuscript-node-children"}',
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
				manuscriptMerkleVectorRoles.academicClaims,
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
			manuscriptMerkleVectorRoles.academicEvidenceLinks,
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
			role: manuscriptMerkleVectorRoles.academicEvidenceLinks,
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
			manuscriptMerkleVectorRoles.nodeChildren,
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
				level: call.payload.kind === 'empty' ? 0 : call.payload.level,
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
			manuscriptMerkleVectorRoles.nodeChildren,
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

	test('rejects unsupported roles, invalid hashes, and invalid item indexes', () => {
		assert.throws(
			() => ManuscriptMerkleVector.create(
				'unsupported-role' as ManuscriptMerkleVectorRole,
				[],
			),
			TypeError,
		);
		assert.throws(
			() => ManuscriptMerkleVector.create(
				manuscriptMerkleVectorRoles.nodeChildren,
				['sha256:INVALID' as ContentHash],
			),
			TypeError,
		);

		const empty = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.nodeChildren,
			[],
		);
		const vector = ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.nodeChildren,
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
