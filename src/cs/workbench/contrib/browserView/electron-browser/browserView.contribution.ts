/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  getWorkbenchBrowserTabKeepAliveLimit,
  subscribeWorkbenchWebContentRetention,
} from 'cs/workbench/contrib/browserView/browser/browserRetentionState';
import {
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchPartDom,
  WORKBENCH_PART_IDS,
} from 'cs/workbench/browser/layout';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { INativeHostService } from 'cs/platform/native/common/native';
import {
  registerWorkbenchContribution,
} from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { BrowserViewSurfaceSynchronizer } from 'cs/workbench/contrib/browserView/electron-browser/features/browserNavigationFeatures';

export class WorkbenchBrowserViewContribution {
  private readonly contributionDisposables = new DisposableStore();
  private readonly webContentApi: INativeHostService['webContent'];

  constructor(
    @INativeHostService nativeHostService: INativeHostService,
  ) {
    this.webContentApi =
      typeof window === 'undefined' ? undefined : nativeHostService.webContent;

    if (
      typeof window === 'undefined' ||
      typeof this.webContentApi?.navigate !== 'function'
    ) {
      return;
    }

    this.contributionDisposables.add(
      new BrowserViewSurfaceSynchronizer({
        targetWindow: window,
        webContentApi: this.webContentApi,
        getHostElement: () =>
          getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.webContentViewHost],
        onDidChangeHostElement: subscribeWorkbenchPartDom,
        getRetentionLimit: getWorkbenchBrowserTabKeepAliveLimit,
        onDidChangeRetentionLimit: subscribeWorkbenchWebContentRetention,
      }),
    );
  }

  dispose() {
    this.contributionDisposables.dispose();
  }
}

registerWorkbenchContribution(() =>
  getWorkbenchInstantiationService().createInstance(WorkbenchBrowserViewContribution),
);
