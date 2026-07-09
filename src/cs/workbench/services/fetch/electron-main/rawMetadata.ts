import { load } from 'cheerio';

import { parseDateString } from 'cs/base/common/date';
import { cleanText, uniq } from 'cs/base/common/strings';

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

export type StructuredDataRecord = Record<string, unknown>;

function pickMetaContent($: ReturnType<typeof load>, selectors: string[]) {
  for (const selector of selectors) {
    const value = cleanText($(selector).first().attr('content'));
    if (value) return value;
  }

  return '';
}

function collectMetaContents($: ReturnType<typeof load>, selectors: string[]) {
  const values: string[] = [];

  for (const selector of selectors) {
    values.push(
      ...$(selector)
        .map((_, node) => cleanText($(node).attr('content')))
        .get()
        .filter(Boolean),
    );
  }

  return uniq(values);
}

function collectStructuredDataItems(input: unknown, target: StructuredDataRecord[]) {
  if (!input || typeof input !== 'object') return;

  if (Array.isArray(input)) {
    input.forEach((entry) => collectStructuredDataItems(entry, target));
    return;
  }

  const record = input as StructuredDataRecord;
  target.push(record);

  const graph = record['@graph'];
  if (Array.isArray(graph)) {
    graph.forEach((entry) => collectStructuredDataItems(entry, target));
  }
}

function normalizeAuthorName(value: unknown) {
  const text = cleanText(value)
    .replace(/\bORCID:\s*orcid\.org\/\S+/gi, '')
    .replace(/\bhttps?:\/\/orcid\.org\/\S+/gi, '')
    .replace(/\s*\d+(?:,\d+)*\s*&?\s*$/g, '')
    .replace(/\s*,\s*$/g, '');
  return text;
}

function splitAuthorCandidate(value: unknown) {
  const text = normalizeAuthorName(value);
  if (!text) return [];

  return text
    .split(/\s*(?:;|\||·|•|\band\b)\s*/i)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
}

function collectStructuredAuthorNames(author: unknown, target: string[]) {
  if (!author) return;

  if (Array.isArray(author)) {
    author.forEach((entry) => collectStructuredAuthorNames(entry, target));
    return;
  }

  if (typeof author === 'string') {
    target.push(...splitAuthorCandidate(author));
    return;
  }

  if (typeof author !== 'object') {
    return;
  }

  const record = author as StructuredDataRecord;
  const directName = cleanText(record.name);
  if (directName) {
    target.push(directName);
    return;
  }

  const givenName = cleanText(record.givenName);
  const additionalName = cleanText(record.additionalName);
  const familyName = cleanText(record.familyName);
  const composedName = cleanText([givenName, additionalName, familyName].filter(Boolean).join(' '));
  if (composedName) {
    target.push(composedName);
  }
}

export function collectStructuredTextCandidates(value: unknown, target: string[]) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStructuredTextCandidates(entry, target));
    return;
  }

  if (typeof value === 'string') {
    const text = cleanText(value);
    if (text) target.push(text);
    return;
  }

  if (typeof value === 'object') {
    const record = value as StructuredDataRecord;
    const name = cleanText(record.name);
    if (name) target.push(name);
    const typeName = cleanText(record['@type']);
    if (typeName) target.push(typeName);
  }
}

export function collectStructuredFieldTextCandidates(value: unknown, target: string[]) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStructuredFieldTextCandidates(entry, target));
    return;
  }

  if (typeof value === 'string') {
    const text = cleanText(value);
    if (text) target.push(text);
    return;
  }

  if (typeof value === 'object') {
    const record = value as StructuredDataRecord;
    const directCandidates = [record.text, record.name, record.value, record['@value']];
    directCandidates.forEach((entry) => {
      if (typeof entry !== 'string' && typeof entry !== 'number') {
        return;
      }
      const text = cleanText(entry);
      if (text) target.push(text);
    });
  }
}

function normalizeDoiValue(value: unknown) {
  const text = cleanText(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/^urn:doi:\s*/i, '');
  if (!text) return null;

  const matched = text.match(DOI_RE);
  return matched ? matched[0] : null;
}

function normalizeArticleTypeValue(value: unknown) {
  const text = cleanText(value);
  if (!text) return '';

  const withoutArticleSuffix = text.replace(/article$/i, '').trim();
  const normalized = withoutArticleSuffix || text;
  if (
    !normalized ||
    /^(?:article|web ?page|scholarly ?article|creative ?work|work)$/i.test(normalized)
  ) {
    return '';
  }
  return normalized;
}

export function extractStructuredDataItems($: ReturnType<typeof load>) {
  const items: StructuredDataRecord[] = [];

  $('script[type="application/ld+json"]').each((_, node) => {
    const raw = $(node).html();
    if (!raw) return;

    try {
      collectStructuredDataItems(JSON.parse(raw), items);
    } catch {
      return;
    }
  });

  return items;
}

export function extractRawAuthors(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const byMeta = collectMetaContents($, [
    'meta[name="citation_author"]',
    'meta[name="citation_authors"]',
    'meta[name="dc.creator"]',
    'meta[name="dc.contributor"]',
    'meta[name="author"]',
    'meta[property="author"]',
    'meta[property="article:author"]',
    'meta[name="parsely-author"]',
    'meta[name="sailthru.author"]',
    'meta[itemprop="author"]',
  ]).flatMap((entry) => splitAuthorCandidate(entry));

  const normalizedMetaAuthors = byMeta.map((entry) => normalizeAuthorName(entry)).filter(Boolean);
  if (normalizedMetaAuthors.length > 0) {
    return uniq(normalizedMetaAuthors);
  }

  const ldAuthors: string[] = [];
  for (const item of structuredDataItems) {
    collectStructuredAuthorNames(item?.author, ldAuthors);
    collectStructuredAuthorNames(item?.creator, ldAuthors);
  }
  const normalizedLdAuthors = ldAuthors.map((entry) => normalizeAuthorName(entry)).filter(Boolean);
  if (normalizedLdAuthors.length > 0) {
    return uniq(normalizedLdAuthors);
  }

  return [];
}

export function extractRawDoi($: ReturnType<typeof load>, html: string) {
  const fromMeta = normalizeDoiValue(
    pickMetaContent($, [
      'meta[name="citation_doi"]',
      'meta[name="dc.identifier"]',
      'meta[name="dc.identifier.doi"]',
      'meta[name="prism.doi"]',
      'meta[property="og:doi"]',
      'meta[name="bepress_citation_doi"]',
      'meta[name="evt-doiPage"]',
      'meta[itemprop="doi"]',
      'meta[itemprop="identifier"]',
    ]),
  );
  if (fromMeta) return fromMeta;

  const doiHref = normalizeDoiValue($('a[href*="doi.org/10."]').first().attr('href'));
  if (doiHref) return doiHref;

  const doiData = normalizeDoiValue($('[data-doi]').first().attr('data-doi'));
  if (doiData) return doiData;

  return normalizeDoiValue(cleanText(html));
}

export function extractRawPublishedDate(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const metaDateSelectors = [
    'meta[name="citation_publication_date"]',
    'meta[name="citation_online_date"]',
    'meta[name="citation_date"]',
    'meta[name="dc.date"]',
    'meta[name="dc.date.issued"]',
    'meta[name="prism.publicationDate"]',
    'meta[name="article_date_original"]',
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const selector of metaDateSelectors) {
    const parsed = parseDateString($(selector).first().attr('content'));
    if (parsed) return parsed;
  }

  const semanticDateCandidates = [
    $('time[datetime]').first().attr('datetime'),
    $('[itemprop="datePublished"]').first().attr('datetime'),
    $('[itemprop="datePublished"]').first().attr('content'),
    $('[itemprop="datePublished"]').first().text(),
    $('time[pubdate]').first().attr('datetime'),
    $('time[pubdate]').first().text(),
  ];
  for (const value of semanticDateCandidates) {
    const parsed = parseDateString(value);
    if (parsed) return parsed;
  }

  for (const item of structuredDataItems) {
    const structuredCandidates = [
      item.datePublished,
      item.dateCreated,
      item.dateIssued,
      item.uploadDate,
    ];
    for (const value of structuredCandidates) {
      const parsed = parseDateString(value);
      if (parsed) return parsed;
    }
  }

  return null;
}

export function extractRawArticleType(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const byMeta = normalizeArticleTypeValue(
    pickMetaContent($, [
      'meta[name="dc.type"]',
      'meta[name="prism.genre"]',
      'meta[name="citation_article_type"]',
      'meta[property="article:section"]',
      'meta[property="og:type"]',
    ]),
  );
  if (byMeta) return byMeta;

  const structuredTypeCandidates: string[] = [];
  for (const item of structuredDataItems) {
    collectStructuredTextCandidates(item.articleSection, structuredTypeCandidates);
    collectStructuredTextCandidates(item.genre, structuredTypeCandidates);
    collectStructuredTextCandidates(item.additionalType, structuredTypeCandidates);
    collectStructuredTextCandidates(item['@type'], structuredTypeCandidates);
  }

  for (const candidate of structuredTypeCandidates) {
    const normalized = normalizeArticleTypeValue(candidate);
    if (normalized) return normalized;
  }

  return null;
}

export function extractRawAbstract(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const byMeta = pickMetaContent($, [
    'meta[name="citation_abstract"]',
    'meta[name="dc.description.abstract"]',
    'meta[name="prism.abstract"]',
  ]);
  if (byMeta) return byMeta;

  const candidates = [
    cleanText($('[itemprop="abstract"] p').first().text()),
    cleanText($('[itemprop="abstract"]').first().text()),
    cleanText($('section[aria-labelledby*="abs"] p').first().text()),
    cleanText($('div.abstract p').first().text()),
    cleanText($('p.abstract').first().text()),
  ].filter(Boolean);
  if (candidates.length > 0) return candidates[0];

  const structuredCandidates: string[] = [];
  for (const item of structuredDataItems) {
    collectStructuredFieldTextCandidates(item.abstract, structuredCandidates);
  }
  if (structuredCandidates.length > 0) return structuredCandidates[0];

  return null;
}

export function extractRawDescription(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const byMeta = pickMetaContent($, [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="dc.description"]',
    'meta[name="twitter:description"]',
  ]);
  if (byMeta) return byMeta;

  const candidates = [
    cleanText($('div[data-test="article-description"][itemprop="description"] p').first().text()),
    cleanText($('div[data-test="article-description"] p').first().text()),
    cleanText($('[itemprop="description"] p').first().text()),
    cleanText($('[itemprop="description"]').first().text()),
    cleanText($('div.c-card__summary[itemprop="description"] p').first().text()),
    cleanText($('div.c-card__summary p').first().text()),
  ].filter(Boolean);
  if (candidates.length > 0) return candidates[0];

  const structuredCandidates: string[] = [];
  for (const item of structuredDataItems) {
    collectStructuredFieldTextCandidates(item.description, structuredCandidates);
  }

  return structuredCandidates[0] ?? null;
}

export function extractRawTitle(
  $: ReturnType<typeof load>,
  structuredDataItems: StructuredDataRecord[],
) {
  const structuredCandidates: string[] = [];
  for (const item of structuredDataItems) {
    collectStructuredFieldTextCandidates(item.headline, structuredCandidates);
    collectStructuredFieldTextCandidates(item.name, structuredCandidates);
    collectStructuredFieldTextCandidates(item.alternativeHeadline, structuredCandidates);
  }

  return pickMetaContent($, [
    'meta[name="citation_title"]',
    'meta[name="dc.title"]',
    'meta[name="eprints.title"]',
    'meta[name="prism.title"]',
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="parsely-title"]',
    'meta[itemprop="headline"]',
    'meta[itemprop="name"]',
  ]) || structuredCandidates[0] || null;
}

export function extractRawDomTitle($: ReturnType<typeof load>) {
  return (
    cleanText($('.c-article-header h1').first().text()) ||
    cleanText($('[itemprop="headline"]').first().text()) ||
    cleanText($('[data-test="article-title"]').first().text()) ||
    cleanText($('title').first().text()) ||
    cleanText($('h1').first().text()) ||
    null
  );
}

export function extractRawDomArticleType($: ReturnType<typeof load>) {
  const value =
    cleanText($('.c-article-header [data-test="article-category"]').first().text()) ||
    cleanText($('[data-test="article-category"]').first().text()) ||
    cleanText($('[data-test="article-type"]').first().text()) ||
    cleanText($('[data-test="article-subtype"]').first().text()) ||
    cleanText($('[itemprop="genre"]').first().text()) ||
    cleanText($('.c-article-info-details').first().text()) ||
    cleanText($('.article-header__category').first().text());

  return normalizeArticleTypeValue(value) || null;
}

export function normalizeRawAuthorName(value: unknown) {
  return normalizeAuthorName(value);
}
