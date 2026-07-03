import type {
  LibraryDocumentSummary,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'ls/base/parts/sandbox/common/electronTypes';
import type { Article } from 'ls/workbench/services/article/articleFetch';

export async function syncLibraryMetadataFromArticle({
  enabled,
  invokeDesktop,
  article,
  onDocumentUpserted,
}: {
  enabled: boolean;
  invokeDesktop: ElectronInvoke;
  article: Pick<
    Article,
    | 'title'
    | 'doi'
    | 'authors'
    | 'journalTitle'
    | 'publishedAt'
    | 'sourceUrl'
    | 'sourceId'
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
      authors: article.authors,
      journalTitle:
        typeof article.journalTitle === 'string' ? article.journalTitle : null,
      publishedAt:
        typeof article.publishedAt === 'string' ? article.publishedAt : null,
      sourceUrl: typeof article.sourceUrl === 'string' ? article.sourceUrl : null,
      sourceId: typeof article.sourceId === 'string' ? article.sourceId : null,
    },
  );

  onDocumentUpserted?.(document);
  return document;
}
