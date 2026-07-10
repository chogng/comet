/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Article } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { isWithinDateRange } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { ArticleFetchService } from 'cs/workbench/services/fetch/electron-main/articleFetchService';
import type { FetchTargetSession } from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';
import type {
	FetchStatusUpdate,
	PageFetchResult,
} from 'cs/workbench/services/fetch/electron-main/sourcePageFetchTypes';

function createTargetReadyStatus(
	targetSession: FetchTargetSession,
	articleProof: FetchStatusUpdate['articleProof'],
): FetchStatusUpdate {
	if (targetSession.targetMode === 'webContentsView' && targetSession.targetId) {
		return {
			phase: 'targetReady',
			targetMode: 'webContentsView',
			targetId: targetSession.targetId,
			articleProof,
		};
	}

	return {
		phase: 'loading',
		targetMode: 'background',
		targetId: targetSession.targetId,
		articleProof,
	};
}

export async function fetchDetail({
	sourceId,
	pageUrl,
	journalTitle,
	remainingLimit,
	dateRange,
	targetSession,
	articleFetchService,
	reportFetchStatus,
	backgroundTimeoutMs,
	webContentsViewTimeoutMs,
}: {
	sourceId: string;
	pageUrl: string;
	journalTitle: string;
	remainingLimit: number;
	dateRange: DateRange;
	targetSession: FetchTargetSession;
	articleFetchService: ArticleFetchService;
	reportFetchStatus: (status: FetchStatusUpdate) => void;
	backgroundTimeoutMs: number;
	webContentsViewTimeoutMs: number;
}): Promise<PageFetchResult> {
	const fetched: Article[] = [];
	const result = await articleFetchService.fetch({
		pageUrl,
		targetSession,
		backgroundTimeoutMs,
		webContentsViewTimeoutMs,
	});
	reportFetchStatus(createTargetReadyStatus(targetSession, result.proof));

	if (isWithinDateRange(result.article.publishedAt, dateRange) && remainingLimit > 0) {
		result.article.sourceId = sourceId;
		if (journalTitle) {
			result.article.journalTitle = journalTitle;
		}
		fetched.push(result.article);
	}

	return {
		targetMode: targetSession.targetMode,
		articles: fetched,
		candidateAttempted: 0,
		candidateResolved: fetched.length,
		candidateAccepted: fetched.length,
		usedPageOnly: true,
		nextPageUrl: null,
		stoppedByDateHint: false,
	};
}
