/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { ArticleListSource, ArticleRecord, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { IFetchProvider, ParsedArticleDetail, ParsedArticleListCatalog, ParsedArticleListPage, ParsedArticleReadableContent } from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';

class TestFetchProvider implements IFetchProvider {
	readonly id = 'provider.test';

	canonicalizeSourceUri(uri: URI): URI {
		return uri;
	}

	canonicalizePageUri(uri: URI): URI {
		return uri;
	}

	canonicalizeArticleUri(uri: URI): URI {
		return uri;
	}

	discoverArticleListSources(_journal: JournalDescriptor, _token: CancellationToken): Promise<ParsedArticleListCatalog> {
		throw new Error('Not implemented.');
	}

	fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, _url: URI, _token: CancellationToken): Promise<ParsedArticleListPage> {
		throw new Error('Not implemented.');
	}

	fetchArticleDetail(_journal: JournalDescriptor, _article: ArticleRecord, _token: CancellationToken): Promise<ParsedArticleDetail> {
		throw new Error('Not implemented.');
	}

	fetchArticleReadableContent(
		_journal: JournalDescriptor,
		_article: ArticleRecord,
		_token: CancellationToken,
	): Promise<ParsedArticleReadableContent> {
		throw new Error('Not implemented.');
	}
}

const journal: JournalDescriptor = {
	id: 'journal.test',
	title: 'Test Journal',
	homeUrl: URI.parse('https://example.com'),
	discoveryUrl: URI.parse('https://example.com/articles'),
	providerId: 'provider.test',
};

test('FetchRegistry registers and unregisters descriptors', () => {
	const registry = new FetchRegistry();
	const journalRegistration = registry.registerJournal(journal);
	const providerRegistration = registry.registerProvider({ id: 'provider.test', ctor: TestFetchProvider });

	assert.equal(registry.getJournal(journal.id), journal);
	assert.deepEqual(registry.getJournals(), [journal]);
	assert.equal(registry.getProviderDescriptor('provider.test')?.ctor, TestFetchProvider);

	journalRegistration.dispose();
	providerRegistration.dispose();

	assert.equal(registry.getJournal(journal.id), undefined);
	assert.equal(registry.getProviderDescriptor('provider.test'), undefined);
});

test('FetchRegistry rejects duplicate descriptor IDs', () => {
	const registry = new FetchRegistry();
	registry.registerJournal(journal);
	registry.registerProvider({ id: 'provider.test', ctor: TestFetchProvider });

	assert.throws(() => registry.registerJournal(journal), /already registered/);
	assert.throws(() => registry.registerProvider({ id: 'provider.test', ctor: TestFetchProvider }), /already registered/);
});

test('FetchRegistry journal results do not depend on registration order', () => {
	const otherJournal: JournalDescriptor = {
		...journal,
		id: 'journal.other',
		title: 'Other Journal',
	};
	const first = new FetchRegistry();
	first.registerJournal(journal);
	first.registerJournal(otherJournal);
	const second = new FetchRegistry();
	second.registerJournal(otherJournal);
	second.registerJournal(journal);

	assert.deepEqual(
		first.getJournals().map(candidate => candidate.id),
		second.getJournals().map(candidate => candidate.id),
	);
});
