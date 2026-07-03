import assert from 'node:assert/strict';
import test from 'node:test';

import { ContextKeyServiceImpl } from 'ls/platform/contextkey/common/contextkey';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

test('workbench context keys sync page, layout, and part DOM state', async () => {
  const dom = installDomTestEnvironment();
  try {
    const {
      bindWorkbenchContextKeys,
      syncWorkbenchContextKeys,
    } = await import('ls/workbench/browser/contextkeys');
    const {
      registerWorkbenchPartDomNode,
      setAgentSidebarVisible,
      setEditorCollapsed,
      setPrimarySidebarVisible,
      WORKBENCH_PART_IDS,
    } = await import('ls/workbench/browser/layout');
    const { setWorkbenchActivePage } = await import(
      'ls/workbench/browser/workbench'
    );
    const resetWorkbenchContextKeyTestState = () => {
      setWorkbenchActivePage('content');
      setPrimarySidebarVisible(true);
      setAgentSidebarVisible(false);
      setEditorCollapsed(false);
      for (const partId of Object.values(WORKBENCH_PART_IDS)) {
        registerWorkbenchPartDomNode(partId, null);
      }
    };

    resetWorkbenchContextKeyTestState();

    const service = new ContextKeyServiceImpl();
    const keys = bindWorkbenchContextKeys(service);
    const fakeContainer = {} as HTMLElement;

    setWorkbenchActivePage('settings');
    setPrimarySidebarVisible(false);
    setAgentSidebarVisible(true);
    setEditorCollapsed(true);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, fakeContainer);
    syncWorkbenchContextKeys(keys);

    assert.equal(
      service.getContextKeyValue('workbench.activePage'),
      'settings',
    );
    assert.equal(service.getContextKeyValue('workbench.contentVisible'), false);
    assert.equal(service.getContextKeyValue('workbench.settingsVisible'), true);
    assert.equal(
      service.getContextKeyValue('workbench.primarySidebarVisible'),
      false,
    );
    assert.equal(
      service.getContextKeyValue('workbench.agentSidebarVisible'),
      true,
    );
    assert.equal(service.getContextKeyValue('workbench.editorCollapsed'), true);
    assert.equal(service.getContextKeyValue('workbench.hasContainer'), true);
    assert.equal(service.getContextKeyValue('workbench.hasEditor'), false);

    resetWorkbenchContextKeyTestState();
  } finally {
    dom.cleanup();
  }
});

test('workbench layout service commands apply agent and flow layouts', async () => {
  const dom = installDomTestEnvironment();
  try {
    const { commandService } = await import(
      'ls/platform/commands/common/commands'
    );
    const {
      createWorkbenchLayoutService,
    } = await import('ls/workbench/services/layout/browser/layoutService');
    const {
      WorkbenchLayoutActions,
      WorkbenchLayoutCommandId,
    } = await import('ls/workbench/browser/actions/layoutActions');
    const {
      getWorkbenchLayoutStateSnapshot,
      setAgentSidebarVisible,
      setEditorCollapsed,
      setPrimarySidebarVisible,
    } = await import('ls/workbench/browser/layout');

    const layoutService = createWorkbenchLayoutService();
    const layoutActions = new WorkbenchLayoutActions(layoutService);
    const replacedLayoutActions = new WorkbenchLayoutActions(layoutService);

    try {
      setPrimarySidebarVisible(false);
      setAgentSidebarVisible(false);
      setEditorCollapsed(true);

      commandService.executeCommand(WorkbenchLayoutCommandId.applyAgentLayout);

      let layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isPrimarySidebarVisible, true);
      assert.equal(layoutState.isAgentSidebarVisible, true);
      assert.equal(layoutState.isEditorCollapsed, false);

      setEditorCollapsed(true);
      commandService.executeCommand(WorkbenchLayoutCommandId.applyFlowLayout);

      layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isPrimarySidebarVisible, true);
      assert.equal(layoutState.isAgentSidebarVisible, false);
      assert.equal(layoutState.isEditorCollapsed, false);
    } finally {
      replacedLayoutActions.dispose();
      layoutActions.dispose();
      layoutService.dispose();
    }
  } finally {
    dom.cleanup();
  }
});
