import type { IDisposable } from 'ls/base/common/lifecycle';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';
import {
  KeybindingsRegistry,
  type IKeybindingRule,
} from 'ls/platform/keybinding/common/keybindingsRegistry';

export const IWorkbenchKeybindingService =
  createDecorator<IWorkbenchKeybindingService>(
    'workbenchKeybindingService',
  );

export interface IWorkbenchKeybindingService {
  readonly _serviceBrand: undefined;
  registerKeybindingRule(rule: IKeybindingRule): IDisposable;
  getDefaultKeybindings(): readonly IKeybindingRule[];
}

export class BrowserWorkbenchKeybindingService
  implements IWorkbenchKeybindingService
{
  declare readonly _serviceBrand: undefined;

  registerKeybindingRule(rule: IKeybindingRule) {
    return KeybindingsRegistry.registerKeybindingRule(rule);
  }

  getDefaultKeybindings() {
    return KeybindingsRegistry.getDefaultKeybindings();
  }
}

export function createWorkbenchKeybindingService(): IWorkbenchKeybindingService {
  return new BrowserWorkbenchKeybindingService();
}

export { KeybindingsRegistry };
export type { IKeybindingRule };
