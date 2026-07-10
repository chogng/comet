import type { BatchSource } from 'cs/base/parts/sandbox/common/sandboxTypes';

export const batchLimitMin = 1;
export const batchLimitMax = 1000;
export const defaultBatchLimit = 50;

// Immutable baseline list so callers can safely clone/reset source config.
const defaultBatchSourceSeed: ReadonlyArray<BatchSource> = [
  {
    id: '1',
    url: 'https://www.science.org/toc/science/current',
    journalTitle: 'Science',
  },
  {
    id: '2',
    url: 'https://www.science.org/toc/sciadv/current',
    journalTitle: 'Science Advances',
  },
  {
    id: '3',
    url: 'https://www.nature.com/latest-news',
    journalTitle: 'News',
  },
  {
    id: '4',
    url: 'https://www.nature.com/opinion',
    journalTitle: 'Opinion',
  },
  {
    id: '5',
    url: 'https://www.nature.com/nature/research-articles',
    journalTitle: 'Research Articles',
  },
  {
    id: '6',
    url: 'https://www.nature.com/natelectron/research-articles',
    journalTitle: 'Nature Electronics',
  },
  {
    id: '7',
    url: 'https://www.nature.com/natmachintell/research-articles',
    journalTitle: 'Nature Machine Intelligence',
  },
  {
    id: '8',
    url: 'https://www.nature.com/ncomms/research-articles',
    journalTitle: 'Nature Communications',
  },
  {
    id: '9',
    url: 'https://www.nature.com/nmat/research-articles',
    journalTitle: 'Nature Materials',
  },
  {
    id: '10',
    url: 'https://www.nature.com/nnano/research-articles',
    journalTitle: 'Nature Nanotechnology',
  },
  {
    id: '11',
    url: 'https://www.nature.com/nphoton/research-articles',
    journalTitle: 'Nature Photonics',
  },
  {
    id: '12',
    url: 'https://www.nature.com/nphys/research-articles',
    journalTitle: 'Nature Physics',
  },
  {
    id: '13',
    url: 'https://www.nature.com/npj2dmateriacs/research-articles',
    journalTitle: 'npj 2D Materials and Applications',
  },
  {
    id: '14',
    url: 'https://www.nature.com/natsynth/research-articles',
    journalTitle: 'Nature Synthesis',
  },
  {
    id: '15',
    url: 'https://www.nature.com/natrevelectreng/reviews-and-analysis',
    journalTitle: 'Nature Reviews Electrical Engineering',
  },
  {
    id: '16',
    url: 'https://www.nature.com/natrevmats/reviews-and-analysis',
    journalTitle: 'Nature Reviews Materials',
  },
  {
    id: '17',
    url: 'https://www.nature.com/natrevphys/reviews-and-analysis',
    journalTitle: 'Nature Reviews Physics',
  },
];

export function getDefaultBatchSources(): BatchSource[] {
  // Return fresh objects to avoid accidental shared mutations in config state.
  return defaultBatchSourceSeed.map((source) => ({
    id: source.id,
    url: source.url,
    journalTitle: source.journalTitle,
  }));
}
