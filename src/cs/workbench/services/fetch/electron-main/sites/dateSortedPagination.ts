/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  ListingPaginationStopContext,
  ListingPaginationStopEvaluation,
} from 'cs/workbench/services/fetch/electron-main/sites/types';
import { hasDateRangeStart } from 'cs/base/common/date';

const DEFAULT_TAIL_WINDOW = 3;
const DEFAULT_MIN_DATED_COVERAGE = 0.5;

type DateSortedPaginationStopOptions = {
  tailWindow?: number;
  minTailCount?: number;
  minDatedCoverage?: number;
  reason?: string;
};

function isNonIncreasing(values: string[]) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) {
      return false;
    }
  }

  return true;
}

function hasDateHint<T extends { dateHint?: string | null }>(
  candidate: T,
): candidate is T & { dateHint: string } {
  return typeof candidate.dateHint === 'string' && candidate.dateHint.length > 0;
}

export function createDateSortedPaginationStopEvaluator({
  tailWindow = DEFAULT_TAIL_WINDOW,
  minTailCount = tailWindow,
  minDatedCoverage = DEFAULT_MIN_DATED_COVERAGE,
  reason = 'tail_dates_before_start_date',
}: DateSortedPaginationStopOptions = {}) {
  return function evaluateDateSortedPaginationStop({
    pageNumber,
    dateRange,
    extraction,
  }: ListingPaginationStopContext): ListingPaginationStopEvaluation | null {
    if (!hasDateRangeStart(dateRange)) {
      return null;
    }

    const candidates = Array.isArray(extraction.candidates) ? extraction.candidates : [];
    if (candidates.length === 0) {
      return null;
    }

    const orderedDateHints = candidates
      .filter(hasDateHint)
      .sort((left, right) => left.order - right.order)
      .map((candidate) => candidate.dateHint);

    if (orderedDateHints.length < minTailCount) {
      return null;
    }

    const datedCoverage =
      candidates.length > 0 ? orderedDateHints.length / candidates.length : 0;
    const tailDateHints = orderedDateHints.slice(-Math.max(tailWindow, minTailCount));
    const tailIsDescending = isNonIncreasing(tailDateHints);
    const tailAllOlderThanStartDate = tailDateHints.every((value) => value < dateRange.start);

    if (!tailIsDescending || !tailAllOlderThanStartDate || datedCoverage < minDatedCoverage) {
      return {
        shouldStop: false,
        diagnostics: {
          pageNumber,
          startDate: dateRange.start,
          candidateCount: candidates.length,
          datedCandidateCount: orderedDateHints.length,
          datedCoverage,
          tailDateHints,
          tailIsDescending,
          tailAllOlderThanStartDate,
          minDatedCoverage,
        },
      };
    }

    return {
      shouldStop: true,
      reason,
      diagnostics: {
        pageNumber,
        startDate: dateRange.start,
        candidateCount: candidates.length,
        datedCandidateCount: orderedDateHints.length,
        datedCoverage,
        tailDateHints,
        tailWindow: tailDateHints.length,
        minDatedCoverage,
      },
    };
  };
}
