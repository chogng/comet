import type { FetchArticle, FetchArticleSection } from 'cs/base/parts/sandbox/common/fetchArticle';
import { cleanText } from 'cs/base/common/strings';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import type { TranslationCacheStore } from 'cs/platform/storage/electron-main/translationCacheStore';
import { translateTextsToChinese } from 'cs/code/electron-main/translation/translationRouter';
import type { TranslationProgressReporter } from 'cs/code/electron-main/translation/translationRouter';

interface ArticleTranslationUnit {
  readonly articleIndex: number;
  readonly field: 'section' | 'abstract';
  readonly sectionPath?: readonly number[];
  readonly text: string;
}

function collectSectionTranslationUnits(
  articleIndex: number,
  sections: readonly FetchArticleSection[],
  target: ArticleTranslationUnit[],
  parentPath: readonly number[] = [],
): void {
  sections.forEach((section, sectionIndex) => {
    const sectionPath = [...parentPath, sectionIndex];
    const content = cleanText(section.content);
    if (content) {
      target.push({ articleIndex, field: 'section', sectionPath, text: content });
    }
    if (section.children) {
      collectSectionTranslationUnits(articleIndex, section.children, target, sectionPath);
    }
  });
}

function sectionTranslationKey(articleIndex: number, sectionPath: readonly number[]): string {
  return `${articleIndex}:${sectionPath.join('.')}`;
}

function applySectionTranslations(
  articleIndex: number,
  sections: readonly FetchArticleSection[],
  translations: ReadonlyMap<string, string>,
  parentPath: readonly number[] = [],
): readonly FetchArticleSection[] {
  return sections.map((section, sectionIndex) => {
    const sectionPath = [...parentPath, sectionIndex];
    const translatedContent = translations.get(sectionTranslationKey(articleIndex, sectionPath));
    return {
      ...section,
      content: translatedContent ?? section.content,
      ...(section.children ? {
        children: applySectionTranslations(articleIndex, section.children, translations, sectionPath),
      } : {}),
    };
  });
}

export async function translateArticlesToChinese(
  articles: FetchArticle[],
  storage: AppSettingsConfigurationService & TranslationCacheStore,
  onProgress?: TranslationProgressReporter,
  signal?: AbortSignal,
): Promise<FetchArticle[]> {
  const selectedContent: ArticleTranslationUnit[] = [];
  articles.forEach((article, articleIndex) => {
    const firstSectionUnit = selectedContent.length;
    collectSectionTranslationUnits(articleIndex, article.sections, selectedContent);
    if (selectedContent.length === firstSectionUnit) {
      const abstract = cleanText(article.abstract);
      if (abstract) {
        selectedContent.push({ articleIndex, field: 'abstract', text: abstract });
      }
    }
  });

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
  const sectionTranslations = new Map<string, string>();
  const abstractTranslations = new Map<number, string>();
  selectedContent.forEach((item, index) => {
    if (item.field === 'section' && item.sectionPath) {
      sectionTranslations.set(
        sectionTranslationKey(item.articleIndex, item.sectionPath),
        translatedTexts[index],
      );
    } else {
      abstractTranslations.set(item.articleIndex, translatedTexts[index]);
    }
  });

  return articles.map((article, articleIndex) => ({
    ...article,
    sections: applySectionTranslations(articleIndex, article.sections, sectionTranslations),
    abstract: abstractTranslations.get(articleIndex) ?? article.abstract,
  }));
}
