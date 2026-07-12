/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';

export const IArticleSummaryTranslationExportService =
	createDecorator<IArticleSummaryTranslationExportService>('articleSummaryTranslationExportService');

export interface IArticleSummaryTranslationExportService {
	readonly _serviceBrand: undefined;
	handleExportArticleSummaries(
		articleIds: readonly ArticleId[],
		translateSummaries: boolean,
		onUnavailableArticleIds: (articleIds: readonly ArticleId[]) => void,
	): Promise<void>;
	dispose(): void;
}
