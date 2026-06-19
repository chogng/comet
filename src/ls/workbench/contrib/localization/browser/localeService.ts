import { EventEmitter } from 'ls/base/common/event';
import { setNLSLanguage } from 'ls/nls';
import { detectInitialLocale, toDocumentLang } from 'language/i18n';
import type { Locale } from 'language/i18n';

import {
  loadAppSettings,
  saveAppSettingsPartial,
} from 'ls/workbench/services/settings/settingsService';
import type {
  ILocaleService,
  LocaleServiceContext,
} from 'ls/workbench/contrib/localization/common/locale';

const LOCALE_STORAGE_KEY = 'ls.workbench.locale';

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return storedLocale === 'zh' || storedLocale === 'en' ? storedLocale : null;
}

function persistStoredLocale(locale: Locale) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

class BrowserLocaleService implements ILocaleService {
  private currentLocale = readStoredLocale() ?? detectInitialLocale();
  private readonly onDidChangeEmitter = new EventEmitter<void>();

  constructor() {
    setNLSLanguage(this.currentLocale);
  }

  subscribe(listener: () => void) {
    return this.onDidChangeEmitter.event(listener);
  }

  getLocale() {
    return this.currentLocale;
  }

  applyLocale(locale: Locale) {
    persistStoredLocale(locale);
    setNLSLanguage(locale);

    if (this.currentLocale === locale) {
      this.syncDocumentLanguage();
      return;
    }

    this.currentLocale = locale;
    this.syncDocumentLanguage();
    this.onDidChangeEmitter.fire();
  }

  async updateLocalePreference(locale: Locale, context: LocaleServiceContext) {
    this.applyLocale(locale);
    await saveAppSettingsPartial(context.desktopRuntime, context.invokeDesktop, {
      locale,
    });
  }

  syncDocumentLanguage() {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.lang = toDocumentLang(this.currentLocale);
  }

  async initialize(context: LocaleServiceContext) {
    const loadedSettings = await loadAppSettings(
      context.desktopRuntime,
      context.invokeDesktop,
    );
    const loadedLocale =
      loadedSettings.locale === 'zh' || loadedSettings.locale === 'en'
        ? loadedSettings.locale
        : null;

    if (loadedLocale) {
      this.applyLocale(loadedLocale);
    } else {
      this.syncDocumentLanguage();
    }

    return this.getLocale();
  }
}

export const localeService = new BrowserLocaleService();
