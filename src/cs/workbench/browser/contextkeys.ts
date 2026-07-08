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
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchLayoutState,
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
    primarySidebarVisible:
      WorkbenchContextKeys.primarySidebarVisible.bindTo(service),
    agentSidebarVisible:
      WorkbenchContextKeys.agentSidebarVisible.bindTo(service),
    editorCollapsed: WorkbenchContextKeys.editorCollapsed.bindTo(service),
    hasContainer: WorkbenchContextKeys.hasContainer.bindTo(service),
    hasSidebar: WorkbenchContextKeys.hasSidebar.bindTo(service),
    hasAgentSidebar: WorkbenchContextKeys.hasAgentSidebar.bindTo(service),
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
  const layoutState = getWorkbenchLayoutStateSnapshot();
  const partDom = getWorkbenchPartDomSnapshot();

  keys.settingsVisible.set(Boolean(partDom[WORKBENCH_PART_IDS.settings]));
  keys.primarySidebarVisible.set(layoutState.isPrimarySidebarVisible);
  keys.agentSidebarVisible.set(layoutState.isAgentSidebarVisible);
  keys.editorCollapsed.set(layoutState.isEditorCollapsed);
  keys.hasContainer.set(Boolean(partDom[WORKBENCH_PART_IDS.container]));
  keys.hasSidebar.set(Boolean(partDom[WORKBENCH_PART_IDS.sidebar]));
  keys.hasAgentSidebar.set(Boolean(partDom[WORKBENCH_PART_IDS.agentSidebar]));
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

  const unsubscribeWorkbenchLayoutState = subscribeWorkbenchLayoutState(sync);
  const unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(sync);

  sync();

  return {
    dispose: () => {
      unsubscribeWorkbenchLayoutState.dispose();
      unsubscribeWorkbenchPartDom.dispose();
    },
  };
}

registerWorkbenchContribution(createWorkbenchContextKeysContribution);
