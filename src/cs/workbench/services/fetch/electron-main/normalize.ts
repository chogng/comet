import { load } from 'cheerio';

import { cleanText, pickFirstNonEmpty, uniq } from 'cs/base/common/strings';
import { collectStructuredFieldTextCandidates, extractRawAbstract, extractRawArticleType, extractRawAuthors, extractRawDescription, extractRawDomArticleType, extractRawDomTitle, extractRawDoi, extractRawPublishedDate, extractRawTitle, normalizeRawAuthorName } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
import type { StructuredDataRecord } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
import { extractArticleBodyText } from 'cs/workbench/services/fetch/electron-main/articleBody';
import { resolvePublisherProfile } from 'cs/workbench/services/fetch/electron-main/publisherResolver';

import {
  extractNatureAbstract,
  extractNatureFigureCaptions,
  extractNatureFigures,
  extractNatureHeaderAuthors,
  extractNatureMainText,
  extractNatureReferenceTexts,
  isNatureArticlePage,
} from 'cs/workbench/services/fetch/electron-main/sites/nature';

export function extractAuthors(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const rawAuthors = extractRawAuthors($, structuredDataItems);
  if (rawAuthors.length > 0) {
    return rawAuthors;
  }

  if (isNatureArticlePage($)) {
    const byNatureHeader = extractNatureHeaderAuthors($)
      .map((entry) => normalizeRawAuthorName(entry))
      .filter(Boolean);
    if (byNatureHeader.length > 0) {
      return uniq(byNatureHeader);
    }
  }

  return [];
}

export function extractDoi($: ReturnType<typeof load>, sourceUrl: string) {
	const metadataDoi = extractRawDoi($);
	if (metadataDoi) {
		return metadataDoi;
	}
	try {
		return decodeURIComponent(new URL(sourceUrl).pathname).match(
			/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i,
		)?.[0] ?? null;
	} catch {
		return null;
	}
}

export function extractPublishedDate(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  return extractRawPublishedDate($, structuredDataItems);
}

export function extractArticleType(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const rawType = extractRawArticleType($, structuredDataItems);
  if (rawType) return rawType;

  return extractRawDomArticleType($);
}

export function extractAbstract(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  if (isNatureArticlePage($)) {
    const byNatureAbstract = extractNatureAbstract($);
    if (byNatureAbstract) return byNatureAbstract;
  }

  return extractRawAbstract($, structuredDataItems);
}

export function extractDescription(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
	sourceUrl: string,
) {
  if (isNatureArticlePage($)) {
    const natureMainText = extractNatureMainText($);
    if (natureMainText) {
      const figureCaptions = extractNatureFigureCaptions($);
      const references = extractNatureReferenceTexts($);
      const referencesBlock =
        references.length > 0 ? `References\n${references.join('\n')}` : '';
      return [natureMainText, ...figureCaptions, referencesBlock].filter(Boolean).join('\n\n');
    }
  }
	const articleBodyText = extractArticleBodyText(
		$,
		resolvePublisherProfile(sourceUrl).id,
	);
	if (articleBodyText) {
		return articleBodyText;
	}

  return extractRawDescription($, structuredDataItems);
}

export function extractTitle(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  return pickFirstNonEmpty([
    extractRawTitle($, structuredDataItems),
    extractRawDomTitle($),
  ]);
}

export function extractFigures($: ReturnType<typeof load>, sourceUrl: string) {
  if (isNatureArticlePage($)) {
    return extractNatureFigures($, sourceUrl);
  }

  return [];
}

export function extractStructuredFallbackText(value: unknown) {
  const candidates: string[] = [];
  collectStructuredFieldTextCandidates(value, candidates);
  return cleanText(candidates[0]) || null;
}
