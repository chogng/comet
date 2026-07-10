/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URI } from 'cs/base/common/uri';
import {
	createArticleGroupId,
	createArticleId,
	createArticleListItemId,
	createArticleListSourceId,
	createArticlePageId,
} from 'cs/workbench/services/fetch/common/fetchIds';

test('Fetch IDs preserve source, page, article, and occurrence identity', () => {
	const journalId = 'journal.nature.nature';
	const sourceId = createArticleListSourceId(journalId, URI.parse('https://www.nature.com/nature/research-articles'));
	const firstPageId = createArticlePageId(sourceId, URI.parse('https://www.nature.com/nature/research-articles?page=1'));
	const secondPageId = createArticlePageId(sourceId, URI.parse('https://www.nature.com/nature/research-articles?page=2'));
	const articleId = createArticleId(journalId, URI.parse('https://www.nature.com/articles/s41586-023-06461-0'));

	assert.equal(sourceId, createArticleListSourceId(journalId, URI.parse('https://www.nature.com/nature/research-articles')));
	assert.notEqual(firstPageId, secondPageId);
	assert.equal(articleId, createArticleId(journalId, URI.parse('https://www.nature.com/articles/s41586-023-06461-0')));
	assert.notEqual(
		createArticleListItemId(firstPageId, articleId, 'featured:0'),
		createArticleListItemId(firstPageId, articleId, 'research:0'),
	);
	assert.equal(
		createArticleListItemId(firstPageId, articleId, 'research:0'),
		createArticleListItemId(firstPageId, articleId, 'research:0'),
	);
	assert.equal(createArticleGroupId(firstPageId, 0), createArticleGroupId(firstPageId, 0));
});

test('Fetch IDs reject invalid result positions', () => {
	const pageId = createArticlePageId('source:test', URI.parse('https://example.com/page'));
	const articleId = createArticleId('journal.test', URI.parse('https://example.com/article'));

	assert.throws(() => createArticleGroupId(pageId, -1), RangeError);
	assert.throws(() => createArticleListItemId(pageId, articleId, ''), /occurrence key/);
});
