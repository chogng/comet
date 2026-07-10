/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { UriComponents } from 'cs/base/common/uri';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleListDiagnostics } from 'cs/workbench/services/fetch/common/fetchDiagnostics';

export interface FetchArticleListPaginationStop {
	readonly reason: string;
	readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export interface FetchArticleListRunResult {
	readonly articles: readonly FetchArticle[];
	readonly candidateAttempted: number;
	readonly candidateResolved: number;
	readonly candidateAccepted: number;
	readonly nextPageUri?: UriComponents;
	readonly paginationStop?: FetchArticleListPaginationStop;
	readonly diagnostics: FetchArticleListDiagnostics;
}
