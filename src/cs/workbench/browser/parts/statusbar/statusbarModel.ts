import { EventEmitter } from 'cs/base/common/event';
import type {
  EditorStatusLabels,
  EditorStatusItem,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';

function createEmptyStatusValue(): EditorStatusState {
  return {
    ariaLabel: '',
    paneMode: 'empty',
    summary: '',
    leftItems: [],
    rightItems: [],
  };
}

export function createDefaultStatusbarState(
  labels: Pick<EditorStatusLabels, 'statusbarAriaLabel' | 'ready'>,
): EditorStatusState {
  return {
    ariaLabel: labels.statusbarAriaLabel,
    paneMode: 'empty',
    summary: labels.ready,
    leftItems: [],
    rightItems: [],
  };
}

function areStatusItemsEqual(
  previous: readonly EditorStatusItem[],
  next: readonly EditorStatusItem[],
) {
  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const previousItem = previous[index];
    const nextItem = next[index];
    if (
      previousItem.id !== nextItem.id ||
      previousItem.label !== nextItem.label ||
      previousItem.value !== nextItem.value ||
      previousItem.tone !== nextItem.tone ||
      previousItem.commandId !== nextItem.commandId ||
      previousItem.commandEnabled !== nextItem.commandEnabled
    ) {
      return false;
    }
  }

  return true;
}

function areStatusbarStatesEqual(previous: EditorStatusState, next: EditorStatusState) {
  return (
    previous.ariaLabel === next.ariaLabel &&
    previous.paneMode === next.paneMode &&
    previous.modeLabel === next.modeLabel &&
    previous.summary === next.summary &&
    areStatusItemsEqual(previous.leftItems, next.leftItems) &&
    areStatusItemsEqual(previous.rightItems, next.rightItems)
  );
}

let statusbarState: EditorStatusState = createEmptyStatusValue();
const onDidChangeStatusbarStateEmitter = new EventEmitter<void>();

function emitStatusbarStateChange() {
  onDidChangeStatusbarStateEmitter.fire();
}

export function subscribeStatusbarState(listener: () => void) {
  return onDidChangeStatusbarStateEmitter.event(listener);
}

export function getStatusbarStateSnapshot() {
  return statusbarState;
}

export function setStatusbarState(nextState: EditorStatusState) {
  if (areStatusbarStatesEqual(statusbarState, nextState)) {
    return;
  }

  statusbarState = nextState;
  emitStatusbarStateChange();
}

export function resetStatusbarState(
  labels: Pick<EditorStatusLabels, 'statusbarAriaLabel' | 'ready'>,
) {
  setStatusbarState(createDefaultStatusbarState(labels));
}
