import { cleanText } from 'cs/base/common/strings';
import { isScienceSciadvCurrentTocUrl } from 'cs/base/common/url';

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
  TITLE_SELECTOR,
  TOC_BODY_SELECTORS,
} from 'cs/workbench/services/fetch/electron-main/sourceExtractors/science-common';

const SCIENCE_SCIADV_TARGET_HEADING = 'physical and materials sciences';
const SCIENCE_SCIADV_FIXED_SECTION_INDEX = 3;
const SCIENCE_SCIADV_ARTICLE_TYPE = 'Physical and Materials Sciences';

function matchesTargetHeading(value: unknown) {
  const normalized = normalizeScienceHeading(value);
  if (!normalized) return false;
  return normalized === SCIENCE_SCIADV_TARGET_HEADING || normalized.includes(SCIENCE_SCIADV_TARGET_HEADING);
}

function resolveScienceSciadvTargetSection({
  $,
}: Pick<ListingCandidateExtractorContext, '$'>) {
  const tocBody = resolveTocRoot({ $ });
  if (!tocBody) return null;

  const sections = $(tocBody.root).children(SECTION_SELECTOR).toArray();
  if (sections.length === 0) return null;

  const fixedSection = sections[SCIENCE_SCIADV_FIXED_SECTION_INDEX] ?? null;
  const fixedSectionHeading = fixedSection
    ? $(fixedSection).find(SECTION_HEADING_SELECTOR).first().text()
    : '';
  if (fixedSection && matchesTargetHeading(fixedSectionHeading)) {
    return {
      section: fixedSection,
      sectionIndex: SCIENCE_SCIADV_FIXED_SECTION_INDEX,
      sectionCount: sections.length,
      selectedBy: 'toc-body-fixed-index' as const,
      tocBodySelector: tocBody.selector,
      tocBodyMatchedRootCount: tocBody.matchedRootCount,
    };
  }

  const headingMatchedIndex = sections.findIndex((section) =>
    matchesTargetHeading($(section).find(SECTION_HEADING_SELECTOR).first().text()),
  );
  if (headingMatchedIndex >= 0) {
    return {
      section: sections[headingMatchedIndex],
      sectionIndex: headingMatchedIndex,
      sectionCount: sections.length,
      selectedBy: 'toc-body-heading-fallback' as const,
      tocBodySelector: tocBody.selector,
      tocBodyMatchedRootCount: tocBody.matchedRootCount,
    };
  }

  return null;
}

function extractScienceSciadvPhysicalMaterialsCards(
  context: ListingCandidateExtractorContext,
): ListingCandidateExtraction | null {
  const { $, pageUrl } = context;
  const resolvedSection = resolveScienceSciadvTargetSection({ $ });
  if (!resolvedSection) return null;

  const sectionHeading = cleanText(
    $(resolvedSection.section).find(SECTION_HEADING_SELECTOR).first().text(),
  );
  const cards = $(resolvedSection.section).find(CARD_SELECTOR).toArray();
  if (cards.length === 0) return null;

  let datedCandidateCount = 0;
  let summarizedCandidateCount = 0;
  const seen = new Set<string>();

  const candidates: ListingCandidateExtraction['candidates'] = [];
  for (const [index, card] of cards.entries()) {
    const parsedCard = parseScienceCard({
      $,
      root: card,
      pageUrl,
      order: index,
      articleType: SCIENCE_SCIADV_ARTICLE_TYPE,
      scoreBoost: 180,
    });
    if (!parsedCard || seen.has(parsedCard.normalizedUrl)) continue;

    seen.add(parsedCard.normalizedUrl);
    if (parsedCard.hasDateHint) datedCandidateCount += 1;
    if (parsedCard.hasAbstractText) summarizedCandidateCount += 1;
    candidates.push(parsedCard.seed);
  }

  if (candidates.length === 0) return null;

  return {
    candidates,
    diagnostics: {
      tocBodySelectors: TOC_BODY_SELECTORS,
      tocBodySelector: resolvedSection.tocBodySelector,
      tocBodyMatchedRootCount: resolvedSection.tocBodyMatchedRootCount,
      sectionSelector: SECTION_SELECTOR,
      sectionHeadingSelector: SECTION_HEADING_SELECTOR,
      targetHeading: SCIENCE_SCIADV_TARGET_HEADING,
      fixedSectionIndex: SCIENCE_SCIADV_FIXED_SECTION_INDEX,
      selectedSectionIndex: resolvedSection.sectionIndex,
      selectedBy: resolvedSection.selectedBy,
      sectionCount: resolvedSection.sectionCount,
      selectedSectionHeading: sectionHeading || null,
      cardSelector: CARD_SELECTOR,
      linkSelector: LINK_SELECTOR,
      titleSelector: TITLE_SELECTOR,
      dateSelector: DATE_SELECTOR,
      abstractSelector: ABSTRACT_SELECTOR,
      authorsSelector: AUTHORS_SELECTOR,
      cardCount: cards.length,
      candidateCount: candidates.length,
      datedCandidateCount,
      summarizedCandidateCount,
    },
  };
}

export const scienceSciadvCurrentPhysicalMaterialsCandidateExtractor: ListingCandidateExtractor = {
  id: 'science-sciadv-current-physical-materials',
  matches: isScienceSciadvCurrentListingPage,
  extract(context): ListingCandidateExtraction | null {
    return extractScienceSciadvPhysicalMaterialsCards(context);
  },
};

export function isScienceSciadvCurrentListingPage(page: URL) {
  return isScienceSciadvCurrentTocUrl(page.toString());
}
