import { load } from 'cheerio';

import type { Article } from 'ls/base/parts/sandbox/common/sandboxTypes';
import { cleanNullable } from 'ls/base/common/strings';
import {
  extractAbstract,
  extractArticleType,
  extractAuthors,
  extractDescription,
  extractDoi,
  extractNatureFigures,
  extractPublishedDate,
  extractStructuredDataItems,
  extractTitle,
} from 'ls/code/electron-main/fetch/metadata';

export function buildArticleFromHtml(sourceUrl: string, html: string): Article {
  const $ = load(html);
  const structuredDataItems = extractStructuredDataItems($);
  const title = extractTitle($, structuredDataItems);
  const articleType = extractArticleType($, structuredDataItems);
  const doi = extractDoi($, html);
  const authors = extractAuthors($, structuredDataItems);
  const abstractText = extractAbstract($, structuredDataItems);
  const descriptionText = extractDescription($, structuredDataItems);
  const figures = extractNatureFigures($, sourceUrl);
  const publishedAt = extractPublishedDate($, structuredDataItems);

  return {
    title,
    articleType: cleanNullable(articleType),
    doi: cleanNullable(doi),
    authors,
    abstractText: cleanNullable(abstractText),
    descriptionText: cleanNullable(descriptionText),
    figures: figures.length > 0 ? figures : undefined,
    publishedAt,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
  };
}
