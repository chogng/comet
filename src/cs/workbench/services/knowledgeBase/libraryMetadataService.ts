import type {
  LibraryDocumentSummary,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
  getFetchArticleAuthorNames,
  getFetchArticleSourceUrl,
} from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';

export async function syncLibraryMetadataFromArticle({
  enabled,
  invokeDesktop,
  article,
  onDocumentUpserted,
}: {
  enabled: boolean;
  invokeDesktop: ElectronInvoke;
  article: Pick<
	FetchArticle,
	'title' | 'doi' | 'authors' | 'publication' | 'publishedAt' | 'sourceUri' | 'articleListSourceId'
  >;
  onDocumentUpserted?: (document: LibraryDocumentSummary) => void;
}) {
  if (!enabled) {
    return null;
  }

  const document = await invokeDesktop<LibraryDocumentSummary>(
    'upsert_library_document_metadata',
    {
      articleTitle: article.title,
      doi: typeof article.doi === 'string' ? article.doi : null,
      authors: getFetchArticleAuthorNames(article),
      journalTitle: article.publication.title,
      publishedAt:
        typeof article.publishedAt === 'string' ? article.publishedAt : null,
      sourceUrl: getFetchArticleSourceUrl(article),
      sourceId: article.articleListSourceId ?? null,
    },
  );

  onDocumentUpserted?.(document);
  return document;
}
