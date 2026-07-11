import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import type {
  DocumentTranslationProgress,
  DocxExportResult,
  ExportArticlesDocxPayload,
  ArticleSummaryExportInput,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { AppStorageService } from 'cs/code/electron-main/storageService';
import { defaultDocxExportConfig } from 'cs/code/electron-main/document/docxConfig';
import { CancellationError, isCancellationError } from 'cs/base/common/errors';
import { AppError } from 'cs/base/parts/sandbox/common/appError';
import { DocumentErrorCode, documentError } from 'cs/code/electron-main/document/documentErrors';
import { resolveDocxExportCopy, resolveDocxExportDialogCopy, resolveSupportedLocale } from 'cs/code/electron-main/document/docxCopy';
import type { SupportedLocale } from 'cs/code/electron-main/document/docxCopy';
import { buildDocxBuffer as buildDocxArchiveBuffer, escapeXml, normalizeDocxPath } from 'cs/code/electron-main/document/docxPackage';

import { cleanText } from 'cs/base/common/strings';
import { buildPdfDirectoryName } from 'cs/platform/download/common/pdfFileName';
import { translateArticleSummariesToChinese } from 'cs/code/electron-main/translation/articleTranslation';

const docxConfig = defaultDocxExportConfig;

function normalizeLines(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function paragraphXml(
  text: string,
  options: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    color?: string;
    fontAscii?: string;
    fontEastAsia?: string;
    spacingBefore?: number;
    spacingAfter?: number;
    lineSpacing?: number;
    lineRule?: 'auto' | 'atLeast' | 'exact';
  } = {},
) {
  const paragraphProperties: string[] = [];
  const spacingAttributes: string[] = [];
  if (options.spacingBefore !== undefined) {
    spacingAttributes.push(`w:before="${options.spacingBefore}"`);
  }
  if (options.spacingAfter !== undefined) {
    spacingAttributes.push(`w:after="${options.spacingAfter}"`);
  }
  if (options.lineSpacing !== undefined) {
    spacingAttributes.push(`w:line="${options.lineSpacing}"`);
    spacingAttributes.push(`w:lineRule="${options.lineRule ?? 'auto'}"`);
  }
  if (spacingAttributes.length > 0) {
    paragraphProperties.push(`<w:spacing ${spacingAttributes.join(' ')}/>`);
  }

  const runProperties: string[] = [];
  if (options.bold) {
    runProperties.push('<w:b/>');
  }
  if (options.italic) {
    runProperties.push('<w:i/>', '<w:iCs/>');
  }
  if (options.fontSize) {
    runProperties.push(`<w:sz w:val="${options.fontSize}"/>`);
    runProperties.push(`<w:szCs w:val="${options.fontSize}"/>`);
  }
  if (options.color) {
    runProperties.push(`<w:color w:val="${escapeXml(options.color)}"/>`);
  }
  if (options.fontAscii || options.fontEastAsia) {
    const fontAttributes: string[] = [];
    if (options.fontAscii) {
      const fontAscii = escapeXml(options.fontAscii);
      fontAttributes.push(`w:ascii="${fontAscii}"`, `w:hAnsi="${fontAscii}"`, `w:cs="${fontAscii}"`);
    }
    if (options.fontEastAsia) {
      fontAttributes.push(`w:eastAsia="${escapeXml(options.fontEastAsia)}"`);
    }
    runProperties.push(`<w:rFonts ${fontAttributes.join(' ')}/>`);
  }

  return [
    '<w:p>',
    paragraphProperties.length > 0 ? `<w:pPr>${paragraphProperties.join('')}</w:pPr>` : '',
    '<w:r>',
    runProperties.length > 0 ? `<w:rPr>${runProperties.join('')}</w:rPr>` : '',
    `<w:t>${escapeXml(text)}</w:t>`,
    '</w:r>',
    '</w:p>',
  ].join('');
}

function pageBreakXml() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

type JournalArticleGroup = {
  journalTitle: string;
  articles: Array<{
    article: ArticleSummaryExportInput;
    exportOrder: number;
  }>;
};

function resolveJournalTitle(article: ArticleSummaryExportInput) {
  return cleanText(article.journalTitle);
}

function groupArticlesByJournal(articles: ArticleSummaryExportInput[]): JournalArticleGroup[] {
  const groups: JournalArticleGroup[] = [];
  const groupIndexByTitle = new Map<string, number>();

  articles.forEach((article, index) => {
    const journalTitle = resolveJournalTitle(article);
    const normalizedKey = journalTitle.toLowerCase();
    const existingIndex = groupIndexByTitle.get(normalizedKey);
    const groupArticle = {
      article,
      exportOrder: index + 1,
    };

    if (existingIndex === undefined) {
      groups.push({ journalTitle, articles: [groupArticle] });
      groupIndexByTitle.set(normalizedKey, groups.length - 1);
      return;
    }

    groups[existingIndex].articles.push(groupArticle);
  });

  return groups;
}

type DocumentTranslationProgressReporter = (progress: DocumentTranslationProgress) => void;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancellationError();
  }
}

function resolveTranslationFailureMessage(error: unknown) {
  if (error instanceof AppError) {
    const statusText = error.details?.statusText;
    if (typeof statusText === 'string' && statusText.trim()) {
      return statusText.trim();
    }

    const message = error.details?.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }

    return error.code;
  }

  return error instanceof Error ? error.message : String(error);
}

function createDocxTranslationFailedError(error: unknown, filePath: string) {
  if (isCancellationError(error)) {
    throw error;
  }

  const details: Record<string, unknown> = {
    filePath,
    message: resolveTranslationFailureMessage(error),
  };

  if (error instanceof AppError) {
    details.translationCode = error.code;
    if (error.details) {
      details.translationDetails = error.details;
    }
  }

  return documentError(DocumentErrorCode.DocxTranslationFailed, details);
}

function articleParagraphsXml(
  article: ArticleSummaryExportInput,
  indexInJournal: number,
  exportOrder: number,
  locale: SupportedLocale,
) {
  const copy = resolveDocxExportCopy(locale);
  const title = cleanText(article.title) || copy.untitled;
  const abstractLines = normalizeLines(article.abstract);
  const contentLines =
    abstractLines.length > 0 ? abstractLines : [copy.unknown];

  const paragraphs = [
    paragraphXml(`${exportOrder}. ${title}`, {
      fontSize: docxConfig.article.titleFontSize,
      color: docxConfig.article.bodyColor,
      fontAscii: docxConfig.article.fontAscii,
      fontEastAsia: docxConfig.article.fontEastAsia,
      lineSpacing: docxConfig.article.lineSpacing,
      spacingBefore: indexInJournal === 0 ? 0 : docxConfig.article.titleSpacingBefore,
      spacingAfter: 0,
    }),
    ...contentLines.map((line, lineIndex) =>
      paragraphXml(line, {
        fontSize: docxConfig.article.bodyFontSize,
        color: docxConfig.article.bodyColor,
        fontAscii: docxConfig.article.fontAscii,
        fontEastAsia: docxConfig.article.fontEastAsia,
        lineSpacing: docxConfig.article.lineSpacing,
        spacingAfter:
          lineIndex === contentLines.length - 1 ? 0 : docxConfig.article.abstractLineSpacingAfter,
      }),
    ),
  ];

  return paragraphs.join('');
}

function buildDocumentXml(articles: ArticleSummaryExportInput[], locale: SupportedLocale) {
  const page = docxConfig.page;
  const journalGroups = groupArticlesByJournal(articles);
  const bodyParts: string[] = [];

  journalGroups.forEach((group, groupIndex) => {
    bodyParts.push(
      paragraphXml(group.journalTitle, {
        bold: true,
        fontSize: docxConfig.journal.titleFontSize,
        italic: docxConfig.journal.titleItalic,
        color: docxConfig.journal.titleColor,
        fontAscii: docxConfig.journal.fontAscii,
        fontEastAsia: docxConfig.journal.fontEastAsia,
        lineSpacing: docxConfig.journal.lineSpacing,
        spacingBefore: groupIndex === 0 ? 0 : docxConfig.journal.titleSpacingBefore,
        spacingAfter: docxConfig.journal.titleSpacingAfter,
      }),
    );

    group.articles.forEach(({ article, exportOrder }, articleIndex) => {
      bodyParts.push(articleParagraphsXml(article, articleIndex, exportOrder, locale));
    });

    if (groupIndex < journalGroups.length - 1) {
      bodyParts.push(pageBreakXml());
    }
  });

  bodyParts.push(
    '<w:sectPr>' +
      `<w:pgSz w:w="${page.width}" w:h="${page.height}"/>` +
      `<w:pgMar w:top="${page.marginTop}" w:right="${page.marginRight}" w:bottom="${page.marginBottom}" w:left="${page.marginLeft}" w:header="${page.marginHeader}" w:footer="${page.marginFooter}" w:gutter="${page.marginGutter}"/>` +
      '</w:sectPr>',
  );

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    bodyParts.join(''),
    '</w:body>',
    '</w:document>',
  ].join('');
}


function buildDocxBuffer(articles: ArticleSummaryExportInput[], locale: SupportedLocale) {
  return buildDocxArchiveBuffer({
    documentXml: buildDocumentXml(articles, locale),
    coreTitle: 'Comet Studio Batch Export',
  });
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function resolveSingleJournalDocxFileStem(articles: ArticleSummaryExportInput[], locale: SupportedLocale) {
  if (articles.length === 0) {
    return '';
  }

  const uncategorized = resolveDocxExportCopy(locale).uncategorizedJournal.toLowerCase();
  const uniqueJournalTitles = new Map<string, string>();
  for (const article of articles) {
    const journalTitle = resolveJournalTitle(article);
    const normalizedTitle = journalTitle.toLowerCase();

    if (!uniqueJournalTitles.has(normalizedTitle)) {
      uniqueJournalTitles.set(normalizedTitle, journalTitle);
    }

    if (uniqueJournalTitles.size > 1) {
      return '';
    }
  }

  const onlyTitle = uniqueJournalTitles.values().next().value ?? '';
  if (!onlyTitle || onlyTitle.toLowerCase() === uncategorized) {
    return '';
  }

  return buildPdfDirectoryName(onlyTitle);
}

export function buildBatchDocxFileName(
  {
    articles = [],
    locale = 'en',
    referenceDate = new Date(),
  }: {
    articles?: ArticleSummaryExportInput[];
    locale?: SupportedLocale;
    referenceDate?: Date;
  } = {},
) {
  const preferredFileStem = resolveSingleJournalDocxFileStem(articles, locale);
  if (preferredFileStem) {
    return `${preferredFileStem}.docx`;
  }

  const year = referenceDate.getFullYear();
  const month = pad(referenceDate.getMonth() + 1);
  const day = pad(referenceDate.getDate());
  const hours = pad(referenceDate.getHours());
  const minutes = pad(referenceDate.getMinutes());
  const seconds = pad(referenceDate.getSeconds());

  return `${docxConfig.fileNamePrefix}-${year}${month}${day}-${hours}${minutes}${seconds}.docx`;
}

export async function exportArticlesDocx(
  payload: ExportArticlesDocxPayload = {},
  defaultDownloadDir: string,
  storage: AppStorageService,
  window?: BrowserWindow | null,
  options: {
    onTranslationProgress?: DocumentTranslationProgressReporter;
    signal?: AbortSignal;
  } = {},
): Promise<DocxExportResult | null> {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  if (articles.length === 0) {
    throw documentError(DocumentErrorCode.DocxExportNoArticles);
  }

  const preferredDirectory =
    typeof payload.preferredDirectory === 'string' ? payload.preferredDirectory.trim() : '';
  const locale = resolveSupportedLocale(payload.locale);
  const requestedFilePath =
    typeof payload.targetFilePath === 'string' ? payload.targetFilePath.trim() : '';
  let filePath = requestedFilePath;
  if (!filePath) {
    const dialogCopy = resolveDocxExportDialogCopy(locale);
    const { showSaveDialog } = await import('cs/platform/dialogs/electron-main/dialogMainService');
    const result = await showSaveDialog(
      {
        title: dialogCopy.title,
        buttonLabel: dialogCopy.buttonLabel,
        defaultPath: path.join(
          preferredDirectory || defaultDownloadDir,
          buildBatchDocxFileName({ articles, locale }),
        ),
        filters: [
          {
            name: 'Word Document',
            extensions: ['docx'],
          },
        ],
        properties: ['showOverwriteConfirmation'],
      },
      window,
    );

    if (result.canceled || !result.filePath) {
      return null;
    }

    filePath = result.filePath;
  }

  const outputPath = normalizeDocxPath(filePath);
  throwIfAborted(options.signal);
  const shouldTranslateSummaries = payload.translateSummaries !== false;
  let exportArticles = articles;
  if (shouldTranslateSummaries) {
    try {
      exportArticles = await translateArticleSummariesToChinese(
        articles,
        storage,
        options.onTranslationProgress,
        options.signal,
      );
    } catch (error) {
      throw createDocxTranslationFailedError(error, outputPath);
    }
  }

  throwIfAborted(options.signal);
  return exportArticlesToDocxFile({
    articles: exportArticles,
    filePath: outputPath,
    locale,
    signal: options.signal,
  });
}

export async function exportArticlesToDocxFile({
  articles,
  filePath,
  locale = 'en',
  signal,
}: {
  articles: ArticleSummaryExportInput[];
  filePath: string;
  locale?: SupportedLocale;
  signal?: AbortSignal;
}): Promise<DocxExportResult> {
  if (articles.length === 0) {
    throw documentError(DocumentErrorCode.DocxExportNoArticles);
  }

  const outputPath = normalizeDocxPath(filePath);

  try {
    throwIfAborted(signal);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    throwIfAborted(signal);
    await fs.writeFile(outputPath, buildDocxBuffer(articles, locale));
  } catch (error) {
    if (error instanceof CancellationError) {
      throw error;
    }

    throw documentError(DocumentErrorCode.DocxExportFailed, {
      filePath: outputPath,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    filePath: outputPath,
    articleCount: articles.length,
  };
}
