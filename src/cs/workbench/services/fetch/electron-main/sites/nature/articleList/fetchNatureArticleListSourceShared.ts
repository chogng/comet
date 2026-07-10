/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { FetchArticleListPaginationPolicy } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const natureNextLinkPaginationPolicy: FetchArticleListPaginationPolicy = {
	kind: 'nextLink',
	findNextPageUri(context) {
		const href = context.$(
			[
				'nav[aria-label*="pagination" i] [data-test="page-next"] > a[href]',
				'.c-pagination [data-test="page-next"] > a[href]',
				'.c-pagination [data-page="next"] > a[href]',
			].join(', '),
		).first().attr('href');
		if (!href) {
			return undefined;
		}
		const currentUrl = new URL(context.sourceUri.toString(true));
		const nextUrl = new URL(href, currentUrl);
		const currentPage = Number.parseInt(currentUrl.searchParams.get('page') ?? '1', 10);
		const nextPage = Number.parseInt(nextUrl.searchParams.get('page') ?? '', 10);
		const uri = URI.parse(nextUrl.toString());
		if (
			!matchesNatureAuthority(uri) ||
			uri.path.replace(/\/+$/, '') !== context.sourceUri.path.replace(/\/+$/, '') ||
			!Number.isFinite(currentPage) ||
			!Number.isFinite(nextPage) ||
			nextPage <= currentPage
		) {
			return undefined;
		}
		return uri;
	},
	evaluateStop(context) {
		if (!context.dateRange.start) {
			return undefined;
		}
		const dateHints = context.candidates
			.map(candidate => candidate.publishedAtHint)
			.filter((value): value is string => value !== undefined);
		const datedCoverage = context.candidates.length > 0
			? dateHints.length / context.candidates.length
			: 0;
		const tailDateHints = dateHints.slice(-3);
		const tailIsNonIncreasing = tailDateHints.every(
			(value, index) => index === 0 || value <= tailDateHints[index - 1],
		);
		const tailAllBeforeStartDate = tailDateHints.every(
			value => value < context.dateRange.start!,
		);
		if (
			tailDateHints.length < 3 ||
			datedCoverage < 0.5 ||
			!tailIsNonIncreasing ||
			!tailAllBeforeStartDate
		) {
			return undefined;
		}
		return {
			shouldStop: true,
			reason: 'articleListTailDatesBeforeStartDate',
			diagnostics: {
				candidateCount: context.candidates.length,
				datedCandidateCount: dateHints.length,
				datedCoverage,
				tailDateHints,
				startDate: context.dateRange.start,
			},
		};
	},
};

export function matchesNatureAuthority(uri: URI): boolean {
	const authority = uri.authority.toLowerCase();
	return authority === 'nature.com' || authority.endsWith('.nature.com');
}
