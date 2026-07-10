/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { UriComponents } from 'cs/base/common/uri';
import type { FetchArticleKind } from 'cs/base/parts/sandbox/common/fetchArticleKind';
import type { FetchArticlePublication } from 'cs/base/parts/sandbox/common/fetchPublication';

export interface FetchArticleAuthor {
	readonly name: string;
	readonly affiliation?: string;
	readonly orcid?: string;
}

export interface FetchArticleSection {
	readonly id?: string;
	readonly title?: string;
	readonly content: string;
	readonly children?: readonly FetchArticleSection[];
}

export interface FetchArticleFigure {
	readonly id?: string;
	readonly title?: string;
	readonly caption?: string;
	readonly imageUrl?: string;
	readonly fullSizeUrl?: string;
}

export interface FetchArticleReference {
	readonly id?: string;
	readonly text: string;
	readonly doi?: string;
	readonly url?: string;
}

export interface FetchArticleCandidate {
	readonly sourceUri: UriComponents;
	readonly articleListSourceId: string;
	readonly publisherArticleIdHint?: string;
	readonly doiHint?: string;
	readonly titleHint?: string;
	readonly publishedAtHint?: string;
	readonly publicationHint?: FetchArticlePublication;
	readonly articleKindHint?: FetchArticleKind;
	readonly sourceArticleTypeHint?: string;
}

export interface FetchArticle {
	readonly sourceUri: UriComponents;
	readonly canonicalUri?: UriComponents;
	readonly publisherArticleId?: string;
	readonly doi?: string;
	readonly title: string;
	readonly publication: FetchArticlePublication;
	readonly articleKind: FetchArticleKind;
	readonly sourceArticleType?: string;
	readonly authors: readonly FetchArticleAuthor[];
	readonly abstract?: string;
	readonly sections: readonly FetchArticleSection[];
	readonly figures: readonly FetchArticleFigure[];
	readonly references: readonly FetchArticleReference[];
	readonly publishedAt?: string;
	readonly receivedAt?: string;
	readonly acceptedAt?: string;
	readonly fetchedAt: string;
	readonly fetchOrder: number;
	readonly articleListSourceId?: string;
}

export function getFetchArticleSourceUri(article: Pick<FetchArticle, 'sourceUri'>): URI {
	return URI.revive(article.sourceUri);
}

export function getFetchArticleSourceUrl(article: Pick<FetchArticle, 'sourceUri'>): string {
	return getFetchArticleSourceUri(article).toString(true);
}

export function getFetchArticleAuthorNames(article: Pick<FetchArticle, 'authors'>): string[] {
	return article.authors.map(author => author.name);
}

function collectSectionText(section: FetchArticleSection, target: string[]): void {
	if (section.title) {
		target.push(section.title);
	}
	if (section.content) {
		target.push(section.content);
	}
	for (const child of section.children ?? []) {
		collectSectionText(child, target);
	}
}

export function getFetchArticleBodyText(article: Pick<FetchArticle, 'sections'>): string {
	const text: string[] = [];
	for (const section of article.sections) {
		collectSectionText(section, text);
	}
	return text.join('\n\n');
}
