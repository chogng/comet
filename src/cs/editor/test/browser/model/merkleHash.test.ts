/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseContentHash,
	parseNodeId,
	type ContentHash,
} from 'cs/editor/common/core/identifiers';
import { hashUtf8 } from 'cs/editor/common/core/sha256';
import {
	ManuscriptMerkleVector,
	manuscriptMerkleVectorRoles,
	type ManuscriptMerkleVectorHashCall,
} from 'cs/editor/common/model/merkleVector';
import type { TextNode } from 'cs/editor/common/model/manuscript';

function contentHash(sequence: number): ContentHash {
	const parsed = parseContentHash(
		`sha256:${sequence.toString(16).padStart(64, '0')}`,
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Browser test content hash.');
	}
	return parsed.value;
}

function textNode(): TextNode {
	const parsed = parseNodeId(
		'018f0000-0000-7000-8000-00000000000a',
	);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Browser test Node ID.');
	}
	return Object.freeze({
		id: parsed.value,
		type: 'text',
		value: 'Browser structural Merkle golden',
		marks: Object.freeze([]),
	});
}

test('Browser portable SHA-256 and both Merkle grammars match Node goldens', () => {
	assert.equal(
		hashUtf8('abc'),
		'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	);
	assert.equal(
		ManuscriptMerkleVector.create(
			manuscriptMerkleVectorRoles.metadataAuthors,
			[],
		).rootHash,
		'sha256:c7916acb73770990fc92212d6ac2d675fe9ad35d8f3877ba2b2b2b61674e92eb',
	);
	assert.equal(
		ManuscriptMerkleVector.createStructural(
			manuscriptMerkleVectorRoles.nodeChildren,
			[],
		).rootHash,
		'sha256:a7f8b134b5476d30274f1c03f851f1205ac168b275a71f629d3e83e5c3cc45cc',
	);

	const node = textNode();
	const calls: ManuscriptMerkleVectorHashCall[] = [];
	const singleton = ManuscriptMerkleVector.createStructural(
		manuscriptMerkleVectorRoles.nodeChildren,
		[{ item: node, hash: contentHash(1) }],
		{
			onHashCall: call => {
				calls.push(call);
			},
		},
	);
	assert.equal(
		singleton.rootHash,
		'sha256:c07868924d85e78f3b9125abf6a0c2915d71482c9dc0ae55451a50737e21eb1d',
	);
	assert.deepStrictEqual(
		calls.map(call => call.hash),
		[
			'sha256:0c4cbf7d25fa6f249054e62e897786b441834f06093ce6de1414b99120e4fac8',
			'sha256:6450b2f30777a4887c6075cb32bba64013ffb40e9c3e24d6a60253f65a183865',
			'sha256:c07868924d85e78f3b9125abf6a0c2915d71482c9dc0ae55451a50737e21eb1d',
		],
	);
	assert.equal(
		calls[0]?.canonicalJson,
		'{"algorithm":"nireco-structural-merkle-sequence-1","itemHash":"sha256:0000000000000000000000000000000000000000000000000000000000000001","key":{"kind":"node","nodeId":"018f0000-0000-7000-8000-00000000000a"},"kind":"entry","nextKey":null,"role":"manuscript-node-children"}',
	);
});
