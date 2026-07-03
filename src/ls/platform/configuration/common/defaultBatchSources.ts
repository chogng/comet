import type { BatchSource } from 'ls/base/parts/sandbox/common/sandboxTypes';

export const batchLimitMin = 1;
export const batchLimitMax = 100;
export const defaultBatchLimit = 50;

// Immutable baseline list so callers can safely clone/reset source config.
const defaultBatchSourceSeed: ReadonlyArray<BatchSource> = [
  {
    id: '1',
    url: 'https://www.science.org/toc/science/current',
    journalTitle: 'Science',
    preferredExtractorId: 'science-current-news-in-depth-research-articles',
  },
  {
    id: '2',
    url: 'https://www.science.org/toc/sciadv/current',
    journalTitle: 'Science Advances',
    preferredExtractorId: 'science-sciadv-current-physical-materials',
  },
  {
    id: '3',
    url: 'https://www.nature.com/latest-news',
    journalTitle: 'News',
    preferredExtractorId: 'nature-latest-news',
  },
  {
    id: '4',
    url: 'https://www.nature.com/opinion',
    journalTitle: 'Opinion',
    preferredExtractorId: 'nature-opinion',
  },
  {
    id: '5',
    url: 'https://www.nature.com/nature/research-articles',
    journalTitle: 'Research Articles',
    preferredExtractorId: 'nature-research-articles',
  },
  {
    id: '6',
    url: 'https://www.nature.com/natelectron/research-articles',
    journalTitle: 'Nature Electronics',
    preferredExtractorId: 'nature-natelectron-research-articles',
  },
  {
    id: '7',
    url: 'https://www.nature.com/natmachintell/research-articles',
    journalTitle: 'Nature Machine Intelligence',
    preferredExtractorId: 'nature-natmachintell-research-articles',
  },
  {
    id: '8',
    url: 'https://www.nature.com/ncomms/research-articles',
    journalTitle: 'Nature Communications',
    preferredExtractorId: 'nature-ncomms-research-articles',
  },
  {
    id: '9',
    url: 'https://www.nature.com/nmat/research-articles',
    journalTitle: 'Nature Materials',
    preferredExtractorId: 'nature-nmat-research-articles',
  },
  {
    id: '10',
    url: 'https://www.nature.com/nnano/research-articles',
    journalTitle: 'Nature Nanotechnology',
    preferredExtractorId: 'nature-nnano-research-articles',
  },
  {
    id: '11',
    url: 'https://www.nature.com/nphoton/research-articles',
    journalTitle: 'Nature Photonics',
    preferredExtractorId: 'nature-nphoton-research-articles',
  },
  {
    id: '12',
    url: 'https://www.nature.com/nphys/research-articles',
    journalTitle: 'Nature Physics',
    preferredExtractorId: 'nature-nphys-research-articles',
  },
  {
    id: '13',
    url: 'https://www.nature.com/npj2dmaterials/research-articles',
    journalTitle: 'npj 2D Materials and Applications',
    preferredExtractorId: 'nature-npj2dmaterials-research-articles',
  },
  {
    id: '14',
    url: 'https://www.nature.com/natsynth/research-articles',
    journalTitle: 'Nature Synthesis',
    preferredExtractorId: 'nature-natsynth-research-articles',
  },
  {
    id: '15',
    url: 'https://www.nature.com/natrevelectreng/reviews-and-analysis',
    journalTitle: 'Nature Reviews Electrical Engineering',
    preferredExtractorId: 'nature-natrevelectreng-reviews-and-analysis',
  },
  {
    id: '16',
    url: 'https://www.nature.com/natrevmats/reviews-and-analysis',
    journalTitle: 'Nature Reviews Materials',
    preferredExtractorId: 'nature-natrevmats-reviews-and-analysis',
  },
  {
    id: '17',
    url: 'https://www.nature.com/natrevphys/reviews-and-analysis',
    journalTitle: 'Nature Reviews Physics',
    preferredExtractorId: 'nature-natrevphys-reviews-and-analysis',
  },
  {
    id: '18',
    url: 'https://arxiv.org/list/cs/new',
    journalTitle: 'arXiv Computer Science',
  },
];

export function getDefaultBatchSources(): BatchSource[] {
  // Return fresh objects to avoid accidental shared mutations in config state.
  return defaultBatchSourceSeed.map((source) => ({
    id: source.id,
    url: source.url,
    journalTitle: source.journalTitle,
    // Persist explicit null for downstream serializers that do not keep `undefined`.
    preferredExtractorId: source.preferredExtractorId ?? null,
  }));
}
