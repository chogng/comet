import type { FetchStatus } from 'cs/base/parts/sandbox/common/sandboxTypes';

export type BatchFetchPhase = 'idle' | 'loading' | 'succeeded' | 'empty' | 'failed';

export type BatchFetchMachineState = {
  phase: BatchFetchPhase;
  activeRequestId: number | null;
  fetchStatus: FetchStatus | null;
  lastErrorMessage: string | null;
};

export type BatchFetchMachineEvent =
  | { type: 'FETCH_STARTED'; requestId: number }
  | { type: 'FETCH_STATUS_UPDATED'; status: FetchStatus }
  | { type: 'FETCH_STATUS_CLEARED' }
  | { type: 'FETCH_SUCCEEDED'; requestId: number }
  | { type: 'FETCH_EMPTY'; requestId: number; message: string }
  | { type: 'FETCH_FAILED'; requestId: number; errorMessage: string | null };

export const INITIAL_BATCH_FETCH_MACHINE_STATE: BatchFetchMachineState = {
  phase: 'idle',
  activeRequestId: null,
  fetchStatus: null,
  lastErrorMessage: null,
};

export function reduceBatchFetchMachineState(
  state: BatchFetchMachineState,
  event: BatchFetchMachineEvent,
): BatchFetchMachineState {
  switch (event.type) {
    case 'FETCH_STARTED':
      return {
        phase: 'loading',
        activeRequestId: event.requestId,
        fetchStatus: null,
        lastErrorMessage: null,
      };
    case 'FETCH_STATUS_UPDATED':
      return {
        ...state,
        fetchStatus: event.status,
      };
    case 'FETCH_STATUS_CLEARED':
      return {
        ...state,
        fetchStatus: null,
      };
    case 'FETCH_SUCCEEDED':
      if (state.activeRequestId !== event.requestId) {
        return state;
      }

      return {
        ...state,
        phase: 'succeeded',
        activeRequestId: null,
        lastErrorMessage: null,
      };
    case 'FETCH_FAILED':
      if (state.activeRequestId !== event.requestId) {
        return state;
      }

      return {
        ...state,
        phase: 'failed',
        activeRequestId: null,
        lastErrorMessage: event.errorMessage,
      };
    case 'FETCH_EMPTY':
      if (state.activeRequestId !== event.requestId) {
        return state;
      }

      return {
        ...state,
        phase: 'empty',
        activeRequestId: null,
        lastErrorMessage: event.message,
      };
    default:
      return state;
  }
}
