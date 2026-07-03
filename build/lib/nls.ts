import { detectInitialLocale, getLocaleMessages } from './i18n';
import type { Locale } from './i18n';

type LocalizePrimitiveValue = string | number | boolean | undefined | null;
type LocalizeNamedValues = Record<string, LocalizePrimitiveValue>;
type LocalizeValue = LocalizePrimitiveValue | LocalizeNamedValues;

let currentLocale: Locale = detectInitialLocale();

export function setNLSLanguage(locale: Locale): void {
	currentLocale = locale;
}

function getMessage(key: string): string {
	const messages = getLocaleMessages(currentLocale) as Record<string, string>;
	const message = messages[key];
	if (typeof message === 'string') {
		return message;
	}

	throw new Error(`Missing localized string: ${key}`);
}

function isNamedValues(value: LocalizeValue): value is LocalizeNamedValues {
	return typeof value === 'object' && value !== null;
}

function stringifyValue(value: LocalizePrimitiveValue): string {
	return String(value);
}

function formatMessage(message: string, values: LocalizeValue[]): string {
	const namedValues = values.find(isNamedValues);
	return message.replace(/\{(\w+)\}/g, (match, name) => {
		if (/^\d+$/.test(name)) {
			const index = Number(name);
			if (index >= values.length) {
				throw new Error(`Missing localized value: ${name}`);
			}

			const value = values[index];
			return isNamedValues(value) ? match : stringifyValue(value);
		}

		if (!namedValues || !Object.prototype.hasOwnProperty.call(namedValues, name)) {
			throw new Error(`Missing localized value: ${name}`);
		}

		return stringifyValue(namedValues[name]);
	});
}

export function localize(
	key: string,
	_message: string,
	...values: LocalizeValue[]
): string {
	return formatMessage(getMessage(key), values);
}
