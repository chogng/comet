import { isWithinDateRange } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { isLikelyStaticResourcePath } from 'cs/workbench/services/fetch/electron-main/articleUrlRules';
import { scoreCandidate } from 'cs/workbench/services/fetch/electron-main/listing/scoring';

export type ListingCandidateSeed = {
  href: string | null;
  order: number;
  dateHint: string | null;
  articleType?: string | null;
  title?: string | null;
  doi?: string | null;
  authors?: string[];
  abstractText?: string | null;
  descriptionText?: string | null;
  publishedAt?: string | null;
  scoreBoost?: number | null;
};

export type ListingCandidateDescriptor = {
  url: string;
  score: number;
  order: number;
  dateHint: string | null;
  articleType: string | null;
  title: string | null;
  doi: string | null;
  authors: string[];
  abstractText: string | null;
  descriptionText: string | null;
  publishedAt: string | null;
};

export type ListingCandidateCollection = {
  candidates: ListingCandidateDescriptor[];
  linkCount: number;
  datedCandidateCount: number;
  inRangeDateHintCount: number;
  dateFilteredCount: number;
  stoppedByDateHint: boolean;
  sortedDateHintsObserved: boolean;
  consecutiveOlderDateHints: number;
  stopDateHint: string | null;
};

export function collectCandidateDescriptorsFromSeeds(
  page: URL,
  pageUrl: string,
  dateRange: DateRange,
  seeds: ListingCandidateSeed[],
  {
    inRangeDateHintScoreBoost,
    minSortedDateHintsForEarlyStop,
    minConsecutiveOlderDateHintsForEarlyStop,
  }: {
    inRangeDateHintScoreBoost: number;
    minSortedDateHintsForEarlyStop: number;
    minConsecutiveOlderDateHintsForEarlyStop: number;
  },
): ListingCandidateCollection {
  const candidates: ListingCandidateDescriptor[] = [];
  const seen = new Set<string>();
  let datedCandidateCount = 0;
  let dateFilteredCount = 0;
  let inRangeDateHintCount = 0;
  let sortedDateHintsObserved = true;
  let lastDateHint: string | null = null;
  let consecutiveOlderDateHints = 0;
  let stoppedByDateHint = false;
  let stopDateHint: string | null = null;

  for (const seed of seeds) {
    const href = seed.href;
    if (!href) continue;

    try {
      const candidateUrl = new URL(href, pageUrl);
      if (!/^https?:$/i.test(candidateUrl.protocol)) continue;
      if (candidateUrl.host !== page.host) continue;
      if (isLikelyStaticResourcePath(candidateUrl.pathname)) continue;
      candidateUrl.hash = '';

      const normalized = candidateUrl.toString();
      if (seen.has(normalized)) continue;

      const dateHint = seed.dateHint ?? null;
      const publishedAt = seed.publishedAt ?? dateHint;
      if (dateHint) {
        datedCandidateCount += 1;
        if (lastDateHint && dateHint > lastDateHint) {
          sortedDateHintsObserved = false;
        }
        lastDateHint = dateHint;

        if (isWithinDateRange(dateHint, dateRange)) {
          inRangeDateHintCount += 1;
          consecutiveOlderDateHints = 0;
        } else {
          dateFilteredCount += 1;
          if (dateRange.start && dateHint < dateRange.start) {
            consecutiveOlderDateHints += 1;
          } else {
            consecutiveOlderDateHints = 0;
          }
          if (
            dateRange.start &&
            dateHint < dateRange.start &&
            sortedDateHintsObserved &&
            datedCandidateCount >= minSortedDateHintsForEarlyStop &&
            inRangeDateHintCount > 0 &&
            consecutiveOlderDateHints >= minConsecutiveOlderDateHintsForEarlyStop
          ) {
            stoppedByDateHint = true;
            stopDateHint = dateHint;
            break;
          }
          continue;
        }
      }

      seen.add(normalized);
      let score = scoreCandidate(page, normalized) + Math.max(0, Number(seed.scoreBoost ?? 0) || 0);
      if (dateHint && (dateRange.start || dateRange.end) && isWithinDateRange(dateHint, dateRange)) {
        score += inRangeDateHintScoreBoost;
      }
      candidates.push({
        url: normalized,
        score,
        order: seed.order,
        dateHint,
        articleType: seed.articleType ?? null,
        title: seed.title ?? null,
        doi: seed.doi ?? null,
        authors: seed.authors ?? [],
        abstractText: seed.abstractText ?? null,
        descriptionText: seed.descriptionText ?? null,
        publishedAt,
      });
    } catch {
      continue;
    }
  }

  return {
    candidates,
    linkCount: seeds.length,
    datedCandidateCount,
    inRangeDateHintCount,
    dateFilteredCount,
    stoppedByDateHint,
    sortedDateHintsObserved,
    consecutiveOlderDateHints,
    stopDateHint,
  };
}

