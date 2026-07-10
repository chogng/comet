/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const natureCatalogFixture = `
	<main>
		<section>
			<h2>Research articles</h2>
			<a href="/nature/articles">Article</a>
			<a href="/nature/matters-arising">Matters Arising</a>
			<a href="/nature/videos">Videos</a>
		</section>
	</main>
`;

export const natureArticleListFixture = `
	<main>
		<article data-test="article-card">
			<h2><a href="/articles/s41586-026-00001">Nature article</a></h2>
			<p class="c-card__summary">Article description</p>
			<span class="c-meta__type">Article</span>
			<time>2026-07-10</time>
			<span data-test="author-name">Ada Lovelace</span>
		</article>
	</main>
`;

export const natureArticleListCatalogFixture = `
	<main>
		<h1>Research articles</h1>
		<article data-test="article-card">
			<h2><a href="/articles/s41586-026-00001">Nature article</a></h2>
		</article>
	</main>
`;

export const natureNewsOpinionListFixture = `
	<main>
		<h1>News</h1>
		<div data-test="news-opinion-list">
			<article data-test="news-card">
				<h2><a href="/articles/d41586-026-00001">News article</a></h2>
				<p class="c-card__summary">News description</p>
			</article>
		</div>
	</main>
`;

export const natureArticleDetailFixture = `
	<main>
		<h1>Nature detail</h1>
		<meta name="citation_doi" content="10.1038/test" />
		<meta name="citation_journal_title" content="Nature" />
		<p class="article__teaser">Detail description</p>
		<div id="Abs1-content">Detail abstract</div>
		<span class="c-article-identifiers__type">Article</span>
		<ul class="c-article-subject-list"><li><a>Genetics</a></li></ul>
		<span data-test="author-name">Ada Lovelace</span>
		<a href="/articles/s41586-026-00001.pdf">PDF</a>
	</main>
`;
