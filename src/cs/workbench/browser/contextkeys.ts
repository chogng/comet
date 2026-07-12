/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  ContextKey,
  ContextKeyService,
} from 'cs/platform/contextkey/common/contextkey';
import { contextKeyService } from 'cs/platform/contextkey/common/contextkey';
import {
  registerWorkbenchContribution,
  type Disposable,
} from 'cs/workbench/common/contributions';
import { WorkbenchContextKeys } from 'cs/workbench/common/contextkeys';
import {
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchPartDom,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';

export type WorkbenchBoundContextKeys = {
  readonly [K in keyof typeof WorkbenchContextKeys]: ContextKey<
    (typeof WorkbenchContextKeys)[K]['defaultValue']
  >;
};

export function bindWorkbenchContextKeys(
  service: ContextKeyService = contextKeyService,
): WorkbenchBoundContextKeys {
  return {
    settingsVisible: WorkbenchContextKeys.settingsVisible.bindTo(service),
    hasContainer: WorkbenchContextKeys.hasContainer.bindTo(service),
    hasSidebar: WorkbenchContextKeys.hasSidebar.bindTo(service),
    hasStatusbar: WorkbenchContextKeys.hasStatusbar.bindTo(service),
    hasSettings: WorkbenchContextKeys.hasSettings.bindTo(service),
    hasEditor: WorkbenchContextKeys.hasEditor.bindTo(service),
    hasWebContentViewHost:
      WorkbenchContextKeys.hasWebContentViewHost.bindTo(service),
  };
}

export function syncWorkbenchContextKeys(
  keys: WorkbenchBoundContextKeys,
) {
  const partDom = getWorkbenchPartDomSnapshot();

  keys.settingsVisible.set(Boolean(partDom[WORKBENCH_PART_IDS.settings]));
  keys.hasContainer.set(Boolean(partDom[WORKBENCH_PART_IDS.container]));
  keys.hasSidebar.set(Boolean(partDom[WORKBENCH_PART_IDS.sidebar]));
  keys.hasStatusbar.set(Boolean(partDom[WORKBENCH_PART_IDS.statusbar]));
  keys.hasSettings.set(Boolean(partDom[WORKBENCH_PART_IDS.settings]));
  keys.hasEditor.set(Boolean(partDom[WORKBENCH_PART_IDS.editor]));
  keys.hasWebContentViewHost.set(
    Boolean(partDom[WORKBENCH_PART_IDS.webContentViewHost]),
  );
}

export function createWorkbenchContextKeysContribution(
  service: ContextKeyService = contextKeyService,
): Disposable {
  const keys = bindWorkbenchContextKeys(service);
  const sync = () => {
    syncWorkbenchContextKeys(keys);
  };

  const unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(sync);

  sync();

  return {
    dispose: () => {
      unsubscribeWorkbenchPartDom.dispose();
    },
  };
}

registerWorkbenchContribution(createWorkbenchContextKeysContribution);
