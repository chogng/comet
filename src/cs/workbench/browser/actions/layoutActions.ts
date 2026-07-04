import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { IWorkbenchLayoutService } from 'cs/workbench/services/layout/browser/layoutService';

export const WorkbenchLayoutCommandId = {
  applyAgentLayout: 'workbench.action.applyAgentLayout',
  applyFlowLayout: 'workbench.action.applyFlowLayout',
  togglePrimarySidebarVisibility:
    'workbench.action.togglePrimarySidebarVisibility',
  toggleAgentSidebarVisibility: 'workbench.action.toggleAgentSidebarVisibility',
  toggleEditorCollapsed: 'workbench.action.toggleEditorCollapsed',
} as const;

class ApplyAgentLayoutAction extends Action2 {
  constructor() {
    super({
      id: WorkbenchLayoutCommandId.applyAgentLayout,
      title: 'Apply Agent Layout',
    });
  }

  run(accessor: ServicesAccessor): void {
    accessor.get(IWorkbenchLayoutService).applyLayoutMode('agent');
  }
}

class ApplyFlowLayoutAction extends Action2 {
  constructor() {
    super({
      id: WorkbenchLayoutCommandId.applyFlowLayout,
      title: 'Apply Flow Layout',
    });
  }

  run(accessor: ServicesAccessor): void {
    accessor.get(IWorkbenchLayoutService).applyLayoutMode('flow');
  }
}

class TogglePrimarySidebarVisibilityAction extends Action2 {
  constructor() {
    super({
      id: WorkbenchLayoutCommandId.togglePrimarySidebarVisibility,
      title: 'Toggle Primary Sidebar Visibility',
    });
  }

  run(accessor: ServicesAccessor): void {
    accessor.get(IWorkbenchLayoutService).togglePrimarySidebarVisibility();
  }
}

class ToggleAgentSidebarVisibilityAction extends Action2 {
  constructor() {
    super({
      id: WorkbenchLayoutCommandId.toggleAgentSidebarVisibility,
      title: 'Toggle Agent Sidebar Visibility',
    });
  }

  run(accessor: ServicesAccessor): void {
    accessor.get(IWorkbenchLayoutService).toggleAgentSidebarVisibility();
  }
}

class ToggleEditorCollapsedAction extends Action2 {
  constructor() {
    super({
      id: WorkbenchLayoutCommandId.toggleEditorCollapsed,
      title: 'Toggle Editor Collapsed',
    });
  }

  run(accessor: ServicesAccessor, expandedEditorSize?: number): void {
    accessor.get(IWorkbenchLayoutService).toggleEditorCollapsed(expandedEditorSize);
  }
}

registerAction2(ApplyAgentLayoutAction);
registerAction2(ApplyFlowLayoutAction);
registerAction2(TogglePrimarySidebarVisibilityAction);
registerAction2(ToggleAgentSidebarVisibilityAction);
registerAction2(ToggleEditorCollapsedAction);
