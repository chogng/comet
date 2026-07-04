import type { Event } from 'cs/base/common/event';
import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
  connectWorkbenchWindowControls,
  getWindowStateSnapshot,
  hasWorkbenchWindowControlsProvider,
  performWorkbenchWindowControl,
  subscribeWindowState,
  type WorkbenchWindowControlAction,
} from 'cs/workbench/browser/window';

export const IHostService = createDecorator<IHostService>('hostService');

export interface IHostService {
  readonly _serviceBrand: undefined;
  readonly onDidChangeWindowState: Event<void>;
  hasWindowControlsProvider(): boolean;
  getWindowState(): ReturnType<typeof getWindowStateSnapshot>;
  connectWindowControls(electronRuntime: boolean): () => void;
  performWindowControl(action: WorkbenchWindowControlAction): void;
}

export class BrowserWorkbenchHostService implements IHostService {
  declare readonly _serviceBrand: undefined;

  readonly onDidChangeWindowState = subscribeWindowState;

  hasWindowControlsProvider() {
    return hasWorkbenchWindowControlsProvider();
  }

  getWindowState() {
    return getWindowStateSnapshot();
  }

  connectWindowControls(electronRuntime: boolean) {
    return connectWorkbenchWindowControls(electronRuntime);
  }

  performWindowControl(action: WorkbenchWindowControlAction) {
    performWorkbenchWindowControl(action);
  }
}

export function createWorkbenchHostService(): IHostService {
  return new BrowserWorkbenchHostService();
}

registerSingleton(IHostService, BrowserWorkbenchHostService, InstantiationType.Delayed);

export type { WorkbenchWindowControlAction };
