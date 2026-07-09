import type { FetchStatus } from 'cs/base/parts/sandbox/common/sandboxTypes';

export type BatchFetchStatusbarStatus = {
  statusbarFetchSourceText: string;
  statusbarFetchSourceTitle: string;
  statusbarFetchStopText: string;
  statusbarFetchStopTitle: string;
};

const EMPTY_BATCH_FETCH_STATUSBAR_STATUS: BatchFetchStatusbarStatus = {
  statusbarFetchSourceText: '',
  statusbarFetchSourceTitle: '',
  statusbarFetchStopText: '',
  statusbarFetchStopTitle: '',
};

function resolveFetchSourceText(fetchStatus: FetchStatus) {
  if (
    fetchStatus.fetchChannel === 'web-content' &&
    fetchStatus.webContentReuseMode === 'live-extract'
  ) {
    return 'Source: live web content DOM';
  }

  if (fetchStatus.fetchChannel === 'web-content') {
    return 'Source: web content DOM';
  }

  return 'Source: network';
}

function resolveFetchSourceTitle(fetchStatus: FetchStatus) {
  const sourceDetail = fetchStatus.fetchDetail
    ? ` | ${fetchStatus.fetchDetail}`
    : '';
  return `${fetchStatus.sourceId || 'source'} | page ${fetchStatus.pageNumber}${sourceDetail}`;
}

function resolveFetchStopText(fetchStatus: FetchStatus) {
  if (!fetchStatus.paginationStopped) {
    return '';
  }

  if (fetchStatus.paginationStopReason === 'tail_dates_before_start_date') {
    return 'Stop: tail-date policy';
  }

  return 'Stop: extractor policy';
}

function resolveFetchStopTitle(fetchStatus: FetchStatus) {
  if (!fetchStatus.paginationStopped) {
    return '';
  }

  const sourceLabel = fetchStatus.sourceId || 'source';
  const reasonLabel =
    fetchStatus.paginationStopReason || 'extractor_policy';
  return `${sourceLabel} | page ${fetchStatus.pageNumber} | ${reasonLabel}`;
}

export function resolveBatchFetchStatusbarStatus(
  fetchStatus: FetchStatus | null,
): BatchFetchStatusbarStatus {
  if (!fetchStatus) {
    return EMPTY_BATCH_FETCH_STATUSBAR_STATUS;
  }

  return {
    statusbarFetchSourceText: resolveFetchSourceText(fetchStatus),
    statusbarFetchSourceTitle: resolveFetchSourceTitle(fetchStatus),
    statusbarFetchStopText: resolveFetchStopText(fetchStatus),
    statusbarFetchStopTitle: resolveFetchStopTitle(fetchStatus),
  };
}
