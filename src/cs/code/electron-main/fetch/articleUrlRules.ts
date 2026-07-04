const ARTICLE_PATH_SIGNAL_RE = /(?:\/article|\/articles|\/paper|\/papers|\/doi|\/abs|\/content)/i;
const ARTICLE_PATH_SCORE_RE = /\/(?:article|articles|paper|papers|doi|abs|content)\b/i;
const NEWS_LISTING_PATH_RE = /\/(latest|current|new|news)\b/i;
const STATIC_RESOURCE_PATH_RE = /\.(pdf|jpg|jpeg|png|svg|gif|zip|rar|xml|rss|css|js|woff2?)$/i;

export function hasArticlePathSignal(pathname: string) {
  return ARTICLE_PATH_SIGNAL_RE.test(pathname);
}

export function hasArticlePathScoreSignal(pathname: string) {
  return ARTICLE_PATH_SCORE_RE.test(pathname);
}

export function hasNewsListingPathSignal(pathname: string) {
  return NEWS_LISTING_PATH_RE.test(pathname);
}

export function isLikelyStaticResourcePath(pathname: string) {
  return STATIC_RESOURCE_PATH_RE.test(pathname);
}
