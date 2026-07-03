import { locales } from './locales';
import type { Locale, LocaleMessages } from './locales';

export type { Locale };

export function detectInitialLocale(): Locale {
	return 'en';
}

export function toDocumentLang(locale: Locale): string {
	return locale === 'zh' ? 'zh-CN' : 'en';
}

export function getLocaleMessages(locale: Locale): LocaleMessages {
	return locales[locale];
}
