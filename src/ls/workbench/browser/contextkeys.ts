import type {
  ContextKey,
  ContextKeyService,
} from 'ls/platform/contextkey/common/contextkey';
import {
  contextKeyService,
  RawContextKey,
} from 'ls/platform/contextkey/common/contextkey';
import type { Disposable } from 'ls/workbench/browser/workbench.contribution';
import {
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchLayoutState,
  subscribeWorkbenchPartDom,
} from 'ls/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'ls/workbench/browser/part';
import type { WorkbenchPage } from 'ls/workbench/browser/workbench';
import {
  getWorkbenchStateSnapshot,
  subscribeWorkbenchState,
} from 'ls/workbench/browser/workbench';

export const WorkbenchContextKeys = {
  activePage: new RawContextKey<WorkbenchPage>(
    'workbench.activePage',
    'content',
  ),
  contentVisible: new RawContextKey<boolean>(
    'workbench.contentVisible',
    true,
  ),
  settingsVisible: new RawContextKey<boolean>(
    'workbench.settingsVisible',
    false,
  ),
  primarySidebarVisible: new RawContextKey<boolean>(
    'workbench.primarySidebarVisible',
    true,
  ),
  agentSidebarVisible: new RawContextKey<boolean>(
    'workbench.agentSidebarVisible',
    false,
  ),
  editorCollapsed: new RawContextKey<boolean>(
    'workbench.editorCollapsed',
    false,
  ),
  hasContainer: new RawContextKey<boolean>('workbench.hasContainer', false),
  hasTitlebar: new RawContextKey<boolean>('workbench.hasTitlebar', false),
  hasPrimaryBar: new RawContextKey<boolean>('workbench.hasPrimaryBar', false),
  hasAgentSidebar: new RawContextKey<boolean>(
    'workbench.hasAgentSidebar',
    false,
  ),
  hasStatusbar: new RawContextKey<boolean>('workbench.hasStatusbar', false),
  hasSettings: new RawContextKey<boolean>('workbench.hasSettings', false),
  hasEditor: new RawContextKey<boolean>('workbench.hasEditor', false),
  hasWebContentViewHost: new RawContextKey<boolean>(
    'workbench.hasWebContentViewHost',
    false,
  ),
} as const;

export type WorkbenchBoundContextKeys = {
  readonly [K in keyof typeof WorkbenchContextKeys]: ContextKey<
    (typeof WorkbenchContextKeys)[K]['defaultValue']
  >;
};

export function bindWorkbenchContextKeys(
  service: ContextKeyService = contextKeyService,
): WorkbenchBoundContextKeys {
  return {
    activePage: WorkbenchContextKeys.activePage.bindTo(service),
    contentVisible: WorkbenchContextKeys.contentVisible.bindTo(service),
    settingsVisible: WorkbenchContextKeys.settingsVisible.bindTo(service),
    primarySidebarVisible:
      WorkbenchContextKeys.primarySidebarVisible.bindTo(service),
    agentSidebarVisible:
      WorkbenchContextKeys.agentSidebarVisible.bindTo(service),
    editorCollapsed: WorkbenchContextKeys.editorCollapsed.bindTo(service),
    hasContainer: WorkbenchContextKeys.hasContainer.bindTo(service),
    hasTitlebar: WorkbenchContextKeys.hasTitlebar.bindTo(service),
    hasPrimaryBar: WorkbenchContextKeys.hasPrimaryBar.bindTo(service),
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
  const workbenchState = getWorkbenchStateSnapshot();
  const layoutState = getWorkbenchLayoutStateSnapshot();
  const partDom = getWorkbenchPartDomSnapshot();

  keys.activePage.set(workbenchState.activePage);
  keys.contentVisible.set(workbenchState.activePage === 'content');
  keys.settingsVisible.set(workbenchState.activePage === 'settings');
  keys.primarySidebarVisible.set(layoutState.isPrimarySidebarVisible);
  keys.agentSidebarVisible.set(layoutState.isAgentSidebarVisible);
  keys.editorCollapsed.set(layoutState.isEditorCollapsed);
  keys.hasContainer.set(Boolean(partDom[WORKBENCH_PART_IDS.container]));
  keys.hasTitlebar.set(Boolean(partDom[WORKBENCH_PART_IDS.titlebar]));
  keys.hasPrimaryBar.set(Boolean(partDom[WORKBENCH_PART_IDS.primaryBar]));
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

  const unsubscribeWorkbenchState = subscribeWorkbenchState(sync);
  const unsubscribeWorkbenchLayoutState = subscribeWorkbenchLayoutState(sync);
  const unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(sync);

  sync();

  return {
    dispose: () => {
      unsubscribeWorkbenchState.dispose();
      unsubscribeWorkbenchLayoutState.dispose();
      unsubscribeWorkbenchPartDom.dispose();
    },
  };
}
