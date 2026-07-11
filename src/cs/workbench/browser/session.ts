import { EventEmitter } from "cs/base/common/event";

export type WorkbenchSessionSnapshot = {
  webUrl: string;
};

const DEFAULT_WORKBENCH_SESSION: WorkbenchSessionSnapshot = {
  webUrl: "",
};

let workbenchSessionState = DEFAULT_WORKBENCH_SESSION;
const onDidChangeWorkbenchSessionEmitter = new EventEmitter<void>();

function updateWorkbenchSessionState(
  reducer: (current: WorkbenchSessionSnapshot) => WorkbenchSessionSnapshot,
) {
  const nextState = reducer(workbenchSessionState);
  if (Object.is(nextState, workbenchSessionState)) {
    return;
  }

  workbenchSessionState = nextState;
  onDidChangeWorkbenchSessionEmitter.fire();
}

export function subscribeWorkbenchSession(listener: () => void) {
  return onDidChangeWorkbenchSessionEmitter.event(listener);
}

export function getWorkbenchSessionSnapshot() {
  return workbenchSessionState;
}

export function setWorkbenchWebUrl(webUrl: string) {
  updateWorkbenchSessionState((current) =>
    current.webUrl === webUrl ? current : { ...current, webUrl },
  );
}
