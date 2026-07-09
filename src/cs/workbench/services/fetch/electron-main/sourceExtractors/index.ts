import { natureLatestNewsCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/latestNews';
import { natureOpinionCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-opinions';
import { naturePathExtractors } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-paths';
import { natureResearchArticlesCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-research-articles';
import { scienceCurrentNewsInDepthResearchArticlesCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/science-current-news-in-depth-research-articles';
import { scienceSciadvCurrentPhysicalMaterialsCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/science-sciadv-current-physical-materials';

import type { ListingCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';

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
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
export {
  normalizeListingCandidateSeed,
  normalizeListingCandidateSeeds,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
