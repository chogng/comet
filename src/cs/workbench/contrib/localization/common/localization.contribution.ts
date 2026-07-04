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
import { getNativeHostService } from 'cs/platform/native/electron-sandbox/nativeHostServiceAccessor';

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
