/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { SubmenuAction } from 'cs/base/common/actions';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import {
  Action2,
  MenuId,
  MenuRegistry,
  getMenuActions,
  registerAction2,
} from 'cs/platform/actions/common/actions';
import {
  commandService,
  setCommandServiceInstantiationService,
} from 'cs/platform/commands/common/commands';
import {
  createDecorator,
  type ServicesAccessor,
} from 'cs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import {
  KeybindingWeight,
  KeybindingsRegistry,
} from 'cs/platform/keybinding/common/keybindingsRegistry';
import { ContextKeyServiceImpl } from 'cs/platform/contextkey/common/contextkey';

interface TestActionService {
  readonly _serviceBrand: undefined;
  readonly value: string;
}

const ITestActionService =
  createDecorator<TestActionService>('testActionService');

test('registerAction2 wires command palette menu and keybinding', () => {
  class SampleAction extends Action2 {
    constructor() {
      super({
        id: 'test.sampleAction',
        title: 'Sample',
        f1: true,
        keybinding: {
          weight: KeybindingWeight.WorkbenchContrib,
          primary: KeyMod.CtrlCmd | KeyCode.KeyP,
        },
      });
    }

    run(accessor: ServicesAccessor): string {
      return accessor.get(ITestActionService).value;
    }
  }

  const serviceCollection = new ServiceCollection();
  serviceCollection.set(ITestActionService, {
    _serviceBrand: undefined,
    value: 'ran',
  });
  const instantiationService = new InstantiationService(
    serviceCollection,
    true,
  );
  const commandServiceInstantiationService = setCommandServiceInstantiationService(
    instantiationService,
  );
  const disposable = registerAction2(SampleAction);

  try {
    assert.equal(commandService.executeCommand('test.sampleAction'), 'ran');
    assert.equal(
      MenuRegistry.getCommand('test.sampleAction')?.id,
      'test.sampleAction',
    );
    assert.equal(
      KeybindingsRegistry.getDefaultKeybindings().some(
        (rule) => rule.command === 'test.sampleAction',
      ),
      true,
    );
    assert.equal(
      getMenuActions(MenuId.CommandPalette)[0][1][0].id,
      'test.sampleAction',
    );
  } finally {
    disposable.dispose();
    commandServiceInstantiationService.dispose();
    instantiationService.dispose();
  }
});

test('getMenuActions resolves submenu actions', () => {
  const menu = new MenuId('test.submenuMenu');
  const submenu = new MenuId('test.submenuMenu.items');
  const submenuItem = MenuRegistry.appendMenuItem(submenu, {
    command: {
      id: 'test.submenuAction',
      title: 'Submenu Action',
    },
  });
  const menuItem = MenuRegistry.appendMenuItem(menu, {
    submenu,
    title: 'Submenu',
  });

  try {
    const submenuAction = getMenuActions(menu)[0]?.[1][0];
    assert(submenuAction instanceof SubmenuAction);
    assert.deepEqual(submenuAction.actions.map(action => action.id), ['test.submenuAction']);
  } finally {
    menuItem.dispose();
    submenuItem.dispose();
  }
});

test('menu workbench toolbar keeps an open submenu through unrelated context changes', async () => {
  const domEnvironment = installDomTestEnvironment();
  const { MenuWorkbenchToolBar } = await import('cs/platform/actions/browser/toolbar');
  const contextKeyService = new ContextKeyServiceImpl();
  const menu = new MenuId('test.toolbarSubmenu');
  const submenu = new MenuId('test.toolbarSubmenu.items');
  const submenuItem = MenuRegistry.appendMenuItem(submenu, {
    command: { id: 'test.toolbarSubmenuAction', title: 'Submenu Action' },
  });
  const menuItem = MenuRegistry.appendMenuItem(menu, {
    submenu,
    title: 'Submenu',
  });
  const host = document.createElement('div');
  const dropdownServices = await createDropdownTestServices();
  document.body.append(host);
  const toolbar = new MenuWorkbenchToolBar(host, menu, {
    toolbarOptions: { primaryGroup: () => true },
  }, contextKeyService, dropdownServices.contextMenuService, dropdownServices.contextViewProvider);

  try {
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(document.body.querySelector('.comet-dropdown-menu'));

    contextKeyService.setContextKeyValue('test.unrelatedContext', true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(document.body.querySelector('.comet-dropdown-menu'));
  } finally {
    toolbar.dispose();
    dropdownServices.dispose();
    menuItem.dispose();
    submenuItem.dispose();
    domEnvironment.cleanup();
  }
});
