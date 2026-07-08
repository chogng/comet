/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'cs/platform/contextkey/common/contextkey';

export const WorkbenchContextKeys = {
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
  hasSidebar: new RawContextKey<boolean>('workbench.hasSidebar', false),
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
