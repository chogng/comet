import type { DisposableLike } from 'ls/base/common/lifecycle';

export const WORKBENCH_PART_IDS = {
  container: 'workbench.container',
  primaryBar: 'workbench.primaryBar',
  agentSidebar: 'workbench.agentSidebar',
  statusbar: 'workbench.statusbar',
  settings: 'workbench.settings',
  editor: 'workbench.editor',
  webContentViewHost: 'workbench.view.webContentViewHost',
} as const;

export type WorkbenchPartId =
  (typeof WORKBENCH_PART_IDS)[keyof typeof WORKBENCH_PART_IDS];

export type WorkbenchPartRefCallback = (element: HTMLElement | null) => void;

export interface WorkbenchPart extends DisposableLike {
  readonly id: WorkbenchPartId;
  getElement(): HTMLElement;
  layout?(): void;
}
