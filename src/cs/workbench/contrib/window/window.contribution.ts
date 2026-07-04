/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  connectWorkbenchWindowControls,
  registerWorkbenchWindowControlsProvider,
} from 'cs/workbench/browser/window';
import { hasDesktopRuntime } from 'cs/base/common/platform';
import { INativeHostService } from 'cs/platform/native/common/native';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';

export class WorkbenchWindowControlsContribution {
  private readonly disposeWindowControls: () => void;

  constructor(
    @INativeHostService private readonly nativeHostService: INativeHostService,
  ) {
    registerWorkbenchWindowControlsProvider({
      getState: async () => {
        const controls = this.nativeHostService.windowControls;
        if (!controls) {
          return {
            isMaximized: false,
            isFullscreen: false,
          };
        }

        return controls.getState();
      },
      onStateChange: (listener) => {
        const controls = this.nativeHostService.windowControls;
        if (!controls) {
          return () => {};
        }

        return controls.onStateChange(listener);
      },
      perform: (action) => {
        this.nativeHostService.windowControls?.perform(action);
      },
    });

    this.disposeWindowControls = connectWorkbenchWindowControls(hasDesktopRuntime());
  }

  dispose() {
    this.disposeWindowControls();
  }
}

registerWorkbenchContribution(() =>
  getWorkbenchInstantiationService().createInstance(WorkbenchWindowControlsContribution),
);
