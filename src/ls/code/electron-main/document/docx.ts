import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import type {
  Article,
  DocumentTranslationProgress,
  DocxExportResult,
  ExportArticlesDocxPayload,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { StorageService } from 'ls/platform/storage/common/storage';
import { defaultDocxExportConfig } from 'ls/code/electron-main/document/docxConfig';
import { appError } from 'ls/base/common/errors';
import { resolveDocxExportCopy, resolveDocxExportDialogCopy, resolveSupportedLocale } from 'ls/code/electron-main/document/docxCopy';
import type { SupportedLocale } from 'ls/code/electron-main/document/docxCopy';
import { buildDocxBuffer as buildDocxArchiveBuffer, escapeXml, normalizeDocxPath } from 'ls/code/electron-main/document/docxPackage';

import { cleanText } from 'ls/base/common/strings';
import { showSaveDialog } from 'ls/platform/dialogs/electron-main/dialogMainService';
import { buildPdfDirectoryName } from 'ls/platform/download/common/pdfFileName';
import { translateArticlesToChinese } from 'ls/code/electron-main/translation/articleTranslation';

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
  articles: Article[];
};

function resolveJournalTitle(article: Article, locale: SupportedLocale) {
  const explicitTitle = cleanText(article.journalTitle);
  if (explicitTitle) return explicitTitle;

  const sourceId = cleanText(article.sourceId);
  if (sourceId) return sourceId;

  const sourceUrl = cleanText(article.sourceUrl);
  if (sourceUrl) {
    try {
      const hostname = cleanText(new URL(sourceUrl).hostname.replace(/^www\./i, ''));
      if (hostname) return hostname;
    } catch {
      // Ignore malformed URL and fall back to uncategorized label.
    }
  }

  return resolveDocxExportCopy(locale).uncategorizedJournal;
}

function groupArticlesByJournal(articles: Article[], locale: SupportedLocale): JournalArticleGroup[] {
  const groups: JournalArticleGroup[] = [];
  const groupIndexByTitle = new Map<string, number>();

  for (const article of articles) {
    const journalTitle = resolveJournalTitle(article, locale);
    const normalizedKey = journalTitle.toLowerCase();
    const existingIndex = groupIndexByTitle.get(normalizedKey);

    if (existingIndex === undefined) {
      groups.push({ journalTitle, articles: [article] });
      groupIndexByTitle.set(normalizedKey, groups.length - 1);
      continue;
    }

    groups[existingIndex].articles.push(article);
  }

  return groups;
}

type DocumentTranslationProgressReporter = (progress: DocumentTranslationProgress) => void;

async function translateDocxArticlesToChinese(
  articles: Article[],
  storage: StorageService,
  onProgress?: DocumentTranslationProgressReporter,
) {
  try {
    return await translateArticlesToChinese(articles, storage, onProgress);
  } catch (error) {
    onProgress?.({
      phase: 'failed',
      current: 0,
      total: 0,
      provider: '',
      model: '',
      message: error instanceof Error ? error.message : String(error),
    });
    return articles;
  }
}

function articleParagraphsXml(article: Article, indexInJournal: number, locale: SupportedLocale) {
  const copy = resolveDocxExportCopy(locale);
  const title = cleanText(article.title) || copy.untitled;
  const descriptionLines = normalizeLines(article.descriptionText);
  const abstractLines = normalizeLines(article.abstractText);
  const contentLines =
    descriptionLines.length > 0
      ? descriptionLines
      : abstractLines.length > 0
        ? abstractLines
        : [copy.unknown];

  const paragraphs = [
    paragraphXml(`${indexInJournal + 1}. ${title}`, {
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

function buildDocumentXml(articles: Article[], locale: SupportedLocale) {
  const page = docxConfig.page;
  const journalGroups = groupArticlesByJournal(articles, locale);
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

    group.articles.forEach((article, articleIndex) => {
      bodyParts.push(articleParagraphsXml(article, articleIndex, locale));
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


function buildDocxBuffer(articles: Article[], locale: SupportedLocale) {
  return buildDocxArchiveBuffer({
    documentXml: buildDocumentXml(articles, locale),
    coreTitle: 'Literature Studio Batch Export',
  });
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function resolveSingleJournalDocxFileStem(articles: Article[], locale: SupportedLocale) {
  if (articles.length === 0) {
    return '';
  }

  const uncategorized = resolveDocxExportCopy(locale).uncategorizedJournal.toLowerCase();
  const uniqueJournalTitles = new Map<string, string>();
  for (const article of articles) {
    const journalTitle = resolveJournalTitle(article, locale);
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
    locale = 'zh',
    referenceDate = new Date(),
  }: {
    articles?: Article[];
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
  storage: StorageService,
  window?: BrowserWindow | null,
  options: { onTranslationProgress?: DocumentTranslationProgressReporter } = {},
): Promise<DocxExportResult | null> {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  if (articles.length === 0) {
    throw appError('DOCX_EXPORT_NO_ARTICLES');
  }

  const preferredDirectory =
    typeof payload.preferredDirectory === 'string' ? payload.preferredDirectory.trim() : '';
  const locale = resolveSupportedLocale(payload.locale);
  const dialogCopy = resolveDocxExportDialogCopy(locale);
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

  return exportArticlesToDocxFile({
    articles: await translateDocxArticlesToChinese(articles, storage, options.onTranslationProgress),
    filePath: result.filePath,
    locale,
  });
}

export async function exportArticlesToDocxFile({
  articles,
  filePath,
  locale = 'zh',
}: {
  articles: Article[];
  filePath: string;
  locale?: SupportedLocale;
}): Promise<DocxExportResult> {
  if (articles.length === 0) {
    throw appError('DOCX_EXPORT_NO_ARTICLES');
  }

  const outputPath = normalizeDocxPath(filePath);

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, buildDocxBuffer(articles, locale));
  } catch (error) {
    throw appError('DOCX_EXPORT_FAILED', {
      filePath: outputPath,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    filePath: outputPath,
    articleCount: articles.length,
  };
}
