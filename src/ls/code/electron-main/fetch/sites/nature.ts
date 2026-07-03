import { load } from 'cheerio';

import type { ArticleFigure } from 'ls/base/parts/sandbox/common/sandboxTypes';
import { cleanText, pickFirstNonEmpty, uniq } from 'ls/base/common/strings';

export function isNatureArticlePage($: ReturnType<typeof load>) {
  return (
    $('.c-article-header').length > 0 ||
    $('.c-article-body').length > 0 ||
    $('[id="Abs1-content"]').length > 0 ||
    $('[id="Sec1-content"]').length > 0
  );
}

export function extractNatureFigureCaptions($: ReturnType<typeof load>) {
  const captions: string[] = [];

  $('[id^="figure-"]').each((_, node) => {
    const root = $(node);
    const title = cleanText(
      root.find('[data-test="figure-caption-text"], figcaption, .c-article-section__figure-caption').first().text(),
    );
    const description = cleanText(
      root.find('[data-test="bottom-caption"], .c-article-section__figure-description').first().text(),
    );
    const combined = [title, description].filter(Boolean).join('\n');
    if (combined) {
      captions.push(combined);
    }
  });

  return captions;
}

export function extractNatureFigures($: ReturnType<typeof load>, sourceUrl: string): ArticleFigure[] {
  const pageUrl = new URL(sourceUrl);

  return $('[id^="figure-"]')
    .map((_, node) => {
      const root = $(node);
      const id = cleanText(root.attr('id')) || null;
      const title = cleanText(
        root.find('[data-test="figure-caption-text"], figcaption, .c-article-section__figure-caption').first().text(),
      ) || null;
      const captionText = cleanText(
        root.find('[data-test="bottom-caption"], .c-article-section__figure-description').first().text(),
      ) || null;

      const imageSrc = cleanText(
        root.find('img').first().attr('src') || root.find('source').first().attr('srcset'),
      );
      const fullSizeHref = cleanText(
        root.find('a[href*="/figures/"], a[aria-label*="Full size image" i]').first().attr('href'),
      );

      const imageUrl = imageSrc ? new URL(imageSrc, pageUrl).toString() : null;
      const fullSizeUrl = fullSizeHref ? new URL(fullSizeHref, pageUrl).toString() : null;

      if (!title && !captionText && !imageUrl && !fullSizeUrl) {
        return null;
      }

      return {
        id,
        title,
        captionText,
        imageUrl,
        fullSizeUrl,
      } satisfies ArticleFigure;
    })
    .get()
    .filter((figure): figure is ArticleFigure => figure !== null);
}

export function extractNatureAbstract($: ReturnType<typeof load>) {
  return pickFirstNonEmpty([
    cleanText($('#Abs1-content').first().text()),
    cleanText($('section[aria-labelledby="Abs1-heading"] #Abs1-content').first().text()),
    cleanText($('.c-article-section__content[id="Abs1-content"]').first().text()),
  ]);
}

export function extractNatureMainText($: ReturnType<typeof load>) {
  const sectionTexts = $('.c-article-body .main-content .c-article-section__content[id^="Sec"]')
    .map((_, node) => cleanText($(node).text()))
    .get()
    .filter(Boolean);

  if (sectionTexts.length > 0) {
    return sectionTexts.join('\n\n');
  }

  return pickFirstNonEmpty([
    cleanText($('#Sec1-content').first().text()),
    cleanText($('.c-article-body #Sec1-content').first().text()),
    cleanText($('.c-article-body .main-content').first().text()),
  ]);
}

export function extractNatureReferenceTexts($: ReturnType<typeof load>) {
  return $('#Bib1-content .c-article-references__text')
    .map((_, node) => cleanText($(node).text()))
    .get()
    .filter(Boolean);
}

export function extractNatureHeaderAuthors($: ReturnType<typeof load>) {
  return uniq(
    $('.c-article-header [data-test="author-name"], .c-article-header .c-article-author-list__item')
      .map((_, node) => cleanText($(node).text()))
      .get()
      .filter(Boolean),
  );
}
