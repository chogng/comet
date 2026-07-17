/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	createManuscriptDraftResource,
	manuscriptDraftScheme,
	parseManuscriptResource,
	validateManuscriptResource,
	type ManuscriptResourceFailure,
} from 'cs/editor/common/core/manuscriptResource';

const uuidV7 = '01234567-89ab-7001-8203-040506070809';
const canonicalResource = `comet-draft:${uuidV7}`;

function assertRejected(value: string, reason: ManuscriptResourceFailure): void {
	assert.deepStrictEqual(parseManuscriptResource(value), {
		type: 'invalid',
		reason,
	});
}

suite('Manuscript resource', () => {
	test('creates and parses the canonical comet-draft resource round trip', () => {
		const created = createManuscriptDraftResource(uuidV7);

		assert.equal(created.scheme, manuscriptDraftScheme);
		assert.equal(created.authority, '');
		assert.equal(created.path, uuidV7);
		assert.equal(created.query, '');
		assert.equal(created.fragment, '');
		assert.equal(created.toString(true), canonicalResource);

		const parsed = parseManuscriptResource(created.toString(true));
		assert.equal(parsed.type, 'valid');
		if (parsed.type === 'valid') {
			assert.equal(parsed.canonical, canonicalResource);
			assert.equal(parsed.resource.toString(true), canonicalResource);
			assert.deepStrictEqual(parsed.resource.toJSON(), created.toJSON());
		}
	});

	test('rejects unsupported components before accepting a draft resource', () => {
		const cases: readonly (readonly [string, ManuscriptResourceFailure])[] = [
			['not a uri', 'invalid-uri'],
			[`file:${uuidV7}`, 'unsupported-scheme'],
			[`COMET-DRAFT:${uuidV7}`, 'unsupported-scheme'],
			[`comet-draft://agent/${uuidV7}`, 'authority-not-allowed'],
			['comet-draft:not-a-uuid', 'invalid-path'],
			[`comet-draft:${uuidV7.toUpperCase()}`, 'invalid-path'],
			[`comet-draft:${uuidV7}?mode=review`, 'query-not-allowed'],
			[`comet-draft:${uuidV7}#selection`, 'fragment-not-allowed'],
			[`comet-draft:%30${uuidV7.slice(1)}`, 'not-canonical'],
		];

		for (const [value, reason] of cases) {
			assertRejected(value, reason);
		}
	});

	test('validates already parsed resources with the same strict component rules', () => {
		assert.deepStrictEqual(
			validateManuscriptResource(URI.from({
				scheme: manuscriptDraftScheme,
				path: uuidV7,
				query: 'mode=review',
			})),
			{
				type: 'invalid',
				reason: 'query-not-allowed',
			},
		);
		assert.deepStrictEqual(
			validateManuscriptResource(URI.from({
				scheme: manuscriptDraftScheme,
				path: uuidV7,
				fragment: 'selection',
			})),
			{
				type: 'invalid',
				reason: 'fragment-not-allowed',
			},
		);
	});

	test('refuses to create a resource from a non-UUIDv7 path', () => {
		assert.throws(
			() => createManuscriptDraftResource('01234567-89ab-8001-8203-040506070809'),
			TypeError,
		);
		assert.throws(
			() => createManuscriptDraftResource(uuidV7.toUpperCase()),
			TypeError,
		);
	});
});
