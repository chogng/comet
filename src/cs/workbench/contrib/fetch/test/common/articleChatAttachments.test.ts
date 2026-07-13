/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	parseArticleAttachmentProducerState,
	parseArticleAttachmentRepresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatAttachments';

function representation(): Record<string, AgentHostProtocolValue> {
	return {
		articleId: 'article:test',
		journalId: 'journal:test',
		url: 'https://example.com/article',
		title: 'Canonical Article',
		subjects: ['Architecture'],
		authors: [{
			name: 'Ada Example',
			url: 'https://example.com/ada',
			isCorresponding: true,
		}],
		publication: {
			title: 'Test Journal',
			journalId: 'journal:test',
			url: 'https://example.com/journal',
			volume: '12',
			issue: '3',
			articleNumber: '42',
			pageRange: '1-9',
			year: 2026,
		},
		doi: '10.1000/test',
		description: 'Description',
		editorsSummary: 'Editor summary',
		abstract: 'Abstract metadata',
		articleType: 'Research Article',
		publishedAt: '2026-07-13',
		pdfUrl: 'https://example.com/article.pdf',
		citationUrl: 'https://example.com/article.citation',
		isOpenAccess: true,
	};
}

test('Article representation parser returns the exact deeply immutable current schema', () => {
	const value = representation();
	const parsed = parseArticleAttachmentRepresentation(value);

	assert.deepEqual(parsed, value);
	assert.equal(Object.isFrozen(parsed), true);
	assert.equal(Object.isFrozen(parsed.subjects), true);
	assert.equal(Object.isFrozen(parsed.authors), true);
	assert.equal(Object.isFrozen(parsed.authors[0]), true);
	assert.equal(Object.isFrozen(parsed.publication), true);
	assert.notEqual(parsed, value);
	assert.notEqual(parsed.authors, value.authors);
});

test('Article representation parser rejects missing, unknown, and nested schema properties', () => {
	const missing = representation();
	delete missing.subjects;
	assert.throws(
		() => parseArticleAttachmentRepresentation(missing),
		/missing required property 'subjects'/,
	);

	assert.throws(
		() => parseArticleAttachmentRepresentation({ ...representation(), replacementText: 'forbidden' }),
		/unsupported property 'replacementText'/,
	);

	const unknownAuthor = representation();
	unknownAuthor.authors = [{ name: 'Ada Example', affiliation: 'Not in the schema' }];
	assert.throws(
		() => parseArticleAttachmentRepresentation(unknownAuthor),
		/Article author 0 contains unsupported property 'affiliation'/,
	);

	const unknownPublication = representation();
	unknownPublication.publication = { title: 'Test Journal', alternateTitle: 'Forbidden' };
	assert.throws(
		() => parseArticleAttachmentRepresentation(unknownPublication),
		/Article publication contains unsupported property 'alternateTitle'/,
	);
});

test('Article representation parser enforces identity, collection, value, and aggregate byte bounds', () => {
	assert.throws(
		() => parseArticleAttachmentRepresentation({
			...representation(),
			articleId: 'x'.repeat(2_049),
		}),
		/Article articleId must be a bounded string/,
	);
	assert.throws(
		() => parseArticleAttachmentRepresentation({
			...representation(),
			authors: Array.from({ length: 257 }, (_, index) => ({ name: `Author ${index}` })),
		}),
		/Article authors must be an array with at most 256 entries/,
	);
	assert.throws(
		() => parseArticleAttachmentRepresentation({
			...representation(),
			publication: { title: 'Test Journal', year: 10_000 },
		}),
		/Article publication year must be a bounded integer/,
	);
	assert.throws(
		() => parseArticleAttachmentRepresentation({
			...representation(),
			isOpenAccess: 'yes',
		}),
		/Article isOpenAccess must be boolean/,
	);
	assert.throws(
		() => parseArticleAttachmentRepresentation({
			...representation(),
			description: 'x'.repeat(4 * 1024 * 1024),
		}),
		/Article metadata cannot exceed 4194304 bytes/,
	);
});

test('Article producer-state parser accepts only the exact current addressed identity', () => {
	assert.deepEqual(parseArticleAttachmentProducerState({ articleId: 'article:test' }), {
		articleId: 'article:test',
	});
	assert.throws(
		() => parseArticleAttachmentProducerState({ articleId: 'article:test', version: 1 }),
		/unsupported property 'version'/,
	);
	assert.throws(
		() => parseArticleAttachmentProducerState({}),
		/missing required property 'articleId'/,
	);
});
