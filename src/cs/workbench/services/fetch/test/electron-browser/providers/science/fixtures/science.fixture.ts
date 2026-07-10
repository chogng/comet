/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const scienceCatalogFixture = `
	<main>
		<a href="/toc/science/current">Current Issue</a>
		<a href="/first-release/science">First Release</a>
	</main>
`;

export const scienceCurrentIssueFixture = `
	<main>
		<div class="issue-metadata">Volume 12, Issue 4</div>
		<time>2026-07-10</time>
		<section>
			<h2>Research</h2>
			<article data-article-id="research-1" data-access="open">
				<h2><a href="/doi/10.1126/science.test">Science research</a></h2>
				<span class="description">Card description</span>
				<span class="abstract-content">Card abstract</span>
				<span class="article-type">Research Article</span>
				<span rel="author">Grace Hopper</span>
				<a href="/doi/10.1126/science.test.pdf">PDF</a>
				<div data-related-article>
					<span class="relation-label">Related Research Article</span>
					<a href="/doi/10.1126/science.related">Related science</a>
				</div>
			</article>
		</section>
	</main>
`;

export const scienceFirstReleaseFixture = `
	<main>
		<article data-article-id="release-1">
			<h2><a href="/doi/10.1126/science.release">First release</a></h2>
			<span rel="author">Katherine Johnson</span>
		</article>
	</main>
`;

export const scienceArticleDetailFixture = `
	<main>
		<h1>Science detail</h1>
		<meta name="citation_doi" content="10.1126/science.detail" />
		<meta name="citation_journal_title" content="Science" />
		<meta name="citation_volume" content="12" />
		<meta name="citation_issue" content="4" />
		<span class="article-type">Perspective</span>
		<div class="editors-summary">Editor's summary</div>
		<div class="abstract-content">Detail abstract</div>
		<span class="subject"><a>Physics</a></span>
		<span rel="author" href="#con3">Marie Curie</span>
		<a href="/doi/10.1126/science.detail.pdf">PDF</a>
	</main>
`;
