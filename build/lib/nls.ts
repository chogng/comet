import { detectInitialLocale, getLocaleMessages } from './i18n';
import type { Locale } from './i18n';

export interface ILocalizeInfo {
  key: string;
  comment: string[];
}

export interface ILocalizedString {
  original: string;
  value: string;
}

type LocalizeArg = string | number | boolean | undefined | null;

type GlobalNls = typeof globalThis & {
  _VSCODE_NLS_MESSAGES?: string[];
  _VSCODE_NLS_LANGUAGE?: string;
};

let currentLocale: Locale = detectInitialLocale();

export function setNLSLanguage(locale: Locale): void {
  currentLocale = locale;
  (globalThis as GlobalNls)._VSCODE_NLS_LANGUAGE = locale;
}

export function getNLSMessages(): string[] | undefined {
  return (globalThis as GlobalNls)._VSCODE_NLS_MESSAGES;
}

export function getNLSLanguage(): string | undefined {
  return (globalThis as GlobalNls)._VSCODE_NLS_LANGUAGE ?? currentLocale;
}

function getLocalizeKey(data: ILocalizeInfo | string | number): string | null {
  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'object') {
    return data.key;
  }

  return null;
}

function lookupLocaleMessage(key: string, fallback: string): string {
  const messages = getLocaleMessages(currentLocale) as Record<string, string>;
  return messages[key] ?? fallback;
}

function lookupMessage(index: number, fallback: string | null): string {
  const message = getNLSMessages()?.[index];
  if (typeof message === 'string') {
    return message;
  }

  if (typeof fallback === 'string') {
    return fallback;
  }

  throw new Error(`!!! NLS MISSING: ${index} !!!`);
}

function format(message: string, args: LocalizeArg[]): string {
  if (args.length === 0) {
    return message;
  }

  return message.replace(/\{(\d+)\}/g, (match, rest) => {
    const index = Number(rest);
    const arg = args[index];
    if (
      typeof arg === 'string' ||
      typeof arg === 'number' ||
      typeof arg === 'boolean' ||
      arg === undefined ||
      arg === null
    ) {
      return String(arg);
    }

    return match;
  });
}

export function localize(info: ILocalizeInfo, message: string, ...args: LocalizeArg[]): string;
export function localize(key: string, message: string, ...args: LocalizeArg[]): string;
export function localize(
  data: ILocalizeInfo | string | number,
  message: string | null,
  ...args: LocalizeArg[]
): string {
  const resolvedMessage =
    typeof data === 'number'
      ? lookupMessage(data, message)
      : lookupLocaleMessage(getLocalizeKey(data) ?? '', message ?? '');

  return format(resolvedMessage, args);
}

export function localize2(
  info: ILocalizeInfo,
  message: string,
  ...args: LocalizeArg[]
): ILocalizedString;
export function localize2(
  key: string,
  message: string,
  ...args: LocalizeArg[]
): ILocalizedString;
export function localize2(
  data: ILocalizeInfo | string | number,
  originalMessage: string,
  ...args: LocalizeArg[]
): ILocalizedString {
  const message =
    typeof data === 'number'
      ? lookupMessage(data, originalMessage)
      : lookupLocaleMessage(getLocalizeKey(data) ?? '', originalMessage);
  const value = format(message, args);

  return {
    value,
    original: originalMessage === message ? value : format(originalMessage, args),
  };
}
