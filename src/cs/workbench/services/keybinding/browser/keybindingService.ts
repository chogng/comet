import type { IDisposable } from 'cs/base/common/lifecycle';
import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
  KeybindingsRegistry,
  type IKeybindingRule,
} from 'cs/platform/keybinding/common/keybindingsRegistry';

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

registerSingleton(
  IWorkbenchKeybindingService,
  BrowserWorkbenchKeybindingService,
  InstantiationType.Delayed,
);

export { KeybindingsRegistry };
export type { IKeybindingRule };
