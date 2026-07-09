import {
  hasArticlePathScoreSignal,
  hasNewsListingPathSignal,
  isLikelyStaticResourcePath,
} from 'cs/workbench/services/fetch/electron-main/articleUrlRules';

export function scoreCandidate(page: URL, candidate: string) {
  const baseHost = page.host;
  const url = new URL(candidate);
  const pathname = url.pathname.toLowerCase();

  let score = 0;
  if (url.host === baseHost) score += 15;
  if (hasArticlePathScoreSignal(pathname)) score += 40;
  if (hasNewsListingPathSignal(pathname)) score -= 30;
  if (isLikelyStaticResourcePath(pathname)) score -= 80;
  if (pathname.split('/').filter(Boolean).length >= 2) score += 8;

  return score;
}
