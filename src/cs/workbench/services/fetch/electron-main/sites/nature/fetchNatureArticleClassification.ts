/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchArticleKind } from 'cs/base/parts/sandbox/common/fetchArticleKind';
import type { FetchArticlePublication } from 'cs/base/parts/sandbox/common/fetchPublication';

export interface FetchArticleClassification {
	readonly publication: FetchArticlePublication;
	readonly articleKind: FetchArticleKind;
	readonly sourceArticleType?: string;
	readonly evidence: readonly string[];
}

const kindPatterns: readonly [RegExp, FetchArticleKind][] = [
	[/^(?:article|research|research article|original article)$/i, 'researchArticle'],
	[/\breview\b/i, 'reviewArticle'],
	[/^news\s*&\s*views$/i, 'newsAndViews'],
	[/^(?:news feature|feature)$/i, 'feature'],
	[/^(?:news|news explainer|research highlight)$/i, 'news'],
	[/^(?:editorial)$/i, 'editorial'],
	[/^(?:world view|opinion)$/i, 'opinion'],
	[/^(?:comment|commentary)$/i, 'commentary'],
	[/^perspective$/i, 'perspective'],
	[/\bprotocol\b/i, 'protocol'],
	[/^(?:correction|author correction|publisher correction|erratum)$/i, 'correction'],
];

export function classifyNatureArticle(
	publication: FetchArticlePublication,
	sourceArticleType: string | undefined,
	pageFamily: 'journalArticle' | 'editorialArticle',
): FetchArticleClassification {
	const normalizedType = sourceArticleType?.trim();
	const matchedKind = normalizedType
		? kindPatterns.find(([pattern]) => pattern.test(normalizedType))?.[1]
		: undefined;
	const articleKind = matchedKind ?? 'other';
	return {
		publication,
		articleKind,
		sourceArticleType: normalizedType || undefined,
		evidence: normalizedType
			? [`sourceArticleType:${normalizedType}`, `articleKind:${articleKind}`]
			: [`pageFamily:${pageFamily}`, `articleKind:${articleKind}`],
	};
}
