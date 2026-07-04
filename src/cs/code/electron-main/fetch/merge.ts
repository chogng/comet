import type { Article } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';

export type CandidateArticleSnapshot = {
  url: string;
  dateHint: string | null;
  articleType: string | null;
  title: string | null;
  doi: string | null;
  authors: string[];
  abstractText: string | null;
  descriptionText: string | null;
  publishedAt: string | null;
};

export function applyCandidateArticleType(article: Article, candidateArticleType: string | null) {
  const normalizedCandidateType = cleanText(candidateArticleType);
  if (!normalizedCandidateType) return;

  const normalizedArticleType = cleanText(article.articleType);
  const genericArticleType = normalizedArticleType
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const canPromoteCandidateType =
    !normalizedArticleType ||
    /^(?:article|web ?page|web ?site|site|page|thing|creative ?work|work)$/i.test(genericArticleType);

  if (canPromoteCandidateType) {
    article.articleType = normalizedCandidateType;
  }
}

export function hasCandidateArticleSnapshot(candidate: CandidateArticleSnapshot) {
  return Boolean(
    cleanText(candidate.articleType) &&
      (candidate.doi ||
        candidate.abstractText ||
        candidate.descriptionText ||
        candidate.authors.length > 0 ||
        candidate.publishedAt),
  );
}

export function buildArticleFromCandidate(candidate: CandidateArticleSnapshot): Article | null {
  if (!hasCandidateArticleSnapshot(candidate)) {
    return null;
  }

  const title = cleanText(candidate.title);
  if (!title) return null;

  return {
    title,
    articleType: cleanText(candidate.articleType) || null,
    doi: cleanText(candidate.doi) || null,
    authors: [...new Set(candidate.authors.map((author) => cleanText(author)).filter(Boolean))],
    abstractText: cleanText(candidate.abstractText) || null,
    descriptionText: cleanText(candidate.descriptionText) || null,
    publishedAt: cleanText(candidate.publishedAt) || cleanText(candidate.dateHint) || null,
    sourceUrl: candidate.url,
    fetchedAt: new Date().toISOString(),
  };
}
