import type { ArticleSummaryExportInput } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import type { TranslationCacheStore } from 'cs/platform/storage/electron-main/translationCacheStore';
import { translateTextsToChinese } from 'cs/code/electron-main/translation/translationRouter';
import type { TranslationProgressReporter } from 'cs/code/electron-main/translation/translationRouter';

export async function translateArticleSummariesToChinese(
  articles: ArticleSummaryExportInput[],
  storage: AppSettingsConfigurationService & TranslationCacheStore,
  onProgress?: TranslationProgressReporter,
  signal?: AbortSignal,
): Promise<ArticleSummaryExportInput[]> {
  const selectedContent = articles
    .map((article, articleIndex) => ({ articleIndex, text: cleanText(article.abstract) }))
    .filter((item): item is { articleIndex: number; text: string } => Boolean(item.text));

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
  const abstractTranslations = new Map<number, string>();
  selectedContent.forEach((item, index) => {
    abstractTranslations.set(item.articleIndex, translatedTexts[index]);
  });

  return articles.map((article, articleIndex) => {
    if (!cleanText(article.abstract)) {
      return article;
    }

    return {
      ...article,
      abstract: abstractTranslations.get(articleIndex),
    };
  });
}
