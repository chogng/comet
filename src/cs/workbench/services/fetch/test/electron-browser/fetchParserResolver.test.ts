/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { URI } from 'cs/base/common/uri';
import {
	FetchParserAmbiguityError,
	FetchParserNotFoundError,
	resolveFetchParser,
} from 'cs/workbench/services/fetch/electron-browser/fetchParserResolver';

const context = {
	uri: URI.parse('https://example.com/articles'),
	document: new JSDOM('<main><article></article></main>').window.document,
};

test('Fetch parser resolver returns the single matching parser', () => {
	const parser = { id: 'article' };
	const result = resolveFetchParser([
		{ id: 'article', matches: () => true, parser },
		{ id: 'other', matches: () => false, parser: { id: 'other' } },
	], context);

	assert.equal(result, parser);
});

test('Fetch parser resolver rejects unmatched and ambiguous pages', () => {
	assert.throws(
		() => resolveFetchParser([{ id: 'none', matches: () => false, parser: 'none' }], context),
		FetchParserNotFoundError,
	);
	assert.throws(
		() => resolveFetchParser([
			{ id: 'first', matches: () => true, parser: 'first' },
			{ id: 'second', matches: () => true, parser: 'second' },
		], context),
		FetchParserAmbiguityError,
	);
});
