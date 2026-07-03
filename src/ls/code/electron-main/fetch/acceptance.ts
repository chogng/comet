import type { Article } from 'ls/base/parts/sandbox/common/sandboxTypes';
import { hasArticlePathSignal } from 'ls/code/electron-main/fetch/articleUrlRules';

export function hasStrongArticleSignals(
  candidateUrl: string,
  article: Pick<Article, 'doi' | 'abstractText' | 'descriptionText'>,
) {
  const pathname = new URL(candidateUrl).pathname.toLowerCase();
  if (hasArticlePathSignal(pathname)) return true;
  if (article.doi) return true;
  if (article.abstractText && article.abstractText.length > 60) return true;
  if (article.descriptionText && article.descriptionText.length > 60) return true;

  return false;
}

export function isProbablyArticle(candidateUrl: string, article: Article) {
  if (!article.title) return false;
  if (hasStrongArticleSignals(candidateUrl, article)) return true;

  return article.title.length >= 20;
}
