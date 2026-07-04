import type { LocaleMessages } from 'language/locales';
import {
  createBuiltInLanguagePackItems,
  type LanguagePackLocale,
} from 'cs/platform/languagePacks/common/languagePacks';

export type LocalizationUiAction = {
  type: 'SET_DISPLAY_LANGUAGE';
  locale: LanguagePackLocale;
};

export type DisplayLanguageOption = {
  value: LanguagePackLocale;
  label: string;
};

type LocalizationUiActionListener = (action: LocalizationUiAction) => void;

const listeners = new Set<LocalizationUiActionListener>();

function emitLocalizationUiAction(action: LocalizationUiAction) {
  for (const listener of listeners) {
    listener(action);
  }
}

export function subscribeLocalizationUiActions(
  listener: LocalizationUiActionListener,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestSetDisplayLanguage(locale: LanguagePackLocale) {
  emitLocalizationUiAction({
    type: 'SET_DISPLAY_LANGUAGE',
    locale,
  });
}

export function createDisplayLanguageOptions(
  labels: Pick<LocaleMessages, 'languageChinese' | 'languageEnglish'>,
): DisplayLanguageOption[] {
  return createBuiltInLanguagePackItems(labels).map((item) => ({
    value: item.id,
    label: item.label,
  }));
}
