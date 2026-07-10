/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type {
	ArticleGroupId,
	ArticleId,
	ArticleListItemId,
	ArticleListSourceId,
	ArticlePageId,
	JournalId,
} from 'cs/workbench/services/fetch/common/fetch';

function encodeUri(uri: URI): string {
	return encodeURIComponent(uri.toString(true));
}

export function createArticleListSourceId(journalId: JournalId, canonicalSourceUri: URI): ArticleListSourceId {
	return `source:${journalId}:${encodeUri(canonicalSourceUri)}`;
}

export function createArticlePageId(sourceId: ArticleListSourceId, canonicalPageUri: URI): ArticlePageId {
	return `page:${sourceId}:${encodeUri(canonicalPageUri)}`;
}

export function createArticleGroupId(pageId: ArticlePageId, groupIndex: number): ArticleGroupId {
	if (!Number.isSafeInteger(groupIndex) || groupIndex < 0) {
		throw new RangeError('Article group index must be a non-negative integer.');
	}
	return `group:${pageId}:${groupIndex}`;
}

export function createArticleId(journalId: JournalId, canonicalArticleUri: URI): ArticleId {
	return `article:${journalId}:${encodeUri(canonicalArticleUri)}`;
}

export function createArticleListItemId(pageId: ArticlePageId, articleId: ArticleId, providerOccurrenceKey: string): ArticleListItemId {
	if (!providerOccurrenceKey) {
		throw new Error('Article list item occurrence key must not be empty.');
	}
	return `item:${pageId}:${articleId}:${encodeURIComponent(providerOccurrenceKey)}`;
}
