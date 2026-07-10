import { EventEmitter } from 'cs/base/common/event';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import type {
  JournalSourceOverride,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { LocaleMessages } from 'language/locales';
import {
  fetchLatestArticlesBatch,
  resolveBatchFetchSources,
  resolveBatchFetchSourceTable,
} from 'cs/workbench/services/fetch/browser/articleFetch';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import { INITIAL_BATCH_FETCH_MACHINE_STATE, reduceBatchFetchMachineState } from 'cs/workbench/services/fetch/common/batchFetchState';
import type { BatchFetchMachineEvent, BatchFetchMachineState } from 'cs/workbench/services/fetch/common/batchFetchState';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import type { INotificationService } from 'cs/platform/notification/common/notification';
import type { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import { FetchErrorCode } from 'cs/workbench/services/fetch/common/fetchErrors';

import {
  formatLocaleMessage,
  localizeAppError,
} from 'cs/workbench/common/errorMessages';

export type BatchFetchControllerContext = {
  addressBarUrl: string;
  journalSourceOverrides: JournalSourceOverride[];
  batchStartDate: string;
  batchEndDate: string;
  batchLimit: number;
  fetchService: IFetchService;
  notificationService: INotificationService;
  ui: LocaleMessages;
  onBeforeFetch: () => void;
  onFetchSuccess: (articles: FetchArticle[]) => void;
};

export type BatchFetchControllerSnapshot = BatchFetchMachineState & {
    isBatchLoading: boolean;
    emptyMessage: string;
  };

export type BatchFetchControllerResult =
  | { ok: true; articles: FetchArticle[] }
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
  };
}

export class BatchFetchController {
  private context: BatchFetchControllerContext;
  private machineState = INITIAL_BATCH_FETCH_MACHINE_STATE;
	private snapshot: BatchFetchControllerSnapshot;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private requestId = 0;
  private activeFetchCancellation: CancellationTokenSource | undefined;
  private started = false;
  private disposed = false;

  constructor(context: BatchFetchControllerContext) {
    this.context = context;
		this.snapshot = createBatchFetchSnapshot(this.machineState);
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: BatchFetchControllerContext) => {
		const localeChanged = context.ui !== this.context.ui;
    this.context = context;
		if (localeChanged) {
			this.snapshot = createBatchFetchSnapshot(this.machineState);
			this.emitChange();
		}
  };

  readonly start = () => {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
  };

  readonly dispose = () => {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.activeFetchCancellation?.cancel();
    this.activeFetchCancellation?.dispose();
    this.onDidChangeEmitter.dispose();
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
      batchStartDate,
      batchEndDate,
      batchLimit,
      fetchService,
      notificationService,
      ui,
      onFetchSuccess,
    } = this.context;
    this.activeFetchCancellation?.cancel();
    this.activeFetchCancellation?.dispose();
    const cancellationSource = new CancellationTokenSource();
    this.activeFetchCancellation = cancellationSource;

    try {
      const result = await fetchLatestArticlesBatch({
        batchSources,
        sourceTable,
				limit: batchLimit,
        startDate: batchStartDate || null,
        endDate: batchEndDate || null,
				fetchService,
				token: cancellationSource.token,
      });

      if (this.disposed) {
        return { ok: false };
      }

      if (!result.ok) {
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
		} finally {
			if (this.activeFetchCancellation === cancellationSource) {
				this.activeFetchCancellation = undefined;
			}
			cancellationSource.dispose();
    }
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
