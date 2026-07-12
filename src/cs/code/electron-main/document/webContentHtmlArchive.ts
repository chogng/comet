/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { load } from 'cheerio';

import type {
	WebContentHtmlArchivePayload,
	WebContentHtmlArchiveResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { cleanText } from 'cs/base/common/strings';
import { buildPdfDirectoryName } from 'cs/platform/download/common/pdfFileName';
import type { IPlaywrightService } from 'cs/platform/browserView/common/playwrightService';
import { previewDownloadPdf } from 'cs/code/electron-main/pdf/pdf';
import type { AppStorageService } from 'cs/code/electron-main/storageService';
import {
	canonicalizeWebContentArchiveUrl,
	captureWebContentArchiveSnapshot,
} from 'cs/code/electron-main/document/webContentArchiveSnapshot';

function resolveSourceHostLabel(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return '';
  }
}

interface ArchivePageMetadata {
  readonly title: string;
  readonly sourceUrl: string;
  readonly archivedAt: string;
}

function buildArchiveStem(page: Pick<ArchivePageMetadata, 'title' | 'sourceUrl'>) {
  return (
    buildPdfDirectoryName(page.title) ||
    buildPdfDirectoryName(resolveSourceHostLabel(page.sourceUrl)) ||
    `page-${Date.now()}`
  );
}

async function resolveUniqueArchiveDirectory(
  archiveRootDirectory: string,
  page: Pick<ArchivePageMetadata, 'title' | 'sourceUrl'>,
) {
  const baseStem = buildArchiveStem(page);

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

  if (head.find('meta[name="comet-studio-source-url"]').length === 0) {
    head.append(`<meta name="comet-studio-source-url" content="${sourceUrl}">`);
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

function buildArchiveTextContent(page: ArchivePageMetadata, extractedText: string) {
  const lines = [
    `Title: ${cleanText(page.title) || 'Untitled'}`,
    `Source URL: ${cleanText(page.sourceUrl) || '-'}`,
    `Archived At: ${page.archivedAt}`,
    '',
    extractedText,
  ].filter(Boolean);

  return `${lines.join('\n')}\n`;
}

function resolveArchivePageMetadata(
	sourceUrl: string,
	snapshotHtml: string,
	snapshotTitle: string,
): ArchivePageMetadata {
	const $ = load(snapshotHtml);
	const title = cleanText(snapshotTitle) ||
    cleanText($('title').first().text()) ||
    cleanText($('h1').first().text()) ||
    resolveSourceHostLabel(sourceUrl) ||
    'Untitled';
  return {
    title,
    sourceUrl,
    archivedAt: new Date().toISOString(),
  };
}

export async function archiveWebContentHtml(
	payload: WebContentHtmlArchivePayload,
	defaultDownloadDirectory: string,
	storage: AppStorageService,
	playwrightService: IPlaywrightService,
	token: CancellationToken,
): Promise<WebContentHtmlArchiveResult> {
	const requestedUrl = canonicalizeWebContentArchiveUrl(payload.pageUrl);
	const snapshot = await captureWebContentArchiveSnapshot(
		payload.browserViewId.trim(),
		requestedUrl,
		playwrightService,
		token,
	);
	const sourceUrl = canonicalizeWebContentArchiveUrl(snapshot.uri.toString(true));
	const snapshotHtml = snapshot.html;

	const page = resolveArchivePageMetadata(sourceUrl, snapshotHtml, snapshot.title);
  const archiveRootDirectory = path.join(
    defaultDownloadDirectory,
    'Comet Studio Archive',
  );
  await fs.mkdir(archiveRootDirectory, { recursive: true });
  const archiveEntry = await resolveUniqueArchiveDirectory(
    archiveRootDirectory,
    page,
  );

  const htmlPath = path.join(archiveEntry.directoryPath, `${archiveEntry.stem}.html`);
  const textPath = path.join(archiveEntry.directoryPath, `${archiveEntry.stem}.txt`);
  const normalizedExtractedText = normalizeTextBlock(
    extractStructuredTextFromHtml(snapshotHtml),
  );
  await fs.writeFile(
    htmlPath,
    ensureArchiveHtmlDocument(snapshotHtml, sourceUrl),
    'utf8',
  );
  await fs.writeFile(
    textPath,
    buildArchiveTextContent(page, normalizedExtractedText),
    'utf8',
  );

  let pdfPath: string | null = null;
  let pdfSourceUrl: string | null = null;
  try {
    const pdfResult = await previewDownloadPdf({
		payload: {
			pageUrl: sourceUrl,
			articleTitle: page.title,
			customDownloadDir: archiveEntry.directoryPath,
		},
		defaultDownloadDir: defaultDownloadDirectory,
		webContentHtmlSnapshot: snapshotHtml,
	});
    pdfPath = cleanText(pdfResult.filePath) || null;
    pdfSourceUrl = cleanText(pdfResult.sourceUrl) || null;
    if (pdfPath) {
      try {
        await storage.registerLibraryDocument({
          filePath: pdfPath,
          sourceUrl,
          sourceId: null,
          doi: null,
          articleTitle: page.title,
          authors: [],
          journalTitle: null,
          publishedAt: null,
        });
      } catch (registrationError) {
        console.error('Failed to register archived PDF in the library.', registrationError);
      }
    }
  } catch (pdfError) {
    console.error('Failed to generate companion PDF for archived web content.', pdfError);
  }

  return {
    filePath: htmlPath,
    htmlPath,
    textPath,
    pdfPath,
    title: page.title,
    sourceUrl,
    pdfSourceUrl,
    extractedText: normalizedExtractedText,
  };
}
