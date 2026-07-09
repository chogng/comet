import { EventEmitter } from 'cs/base/common/event';
import { MutableDisposable } from 'cs/base/common/lifecycle';
import type {
  JournalSourceOverride,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { LocaleMessages } from 'language/locales';
import {
  fetchLatestArticlesBatch,
  resolveBatchFetchSources,
  resolveBatchFetchSourceTable,
} from 'cs/workbench/services/fetch/browser/articleFetch';
import type { Article } from 'cs/workbench/services/fetch/browser/articleFetch';
import { INITIAL_BATCH_FETCH_MACHINE_STATE, reduceBatchFetchMachineState } from 'cs/workbench/services/fetch/common/batchFetchState';
import type { BatchFetchMachineEvent, BatchFetchMachineState } from 'cs/workbench/services/fetch/common/batchFetchState';
import { resolveBatchFetchStatusbarStatus } from 'cs/workbench/contrib/fetch/browser/batchFetchStatusbarStatus';
import type { BatchFetchStatusbarStatus } from 'cs/workbench/contrib/fetch/browser/batchFetchStatusbarStatus';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import type { INotificationService } from 'cs/platform/notification/common/notification';
import { FetchErrorCode } from 'cs/workbench/services/fetch/common/fetchErrors';

import {
  formatLocaleMessage,
  localizeAppError,
} from 'cs/workbench/common/errorMessages';

export type BatchFetchControllerContext = {
  desktopRuntime: boolean;
  addressBarUrl: string;
  journalSourceOverrides: JournalSourceOverride[];
  batchStartDate: string;
  batchEndDate: string;
  invokeDesktop: ElectronInvoke;
  nativeHost: INativeHostService;
  notificationService: INotificationService;
  ui: LocaleMessages;
  onBeforeFetch: () => void;
  onFetchSuccess: (articles: Article[]) => void;
};

export type BatchFetchControllerSnapshot = BatchFetchMachineState &
  BatchFetchStatusbarStatus & {
    isBatchLoading: boolean;
    emptyMessage: string;
  };

export type BatchFetchControllerResult =
  | { ok: true; articles: Article[] }
  | { ok: false; reason: 'empty'; message: string }
  | { ok: false };

const emptyFetchErrorCodes = new Set<string>([
  FetchErrorCode.BatchNoMatchInDateRange,
  FetchErrorCode.BatchNoValidArticles,
]);

function createBatchFetchSnapshot(
  machineState: BatchFetchMachineState,
): BatchFetchControllerSnapshot {
  return {
    ...machineState,
    isBatchLoading: machineState.phase === 'loading',
    emptyMessage: machineState.phase === 'empty' ? machineState.lastErrorMessage ?? '' : '',
    ...resolveBatchFetchStatusbarStatus(machineState.fetchStatus),
  };
}

export class BatchFetchController {
  private context: BatchFetchControllerContext;
  private machineState = INITIAL_BATCH_FETCH_MACHINE_STATE;
  private snapshot = createBatchFetchSnapshot(this.machineState);
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private readonly fetchStatusListener = new MutableDisposable<() => void>();
  private requestId = 0;
  private started = false;
  private disposed = false;

  constructor(context: BatchFetchControllerContext) {
    this.context = context;
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: BatchFetchControllerContext) => {
    const shouldReconnect =
      this.started &&
      (context.desktopRuntime !== this.context.desktopRuntime ||
        context.nativeHost !== this.context.nativeHost);
    this.context = context;

    if (shouldReconnect) {
      this.connectFetchStatus();
    }
  };

  readonly start = () => {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.connectFetchStatus();
  };

  readonly dispose = () => {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.fetchStatusListener.dispose();
    this.onDidChangeEmitter.dispose();
  };

  readonly clearFetchStatus = () => {
    this.dispatch({ type: 'FETCH_STATUS_CLEARED' });
  };

  readonly handleFetchLatestBatch = async () => {
    const {
      addressBarUrl,
      journalSourceOverrides,
      onBeforeFetch,
    } = this.context;

    this.requestId += 1;
    const requestId = this.requestId;

    this.dispatch({ type: 'FETCH_STARTED', requestId });
    onBeforeFetch();

    const sourceTable = resolveBatchFetchSourceTable(journalSourceOverrides);
    const batchSources = resolveBatchFetchSources(addressBarUrl, sourceTable);

    return this.handleFetchRequest(requestId, batchSources, sourceTable);
  };

  readonly handleFetchSource = async (
    source: BatchSource,
  ): Promise<BatchFetchControllerResult> => {
    const { journalSourceOverrides, onBeforeFetch } = this.context;

    this.requestId += 1;
    const requestId = this.requestId;

    this.dispatch({ type: 'FETCH_STARTED', requestId });
    onBeforeFetch();

    const sourceTable = resolveBatchFetchSourceTable(journalSourceOverrides);
    return this.handleFetchRequest(requestId, [source], sourceTable);
  };

  private async handleFetchRequest(
    requestId: number,
    batchSources: ReadonlyArray<BatchSource>,
    sourceTable: ReadonlyArray<BatchSource>,
  ): Promise<BatchFetchControllerResult> {
    const {
      desktopRuntime,
      batchStartDate,
      batchEndDate,
      invokeDesktop,
      notificationService,
      ui,
      onFetchSuccess,
    } = this.context;

    try {
      const result = await fetchLatestArticlesBatch({
        desktopRuntime,
        batchSources,
        sourceTable,
        startDate: batchStartDate || null,
        endDate: batchEndDate || null,
        invokeDesktop,
      });

      if (this.disposed) {
        return { ok: false };
      }

      if (!result.ok) {
        if ('reason' in result) {
          notificationService.info(ui.toastDesktopBatchFetchOnly);
          this.dispatch({
            type: 'FETCH_FAILED',
            requestId,
            errorMessage: 'desktop_unsupported',
          });
          return { ok: false };
        }

        if (result.error.code === FetchErrorCode.BatchPageUrlsEmpty) {
          notificationService.error(ui.toastEnterPageUrl);
          this.dispatch({
            type: 'FETCH_FAILED',
            requestId,
            errorMessage: result.error.code,
          });
          return { ok: false };
        }

        if (result.error.code === FetchErrorCode.DateRangeInvalid) {
          notificationService.error(ui.toastDateRangeInvalid);
          this.dispatch({
            type: 'FETCH_FAILED',
            requestId,
            errorMessage: result.error.code,
          });
          return { ok: false };
        }

        const localizedError = localizeAppError(ui, result.error);
        if (
          result.error.code &&
          emptyFetchErrorCodes.has(result.error.code)
        ) {
          this.dispatch({
            type: 'FETCH_EMPTY',
            requestId,
            message: localizedError,
          });
          return {
            ok: false,
            reason: 'empty',
            message: localizedError,
          };
        }

        notificationService.error(
          formatLocaleMessage(ui.toastBatchFetchFailed, {
            error: localizedError,
          }),
        );
        this.dispatch({
          type: 'FETCH_FAILED',
          requestId,
          errorMessage: localizedError,
        });
        return { ok: false };
      }

      onFetchSuccess(result.articles);
      notificationService.info(
        formatLocaleMessage(ui.toastBatchFetchSucceeded, {
          count: result.articles.length,
        }),
      );
      this.dispatch({ type: 'FETCH_SUCCEEDED', requestId });
      return { ok: true, articles: result.articles };
    } catch (error) {
      if (this.disposed) {
        return { ok: false };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      notificationService.error(
        formatLocaleMessage(ui.toastBatchFetchFailed, {
          error: errorMessage || ui.errorUnknown,
        }),
      );
      this.dispatch({
        type: 'FETCH_FAILED',
        requestId,
        errorMessage: errorMessage || ui.errorUnknown,
      });
      return { ok: false };
    }
  }

  private connectFetchStatus() {
    this.fetchStatusListener.clear();

    const fetchApi = this.context.nativeHost.fetch;
    if (!this.context.desktopRuntime || !fetchApi) {
      this.dispatch({ type: 'FETCH_STATUS_CLEARED' });
      return;
    }

    this.fetchStatusListener.value =
      fetchApi.onFetchStatus((status) => {
        this.dispatch({ type: 'FETCH_STATUS_UPDATED', status });
      });
  }

  private dispatch(event: BatchFetchMachineEvent) {
    const nextMachineState = reduceBatchFetchMachineState(this.machineState, event);
    if (Object.is(nextMachineState, this.machineState)) {
      return;
    }

    this.machineState = nextMachineState;
    this.snapshot = createBatchFetchSnapshot(this.machineState);
    this.emitChange();
  }

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }
}

export function createBatchFetchController(
  context: BatchFetchControllerContext,
) {
  return new BatchFetchController(context);
}
