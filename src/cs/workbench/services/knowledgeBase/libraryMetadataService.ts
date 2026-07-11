import type {
  LibraryDocumentSummary,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';

export type LibraryArticleMetadataInput = {
	title: string;
	doi?: string;
	authors: readonly string[];
	journalTitle: string;
	publishedAt?: string;
	sourceUrl: string;
	sourceId: string | null;
};

export async function syncLibraryMetadataFromArticle({
  enabled,
  invokeDesktop,
  article,
  onDocumentUpserted,
}: {
  enabled: boolean;
  invokeDesktop: ElectronInvoke;
  article: LibraryArticleMetadataInput;
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
      authors: [...article.authors],
      journalTitle: article.journalTitle,
      publishedAt: article.publishedAt ?? null,
      sourceUrl: article.sourceUrl,
      sourceId: article.sourceId,
    },
  );

  onDocumentUpserted?.(document);
  return document;
}
