/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanText } from 'cs/base/common/strings';

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

export type ListingCandidateSeedInput = {
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
