import { load } from 'cheerio';

import type { DateRange } from 'cs/base/common/date';
import { cleanText } from 'cs/base/common/strings';

export type ListingDom = ReturnType<typeof load>;

export type ListingCandidateSeed = {
  href: string;
  order: number;
  dateHint: string | null;
  articleType: string | null;
  title: string | null;
  doi: string | null;
  authors: string[];
  abstractText: string | null;
  descriptionText: string | null;
  publishedAt: string | null;
  scoreBoost: number | null;
};

export type ListingCandidateExtraction = {
  candidates: ListingCandidateSeed[];
  diagnostics?: Record<string, unknown>;
};

type ListingCandidateSeedInput = {
  href?: unknown;
  order?: unknown;
  dateHint?: unknown;
  articleType?: unknown;
  title?: unknown;
  doi?: unknown;
  authors?: unknown;
  abstractText?: unknown;
  descriptionText?: unknown;
  publishedAt?: unknown;
  scoreBoost?: unknown;
};

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

function normalizeCandidateAuthors(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map((author) => cleanText(author)).filter(Boolean))];
}

export function normalizeListingCandidateSeed(
  value: ListingCandidateSeedInput | null | undefined,
): ListingCandidateSeed | null {
  const href = cleanText(value?.href);
  const order = Number(value?.order);
  if (!href || !Number.isFinite(order)) return null;

  const dateHint = cleanText(value?.dateHint) || null;

  return {
    href,
    order: Math.trunc(order),
    dateHint,
    articleType: cleanText(value?.articleType) || null,
    title: cleanText(value?.title) || null,
    doi: cleanText(value?.doi) || null,
    authors: normalizeCandidateAuthors(value?.authors),
    abstractText: cleanText(value?.abstractText) || null,
    descriptionText: cleanText(value?.descriptionText) || null,
    publishedAt: cleanText(value?.publishedAt) || dateHint,
    scoreBoost: Number.isFinite(value?.scoreBoost) ? Number(value?.scoreBoost) : null,
  };
}

export function normalizeListingCandidateSeeds(
  values: ReadonlyArray<ListingCandidateSeedInput | null | undefined>,
) {
  return values
    .map((value) => normalizeListingCandidateSeed(value))
    .filter((candidate): candidate is ListingCandidateSeed => Boolean(candidate));
}
