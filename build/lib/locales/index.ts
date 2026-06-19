import en from './en';
import zh from './zh';

export type LocaleMessages = {
  [Key in keyof typeof zh]: string;
};

export const locales: Record<'zh' | 'en', LocaleMessages> = {
  zh,
  en,
};
