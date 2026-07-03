import path from 'node:path';
import { promises as fs } from 'node:fs';
import { load } from 'cheerio';

import type {
  Article,
  WebContentHtmlArchivePayload,
  WebContentHtmlArchiveResult,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'ls/base/common/errors';
import { cleanText } from 'ls/base/common/strings';
import { normalizeUrl } from 'ls/base/common/url';
import { buildPdfDirectoryName } from 'ls/platform/download/common/pdfFileName';
import { buildArticleFromHtml } from 'ls/code/electron-main/fetch/parser';
import { previewDownloadPdf } from 'ls/code/electron-main/pdf/pdf';
import type { StorageService } from 'ls/platform/storage/common/storage';
import { resolveWebContentSnapshotHtml } from 'ls/code/electron-main/fetch/webContentChannel';

function resolveSourceHostLabel(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return '';
  }
}

function buildArchiveStem(article: Pick<Article, 'title' | 'sourceUrl'>) {
  return (
    buildPdfDirectoryName(article.title) ||
    buildPdfDirectoryName(resolveSourceHostLabel(article.sourceUrl)) ||
    `page-${Date.now()}`
  );
}

async function resolveUniqueArchiveDirectory(
  archiveRootDirectory: string,
  article: Pick<Article, 'title' | 'sourceUrl'>,
) {
  const baseStem = buildArchiveStem(article);

  let attempt = 0;
  while (true) {
    const directoryName = attempt === 0 ? baseStem : `${baseStem}-${attempt + 1}`;
    const candidatePath = path.join(archiveRootDirectory, directoryName);
    try {
      await fs.access(candidatePath);
      attempt += 1;
    } catch {
      await fs.mkdir(candidatePath, { recursive: true });
      return {
        directoryPath: candidatePath,
        stem: directoryName,
      };
    }
  }
}

function ensureArchiveHtmlDocument(html: string, sourceUrl: string) {
  const hasDoctype = /^\s*<!doctype/i.test(html);
  const $ = load(html);

  if ($('html').length === 0) {
    return `${hasDoctype ? '' : '<!DOCTYPE html>\n'}${html}`;
  }

  let head = $('head').first();
  if (head.length === 0) {
    $('html').prepend('<head></head>');
    head = $('head').first();
  }

  if (head.find('base').length === 0) {
    head.prepend(`<base href="${sourceUrl}">`);
  }

  if (head.find('meta[name="literature-studio-source-url"]').length === 0) {
    head.append(`<meta name="literature-studio-source-url" content="${sourceUrl}">`);
  }

  return `${hasDoctype ? '' : '<!DOCTYPE html>\n'}${$.html()}`;
}

function normalizeTextBlock(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractStructuredTextFromHtml(html: string) {
  const $ = load(html);
  $('script, style, noscript, svg, canvas, form, button, input, select, textarea').remove();

  const candidateRoots = [
    $('article').first(),
    $('main').first(),
    $('[role="main"]').first(),
    $('body').first(),
  ].filter((node) => node.length > 0);
  const root = candidateRoots[0] ?? $('body').first();
  if (root.length === 0) {
    return '';
  }

  const seen = new Set<string>();
  const blocks: string[] = [];
  root.find('h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, pre, td, th').each((_, node) => {
    const text = normalizeTextBlock($(node).text());
    if (!text || seen.has(text)) {
      return;
    }

    seen.add(text);
    blocks.push(text);
  });

  if (blocks.length > 0) {
    return blocks.join('\n\n');
  }

  return normalizeTextBlock(root.text());
}

function buildArchiveTextContent(article: Article, extractedText: string) {
  const lines = [
    `Title: ${cleanText(article.title) || 'Untitled'}`,
    `Source URL: ${cleanText(article.sourceUrl) || '-'}`,
    article.publishedAt ? `Published At: ${cleanText(article.publishedAt)}` : '',
    article.doi ? `DOI: ${cleanText(article.doi)}` : '',
    article.authors.length > 0 ? `Authors: ${article.authors.map((author) => cleanText(author)).filter(Boolean).join(', ')}` : '',
    article.journalTitle ? `Journal: ${cleanText(article.journalTitle)}` : '',
    article.sourceId ? `Source ID: ${cleanText(article.sourceId)}` : '',
    `Archived At: ${cleanText(article.fetchedAt) || new Date().toISOString()}`,
    '',
    extractedText,
  ].filter(Boolean);

  return `${lines.join('\n')}\n`;
}

function resolveArchiveArticle(
  sourceUrl: string,
  snapshotHtml: string,
  pageTitle: string,
): Article {
  const parsedArticle = buildArticleFromHtml(sourceUrl, snapshotHtml);
  return {
    ...parsedArticle,
    title: cleanText(parsedArticle.title) || pageTitle || sourceUrl,
  };
}

export async function archiveWebContentHtml(
  payload: WebContentHtmlArchivePayload,
  defaultDownloadDirectory: string,
  storage: StorageService,
): Promise<WebContentHtmlArchiveResult> {
  const sourceUrl = normalizeUrl(payload.pageUrl ?? '');
  const snapshotHtml = await resolveWebContentSnapshotHtml({
    pageUrl: sourceUrl,
  });
  if (!snapshotHtml) {
    throw appError('PREVIEW_NOT_READY');
  }

  const fallbackTitle = cleanText(payload.pageTitle);
  const baseArticle = resolveArchiveArticle(sourceUrl, snapshotHtml, fallbackTitle);
  const extractedText = normalizeTextBlock(
    cleanText(baseArticle.descriptionText) ||
      cleanText(baseArticle.abstractText) ||
      extractStructuredTextFromHtml(snapshotHtml),
  );
  const archiveRootDirectory = path.join(
    defaultDownloadDirectory,
    'Literature Studio Archive',
  );
  await fs.mkdir(archiveRootDirectory, { recursive: true });
  const archiveEntry = await resolveUniqueArchiveDirectory(
    archiveRootDirectory,
    baseArticle,
  );

  const htmlPath = path.join(archiveEntry.directoryPath, `${archiveEntry.stem}.html`);
  const textPath = path.join(archiveEntry.directoryPath, `${archiveEntry.stem}.txt`);
  const article: Article = {
    ...baseArticle,
    descriptionText: cleanText(baseArticle.descriptionText) || extractedText || null,
    archiveHtmlPath: htmlPath,
    archiveTextPath: textPath,
    archivePdfPath: null,
  };
  const normalizedExtractedText = normalizeTextBlock(
    cleanText(article.descriptionText) ||
      cleanText(article.abstractText) ||
      extractStructuredTextFromHtml(snapshotHtml),
  );
  await fs.writeFile(
    htmlPath,
    ensureArchiveHtmlDocument(snapshotHtml, sourceUrl),
    'utf8',
  );
  await fs.writeFile(
    textPath,
    buildArchiveTextContent(article, normalizedExtractedText),
    'utf8',
  );

  let pdfPath: string | null = null;
  let pdfSourceUrl: string | null = null;
  try {
    const pdfResult = await previewDownloadPdf(
      {
        pageUrl: sourceUrl,
        articleTitle: article.title,
        doi: article.doi ?? undefined,
        authors: article.authors,
        publishedAt: article.publishedAt,
        sourceId: article.sourceId ?? null,
        journalTitle: '',
        customDownloadDir: archiveEntry.directoryPath,
      },
      defaultDownloadDirectory,
      snapshotHtml,
    );
    pdfPath = cleanText(pdfResult.filePath) || null;
    pdfSourceUrl = cleanText(pdfResult.sourceUrl) || null;
    if (pdfPath) {
      article.archivePdfPath = pdfPath;
      try {
        await storage.registerLibraryDocument({
          filePath: pdfPath,
          sourceUrl,
          sourceId: article.sourceId ?? null,
          doi: article.doi ?? null,
          articleTitle: article.title,
          authors: article.authors,
          journalTitle: article.journalTitle ?? null,
          publishedAt: article.publishedAt ?? null,
        });
      } catch (registrationError) {
        console.error('Failed to register archived PDF in the library.', registrationError);
      }
    }
  } catch (pdfError) {
    console.error('Failed to generate companion PDF for archived web content.', pdfError);
  }

  await storage.saveFetchedArticles([article]);

  return {
    filePath: htmlPath,
    htmlPath,
    textPath,
    pdfPath,
    sourceUrl,
    pdfSourceUrl,
    extractedText: normalizedExtractedText,
    article,
  };
}
