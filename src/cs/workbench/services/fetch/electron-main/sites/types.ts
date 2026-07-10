/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import type { DateRange } from 'cs/base/common/date';
import type {
  ListingCandidateExtraction,
} from 'cs/platform/browserView/common/listingCandidates';
export {
  normalizeListingCandidateSeed,
  normalizeListingCandidateSeeds,
} from 'cs/platform/browserView/common/listingCandidates';
export type {
  ListingCandidateExtraction,
  ListingCandidateSeed,
} from 'cs/platform/browserView/common/listingCandidates';

export type ListingDom = ReturnType<typeof load>;

export type ListingCandidateExtractorContext = {
  page: URL;
  pageUrl: string;
  $: ListingDom;
};

export type ListingPaginationContext = ListingCandidateExtractorContext & {
  seenPageUrls?: ReadonlySet<string>;
};

export type ListingExtractorFetchHtmlOptions = {
  timeoutMs?: number;
  traceId?: string;
  stage?: string;
  signal?: AbortSignal;
};

export type ListingExtractorFetchHtml = (
  url: string,
  options?: ListingExtractorFetchHtmlOptions,
) => Promise<string>;

export type ListingCandidateRefinementContext = ListingCandidateExtractorContext & {
  pageNumber: number;
  traceId: string;
  dateRange: DateRange;
  extraction: ListingCandidateExtraction;
  fetchHtml: ListingExtractorFetchHtml;
};

export type ListingPaginationStopEvaluation = {
  shouldStop: boolean;
  reason?: string;
  diagnostics?: Record<string, unknown>;
};

export type ListingPaginationStopContext = {
  page: URL;
  pageUrl: string;
  pageNumber: number;
  dateRange: DateRange;
  extraction: ListingCandidateExtraction;
};

export interface ListingCandidateExtractor {
  id: string;
  matches(page: URL): boolean;
  extract(context: ListingCandidateExtractorContext): ListingCandidateExtraction | null;
  findNextPageUrl?(context: ListingPaginationContext): string | null;
  refineExtraction?(
    context: ListingCandidateRefinementContext,
  ): Promise<ListingCandidateExtraction | null> | ListingCandidateExtraction | null;
  evaluatePaginationStop?(
    context: ListingPaginationStopContext,
  ): ListingPaginationStopEvaluation | null;
}

export interface FetchSiteProvider {
	id: string;
	matches(page: URL): boolean;
	readonly listingCandidateExtractors: readonly ListingCandidateExtractor[];
}
