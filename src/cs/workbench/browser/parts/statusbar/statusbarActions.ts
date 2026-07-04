import type {
  EditorStatusItem,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';
import { resetStatusbarState, setStatusbarState } from 'cs/workbench/browser/parts/statusbar/statusbarModel';

export type StatusbarCommandHandler = () => void;
export type StatusbarCommandId = NonNullable<EditorStatusItem['commandId']>;

const statusbarCommandHandlers: Partial<Record<StatusbarCommandId, StatusbarCommandHandler>> = {};

export function updateStatusbarState(status: EditorStatusState) {
  setStatusbarState(status);
}

export function initializeStatusbarState(labels: {
  statusbarAriaLabel: string;
  ready: string;
}) {
  resetStatusbarState(labels);
}

export function setStatusbarCommandHandlers(
  nextHandlers: Partial<Record<StatusbarCommandId, StatusbarCommandHandler | null>>,
) {
  for (const key of Object.keys(statusbarCommandHandlers) as StatusbarCommandId[]) {
    delete statusbarCommandHandlers[key];
  }

  for (const [commandId, handler] of Object.entries(nextHandlers) as Array<
    [StatusbarCommandId, StatusbarCommandHandler | null | undefined]
  >) {
    if (handler) {
      statusbarCommandHandlers[commandId] = handler;
    }
  }
}

export function clearStatusbarCommandHandlers() {
  for (const key of Object.keys(statusbarCommandHandlers) as StatusbarCommandId[]) {
    delete statusbarCommandHandlers[key];
  }
}

export function canRunStatusbarCommand(item: EditorStatusItem) {
  if (!item.commandId || item.commandEnabled === false) {
    return false;
  }

  return Boolean(statusbarCommandHandlers[item.commandId]);
}

export function runStatusbarCommand(item: EditorStatusItem) {
  if (!item.commandId || item.commandEnabled === false) {
    return false;
  }

  const handler = statusbarCommandHandlers[item.commandId];
  if (!handler) {
    return false;
  }

  handler();
  return true;
}
