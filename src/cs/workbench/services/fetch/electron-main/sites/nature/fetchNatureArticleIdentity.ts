/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type { FetchArticlePublication } from 'cs/base/parts/sandbox/common/fetchPublication';
import type { FetchArticleIdentity } from 'cs/workbench/services/fetch/electron-main/sites/types';
import { resolveNaturePublicationHint } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNaturePublicationResolver';

export interface FetchNatureArticleIdentity extends FetchArticleIdentity {
	readonly pageFamilyHint: 'journalArticle' | 'editorialArticle';
	readonly publicationHint?: FetchArticlePublication;
}

export function resolveNatureArticleIdentity(
	uri: URI,
): FetchNatureArticleIdentity | undefined {
	const match = /^\/articles\/([sd]\d{5}-[^/?#]+)\/?$/i.exec(uri.path);
	if (!match?.[1]) {
		return undefined;
	}
	const articleId = match[1].toLowerCase();
	return {
		articleId,
		pageFamilyHint: articleId.startsWith('s')
			? 'journalArticle'
			: 'editorialArticle',
		doiHint: `10.1038/${articleId}`,
		publicationHint: resolveNaturePublicationHint(articleId),
	};
}
