import { appError } from 'cs/base/common/errors';

const TRAILING_URL_PUNCTUATION_RE =
  /[\u3001\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F,.;:!?]+$/u;

const TRAILING_URL_CLOSER_PAIRS: Readonly<Record<string, string>> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '>': '<',
  '\uFF09': '\uFF08',
  '\u3011': '\u3010',
  '\u300B': '\u300A',
  '\u300D': '\u300C',
  '\u300F': '\u300E',
};

function countOccurrences(value: string, target: string) {
  let count = 0;
  for (const char of value) {
    if (char === target) {
      count += 1;
    }
  }
  return count;
}

export function sanitizeUrlInput(input: string) {
  let normalized = input.trim();
  if (!normalized) {
    return '';
  }

  normalized = normalized.replace(TRAILING_URL_PUNCTUATION_RE, '');
  while (normalized) {
    const lastChar = normalized.charAt(normalized.length - 1);
    const openingChar = TRAILING_URL_CLOSER_PAIRS[lastChar];
    if (!openingChar) {
      break;
    }

    const openingCount = countOccurrences(normalized, openingChar);
    const closingCount = countOccurrences(normalized, lastChar);
    if (closingCount <= openingCount) {
      break;
    }

    normalized = normalized
      .slice(0, -1)
      .trimEnd()
      .replace(TRAILING_URL_PUNCTUATION_RE, '');
  }

  return normalized;
}

export function normalizeUrl(input: unknown) {
  const trimmed = sanitizeUrlInput(String(input ?? ''));
  if (!trimmed) {
    throw appError('URL_EMPTY');
  }

  const value = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(value);
  if (!/^https?:$/i.test(url.protocol)) {
    throw appError('URL_PROTOCOL_UNSUPPORTED', { protocol: url.protocol });
  }

  return url.toString();
}

const SCIENCE_DOI_PATH_RE = /^\/doi\/(?:abs\/|epdf\/|pdf\/)?(.+)$/i;
const SCIENCE_SERIES_CURRENT_TOC_PATH_RE = /^\/toc\/[^/]+\/current\/?$/i;
const SCIENCE_MAIN_CURRENT_TOC_PATH_RE = /^\/toc\/science\/current\/?$/i;
const SCIENCE_SCIADV_CURRENT_TOC_PATH_RE = /^\/toc\/sciadv\/current\/?$/i;
const NATURE_ARTICLE_PATH_RE = /^\/articles\/([^/]+?)(?:\.pdf|_reference\.pdf)?\/?$/i;
const NATURE_ARTICLE_DOWNLOAD_PATH_RE = /^\/articles\/[^/]+(?:\.pdf|_reference\.pdf)$/i;
const NATURE_LISTING_PATH_RE = /^\/[^/]+\/(?:research-articles|reviews-and-analysis)$/i;
const DOI_VALUE_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

function cleanUrlText(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isScienceHost(hostname: string) {
  const normalized = cleanUrlText(hostname).toLowerCase();
  return normalized === 'science.org' || normalized === 'www.science.org';
}

export function isScienceHostUrl(inputUrl: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(inputUrl);
  } catch {
    parsed = null;
  }

  return Boolean(parsed && isScienceHost(parsed.hostname));
}

function matchesScienceUrlPath(inputUrl: string, pathnameRe: RegExp) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(inputUrl);
  } catch {
    parsed = null;
  }

  if (!parsed || !isScienceHost(parsed.hostname)) {
    return false;
  }

  return pathnameRe.test(parsed.pathname);
}

function extractDoiValue(value: string | null | undefined) {
  const normalized = cleanUrlText(value);
  if (!normalized) {
    return '';
  }

  const matched = normalized.match(DOI_VALUE_RE);
  return cleanUrlText(matched?.[0] ?? '');
}

export function extractScienceDoiFromPathLike(value: string) {
  const normalized = cleanUrlText(value);
  if (!normalized) {
    return null;
  }

  const matched = normalized.match(SCIENCE_DOI_PATH_RE);
  const doiPath = cleanUrlText(matched?.[1] ?? '');
  if (!doiPath) {
    return null;
  }

  try {
    return decodeURIComponent(doiPath);
  } catch {
    return doiPath;
  }
}

function resolveScienceOriginAndDoiPath(inputUrl: string, doi?: string | null) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(inputUrl);
  } catch {
    parsed = null;
  }

  if (!parsed || !isScienceHost(parsed.hostname)) {
    return null;
  }

  const doiPath =
    extractDoiValue(doi) ||
    extractScienceDoiFromPathLike(cleanUrlText(parsed.pathname).replace(/\/+$/, '')) ||
    '';
  if (!doiPath) {
    return null;
  }

  return {
    origin: parsed.origin,
    doiPath,
  };
}

export function buildScienceDirectPdfDownloadCandidates(inputUrl: string, doi?: string | null) {
  const resolved = resolveScienceOriginAndDoiPath(inputUrl, doi);
  if (!resolved) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    const cleaned = cleanUrlText(value);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }

    seen.add(cleaned);
    candidates.push(cleaned);
  };

  const pdfPath = `/doi/pdf/${resolved.doiPath}`;
  const downloadUrl = new URL(pdfPath, resolved.origin);
  downloadUrl.searchParams.set('download', 'true');
  addCandidate(downloadUrl.toString());
  addCandidate(new URL(pdfPath, resolved.origin).toString());

  return candidates;
}

export function buildSciencePdfDownloadUrl(inputUrl: string, doi?: string | null) {
  return buildScienceDirectPdfDownloadCandidates(inputUrl, doi)[0] ?? null;
}

export function buildScienceEpdfPageUrl(inputUrl: string, doi?: string | null) {
  const resolved = resolveScienceOriginAndDoiPath(inputUrl, doi);
  if (!resolved) {
    return null;
  }

  return new URL(`/doi/epdf/${resolved.doiPath}`, resolved.origin).toString();
}

export function isScienceSeriesCurrentTocUrl(inputUrl: string) {
  return matchesScienceUrlPath(inputUrl, SCIENCE_SERIES_CURRENT_TOC_PATH_RE);
}

export function isScienceCurrentTocUrl(inputUrl: string) {
  return matchesScienceUrlPath(inputUrl, SCIENCE_MAIN_CURRENT_TOC_PATH_RE);
}

export function isScienceSciadvCurrentTocUrl(inputUrl: string) {
  return matchesScienceUrlPath(inputUrl, SCIENCE_SCIADV_CURRENT_TOC_PATH_RE);
}

function isNatureHost(hostname: string) {
  const normalized = cleanUrlText(hostname).toLowerCase();
  return normalized === 'nature.com' || normalized.endsWith('.nature.com');
}

export function isNatureMainSiteUrl(inputUrl: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(inputUrl);
  } catch {
    parsed = null;
  }

  return cleanUrlText(parsed?.hostname).toLowerCase() === 'www.nature.com';
}

export function isNatureListingPath(pathname: string) {
  const normalizedPathname = cleanUrlText(pathname).replace(/\/+$/, '') || '/';
  if (normalizedPathname === '/latest-news') {
    return true;
  }
  if (normalizedPathname === '/opinion') {
    return true;
  }

  return NATURE_LISTING_PATH_RE.test(normalizedPathname);
}

export function normalizeNatureMainSiteListingUrl(inputUrl: string) {
  try {
    const parsed = new URL(inputUrl);
    if (!isNatureMainSiteUrl(parsed.toString())) {
      return inputUrl;
    }
    if (!isNatureListingPath(parsed.pathname)) {
      return inputUrl;
    }

    parsed.searchParams.delete('page');
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return inputUrl;
  }
}

function extractNatureArticleId(pathname: string) {
  const normalizedPathname = cleanUrlText(pathname).replace(/\/+$/, '');
  const matched = normalizedPathname.match(NATURE_ARTICLE_PATH_RE);
  return cleanUrlText(matched?.[1] ?? '');
}

export function buildNatureResearchPdfDownloadCandidates(inputUrl: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(inputUrl);
  } catch {
    parsed = null;
  }

  if (!parsed || !isNatureHost(parsed.hostname)) {
    return [];
  }

  const articleId = extractNatureArticleId(parsed.pathname);
  if (!articleId) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    const cleaned = cleanUrlText(value);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }

    seen.add(cleaned);
    candidates.push(cleaned);
  };

  const currentPath = parsed.pathname.replace(/\/+$/, '');
  if (NATURE_ARTICLE_DOWNLOAD_PATH_RE.test(currentPath)) {
    addCandidate(parsed.toString());
  }

  addCandidate(new URL(`/articles/${articleId}.pdf`, parsed.origin).toString());
  addCandidate(new URL(`/articles/${articleId}_reference.pdf`, parsed.origin).toString());

  return candidates;
}

export function buildNatureResearchPdfDownloadUrl(inputUrl: string) {
  return buildNatureResearchPdfDownloadCandidates(inputUrl)[0] ?? null;
}
