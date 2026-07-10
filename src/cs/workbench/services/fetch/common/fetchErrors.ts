/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppError, parseAppErrorData } from 'cs/base/parts/sandbox/common/appError';
import type { AppErrorData } from 'cs/base/parts/sandbox/common/appError';

export const enum FetchErrorCode {
	HttpRequestFailed = 'HTTP_REQUEST_FAILED',
	UnsupportedSite = 'UNSUPPORTED_SITE',
	AmbiguousSite = 'AMBIGUOUS_SITE',
	UnsupportedArticleListSource = 'UNSUPPORTED_ARTICLE_LIST_SOURCE',
	AmbiguousArticleListSource = 'AMBIGUOUS_ARTICLE_LIST_SOURCE',
	UnsupportedArticleListStructure = 'UNSUPPORTED_ARTICLE_LIST_STRUCTURE',
	AmbiguousArticleListStructure = 'AMBIGUOUS_ARTICLE_LIST_STRUCTURE',
	UnsupportedArticleDetailStructure = 'UNSUPPORTED_ARTICLE_DETAIL_STRUCTURE',
	AmbiguousArticleDetailStructure = 'AMBIGUOUS_ARTICLE_DETAIL_STRUCTURE',
	ArticleIdentityStructureConflict = 'ARTICLE_IDENTITY_STRUCTURE_CONFLICT',
	MetadataConflict = 'METADATA_CONFLICT',
	ArticlePageRejected = 'ARTICLE_PAGE_REJECTED',
	ArticleListPageRejected = 'ARTICLE_LIST_PAGE_REJECTED',
	InteractiveTargetTimedOut = 'INTERACTIVE_TARGET_TIMED_OUT',
	InteractiveTargetClosed = 'INTERACTIVE_TARGET_CLOSED',
	BatchPageUrlsEmpty = 'BATCH_PAGE_URLS_EMPTY',
	BatchNoMatchInDateRange = 'BATCH_NO_MATCH_IN_DATE_RANGE',
	BatchNoValidArticles = 'BATCH_NO_VALID_ARTICLES',
	DateRangeInvalid = 'DATE_RANGE_INVALID',
	UnknownError = 'UNKNOWN_ERROR',
}

export type FetchErrorData = AppErrorData & {
	code?: FetchErrorCode | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export class FetchError extends AppError {
	override readonly code: FetchErrorCode;

	constructor(code: FetchErrorCode, details?: Record<string, unknown>) {
		super(code, details);
		this.name = 'FetchError';
		this.code = code;
		Object.setPrototypeOf(this, FetchError.prototype);
	}
}

export function fetchError(code: FetchErrorCode, details?: Record<string, unknown>): FetchError {
	return new FetchError(code, details);
}

export function isFetchError(error: unknown): error is FetchError {
	return error instanceof FetchError || (isRecord(error) && error.name === 'FetchError' && typeof error.code === 'string' && (error.details === undefined || isRecord(error.details)));
}

export function getFetchErrorCode(error: unknown): string {
	if (!isRecord(error)) {
		return '';
	}

	return typeof error.code === 'string' ? error.code : '';
}

export function getFetchErrorDetails(error: unknown): Record<string, unknown> | undefined {
	if (!isRecord(error)) {
		return undefined;
	}

	return isRecord(error.details) ? error.details : undefined;
}

export function parseFetchErrorData(error: unknown): FetchErrorData {
	return parseAppErrorData(error);
}
