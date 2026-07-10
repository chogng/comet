/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { ArticleListSource, ArticleRecord, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { IFetchProvider, ParsedArticleDetail, ParsedArticleListCatalog, ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';
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
