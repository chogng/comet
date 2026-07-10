/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import type { FetchStatus } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { formatLocaleMessage } from 'cs/workbench/common/errorMessages';

export type BatchFetchStatusbarStatus = {
	statusbarFetchSourceText: string;
	statusbarFetchSourceTitle: string;
	statusbarFetchStopText: string;
	statusbarFetchStopTitle: string;
};

const EMPTY_BATCH_FETCH_STATUSBAR_STATUS: BatchFetchStatusbarStatus = {
	statusbarFetchSourceText: '',
	statusbarFetchSourceTitle: '',
	statusbarFetchStopText: '',
	statusbarFetchStopTitle: '',
};

function resolveFetchSourceText(fetchStatus: FetchStatus, ui: LocaleMessages) {
	if (fetchStatus.phase === 'targetRequired') {
		return ui.statusFetchTargetRequired;
	}
	if (fetchStatus.targetMode === 'webContentsView') {
		return ui.statusFetchTargetWebContentsView;
	}
	return ui.statusFetchTargetBackground;
}

function resolveFetchSourceTitle(fetchStatus: FetchStatus, ui: LocaleMessages) {
	return formatLocaleMessage(ui.statusFetchSourceTitle, {
		source: fetchStatus.sourceId || 'source',
		page: fetchStatus.pageNumber,
	});
}

function resolveFetchStopText(fetchStatus: FetchStatus, ui: LocaleMessages) {
	if (!fetchStatus.paginationStopped) {
		return '';
	}
	return fetchStatus.paginationStopReason === 'tail_dates_before_start_date'
		? ui.statusFetchStopTailDate
		: ui.statusFetchStopExtractor;
}

function resolveFetchStopTitle(fetchStatus: FetchStatus, ui: LocaleMessages) {
	if (!fetchStatus.paginationStopped) {
		return '';
	}
	return formatLocaleMessage(ui.statusFetchStopTitle, {
		source: fetchStatus.sourceId || 'source',
		page: fetchStatus.pageNumber,
		reason: fetchStatus.paginationStopReason || 'extractor_policy',
	});
}

export function resolveBatchFetchStatusbarStatus(
	fetchStatus: FetchStatus | null,
	ui: LocaleMessages,
): BatchFetchStatusbarStatus {
	if (!fetchStatus) {
		return EMPTY_BATCH_FETCH_STATUSBAR_STATUS;
	}

	return {
		statusbarFetchSourceText: resolveFetchSourceText(fetchStatus, ui),
		statusbarFetchSourceTitle: resolveFetchSourceTitle(fetchStatus, ui),
		statusbarFetchStopText: resolveFetchStopText(fetchStatus, ui),
		statusbarFetchStopTitle: resolveFetchStopTitle(fetchStatus, ui),
	};
}
