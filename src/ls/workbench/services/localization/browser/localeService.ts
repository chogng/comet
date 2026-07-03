import { EventEmitter } from 'ls/base/common/event';
import { detectInitialLocale, toDocumentLang } from 'language/i18n';
import {
  isSupportedLanguagePackLocale,
  type LanguagePackLocale,
} from 'ls/platform/languagePacks/common/languagePacks';

import {
  loadAppSettings,
  saveAppSettingsPartial,
} from 'ls/workbench/services/settings/settingsService';
import {
  registerWorkbenchService,
} from 'ls/workbench/services/instantiation/browser/workbenchInstantiationService';
import {
  IWorkbenchLocaleService,
  type LocaleServiceContext,
} from 'ls/workbench/services/localization/common/locale';

const LOCALE_STORAGE_KEY = 'ls.workbench.locale';

function readStoredLocale(): LanguagePackLocale | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isSupportedLanguagePackLocale(storedLocale) ? storedLocale : null;
}

function persistStoredLocale(locale: LanguagePackLocale) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

class BrowserWorkbenchLocaleService implements IWorkbenchLocaleService {
  declare readonly _serviceBrand: undefined;

  private currentLocale = readStoredLocale() ?? detectInitialLocale();
  private readonly onDidChangeEmitter = new EventEmitter<void>();

  subscribe(listener: () => void) {
    return this.onDidChangeEmitter.event(listener);
  }

  getLocale() {
    return this.currentLocale;
  }

  applyLocale(locale: LanguagePackLocale) {
    persistStoredLocale(locale);

    if (this.currentLocale === locale) {
      this.syncDocumentLanguage();
      return;
    }

    this.currentLocale = locale;
    this.syncDocumentLanguage();
    this.onDidChangeEmitter.fire();
  }

  async updateLocalePreference(
    locale: LanguagePackLocale,
    context: LocaleServiceContext,
  ) {
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
    const loadedLocale = isSupportedLanguagePackLocale(loadedSettings.locale)
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

export const localeService = new BrowserWorkbenchLocaleService();

export function createWorkbenchLocaleService(): IWorkbenchLocaleService {
  return localeService;
}

registerWorkbenchService(IWorkbenchLocaleService, localeService);

export {
  IWorkbenchLocaleService,
} from 'ls/workbench/services/localization/common/locale';
export type {
  LocaleServiceContext,
} from 'ls/workbench/services/localization/common/locale';
