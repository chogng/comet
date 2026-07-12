/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import { isScienceArticleDetail, parseScienceArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceArticleDetailParser';
import { parseScienceCatalog } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCatalogParser';
import { ScienceFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFetchProvider';
import { isScienceCurrentIssue, parseScienceCurrentIssue } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCurrentIssueParser';
import { isScienceFirstRelease, parseScienceFirstRelease } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFirstReleaseParser';
import scienceAdvancesDetailFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-advances-article-detail.html';
import scienceAdvancesCatalogFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-advances-catalog.html';
import scienceAdvancesCurrentIssueFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-advances-current-issue.html';
import scienceAdvancesEmptyCurrentIssueFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-advances-current-issue-empty.html';
import scienceAdvancesFirstReleaseFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-advances-first-release.html';
import scienceAdvancesEmptyFirstReleaseFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-advances-first-release-empty.html';
import scienceDetailFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-article-detail.html';
import scienceCatalogFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-catalog.html';
import scienceCurrentIssueFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-current-issue.html';
import scienceEmptyCurrentIssueFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-current-issue-empty.html';
import scienceFirstReleaseFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-first-release.html';
import scienceEmptyFirstReleaseFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/science/fixtures/science-first-release-empty.html';

const scienceHome = URI.parse('https://www.science.org/journal/science');
const scienceAdvancesHome = URI.parse('https://www.science.org/journal/sciadv');
const scienceIssueBase = URI.parse('https://www.science.org/toc/science/current');
const scienceAdvancesIssueBase = URI.parse('https://www.science.org/toc/sciadv/current');
const scienceFirstReleaseBase = URI.parse('https://www.science.org/first-release/science');
const scienceAdvancesFirstReleaseBase = URI.parse('https://www.science.org/first-release/sciadv');
const scienceJournal: JournalDescriptor = {
	id: 'journal.science.science',
	title: 'Science',
	homeUrl: scienceHome,
	discoveryUrl: scienceHome,
	providerId: 'publisher.science',
};
const scienceAdvancesJournal: JournalDescriptor = {
	id: 'journal.science.science-advances',
	title: 'Science Advances',
	homeUrl: scienceAdvancesHome,
	discoveryUrl: scienceAdvancesHome,
	providerId: 'publisher.science',
};

function documentFrom(html: string): Document {
	return new JSDOM(html).window.document;
}

test('Science and Science Advances saved Catalog fixtures resolve exactly two direct sources', () => {
	assert.deepEqual(parseScienceCatalog(documentFrom(scienceCatalogFixture), scienceHome), {
		entries: [
			{ kind: 'source', label: 'Current Issue', url: scienceIssueBase },
			{ kind: 'source', label: 'First release papers', url: scienceFirstReleaseBase },
		],
	});
	assert.deepEqual(parseScienceCatalog(documentFrom(scienceAdvancesCatalogFixture), scienceAdvancesHome), {
		entries: [
			{ kind: 'source', label: 'Current Issue', url: scienceAdvancesIssueBase },
			{ kind: 'source', label: 'First release papers', url: scienceAdvancesFirstReleaseBase },
		],
	});
});

test('Science saved Current Issue fixture preserves issue, Section, card, and related-article semantics', () => {
	const document = documentFrom(scienceCurrentIssueFixture);
	assert.equal(isScienceCurrentIssue(document, scienceIssueBase), true);
	assert.deepEqual(parseScienceCurrentIssue(document, scienceIssueBase), {
		url: scienceIssueBase,
		issue: {
			volume: '12',
			issue: '28',
			publishedAt: '2026-07-10',
			canonicalUrl: URI.parse('https://www.science.org/toc/science/12/28'),
		},
		groups: [
			{
				label: 'Commentary',
				items: [{
					providerOccurrenceKey: 'commentary-1',
					articleUrl: URI.parse('https://www.science.org/doi/10.1126/science.test'),
					title: 'To eat or to breathe?',
					description: 'In highland mice, oxygen and toxin responses compete.',
					abstract: undefined,
					articleType: 'Perspectives',
					publishedAt: '2026-07-09',
					pageRange: '140-141',
					isOpenAccess: undefined,
					authors: [{ name: 'Grace Hopper' }],
					pdfUrl: URI.parse('https://www.science.org/doi/10.1126/science.test.pdf'),
					relatedArticles: [{
						relationLabel: 'Related Research Article',
						url: URI.parse('https://www.science.org/doi/10.1126/science.related'),
						articleType: 'Research Article',
						title: 'Adaptation across an extreme elevational gradient',
						authors: [{ name: 'Schuyler Liphardt' }],
						journalTitle: 'Science',
						publishedAt: '2026-07-09',
					}],
				}],
			},
			{
				label: 'Research',
				items: [{
					providerOccurrenceKey: 'research-1',
					articleUrl: URI.parse('https://www.science.org/doi/10.1126/science.research'),
					title: 'Science research',
					description: undefined,
					abstract: 'Research abstract',
					articleType: 'Research Article',
					publishedAt: undefined,
					pageRange: undefined,
					isOpenAccess: true,
					authors: [{ name: 'Katherine Johnson' }],
					pdfUrl: undefined,
					relatedArticles: [],
				}],
			},
		],
		ungroupedItems: [],
		nextPageUrl: undefined,
	});
});

test('Science Advances saved Current Issue fixture preserves subject Sections and optional absence', () => {
	const document = documentFrom(scienceAdvancesCurrentIssueFixture);
	assert.equal(isScienceCurrentIssue(document, scienceAdvancesIssueBase), true);
	assert.deepEqual(parseScienceCurrentIssue(document, scienceAdvancesIssueBase), {
		url: scienceAdvancesIssueBase,
		issue: {
			volume: '12',
			issue: '28',
			publishedAt: '2026-07-10',
			canonicalUrl: URI.parse('https://www.science.org/toc/sciadv/12/28'),
		},
		groups: [
			{
				label: 'Focus',
				items: [{
					providerOccurrenceKey: 'focus-1',
					articleUrl: URI.parse('https://www.science.org/doi/10.1126/sciadv.focus'),
					title: 'Communicating coral: Art and science for global reef action',
					description: undefined,
					abstract: undefined,
					articleType: undefined,
					publishedAt: '2026-07-08',
					pageRange: undefined,
					isOpenAccess: true,
					authors: [{ name: 'Mónica Medina' }],
					pdfUrl: undefined,
					relatedArticles: [],
				}],
			},
			{
				label: 'Social and Interdisciplinary Sciences and Public Health',
				items: [{
					providerOccurrenceKey: 'public-health-1',
					articleUrl: URI.parse('https://www.science.org/doi/10.1126/sciadv.public-health'),
					title: 'Nutritional adaptations to early maize cultivation',
					description: 'Carbon amino acid isotopes show early maize provisioning.',
					abstract: undefined,
					articleType: undefined,
					publishedAt: '2026-07-08',
					pageRange: undefined,
					isOpenAccess: true,
					authors: [{ name: 'Nadia C. Neff' }],
					pdfUrl: URI.parse('https://www.science.org/doi/10.1126/sciadv.public-health.pdf'),
					relatedArticles: [],
				}],
			},
			{
				label: 'Neuroscience',
				items: [{
					providerOccurrenceKey: 'neuroscience-1',
					articleUrl: URI.parse('https://www.science.org/doi/10.1126/sciadv.neuroscience'),
					title: 'Parallel anterior cingulate cortex pathways',
					description: undefined,
					abstract: undefined,
					articleType: undefined,
					publishedAt: undefined,
					pageRange: undefined,
					isOpenAccess: undefined,
					authors: [{ name: 'Feidi Wang' }],
					pdfUrl: undefined,
					relatedArticles: [],
				}],
			},
		],
		ungroupedItems: [],
		nextPageUrl: undefined,
	});
});

test('Science and Science Advances saved empty Current Issue fixtures return legal empty pages', () => {
	const fixtures = [
		{
			html: scienceEmptyCurrentIssueFixture,
			base: scienceIssueBase,
			canonicalUrl: URI.parse('https://www.science.org/toc/science/12/29'),
		},
		{
			html: scienceAdvancesEmptyCurrentIssueFixture,
			base: scienceAdvancesIssueBase,
			canonicalUrl: URI.parse('https://www.science.org/toc/sciadv/12/29'),
		},
	] as const;
	for (const fixture of fixtures) {
		const document = documentFrom(fixture.html);
		assert.equal(isScienceCurrentIssue(document, fixture.base), true);
		assert.deepEqual(parseScienceCurrentIssue(document, fixture.base), {
			url: fixture.base,
			issue: {
				volume: '12',
				issue: '29',
				publishedAt: '2026-07-17',
				canonicalUrl: fixture.canonicalUrl,
			},
			groups: [],
			ungroupedItems: [],
			nextPageUrl: undefined,
		});
	}
	assert.equal(isScienceCurrentIssue(documentFrom('<main><h1>Verify your account</h1></main>'), scienceIssueBase), false);
});

test('Science and Science Advances saved First Release fixtures preserve their distinct optional fields', () => {
	const scienceDocument = documentFrom(scienceFirstReleaseFixture);
	assert.equal(isScienceFirstRelease(scienceDocument, scienceFirstReleaseBase), true);
	assert.deepEqual(parseScienceFirstRelease(scienceDocument, scienceFirstReleaseBase), {
		url: scienceFirstReleaseBase,
		groups: [],
		ungroupedItems: [{
			providerOccurrenceKey: 'science-release-1',
			articleUrl: URI.parse('https://www.science.org/doi/10.1126/science.release'),
			title: 'Science first release',
			description: 'Science release description',
			abstract: undefined,
			articleType: 'Research Article',
			publishedAt: '2026-07-12',
			pageRange: undefined,
			isOpenAccess: undefined,
			authors: [{ name: 'Katherine Johnson' }],
			pdfUrl: undefined,
			relatedArticles: [],
		}],
		nextPageUrl: URI.parse('https://www.science.org/first-release/science?page=2'),
	});

	const advancesDocument = documentFrom(scienceAdvancesFirstReleaseFixture);
	assert.equal(isScienceFirstRelease(advancesDocument, scienceAdvancesFirstReleaseBase), true);
	assert.deepEqual(parseScienceFirstRelease(advancesDocument, scienceAdvancesFirstReleaseBase), {
		url: scienceAdvancesFirstReleaseBase,
		groups: [],
		ungroupedItems: [{
			providerOccurrenceKey: 'sciadv-release-1',
			articleUrl: URI.parse('https://www.science.org/doi/10.1126/sciadv.release'),
			title: 'Science Advances first release',
			description: undefined,
			abstract: 'Science Advances release abstract',
			articleType: undefined,
			publishedAt: '2026-07-12',
			pageRange: undefined,
			isOpenAccess: true,
			authors: [{ name: 'Dorothy Vaughan' }],
			pdfUrl: URI.parse('https://www.science.org/doi/10.1126/sciadv.release.pdf'),
			relatedArticles: [],
		}],
		nextPageUrl: undefined,
	});
});

test('Science and Science Advances saved empty First Release fixtures return legal empty pages with strict matching', () => {
	for (const [html, base] of [
		[scienceEmptyFirstReleaseFixture, scienceFirstReleaseBase],
		[scienceAdvancesEmptyFirstReleaseFixture, scienceAdvancesFirstReleaseBase],
	] as const) {
		const document = documentFrom(html);
		assert.equal(isScienceFirstRelease(document, base), true);
		assert.deepEqual(parseScienceFirstRelease(document, base), {
			url: base,
			groups: [],
			ungroupedItems: [],
			nextPageUrl: undefined,
		});
	}
	assert.equal(isScienceFirstRelease(documentFrom('<main><h1>Verify your account</h1></main>'), scienceFirstReleaseBase), false);
	assert.equal(isScienceFirstRelease(documentFrom(scienceFirstReleaseFixture), URI.parse('https://www.science.org/archive/first-release/science')), false);
});

test('Science and Science Advances saved Detail fixtures preserve complete fields and explicit absence', () => {
	const scienceDetailBase = URI.parse('https://www.science.org/doi/10.1126/science.detail');
	const scienceDocument = documentFrom(scienceDetailFixture);
	assert.equal(isScienceArticleDetail(scienceDocument), true);
	assert.deepEqual(parseScienceArticleDetail(scienceDocument, scienceDetailBase, scienceJournal), {
		url: scienceDetailBase,
		doi: '10.1126/science.detail',
		title: 'Science detail',
		description: 'Science detail description',
		editorsSummary: "Editor's summary",
		abstract: 'Science detail abstract',
		articleType: 'Perspective',
		subjects: ['Physics'],
		publishedAt: '2026-07-09',
		isOpenAccess: true,
		authors: [
			{ name: 'Marie Curie', isCorresponding: undefined },
			{ name: 'Chien-Shiung Wu', isCorresponding: true },
		],
		publication: {
			title: 'Science',
			url: undefined,
			volume: '12',
			issue: '28',
			articleNumber: undefined,
			pageRange: '140-141',
			year: 2026,
		},
		pdfUrl: URI.parse('https://www.science.org/doi/pdf/10.1126/science.detail'),
		citationUrl: URI.parse('https://www.science.org/action/showCitFormats?doi=10.1126/science.detail'),
	});

	const advancesDetailBase = URI.parse('https://www.science.org/doi/10.1126/sciadv.detail');
	const advancesDocument = documentFrom(scienceAdvancesDetailFixture);
	assert.equal(isScienceArticleDetail(advancesDocument), true);
	assert.deepEqual(parseScienceArticleDetail(advancesDocument, advancesDetailBase, scienceAdvancesJournal), {
		url: advancesDetailBase,
		doi: '10.1126/sciadv.detail',
		title: 'Improper geometric ferroelectricity at the monolayer limit',
		description: undefined,
		editorsSummary: undefined,
		abstract: 'Science Advances abstract',
		articleType: 'Research Article',
		subjects: ['Materials Science'],
		publishedAt: '2026-07-08',
		isOpenAccess: true,
		authors: [{ name: 'Yilin Evan Li', isCorresponding: undefined }],
		publication: {
			title: 'Science Advances',
			url: undefined,
			volume: '12',
			issue: '28',
			articleNumber: undefined,
			pageRange: undefined,
			year: 2026,
		},
		pdfUrl: URI.parse('https://www.science.org/doi/pdf/10.1126/sciadv.detail'),
		citationUrl: URI.parse('https://www.science.org/action/showCitFormats?doi=10.1126/sciadv.detail'),
	});
	assert.equal(isScienceArticleDetail(documentFrom('<main><h1>Verify your account</h1></main>')), false);
});

test('Science rejects a Current Issue Section containing cards without a label', () => {
	assert.throws(
		() => parseScienceCurrentIssue(documentFrom(`
			<main><section><article data-article-id="unlabeled"><h2><a href="/doi/10.1126/unlabeled">Unlabeled</a></h2></article></section></main>
		`), scienceIssueBase),
		/does not contain a label/,
	);
});

test('Science canonicalization removes fragments without merging issue queries', () => {
	const provider = new ScienceFetchProvider(undefined as never);
	const page = provider.canonicalizePageUri(URI.parse('HTTPS://WWW.SCIENCE.ORG:443/toc/science/current?issue=4&utm_medium=test#contents'));
	assert.equal(page.toString(true), 'https://www.science.org/toc/science/current?issue=4');
	assert.notEqual(
		provider.canonicalizePageUri(URI.parse('https://www.science.org/toc/science/current?issue=4')).toString(true),
		provider.canonicalizePageUri(URI.parse('https://www.science.org/toc/science/current?issue=5')).toString(true),
	);
});
