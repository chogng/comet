/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  registerWorkbenchContribution,
} from 'cs/workbench/common/contributions';

import { INativeHostService } from 'cs/platform/native/common/native';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

function createLocaleServiceContext(nativeHostService: INativeHostService) {
  return {
	desktopRuntime: nativeHostService.canInvoke(),
	invokeDesktop: nativeHostService.invoke,
  };
}

class WorkbenchLocalizationContribution {
  constructor(
    @INativeHostService nativeHostService: INativeHostService,
	@IWorkbenchLocaleService localeService: IWorkbenchLocaleService,
  ) {
    const context = createLocaleServiceContext(nativeHostService);
    void localeService.initialize(context).catch((error) => {
      console.error('Failed to initialize locale service.', error);
    });
  }
}

registerWorkbenchContribution(() => {
	getWorkbenchInstantiationService().createInstance(WorkbenchLocalizationContribution);
});
