import { isNatureListingPage } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-listing-shared';
import { createNatureResearchArticlesCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/nature-research-articles';

import type { ListingCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';

type NaturePathDef = {
  id: string;
  path: string;
};

const NATURE_PATHS: readonly NaturePathDef[] = [
  { id: 'nature-natelectron-research-articles', path: '/natelectron/research-articles' },
  { id: 'nature-ncomms-research-articles', path: '/ncomms/research-articles' },
  { id: 'nature-natmachintell-research-articles', path: '/natmachintell/research-articles' },
  { id: 'nature-natrevelectreng-reviews-and-analysis', path: '/natrevelectreng/reviews-and-analysis' },
  { id: 'nature-natrevmats-reviews-and-analysis', path: '/natrevmats/reviews-and-analysis' },
  { id: 'nature-natrevphys-reviews-and-analysis', path: '/natrevphys/reviews-and-analysis' },
  { id: 'nature-nmat-research-articles', path: '/nmat/research-articles' },
  { id: 'nature-nnano-research-articles', path: '/nnano/research-articles' },
  { id: 'nature-npj2dmateriacs-research-articles', path: '/npj2dmateriacs/research-articles' },
  { id: 'nature-nphoton-research-articles', path: '/nphoton/research-articles' },
  { id: 'nature-nphys-research-articles', path: '/nphys/research-articles' },
  { id: 'nature-natsynth-research-articles', path: '/natsynth/research-articles' },
] as const;

function createNaturePathExtractor({
  id,
  path,
}: NaturePathDef): ListingCandidateExtractor {
  return createNatureResearchArticlesCandidateExtractor({
    id,
    matches(page) {
      return isNatureListingPage(page, path);
    },
  });
}

export const naturePathExtractors = NATURE_PATHS.map(createNaturePathExtractor);
