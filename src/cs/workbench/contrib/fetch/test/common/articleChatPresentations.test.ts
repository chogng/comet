/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createArticleHistoryChatPresentation,
	parseArticleHistoryChatPresentation,
	parseArticleListChatPresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatPresentations';

function evidenceResult(): Record<string, unknown> {
	return {
		answer: 'The evidence-backed answer.',
		evidence: [{
			rank: 1,
			title: 'Canonical Article',
			journalTitle: 'Test Journal',
			publishedAt: '2026-07-13',
			sourceUrl: 'https://example.com/article',
			score: 0.95,
			excerpt: 'Relevant evidence.',
		}],
		provider: 'moark',
		llmProvider: 'openai',
		llmModel: 'test-model',
		embeddingModel: 'test-embedding',
		rerankerModel: 'test-reranker',
		rerankApplied: true,
	};
}

test('Article history constructor accepts the exact legacy article and evidence fields', () => {
	const result = createArticleHistoryChatPresentation(
		['article:first', 'article:second'],
		evidenceResult(),
	);

	assert.deepEqual(result, {
		articleIds: ['article:first', 'article:second'],
		evidenceResult: evidenceResult(),
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.articleIds), true);
	assert.equal(Object.isFrozen(result.evidenceResult), true);
	assert.equal(Object.isFrozen(result.evidenceResult?.evidence), true);
});

test('Article history parser rejects unknown fields and duplicate Article identities', () => {
	assert.throws(
		() => parseArticleHistoryChatPresentation({
			articleIds: ['article:first'],
			evidenceResult: null,
			legacyMessage: 'unsupported',
		}),
		/unsupported or missing properties/,
	);
	assert.throws(
		() => parseArticleHistoryChatPresentation({
			articleIds: ['article:first', 'article:first'],
			evidenceResult: null,
		}),
		/contain duplicates/,
	);
});

test('Article presentation parsers reject invalid URLs and evidence providers', () => {
	assert.throws(
		() => parseArticleListChatPresentation({
			sourceLabel: 'Test source',
			items: [{
				id: 'occurrence:first',
				articleId: 'article:first',
				title: 'Canonical Article',
				url: 'file:///private/article.html',
				metadata: '',
			}],
		}),
		/canonical HTTP\(S\) URI/,
	);

	const invalidProvider = evidenceResult();
	invalidProvider.provider = 'legacy-rag';
	assert.throws(
		() => parseArticleHistoryChatPresentation({
			articleIds: [],
			evidenceResult: invalidProvider,
		}),
		/provider is unsupported/,
	);

	const invalidLlmProvider = evidenceResult();
	invalidLlmProvider.llmProvider = 'legacy-provider';
	assert.throws(
		() => parseArticleHistoryChatPresentation({
			articleIds: [],
			evidenceResult: invalidLlmProvider,
		}),
		/LLM provider is unsupported/,
	);
});
