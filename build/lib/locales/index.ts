import en from './en.json';
import zh from './zh.json';

export type LocaleMessages = {
	[Key in keyof typeof zh]: string;
};

export type Locale = 'zh' | 'en';

export const locales: Record<Locale, LocaleMessages> = {
	zh,
	en,
};
