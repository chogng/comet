export function planCandidateFetch<TCandidate extends { score: number; order: number }>(
  candidates: TCandidate[],
  {
    extractorId,
    remainingLimit,
    datedCandidateCount,
    inRangeDateHintCount,
    hasDateRangeFilter,
    minCandidateAttempts,
    attemptsPerLimit,
    extractorAttemptsMultiplier,
    extractorAttemptsMinBuffer,
    fastExtractorAttemptsMultiplier,
    fastExtractorAttemptsMinBuffer,
    dateHintHighCoverageThreshold,
    extractorCandidateFetchConcurrency,
    candidateFetchConcurrency,
    retryPriorityMinOrder,
    retryPriorityLimitMultiplier,
  }: {
    extractorId: string | null;
    remainingLimit: number;
    datedCandidateCount: number;
    inRangeDateHintCount: number;
    hasDateRangeFilter: boolean;
    minCandidateAttempts: number;
    attemptsPerLimit: number;
    extractorAttemptsMultiplier: number;
    extractorAttemptsMinBuffer: number;
    fastExtractorAttemptsMultiplier: number;
    fastExtractorAttemptsMinBuffer: number;
    dateHintHighCoverageThreshold: number;
    extractorCandidateFetchConcurrency: number;
    candidateFetchConcurrency: number;
    retryPriorityMinOrder: number;
    retryPriorityLimitMultiplier: number;
  },
) {
  const sortedCandidates = [...candidates].sort((a, b) => {
    if (extractorId) return a.order - b.order;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.order - b.order;
  });
  const prioritizedCandidates = extractorId
    ? sortedCandidates
    : sortedCandidates.filter((candidate) => candidate.score >= -40);
  const candidatesForAttempt = prioritizedCandidates.length > 0 ? prioritizedCandidates : sortedCandidates;
  const defaultAttemptBudget = Math.min(
    candidatesForAttempt.length,
    Math.max(minCandidateAttempts, remainingLimit * attemptsPerLimit),
  );
  const extractorAttemptBudget = Math.min(
    candidatesForAttempt.length,
    Math.max(
      remainingLimit + extractorAttemptsMinBuffer,
      Math.ceil(remainingLimit * extractorAttemptsMultiplier),
    ),
  );
  const fastExtractorAttemptBudget = Math.min(
    candidatesForAttempt.length,
    Math.max(
      remainingLimit + fastExtractorAttemptsMinBuffer,
      Math.ceil(remainingLimit * fastExtractorAttemptsMultiplier),
    ),
  );
  const dateHintCoverageRatio =
    candidates.length > 0 ? Math.min(1, datedCandidateCount / candidates.length) : 0;
  const shouldUseFastExtractorBudget = Boolean(
    extractorId &&
      (!hasDateRangeFilter ||
        (dateHintCoverageRatio >= dateHintHighCoverageThreshold && inRangeDateHintCount >= remainingLimit)),
  );
  const attemptBudgetMode = extractorId
    ? shouldUseFastExtractorBudget
      ? 'extractor_date_aware_fast'
      : 'extractor_capped'
    : 'default';
  const attemptBudget = extractorId
    ? shouldUseFastExtractorBudget
      ? fastExtractorAttemptBudget
      : extractorAttemptBudget
    : defaultAttemptBudget;

  return {
    prioritizedCandidates,
    attemptBudget,
    attemptBudgetMode,
    defaultAttemptBudget,
    extractorAttemptBudget,
    fastExtractorAttemptBudget,
    dateHintCoverageRatio,
    candidatesToFetch: candidatesForAttempt.slice(0, attemptBudget),
    candidateFetchConcurrency: extractorId ? extractorCandidateFetchConcurrency : candidateFetchConcurrency,
    retryEligibleMaxOrder: Math.max(
      retryPriorityMinOrder,
      Math.ceil(remainingLimit * retryPriorityLimitMultiplier),
    ),
  };
}

