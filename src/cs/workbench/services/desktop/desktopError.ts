import type { AppErrorCode } from 'cs/base/common/errors';
import type { LocaleMessages } from 'language/locales';

export type DesktopErrorCode = AppErrorCode;

export type DesktopInvokeErrorData = {
  code?: DesktopErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseDesktopInvokeError(error: unknown): DesktopInvokeErrorData {
  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const message = typeof error.message === 'string' ? error.message : String(error);
    const details = isRecord(error.details) ? error.details : undefined;

    return { code, message, details };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

export function formatLocalized(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function detailValue(details: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const value = details?.[key];
  return value === undefined || value === null ? fallback : String(value);
}

export function localizeDesktopInvokeError(
  ui: LocaleMessages,
  error: DesktopInvokeErrorData,
): string {
  const details = error.details;

  switch (error.code) {
    case 'MAIN_WINDOW_UNAVAILABLE':
      return ui.errorMainWindowUnavailable;
    case 'UNKNOWN_COMMAND':
      return formatLocalized(ui.errorUnknownCommand, {
        command: detailValue(details, 'command', '?'),
      });
    case 'URL_EMPTY':
      return ui.errorUrlEmpty;
    case 'URL_PROTOCOL_UNSUPPORTED':
      return formatLocalized(ui.errorUrlProtocolUnsupported, {
        protocol: detailValue(details, 'protocol', '?'),
      });
    case 'DATE_START_INVALID':
      return formatLocalized(ui.errorDateStartInvalid, {
        value: detailValue(details, 'value', '?'),
      });
    case 'DATE_END_INVALID':
      return formatLocalized(ui.errorDateEndInvalid, {
        value: detailValue(details, 'value', '?'),
      });
    case 'DATE_RANGE_INVALID':
      return ui.errorDateRangeInvalid;
    case 'HTTP_REQUEST_FAILED':
      return formatLocalized(ui.errorHttpRequestFailed, {
        status: detailValue(details, 'status', '?'),
        statusText: detailValue(details, 'statusText', ''),
      }).trim();
    case 'BATCH_PAGE_URLS_EMPTY':
      return ui.errorBatchPageUrlsEmpty;
    case 'BATCH_SOURCE_FETCH_FAILED':
      return ui.errorBatchSourceFetchFailed;
    case 'BATCH_NO_MATCH_IN_DATE_RANGE':
      return ui.errorBatchNoMatchInDateRange;
    case 'BATCH_NO_VALID_ARTICLES':
      return ui.errorBatchNoValidArticles;
    case 'PDF_LINK_NOT_FOUND':
      return ui.errorPdfLinkNotFound;
    case 'PDF_DOWNLOAD_FAILED':
      return formatLocalized(ui.errorPdfDownloadFailed, {
        status: detailValue(details, 'status', '?'),
        statusText: detailValue(details, 'statusText', ''),
      }).trim();
    case 'DOCX_EXPORT_NO_ARTICLES':
      return ui.errorDocxExportNoArticles;
    case 'DOCX_EXPORT_FAILED':
      return formatLocalized(ui.errorDocxExportFailed, {
        error: detailValue(details, 'message', error.message || ui.errorUnknown),
      });
    case 'PREVIEW_NOT_READY':
      return ui.errorWebContentNotReady;
    case 'LLM_PROVIDER_UNSUPPORTED':
      return formatLocalized(ui.errorLlmProviderUnsupported, {
        provider: detailValue(details, 'provider', '?'),
      });
    case 'LLM_API_KEY_MISSING':
      return ui.errorLlmApiKeyMissing;
    case 'LLM_MODEL_MISSING':
      return ui.errorLlmModelMissing;
    case 'LLM_BASE_URL_INVALID':
      return formatLocalized(ui.errorLlmBaseUrlInvalid, {
        value: detailValue(details, 'value', '?'),
      });
    case 'LLM_CONNECTION_FAILED':
      return formatLocalized(ui.errorLlmConnectionFailed, {
        provider: detailValue(details, 'provider', '?'),
        status: detailValue(details, 'status', '?'),
        statusText: detailValue(details, 'statusText', error.message || ui.errorUnknown),
      }).trim();
    case 'RAG_PROVIDER_UNSUPPORTED':
      return formatLocalized(ui.errorRagProviderUnsupported, {
        provider: detailValue(details, 'provider', '?'),
      });
    case 'RAG_API_KEY_MISSING':
      return ui.errorRagApiKeyMissing;
    case 'RAG_BASE_URL_INVALID':
      return formatLocalized(ui.errorRagBaseUrlInvalid, {
        value: detailValue(details, 'value', '?'),
      });
    case 'RAG_EMBEDDING_MODEL_MISSING':
      return ui.errorRagEmbeddingModelMissing;
    case 'RAG_RERANKER_MODEL_MISSING':
      return ui.errorRagRerankerModelMissing;
    case 'RAG_CONNECTION_FAILED':
      return formatLocalized(ui.errorRagConnectionFailed, {
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
