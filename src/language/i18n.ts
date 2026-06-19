import { locales } from 'language/locales';
import type { LocaleMessages } from 'language/locales';

export type Locale = keyof typeof locales;

export function detectInitialLocale(): Locale {
  return 'en';
}

export function toDocumentLang(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function getLocaleMessages(locale: Locale): LocaleMessages {
  return locales[locale];
}
