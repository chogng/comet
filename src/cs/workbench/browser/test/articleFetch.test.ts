import assert from 'node:assert/strict';
import test from 'node:test';

import {
	fetchLatestArticlesBatch,
  prepareBatchSourcesForFetch,
  resolveBatchFetchSources,
} from 'cs/workbench/services/fetch/browser/articleFetch';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { IFetchService } from 'cs/workbench/services/fetch/common/fetch';

test('current URL source metadata can be overridden from settings JSON', () => {
  const sourceTable: BatchSource[] = [
    {
      id: 'builtin',
      url: 'https://example.com/latest',
      journalTitle: 'Built-in title',
    },
    {
      id: 'override-1',
      url: 'https://example.com/latest',
      journalTitle: 'Override title',
    },
  ];

  const selectedSources = resolveBatchFetchSources(
    'https://example.com/latest',
    sourceTable,
  );
  const { sources } = prepareBatchSourcesForFetch(selectedSources, sourceTable);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].journalTitle, 'Override title');
});

test('batch fetch loads configured list URLs through IFetchService', async () => {
	const listUrl = URI.parse('https://example.com/list');
	const articleUrl = URI.parse('https://example.com/articles/one');
	const fetchService = {
		getJournals: () => [{
			id: 'journal.example',
			title: 'Example',
			homeUrl: URI.parse('https://example.com'),
			discoveryUrl: listUrl,
			providerId: 'publisher.example',
		}],
		discoverArticleListSources: async () => undefined,
		getArticleListCatalog: () => ({
			journalId: 'journal.example',
			entries: [{
				kind: 'source' as const,
				id: 'source:example',
				journalId: 'journal.example',
				label: 'Example',
				url: listUrl,
			}],
		}),
		fetchArticleListSource: async () => undefined,
		getArticlePages: () => [{
			id: 'page:example',
			sourceId: 'source:example',
			url: listUrl,
			groups: [],
			ungroupedItemIds: ['item:example'],
		}],
		getArticleListItem: (id: string) => id === 'item:example' ? {
			id,
			articleId: 'article:example',
			title: 'Example article',
			authors: [],
			relatedArticles: [],
			publishedAt: '2026-07-04',
		} : undefined,
		fetchArticle: async () => ({
			articleId: 'article:example',
			journalId: 'journal.example',
			url: articleUrl,
			title: 'Example article',
			subjects: [],
			authors: [{ name: 'Ada Lovelace' }],
			publishedAt: '2026-07-04',
			publication: { title: 'Example Journal' },
		}),
	} as unknown as IFetchService;

	const result = await fetchLatestArticlesBatch({
		batchSources: [{ id: 'example', url: listUrl.toString(true), journalTitle: 'Example' }],
		sourceTable: [],
		fetchService,
		startDate: '2026-07-01',
		endDate: '2026-07-08',
		token: CancellationTokenNone,
	});

	assert.equal(result.ok, true);
	assert.equal(result.ok ? result.articles[0].title : '', 'Example article');
});
