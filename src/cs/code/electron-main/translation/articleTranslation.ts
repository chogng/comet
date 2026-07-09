import type { Article } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import type { TranslationCacheStore } from 'cs/platform/storage/electron-main/translationCacheStore';
import { translateTextsToChinese } from 'cs/code/electron-main/translation/translationRouter';
import type { TranslationProgressReporter } from 'cs/code/electron-main/translation/translationRouter';

export type TranslatableArticleField = 'descriptionText' | 'abstractText';

export type PreferredArticleTranslationContent = {
  field: TranslatableArticleField;
  text: string;
};

export function resolvePreferredArticleTranslationContent(
  article: Article,
): PreferredArticleTranslationContent | null {
  const description = cleanText(article.descriptionText);
  if (description) {
    return {
      field: 'descriptionText',
      text: description,
    };
  }

  const abstract = cleanText(article.abstractText);
  if (abstract) {
    return {
      field: 'abstractText',
      text: abstract,
    };
  }

  return null;
}

export async function translateArticlesToChinese(
  articles: Article[],
  storage: AppSettingsConfigurationService & TranslationCacheStore,
  onProgress?: TranslationProgressReporter,
  signal?: AbortSignal,
): Promise<Article[]> {
  const selectedContent = articles
    .map((article, index) => {
      const preferredContent = resolvePreferredArticleTranslationContent(article);
      return preferredContent ? { index, ...preferredContent } : null;
    })
    .filter((item): item is { index: number; field: TranslatableArticleField; text: string } => Boolean(item));

  if (selectedContent.length === 0) {
    return articles;
  }

  const settings = await storage.loadSettings();
  const translatedTexts = await translateTextsToChinese(
    selectedContent.map((item) => item.text),
    settings.llm,
    settings.translation,
    storage,
    onProgress,
    signal,
  );
  const translatedArticles = [...articles];

  selectedContent.forEach((item, index) => {
    translatedArticles[item.index] = {
      ...translatedArticles[item.index],
      [item.field]: translatedTexts[index],
    };
  });

  return translatedArticles;
}
