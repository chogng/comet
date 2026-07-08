import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
  applyWorkbenchLayoutMode,
  createWorkbenchPartRef,
  dispatchWorkbenchLayoutEvent,
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomNode,
  getWorkbenchPartDomSnapshot,
  registerWorkbenchPartDomNode,
  setAgentSidebarSize,
  setAgentSidebarVisible,
  setEditorCollapsed,
  setPrimarySidebarSize,
  setPrimarySidebarVisible,
  setWorkbenchSidebarSizes,
  subscribeWorkbenchLayoutState,
  subscribeWorkbenchPartDom,
  toggleAgentSidebarVisibility,
  toggleEditorCollapsed,
  togglePrimarySidebarVisibility,
  type WorkbenchLayoutEvent,
  type WorkbenchLayoutMode,
  type WorkbenchLayoutStateSnapshot,
  type WorkbenchPartId,
  type WorkbenchPartRefCallback,
} from 'cs/workbench/browser/layout';

export const IWorkbenchLayoutService =
  createDecorator<IWorkbenchLayoutService>('workbenchLayoutService');

export interface IWorkbenchLayoutService extends IDisposable {
  readonly _serviceBrand: undefined;
  readonly onDidChangeLayoutState: Event<void>;
  readonly onDidChangePartDom: Event<void>;
  getLayoutState(): WorkbenchLayoutStateSnapshot;
  getPartDomSnapshot(): Record<WorkbenchPartId, HTMLElement | null>;
  getPartDomNode(partId: WorkbenchPartId): HTMLElement | null;
  registerPartDomNode(partId: WorkbenchPartId, element: HTMLElement | null): void;
  createPartRef(partId: WorkbenchPartId): WorkbenchPartRefCallback;
  dispatchLayoutEvent(event: WorkbenchLayoutEvent): void;
  applyLayoutMode(mode: WorkbenchLayoutMode): void;
  setSidebarSizes(
    sizes: Partial<
      Pick<
        WorkbenchLayoutStateSnapshot,
        'primarySidebarSize' | 'agentSidebarSize'
      >
    >,
  ): void;
  setPrimarySidebarVisible(visible: boolean): void;
  setPrimarySidebarSize(size: number): void;
  togglePrimarySidebarVisibility(): void;
  setAgentSidebarVisible(visible: boolean): void;
  setAgentSidebarSize(size: number): void;
  toggleAgentSidebarVisibility(): void;
  setEditorCollapsed(collapsed: boolean, expandedEditorSize?: number): void;
  toggleEditorCollapsed(expandedEditorSize?: number): void;
}

export class BrowserWorkbenchLayoutService implements IWorkbenchLayoutService {
  declare readonly _serviceBrand: undefined;

  readonly onDidChangeLayoutState = subscribeWorkbenchLayoutState;
  readonly onDidChangePartDom = subscribeWorkbenchPartDom;

  dispose() {
  }

  getLayoutState() {
    return getWorkbenchLayoutStateSnapshot();
  }

  getPartDomSnapshot() {
    return getWorkbenchPartDomSnapshot();
  }

  getPartDomNode(partId: WorkbenchPartId) {
    return getWorkbenchPartDomNode(partId);
  }

  registerPartDomNode(partId: WorkbenchPartId, element: HTMLElement | null) {
    registerWorkbenchPartDomNode(partId, element);
  }

  createPartRef(partId: WorkbenchPartId) {
    return createWorkbenchPartRef(partId);
  }

  dispatchLayoutEvent(event: WorkbenchLayoutEvent) {
    dispatchWorkbenchLayoutEvent(event);
  }

  applyLayoutMode(mode: WorkbenchLayoutMode) {
    applyWorkbenchLayoutMode(mode);
  }

  setSidebarSizes(
    sizes: Partial<
      Pick<
        WorkbenchLayoutStateSnapshot,
        'primarySidebarSize' | 'agentSidebarSize'
      >
    >,
  ) {
    setWorkbenchSidebarSizes(sizes);
  }

  setPrimarySidebarVisible(visible: boolean) {
    setPrimarySidebarVisible(visible);
  }

  setPrimarySidebarSize(size: number) {
    setPrimarySidebarSize(size);
  }

  togglePrimarySidebarVisibility() {
    togglePrimarySidebarVisibility();
  }

  setAgentSidebarVisible(visible: boolean) {
    setAgentSidebarVisible(visible);
  }

  setAgentSidebarSize(size: number) {
    setAgentSidebarSize(size);
  }

  toggleAgentSidebarVisibility() {
    toggleAgentSidebarVisibility();
  }

  setEditorCollapsed(collapsed: boolean, expandedEditorSize?: number) {
    setEditorCollapsed(collapsed, expandedEditorSize);
  }

  toggleEditorCollapsed(expandedEditorSize?: number) {
    toggleEditorCollapsed(expandedEditorSize);
  }
}

export function createWorkbenchLayoutService(): IWorkbenchLayoutService {
  return new BrowserWorkbenchLayoutService();
}

registerSingleton(
  IWorkbenchLayoutService,
  BrowserWorkbenchLayoutService,
  InstantiationType.Delayed,
);

export {
  WORKBENCH_PART_IDS,
  getWorkbenchShellClassName,
} from 'cs/workbench/browser/layout';
export type {
  WorkbenchLayoutMode,
  WorkbenchLayoutStateSnapshot,
  WorkbenchPartId,
  WorkbenchPartRefCallback,
} from 'cs/workbench/browser/layout';
