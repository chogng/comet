import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
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
