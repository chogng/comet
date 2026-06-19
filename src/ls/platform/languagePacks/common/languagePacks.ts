import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';

export type LanguagePackLocale = Locale;

export type LanguagePackItem = {
  readonly id: LanguagePackLocale;
  readonly label: string;
};

export const supportedLanguagePackLocales: readonly LanguagePackLocale[] = [
  'zh',
  'en',
];

export function isSupportedLanguagePackLocale(value: unknown): value is LanguagePackLocale {
  return value === 'zh' || value === 'en';
}

export function createBuiltInLanguagePackItems(
  labels: Pick<LocaleMessages, 'languageChinese' | 'languageEnglish'>,
): LanguagePackItem[] {
  return [
    {
      id: 'zh',
      label: labels.languageChinese,
    },
    {
      id: 'en',
      label: labels.languageEnglish,
    },
  ];
}
