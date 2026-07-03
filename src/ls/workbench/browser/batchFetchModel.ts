import { toast } from 'ls/base/browser/ui/toast/toast';
import { EventEmitter } from 'ls/base/common/event';
import { MutableDisposable } from 'ls/base/common/lifecycle';
import type {
  JournalSourceOverride,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'ls/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'ls/platform/native/common/native';
import type { LocaleMessages } from 'language/locales';
import { fetchLatestArticlesBatch } from 'ls/workbench/services/article/articleFetch';
import type { Article } from 'ls/workbench/services/article/articleFetch';
import { INITIAL_BATCH_FETCH_MACHINE_STATE, reduceBatchFetchMachineState } from 'ls/workbench/services/article/batchFetchState';
import type { BatchFetchMachineEvent, BatchFetchMachineState } from 'ls/workbench/services/article/batchFetchState';
import { resolveBatchFetchStatusbarStatus } from 'ls/workbench/browser/parts/statusbar/statusbarFetchStatus';
import type { BatchFetchStatusbarStatus } from 'ls/workbench/browser/parts/statusbar/statusbarFetchStatus';

import {
  formatLocalized,
  localizeDesktopInvokeError,
} from 'ls/workbench/services/desktop/desktopError';

export type BatchFetchControllerContext = {
  desktopRuntime: boolean;
  addressBarUrl: string;
  journalSourceOverrides: JournalSourceOverride[];
  batchStartDate: string;
  batchEndDate: string;
  invokeDesktop: ElectronInvoke;
  nativeHost: INativeHostService;
  ui: LocaleMessages;
  onBeforeFetch: () => void;
  onFetchSuccess: (articles: Article[]) => void;
};

export type BatchFetchControllerSnapshot = BatchFetchMachineState &
  BatchFetchStatusbarStatus & {
    isBatchLoading: boolean;
  };

function createBatchFetchSnapshot(
  machineState: BatchFetchMachineState,
): BatchFetchControllerSnapshot {
  return {
    ...machineState,
    isBatchLoading: machineState.phase === 'loading',
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
      desktopRuntime,
      addressBarUrl,
      journalSourceOverrides,
      batchStartDate,
      batchEndDate,
      invokeDesktop,
      ui,
      onBeforeFetch,
      onFetchSuccess,
    } = this.context;

    this.requestId += 1;
    const requestId = this.requestId;

    this.dispatch({ type: 'FETCH_STARTED', requestId });
    onBeforeFetch();

    try {
      const result = await fetchLatestArticlesBatch({
        desktopRuntime,
        addressBarUrl,
        journalSourceOverrides,
        startDate: batchStartDate || null,
        endDate: batchEndDate || null,
        invokeDesktop,
      });

      if (this.disposed) {
        return;
      }

      if (!result.ok) {
        if (result.reason === 'desktop_unsupported') {
          toast.info(ui.toastDesktopBatchFetchOnly);
          this.dispatch({
            type: 'FETCH_FAILED',
            requestId,
            errorMessage: 'desktop_unsupported',
          });
          return;
        }

        if (result.reason === 'empty_page_url') {
          toast.error(ui.toastEnterPageUrl);
          this.dispatch({
            type: 'FETCH_FAILED',
            requestId,
            errorMessage: 'empty_page_url',
          });
          return;
        }

        if (result.reason === 'invalid_date_range') {
          toast.error(ui.toastDateRangeInvalid);
          this.dispatch({
            type: 'FETCH_FAILED',
            requestId,
            errorMessage: 'invalid_date_range',
          });
          return;
        }

        const localizedError = result.error
          ? localizeDesktopInvokeError(ui, result.error)
          : ui.errorUnknown;
        toast.error(
          formatLocalized(ui.toastBatchFetchFailed, {
            error: localizedError,
          }),
        );
        this.dispatch({
          type: 'FETCH_FAILED',
          requestId,
          errorMessage: localizedError,
        });
        return;
      }

      onFetchSuccess(result.articles);
      toast.success(
        formatLocalized(ui.toastBatchFetchSucceeded, {
          count: result.articles.length,
        }),
      );
      this.dispatch({ type: 'FETCH_SUCCEEDED', requestId });
    } catch (error) {
      if (this.disposed) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(
        formatLocalized(ui.toastBatchFetchFailed, {
          error: errorMessage || ui.errorUnknown,
        }),
      );
      this.dispatch({
        type: 'FETCH_FAILED',
        requestId,
        errorMessage: errorMessage || ui.errorUnknown,
      });
    }
  };

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
