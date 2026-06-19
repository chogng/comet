import {
  localeService,
} from 'ls/workbench/contrib/localization/browser/localeService';
import {
  subscribeLocalizationUiActions,
} from 'ls/workbench/contrib/localization/browser/localizationsActions';
import { registerWorkbenchContribution } from 'ls/workbench/contrib/workbench/workbench.contribution';
import type { Disposable } from 'ls/workbench/contrib/workbench/workbench.contribution';

import { hasDesktopRuntime } from 'ls/base/common/platform';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';

function createLocaleServiceContext() {
  return {
    desktopRuntime: hasDesktopRuntime(),
    invokeDesktop: async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      return getNativeHostService().invoke(command as never, args as never) as Promise<T>;
    },
  };
}

export function createWorkbenchLocalizationContribution(): Disposable {
  const context = createLocaleServiceContext();
  void localeService.initialize(context).catch((error) => {
    console.error('Failed to initialize locale service.', error);
  });

  const unsubscribeLocalizationUiActions = subscribeLocalizationUiActions(
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

  return {
    dispose: () => {
      unsubscribeLocalizationUiActions();
    },
  };
}

registerWorkbenchContribution(createWorkbenchLocalizationContribution);
