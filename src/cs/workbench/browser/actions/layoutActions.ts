/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { localize, localize2 } from 'cs/nls';
import { Categories } from 'cs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { WorkbenchContextKeys } from 'cs/workbench/common/contextkeys';
import { IWorkbenchLayoutService } from 'cs/workbench/services/layout/browser/layoutService';
import { IWorkbenchSidebarEntryService } from 'cs/workbench/services/sidebar/common/sidebarEntryService';

export class ApplyAgentLayoutAction extends Action2 {
  static readonly ID = 'workbench.action.applyAgentLayout';

  constructor() {
    super({
      id: ApplyAgentLayoutAction.ID,
      title: localize2('applyAgentLayout', "Apply Agent Layout"),
      category: Categories.View,
      f1: true,
    });
  }

  run(accessor: ServicesAccessor): void {
    const layoutService = accessor.get(IWorkbenchLayoutService);

    layoutService.applyLayoutMode('agent');
  }
}

export class ApplyFlowLayoutAction extends Action2 {
  static readonly ID = 'workbench.action.applyFlowLayout';

  constructor() {
    super({
      id: ApplyFlowLayoutAction.ID,
      title: localize2('applyFlowLayout', "Apply Flow Layout"),
      category: Categories.View,
      f1: true,
    });
  }

  run(accessor: ServicesAccessor): void {
    const layoutService = accessor.get(IWorkbenchLayoutService);

    layoutService.applyLayoutMode('flow');
  }
}

export class ActivateHomeSidebarEntryAction extends Action2 {
  static readonly ID = 'workbench.action.activateHomeSidebarEntry';

  constructor() {
    super({
      id: ActivateHomeSidebarEntryAction.ID,
      title: localize2('activateHomeSidebarEntry', "Open Home"),
      category: Categories.View,
      f1: true,
    });
  }

  run(accessor: ServicesAccessor): void {
    const sidebarEntryService = accessor.get(IWorkbenchSidebarEntryService);

    sidebarEntryService.activateEntry('home');
  }
}

export class ActivateCodeSidebarEntryAction extends Action2 {
  static readonly ID = 'workbench.action.activateCodeSidebarEntry';

  constructor() {
    super({
      id: ActivateCodeSidebarEntryAction.ID,
      title: localize2('activateCodeSidebarEntry', "Open Code"),
      category: Categories.View,
      f1: true,
    });
  }

  run(accessor: ServicesAccessor): void {
    const sidebarEntryService = accessor.get(IWorkbenchSidebarEntryService);

    sidebarEntryService.activateEntry('code');
  }
}

export class ToggleSidebarVisibilityAction extends Action2 {
  static readonly ID = 'workbench.action.toggleSidebarVisibility';
  static readonly LABEL = localize(
    'compositePart.hideSideBarLabel',
    "Hide Primary Side Bar",
  );

  constructor() {
    super({
      id: ToggleSidebarVisibilityAction.ID,
      title: localize2(
        'toggleSidebar',
        "Toggle Primary Side Bar Visibility",
      ),
      toggled: {
        condition: WorkbenchContextKeys.primarySidebarVisible.isEqualTo(true),
        title: localize('primary sidebar', "Primary Side Bar"),
        mnemonicTitle: localize(
          {
            key: 'primary sidebar mnemonic',
            comment: ['&& denotes a mnemonic'],
          },
          "&&Primary Side Bar",
        ),
      },
      metadata: {
        description: localize(
          'openAndCloseSidebar',
          'Open/Show and Close/Hide Sidebar',
        ),
      },
      category: Categories.View,
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyCode.KeyB,
      },
    });
  }

  run(accessor: ServicesAccessor): void {
    const layoutService = accessor.get(IWorkbenchLayoutService);

    layoutService.togglePrimarySidebarVisibility();
  }
}

export class ToggleAgentSidebarVisibilityAction extends Action2 {
  static readonly ID = 'workbench.action.toggleAgentSidebarVisibility';

  constructor() {
    super({
      id: ToggleAgentSidebarVisibilityAction.ID,
      title: localize2(
        'toggleAgentSidebarVisibility',
        "Toggle Agent Sidebar Visibility",
      ),
      category: Categories.View,
      f1: true,
    });
  }

  run(accessor: ServicesAccessor): void {
    const layoutService = accessor.get(IWorkbenchLayoutService);

    layoutService.toggleAgentSidebarVisibility();
  }
}

export class ToggleEditorCollapsedAction extends Action2 {
  static readonly ID = 'workbench.action.toggleEditorCollapsed';

  constructor() {
    super({
      id: ToggleEditorCollapsedAction.ID,
      title: localize2('toggleEditorCollapsed', "Toggle Editor Collapsed"),
      category: Categories.View,
      f1: true,
    });
  }

  run(accessor: ServicesAccessor, expandedEditorSize?: number): void {
    const layoutService = accessor.get(IWorkbenchLayoutService);

    layoutService.toggleEditorCollapsed(expandedEditorSize);
  }
}

registerAction2(ApplyAgentLayoutAction);
registerAction2(ApplyFlowLayoutAction);
registerAction2(ActivateHomeSidebarEntryAction);
registerAction2(ActivateCodeSidebarEntryAction);
registerAction2(ToggleSidebarVisibilityAction);
registerAction2(ToggleAgentSidebarVisibilityAction);
registerAction2(ToggleEditorCollapsedAction);
