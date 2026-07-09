import { readFile } from 'node:fs/promises';

import { buildArticleFromHtml } from 'cs/workbench/services/fetch/electron-main/parser';

async function main() {
  const [, , sourceUrl, htmlPath] = process.argv;
  if (!sourceUrl || !htmlPath) {
    console.error('Usage: node parseArticleTest.js <source-url> <html-path>');
    process.exitCode = 1;
    return;
  }

  const html = await readFile(htmlPath, 'utf8');
  const article = buildArticleFromHtml(sourceUrl, html);

  const payload = {
    title: article.title,
    articleType: article.articleType,
    doi: article.doi,
    authors: article.authors,
    abstractLength: article.abstractText?.length ?? 0,
    abstractPreview: article.abstractText?.slice(0, 300) ?? null,
    descriptionLength: article.descriptionText?.length ?? 0,
    descriptionPreview: article.descriptionText?.slice(0, 600) ?? null,
    descriptionTail: article.descriptionText?.slice(-2000) ?? null,
    figureCount: article.figures?.length ?? 0,
    figures: article.figures ?? [],
    publishedAt: article.publishedAt,
  };

  console.log(JSON.stringify(payload, null, 2));
}

void main();
