/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AppErrorData } from 'cs/base/parts/sandbox/common/appError';
import type { LocaleMessages } from 'language/locales';

export function formatLocaleMessage(template: string, values: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (_, key: string) => {
		const value = values[key];
		return value === undefined ? '' : String(value);
	});
}

function detailValue(details: Record<string, unknown> | undefined, key: string, fallback = ''): string {
	const value = details?.[key];
	return value === undefined || value === null ? fallback : String(value);
}

export function localizeAppError(ui: LocaleMessages, error: AppErrorData): string {
	const details = error.details;

	switch (error.code) {
		case 'MAIN_WINDOW_UNAVAILABLE':
			return ui.errorMainWindowUnavailable;
		case 'UNKNOWN_COMMAND':
			return formatLocaleMessage(ui.errorUnknownCommand, {
				command: detailValue(details, 'command', '?'),
			});
		case 'URL_EMPTY':
			return ui.errorUrlEmpty;
		case 'URL_PROTOCOL_UNSUPPORTED':
			return formatLocaleMessage(ui.errorUrlProtocolUnsupported, {
				protocol: detailValue(details, 'protocol', '?'),
			});
		case 'DATE_START_INVALID':
			return formatLocaleMessage(ui.errorDateStartInvalid, {
				value: detailValue(details, 'value', '?'),
			});
		case 'DATE_END_INVALID':
			return formatLocaleMessage(ui.errorDateEndInvalid, {
				value: detailValue(details, 'value', '?'),
			});
		case 'DATE_RANGE_INVALID':
			return ui.errorDateRangeInvalid;
		case 'HTTP_REQUEST_FAILED':
			return formatLocaleMessage(ui.errorHttpRequestFailed, {
				status: detailValue(details, 'status', '?'),
				statusText: detailValue(details, 'statusText', ''),
			}).trim();
		case 'PDF_LINK_NOT_FOUND':
			return ui.errorPdfLinkNotFound;
		case 'PDF_DOWNLOAD_FAILED':
			return formatLocaleMessage(ui.errorPdfDownloadFailed, {
				status: detailValue(details, 'status', '?'),
				statusText: detailValue(details, 'statusText', ''),
			}).trim();
		case 'DOCX_EXPORT_NO_ARTICLES':
			return ui.errorDocxExportNoArticles;
		case 'DOCX_TRANSLATION_FAILED':
			{
				const translationCode = detailValue(details, 'translationCode');
				const translationDetailsValue = details?.translationDetails;
				const translationDetails = typeof translationDetailsValue === 'object' && translationDetailsValue !== null
					? translationDetailsValue as Record<string, unknown>
					: undefined;
				const translationError = translationCode
					? localizeAppError(ui, {
						code: translationCode,
						message: detailValue(details, 'message', error.message || ui.errorUnknown),
						details: translationDetails,
					})
					: detailValue(details, 'message', error.message || ui.errorUnknown);

				return formatLocaleMessage(ui.errorDocxTranslationFailed, {
					error: translationError,
				});
			}
		case 'DOCX_EXPORT_FAILED':
			return formatLocaleMessage(ui.errorDocxExportFailed, {
				error: detailValue(details, 'message', error.message || ui.errorUnknown),
			});
		case 'PREVIEW_NOT_READY':
			return ui.errorWebContentNotReady;
		case 'LLM_PROVIDER_UNSUPPORTED':
			return formatLocaleMessage(ui.errorLlmProviderUnsupported, {
				provider: detailValue(details, 'provider', '?'),
			});
		case 'LLM_API_KEY_MISSING':
			return ui.errorLlmApiKeyMissing;
		case 'LLM_MODEL_MISSING':
			return ui.errorLlmModelMissing;
		case 'LLM_BASE_URL_INVALID':
			return formatLocaleMessage(ui.errorLlmBaseUrlInvalid, {
				value: detailValue(details, 'value', '?'),
			});
		case 'LLM_CONNECTION_FAILED':
			return formatLocaleMessage(ui.errorLlmConnectionFailed, {
				provider: detailValue(details, 'provider', '?'),
				status: detailValue(details, 'status', '?'),
				statusText: detailValue(details, 'statusText', error.message || ui.errorUnknown),
			}).trim();
		case 'RAG_PROVIDER_UNSUPPORTED':
			return formatLocaleMessage(ui.errorRagProviderUnsupported, {
				provider: detailValue(details, 'provider', '?'),
			});
		case 'RAG_API_KEY_MISSING':
			return ui.errorRagApiKeyMissing;
		case 'RAG_BASE_URL_INVALID':
			return formatLocaleMessage(ui.errorRagBaseUrlInvalid, {
				value: detailValue(details, 'value', '?'),
			});
		case 'RAG_EMBEDDING_MODEL_MISSING':
			return ui.errorRagEmbeddingModelMissing;
		case 'RAG_RERANKER_MODEL_MISSING':
			return ui.errorRagRerankerModelMissing;
		case 'RAG_CONNECTION_FAILED':
			return formatLocaleMessage(ui.errorRagConnectionFailed, {
				provider: detailValue(details, 'provider', '?'),
				status: detailValue(details, 'status', '?'),
				statusText: detailValue(details, 'statusText', error.message || ui.errorUnknown),
			}).trim();
		case 'RAG_QUERY_EMPTY':
			return ui.errorRagQueryEmpty;
		default:
			return error.message || ui.errorUnknown;
	}
}
