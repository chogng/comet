/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import { parseScienceArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceArticleDetailParser';
import { parseScienceCatalog } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCatalogParser';
import { ScienceFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFetchProvider';
import { isScienceCurrentIssue, parseScienceCurrentIssue } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCurrentIssueParser';
import { isScienceFirstRelease, parseScienceFirstRelease } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFirstReleaseParser';
import { scienceArticleDetailFixture, scienceCatalogFixture, scienceCurrentIssueFixture, scienceFirstReleaseFixture } from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science.fixture';

const base = URI.parse('https://www.science.org/toc/science/current');
const journal: JournalDescriptor = { id: 'journal.science.science', title: 'Science', homeUrl: base, discoveryUrl: base, providerId: 'publisher.science' };

function documentFrom(html: string): Document {
	return new JSDOM(html).window.document;
}

test('Science fixtures parse catalog, issue sections, first release, and article detail', () => {
	const catalog = parseScienceCatalog(documentFrom(scienceCatalogFixture), base);
	assert.deepEqual(catalog.entries.map(entry => entry.label), ['Current Issue', 'First Release']);

	const issueDocument = documentFrom(scienceCurrentIssueFixture);
	assert.equal(isScienceCurrentIssue(issueDocument, base), true);
	const issue = parseScienceCurrentIssue(issueDocument, base);
	assert.deepEqual(issue.issue, { volume: '12', issue: '4', publishedAt: '2026-07-10', canonicalUrl: undefined });
	assert.equal(issue.groups[0].label, 'Research');
	assert.equal(issue.groups[0].items[0].articleType, 'Research Article');
	assert.equal(issue.groups[0].items[0].abstract, 'Card abstract');
	assert.equal(issue.groups[0].items[0].relatedArticles[0].title, 'Related science');

	const firstReleaseBase = URI.parse('https://www.science.org/first-release/science');
	const firstReleaseDocument = documentFrom(scienceFirstReleaseFixture);
	assert.equal(isScienceFirstRelease(firstReleaseDocument, firstReleaseBase), true);
	assert.equal(parseScienceFirstRelease(firstReleaseDocument, firstReleaseBase).ungroupedItems[0].articleType, undefined);

	const detail = parseScienceArticleDetail(documentFrom(scienceArticleDetailFixture), base, journal);
	assert.equal(detail.title, 'Science detail');
	assert.equal(detail.authors[0].isCorresponding, undefined);
	assert.equal(detail.editorsSummary, "Editor's summary");
	assert.equal(detail.publication.volume, '12');
});

test('Science canonicalization removes fragments without merging issue queries', () => {
	const provider = new ScienceFetchProvider(undefined as never);
	const page = provider.canonicalizePageUri(URI.parse('HTTPS://WWW.SCIENCE.ORG/toc/science/current?issue=4#contents'));
	assert.equal(page.toString(true), 'https://www.science.org/toc/science/current?issue=4');
	assert.notEqual(
		provider.canonicalizePageUri(URI.parse('https://www.science.org/toc/science/current?issue=4')).toString(true),
		provider.canonicalizePageUri(URI.parse('https://www.science.org/toc/science/current?issue=5')).toString(true),
	);
});
