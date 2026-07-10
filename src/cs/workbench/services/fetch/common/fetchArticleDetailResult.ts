/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import type { FetchArticleDetailDiagnostics } from 'cs/workbench/services/fetch/common/fetchDiagnostics';

export interface FetchArticleDetailFetchResult {
	readonly article: FetchArticle;
	readonly proof: FetchArticleProof;
	readonly diagnostics: FetchArticleDetailDiagnostics;
}
