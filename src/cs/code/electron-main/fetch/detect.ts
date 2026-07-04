import { hasArticlePathSignal } from 'cs/code/electron-main/fetch/articleUrlRules';

export type SourcePageType = 'detail' | 'listing';

export type SourcePageTypeResult = {
  type: SourcePageType;
  pathname: string;
  hasArticlePath: boolean;
  matchesArticleDetailPath: boolean;
  reason: 'article_detail_path' | 'default_listing';
};

export function matchesArticleDetailPath(pathname: string) {
  const normalizedPathname = pathname.replace(/\/+$/, '') || '/';
  return /^(?:\/(?:article|articles|paper|papers|doi|abs|content)\/[^/]+)$/i.test(normalizedPathname);
}

export function detect(page: URL): SourcePageTypeResult {
  const pathname = page.pathname.toLowerCase();
  const hasArticlePath = hasArticlePathSignal(pathname);
  const isArticleDetailPath = matchesArticleDetailPath(pathname);

  if (isArticleDetailPath) {
    return {
      type: 'detail',
      pathname,
      hasArticlePath,
      matchesArticleDetailPath: isArticleDetailPath,
      reason: 'article_detail_path',
    };
  }

  return {
    type: 'listing',
    pathname,
    hasArticlePath,
    matchesArticleDetailPath: isArticleDetailPath,
    reason: 'default_listing',
  };
}
