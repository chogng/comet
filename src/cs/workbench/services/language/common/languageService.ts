import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
	detectInitialLocale,
	getLocaleMessages,
	toDocumentLang,
	type Locale,
} from 'language/i18n';
import type { LocaleMessages } from 'language/locales';

export const IWorkbenchLanguageService =
	createDecorator<IWorkbenchLanguageService>('workbenchLanguageService');

export interface IWorkbenchLanguageService {
	readonly _serviceBrand: undefined;
	detectInitialLocale(): Locale;
	getLocaleMessages(locale: Locale): LocaleMessages;
	toDocumentLang(locale: Locale): string;
}

export class WorkbenchLanguageService implements IWorkbenchLanguageService {
	declare readonly _serviceBrand: undefined;

	detectInitialLocale() {
		return detectInitialLocale();
	}

	getLocaleMessages(locale: Locale) {
		return getLocaleMessages(locale);
	}

	toDocumentLang(locale: Locale) {
		return toDocumentLang(locale);
	}
}

registerSingleton(
	IWorkbenchLanguageService,
	WorkbenchLanguageService,
	InstantiationType.Delayed,
);
