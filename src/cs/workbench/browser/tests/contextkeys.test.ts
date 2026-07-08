/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { ContextKeyServiceImpl } from 'cs/platform/contextkey/common/contextkey';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

test('workbench context keys sync layout and part DOM state', async () => {
  const dom = installDomTestEnvironment();
  try {
    const {
      bindWorkbenchContextKeys,
      syncWorkbenchContextKeys,
    } = await import('cs/workbench/browser/contextkeys');
    const {
      registerWorkbenchPartDomNode,
      setAgentSidebarVisible,
      setEditorCollapsed,
      setPrimarySidebarVisible,
      WORKBENCH_PART_IDS,
    } = await import('cs/workbench/browser/layout');
    const resetWorkbenchContextKeyTestState = () => {
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

    setPrimarySidebarVisible(false);
    setAgentSidebarVisible(true);
    setEditorCollapsed(true);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, fakeContainer);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, fakeContainer);
    syncWorkbenchContextKeys(keys);

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
    assert.equal(service.getContextKeyValue('workbench.hasSettings'), true);
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
      'cs/platform/commands/common/commands'
    );
    const {
      createWorkbenchLayoutService,
      IWorkbenchLayoutService,
    } = await import('cs/workbench/services/layout/browser/layoutService');
    const {
      ApplyAgentLayoutAction,
      ApplyFlowLayoutAction,
      ToggleAgentSidebarVisibilityAction,
      ToggleEditorCollapsedAction,
      ToggleSidebarVisibilityAction,
    } = await import('cs/workbench/browser/actions/layoutActions');
    const {
      disposeWorkbenchInstantiationService,
      registerWorkbenchService,
    } = await import(
      'cs/workbench/services/instantiation/browser/workbenchInstantiationService'
    );
    const {
      getWorkbenchLayoutStateSnapshot,
      setAgentSidebarVisible,
      setEditorCollapsed,
      setPrimarySidebarVisible,
    } = await import('cs/workbench/browser/layout');

    const layoutService = createWorkbenchLayoutService();
    registerWorkbenchService(IWorkbenchLayoutService, layoutService);

    try {
      setPrimarySidebarVisible(false);
      setAgentSidebarVisible(false);
      setEditorCollapsed(true);

      commandService.executeCommand(ApplyAgentLayoutAction.ID);

      let layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isPrimarySidebarVisible, true);
      assert.equal(layoutState.isAgentSidebarVisible, true);
      assert.equal(layoutState.isEditorCollapsed, true);

      setEditorCollapsed(true);
      commandService.executeCommand(ApplyFlowLayoutAction.ID);

      layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isPrimarySidebarVisible, true);
      assert.equal(layoutState.isAgentSidebarVisible, false);
      assert.equal(layoutState.isEditorCollapsed, false);

      commandService.executeCommand(
        ToggleSidebarVisibilityAction.ID,
      );
      layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isPrimarySidebarVisible, false);

      commandService.executeCommand(
        ToggleAgentSidebarVisibilityAction.ID,
      );
      layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isAgentSidebarVisible, true);
      assert.equal(layoutState.isEditorCollapsed, true);

      commandService.executeCommand(ToggleEditorCollapsedAction.ID);
      layoutState = getWorkbenchLayoutStateSnapshot();
      assert.equal(layoutState.isEditorCollapsed, false);
    } finally {
      disposeWorkbenchInstantiationService();
      layoutService.dispose();
    }
  } finally {
    dom.cleanup();
  }
});
