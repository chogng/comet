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
import { commandService } from 'cs/platform/commands/common/commands';
import { KeybindingsRegistry } from 'cs/platform/keybinding/common/keybindingsRegistry';

test('registerAction2 wires command palette menu and keybinding', () => {
  class SampleAction extends Action2 {
    constructor() {
      super({
        id: 'test.sampleAction',
        title: 'Sample',
        f1: true,
        keybinding: {
          primary: KeyMod.CtrlCmd | KeyCode.KeyP,
        },
      });
    }

    run(): string {
      return 'ran';
    }
  }

  const disposable = registerAction2(SampleAction);

  assert.equal(commandService.executeCommand('test.sampleAction'), 'ran');
  assert.equal(MenuRegistry.getCommand('test.sampleAction')?.id, 'test.sampleAction');
  assert.equal(
    KeybindingsRegistry.getDefaultKeybindings().some(
      (rule) => rule.id === 'test.sampleAction',
    ),
    true,
  );
  assert.equal(getMenuActions(MenuId.CommandPalette)[0][1][0].id, 'test.sampleAction');

  disposable.dispose();
});
