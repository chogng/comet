/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  localeService,
} from 'cs/workbench/services/localization/browser/localeService';
import {
  subscribeLocalizationUiActions,
} from 'cs/workbench/contrib/localization/browser/localizationsActions';
import {
  registerWorkbenchContribution,
  type Disposable,
} from 'cs/workbench/common/contributions';

import { hasDesktopRuntime } from 'cs/base/common/platform';
import { INativeHostService } from 'cs/platform/native/common/native';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

function createLocaleServiceContext(nativeHostService: INativeHostService) {
  return {
    desktopRuntime: hasDesktopRuntime(),
    invokeDesktop: async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      return nativeHostService.invoke(command as never, args as never) as Promise<T>;
    },
  };
}

export class WorkbenchLocalizationContribution implements Disposable {
  private readonly unsubscribeLocalizationUiActions: () => void;

  constructor(
    @INativeHostService nativeHostService: INativeHostService,
  ) {
    const context = createLocaleServiceContext(nativeHostService);
    void localeService.initialize(context).catch((error) => {
      console.error('Failed to initialize locale service.', error);
    });

    this.unsubscribeLocalizationUiActions = subscribeLocalizationUiActions(
      (action) => {
        if (action.type !== 'SET_DISPLAY_LANGUAGE') {
          return;
        }

        void localeService
          .updateLocalePreference(action.locale, context)
          .catch((error) => {
            console.error('Failed to update display language.', error);
          });
      },
    );
  }

  dispose() {
    this.unsubscribeLocalizationUiActions();
  }
}

registerWorkbenchContribution(() =>
  getWorkbenchInstantiationService().createInstance(WorkbenchLocalizationContribution),
);
