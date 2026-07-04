import { load } from 'cheerio';
import {
  buildNatureResearchPdfDownloadCandidates,
  buildNatureResearchPdfDownloadUrl,
} from 'cs/base/common/url';
import { cleanText } from 'cs/base/common/strings';

function toAbsoluteNatureHttpUrl(rawUrl: string, baseUrl: string) {
  try {
    const resolved = new URL(rawUrl, baseUrl);
    if (!/^https?:$/i.test(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export { buildNatureResearchPdfDownloadCandidates, buildNatureResearchPdfDownloadUrl };

export function extractNatureResearchPdfDownloadCandidatesFromHtml(
  pageUrl: string,
  html: string,
) {
  const normalizedPageUrl = cleanText(pageUrl);
  const normalizedHtml = typeof html === 'string' ? html : '';
  if (!normalizedPageUrl || !normalizedHtml.trim()) {
    return [];
  }

  const $ = load(normalizedHtml);
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (rawUrl: string) => {
    const absolute = toAbsoluteNatureHttpUrl(rawUrl, normalizedPageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    candidates.push(absolute);
  };

  for (const node of $(
    'a[data-test="download-pdf"][href], a[data-article-pdf="true"][href], a.c-pdf-download__link[href]',
  ).toArray()) {
    addCandidate(cleanText($(node).attr('href')));
  }

  return candidates;
}
