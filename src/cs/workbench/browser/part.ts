/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DisposableLike } from 'cs/base/common/lifecycle';

export const WORKBENCH_PART_IDS = {
  container: 'workbench.container',
  titlebar: 'workbench.titlebar',
  sidebar: 'workbench.sidebar',
  statusbar: 'workbench.statusbar',
  settings: 'workbench.settings',
  editor: 'workbench.editor',
  webContentViewHost: 'workbench.view.webContentViewHost',
} as const;

export const WORKBENCH_SHELL_CLASS_NAME = 'comet-app-shell';

export type WorkbenchPartId = string;

export type WorkbenchPartRefCallback = (element: HTMLElement | null) => void;

export interface WorkbenchPart extends DisposableLike {
  readonly id: WorkbenchPartId;
  getElement(): HTMLElement;
  layout?(): void;
}
