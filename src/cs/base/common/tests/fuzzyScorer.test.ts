/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesFuzzy2 } from 'cs/base/common/filters';
import {
	compareItemsByFuzzyScore,
	FuzzyScorerCache,
	IItemAccessor,
	prepareQuery,
	scoreFuzzy2,
	scoreItemFuzzy,
} from 'cs/base/common/fuzzyScorer';

interface TestItem {
	label: string;
	description?: string;
	path?: string;
}

const accessor: IItemAccessor<TestItem> = {
	getItemLabel: item => item.label,
	getItemDescription: item => item.description,
	getItemPath: item => item.path,
};

test('fuzzyScorer prepares multiple query values', () => {
	const query = prepareQuery('foo bar#');

	assert.equal(query.original, 'foo bar#');
	assert.equal(query.normalized, 'foobar');
	assert.deepEqual(query.values?.map(value => value.normalized), ['foo', 'bar']);
});

test('fuzzyScorer exposes fuzzy match ranges', () => {
	assert.deepEqual(matchesFuzzy2('fb', 'fooBar'), [
		{ start: 0, end: 1 },
		{ start: 3, end: 4 },
	]);

	const [score, matches] = scoreFuzzy2('fooBar', prepareQuery('fb'));
	assert.equal(typeof score, 'number');
	assert.deepEqual(matches, [
		{ start: 0, end: 1 },
		{ start: 3, end: 4 },
	]);
});

test('fuzzyScorer scores label and path matches', () => {
	const item = {
		label: 'fooBar.ts',
		description: '/workspace/src',
		path: '/workspace/src/fooBar.ts',
	};
	const cache: FuzzyScorerCache = Object.create(null);

	const labelScore = scoreItemFuzzy(item, prepareQuery('fb'), true, accessor, cache);
	assert.ok(labelScore.score > 0);
	assert.deepEqual(labelScore.labelMatch, [
		{ start: 0, end: 1 },
		{ start: 3, end: 4 },
	]);

	const pathScore = scoreItemFuzzy(item, prepareQuery('/workspace/src/fooBar.ts'), true, accessor, Object.create(null));
	assert.deepEqual(pathScore.labelMatch, [{ start: 0, end: item.label.length }]);
	assert.deepEqual(pathScore.descriptionMatch, [{ start: 0, end: item.description.length }]);
});

test('fuzzyScorer sorts stronger label matches first', () => {
	const items = [
		{ label: 'barfoo.ts' },
		{ label: 'foo.ts' },
		{ label: 'fooBar.ts' },
	];
	const query = prepareQuery('foo');
	const cache: FuzzyScorerCache = Object.create(null);

	const sorted = items.slice().sort((itemA, itemB) => compareItemsByFuzzyScore(itemA, itemB, query, true, accessor, cache));

	assert.deepEqual(sorted.map(item => item.label), ['foo.ts', 'fooBar.ts', 'barfoo.ts']);
});
