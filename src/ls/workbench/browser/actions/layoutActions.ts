import { DisposableStore } from 'ls/base/common/lifecycle';
import type { IDisposable } from 'ls/base/common/lifecycle';
import { commandsRegistry } from 'ls/platform/commands/common/commands';
import { getWorkbenchInstantiationService } from 'ls/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchLayoutService } from 'ls/workbench/services/layout/browser/layoutService';
import { registerWorkbenchContribution } from 'ls/workbench/browser/workbench.contribution';

export const WorkbenchLayoutCommandId = {
  applyAgentLayout: 'workbench.action.applyAgentLayout',
  applyFlowLayout: 'workbench.action.applyFlowLayout',
  togglePrimarySidebarVisibility:
    'workbench.action.togglePrimarySidebarVisibility',
  toggleAgentSidebarVisibility: 'workbench.action.toggleAgentSidebarVisibility',
  toggleEditorCollapsed: 'workbench.action.toggleEditorCollapsed',
} as const;

let activeWorkbenchLayoutActions: WorkbenchLayoutActions | null = null;

export class WorkbenchLayoutActions implements IDisposable {
  private readonly disposables = new DisposableStore();

  constructor(
    @IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
  ) {
    activeWorkbenchLayoutActions?.dispose();
    activeWorkbenchLayoutActions = this;

    this.disposables.add(
      commandsRegistry.registerCommand(
        WorkbenchLayoutCommandId.applyAgentLayout,
        () => {
          this.layoutService.applyLayoutMode('agent');
        },
      ),
    );
    this.disposables.add(
      commandsRegistry.registerCommand(
        WorkbenchLayoutCommandId.applyFlowLayout,
        () => {
          this.layoutService.applyLayoutMode('flow');
        },
      ),
    );
    this.disposables.add(
      commandsRegistry.registerCommand(
        WorkbenchLayoutCommandId.togglePrimarySidebarVisibility,
        () => {
          this.layoutService.togglePrimarySidebarVisibility();
        },
      ),
    );
    this.disposables.add(
      commandsRegistry.registerCommand(
        WorkbenchLayoutCommandId.toggleAgentSidebarVisibility,
        () => {
          this.layoutService.toggleAgentSidebarVisibility();
        },
      ),
    );
    this.disposables.add(
      commandsRegistry.registerCommand(
        WorkbenchLayoutCommandId.toggleEditorCollapsed,
        (expandedEditorSize?: number) => {
          this.layoutService.toggleEditorCollapsed(expandedEditorSize);
        },
      ),
    );
  }

  dispose() {
    this.disposables.dispose();
    if (activeWorkbenchLayoutActions === this) {
      activeWorkbenchLayoutActions = null;
    }
  }
}

registerWorkbenchContribution(() =>
  getWorkbenchInstantiationService().createInstance(WorkbenchLayoutActions),
);
