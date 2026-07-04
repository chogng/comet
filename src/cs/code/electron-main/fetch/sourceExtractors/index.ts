import { natureLatestNewsCandidateExtractor } from 'cs/code/electron-main/fetch/sourceExtractors/latestNews';
import { natureOpinionCandidateExtractor } from 'cs/code/electron-main/fetch/sourceExtractors/nature-opinions';
import { naturePathExtractors } from 'cs/code/electron-main/fetch/sourceExtractors/nature-paths';
import { natureResearchArticlesCandidateExtractor } from 'cs/code/electron-main/fetch/sourceExtractors/nature-research-articles';
import { scienceCurrentNewsInDepthResearchArticlesCandidateExtractor } from 'cs/code/electron-main/fetch/sourceExtractors/science-current-news-in-depth-research-articles';
import { scienceSciadvCurrentPhysicalMaterialsCandidateExtractor } from 'cs/code/electron-main/fetch/sourceExtractors/science-sciadv-current-physical-materials';

import type { ListingCandidateExtractor } from 'cs/code/electron-main/fetch/sourceExtractors/types';

const listingCandidateExtractors: ListingCandidateExtractor[] = [
  scienceCurrentNewsInDepthResearchArticlesCandidateExtractor,
  scienceSciadvCurrentPhysicalMaterialsCandidateExtractor,
  ...naturePathExtractors,
  natureResearchArticlesCandidateExtractor,
  natureLatestNewsCandidateExtractor,
  natureOpinionCandidateExtractor,
];

const listingCandidateExtractorById = new Map(
  listingCandidateExtractors.map((extractor) => [extractor.id, extractor] as const),
);

export function getListingCandidateExtractorById(id: string | null | undefined) {
  const normalizedId = String(id ?? '').trim();
  if (!normalizedId) return null;
  return listingCandidateExtractorById.get(normalizedId) ?? null;
}

export function findListingCandidateExtractor(page: URL, preferredExtractorId?: string | null) {
  const preferredExtractor = getListingCandidateExtractorById(preferredExtractorId);
  if (preferredExtractor?.matches(page)) {
    return preferredExtractor;
  }

  return listingCandidateExtractors.find((extractor) => extractor.matches(page)) ?? null;
}

export type {
  ListingCandidateExtraction,
  ListingCandidateExtractor,
  ListingCandidateExtractorContext,
  ListingCandidateRefinementContext,
  ListingExtractorFetchHtml,
  ListingExtractorFetchHtmlOptions,
  ListingPaginationContext,
  ListingPaginationStopContext,
  ListingPaginationStopEvaluation,
  ListingCandidateSeed,
  ListingDom,
} from 'cs/code/electron-main/fetch/sourceExtractors/types';
export {
  normalizeListingCandidateSeed,
  normalizeListingCandidateSeeds,
} from 'cs/code/electron-main/fetch/sourceExtractors/types';
