import { cleanText } from 'cs/base/common/strings';
import { isScienceCurrentTocUrl } from 'cs/base/common/url';

import type {
  ListingCandidateExtraction,
  ListingCandidateExtractor,
  ListingCandidateExtractorContext,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/types';
import {
  ABSTRACT_SELECTOR,
  AUTHORS_SELECTOR,
  CARD_SELECTOR,
  DATE_SELECTOR,
  LINK_SELECTOR,
  normalizeScienceHeading,
  parseScienceCard,
  resolveTocRoot,
  SECTION_HEADING_SELECTOR,
  SECTION_SELECTOR,
  SUBSECTION_HEADING_SELECTOR,
  TITLE_SELECTOR,
  TOC_BODY_SELECTORS,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/science-common';

const SCIENCE_CURRENT_TARGET_SUBSECTIONS = [
  {
    sectionHeading: 'news',
    subsectionHeading: 'in depth',
    articleType: 'In Depth',
  },
  {
    sectionHeading: 'research',
    subsectionHeading: 'research articles',
    articleType: 'Research Articles',
  },
] as const;

type ScienceCurrentTargetSubsection =
  (typeof SCIENCE_CURRENT_TARGET_SUBSECTIONS)[number];

function buildTargetKey(sectionHeading: string, subsectionHeading: string) {
  return `${normalizeScienceHeading(sectionHeading)}::${normalizeScienceHeading(subsectionHeading)}`;
}

function resolveScienceCurrentTargetSubsection(
  sectionHeading: string,
  subsectionHeading: string,
): ScienceCurrentTargetSubsection | null {
  const normalizedSectionHeading = normalizeScienceHeading(sectionHeading);
  const normalizedSubsectionHeading = normalizeScienceHeading(subsectionHeading);
  return (
    SCIENCE_CURRENT_TARGET_SUBSECTIONS.find(
      (target) =>
        target.sectionHeading === normalizedSectionHeading &&
        target.subsectionHeading === normalizedSubsectionHeading,
    ) ?? null
  );
}

function extractScienceCurrentTargetedSubsections(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  const { $, pageUrl } = context;
  const tocBody = resolveTocRoot({ $ });
  if (!tocBody) return null;

  const sections = $(tocBody.root).children(SECTION_SELECTOR).toArray();
  if (sections.length === 0) return null;

  const targetState = new Map(
    SCIENCE_CURRENT_TARGET_SUBSECTIONS.map((target) => [
      buildTargetKey(target.sectionHeading, target.subsectionHeading),
      {
        ...target,
        matched: false,
        sectionIndex: null as number | null,
        sectionHeadingText: '',
        subsectionHeadingText: '',
        cardCount: 0,
        candidateCount: 0,
      },
    ]),
  );

  const seen = new Set<string>();
  const candidates: ListingCandidateExtraction['candidates'] = [];
  let datedCandidateCount = 0;
  let summarizedCandidateCount = 0;
  let totalCardCount = 0;
  let order = 0;

  for (const [sectionIndex, section] of sections.entries()) {
    const sectionHeading = cleanText($(section).children(SECTION_HEADING_SELECTOR).first().text());
    let currentTargetKey = '';

    const children = $(section).children().toArray();
    for (const child of children) {
      const current = $(child);
      if (current.is(SUBSECTION_HEADING_SELECTOR)) {
        const subsectionHeading = cleanText(current.text());
        const matchedTarget = resolveScienceCurrentTargetSubsection(sectionHeading, subsectionHeading);
        currentTargetKey = matchedTarget
          ? buildTargetKey(matchedTarget.sectionHeading, matchedTarget.subsectionHeading)
          : '';

        if (currentTargetKey) {
          const state = targetState.get(currentTargetKey);
          if (state) {
            state.matched = true;
            state.sectionIndex = sectionIndex;
            state.sectionHeadingText = sectionHeading;
            state.subsectionHeadingText = subsectionHeading;
          }
        }
        continue;
      }

      if (!current.is(CARD_SELECTOR) || !currentTargetKey) {
        continue;
      }

      const state = targetState.get(currentTargetKey);
      if (!state) {
        continue;
      }

      state.cardCount += 1;
      totalCardCount += 1;

      const parsedCard = parseScienceCard({
        $,
        root: child,
        pageUrl,
        order,
        articleType: state.articleType,
        scoreBoost: 180,
      });
      if (!parsedCard || seen.has(parsedCard.normalizedUrl)) continue;

      seen.add(parsedCard.normalizedUrl);
      if (parsedCard.hasDateHint) datedCandidateCount += 1;
      if (parsedCard.hasAbstractText) summarizedCandidateCount += 1;
      candidates.push(parsedCard.seed);
      order += 1;
      state.candidateCount += 1;
    }
  }

  const targetSummaries = [...targetState.values()].map((target) => ({
    sectionHeading: target.sectionHeadingText || target.sectionHeading,
    subsectionHeading: target.subsectionHeadingText || target.subsectionHeading,
    matched: target.matched,
    sectionIndex: target.sectionIndex,
    cardCount: target.cardCount,
    candidateCount: target.candidateCount,
    articleType: target.articleType,
  }));

  const allTargetsReady = targetSummaries.every((target) => target.matched && target.candidateCount > 0);
  if (!allTargetsReady || candidates.length === 0) {
    return null;
  }

  const selectedSectionIndices = targetSummaries
    .map((target) => target.sectionIndex)
    .filter((value): value is number => typeof value === 'number');

  return {
    candidates,
    diagnostics: {
      tocBodySelectors: TOC_BODY_SELECTORS,
      tocBodySelector: tocBody.selector,
      tocBodyMatchedRootCount: tocBody.matchedRootCount,
      sectionSelector: SECTION_SELECTOR,
      sectionHeadingSelector: SECTION_HEADING_SELECTOR,
      subsectionHeadingSelector: SUBSECTION_HEADING_SELECTOR,
      selectedSectionIndex:
        selectedSectionIndices.length > 0 ? Math.max(...selectedSectionIndices) : null,
      selectedSectionIndices,
      selectedBy: 'toc-body-target-section-subsection-pairs',
      sectionCount: sections.length,
      targetSubsections: targetSummaries,
      targetSubsectionCount: targetSummaries.length,
      matchedTargetSubsectionCount: targetSummaries.filter((target) => target.matched).length,
      cardSelector: CARD_SELECTOR,
      linkSelector: LINK_SELECTOR,
      titleSelector: TITLE_SELECTOR,
      dateSelector: DATE_SELECTOR,
      abstractSelector: ABSTRACT_SELECTOR,
      authorsSelector: AUTHORS_SELECTOR,
      cardCount: totalCardCount,
      candidateCount: candidates.length,
      datedCandidateCount,
      summarizedCandidateCount,
    },
  };
}

export const scienceCurrentNewsInDepthResearchArticlesCandidateExtractor: ListingCandidateExtractor = {
  id: 'science-current-news-in-depth-research-articles',
  matches: isScienceCurrentListingPage,
  extract(context): ListingCandidateExtraction | null {
    return extractScienceCurrentTargetedSubsections(context);
  },
};

export function isScienceCurrentListingPage(page: URL) {
  return isScienceCurrentTocUrl(page.toString());
}
