/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	defaultFetchLimit,
	fetchLimitMax,
	fetchLimitMin,
} from 'cs/platform/configuration/common/fetchLimits';

export {
	defaultFetchLimit,
	fetchLimitMax,
	fetchLimitMin,
};

export const defaultBatchLimit = defaultFetchLimit;
export const batchLimitMax = fetchLimitMax;
export const batchLimitMin = fetchLimitMin;

export function normalizeFetchLimit(input: unknown, fallback: number = defaultFetchLimit): number {
	const parsed = Number.parseInt(String(input), 10);
	if (Number.isNaN(parsed)) {
		return fallback;
	}
	return Math.min(fetchLimitMax, Math.max(fetchLimitMin, parsed));
}

export const normalizeBatchLimit = normalizeFetchLimit;
