/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	createHashPreimage,
	manuscriptHashDomains,
	manuscriptHashPreimagePrefix,
	manuscriptHashPreimageProfile,
} from 'cs/editor/common/core/hashPreimage';

suite('Manuscript hash preimages', () => {
	test('freezes the six exact domain names and profile prefix', () => {
		assert.equal(manuscriptHashPreimageProfile, 'nireco-hash-preimage-1');
		assert.equal(manuscriptHashPreimagePrefix, 'NIRECO\0HASH\0V1\0');
		assert.equal(Object.isFrozen(manuscriptHashDomains), true);
		assert.deepStrictEqual(manuscriptHashDomains, {
			academicEntity: 'nireco.academic-entity.v1',
			documentContent: 'nireco.document-content.v1',
			node: 'nireco.node.v1',
			proposalChangeGroup: 'nireco.proposal-change-group.v1',
			semanticDiff: 'nireco.semantic-diff.v1',
			transaction: 'nireco.transaction.v1',
		});
		assert.deepStrictEqual(Object.keys(manuscriptHashDomains), [
			'academicEntity',
			'documentContent',
			'node',
			'proposalChangeGroup',
			'semanticDiff',
			'transaction',
		]);
	});

	test('constructs the exact preimage for every domain from one canonical payload', () => {
		const payload = {
			'\u{10000}': 2,
			'\ue000': 1,
			text: '值😀',
			nested: [true, null],
		};
		const canonicalJson = '{"nested":[true,null],"text":"值😀","":1,"𐀀":2}';
		const results = Object.values(manuscriptHashDomains).map(
			domain => createHashPreimage(domain, payload),
		);

		assert.deepStrictEqual(results, [
			{
				type: 'ok',
				canonicalJson,
				preimage: `NIRECO\0HASH\0V1\0nireco.academic-entity.v1\0${canonicalJson}`,
			},
			{
				type: 'ok',
				canonicalJson,
				preimage: `NIRECO\0HASH\0V1\0nireco.document-content.v1\0${canonicalJson}`,
			},
			{
				type: 'ok',
				canonicalJson,
				preimage: `NIRECO\0HASH\0V1\0nireco.node.v1\0${canonicalJson}`,
			},
			{
				type: 'ok',
				canonicalJson,
				preimage: `NIRECO\0HASH\0V1\0nireco.proposal-change-group.v1\0${canonicalJson}`,
			},
			{
				type: 'ok',
				canonicalJson,
				preimage: `NIRECO\0HASH\0V1\0nireco.semantic-diff.v1\0${canonicalJson}`,
			},
			{
				type: 'ok',
				canonicalJson,
				preimage: `NIRECO\0HASH\0V1\0nireco.transaction.v1\0${canonicalJson}`,
			},
		]);
	});

	test('surfaces canonical JSON failure without constructing a preimage', () => {
		assert.deepStrictEqual(
			createHashPreimage(manuscriptHashDomains.documentContent, {
				content: {
					value: undefined,
				},
			}),
			{
				type: 'error',
				reason: 'canonical-json',
				path: '$.content.value',
			},
		);
	});
});
